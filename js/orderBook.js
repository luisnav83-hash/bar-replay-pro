/* =========================================================================
 * orderBook.js — LIBRO DE ÓRDENES y FILA DE ESTADÍSTICAS del terminal.
 *
 * Reproduce las dos zonas de datos de la pantalla de futuros de Bitunix:
 *
 *   1. #bfStats · último precio, 24 h, mark/index, funding (con su cuenta
 *      atrás), interés abierto, volumen y reparto long/short.
 *   2. #bookCard · ventas en rojo, precio último en el centro con su flecha,
 *      compras en verde y la banda bid/ask al pie. Pinchar una fila pone ese
 *      precio en el campo «Precio límite» y cambia el panel a modo Límite,
 *      igual que en el exchange.
 *
 * HONESTIDAD DE LOS DATOS (importante):
 *   · `live = true`  → se pregunta al espejo público de Binance (libro y 24 h,
 *     mismo mercado que las velas de esta app) y a Bitget USDT-FUTURES (mark,
 *     índice, funding, OI, long/short). Cada valor lleva su procedencia en el
 *     `title` y la fila muestra un resumen en #bfSource.
 *   · `live = false` (por defecto mientras se replayea) → el libro se DERIVA
 *     de la vela del cursor de forma determinista y se etiqueta «derivado»:
 *     un libro en tiempo real no tiene sentido historical en 2021, y
 *     disimularlo sería mentira. Las cifras de 24 h del replay sí salen de
 *     datos reales: se calculan sobre las velas cargadas.
 *
 * Ningún fallo de red rompe la app: si un endpoint no responde, se usa el
 * valor derivado y se anota en la etiqueta de origen.
 * ======================================================================= */
