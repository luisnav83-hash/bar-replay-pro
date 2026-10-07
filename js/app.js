/* =========================================================================
 * app.js — Inicialización y orquestación de la aplicación.
 *
 *  Responsabilidades:
 *   · Cargar datos (Binance / caché / CSV / demo) y arrancar el replay
 *   · Conectar Bar Replay ↔ Gráfico ↔ Motor de trading ↔ UI
 *   · Gestión de "checkpoints" para poder RETROCEDER velas reconstruyendo
 *     el estado de la cuenta (balance, trades, posición) sin recalcular todo
 *   · Indicadores (cálculo causal sobre la serie completa; se dibuja hasta
 *     el cursor del replay, así que no hay fuga de información futura)
 *   · Sesiones, exportaciones y captura de pantalla
 * =======================================================================*/
(function (global) {
  'use strict';

  /* Si llegamos aquí, el JavaScript se ejecuta: retiramos el cartel de
     emergencia que se muestra cuando el entorno bloquea los scripts. */
  try {
    const aviso = document.getElementById('brpNoJS');
    if (aviso && aviso.parentNode) aviso.parentNode.removeChild(aviso);
  } catch (e) {}

  const App = {};

  /* -------------------------------- Estado -------------------------------- */

  App.pair = 'BTCUSDT';
  App.interval = '1h';
  App.warmup = 150;              // velas de contexto antes del inicio del replay
  App.autoReveal = true;         // mantener visible la última vela al avanzar
  App.sizeMode = 'pct';          // pct | notional | qty
  App.candles = [];              // velas cargadas (todas, incluidas las ocultas)
  App.checkpoints = [];          // estado de la cuenta en cada índice del replay
  App.indicators = null;         // configuración de indicadores activos
  App.source = '—';
  App.orderType = 'market';        // 'market' (a mercado) | 'limite' (orden límite)

  const MAX_CANDLES = 6000;      // límite de velas en memoria/caché (rendimiento)
  const LS_IND = 'indicators';

  /* ================================ ARRANQUE ================================ */

  App.init = function () {
    global.__BRP_OK__ = true;   // marca para el vigilante de abajo

    // 1) Indicadores guardados (o por defecto)
    App.indicators = ST.get(LS_IND, {
      vol:  { on: true, color: '#5c6bc0' },
      sma:  { on: true,  p: 50,  color: '#ffd54f' },
      ema:  { on: true,  p: 21,  color: '#00e5ff' },
      ema2: { on: false, p: 200, color: '#e040fb' },
      bb:   { on: false, p: 20, k: 2, color: '#7c4dff' },
      rsi:  { on: true,  p: 14,  color: '#b388ff' },
      macd: { on: false, f: 12, s: 26, sig: 9, color: '#40c4ff', signalColor: '#ffab40' },
      atr:  { on: false, p: 14,  color: '#ffab40' },
    });

    // 2) Ajustes guardados
    const s = ST.getSettings();
    App.pair = s.pair; App.interval = s.interval; App.warmup = s.warmup;
    App.autoReveal = s.autoReveal; App.sizeMode = s.sizeMode;
    DT.gesture.on = s.gestureDraw !== false;      // dibujar manteniendo pulsado
    U.sound.enabled = s.sound;

    document.getElementById('pairSelect').value = App.pair;
    document.getElementById('tfSelect').value = App.interval;
    document.getElementById('sizeInput').value = s.sizeValue;
    document.getElementById('feeInput').value = s.fee;
    document.getElementById('leverageSelect').value = s.leverage;

    // 3) Gráfico + herramientas de dibujo
    CM.init();
    DT.init(document.getElementById('overlayCanvas'));
    DT.defaultStyle = { color: '#00e5ff', width: 2, style: 'solid' };

    // 4) Motor de trading
    TE.configure({ initialCapital: s.capital, leverage: s.leverage, feePct: s.fee, fundingPct: s.funding, slFirst: s.slFirst });
    TE.resetAccount(s.capital);

    // 5) UI
    UI.init();
    UI.setPairLabels(App.pair, App.interval);
    UI.setSizeMode(App.sizeMode);
    App.applyIndicators(App.indicators, true);

    // 5b) Cuando una orden límite se ejecuta durante el replay: redibujar
    TE.onFill = (pos) => {
      App.refreshOrderLines();
      DT.setTradeHandles(pos);
      UI.refreshAll();
      UI.refreshStats(true);
    };

    // 6) Conexión de eventos del replay
    BR.onStateChange = (playing) => UI.setPlaying(playing);
    BR.onAdvance = (from, to) => App.onAdvance(from, to);
    BR.onSeek = (index) => App.onSeek(index);
    BR.onEnd = () => { U.toast('🏁 Fin del histórico. Pulsa «Cargar datos» para traer más velas o reinicia el replay.', 'warn', 4200); };

    // 7) Cierre ordenado (avisa si hay sesión sin guardar)
    global.addEventListener('beforeunload', (e) => {
      if (TE.state.trades.length || DT.drawings.length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    U.log('🚀 Bar Replay Pro iniciado. Elige par y temporalidad y pulsa «Cargar datos».', 'sys');
    U.log('⌨️  Atajos: Espacio (play/pausa) · ← → (vela) · B (long) · S (short) · Esc (cerrar) · R (reset)', 'sys');

    // 8) Autocarga con TEMPORIZADOR DE SEGURIDAD: si la red del entorno no
    //    responde (típico en iframes de vista previa sin salida a internet),
    //    la app arranca en modo DEMO en pocos segundos en lugar de quedarse
    //    mostrando el spinner. Si los datos reales llegan después, se avisa.
    const BOOT_BUDGET = 9000;      // ms hasta arrancar en DEMO
    let booted = false;
    const bootTimer = setTimeout(() => {
      if (booted || App.candles.length) return;
      booted = true;
      App._bootedDemo = true;
      U.log('⏱️ La red no respondió en ' + (BOOT_BUDGET / 1000) + ' s: arrancando sin conexión', 'warn');
      const modo = App.loadDemo(true);
      U.toast(modo === 'snapshot'
        ? '📦 Sin conexión: estos son precios REALES guardados en el archivo'
        : 'La red tarda demasiado: empiezo en modo DEMO (pulsa «Cargar datos» cuando quieras)',
        modo === 'snapshot' ? 'ok' : 'warn', 6000);
      UI.hideLoader();
    }, BOOT_BUDGET);

    App.loadDataFromForm({ silent: true, deadlineMs: 20000, userDataGuard: true })
      .then(() => { booted = true; clearTimeout(bootTimer); App._bootedDemo = false; })
      .catch((err) => {
        booted = true;
        clearTimeout(bootTimer);
        if (App.candles.length) return;      // el temporizador ya cargó el DEMO
        App._bootedDemo = true;
        const modo = App.loadDemo(true);
        if (modo === 'snapshot') {
          U.log('📦 Sin internet: se usan las velas REALES guardadas en el archivo.', 'sys');
          U.toast('📦 Sin conexión: usando precios REALES guardados en el archivo', 'ok', 5500);
        } else {
          U.log('⚠️ No se pudieron descargar datos reales: ' + err.message + '. Se cargan datos DEMO.', 'warn');
          U.toast('Sin conexión con Binance: cargando datos de demostración', 'warn', 5000);
        }
        UI.hideLoader();
      });
  };

  /* ============================== CARGA DE DATOS ============================== */

  /** Lee el formulario superior y carga las velas necesarias. */
  App.loadDataFromForm = async function (opts = {}) {
    const pair = document.getElementById('pairSelect').value;
    const interval = document.getElementById('tfSelect').value;
    if (!DS.TIMEFRAMES[interval]) { U.toast('Temporalidad no válida', 'err'); return; }
    App.pair = pair; App.interval = interval;

    const tfSec = DS.TIMEFRAMES[interval].ms / 1000;
    const now = Math.floor(Date.now() / 1000);

    // Fecha de inicio: la del input o, si está vacía, ~1000 velas atrás
    let startTs = U.inputToTs(document.getElementById('startDate').value);
    if (!startTs) {
      startTs = now - Math.min(2000, 1200) * tfSec;
      document.getElementById('startDate').value = U.tsToInput(startTs);
    }
    startTs = Math.min(startTs, now - 3 * tfSec);   // debe quedar histórico por delante

    const wantStart = startTs - App.warmup * 2 * tfSec;
    let wantEnd = Math.min(now, startTs + 1500 * tfSec);

    // Presupuesto total de la operación (evita arranques eternos en previews
    // con red bloqueada): por defecto 25 s para cargas manuales.
    const budgetMs = opts.deadlineMs || 25000;
    const deadline = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + budgetMs;

    UI.showLoader('Comprobando caché local…');
    let cached = ST.loadCandles(pair, interval) || [];
    const covered = cached.length > 2 &&
      cached[0].time <= wantStart + tfSec &&
      cached[cached.length - 1].time >= wantEnd - 3 * tfSec;

    let candles = cached, source = 'caché local';

    if (!covered) {
      UI.setLoaderText('Descargando velas de Binance…');
      try {
        const res = await DS.load({
          symbol: pair, interval, startTs: wantStart, endTs: wantEnd,
          deadlineMs: deadline,
          onProgress: (n, total, msg) => UI.setLoaderText(`${msg} de ${total ? total.toLocaleString('es-ES') : '?'}`),
        });
        if (!res.candles.length) throw new Error('La API no devolvió velas');
        // Mezclar con la caché (por si aporta velas antiguas)
        const merged = DS.clean(cached.concat(res.candles));
        candles = merged.slice(-Math.max(MAX_CANDLES, 1));
        source = res.source;
        ST.saveCandles(pair, interval, candles);
      } catch (err) {
        if (cached.length) {
          U.log('⚠️ Falló la descarga, se usa la caché disponible: ' + err.message, 'warn');
          candles = cached; source = 'caché local';
        } else {
          UI.hideLoader();
          throw err;
        }
      }
    }

    // Si el usuario ya ha empezado a practicar con los datos DEMO, no le
    // sustituimos el escenario por la llegada tardía de datos reales.
    if (App._bootedDemo && opts.userDataGuard &&
        (TE.state.trades.length || DT.drawings.length || BR.isPlaying())) {
      UI.hideLoader();
      U.toast('✅ Datos reales disponibles: pulsa «Cargar datos» para usarlos', 'ok', 6000);
      return true;
    }

    UI.setLoaderText('Preparando replay…');
    App.useCandles(candles, { startTs, source });
    UI.hideLoader();

    if (!opts.silent) U.toast(`✅ ${candles.length.toLocaleString('es-ES')} velas cargadas desde ${source}`, 'ok');
    return true;
  };

  /** Modo práctica rápida: fecha aleatoria dentro del histórico disponible. */
  App.quickPractice = async function () {
    const tfSec = DS.TIMEFRAMES[document.getElementById('tfSelect').value].ms / 1000;
    const now = Math.floor(Date.now() / 1000);
    // Fecha aleatoria en los últimos ~3 años, con margen para dejar histórico futuro
    const rand = now - Math.floor((90 + Math.random() * 900) * 86400);
    const aligned = Math.floor(rand / tfSec) * tfSec + tfSec;
    document.getElementById('startDate').value = U.tsToInput(aligned);
    U.log('🎲 Práctica rápida: inicio aleatorio en ' + U.fmtDate(aligned) + ' UTC', 'sys');
    try {
      await App.loadDataFromForm();
      U.toast('🎲 Práctica rápida lista: ' + U.fmtDate(aligned) + ' UTC', 'ok', 3000);
    } catch (e) {
      U.toast('No se pudo cargar el rango aleatorio. Prueba el modo Demo.', 'err', 4000);
    }
  };

  /**
   * Carga de emergencia sin conexión. ORDEN:
   *   1) Velas REALES incrustadas en el archivo (instantánea) → si existen
   *   2) Datos sintéticos DEMO → si no hay instantánea para ese par/temporalidad
   * Devuelve 'snapshot' o 'demo' para que quien llame informe adecuadamente.
   */
  App.loadDemo = function (silent) {
    const snap = DS.loadSnapshot ? DS.loadSnapshot(App.pair, App.interval) : null;
    if (snap) {
      App._snapshot = true;
      const n = snap.candles.length;
      const startIndex = Math.max(App.warmup, Math.min(n - 20, Math.round(n * 0.35)));
      App.useCandles(snap.candles, { startIndex, source: snap.source });
      U.log(`📦 Velas REALES guardadas en el archivo: ${n} velas de ${App.pair} ${App.interval}` +
            (snap.savedAt ? ` (instantánea del ${snap.savedAt})` : ''), 'sys');
      if (!silent) {
        U.toast('📦 Sin conexión: usando precios REALES guardados en el archivo', 'ok', 5000);
        U.log('ℹ️ Para velas al día pulsa «Cargar datos» cuando tengas conexión.', 'sys');
      }
      return 'snapshot';
    }
    App._snapshot = false;
    const interval = document.getElementById('tfSelect').value;
    const tfMs = DS.TIMEFRAMES[interval].ms;
    const n = 3000;
    const now = Math.floor(Date.now() / 1000);
    const startTs = now - n * (tfMs / 1000);
    const candles = DS.synth({
      n, interval, startPrice: 42000 + Math.random() * 30000, seed: Math.floor(Math.random() * 1e9),
      startTs,
    });
    const startIndex = 300;
    App.useCandles(candles, { startIndex, source: 'datos DEMO (sintéticos)' });
    U.toast('🧪 Datos de demostración cargados (sintéticos, no son precios reales)', 'warn', 4200);
    if (!silent) {
      U.log('🧪 Datos DEMO generados: 3.000 velas sintéticas con caminata aleatoria', 'warn');
      const pares = DS.snapshotPairs ? DS.snapshotPairs() : [];
      if (pares.length) U.log('ℹ️ Este archivo trae velas reales guardadas para: ' + pares.join(' · '), 'sys');
    }
    return 'demo';
  };

  /** Importación desde CSV. */
  App.importCSV = function (text, filename) {
    const candles = DS.parseCSV(text);
    if (!candles.length) {
      U.toast('No se pudieron leer velas del CSV. Revisa el formato (fecha, open, high, low, close, volume).', 'err', 5000);
      return;
    }
    const startIndex = U.clamp(Math.floor(candles.length * 0.35), App.warmup, candles.length - 2);
    App.useCandles(candles, { startIndex, source: 'CSV ' + (filename || '') });
    U.toast(`📄 ${candles.length.toLocaleString('es-ES')} velas importadas de ${filename || 'CSV'}`, 'ok');
  };

  /**
   * Inicializa el gráfico y el replay con un conjunto de velas.
   * @param {Array} candles
   * @param {object} opts { startTs | startIndex, source }
   */
  App.useCandles = function (candles, opts = {}) {
    if (!candles || candles.length < 30) {
      U.toast('Se necesitan al menos 30 velas para practicar', 'err');
      return;
    }
    App.candles = candles;
    App.source = opts.source || '—';

    // 1) Datos en el gráfico
    CM.setCandleData(candles);

    // 2) Indicadores (cálculo causal → ningún dato del futuro afecta a los valores pasados)
    App.rebuildIndicatorData();

    // 3) Índice inicial del replay
    let startIndex;
    if (opts.startIndex !== undefined) {
      startIndex = opts.startIndex;
    } else {
      const startTs = opts.startTs;
      let idx = candles.findIndex((c) => c.time >= startTs);
      if (idx < 0) idx = candles.length - 2;
      startIndex = idx;
    }
    startIndex = U.clamp(startIndex, Math.min(App.warmup, candles.length - 2), candles.length - 2);

    // 4) Replay y cuenta
    BR.setData(candles, startIndex, App.interval);
    App.resetCheckpoints(startIndex);
    TE.state.lastPrice = candles[startIndex].close;
    TE.state.lastTime = candles[startIndex].time;
    TE.state.equitySeries = [{ t: candles[startIndex].time, value: TE.state.equity, time: candles[startIndex].time }];

    // 5) Render y UI
    CM.render(startIndex);
    DT.resize(); DT.render();
    CM.scrollToLast(160);
    UI.setPairLabels(App.pair, App.interval);
    UI.refreshAll();
    UI.refreshStats(true);
    UI.renderTrades();

    U.log(`📊 Datos listos: ${candles.length.toLocaleString('es-ES')} velas ${App.pair} ${App.interval} ` +
          `(${U.fmtDate(candles[0].time)} → ${U.fmtDate(candles[candles.length - 1].time)} UTC) · ` +
          `fuente: ${App.source}`, 'sys');
    U.log(`🔒 Replay situado en ${U.fmtDate(candles[startIndex].time)} UTC. ` +
          `${BR.hiddenCount().toLocaleString('es-ES')} velas ocultas al frente.`, 'sys');
  };

  /* ============================== INDICADORES ============================== */

  /** Recalcula los arrays de indicadores para TODA la serie cargada. */
  App.rebuildIndicatorData = function () {
    const c = App.candles;
    const cfg = App.indicators;
    const data = {};
    if (!c.length) { CM.setIndicatorData({}, cfg); return; }
    if (cfg.sma.on) data.sma = IND.sma(c, cfg.sma.p);
    if (cfg.ema.on) data.ema = IND.ema(c, cfg.ema.p);
    if (cfg.ema2.on) data.ema2 = IND.ema(c, cfg.ema2.p);
    if (cfg.bb.on) data.bb = IND.bollinger(c, cfg.bb.p, cfg.bb.k);
    if (cfg.rsi.on) data.rsi = IND.rsi(c, cfg.rsi.p);
    if (cfg.macd.on) data.macd = IND.macd(c, cfg.macd.f, cfg.macd.s, cfg.macd.sig);
    if (cfg.atr.on) data.atr = IND.atr(c, cfg.atr.p);
    CM.setIndicatorData(data, cfg);
    CM.applyPaneVisibility(cfg);
  };

  /** Aplica una nueva configuración de indicadores. */
  App.applyIndicators = function (cfg, silent) {
    App.indicators = cfg;
    ST.set(LS_IND, cfg);
    App.rebuildIndicatorData();
    UI.syncIndicatorModalFromConfig(cfg);
    CM.refresh(BR.getIndex());     // reconstruye hasta la vela actual del replay
    DT.render();
    UI.renderPanels && UI.renderPanels();   // la lista de paneles refleja el cambio al instante
    if (!silent) {
      const on = Object.keys(cfg).filter((k) => cfg[k].on);
      U.log('📈 Indicadores activos: ' + (on.length ? on.join(', ').toUpperCase() : 'ninguno'), 'sys');
      U.toast('Indicadores actualizados', 'ok', 1800);
    }
  };

  /* ============================== BAR REPLAY ============================== */

  App.togglePlay = function () { BR.togglePlay(); };

  App.stepForward = function () {
    if (!App.candles.length) { U.toast('Carga datos primero', 'warn'); return; }
    BR.stepForward();
  };

  App.stepBack = function () {
    if (!BR.total()) return;
    BR.stepBack(1);
  };

  App.resetReplay = function () {
    if (!BR.total()) return;
    App.restoreTo(BR.getStartIndex());
  };

  App.goToEnd = function () {
    if (!BR.total()) return;
    const from = BR.getIndex(), to = BR.total() - 1;
    if (to === from) { U.toast('Ya estás en la última vela', 'info'); return; }
    BR.pause();
    BR.state.index = to;
    App.onAdvance(from, to, true);
  };

  App.setSpeed = function (s) {
    BR.setSpeed(s);
    UI.refreshReplayBar();
  };

  App.bumpSpeed = function (dir) {
    BR.speedUp(dir);
    UI.refreshReplayBar();
    U.toast('Velocidad ' + BR.speedLabel(), 'info', 1200);
  };

  App.seekFromSlider = function (frac) {
    const target = Math.round(frac * (BR.total() - 1));
    App.seekTo(target);
  };

  /** Salta a un índice concreto, simulando o rebobinando según la dirección. */
  App.seekTo = function (target) {
    if (!BR.total()) return;
    const cur = BR.getIndex();
    target = U.clamp(target, BR.getStartIndex(), BR.total() - 1);
    if (target === cur) return;
    if (target > cur) {
      BR.state.index = target;
      App.onAdvance(cur, target, true);
    } else {
      App.restoreTo(target);
    }
  };

  /**
   * AVANCE del replay: procesa las velas nuevas una a una (SL/TP, liquidación,
   * equity) y deja un checkpoint por vela para poder retroceder.
   */
  App.onAdvance = function (from, to, isSeek) {
    const candles = App.candles;
    TE.beginBatch();
    for (let i = from + 1; i <= to; i++) {
      TE.onCandle(candles[i]);
      App.checkpoints[i] = App.snapshot(i);
    }
    TE.endBatch();

    CM.render(to);
    App.refreshOrderLines();
    UI.refreshAll();
    UI.refreshStats(false);
    if (App.autoReveal && !isSeek) App.followLast();
  };

  /** RETROCESO / salto hacia atrás: reconstruye el estado desde el checkpoint. */
  App.onSeek = function (index) { App.restoreTo(index); };

  App.restoreTo = function (index) {
    const cp = App.checkpoints[index];
    BR.pause();
    BR.state.index = index;

    if (cp) {
      TE.restoreFromCheckpoint(cp);
    } else {
      // Sin checkpoint (índice anterior al inicio del replay): estado inicial
      App.resetCheckpoints(index);
      const c = App.candles[index];
      TE.state.lastPrice = c ? c.close : null;
      TE.state.lastTime = c ? c.time : null;
    }

    CM.render(index);
    DT.render();
    App.refreshOrderLines();
    UI.refreshAll();
    UI.refreshStats(true);
    UI.renderTrades();
    U.log(`⏪ Replay en ${U.fmtDate(App.candles[index].time)} UTC (vela ${index + 1})`, 'sys');
  };

  /** Mantiene visible la última vela revelada al avanzar. */
  App.followLast = function () {
    try {
      const ts = CM.main.timeScale();
      const vr = ts.getVisibleLogicalRange();
      const idx = BR.getIndex();
      if (!vr) { CM.scrollToLast(160); return; }
      if (vr.to - idx < 2) {
        const span = Math.max(20, vr.to - vr.from);
        ts.setVisibleLogicalRange({ from: idx + 8 - span, to: idx + 8 });
      }
    } catch (e) {}
  };

  /* ============================== CHECKPOINTS ============================== */

  /** Estado serializable de la cuenta en el índice `i`. */
  App.snapshot = function (i) {
    const s = TE.state;
    return {
      bal: s.balance,
      eq: s.equity,
      fees: s.feesPaid,
      seq: s.seq,
      tradesLen: s.trades.length,
      eqLen: s.equitySeries.length,
      hasPos: !!s.position,
      pos: s.position ? JSON.parse(JSON.stringify(s.position)) : null,
      pending: JSON.parse(JSON.stringify(s.pending || [])),
      lastPrice: s.lastPrice,
      lastTime: s.lastTime,
    };
  };

  /** Rellena los checkpoints del tramo "contexto" (antes de operar). */
  App.resetCheckpoints = function (startIndex) {
    const base = App.snapshot(0);
    App.checkpoints = [];
    for (let i = 0; i <= startIndex; i++) App.checkpoints[i] = Object.assign({}, base);
  };

  /* ============================== TRADING ============================== */

  App.currentPrice = function () {
    const c = BR.currentCandle();
    return c ? c.close : null;
  };

  App.currentTime = function () {
    const c = BR.currentCandle();
    return c ? c.time : null;
  };

  App.baseAsset = function () { return (App.pair || '').replace(/USDT$|BUSD$|USDC$/, '') || 'BTC'; };

  /** Calcula el tamaño de la orden a partir del formulario. */
  App.estimateSize = function (price) {
    const v = parseFloat(document.getElementById('sizeInput').value) || 0;
    const lev = TE.state.leverage;
    let notional = 0;
    if (App.sizeMode === 'pct') notional = TE.state.balance * (v / 100) * lev;
    else if (App.sizeMode === 'notional') notional = v;
    else notional = v * (price || 0);
    const qty = price ? notional / price : 0;
    return { notional, qty, margin: notional / lev };
  };

  /**
   * Abre una posición. Las casillas de SL/TP se interpretan como NIVELES
   * de precio; la dirección decide hacia qué lado se colocan.
   */
  App.placeOrder = function (side) {
    if (!App.candles.length) { U.toast('Carga datos antes de operar', 'warn'); return; }
    if (App.orderType === 'limite') return App.placeLimitOrder(side);

    const price = App.currentPrice();
    if (!price) { U.toast('No hay vela actual', 'err'); return; }

    const sizeVal = parseFloat(document.getElementById('sizeInput').value) || 0;
    if (sizeVal <= 0) { U.toast('Define un tamaño de posición mayor que 0', 'err'); return; }
    if (App.sizeMode === 'pct' && sizeVal > 100) { U.toast('El tamaño en % no puede superar el 100% del equity (usa apalancamiento)', 'warn'); }

    // SL / TP: de nivel introducido → distancia → nivel según la dirección
    const dir = side === 'long' ? 1 : -1;
    const slIn = parseFloat(document.getElementById('slInput').value);
    const tpIn = parseFloat(document.getElementById('tpInput').value);
    const slDist = Number.isFinite(slIn) && slIn > 0 ? Math.abs(price - slIn) / price : null;
    const tpDist = Number.isFinite(tpIn) && tpIn > 0 ? Math.abs(tpIn - price) / price : null;
    const sl = slDist !== null ? price * (1 - dir * slDist) : null;
    const tp = tpDist !== null ? price * (1 + dir * tpDist) : null;

    const pos = TE.openPosition(side, {
      mode: App.sizeMode,
      size: sizeVal,
      entryPrice: price,
      sl, tp,
      leverage: TE.state.leverage,
      feePct: TE.state.feePct,
      time: App.currentTime(),
    });

    if (pos) {
      App.refreshOrderLines();
      DT.setTradeHandles(pos);
      UI.refreshAll();
      UI.refreshStats(true);
      U.toast(`${side === 'long' ? '🟢 LONG' : '🔴 SHORT'} abierto a ${U.fmtPrice(price)}`, side === 'long' ? 'ok' : 'err', 2200);
    }
  };

  /**
   * Coloca una ORDEN LÍMITE: queda en espera y se ejecuta sola cuando el
   * precio del replay alcance el nivel indicado.
   * El precio se toma del campo «Precio límite» (se puede arrastrar en el
   * gráfico). El tamaño, apalancamiento, comisión y SL/TP son los mismos
   * campos del panel de orden.
   */
  App.placeLimitOrder = function (side) {
    if (!App.candles.length) { U.toast('Carga datos antes de operar', 'warn'); return null; }
    const ref = App.currentPrice();
    if (!ref) { U.toast('No hay vela actual', 'err'); return null; }

    const el = document.getElementById('limitInput');
    let limite = el ? parseFloat(el.value) : NaN;
    if (!Number.isFinite(limite) || limite <= 0) {
      // Sin precio escrito: se propone un 0,5% por debajo/encima del actual
      limite = side === 'long' ? ref * 0.995 : ref * 1.005;
      if (el) el.value = limite.toFixed(2);
      U.toast('Sin precio límite: se propone ' + U.fmtPrice(limite) + ' (puedes cambiarlo)', 'info', 3600);
    }

    const sizeVal = parseFloat(document.getElementById('sizeInput').value) || 0;
    if (sizeVal <= 0) { U.toast('Define un tamaño de posición mayor que 0', 'err'); return null; }

    // SL / TP: los campos son NIVELES de precio (opcionales)
    const slIn = parseFloat(document.getElementById('slInput').value);
    const tpIn = parseFloat(document.getElementById('tpInput').value);
    const sl = Number.isFinite(slIn) && slIn > 0 ? slIn : null;
    const tp = Number.isFinite(tpIn) && tpIn > 0 ? tpIn : null;

    const orden = TE.placeLimit(side, {
      limitPrice: limite,
      mode: App.sizeMode,
      size: sizeVal,
      sl, tp,
      leverage: TE.state.leverage,
      feePct: TE.state.feePct,
      refPrice: ref,
      time: App.currentTime(),
    });

    App.checkpoints[BR.getIndex()] = App.snapshot(BR.getIndex());
    App.refreshOrderLines();
    UI.refreshAll();
    if (orden) {
      U.toast(`⏳ Orden límite ${side === 'long' ? 'de compra' : 'de venta'} a ${U.fmtPrice(limite)}`, 'ok', 2600);
    }
    return orden;
  };

  /** Redibuja las líneas de las órdenes límite pendientes. */
  App.refreshOrderLines = function () {
    CM.setPendingLines(TE.state.pending || []);
    CM.setPositionLines(TE.state.position);
  };

  /** Cancela una orden límite concreta. */
  App.cancelOrder = function (id) {
    if (!TE.cancelOrder(id)) return;
    App.checkpoints[BR.getIndex()] = App.snapshot(BR.getIndex());
    App.refreshOrderLines();
    UI.refreshAll();
  };

  /** Cancela todas las órdenes límite pendientes. */
  App.cancelAllOrders = function () {
    const n = TE.cancelAllOrders();
    if (!n) return;
    App.checkpoints[BR.getIndex()] = App.snapshot(BR.getIndex());
    App.refreshOrderLines();
    UI.refreshAll();
  };

  /** Cierra la posición abierta al precio actual. */
  App.flatten = function () {
    if (!TE.state.position) { U.toast('No hay ninguna posición abierta', 'warn', 1500); return; }
    const price = App.currentPrice();
    TE.closePosition(price, 'manual', App.currentTime());
    App.checkpoints[BR.getIndex()] = App.snapshot(BR.getIndex());
    App.refreshOrderLines();
    DT.setTradeHandles(null);
    UI.refreshAll();
    UI.refreshStats(true);
    U.toast('Posición cerrada manualmente', 'info', 2000);
  };

  /** Reinicia estadísticas, historial y cuenta (mantiene replay y dibujos). */
  App.resetStats = function () {
    TE.resetAccount(TE.state.initialCapital);
    App.checkpoints = App.checkpoints.map(() => App.snapshot(0));
    for (let i = 0; i <= BR.getIndex(); i++) App.checkpoints[i] = App.snapshot(0);
    CM.clearPositionLines();
    App.refreshOrderLines();
    DT.setTradeHandles(null);
    UI.refreshAll();
    UI.refreshStats(true);
    UI.renderTrades();
    U.log('↺ Estadísticas y cuenta reiniciadas al capital inicial', 'warn');
    U.toast('Estadísticas reiniciadas', 'ok');
  };

  /* ============================== AJUSTES ============================== */

  App.applySettings = function () {
    const capital = parseFloat(document.getElementById('setCapital').value);
    const fee = parseFloat(document.getElementById('setFee').value);
    const lev = parseInt(document.getElementById('setLeverage').value, 10);
    const warmup = parseInt(document.getElementById('setWarmup').value, 10);
    const funding = parseFloat(document.getElementById('setFunding').value);
    const slFirst = document.getElementById('setSlFirst').value;
    const sound = document.getElementById('setSound').checked;
    const autoReveal = document.getElementById('setAutoReveal').checked;

    const capitalChanged = Number.isFinite(capital) && capital !== TE.state.initialCapital;
    if (capitalChanged) {
      TE.resetAccount(capital);
      App.checkpoints = App.checkpoints.map(() => App.snapshot(0));
      U.log(`💰 Capital inicial fijado en ${U.fmtMoney(capital)} (cuenta reiniciada)`, 'sys');
    }
    TE.configure({
      initialCapital: Number.isFinite(capital) ? capital : TE.state.initialCapital,
      feePct: Number.isFinite(fee) ? fee : TE.state.feePct,
      leverage: Number.isFinite(lev) ? lev : TE.state.leverage,
      fundingPct: Number.isFinite(funding) ? funding : TE.state.fundingPct,
      slFirst,
    });
    App.warmup = Number.isFinite(warmup) ? U.clamp(warmup, 0, 2000) : App.warmup;
    App.autoReveal = autoReveal;
    U.sound.enabled = sound;

    document.getElementById('leverageSelect').value = TE.state.leverage;
    document.getElementById('feeInput').value = TE.state.feePct;

    ST.setSettings({
      capital: TE.state.initialCapital, fee: TE.state.feePct, leverage: TE.state.leverage,
      warmup: App.warmup, funding: TE.state.fundingPct, slFirst, sound, autoReveal,
      pair: App.pair, interval: App.interval, sizeMode: App.sizeMode,
      sizeValue: parseFloat(document.getElementById('sizeInput').value) || 100,
    });

    UI.closeModal('modalSettings');
    UI.refreshAll();
    UI.refreshStats(true);
    U.log(`⚙️ Ajustes aplicados: comisión ${TE.state.feePct}% · ${TE.state.leverage}x · ` +
          `warmup ${App.warmup} velas · SL/TP mismo candle: ${slFirst === 'worst' ? 'pesimista' : 'optimista'}`, 'sys');
    U.toast('Ajustes guardados', 'ok');
  };

  /** Reset completo de la sesión. */
  App.hardReset = function () {
    TE.resetAccount(TE.state.initialCapital);
    DT.clearAll(true);
    BR.reset();
    App.resetCheckpoints(BR.getStartIndex());
    CM.clearPositionLines();
    DT.setTradeHandles(null);
    UI.refreshAll();
    UI.refreshStats(true);
    UI.renderTrades();
    UI.renderSessions();
    U.log('🧨 Sesión reiniciada por completo', 'warn');
    U.toast('Sesión reiniciada', 'ok');
  };

  /* ============================== SESIONES ============================== */

  App.saveSession = function (name) {
    if (!App.candles.length) { U.toast('No hay datos cargados que guardar', 'warn'); return null; }
    const data = {
      meta: {
        pair: App.pair, interval: App.interval, source: App.source,
        candles: App.candles.length,
        firstTime: App.candles[0].time, lastTime: App.candles[App.candles.length - 1].time,
        trades: TE.state.trades.filter((t) => t.status === 'closed').length,
        balance: TE.state.balance,
      },
      config: { warmup: App.warmup, sizeMode: App.sizeMode, sizeValue: parseFloat(document.getElementById('sizeInput').value) || 100 },
      replay: BR.serialize(),
      indicators: App.indicators,
      drawings: DT.serialize(),
      trading: TE.serialize(),
      stats: UI.lastStats ? {
        totalPnl: UI.lastStats.totalPnl, winRate: UI.lastStats.winRate,
        profitFactor: UI.lastStats.profitFactor, maxDD: UI.lastStats.maxDD,
      } : null,
    };
    const key = ST.saveSession(name, data);
    if (key) {
      U.toast(`💾 Sesión «${U.esc(name)}» guardada`, 'ok');
    } else {
      // Ocurre en visores embebidos donde localStorage está bloqueado
      U.log('⚠️ No se pudo guardar la sesión: el almacenamiento local no está disponible aquí', 'warn');
      U.toast('Este visor no permite guardar en el navegador. Abre el archivo en una pestaña normal para conservar sesiones.', 'warn', 6000);
    }
    return key;
  };

  App.loadSession = async function (key) {
    const s = ST.loadSession(key);
    if (!s) { U.toast('No se pudo cargar la sesión', 'err'); return; }
    UI.closeModal('modalSessions');
    UI.showLoader('Restaurando sesión…');

    App.pair = s.meta.pair; App.interval = s.meta.interval;
    document.getElementById('pairSelect').value = App.pair;
    document.getElementById('tfSelect').value = App.interval;

    // 1) Datos: de la caché; si no hay, se descargan
    let candles = ST.loadCandles(App.pair, App.interval);
    if (!candles || candles.length < 30) {
      document.getElementById('startDate').value = U.tsToInput(Math.max(0, s.meta.firstTime + 300 * (DS.TIMEFRAMES[App.interval].ms / 1000)));
      try { await App.loadDataFromForm({ silent: true }); candles = App.candles; }
      catch (e) { candles = null; }
    }
    if (!candles || candles.length < 30) {
      UI.hideLoader();
      U.toast('No hay datos disponibles para esta sesión. Carga el par de nuevo.', 'err', 4500);
      return;
    }

    // 2) Reconstruir el estado guardado
    App.candles = DS.clean(candles);
    CM.setCandleData(App.candles);
    App.indicators = s.indicators || App.indicators;
    ST.set(LS_IND, App.indicators);
    App.rebuildIndicatorData();

    // La sesión guardada puede tener menos velas que la caché actual
    const replay = s.replay;
    const maxIdx = App.candles.length - 1;
    const startIndex = U.clamp(replay.startIndex || App.warmup, 0, maxIdx - 1);
    const index = U.clamp(replay.index || startIndex, startIndex, maxIdx);
    BR.setData(App.candles, startIndex, App.interval);
    BR.state.index = index;
    if (replay.speed) BR.setSpeed(replay.speed);

    // 3) Trading
    if (s.trading) TE.restore(s.trading);
    // Rehacer checkpoints: los índices previos al inicio valen el estado restaurado
    App.resetCheckpoints(startIndex);
    const base = App.snapshot(index);
    for (let i = 0; i <= index; i++) App.checkpoints[i] = Object.assign({}, base);

    // 4) Dibujos y UI
    DT.restore(s.drawings || []);
    CM.render(index);
    CM.scrollToLast(160);
    DT.render();
    UI.syncIndicatorModalFromConfig(App.indicators);
    UI.setPairLabels(App.pair, App.interval);
    UI.refreshAll();
    UI.refreshStats(true);
    UI.renderTrades();
    UI.hideLoader();
    U.log(`📂 Sesión «${s.name}» restaurada (vela ${index + 1}/${App.candles.length})`, 'sys');
    U.toast(`Sesión «${U.esc(s.name)}» restaurada`, 'ok');
  };

  /* ============================== EXPORTACIONES ============================== */

  App.exportTrades = function () {
    const trades = TE.state.trades.filter((t) => t.status === 'closed');
    if (!trades.length) { U.toast('No hay trades cerrados que exportar', 'warn'); return; }
    U.download(`bar-replay-trades-${App.pair}-${App.interval}-${Date.now()}.csv`,
               STATS.tradesToCSV(trades, App.pair, App.interval), 'text/csv;charset=utf-8');
    U.toast('📄 Historial exportado a CSV', 'ok');
  };

  App.exportEquity = function () {
    U.download(`bar-replay-equity-${App.pair}-${Date.now()}.csv`,
               STATS.equityToCSV(TE.state.equitySeries), 'text/csv;charset=utf-8');
    U.toast('📈 Curva de capital exportada', 'ok');
  };

  App.exportCandles = function () {
    const c = CM.getVisibleCandles();
    if (!c.length) { U.toast('No hay velas que exportar', 'warn'); return; }
    U.download(`bar-replay-velas-${App.pair}-${App.interval}-${Date.now()}.csv`,
               STATS.candlesToCSV(c), 'text/csv;charset=utf-8');
    U.toast(`🕯️ ${c.length} velas visibles exportadas`, 'ok');
  };

  App.sessionJSON = function () {
    return JSON.stringify({
      app: 'Bar Replay Pro', exportedAt: new Date().toISOString(),
      pair: App.pair, interval: App.interval, source: App.source,
      config: { warmup: App.warmup, initialCapital: TE.state.initialCapital, feePct: TE.state.feePct, leverage: TE.state.leverage, slFirst: TE.state.slFirst },
      replay: BR.serialize(),
      indicators: App.indicators,
      drawings: DT.serialize(),
      trading: TE.serialize(),
      stats: UI.lastStats || null,
    }, null, 2);
  };

  App.exportJSON = function () {
    U.download(`bar-replay-sesion-${App.pair}-${Date.now()}.json`, App.sessionJSON(), 'application/json');
    U.toast('🧾 Sesión exportada a JSON', 'ok');
  };

  /** Informe HTML imprimible (permite «Guardar como PDF»). */
  App.exportReport = function () {
    const s = UI.lastStats || STATS.compute(TE.state.trades, TE.state.equitySeries, TE.state.initialCapital);
    const rows = STATS.summaryLines(s, TE.state.initialCapital, TE.state.equity);
    const trades = TE.state.trades.filter((t) => t.status === 'closed');
    const tradeRows = trades.map((t, i) => `<tr class="${t.pnl >= 0 ? 'win' : 'loss'}">
        <td>${i + 1}</td><td>${t.side.toUpperCase()}</td>
        <td>${U.fmtDate(t.entryTime)}</td><td>${U.fmtDate(t.exitTime)}</td>
        <td>${U.fmtPrice(t.entryPrice)}</td><td>${U.fmtPrice(t.exitPrice)}</td>
        <td>${U.num(t.qty, 5)}</td><td>${U.fmtMoney(t.pnl, true)}</td>
        <td>${U.fmtPct(t.pnlPct, 2, true)}</td><td>${t.rMultiple !== null ? U.num(t.rMultiple, 2) : '—'}</td>
        <td>${TE.reasonLabel(t.reason)}</td></tr>`).join('');

    let shot = '';
    try { shot = UI.composeScreenshot().toDataURL('image/png'); } catch (e) {}

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Informe de backtest — ${App.pair} ${App.interval}</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#fff;color:#111;margin:28px;}
  h1{font-size:20px;margin:0 0 4px;} h2{font-size:14px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.7px;color:#444;border-bottom:1px solid #ddd;padding-bottom:4px;}
  .sub{color:#666;font-size:12px;margin-bottom:16px;}
  table{border-collapse:collapse;width:100%;font-size:11.5px;font-family:ui-monospace,monospace;}
  th,td{border:1px solid #e2e2e2;padding:4px 7px;text-align:left;}
  th{background:#f4f5f8;font-family:system-ui;font-size:10px;text-transform:uppercase;letter-spacing:.5px;}
  td.num,th.num{text-align:right;}
  tr.win td:nth-child(8){color:#0a7d3c;} tr.loss td:nth-child(8){color:#c31138;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 26px;}
  .kv{display:flex;justify-content:space-between;border-bottom:1px dashed #e4e4e4;padding:3px 0;font-size:12px;}
  .kv b{font-family:ui-monospace,monospace;}
  img{max-width:100%;border:1px solid #ddd;border-radius:6px;margin-top:8px;}
  @media print{body{margin:10mm;} .noprint{display:none;}}
</style></head><body>
<h1>Informe de backtest — Bar Replay Pro</h1>
<div class="sub">${DS.PAIRS[App.pair] || App.pair} · ${App.interval} · datos: ${App.source} ·
${U.fmtDate(App.candles[0] && App.candles[0].time)} → ${U.fmtDate(BR.currentCandle() && BR.currentCandle().time)} (UTC) ·
generado el ${new Date().toLocaleString('es-ES')}</div>
<button class="noprint" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
<h2>Métricas</h2><div class="grid">
${rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('')}
</div>
<h2>Curva de capital y gráfico</h2>${shot ? `<img src="${shot}" alt="Captura del gráfico">` : '<p>Sin captura disponible.</p>'}
<h2>Historial de trades (${trades.length})</h2>
<table><thead><tr><th>#</th><th>Dir</th><th>Entrada (UTC)</th><th>Salida (UTC)</th><th>P. entrada</th>
<th>P. salida</th><th>Tamaño</th><th>PnL</th><th>%</th><th>R</th><th>Motivo</th></tr></thead>
<tbody>${tradeRows || '<tr><td colspan="11">Sin trades cerrados</td></tr>'}</tbody></table>
<p class="sub" style="margin-top:24px">Generado por Bar Replay Pro · Toda la simulación es educativa y no constituye asesoramiento financiero.</p>
</body></html>`;

    const w = global.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); U.toast('🖨️ Informe abierto en una pestaña nueva', 'ok', 4000); }
    else {
      U.download(`informe-backtest-${App.pair}-${Date.now()}.html`, html, 'text/html;charset=utf-8');
      U.toast('🖨️ Informe descargado (permite «Imprimir → Guardar como PDF»)', 'ok', 4200);
    }
  };

  /** Captura de pantalla del gráfico. */
  App.screenshot = function () {
    if (!App.candles.length) { U.toast('Carga datos para poder capturar el gráfico', 'warn'); return; }
    const cv = UI.composeScreenshot();
    const url = cv.toDataURL('image/png');
    const img = document.getElementById('shotImg');
    img.src = url;
    document.getElementById('shotDownload').href = url;
    document.getElementById('shotDownload').download = `bar-replay-${App.pair}-${U.fmtDate(App.currentTime() || 0).replace(/[: ]/g, '')}.png`;
    UI.openModal('modalShot');
    U.toast('🖼️ Captura generada', 'ok', 1800);
  };

  /* ================================ ARRANQUE ================================ */

  /* ---------------------------------------------------------------------------
   * DIAGNÓSTICO VISIBLE
   * Si algo falla al arrancar (o más tarde), NUNCA se queda una pantalla muda:
   * se muestra un aviso con el mensaje exacto del error y un bloque de
   * diagnóstico que se puede copiar. Es lo primero que hay que mirar si la app
   * "da error" dentro de un visor embebido.
   * ------------------------------------------------------------------------- */

  /** Recoge datos del entorno para poder diagnosticar sin abrir la consola. */
  App.diagnostics = function () {
    const mods = ['U', 'IND', 'DS', 'ST', 'STATS', 'TE', 'BR', 'CM', 'DT', 'UI', 'App'];
    const faltan = mods.filter((k) => typeof global[k] === 'undefined');
    const lib = typeof global.LightweightCharts === 'undefined' ? 'NO (falta la librería)' : 'sí';
    let alma = 'disponible';
    try { global.localStorage.setItem('_brp_t', '1'); global.localStorage.removeItem('_brp_t'); }
    catch (e) { alma = 'bloqueado (' + e.name + ')'; }
    return {
      'URL': location.href,
      'Origen': location.origin === 'null' ? 'opaco (iframe sandbox)' : location.origin,
      'Dentro de iframe': (function () { try { return window.self !== window.top ? 'sí' : 'no'; } catch (e) { return 'sí (sin acceso al padre)'; } })(),
      'Contexto seguro': String(global.isSecureContext),
      'document.readyState': document.readyState,
      'Módulos JS': faltan.length ? 'FALTAN: ' + faltan.join(', ') : 'los ' + mods.length + ' cargados',
      'Lightweight Charts': lib,
      'Almacenamiento': alma,
      'fetch disponible': typeof global.fetch,
      'Ventana': window.innerWidth + ' × ' + window.innerHeight,
      'devicePixelRatio': String(global.devicePixelRatio),
      'Canvas 2D': (function () { try { return document.createElement('canvas').getContext('2d') ? 'sí' : 'no'; } catch (e) { return 'no (' + e.name + ')'; } })(),
      'Navegador': navigator.userAgent,
    };
  };

  let _avisoMostrado = false;

  /** Muestra un aviso visible con el error y el diagnóstico (solo el primero). */
  App.showFatal = function (titulo, err) {
    if (_avisoMostrado) return;
    _avisoMostrado = true;
    try { console.error(titulo, err || ''); } catch (e) {}
    const detalle = err ? (err.stack || err.message || String(err)) : '(sin detalle)';
    const diag = App.diagnostics();
    const filas = Object.keys(diag)
      .map((k) => '<tr><td style="color:#8b93b0;padding:1px 10px 1px 0;white-space:nowrap">' + k + '</td><td style="color:#e6e9f5;word-break:break-all">' + U.esc(String(diag[k])) + '</td></tr>')
      .join('');
    const info = 'Bar Replay Pro — informe de error\n\n' + titulo + '\n' + detalle + '\n\n' +
      Object.keys(diag).map((k) => k + ': ' + diag[k]).join('\n');
    const html =
      '<div id="brpFatal" style="position:fixed;left:0;right:0;bottom:0;max-height:46vh;overflow:auto;z-index:99999;' +
      'background:#2a1020;border-top:2px solid #ff1744;color:#fff;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;' +
      'box-shadow:0 -8px 30px rgba(0,0,0,.6)">' +
        '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:#3a1220;flex-wrap:wrap">' +
          '<strong style="color:#ff8a9c">⚠ ' + U.esc(titulo) + '</strong>' +
          '<span style="color:#ffd0d8;flex:1 1 240px;min-width:180px;word-break:break-word">' + U.esc(detalle.split('\n')[0]) + '</span>' +
          '<button id="brpFatalCopy" style="cursor:pointer;background:#00c853;border:0;color:#06210f;font-weight:700;padding:5px 12px;border-radius:5px;font-size:11px">Copiar informe</button>' +
          '<button id="brpFatalHide" style="cursor:pointer;background:#1a1a2e;border:1px solid #3a3f5c;color:#cfd4ea;padding:5px 10px;border-radius:5px;font-size:11px">Ocultar</button>' +
        '</div>' +
        '<div style="padding:8px 12px 14px"><table style="border-collapse:collapse;font-size:11px">' + filas + '</table>' +
          '<div style="margin-top:8px;color:#8b93b0;font-size:10.5px">Copia este informe y pégalo en el chat: con él se localiza el fallo al instante.</div></div>' +
      '</div>';
    try {
      const cont = document.body || document.documentElement;
      cont.insertAdjacentHTML('beforeend', html);
      const ta = document.createElement('textarea');
      ta.value = info; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      cont.appendChild(ta);
      const cp = document.getElementById('brpFatalCopy');
      cp.addEventListener('click', () => {
        let ok = false;
        try { ta.select(); ok = document.execCommand('copy'); } catch (e) {}
        if (!ok && navigator.clipboard) { try { navigator.clipboard.writeText(info); ok = true; } catch (e) {} }
        cp.textContent = ok ? '¡Copiado!' : 'Selecciona y copia';
        if (!ok) { ta.style.cssText = 'position:fixed;left:8px;bottom:8px;width:80%;height:60px;z-index:100000'; }
      });
      document.getElementById('brpFatalHide').addEventListener('click', () => {
        const n = document.getElementById('brpFatal'); if (n) n.style.display = 'none';
        _avisoMostrado = false;   // permite volver a mostrarlo si hay otro fallo
      });
    } catch (e) {
      document.body && (document.body.innerHTML = '<pre style="color:#ff1744;padding:14px">' + U.esc(titulo + '\n' + detalle) + '</pre>');
    }
  };

  // Cualquier error no controlado también se hace visible (una sola vez).
  global.addEventListener('error', (e) => {
    if (e && (e.message || e.error)) App.showFatal('Error de JavaScript', e.error || e.message);
  });
  global.addEventListener('unhandledrejection', (e) => {
    App.showFatal('Promesa rechazada sin capturar', (e && e.reason) || '');
  });

  /** Arranca la app, informando de cualquier fallo. */
  function arrancar() {
    try {
      App.init();
    } catch (e) {
      App.showFatal('Error al iniciar la aplicación', e);
    }
  }

  // Algunos visores inyectan el HTML ya cargado (readyState !== 'loading'): en ese
  // caso DOMContentLoaded no volvería a dispararse y la app se quedaría muda.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }

  /* ---------------------------------------------------------------------------
   * VIGILANTE DE ARRANQUE
   * Si 5 s después de cargar el módulo la app no ha arrancado, mostramos el
   * motivo en vez de dejar la pantalla en blanco.
   * ------------------------------------------------------------------------- */
  setTimeout(() => {
    if (global.__BRP_OK__) return;
    const aviso = document.getElementById('brpNoJS');
    const diag = App.diagnostics();
    const lista = Object.keys(diag).map((k) => '· ' + k + ': ' + diag[k]).join('\n');
    if (aviso) {
      const info = document.getElementById('brpNoJSInfo');
      if (info) info.textContent = 'La app no ha arrancado. Diagnóstico:\n' + lista;
    } else {
      const err = new Error('App.init() no se ha ejecutado 5 s después de cargar los módulos');
      err.stack = 'La app no ha arrancado. Diagnóstico:\n' + lista;
      App.showFatal('La aplicación no ha arrancado', err);
    }
  }, 5000);

  global.App = App;
})(window);
