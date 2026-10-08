/* =========================================================================
 * uiController.js — Todo el cableado de la interfaz:
 *   · Eventos de la barra superior, paneles, modales y atajos de teclado
 *   · Refresco de la barra lateral (cuenta, posición, estadísticas)
 *   · Tabla de trades, log, lista de dibujos, sesiones y exportaciones
 *   · Captura de pantalla compuesta y modales
 * Las acciones que implican lógica de negocio se delegan en `App`.
 * =======================================================================*/
(function (global) {
  'use strict';

  const UI = {};

  /* ------------------------- Utilidades de formulario ------------------------- */

  const val = (id) => { const e = document.getElementById(id); return e ? e.value : null; };
  const numv = (id, d = 0) => { const v = parseFloat(val(id)); return Number.isFinite(v) ? v : d; };
  const setText = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  const setPnl = (id, value) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.textContent = typeof value === 'string' ? value : U.fmtMoney(value, true);
    e.classList.toggle('up', typeof value === 'number' ? value > 0 : false);
    e.classList.toggle('down', typeof value === 'number' ? value < 0 : false);
  };

  /* ================================= INICIO ================================= */

  UI.init = function () {
    UI._wireTopbar();
    UI._wireToolbar();
    UI._wireReplay();
    UI._wireSidebar();
    UI._wireBottom();
    UI._wireModals();
    UI._wireKeyboard();
    UI._wireEvents();

    // Estado inicial de los paneles y modales
    UI.syncIndicatorModalFromConfig(App.indicators);
    UI.setPlaying(false);
    UI._closedCount = 0;
    UI.refreshAll();
    UI.refreshStats(true);
    UI.renderSessions();
    DT.renderList(document.getElementById('drawList'));
  };

  /* -------------------------------- Barra superior -------------------------------- */

  UI._wireTopbar = function () {
    document.getElementById('btnLoad').addEventListener('click', () => App.loadDataFromForm());
    document.getElementById('btnQuick').addEventListener('click', () => App.quickPractice());
    document.getElementById('btnDemo').addEventListener('click', () => { UI.hideLoader(); App.loadDemo(); });
    document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileCsv').click());
    document.getElementById('fileCsv').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => App.importCSV(r.result, f.name);
      r.readAsText(f);
      e.target.value = '';
    });
    document.getElementById('btnIndicators').addEventListener('click', () => UI.openModal('modalIndicators'));
    document.getElementById('btnPanelsConfig').addEventListener('click', () => UI.openModal('modalIndicators'));
    document.getElementById('btnSessions').addEventListener('click', () => { UI.renderSessions(); UI.openModal('modalSessions'); });
    document.getElementById('btnExport').addEventListener('click', () => UI.openModal('modalExport'));
    document.getElementById('btnShot').addEventListener('click', () => App.screenshot());
    // Solo rellenaba los campos: el ⚙️ de la barra NO abría el modal, así que
    // «Ajustes» parecía no hacer nada (salió al probar la app publicada, no la suite).
    // Es openModal el que abre y además rellena, no al revés: al revés hay recursión.
    document.getElementById('btnSettings').addEventListener('click', () => UI.openModal('modalSettings'));
    document.getElementById('btnHelp').addEventListener('click', () => UI.openModal('modalHelp'));

    // Cambiar de par o temporalidad no recarga solo: avisa al usuario
    // El par se cambia con el buscador o con el desplegable, y en ambos casos
    // la carga es inmediata.
    document.getElementById('pairSelect').addEventListener('change', (e) => {
      UI.pickSymbol(e.target.value);
    });
    // Cambiar la temporalidad en el desplegable recarga los datos al instante
    // (igual que los botones rápidos): así nunca queda el select diciendo una
    // temporalidad y el gráfico mostrando otra.
    document.getElementById('tfSelect').addEventListener('change', (e) => {
      UI.setTimeframe(e.target.value, { force: true });
    });
  };

  /* ------------------------------- Dibujo ------------------------------- */

  UI._wireToolbar = function () {
    U.$$('#drawToolbar .tool[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => { DT.setTool(btn.dataset.tool); U.playSound('click'); });
    });
    document.getElementById('drawColor').addEventListener('input', (e) => DT.setStyle({ color: e.target.value }));
    document.getElementById('drawWidth').addEventListener('change', (e) => DT.setStyle({ width: +e.target.value }));
    document.getElementById('drawStyle').addEventListener('change', (e) => DT.setStyle({ style: e.target.value }));
    document.getElementById('btnDeleteDrawing').addEventListener('click', () => DT.deleteSelected());
    document.getElementById('btnClearDrawings').addEventListener('click', () => DT.clearAll());
    document.getElementById('btnSnap').addEventListener('click', () => DT.toggleSnap());

    document.getElementById('btnAutoScale').addEventListener('click', (e) => {
      const on = !UI._autoScale;
      UI._autoScale = CM.setAutoScale(on);
      e.currentTarget.classList.toggle('active', !UI._autoScale);
      U.toast(UI._autoScale ? '📐 Escala de precios automática' : '📐 Escala de precios MANUAL: arrastra el eje derecho para ajustar', 'info', 2200);
    });
    UI._autoScale = true;

    document.getElementById('btnLogScale').addEventListener('click', (e) => {
      UI._logScale = !UI._logScale;
      CM.setLogScale(UI._logScale);
      e.currentTarget.classList.toggle('active', UI._logScale);
      U.toast(UI._logScale ? 'Escala logarítmica activada' : 'Escala lineal activada', 'info', 1600);
    });
    UI._logScale = false;

    document.getElementById('chkLockScroll').addEventListener('change', (e) => {
      const lock = e.target.checked;
      CM.main.applyOptions({
        handleScroll: { mouseWheel: !lock, pressedMouseMove: !lock, horzTouchDrag: !lock, vertTouchDrag: false },
        handleScale: !lock,
      });
      U.toast(lock ? '🔒 Scroll/zoom del gráfico bloqueado' : 'Scroll/zoom desbloqueado', 'info', 1600);
    });

    // Cerrar paneles de indicadores desde su botón ✕
    U.$$('[data-close-pane]').forEach((b) => b.addEventListener('click', () => {
      const p = b.dataset.closePane;
      App.indicators[p].on = false;
      document.getElementById('ind' + p.charAt(0).toUpperCase() + p.slice(1)).checked = false;
      App.applyIndicators(App.indicators);
      U.log(`👁 Panel ${p.toUpperCase()} ocultado`, 'sys');
    }));
  };

  /* -------------------------------- Replay -------------------------------- */

  UI._wireReplay = function () {
    document.getElementById('btnPlay').addEventListener('click', () => App.togglePlay());
    document.getElementById('btnStepFwd').addEventListener('click', () => App.stepForward());
    document.getElementById('btnStepBack').addEventListener('click', () => App.stepBack());
    document.getElementById('btnReset').addEventListener('click', () => App.resetReplay());
    document.getElementById('btnJumpEnd').addEventListener('click', () => App.goToEnd());

    U.$$('.speed-btn').forEach((b) => b.addEventListener('click', () => {
      const s = b.dataset.speed === 'max' ? 'max' : +b.dataset.speed;
      App.setSpeed(s);
    }));

    const slider = document.getElementById('progressRange');
    slider.addEventListener('input', () => App.seekFromSlider(+slider.value / 1000));
    slider.addEventListener('pointerdown', () => { UI._wasPlaying = BR.isPlaying(); BR.pause(); });
    slider.addEventListener('pointerup', () => { if (UI._wasPlaying) BR.play(); });
  };

  /* ------------------------------- Barra lateral ------------------------------- */

  UI._wireSidebar = function () {
    // Modo de tamaño
    U.$$('#segSize .seg-btn').forEach((b) => b.addEventListener('click', () => {
      U.$$('#segSize .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      App.sizeMode = b.dataset.mode;
      const labels = { pct: ['Tamaño (% del equity)', '%'], notional: ['Tamaño en USD (exposición)', 'USD'], qty: ['Cantidad de monedas', ''] };
      setText('sizeLabel', labels[App.sizeMode][0]);
      setText('sizeSuffix', labels[App.sizeMode][1]);
      if (App.sizeMode === 'qty') document.getElementById('sizeInput').value = 1;
      UI.updateOrderHint();
    }));

    document.getElementById('sizeInput').addEventListener('input', UI.updateOrderHint);
    // Deslizador de fracción 0 / 25 / 50 / 75 / 100 (como el panel de órdenes
    // de Bitunix): fija el tamaño sobre la unidad activa (% | USD | Qty).
    U.$$('#quickSize [data-pct]').forEach((c) => c.addEventListener('click', () => {
      U.$$('#quickSize [data-pct]').forEach((x) => x.classList.toggle('active', x === c));
      const pct = +c.dataset.pct;
      const inp = document.getElementById('sizeInput');
      if (App.sizeMode === 'notional') inp.value = U.round(TE.state.equity * (pct / 100), 2);
      else if (App.sizeMode === 'qty') inp.value = U.round(TE.state.equity * (pct / 100) / Math.max(1e-9, App.currentPrice() || 1) / Math.max(1, TE.state.leverage), 6);
      else inp.value = pct;
      UI.updateOrderHint();
    }));

    // MODO DE MARGEN (Cruzado / Aislado) y apalancamiento con deslizador.
    UI.initTerminal();

    document.getElementById('leverageSelect').addEventListener('change', (e) => {
      TE.configure({ leverage: +e.target.value });
      setText('tagLeverage', e.target.value + 'x');
      UI.syncLeverage(+e.target.value);
      UI.updateOrderHint();
      UI.refreshAccount();
    });
    document.getElementById('feeInput').addEventListener('change', (e) => {
      TE.configure({ feePct: +e.target.value });
      U.log(`💱 Comisión configurada: ${e.target.value}% por lado`, 'sys');
    });

    document.getElementById('slInput').addEventListener('input', UI.updateOrderHint);
    document.getElementById('tpInput').addEventListener('input', UI.updateOrderHint);
    U.$$('#quickSlTp .chip').forEach((c) => c.addEventListener('click', () => {
      const price = App.currentPrice();
      if (!price) { U.toast('No hay datos cargados', 'warn'); return; }
      if (c.dataset.slpct) document.getElementById('slInput').value = U.round(price * (1 - +c.dataset.slpct / 100), 6);
      if (c.dataset.tppct) document.getElementById('tpInput').value = U.round(price * (1 + +c.dataset.tppct / 100), 6);
      UI.updateOrderHint();
    }));

    document.getElementById('btnLong').addEventListener('click', () => App.placeOrder('long'));
    document.getElementById('btnShort').addEventListener('click', () => App.placeOrder('short'));

    /* ---- Tipo de orden: ⚡ Mercado / ⏳ Límite ---- */
    document.querySelectorAll('#segOrderType .seg-btn').forEach((b) => {
      b.addEventListener('click', () => UI.setOrderType(b.dataset.otype));
    });
    // Atajos rápidos de precio límite (% respecto al precio actual)
    document.querySelectorAll('#quickLimit .chip').forEach((c) => {
      c.addEventListener('click', () => {
        const ref = App.currentPrice();
        if (!ref) { U.toast('Carga datos antes de fijar el precio límite', 'warn'); return; }
        const v = c.dataset.limpct;
        const precio = v === 'actual' ? ref : ref * (1 + parseFloat(v) / 100);
        document.getElementById('limitInput').value = precio.toFixed(2);
        UI.updateLimitHint();
      });
    });
    ['limitInput', 'slInput', 'tpInput'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', UI.updateLimitHint);
    });
    document.getElementById('btnCancelOrders').addEventListener('click', () => App.cancelAllOrders());
    document.getElementById('btnFlatten').addEventListener('click', () => App.flatten());
    document.getElementById('btnResetStats').addEventListener('click', () => UI.confirmReset());
  };

  /* ------------------------------ Panel inferior ------------------------------ */

  UI._wireBottom = function () {
    U.$$('.tab').forEach((t) => t.addEventListener('click', () => {
      U.$$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      U.$$('.tab-body').forEach((b) => b.classList.toggle('active', b.id === 'tab-' + t.dataset.tab));
      // Al hacerse visible hay que repintar lo que depende del ancho disponible
      // (la curva de capital se dibujaría con 0 px si estaba oculta) y lo que
      // depende del estado (posición y órdenes en espera).
      const _t = t.dataset.tab;
      if (_t === 'stats') UI.refreshStats();
      else if (_t === 'positions') { UI.refreshPosition(); UI.renderPending(); }
      else if (_t === 'account') UI.refreshAccount();
      if (t.dataset.tab === 'drawings') DT.renderList(document.getElementById('drawList'));
    }));

    document.getElementById('btnClearLog').addEventListener('click', () => {
      document.getElementById('logList').innerHTML = '';
      U.log('🖥️ Log vaciado', 'sys');
    });

    document.getElementById('btnBottomToggle').addEventListener('click', (e) => {
      document.body.classList.toggle('compact-bottom');
      e.currentTarget.textContent = document.body.classList.contains('compact-bottom') ? '⌃' : '⌄';
      setTimeout(() => { DT.resize(); DT.render(); CM.refresh(); }, 300);
    });

    // Gestor de dibujos: seleccionar · 👁 ocultar · ✕ eliminar · borrar todo
    document.getElementById('drawList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        const d = DT.drawings.find((x) => x.id === del.dataset.del);
        if (d) DT.deleteDrawing(d);
        return;
      }
      const ojo = e.target.closest('[data-eye]');
      if (ojo) {
        const d = DT.drawings.find((x) => x.id === ojo.dataset.eye);
        if (d) DT.setHidden(d.id, !d.hidden);
        return;
      }
      if (e.target.closest('[data-eye-all]')) { DT.toggleAllHidden(); return; }
      if (e.target.closest('[data-clear]')) {
        if (!DT.drawings.length) { U.toast('No hay dibujos que borrar', 'info', 1500); return; }
        if (confirm('¿Borrar TODOS los dibujos del gráfico?')) {
          DT.clearAll(); U.toast('🗑️ Todos los dibujos borrados', 'info', 1800);
        }
        return;
      }
      const item = e.target.closest('.draw-item');
      if (item) {
        DT.selected = DT.drawings.find((x) => x.id === item.dataset.id) || null;
        DT.render(); DT.renderList(document.getElementById('drawList'));
      }
    });

    // Doble clic sobre el nombre → renombrar el dibujo en línea
    document.getElementById('drawList').addEventListener('dblclick', (e) => {
      const nom = e.target.closest('[data-nombre]');
      if (!nom || nom.querySelector('input')) return;
      const d = DT.drawings.find((x) => x.id === nom.dataset.nombre);
      if (!d) return;
      const previo = d.label || '';
      nom.innerHTML = '<input class="draw-edit" type="text" maxlength="40" value="' + U.esc(previo) + '">';
      const inp = nom.querySelector('input');
      inp.focus(); inp.select();
      const guardar = () => { DT.rename(d.id, inp.value); };
      inp.addEventListener('keydown', (ev) => {
        ev.stopPropagation();                     // que no actúen los atajos globales
        if (ev.key === 'Enter') { guardar(); }
        else if (ev.key === 'Escape') { DT.renderList(document.getElementById('drawList')); }
      });
      inp.addEventListener('blur', guardar);
    });
  };

  /* --------------------------------- Modales --------------------------------- */

  UI._wireModals = function () {
    // Cierre genérico
    U.$$('.modal').forEach((m) => {
      m.addEventListener('mousedown', (e) => { if (e.target === m) UI.closeModal(m.id); });
      U.$$('[data-close]', m).forEach((b) => b.addEventListener('click', () => UI.closeModal(m.id)));
    });

    /* --- Indicadores --- */
    U.$$('#modalIndicators .ind-row input[type=checkbox]').forEach((c) => {
      c.addEventListener('change', () => c.closest('.ind-row').classList.toggle('on', c.checked));
    });
    document.getElementById('btnApplyInd').addEventListener('click', () => {
      App.applyIndicators(UI.readIndicatorConfig());
      UI.closeModal('modalIndicators');
    });

    /* --- Ajustes --- */
    /* ---- Buscador de símbolos ---- */
    document.getElementById('btnSymbols').addEventListener('click', () => UI.openSymbols());
    document.getElementById('symQuery').addEventListener('input', () => UI.renderSymbols());
    document.getElementById('symQuery').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const primera = document.querySelector('#symList .sym-row');
        if (primera) UI.pickSymbol(primera.dataset.sym);
      }
    });
    U.$$('#symCats .sym-cat').forEach((b) => {
      b.addEventListener('click', () => {
        UI.symCat = b.dataset.cat;
        U.$$('#symCats .sym-cat').forEach((x) => x.classList.toggle('active', x === b));
        UI.renderSymbols();
      });
    });

    /* ---- Temporalidades rápidas (1m · 5m · 15m · 1h · 4h · 1d · 1w) ---- */
    U.$$('#tfQuick .tf-btn').forEach((b) => {
      b.addEventListener('click', () => UI.setTimeframe(b.dataset.tf));
    });
    document.getElementById('tfSelect').addEventListener('change', () => UI.syncTfButtons());

    // Interruptor del gesto (se aplica al instante)
    const chkGesture = document.getElementById('setGesture');
    if (chkGesture) {
      chkGesture.addEventListener('change', () => {
        DT.gesture.on = chkGesture.checked;
        ST.setSettings({ gestureDraw: chkGesture.checked });
        U.toast(chkGesture.checked
          ? '✍️ Gesto activado: mantén pulsado ⅓ s y traza'
          : 'Gesto desactivado', 'info', 2600);
      });
    }
    document.getElementById('btnApplySettings').addEventListener('click', () => App.applySettings());
    document.getElementById('btnHardReset').addEventListener('click', () => UI.confirmHardReset());

    /* --- Sesiones --- */
    document.getElementById('btnSaveSession').addEventListener('click', () => {
      const name = (val('sessionName') || '').trim() || ('Sesión ' + U.fmtDate(Math.floor(Date.now() / 1000)));
      App.saveSession(name);
      UI.renderSessions();
    });
    document.getElementById('sessionList').addEventListener('click', (e) => {
      const load = e.target.closest('[data-load]');
      const del = e.target.closest('[data-delete]');
      if (load) App.loadSession(load.dataset.load);
      if (del) { ST.deleteSession(del.dataset.delete); UI.renderSessions(); }
    });

    /* --- Exportación --- */
    document.getElementById('expTradesCsv').addEventListener('click', () => App.exportTrades());
    document.getElementById('expEquityCsv').addEventListener('click', () => App.exportEquity());
    document.getElementById('expJson').addEventListener('click', () => App.exportJSON());
    document.getElementById('expReport').addEventListener('click', () => App.exportReport());
    document.getElementById('expCandlesCsv').addEventListener('click', () => App.exportCandles());
    document.getElementById('expPng').addEventListener('click', () => App.screenshot());
  };

  UI.openModal = function (id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('open');
    if (id === 'modalSettings') UI.openSettings();
  };

  UI.closeModal = function (id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('open');
  };

  UI.closeAllModals = function () { U.$$('.modal').forEach((m) => m.classList.remove('open')); };

  /* ------------------------------ Configuración ------------------------------ */

  /** Lee la configuración de indicadores del modal. */
  UI.readIndicatorConfig = function () {
    const on = (id) => document.getElementById(id).checked;
    return {
      vol:   { on: on('indVol'),   color: val('volColor') },
      sma:   { on: on('indSma'),   p: numv('smaP', 50),      color: val('smaColor') },
      ema:   { on: on('indEma'),   p: numv('emaP', 21),      color: val('emaColor') },
      ema2:  { on: on('indEma2'),  p: numv('ema2P', 200),    color: val('ema2Color') },
      bb:    { on: on('indBb'),    p: numv('bbP', 20), k: numv('bbK', 2), color: val('bbColor') },
      rsi:   { on: on('indRsi'),   p: numv('rsiP', 14),      color: val('rsiColor') },
      macd:  { on: on('indMacd'),  f: numv('macdF', 12), s: numv('macdS', 26), sig: numv('macdSig', 9), color: val('macdColor'), signalColor: '#ffab40' },
      atr:   { on: on('indAtr'),   p: numv('atrP', 14),      color: val('atrColor') },
    };
  };

  /** Vuelca la configuración guardada en los campos del modal. */
  UI.syncIndicatorModalFromConfig = function (cfg) {
    const set = (id, v) => { const e = document.getElementById(id); if (e && v !== undefined) e.value = v; };
    const chk = (id, v) => { const e = document.getElementById(id); if (e) { e.checked = !!v; e.closest('.ind-row').classList.toggle('on', !!v); } };
    chk('indVol', cfg.vol && cfg.vol.on);      set('volColor', cfg.vol && cfg.vol.color);
    chk('indSma', cfg.sma && cfg.sma.on);      set('smaP', cfg.sma && cfg.sma.p);   set('smaColor', cfg.sma && cfg.sma.color);
    chk('indEma', cfg.ema && cfg.ema.on);      set('emaP', cfg.ema && cfg.ema.p);   set('emaColor', cfg.ema && cfg.ema.color);
    chk('indEma2', cfg.ema2 && cfg.ema2.on);   set('ema2P', cfg.ema2 && cfg.ema2.p); set('ema2Color', cfg.ema2 && cfg.ema2.color);
    chk('indBb', cfg.bb && cfg.bb.on);         set('bbP', cfg.bb && cfg.bb.p);      set('bbK', cfg.bb && cfg.bb.k); set('bbColor', cfg.bb && cfg.bb.color);
    chk('indRsi', cfg.rsi && cfg.rsi.on);      set('rsiP', cfg.rsi && cfg.rsi.p);   set('rsiColor', cfg.rsi && cfg.rsi.color);
    chk('indMacd', cfg.macd && cfg.macd.on);   set('macdF', cfg.macd && cfg.macd.f); set('macdS', cfg.macd && cfg.macd.s); set('macdSig', cfg.macd && cfg.macd.sig);
    chk('indAtr', cfg.atr && cfg.atr.on);      set('atrP', cfg.atr && cfg.atr.p);   set('atrColor', cfg.atr && cfg.atr.color);
    // Etiquetas de parámetros en los paneles
    setText('rsiParams', cfg.rsi ? cfg.rsi.p : 14);
    setText('macdParams', cfg.macd ? `${cfg.macd.f} ${cfg.macd.s} ${cfg.macd.sig}` : '');
    setText('atrParams', cfg.atr ? cfg.atr.p : 14);
  };

  UI.openSettings = function () {
    document.getElementById('setCapital').value = TE.state.initialCapital;
    document.getElementById('setFee').value = TE.state.feePct;
    document.getElementById('setLeverage').value = TE.state.leverage;
    document.getElementById('setWarmup').value = App.warmup;
    document.getElementById('setFunding').value = TE.state.fundingPct;
    document.getElementById('setSlFirst').value = TE.state.slFirst;
    document.getElementById('setSound').checked = !!U.sound.enabled;
    document.getElementById('setAutoReveal').checked = !!App.autoReveal;
    const cg = document.getElementById('setGesture');
    if (cg) cg.checked = DT.gesture.on !== false;
    const ca = document.getElementById('setAveraging');
    if (ca) ca.checked = TE.state.averaging !== false;
  };

  /* --------------------------------- Sesiones --------------------------------- */

  UI.renderSessions = function () {
    const list = document.getElementById('sessionList');
    if (!list) return;
    const sessions = ST.listSessions();
    if (!sessions.length) {
      list.innerHTML = '<div class="empty">No hay sesiones guardadas todavía.</div>';
      return;
    }
    list.innerHTML = sessions.map((s) => {
      const m = s.meta || {};
      return `<div class="session-item">
        <span class="draw-swatch" style="background:#2979ff"></span>
        <span class="s-name">${U.esc(s.name)}</span>
        <span class="s-meta">${m.pair || ''} ${m.interval || ''} · ${m.trades || 0} trades · ${U.fmtDateEs(Math.floor(s.savedAt / 1000))}</span>
        <button class="btn" data-load="${s.key}" title="Cargar esta sesión">Cargar</button>
        <button class="mini-btn" data-delete="${s.key}" title="Eliminar">✕</button>
      </div>`;
    }).join('');
  };

  /* ================== PANELES DE INDICADORES (valores vivos) ================== */

  /**
   * Lista de indicadores con su VALOR ACTUAL, al estilo de OpenMarket: cada fila
   * muestra el nombre, un botón 👁 para mostrar/ocultar la serie y el último
   * valor calculado en la vela visible del replay.
   *
   * Se refresca en cada vela (UI.refreshAll), así que los números van cambiando
   * a medida que avanza el replay, igual que en un panel de trading real.
   */
  UI.renderPanels = function () {
    const cont = document.getElementById('panelsList');
    if (!cont || !CM || !CM.indData) return;
    const cfg = App.indicators || {};
    const i = CM._lastIndex;
    const d = CM.indData;
    const val = (arr) => (i >= 0 && arr && arr[i] != null && Number.isFinite(arr[i])) ? arr[i] : null;
    const ultima = App.candles && App.candles[CM._lastIndex];
    const filas = [];

    const push = (clave, nombre, valores, color, extras) => {
      const c = cfg[clave] || {};
      const on = !!c.on;
      // Solo mostramos los que están activos o los que el usuario tenga puestos
      filas.push({ clave, nombre, on, color: c.color || color, valores: on ? valores : [], extras });
    };

    // Volumen (siempre del gráfico principal)
    push('vol', 'Vol', ultima ? [U.fmtVol(ultima.volume)] : [], '#5c6bc0');
    push('sma', `SMA ${cfg.sma ? cfg.sma.p : 50}`, fmt1(val(d.sma)), '#ffd54f');
    push('ema', `EMA ${cfg.ema ? cfg.ema.p : 21}`, fmt1(val(d.ema)), '#00e5ff');
    push('ema2', `EMA ${cfg.ema2 ? cfg.ema2.p : 200}`, fmt1(val(d.ema2)), '#e040fb');
    push('bb', `BB ${cfg.bb ? cfg.bb.p : 20}`, fmt1(val(d.bb && d.bb.middle)), '#7c4dff');
    push('rsi', `RSI ${cfg.rsi ? cfg.rsi.p : 14}`, fmtNum(val(d.rsi), 1), '#b388ff');
    push('macd', `MACD ${cfg.macd ? cfg.macd.f : 12} ${cfg.macd ? cfg.macd.s : 26} ${cfg.macd ? cfg.macd.sig : 9}`,
      [['hist', fmtNum(val(d.macd && d.macd.hist), 2)],
       ['macd', fmtNum(val(d.macd && d.macd.macd), 2)],
       ['señal', fmtNum(val(d.macd && d.macd.signal), 2)]],
      '#40c4ff', true);
    push('atr', `ATR ${cfg.atr ? cfg.atr.p : 14}`, fmtNum(val(d.atr), 2), '#ffab40');

    const activos = filas.filter((f) => f.on).length;
    const tag = document.getElementById('panelsCount');
    if (tag) tag.textContent = activos + (activos === 1 ? ' indicador' : ' indicadores');

    cont.innerHTML = filas.map((f) => {
      const ojo = `<button class="pl-eye" data-eye="${f.clave}" title="${f.on ? 'Ocultar del gráfico' : 'Mostrar en el gráfico'}">${f.on ? '👁' : '🚫'}</button>`;
      let vals;
      if (f.extras) {
        vals = f.valores.map(([etq, v]) => `<span class="pl-kv"><i>${etq}</i>${v}</span>`).join('');
      } else {
        vals = f.valores.map((v) => `<b class="pl-val">${v}</b>`).join('');
      }
      return `<div class="pl-item ${f.on ? 'on' : 'off'}${f.extras ? ' pl-multi' : ''}" data-key="${f.clave}" title="Clic para configurar ${f.nombre}">` +
        `<span class="pl-dot" style="background:${f.on ? f.color : '#3a3f5c'}"></span>` +
        `<span class="pl-name">${f.nombre}</span>` +
        `<span class="pl-vals">${vals || '<span class="pl-off">—</span>'}</span>` +
        ojo +
      `</div>`;
    }).join('') +
      '<div class="hint hint-tiny">⇕ Arrastra la línea ámbar en el gráfico para mover el nivel, igual que SL/TP.</div>';

    // 👁 mostrar/ocultar sin abrir el modal
    cont.querySelectorAll('[data-eye]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = b.dataset.eye;
        if (!App.indicators[k]) App.indicators[k] = { on: false };
        App.indicators[k].on = !App.indicators[k].on;
        App.applyIndicators(App.indicators);
        U.toast((App.indicators[k].on ? 'Mostrando ' : 'Ocultando ') + k.toUpperCase(), 'info', 1500);
      });
    });
    // Clic en la fila → modal de configuración
    cont.querySelectorAll('.pl-item').forEach((el) => {
      el.addEventListener('click', () => UI.openModal('modalIndicators'));
    });

    function fmt1(v) { return v == null ? [] : [U.fmtPrice(v)]; }
    function fmtNum(v, dec) { return v == null ? [] : [U.num(v, dec)]; }
  };

  /* ============================ ÓRDENES LÍMITE ============================ */

  /** Cambia entre orden a mercado (⚡) y orden límite (⏳). */
  UI.setOrderType = function (tipo) {
    App.orderType = tipo === 'limite' ? 'limite' : 'market';
    document.querySelectorAll('#segOrderType .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.otype === App.orderType);
    });
    const esLimite = App.orderType === 'limite';
    document.getElementById('limitRow').style.display = esLimite ? '' : 'none';
    document.getElementById('btnLong').textContent = esLimite ? '⏳ COMPRAR LÍMITE' : '▲ COMPRAR / LONG';
    document.getElementById('btnShort').textContent = esLimite ? '⏳ VENDER LÍMITE' : '▼ VENDER / SHORT';
    if (esLimite) {
      const el = document.getElementById('limitInput');
      if (el && !parseFloat(el.value)) {
        const ref = App.currentPrice();
        if (ref) el.value = (ref * 0.995).toFixed(2);
      }
      UI.updateLimitHint();
    }
  };

  /** Explica si el nivel elegido es de compra, de venta o se cruzaría. */
  UI.updateLimitHint = function () {
    const el = document.getElementById('limitInput');
    const hint = document.getElementById('limitHint');
    if (!el || !hint) return;
    const ref = App.currentPrice();
    const v = parseFloat(el.value);
    if (!ref || !Number.isFinite(v) || v <= 0) {
      hint.textContent = 'Elige un nivel por debajo del precio para comprar, o por encima para vender.';
      hint.className = 'hint';
      return;
    }
    const pct = ((v - ref) / ref) * 100;
    if (v < ref) {
      hint.textContent = `Nivel ${U.num(Math.abs(pct), 2)}% por debajo del precio (${U.fmtPrice(ref)}): orden de COMPRA (LONG) en un retroceso.`;
      hint.className = 'hint ok';
    } else if (v > ref) {
      hint.textContent = `Nivel ${U.num(pct, 2)}% por encima del precio (${U.fmtPrice(ref)}): orden de VENTA (SHORT) en un rebote.`;
      hint.className = 'hint ok';
    } else {
      hint.textContent = 'El nivel coincide con el precio actual: se ejecutará al instante a mercado.';
      hint.className = 'hint warn';
    }
  };

  /** Pinta la lista de órdenes límite pendientes (con botón de cancelar). */
  UI.renderPending = function () {
    const cont = document.getElementById('pendingList');
    const tag = document.getElementById('pendingCount');
    if (!cont) return;
    const ordenes = (TE.state.pending || []);
    if (tag) tag.textContent = String(ordenes.length);
    setText('tabPendCount', String(ordenes.length));   // contador de la pestaña
    const card = document.getElementById('pendingCard');
    if (card) card.classList.toggle('has-orders', ordenes.length > 0);

    if (!ordenes.length) {
      cont.innerHTML = '<div class="hint">No hay órdenes en espera. Con el modo «⏳ Límite» puedes dejar ' +
        'una orden colocada y el replay la ejecutará solo cuando el precio llegue a tu nivel.</div>';
      return;
    }

    const ref = App.currentPrice();
    cont.innerHTML = ordenes.map((o) => {
      const dist = ref ? ((o.limitPrice - ref) / ref) * 100 : null;
      const eta = dist === null ? '' :
        (o.side === 'long'
          ? (dist < 0 ? `faltan ${U.num(Math.abs(dist), 2)}% a la baja (${U.fmtPrice(ref - o.limitPrice)} USD)` : 'se ejecutará en la próxima vela')
          : (dist > 0 ? `faltan ${U.num(dist, 2)}% al alza (${U.fmtPrice(o.limitPrice - ref)} USD)` : 'se ejecutará en la próxima vela'));
      return `<div class="pending-item ${o.side}">` +
        `<div class="pi-head">` +
          `<span class="pi-side">${o.side === 'long' ? '▲ COMPRA' : '▼ VENTA'}</span>` +
          `<b class="pi-price">${U.fmtPrice(o.limitPrice)}</b>` +
          `<button class="pi-cancel" data-cancel="${o.id}" title="Cancelar esta orden">✖</button>` +
        `</div>` +
        `<div class="pi-sub">` +
          `tamaño ${o.size}${o.mode === 'pct' ? '%' : o.mode === 'qty' ? ' uds' : ' USD'}` +
          `${o.sl ? ' · SL ' + U.fmtPrice(o.sl) : ''}${o.tp ? ' · TP ' + U.fmtPrice(o.tp) : ''}` +
        `</div>` +
        `<div class="pi-eta">${eta}</div>` +
      `</div>`;
    }).join('');

    cont.querySelectorAll('[data-cancel]').forEach((b) => {
      b.addEventListener('click', () => App.cancelOrder(+b.dataset.cancel));
    });

    // Espejo de solo lectura en la pestaña «Órdenes» (ver index.html): se clona la
    // lista y se le quitan los botones de cancelar, que solo funcionan en el
    // original porque ahí es donde están puestos los listeners.
    const espejo = document.getElementById('pendingListTab');
    if (espejo) {
      if (!ordenes.length) {
        espejo.innerHTML = '<div class="hint">Nada en espera: las órdenes límite que colocques ' +
          'aparecerán aquí y en la pestaña Posiciones.</div>';
      } else {
        const c = cont.cloneNode(true);
        c.removeAttribute('id');
        c.querySelectorAll('[data-cancel]').forEach((b) => b.remove());
        espejo.innerHTML = c.innerHTML;
      }
    }
  };

  /* ======================= BUSCADOR DE SÍMBOLOS ======================= */

  UI.symCat = 'favoritos';
  UI.symAll = [];          // lista completa (la real del exchange si hay red)
  UI.symLoaded = false;

  /** Abre el buscador y carga la lista (sin bloquear la interfaz). */
  UI.openSymbols = function () {
    UI.openModal('modalSymbols');
    const q = document.getElementById('symQuery');
    if (q) { q.value = ''; setTimeout(() => q.focus(), 60); }
    // Primer uso (o sin favoritos guardados): abrir en «Principales» para no
    // recibir al usuario con una lista vacía. En cuanto marque una ⭐, la
    // categoría «Favoritos» pasa a ser la de arranque.
    if (UI.symCat === 'favoritos' && !UI.getFavs().length) {
      UI.symCat = 'principales';
      U.$$('#symCats .sym-cat').forEach((x) => x.classList.toggle('active', x.dataset.cat === 'principales'));
      const nota = document.getElementById('symNote');
      if (nota) nota.textContent = 'Marca con ⭐ tus pares favoritos: aparecerán aquí la próxima vez.';
    }
    UI.renderSymbols();                       // pinta ya con la lista local
    if (!UI.symLoaded) {
      DS.fetchSymbols().then((list) => {
        UI.symAll = list;
        UI.symLoaded = true;
        UI.renderSymbols();
        const n = document.getElementById('symNote');
        if (n) n.textContent = list.length + ' pares disponibles en Binance (spot). Marca con ⭐ los que más uses.';
      }).catch(() => {});
    }
  };

  /** Datos auxiliares guardados por el usuario. */
  UI.getFavs = function () { return ST.get('favs', []) || []; };
  UI.getRecents = function () { return ST.get('recents', []) || []; };
  UI.toggleFav = function (symbol) {
    const favs = UI.getFavs();
    const i = favs.indexOf(symbol);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(symbol);
    ST.set('favs', favs.slice(0, 60));
    U.toast(i >= 0 ? '⭐ Quitado de favoritos' : '⭐ Añadido a favoritos', 'info', 1400);
    UI.renderSymbols();
  };

  /** Color identificativo de la moneda base (mismo color siempre para cada una). */
  UI.symColor = function (base) {
    const PALETA = ['#f7931a', '#627eea', '#14f195', '#f0b90b', '#e8e8e8', '#00c853',
      '#ff1744', '#00e5ff', '#b388ff', '#ffab40', '#7c4dff', '#26c6da'];
    let h = 0;
    for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) % 997;
    return PALETA[h % PALETA.length];
  };

  /**
   * Pinta la lista según categoría y búsqueda.
   * Categorías: favoritos · recientes · principales · por divisa (USDT, USDC,
   * BTC, ETH) · todos. Todo sale de la lista real del exchange cuando hay red.
   */
  UI.renderSymbols = function () {
    const cont = document.getElementById('symList');
    if (!cont) return;
    const q = (document.getElementById('symQuery').value || '').trim().toUpperCase();
    const base = UI.symAll.length ? UI.symAll : DS.localSymbols();
    const favs = UI.getFavs();
    const recents = UI.getRecents();
    const cat = UI.symCat;

    // 1) Filtro por categoría
    let lista = base;
    if (cat === 'favoritos') lista = favs.map((s) => base.find((x) => x.symbol === s) || { symbol: s, base: DS.baseOf(s), quote: DS.quoteOf(s), label: DS.label(s) });
    else if (cat === 'recientes') lista = recents.map((s) => base.find((x) => x.symbol === s) || { symbol: s, base: DS.baseOf(s), quote: DS.quoteOf(s), label: DS.label(s) });
    else if (cat === 'principales') lista = base.filter((x) => x.main);
    else if (cat !== 'todos') lista = base.filter((x) => x.quote === cat);

    // 2) Filtro por texto (símbolo o nombre)
    if (q) {
      lista = lista.filter((x) => x.symbol.toUpperCase().indexOf(q) >= 0 || x.label.toUpperCase().indexOf(q) >= 0);
      if (!lista.length && q.length >= 2) {
        // Quizá están buscando fuera de la categoría: buscamos en toda la lista
        const alt = base.filter((x) => x.symbol.toUpperCase().indexOf(q) >= 0);
        if (alt.length) { lista = alt; }
      }
    }

    const max = 300;
    const total = lista.length;
    lista = lista.slice(0, max);

    const cnt = document.getElementById('symCount');
    if (cnt) cnt.textContent = total
      ? total + (total === 1 ? ' par' : ' pares') + (total > max ? ' · mostrando ' + max : '')
      : 'sin resultados';

    if (!lista.length) {
      cont.innerHTML = '<div class="hint">' + (cat === 'favoritos'
        ? 'Todavía no tienes favoritos: busca un par y pulsa la ⭐ de su fila.'
        : 'No hay resultados para «' + U.esc(q) + '».') + '</div>';
      return;
    }

    cont.innerHTML = lista.map((x) => {
      const activo = x.symbol === document.getElementById('pairSelect').value;
      const esFav = favs.indexOf(x.symbol) >= 0;
      const color = UI.symColor(x.base);
      return `<div class="sym-row ${activo ? 'active' : ''}" data-sym="${x.symbol}">` +
        `<span class="sym-ico" style="background:${color}22;color:${color};border-color:${color}66">${U.esc(x.base.slice(0, 3))}</span>` +
        `<span class="sym-name"><b>${U.esc(x.label)}</b><i>${U.esc(x.symbol)}${x.main ? ' · principal' : ''}</i></span>` +
        `<span class="sym-actions">` +
          `<button class="sym-fav ${esFav ? 'on' : ''}" data-fav="${x.symbol}" title="${esFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">${esFav ? '★' : '☆'}</button>` +
        `</span>` +
      `</div>`;
    }).join('');

    // Filas: elegir el símbolo
    cont.querySelectorAll('.sym-row').forEach((el) => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.sym-fav')) return;
        UI.pickSymbol(el.dataset.sym);
      });
    });
    // Estrellas: favoritos
    cont.querySelectorAll('[data-fav]').forEach((b) => {
      b.addEventListener('click', (ev) => { ev.stopPropagation(); UI.toggleFav(b.dataset.fav); });
    });
  };

  /** Cambia el par activo, lo apunta en «recientes» y recarga los datos. */
  UI.pickSymbol = function (symbol) {
    const sel = document.getElementById('pairSelect');
    if (!sel.querySelector('option[value="' + symbol + '"]')) {
      const o = document.createElement('option');
      o.value = symbol; o.textContent = DS.label(symbol);
      sel.appendChild(o);
    }
    sel.value = symbol;

    const recents = UI.getRecents().filter((s) => s !== symbol);
    recents.unshift(symbol);
    ST.set('recents', recents.slice(0, 12));

    UI.updateSymbolButton();
    UI.closeModal('modalSymbols');

    // Cerrar lo que pertenecía a la serie anterior (misma razón que al cambiar TF)
    App.guardSeriesChange('cambiar de par');

    U.toast('🔎 ' + DS.label(symbol) + ' seleccionado: cargando velas…', 'info', 2400);
    const seguia = BR.isPlaying();                            // si estaba reproduciendo, que siga
    App.loadDataFromForm({ silent: true, keepFocus: true })   // recarga automática, como en un terminal
      .catch(() => {})
      .then(() => { UI.refreshStats(true); UI.renderSymbols(); if (seguia) App.togglePlay(); });
  };

  /** Refresca el botón grande de símbolo que hay en la barra superior. */
  UI.updateSymbolButton = function () {
    const sel = document.getElementById('pairSelect');
    if (!sel) return;
    const sym = sel.value;
    const pares = DS.label(sym).split('/');
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('sbPair', DS.label(sym));
    set('sbQuote', (pares[1] || '') + ' · Binance');
    set('sbIco', (pares[0] || '?').slice(0, 3));
    const ico = document.getElementById('sbIco');
    if (ico) {
      const c = UI.symColor(pares[0] || 'X');
      ico.style.color = c;
      ico.style.background = c + '22';
      ico.style.borderColor = c + '66';
    }
  };

  /**
   * Cambia la temporalidad y recarga los datos (como al elegir par).
   * @param {string} tf
   * @param {{force?: boolean}} [opts] force = viene del desplegable, que ya
   *        cambió su valor: hay que recargar aunque coincida con la activa.
   */
  UI.setTimeframe = function (tf, opts = {}) {
    if (!DS.TIMEFRAMES[tf]) { U.toast('Temporalidad no válida', 'err'); return; }
    const sel = document.getElementById('tfSelect');
    if (!opts.force && sel.value === tf && App.interval === tf) { UI.syncTfButtons(); return; }
    sel.value = tf;
    UI.syncTfButtons();

    // La posición abierta y las órdenes pendientes pertenecen a la serie
    // anterior: se cierran/cancelan antes de traer las velas nuevas.
    App.guardSeriesChange('cambiar de temporalidad');

    U.toast('⏱️ Temporalidad ' + DS.TIMEFRAMES[tf].label + ': cargando velas…', 'info', 2200);
    // keepFocus: el replay se queda en la misma fecha, no vuelve al inicio.
    const seguia = BR.isPlaying();          // si estaba reproduciendo, que siga
    return App.loadDataFromForm({ silent: true, keepFocus: true })
      .catch(() => {})
      .then(() => { UI.refreshStats(true); if (seguia) App.togglePlay(); });
  };

  /** Marca como activa la temporalidad pulsada en los botones rápidos. */
  UI.syncTfButtons = function () {
    const actual = document.getElementById('tfSelect').value;
    U.$$('#tfQuick .tf-btn').forEach((b) => b.classList.toggle('active', b.dataset.tf === actual));
  };

  /* --------------------------------- Atajos --------------------------------- */

  UI._wireKeyboard = function () {
    document.addEventListener('keydown', (e) => {
      // Ctrl/⌘+K: buscar símbolo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); UI.openSymbols(); return;
      }
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'select' || tag === 'textarea';

      // Ctrl+S: guardar sesión (funciona incluso escribiendo)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        document.getElementById('btnSessions').click();
        return;
      }
      if (e.key === 'Escape') {
        if (U.$$('.modal.open').length) { UI.closeAllModals(); e.preventDefault(); return; }
        if (DT.tool !== 'cursor') { DT.setTool('cursor'); return; }
        if (DT.draft) { DT.cancelDraft(); return; }
        if (!typing) App.flatten();
        return;
      }
      if (typing) return;

      switch (e.key) {
        case ' ':
          e.preventDefault(); App.togglePlay(); break;
        case 'ArrowRight':
          e.preventDefault(); App.stepForward(); break;
        case 'ArrowLeft':
          e.preventDefault(); App.stepBack(); break;
        // B / S → según el tipo elegido (mercado o límite)
        case 'b': case 's': App.placeOrder(e.key === 'b' ? 'long' : 'short'); break;
        // Mayús+B / Mayús+S → SIEMPRE orden límite, aunque estés en modo mercado
        // (la función real es placeLimitOrder: antes se llamaba a una que no
        // existía y el atajo lanzaba un TypeError sin hacer nada)
        case 'B': App.placeLimitOrder('long'); break;
        case 'S': App.placeLimitOrder('short'); break;
        case 't': case 'T': UI.setOrderType(App.orderType === 'limite' ? 'market' : 'limite'); break;
        case '/': e.preventDefault(); UI.openSymbols(); break;
        case 'a': case 'A': DT.setTool('arrow'); break;
        case 'p': case 'P': DT.setTool('path'); break;
        case 'Enter': if (DT.draft) { e.preventDefault(); DT.finishDraft(); } break;
        case 'r': case 'R': App.resetReplay(); break;
        // Cierre parcial de la posición (50%) y SL al break-even
        case 'c': case 'C': App.partialClose(50); break;
        case 'e': case 'E': App.slToBreakEven(); break;
        // V → trailing stop on/off (t con minúscula ya cambia el tipo de orden)
        case 'v': case 'V': App.toggleTrailing(); break;
        case 'Delete': case 'Backspace': DT.deleteSelected(); break;
        case '+': case '=': case 'PageUp': App.bumpSpeed(1); break;
        case '-': case '_': case 'PageDown': App.bumpSpeed(-1); break;
        case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9': {
          const tools = ['cursor', 'trend', 'ray', 'hline', 'vline', 'rect', 'channel', 'fib', 'measure', 'arrow', 'path'];
          DT.setTool(tools[+e.key - 1] || 'cursor');
          break;
        }
      }
    });
  };

  /* =============================== REFRESCO UI =============================== */

  UI._wireEvents = function () {
    // El motor de trading avisa de cambios → refrescar barra lateral
    global.addEventListener('te:update', () => UI.refreshAccount());
    // Cambios en los dibujos → refrescar lista y contador
    DT.onChange = () => {
      DT.renderList(document.getElementById('drawList'));
      const el = document.getElementById('tabDrawCount');
      if (el) el.textContent = DT.drawings.length;
    };
    // Arrastre de los handles del gráfico: SL/TP de la posición y niveles de las
    // órdenes límite (estas últimas se delegan en App.moveLimitOrder, que además
    // ejecuta el límite si al soltarlo queda cruzado con el precio).
    UI.initPositionManagement();
    DT.onTradeHandle = (id, price, phase) => {
      if (typeof id === 'string' && id.indexOf('limit:') === 0) {
        const oid = +id.slice(6);
        if (price !== null) App.moveLimitOrder(oid, price, phase === 'end' ? 'end' : 'move');
        return;
      }
      if (phase === 'move' && price !== null) {
        // En silencio: el arrastre produce decenas de eventos, solo el último
        // debe dejar rastro en el registro.
        if (id === 'sl') TE.setSL(price, { silent: true }); else TE.setTP(price, { silent: true });
        UI.refreshPosition();
      }
      if (phase === 'end') {
        // Al soltar se CONSOLIDA el nivel con la validación normal: si el último
        // movimiento quedó invalidado (p. ej. un SL sobre la entrada), aquí se
        // rechaza con su aviso y el log refleja el valor FINAL, no el del gesto.
        const pos = TE.state.position;
        if (pos && price !== null) {
          const actual = id === 'sl' ? pos.sl : pos.tp;
          if (actual === null || Math.abs(actual - price) > 1e-9) {
            if (id === 'sl') TE.setSL(price); else TE.setTP(price);
          } else {
            U.log(`🛠 ${id.toUpperCase()} ajustado a ${U.fmtPrice(price)} arrastrando`, 'warn');
          }
        }
        U.log(`🖱️ ${id.toUpperCase()} ajustado en el gráfico a ${U.fmtPrice(price)}`, 'warn');
        U.playSound('click');
      }
    };
    // Al cambiar el tamaño de la ventana, redibujar dibujos
    global.addEventListener('resize', () => { DT.resize(); DT.render(); });
  };

  /**
   * Mientras se arrastra una orden límite, actualiza SOLO los textos que cambian
   * (el campo de precio y la fila de la lista). Un render completo en cada
   * mousemove mataría el hover del panel.
   */
  UI.syncLimitDrag = function (o) {
    const inp = document.getElementById('limitInput');
    if (inp && document.activeElement !== inp) inp.value = o.limitPrice.toFixed(2);
    const items = document.querySelectorAll('#pendingList .pending-item');
    const i = (TE.state.pending || []).findIndex((x) => x.id === o.id);
    const it = i >= 0 ? items[i] : null;
    if (it) {
      const b = it.querySelector('.pi-price');
      if (b) b.textContent = U.fmtPrice(o.limitPrice);
    }
  };

  /**
   * Controles de gestión de la posición (promediar / cerrar parcial / TP
   * escalonado), en la propia tarjeta «📈 Posición abierta».
   */
  UI.initPositionManagement = function () {
    const $ = (id) => document.getElementById(id);

    const btnAvg = $('btnAverage');
    if (btnAvg) btnAvg.addEventListener('click', () => {
      const size = parseFloat(($('avgSize') || {}).value);
      if (!Number.isFinite(size) || size <= 0) { U.toast('Indica un tamaño mayor que 0 para promediar', 'err'); return; }
      const chk = $('avgReaim');
      App.averagePosition(size, { reaim: !!(chk && chk.checked) });
    });

    const card = $('positionCard');
    if (card) card.addEventListener('click', (e) => {
      const partial = e.target.closest('[data-partial]');
      if (partial) { App.partialClose(parseFloat(partial.dataset.partial)); return; }
      const rm = e.target.closest('[data-rm-level]');
      if (rm) { App.removeTpLevel(rm.dataset.rmLevel); return; }
    });

    const btnBE = $('btnSlBE');
    if (btnBE) btnBE.addEventListener('click', () => App.slToBreakEven());

    // 🌀 Trailing stop: activar / re-ajustar / quitar
    const btnTrail = $('btnTrailOn');
    if (btnTrail) btnTrail.addEventListener('click', () => {
      const pct = parseFloat(($('trailPct') || {}).value);
      const raw = (($('trailAct') || {}).value || '').trim();
      if (!Number.isFinite(pct) || pct <= 0) { U.toast('Indica un retracement (%) mayor que 0', 'err'); return; }
      App.setTrailing(pct, raw === '' ? null : parseFloat(raw));
    });
    const btnTrailOff = $('btnTrailOff');
    if (btnTrailOff) btnTrailOff.addEventListener('click', () => App.trailingOff());
    const inpTrailPct = $('trailPct');
    if (inpTrailPct) inpTrailPct.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const b = $('btnTrailOn'); if (b) b.click(); }
    });

    const btnLvl = $('btnTpLevel');
    if (btnLvl) btnLvl.addEventListener('click', () => App.addTpLevelFromForm());
    const inpLvl = $('tpLvlPrice');
    if (inpLvl) inpLvl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); App.addTpLevelFromForm(); }
    });
  };

  /** Lista de niveles de TP escalonado de la posición abierta. */
  UI.renderTpLevels = function (p) {
    const cont = document.getElementById('tpLevelsList');
    if (!cont) return;
    const lvs = (p && p.tpLevels) || [];
    if (!lvs.length) {
      cont.innerHTML = '<div class="hint hint-tiny">Sin niveles. Añade uno para tomar ganancias por partes: cada nivel cierra su % y el resto sigue vivo con su SL.</div>';
      return;
    }
    const dir = p.side === 'long' ? 1 : -1;
    cont.innerHTML = lvs.map((l, i) => {
      const pctPrecio = ((l.price - p.entryPrice) / p.entryPrice) * 100 * dir;
      return `<div class="tp-lvl"><span class="tp-dot">${i + 1}</span>` +
             `<b>${U.fmtPrice(l.price)}</b><span class="tp-meta">${U.num(l.pct * 100, 0)}% · ${U.fmtPct(pctPrecio, 2, true)}</span>` +
             `<button class="mini-btn" data-rm-level="${i}" title="Quitar este nivel">✖</button></div>`;
    }).join('');
  };

  /** Refresco completo. */
  UI.refreshAll = function () {
    UI.refreshAccount();
    UI.refreshStats();
    UI.refreshReplayBar();
    UI.updateOrderHint();
    UI.updateHiddenNotice();
    UI.refreshPriceTag();
    // La leyenda del gráfico refleja SIEMPRE el par y la temporalidad activos
    // (evita desajustes si una recarga termina después de cambiar de par o TF)
    setText('lgPair', DS.label ? DS.label(App.pair) : App.pair);
    setText('lgTf', App.interval);
    UI.renderPending();     // órdenes límite en espera
    UI.renderPanels();      // lista de indicadores con su valor actual
    // Libro de órdenes y fila de estadísticas del terminal (css/bitunix.css):
    // se refrescan con la misma cadencia que el resto de paneles.
    if (global.OB && OB.onTick) OB.onTick();
    UI.updateLimitHint && UI.updateLimitHint();
  };

  UI.refreshPriceTag = function () {
    const p = App.currentPrice();
    setText('tagPrice', p ? U.fmtPrice(p) : '—');
  };

  UI.refreshAccount = function () {
    const m = TE.getMetrics();
    setText('acBalance', U.fmtMoney(m.balance));
    setText('acEquity', U.fmtMoney(m.equity));
    setPnl('acTotalPnl', m.pnlTotal);
    setPnl('acOpenPnl', m.openPnl);
    setText('acMargin', U.fmtMoney(m.margin));
    setText('acFree', U.fmtMoney(m.free));
    setText('acExposure', 'Exposición ' + U.fmtPct(m.exposure, 1) + (TE.state.leverage > 1 ? ` · ${TE.state.leverage}x` : ''));
    setText('acFees', 'Comisiones ' + U.fmtMoney(m.fees));
    const meter = document.getElementById('marginMeter');
    if (meter) meter.style.width = U.clamp(m.exposure, 0, 100) + '%';
    setText('tagLeverage', TE.state.leverage + 'x');
    setText('eqValue', U.fmtMoney(m.equity));
    UI.refreshPosition();
  };

  /** Redibuja las líneas de posición solo cuando cambian los niveles. */
  UI.syncPositionGraphics = function (p) {
    // El TRAILING entra en la firma: su nivel de disparo cambia con cada pico, así
    // que si no se compara, activarlo (o que la vela haga un nuevo máximo) no
    // repinta nada y la línea TRAIL aparece un paso por detrás o directamente no
    // aparece hasta que otra cosa mueve la posición.
    const trail = !p || !p.trail ? 'off'
      : (p.trail.armed ? 'a' + p.trail.peak : 'e' + p.trail.activation);
    const sig = p
      ? `${p.id}|${p.side}|${p.entryPrice}|${p.qty}|${p.sl}|${p.tp}|${p.leverage}|` +
        `${(p.tpLevels || []).map((l) => l.price + ':' + l.pct).join(',')}|${(p.parts || []).length}|${trail}`
      : null;
    if (sig === UI._posSig) return;
    UI._posSig = sig;
    CM.setPositionLines(p);
    DT.setTradeHandles(p);
  };

  UI.refreshPosition = function () {
    const p = TE.state.position;
    const price = App.currentPrice();
    const tag = document.getElementById('posSide');
    setText('tabPosCount', p ? '1' : '0');   // aviso en la pestaña «Posiciones»
    UI.syncPositionGraphics(p);
    if (!p) {
      tag.textContent = 'FLAT';
      tag.className = 'tag flat';
      setText('posPnl', '$0.00'); setPnl('posPnl', 0);
      ['posEntry', 'posSize', 'posNotional', 'posMark', 'posSlDist', 'posTpDist', 'posLiq', 'posRR',
       'posAvg', 'posBE', 'posTrail', 'posDuration', 'posBars']
        .forEach((id) => setText(id, '—'));
      // Sin posición: el ✕ del trailing se apaga y el botón vuelve a «Activar».
      const offBtn = document.getElementById('btnTrailOff');
      if (offBtn) offBtn.disabled = true;
      const onBtn = document.getElementById('btnTrailOn');
      if (onBtn) onBtn.textContent = 'Activar';
      UI.renderTpLevels(null);
      const mgmt = document.getElementById('posMgmt');
      if (mgmt) mgmt.classList.remove('activo');
      return;
    }
    const nPartes = (p.parts || []).length;
    setText('posAvg', `${nPartes} entrada${nPartes === 1 ? '' : 's'}` + (p.additions ? ` (+${p.additions})` : ''));
    const be = TE.breakEvenPrice(p);
    setText('posBE', be !== null
      ? `${U.fmtPrice(be)} (${U.fmtPct(((be - p.entryPrice) / p.entryPrice) * 100, 2, true)})`
      : '—');
    // Estado del trailing en la tarjeta: nivel de disparo si ya sigue el pico, o
    // cuánto le falta al precio para armarlo si está en espera de activación.
    const tl = typeof TE.trailingInfo === 'function' ? TE.trailingInfo(p) : null;
    setText('posTrail', !tl ? '—' : (tl.armed
      ? `${U.num(tl.pct, 2)} % · pico ${U.fmtPrice(tl.peak)} → ${U.fmtPrice(tl.level)} (${U.fmtPct(tl.distPct, 2, true)})`
      : `${U.num(tl.pct, 2)} % · arma en ${U.fmtPrice(tl.activation)}`));
    const offT = document.getElementById('btnTrailOff');
    if (offT) offT.disabled = !p.trail;
    const onT = document.getElementById('btnTrailOn');
    if (onT) onT.textContent = p.trail ? 'Re-ajustar' : 'Activar';
    if (onT && p.trail) onT.title = 'Redefinir el % y el pico desde el precio actual';
    UI.renderTpLevels(p);
    const mgmtOn = document.getElementById('posMgmt');
    if (mgmtOn) mgmtOn.classList.add('activo');
    const pnl = TE.unrealized(price);
    tag.textContent = p.side === 'long' ? 'LONG' : 'SHORT';
    tag.className = 'tag ' + p.side;
    const el = document.getElementById('posPnl');
    el.textContent = U.fmtMoney(pnl, true) + (p.entryPrice ? `  (${U.fmtPct((pnl / p.entryBalance) * 100, 2, true)})` : '');
    el.className = 'pnl ' + (pnl >= 0 ? 'up' : 'down');

    setText('posEntry', U.fmtPrice(p.entryPrice));
    setText('posSize', U.num(p.qty, 6) + ' ' + App.baseAsset());
    setText('posNotional', U.fmtMoney(p.notional) + ' · ' + p.leverage + 'x');
    setText('posMark', U.fmtPrice(price));
    setText('posSlDist', p.sl ? `${U.fmtPrice(p.sl)} (${U.fmtPct(((p.sl - p.entryPrice) / p.entryPrice) * 100, 2, true)})` : 'sin SL');
    setText('posTpDist', p.tp ? `${U.fmtPrice(p.tp)} (${U.fmtPct(((p.tp - p.entryPrice) / p.entryPrice) * 100, 2, true)})` : 'sin TP');
    const liq = TE.liquidationPrice(p);
    setText('posLiq', p.leverage > 1 && liq ? U.fmtPrice(liq) : '—');
    setText('posRR', (p.sl && p.tp)
      ? U.num(Math.abs(p.tp - p.entryPrice) / Math.abs(p.entryPrice - p.sl), 2) + ' : 1'
      : '—');
    setText('posDuration', 'Abierta ' + U.fmtDuration(p.entryTime, App.currentTime()));
    setText('posBars', p.bars + ' velas');
  };

  /** Estadísticas y curva de capital. */
  UI.refreshStats = function (force) {
    const metrics = TE.getMetrics();
    const trades = TE.state.trades;
    const closedCount = trades.filter((t) => t.status === 'closed').length;

    // La curva de capital y el cómputo de métricas se hace como mucho cada 250 ms,
    // salvo que se fuerce o que haya cambiado el número de trades cerrados.
    const now = performance.now();
    const tradeClosed = closedCount !== UI._closedCount;
    const shouldHeavy = force || tradeClosed || !UI._statsAt || (now - UI._statsAt > 250);

    // La fila de la posición abierta es barata de refrescar (unos pocos textos),
    // así que se actualiza SIEMPRE, incluso cuando el cómputo pesado de
    // estadísticas se salta por el tope de 250 ms: si no, avanzando rápido la
    // fila mostraba barras y PnL atrasados.
    UI.updateOpenTradeRow();

    if (!shouldHeavy) return;
    UI._statsAt = now;

    const s = STATS.compute(trades, TE.state.equitySeries, TE.state.initialCapital);
    UI.lastStats = s;

    setText('stTrades', s.total);
    setText('stWinRate', s.total ? U.fmtPct(s.winRate, 1) : '—');
    setText('stPf', s.total ? (s.profitFactor === Infinity ? '∞' : U.num(s.profitFactor, 2)) : '—');
    setText('stDd', s.total ? U.fmtMoney(-s.maxDD) + ' (' + U.fmtPct(s.maxDDPct * 100, 1) + ')' : '—');
    setText('stRr', s.avgR === null ? '—' : U.num(s.avgR, 2) + 'R');
    setText('stWl', `${s.wins} / ${s.losses}`);
    setText('stBest', s.total ? U.fmtMoney(s.best, true) : '—');
    setText('stWorst', s.total ? U.fmtMoney(s.worst, true) : '—');
    setText('stExp', s.total ? U.fmtMoney(s.expectancy, true) : '—');
    setText('stStreak', s.total ? `${s.currentStreak} ${s.streakType === 'W' ? 'ganadores' : 'perdedores'}` : '—');
    const best = document.getElementById('stBest'), worst = document.getElementById('stWorst'), exp = document.getElementById('stExp');
    if (best) best.className = 'pnl ' + (s.best > 0 ? 'up' : 'down');
    if (worst) worst.className = 'pnl ' + (s.worst < 0 ? 'down' : 'up');
    if (exp) exp.className = 'pnl ' + (s.expectancy >= 0 ? 'up' : 'down');
    setText('eqValue', U.fmtMoney(metrics.equity));

    CM.drawEquity(TE.state.equitySeries, TE.state.initialCapital);
    if (force || closedCount !== UI._closedCount) {
      UI.renderTrades();
      UI.refreshPosition();
    } else {
      // Sin cambios en los cerrados: basta con refrescar el PnL de la abierta
      UI.updateOpenTradeRow();
      UI.refreshPosition();
    }
    UI._closedCount = closedCount;
  };

  /** Tabla de historial de trades. */
  /**
   * Fila de la POSICIÓN ABIERTA: la entrada se ve desde el primer momento, con
   * su PnL flotante actualizándose vela a vela (antes sólo aparecía el trade
   * cuando se cerraba, así que una entrada parecía «no registrada»).
   */
  UI._openTradeRow = function (p) {
    const precio = App.currentPrice() || p.entryPrice;
    const pnl = TE.unrealized(precio);
    const pct = p.entryBalance ? (pnl / p.entryBalance) * 100 : 0;
    const r = p.riskUsd ? U.num(pnl / p.riskUsd, 2) : '—';
    return `<tr id="tradeOpenRow" class="open ${p.side}">
      <td>·</td>
      <td class="dir-${p.side}">${p.side === 'long' ? 'LONG' : 'SHORT'}</td>
      <td>${U.fmtDate(p.entryTime)}</td>
      <td class="open-tag">ABIERTA</td>
      <td class="num">${U.fmtPrice(p.entryPrice)}</td>
      <td class="num" id="openExit">${U.fmtPrice(precio)}</td>
      <td class="num">${U.num(p.qty, 5)}</td>
      <td class="num pnl ${pnl >= 0 ? 'up' : 'down'}" id="openPnl">${U.fmtMoney(pnl, true)}</td>
      <td class="num pnl ${pct >= 0 ? 'up' : 'down'}" id="openPct">${U.fmtPct(pct, 2, true)}</td>
      <td class="num" id="openR">${r}</td>
      <td>${(TE.state.pending || []).length ? 'EN VIVO · pendientes: ' + TE.state.pending.length : 'EN VIVO'}</td>
      <td id="openBars">${p.bars || 0} (${U.fmtDuration(p.entryTime, TE.state.lastTime || p.entryTime)})</td>
    </tr>`;
  };

  /** Refresca sólo la fila abierta (PnL flotante, barras y motivo), sin rehacer la tabla. */
  UI.updateOpenTradeRow = function () {
    const p = TE.state.position;
    const row = document.getElementById('tradeOpenRow');
    if (!p) { if (row) UI.renderTrades(); return; }
    if (!row) { UI.renderTrades(); return; }

    const precio = App.currentPrice() || p.entryPrice;
    const pnl = TE.unrealized(precio);
    const pct = p.entryBalance ? (pnl / p.entryBalance) * 100 : 0;
    const set = (id, txt, cls) => { const el = document.getElementById(id); if (!el) return; el.textContent = txt; if (cls) el.className = cls; };
    set('openExit', U.fmtPrice(precio));
    set('openPnl', U.fmtMoney(pnl, true), 'num pnl ' + (pnl >= 0 ? 'up' : 'down'));
    set('openPct', U.fmtPct(pct, 2, true), 'num pnl ' + (pct >= 0 ? 'up' : 'down'));
    set('openR', p.riskUsd ? U.num(pnl / p.riskUsd, 2) : '—');
    set('openBars', `${p.bars || 0} (${U.fmtDuration(p.entryTime, TE.state.lastTime || p.entryTime)})`);
    const pend = row.querySelector('td:nth-child(11)');
    if (pend) pend.textContent = (TE.state.pending || []).length ? 'EN VIVO · pendientes: ' + TE.state.pending.length : 'EN VIVO';
  };

  UI.renderTrades = function () {
    const body = document.getElementById('tradesBody');
    const empty = document.getElementById('tradesEmpty');
    const trades = TE.state.trades.filter((t) => t.status === 'closed').slice().reverse();
    const abierta = TE.state.position;
    setText('tabTradeCount', TE.state.trades.filter((t) => t.status === 'closed').length);
    if (!trades.length && !abierta) {
      body.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    body.innerHTML = (abierta ? UI._openTradeRow(abierta) : '') + trades.map((t, i) => {
      const n = TE.state.trades.indexOf(t) + 1;
      const dur = U.fmtDuration(t.entryTime, t.exitTime);
      return `<tr class="${t.pnl > 0 ? 'win' : 'loss'}">
        <td>${n}</td>
        <td class="dir-${t.side}">${t.side === 'long' ? 'LONG' : 'SHORT'}</td>
        <td>${U.fmtDate(t.entryTime)}</td>
        <td>${U.fmtDate(t.exitTime)}</td>
        <td class="num">${U.fmtPrice(t.entryPrice)}</td>
        <td class="num">${U.fmtPrice(t.exitPrice)}</td>
        <td class="num">${U.num(t.qty, 5)}</td>
        <td class="num">${U.fmtMoney(t.pnl, true)}</td>
        <td class="num">${U.fmtPct(t.pnlPct, 2, true)}</td>
        <td class="num">${t.rMultiple !== null ? U.num(t.rMultiple, 2) : '—'}</td>
        <td>${TE.reasonLabel(t.reason)}</td>
        <td>${t.bars || 0} (${dur})</td>
      </tr>`;
    }).join('');
  };

  /* ------------------------------- Barra replay ------------------------------- */

  UI.setPlaying = function (playing) {
    const btn = document.getElementById('btnPlay');
    if (btn) {
      btn.textContent = playing ? '❚❚' : '▶';
      btn.title = playing ? 'Pausa (Espacio)' : 'Play (Espacio)';
      btn.classList.toggle('playing', playing);
    }
    const st = document.getElementById('pbStatus');
    if (st) {
      st.textContent = playing ? 'EN REPLAY' : 'PAUSA';
      st.className = 'rb-status ' + (playing ? 'playing' : 'paused');
    }
  };

  UI.refreshReplayBar = function () {
    const total = BR.total();
    const idx = BR.getIndex();
    const c = BR.currentCandle();
    setText('pbTime', c ? U.fmtDate(c.time) + ' UTC' : '—');
    setText('pbIndex', `vela ${idx + 1} / ${total}`);
    setText('pbPct', U.fmtPct(BR.progressTotal() * 100, 1));
    setText('pbSpeed', BR.speedLabel());
    setText('rbClock', c ? U.fmtDateSec(c.time) : '—');
    const slider = document.getElementById('progressRange');
    if (slider && document.activeElement !== slider) slider.value = Math.round(BR.progressTotal() * 1000);
    U.$$('.speed-btn').forEach((b) => {
      const v = b.dataset.speed === 'max' ? 'max' : +b.dataset.speed;
      b.classList.toggle('active', v === BR.state.speed);
    });
    UI.updateHiddenNotice();
    UI.refreshPriceTag();
  };

  UI.updateHiddenNotice = function () {
    const hidden = BR.hiddenCount();
    const el = document.getElementById('hiddenNotice');
    if (!el) return;
    setText('hiddenCount', `${hidden.toLocaleString('es-ES')} velas ocultas`);
    el.classList.toggle('hidden', hidden === 0);
  };

  /* ------------------------------- Orden / hint ------------------------------- */

  /** Texto de ayuda bajo los botones de orden: SL/TP y riesgo estimado. */
  UI.updateOrderHint = function () {
    const price = App.currentPrice();
    const hint = document.getElementById('orderHint');
    if (!hint) return;
    if (!price) { hint.textContent = 'Carga datos para operar.'; return; }
    const sl = parseFloat(val('slInput'));
    const tp = parseFloat(val('tpInput'));
    const parts = [];
    if (Number.isFinite(sl)) parts.push(`SL a ${U.fmtPct(((price - sl) / price) * 100, 2)} del precio`);
    if (Number.isFinite(tp)) parts.push(`TP a ${U.fmtPct(((tp - price) / price) * 100, 2)}`);
    // Riesgo estimado
    const { notional } = App.estimateSize(price);
    if (Number.isFinite(sl) && notional > 0) {
      const risk = Math.abs(price - sl) / price * notional;
      const eq = TE.state.balance;
      parts.push(`riesgo ≈ ${U.fmtMoney(risk)} (${U.fmtPct(risk / eq * 100, 2)} del capital)`);
    }
    UI.renderOrderCost();
    const pAb = TE.state.position;
    if (pAb) {
      parts.push(TE.state.averaging
        ? `${pAb.side === 'long' ? 'LONG' : 'SHORT'} abierta a ${U.fmtPrice(pAb.entryPrice)}: el mismo lado PROMEDIA, el contrario invierte`
        : 'posición abierta: cierra antes de abrir otra (activa «Promediar entradas» en Ajustes)');
    }
    hint.textContent = parts.length ? parts.join(' · ') : 'Sin SL/TP definidos (puedes añadirlos por precio o con los atajos rápidos).';
  };

  /* ============================ TERMINAL (piel Bitunix) ============================ */

  /** Sincroniza chip + deslizador + <select> del apalancamiento. */
  UI.syncLeverage = function (v) {
    const lev = Math.max(1, Math.min(100, Math.round(+v || 1)));
    const sel = document.getElementById('leverageSelect');
    if (sel) {
      if (!Array.prototype.some.call(sel.options, (o) => +o.value === lev)) {
        const o = document.createElement('option');
        o.value = String(lev); o.textContent = lev + 'x';
        sel.appendChild(o);
      }
      if (+sel.value !== lev) { sel.value = String(lev); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    setText('bfLevVal', lev + 'x');
    const r = document.getElementById('levRange');
    if (r && +r.value !== lev) r.value = String(lev);
  };

  /** Controles nuevos de la fila superior del panel de órdenes. */
  UI.initTerminal = function () {
    const seg = document.getElementById('segMarginMode');
    if (seg) seg.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-mm]') : null;
      if (!b) return;
      U.$$('#segMarginMode [data-mm]').forEach((x) => x.classList.toggle('active', x === b));
      const m = TE.setMarginMode(b.dataset.mm);
      const p = TE.state.position;
      U.log(`🧮 Modo de margen: ${m === 'cross' ? 'CRUZADO (toda la cuenta respalda)' : 'AISLADO (solo el margen de la posición)'}` +
        (p ? ` · liq. ${U.fmtPrice(TE.liquidationPrice(p))}` : ''), 'sys');
      UI.refreshPosition();
      App.refreshOrderLines();
      UI.refreshAccount();
    });
    const r = document.getElementById('levRange');
    if (r) r.addEventListener('input', () => UI.syncLeverage(+r.value));
    const sel = document.getElementById('leverageSelect');
    if (sel) UI.syncLeverage(+sel.value);     // estado inicial coherente
  };

  /** Coste / margen de la orden y bloqueo si el tamaño es 0 (Bitunix lo deshabilita). */
  UI.renderOrderCost = function () {
    const price = App.currentPrice();
    const est = price ? (App.estimateSize(price) || {}) : {};
    const notional = +est.notional || 0;
    const lev = Math.max(1, TE.state.leverage);
    setText('bfCostVal', notional > 0 ? U.fmtMoney(notional) : '—');
    setText('bfMarginVal', notional > 0 ? U.fmtMoney(notional / lev) + ` (${lev}x)` : '—');
    const cero = notional <= 0;
    ['btnLong', 'btnShort'].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.disabled = cero;
    });
  };

  /* -------------------------------- Confirmaciones -------------------------------- */

  UI.confirmReset = function () {
    if (!confirm('¿Reiniciar las estadísticas y borrar el historial de trades? El replay no se moverá.')) return;
    App.resetStats();
  };

  UI.confirmHardReset = function () {
    if (!confirm('Esto reinicia la sesión completa: cuenta, trades, dibujos, indicadores y replay. ¿Continuar?')) return;
    App.hardReset();
    UI.closeModal('modalSettings');
  };

  /* ------------------------------- Loader ------------------------------- */

  UI.showLoader = function (text) {
    const l = document.getElementById('loader');
    l.classList.remove('hidden');
    UI._loaderBase = text || 'Cargando…';
    UI._loaderT0 = performance.now();
    setText('loaderText', UI._loaderBase);
    if (UI._loaderTimer) clearInterval(UI._loaderTimer);
    UI._loaderTimer = setInterval(UI._tickLoader, 500);
  };

  UI._tickLoader = function () {
    if (!UI._loaderT0) return;
    const s = Math.round((performance.now() - UI._loaderT0) / 1000);
    let extra = ` (${s} s)`;
    if (s >= 6) extra += ' · la red va lenta… si no responde, arrancaré en modo DEMO';
    setText('loaderText', UI._loaderBase + extra);
  };

  UI.hideLoader = function () {
    document.getElementById('loader').classList.add('hidden');
    if (UI._loaderTimer) { clearInterval(UI._loaderTimer); UI._loaderTimer = null; }
    UI._loaderT0 = 0;
  };

  UI.setLoaderText = function (t) {
    UI._loaderBase = t;
    setText('loaderText', t + (UI._loaderT0 ? ` (${Math.round((performance.now() - UI._loaderT0) / 1000)} s)` : ''));
  };

  /* ------------------------------- Leyenda / pares ------------------------------- */

  UI.setPairLabels = function (pair, interval) {
    const label = DS.label ? DS.label(pair) : (DS.PAIRS[pair] || pair);
    UI.updateSymbolButton && UI.updateSymbolButton();
    setText('lgPair', label);
    setText('lgTf', interval);
    // Fuente de datos visible en la leyenda: Binance (real), DEMO (sintético)…
    const src = App.source && App.source !== '—' ? App.source : '';
    const el = document.getElementById('lgSource');
    if (el) {
      el.textContent = src ? '· ' + src : '';
      el.title = src ? 'Fuente de datos: ' + src : '';
      el.style.color = /DEMO|sintétic/i.test(src) ? 'var(--warn)' : 'var(--tx-4)';
    }
  };

  /* ------------------------------ Captura de pantalla ------------------------------ */

  /** Compone las velas + dibujos + paneles en una sola imagen PNG. */
  UI.composeScreenshot = function () {
    const area = document.getElementById('chartArea');
    const wrap = document.getElementById('chartWrap');
    const areaRect = area.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const dpr = global.devicePixelRatio || 1;

    const cv = document.createElement('canvas');
    cv.width = Math.round(areaRect.width * dpr);
    cv.height = Math.round(areaRect.height * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(0, 0, areaRect.width, areaRect.height);

    // Todas las velas/paneles renderizados por canvas dentro del área del gráfico
    U.$$('#chartArea canvas').forEach((c) => {
      if (!c.width || !c.height) return;
      const r = c.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      try { ctx.drawImage(c, r.left - areaRect.left, r.top - areaRect.top, r.width, r.height); } catch (e) {}
    });

    // Dibujos (canvas superpuesto)
    ctx.save();
    ctx.translate(0, wrapRect.top - areaRect.top);
    DT.renderTo(ctx, wrapRect.width, wrapRect.height);
    ctx.restore();

    // Cabecera informativa
    const c = BR.currentCandle();
    ctx.fillStyle = 'rgba(11,12,22,.85)';
    ctx.fillRect(0, 0, areaRect.width, 22);
    ctx.fillStyle = '#e8eaf6';
    ctx.font = 'bold 12px ui-monospace, monospace';
    const pair = (DS.label ? DS.label(App.pair) : (DS.PAIRS[App.pair] || App.pair));
    ctx.fillText(`BAR REPLAY PRO · ${pair} · ${App.interval} · ${c ? U.fmtDate(c.time) + ' UTC' : ''} · ` +
                 `Balance ${U.fmtMoney(TE.state.balance)} · Equity ${U.fmtMoney(TE.state.equity)}`, 10, 15);
    return cv;
  };

  /* ------------------------------ Cura de inputs ------------------------------ */

  UI.setSizeMode = function (mode) {
    U.$$('#segSize .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
  };

  UI.setSpeedButtons = function () {
    U.$$('.speed-btn').forEach((b) => {
      const v = b.dataset.speed === 'max' ? 'max' : +b.dataset.speed;
      b.classList.toggle('active', v === BR.state.speed);
    });
  };

  global.UI = UI;
})(window);