(function (global) {
  'use strict';

  const OB = {};

  /* ------------------------------ estado ------------------------------ */

  OB.ROWS = 10;              // niveles por lado (el original muestra 10-15)
  OB.POLL_MS = 6000;         // ritmo de refresco cuando el modo live está activo
  OB.state = {
    pair: null,
    live: false,             // false = valores del replay, true = exchange
    book: null,              // {asks:[[p,q]…], bids:[[p,q]…], src}
    t24: null,               // estadísticas de 24 h reales (spot)
    meta: null,              // mark/index/funding/OI/long-short reales (futuros)
    venues: [],              // qué ha respondido últimamente
    errors: [],              // por qué no, si algo falló
    lastPoll: 0,
    polls: 0,
    renders: 0,
  };

  const el = (id) => document.getElementById(id);
  const setTxt = (id, v) => { const n = el(id); if (n && n.textContent !== v) n.textContent = v; };
  const setCls = (id, cls) => {
    const n = el(id);
    if (n) n.className = n.className.replace(/\b(up|dn|wn)\b/g, '').trim() + (cls ? ' ' + cls : '');
  };

  /* --------------------------- formato numérico --------------------------- */

  /** Tamaño de tick según la magnitud del precio (0,01 en SOL; 0,5 en BTC…). */
  OB.tickOf = function (price) {
    const p = Math.abs(price) || 1;
    if (p >= 5000) return 0.5;
    if (p >= 500) return 0.05;
    if (p >= 20) return 0.01;
    if (p >= 1) return 0.001;
    return 0.00001;
  };

  /** Decimales coherentes con el tick, sin coma flotante fea. */
  OB.priceDecimals = function (tick) {
    const s = String(tick);
    const i = s.indexOf('.');
    return i < 0 ? 0 : Math.min(8, s.length - i - 1);
  };

  OB.fmtQty = function (v) {
    if (!Number.isFinite(v) || v <= 0) return '0';
    if (v >= 1000) return U.num(v, 0);
    if (v >= 1) return U.num(v, 3);
    if (v >= 0.001) return U.num(v, 5);
    return U.num(v, 8);
  };

  OB.fmtUsd = function (v) {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return U.num(v / 1e9, 2) + ' B';
    if (a >= 1e6) return U.num(v / 1e6, 2) + ' M';
    if (a >= 1e3) return U.num(v / 1e3, 1) + ' K';
    return U.num(v, 2);
  };

  /** Tiempo hasta la próxima liquidación de funding, en HH:MM:SS. */
  OB.countdown = function (nextTs, nowMs) {
    if (!Number.isFinite(nextTs)) return '—';
    let ms = nextTs - (nowMs === undefined ? Date.now() : nowMs);
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
  };

  /* ------------------- PRNG determinista para el libro ------------------- */
  /* Semilla = par + instante de la vela + nivel. Misma vela → mismo libro, y
     así los tests pueden reproducir el libro exacto. */
  function seedOf(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0 || 1;
  }
  function rnd32(seed) {
    let x = seed >>> 0;
    return function () {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
  }

  /**
   * Libro sintético pero coherente: los niveles se reparten alrededor del
   * precio de la vela, el tamaño escala con el volumen de la vela y el sesgo
   * bid/ask sale del cuerpo de la vela (vela alcista ⇒ más compra acumulada).
   */
  OB.derivedBook = function (price, candle, symbol) {
    const tick = OB.tickOf(price);
    const dec = OB.priceDecimals(tick);
    const vol = Number.isFinite(candle && candle.volume) ? candle.volume : 0;
    const base = Math.max(vol * 0.05, price > 1000 ? 0.35 : 12);
    const body = candle && candle.high > candle.low
      ? (candle.close - candle.open) / (candle.high - candle.low) : 0;
    const bidShare = Math.min(0.82, Math.max(0.18, 0.5 + body * 0.3));
    const rnd = rnd32(seedOf((symbol || '') + '|' + Math.round(price * 100) + '|' + Math.round((candle && candle.time) || 0)));
    const mk = (sign) => {
      const out = [];
      let cum = 0;
      for (let i = 1; i <= OB.ROWS; i++) {
        const p = +(price + sign * tick * i).toFixed(dec);
        // la liquidez se espesa hacia el precio, como en un libro real
        const q = +(base * (0.28 + rnd() * 1.35) / (1 + i * 0.16)).toFixed(6);
        cum += q;
        out.push([p, q, cum]);
      }
      return out;
    };
    const asks = mk(1);
    const bids = mk(-1);
    // reescalar para que el acumulado refleje el sesgo de la vela
    const scale = bidShare / 0.5;
    for (let i = 0; i < bids.length; i++) bids[i][1] = +(bids[i][1] * Math.min(2, scale)).toFixed(6);
    for (let i = 0; i < asks.length; i++) asks[i][1] = +(asks[i][1] * Math.min(2, 2 - Math.min(2, scale))).toFixed(6);
    const redim = (a) => { let c = 0; return a.map((r) => { c += r[1]; return [r[0], r[1], c]; }); };
    return { asks: redim(asks), bids: redim(bids), src: 'derivado', tick, dec };
  };

  /* ------------------------------ render ------------------------------ */

  function rowHtml(r, max) {
    const w = max > 0 ? Math.min(100, (r[2] / max) * 100) : 0;
    return `<div class="bf-row" data-p="${r[0]}"><i class="d" style="--w:${w.toFixed(1)}%"></i>` +
      `<span class="p">${U.fmtPrice(r[0])}</span><span class="q">${OB.fmtQty(r[1])}</span>` +
      `<span class="t">${OB.fmtQty(r[2])}</span></div>`;
  }

  OB.renderBook = function () {
    const boxA = el('bookAsks');
    const boxB = el('bookBids');
    if (!boxA || !boxB) return;
    const b = OB.state.book;
    if (!b) { boxA.innerHTML = ''; boxB.innerHTML = ''; return; }
    const max = Math.max(b.asks[b.asks.length - 1][2] || 0, b.bids[b.bids.length - 1][2] || 0) || 1;
    // Se pintan en el orden que devuelve el exchange (mejor primero). El orden
    // VISUAL lo decide la hoja: `.bf-asks` es `column-reverse`, así que la mejor
    // venta cae abajo, pegada al precio último, y la más lejana arriba —como en
    // Bitunix—. Su columna «Total» (acumulada) es por eso máxima en la fila de
    // arriba. No invertir también el array: se harían dos volteos y quedaría al revés.
    boxA.innerHTML = b.asks.map((r) => rowHtml(r, max)).join('');
    boxB.innerHTML = b.bids.map((r) => rowHtml(r, max)).join('');

    const px = App.currentPrice();
    const last = el('bookLast');
    if (last) last.textContent = px ? U.fmtPrice(px) : '—';
    // flecha según la última vela: verde si sube, rojo si baja
    const n = App.candles && App.candles.length ? App.candles[Math.min(BR.state.index, App.candles.length - 1)] : null;
    const arrow = el('bookArrow');
    const wrap = last && last.parentElement;
    if (arrow && n) {
      const up = n.close >= n.open;
      arrow.textContent = up ? '↑' : '↓';
      if (wrap) wrap.classList.toggle('up', up), wrap.classList.toggle('dn', !up);
    }
    // banda bid/ask del pie del libro
    const bq = b.bids.reduce((s, r) => s + r[1], 0);
    const aq = b.asks.reduce((s, r) => s + r[1], 0);
    const tot = bq + aq || 1;
    const bidPct = (bq / tot) * 100;
    const bar = el('bookBidBar');
    if (bar) bar.style.width = bidPct.toFixed(1) + '%';
    const askBar = el('bookAskBar');
    if (askBar) askBar.style.width = (100 - bidPct).toFixed(1) + '%';
    setTxt('bookBidPct', 'B ' + U.num(bidPct, 2) + ' %');
    setTxt('bookAskPct', 'S ' + U.num(100 - bidPct, 2) + ' %');
    const srcTag = el('bookSrc');
    if (srcTag) {
      srcTag.textContent = b.src === 'derivado' ? 'derivado' : (b.src || 'real');
      srcTag.title = b.src === 'derivado'
        ? 'Libro DERIVADO de la vela del replay (no existe un libro histórico por vela). Activa «live» para ver el libro real del exchange.'
        : 'Libro real: ' + (b.src || '—');
    }
  };

  /** Ventana de 24 h calculada SOBRE LAS VELAS CARGADAS (datos reales). */
  OB.stats24FromCandles = function () {
    const arr = App.candles || [];
    const idx = Math.min(BR.state.index, arr.length - 1);
    if (idx < 1) return null;
    const tf = (DS.TIMEFRAMES && DS.TIMEFRAMES[App.interval]) || { ms: 3600e3 };
    const tfMs = tf.ms;
    const span = Math.max(1, Math.round(86400000 / tfMs));
    const from = Math.max(0, idx - span + 1);
    let high = -Infinity, low = Infinity, vol = 0, quote = 0;
    for (let i = from; i <= idx; i++) {
      const c = arr[i];
      if (!c) continue;
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      vol += c.volume || 0;
      quote += c.quoteVolume || (c.volume || 0) * c.close;
    }
    const open = arr[from].open;
    const last = arr[idx].close;
    return { open, last, high, low, vol, quote, chgPct: open ? ((last - open) / open) * 100 : 0, from, to: idx };
  };

  OB.renderStats = function () {
    const px = App.currentPrice();
    const n = App.candles && App.candles.length ? App.candles[Math.min(BR.state.index, App.candles.length - 1)] : null;
    setTxt('bfLast', px ? U.fmtPrice(px) : '—');
    if (px && n) setCls('bfLast', n.close >= n.open ? 'up' : 'dn');

    const meta = OB.state.meta || null;
    const live = OB.state.live;

    // 24 h: siempre sobre las velas cargadas (siempre es histórico real del replay)
    const s24 = OB.stats24FromCandles();
    const real24 = live && OB.state.t24 ? OB.state.t24 : null;
    const g = real24 || s24;
    if (g) {
      setTxt('bfChg24', (g.chgPct >= 0 ? '+' : '') + U.num(g.chgPct, 2) + ' %');
      setCls('bfChg24', g.chgPct >= 0 ? 'up' : 'dn');
      setTxt('bfHighLow', 'máx ' + U.fmtPrice(g.high) + ' · mín ' + U.fmtPrice(g.low));
      setTxt('bfVol', OB.fmtUsd(g.vol) + ' ' + (DS.baseOf ? DS.baseOf(App.pair) : ''));
      setTxt('bfVolQuote', OB.fmtUsd(g.quote) + ' USDT');
      el('bfChg24').title = (real24 ? 'Variación de 24 h REAL (espejo spot de Binance).'
        : 'Variación de 24 h CALCULADA sobre las velas del replay (' + (s24 ? s24.to - s24.from + 1 : 0) + ' velas).') +
        ' Máx/mín del mismo tramo.';
    }

    // mark / índice: en el replay es el precio negociado; en live, el del exchange
    const markEl = el('bfMark');
    if (markEl) {
      const mv = live && meta && meta.mark ? meta.mark : px;
      markEl.textContent = mv ? U.fmtPrice(mv) : '—';
      markEl.title = (live && meta && meta.mark ? 'Precio de marca REAL de ' + meta.venues[0] + '.'
        : 'Mark del replay: se toma el cierre de la vela actual (el backtest no tiene precio de marca histórico).') +
        (meta && meta.mark ? '  ·  mark actual del exchange: ' + U.fmtPrice(meta.mark) : '');
      setTxt('bfIndex', 'índice ' + (live && meta && meta.index ? U.fmtPrice(meta.index) : (px ? U.fmtPrice(px) : '—')));
    }

    // funding: solo existe en futuros; el valor real es el de hoy (no histórico)
    const fEl = el('bfFunding');
    if (fEl) {
      if (meta && Number.isFinite(meta.funding)) {
        fEl.textContent = (meta.funding * 100).toFixed(4) + ' %';
        setCls('bfFunding', meta.funding > 0 ? 'up' : meta.funding < 0 ? 'dn' : '');
        fEl.title = 'Tipo de financiación REAL actual (' + (meta.venues[1] || 'Bitget USDT-FUTURES') +
          '), cada ' + (meta.fundingEvery || 8) + ' h. Es el valor de hoy: el replay no tiene histórico de funding.';
      } else {
        // Sin dato real NO se inventa un funding: se deja vacío y se explica.
        fEl.textContent = '—';
        setCls('bfFunding', '');
        fEl.title = 'Funding no disponible: el exchange no respondió. En el backtest no se inventa un tipo de financiación.';
      }
      setTxt('bfFundingNext', meta && meta.nextFunding ? 'en ' + OB.countdown(meta.nextFunding) : '—');
    }

    // interés abierto
    const oiEl = el('bfOi');
    if (oiEl) {
      if (meta && Number.isFinite(meta.oi) && meta.oi > 0) {
        oiEl.textContent = OB.fmtUsd(meta.oi) + ' ' + (DS.baseOf ? DS.baseOf(App.pair) : '');
        oiEl.title = 'Interés abierto REAL declarado por ' + (meta.venues[0] || 'el exchange') +
          ' (unidades del exchange). Es el valor de hoy, no el de la vela del replay.';
        setTxt('bfOiVal', 'en ' + OB.fmtUsd(meta.oi * (px || meta.mark || 0)) + ' USDT');
      } else {
        oiEl.textContent = '—';
        oiEl.title = 'Interés abierto no disponible (el exchange no respondió).';
        setTxt('bfOiVal', '—');
      }
    }

    // reparto long/short de cuentas
    const lsEl = el('bfLs');
    if (lsEl) {
      if (meta && Number.isFinite(meta.longPct)) {
        const lp = meta.longPct;
        lsEl.textContent = 'L ' + U.num(lp, 2) + ' % / S ' + U.num(meta.shortPct, 2) + ' %';
        const bar = el('bfLsLong');
        if (bar) bar.style.width = Math.max(0, Math.min(100, lp)) + '%';
        lsEl.title = 'Proporción de cuentas en largo/corto REAL (' + (meta.venues[0] || 'Bitget') +
          (meta.lsTs ? ', instante ' + U.fmtDateEs(Math.round(meta.lsTs / 1000)) : '') + ').';
      } else {
        lsEl.textContent = '—';
        lsEl.title = 'Reparto long/short no disponible (sin respuesta del exchange).';
      }
    }

    // espejo de la cuenta, para no duplicar cálculos: el propio panel lo pinta
    const free = el('acFree');
    const eq = el('acEquity');
    setTxt('bfAvail', free ? free.textContent : '—');
    setTxt('bfEquity', eq ? 'equity ' + eq.textContent : '—');

    // resumen de procedencia, siempre visible
    const src = el('bfSource');
    if (src) {
      const partes = [];
      partes.push(live ? 'libro y 24 h: ' + (OB.state.book && OB.state.book.src !== 'derivado' ? 'espejo spot Binance' : 'derivado') : 'libro: derivado del replay');
      partes.push(meta && meta.mark ? 'mark/OI/funding: ' + meta.venues.join(' + ') : 'futuros: sin dato');
      src.textContent = partes.join(' · ');
      src.title = (OB.state.errors.length ? 'Avisos: ' + OB.state.errors.join(' · ') : 'Sin avisos de red.');
    }
  };

  OB.render = function () {
    OB.state.renders++;
    OB.renderBook();
    OB.renderStats();
  };

  /* ------------------------------- red ------------------------------- */

  /** Pregunta al exchange (libro + 24 h + futuros). Los fallos no lanzan. */
  OB.poll = async function (force) {
    const now = Date.now();
    if (!force && now - OB.state.lastPoll < OB.POLL_MS) return false;
    OB.state.lastPoll = now;
    OB.state.polls++;
    OB.state.errors = [];
    const symbol = App.pair;
    const atHead = BR.state.index >= (App.candles.length - 1);
    try {
      OB.state.book = Object.assign({ src: 'spot Binance' }, await DS.MARKET.depth(symbol, 30));
    } catch (e) {
      OB.state.errors.push('libro: ' + (e && e.message || e));
      OB.state.book = null;
    }
    try { OB.state.t24 = await DS.MARKET.ticker24(symbol); }
    catch (e) { OB.state.errors.push('24h: ' + (e && e.message || e)); }
    try { OB.state.meta = await DS.MARKET.futuresMeta(symbol); }
    catch (e) { OB.state.errors.push('futuros: ' + (e && e.message || e)); OB.state.meta = null; }
    if (!OB.state.book) OB.fillDerivedBook();
    OB.state.atHead = !!atHead;
    OB.render();
    return true;
  };

  /** Libro derivado de la vela del cursor (modo replay). */
  OB.fillDerivedBook = function () {
    const n = App.candles && App.candles.length ? App.candles[Math.min(BR.state.index, App.candles.length - 1)] : null;
    const px = (n && n.close) || App.currentPrice();
    if (!Number.isFinite(px)) return;
    OB.state.book = OB.derivedBook(px, n, App.pair);
  };

  /**
   * Refresco en cada vela del replay. El libro derivado se rehace SIEMPRE
   * (cuesta microsegundos y así el panel acompaña al gráfico); el real solo
   * cuando el usuario pide el modo live.
   */
  OB.onTick = function () {
    if (OB.state.pair !== App.pair) { OB.state.pair = App.pair; OB.state.meta = null; OB.state.t24 = null; }
    if (!OB.state.live || !OB.state.book || OB.state.book.src === 'derivado') OB.fillDerivedBook();
    OB.render();
  };

  OB.setLive = function (on) {
    OB.state.live = !!on;
    const b = el('btnBookLive');
    if (b) {
      b.classList.toggle('on', OB.state.live);
      b.classList.toggle('off', !OB.state.live);
      b.textContent = OB.state.live ? 'live' : 'fijar';
    }
    if (OB.state.live) { OB.poll(true); OB.timer = setInterval(() => { if (OB.state.live) OB.poll(false); }, OB.POLL_MS); }
    else {
      if (OB.timer) clearInterval(OB.timer);
      OB.timer = null;
      OB.state.book = null;
      OB.fillDerivedBook();
      OB.render();
    }
    U.log(OB.state.live ? '📡 Libro en vivo (espejo spot + futuros Bitget)' : '🔒 Libro fijado a las velas del replay', 'sys');
  };

  /* ------------------------------ arranque ------------------------------ */

  OB.init = function () {
    OB.state.pair = App.pair;
    OB.fillDerivedBook();
    OB.render();
    const btn = el('btnBookLive');
    if (btn) btn.addEventListener('click', () => OB.setLive(!OB.state.live));
    if (btn) { btn.classList.add('off'); btn.textContent = 'fijar'; }

    // pinchar una fila del libro prepara una orden límite a ese precio
    const card = el('bookCard');
    if (card) card.addEventListener('click', (ev) => {
      const row = ev.target.closest ? ev.target.closest('.bf-row') : null;
      if (!row) return;
      const p = +row.dataset.p;
      if (!Number.isFinite(p)) return;
      const inp = el('limitInput');
      if (inp) { inp.value = p; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      const seg = el('segOrderType');
      if (seg) {
        const b = seg.querySelector('[data-otype="limite"]');
        if (b) b.click();
      }
      U.toast('Precio límite ' + U.fmtPrice(p) + ' tomado del libro', 'info', 1600);
    });

    // cuenta atrás del funding (1 s, solo si hay fecha real de próxima liquidación)
    setInterval(() => {
      const m = OB.state.meta;
      if (m && m.nextFunding) setTxt('bfFundingNext', 'en ' + OB.countdown(m.nextFunding));
    }, 1000);

    // primer intento de datos reales, sin bloquear el arranque
    OB.poll(true).then(() => { if (!OB.state.live) { OB.state.book = null; OB.fillDerivedBook(); OB.render(); } });
  };

  global.OB = OB;
})(window);
