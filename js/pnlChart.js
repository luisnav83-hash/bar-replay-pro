/* =========================================================================
 * pnlChart.js — La posición, MARCADA en el gráfico, y su PnL a la vista.
 *
 * Hace tres cosas (todas opcionales con el botón «📈 PnL» de la barra de
 * herramientas, y la preferencia se guarda en localStorage):
 *
 *   1) MARCADORES sobre las velas: flecha en la vela de entrada (con tamaño y
 *      precio), punto azul en cada promediado, punto verde en cada cierre
 *      parcial y una flecha final con el PnL cuando la posición se cierra
 *      (el resumen se queda visible hasta la siguiente operación).
 *   2) BANDA DE PnL sobre el precio: un rectángulo translúcido entre el precio
 *      de entrada y el precio actual, desde la vela de entrada hasta la actual,
 *      verde si vas ganando y rojo si pierdes, con una etiqueta flotante que
 *      dice cuánto («+$123,45 · +1,78 %») y cuánto se ha movido en la última
 *      vela. Es la forma más directa de «ver cómo sube o baja el PnL» sin
 *      quitar los ojos del gráfico.
 *   3) PANEL DE PnL: una curva (baseline verde/roja con el 0 como línea de
 *      agua) del PnL no realizado vela a vela desde la entrada, con líneas en
 *      su máximo y su mínimo. Reutiliza la maquinaria de paneles de
 *      js/chart.js, así que se alinea sola con el rango visible del principal.
 *
 * Convenio de signos: el PnL del panel es el NO REALIZADO de lo que queda vivo
 * (`(close − media) · qty · dir`), que es exactamente el número que muestra la
 * tarjeta de posición en la vela actual. Lo ya realizado por cierres parciales
 * se enseña aparte, en la propia etiqueta, para no mezclar conceptos.
 * --------------------------------------------------------------------------*/
(function (global) {
  'use strict';

  const PC = {};
  const KEY = 'pnlGrafico';           // preferencia: marcar posición y PnL

  PC.enabled = true;                   // se abre en PC.init() según lo guardado
  PC.chart = null;                     // gráfico del panel (LightweightCharts)
  PC.series = null;                    // su serie baseline
  PC.trace = [];                       // [{time, pnl}] de la posición actual
  PC.recap = null;                     // resumen de la última posición cerrada
  PC._sig = '';                        // huella de lo dibujado (para no recalcular cada fotograma)
  PC._extremes = [];                   // líneas de máx/mín creadas (para retirarlas)
  PC._hadPos = false;                  // ¿había posición abierta en el refresco anterior?

  /* ------------------------------ utilidades ------------------------------ */

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Dólares con signo, estilo europeo: +$1.234,56 / −$45,00. */
  function usd(v) {
    if (!isNum(v)) return '—';
    const s = Math.abs(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '−$' : v > 0 ? '+$' : '$') + s;
  }

  /** Porcentaje con signo: +1,78 % / −0,45 %. */
  function pct(v) {
    if (!isNum(v)) return '—';
    return (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(2).replace('.', ',') + ' %';
  }

  /** Índice de la vela con ese tiempo, buscando hacia atrás desde `desde`. */
  function indexOfTime(t, desde) {
    const c = App.candles;
    if (!c.length || t === null || t === undefined) return -1;
    for (let i = Math.min(desde === undefined ? c.length - 1 : desde, c.length - 1); i >= 0; i--) {
      if (c[i].time === t) return i;
      if (c[i].time < t) return i;              // el cursor está entre dos velas
    }
    return 0;
  }

  function el(id) { return document.getElementById(id); }

  function cls(node, nombre, on) { if (node) node.classList.toggle(nombre, !!on); }

  /** Signo de la banda: con la posición cerrada manda el PnL final realizado. */
  function pnlBanda(precio, s, dir) {
    if (!s.vivo) return s.pnl;
    return isNum(precio) ? (precio - s.entryPrice) * s.qty * dir : 0;
  }

  /** Color del PnL (verde Bitunix arriba, rojo abajo). */
  const colorDe = (v) => (v > 0 ? '#25ca93' : v < 0 ? '#f65b55' : '#8b8e96');

  /**
   * De qué posición se habla: la abierta si la hay; si no, el resumen de la
   * última cerrada (para que el marcaje y la curva no desaparezcan de golpe al
   * pulsar «cerrar», que es justo cuando uno quiere ver qué ha pasado).
   */
  PC.source = function () {
    const p = TE.state.position;
    if (p) {
      return { vivo: true, side: p.side, qty: p.qty, entryPrice: p.entryPrice, entryTime: p.entryTime,
               parts: p.parts || [], realized: p.realizedParcial || 0, tpLevels: (p.tpLevels || []).length,
               sl: p.sl, tp: p.tp, additions: p.additions || 0 };
    }
    if (PC.recap) return Object.assign({ vivo: false }, PC.recap);
    return null;
  };

  /* --------------------------- huella y construcción --------------------------- */

  /** Si la huella no cambia, no hay nada que recalcular (esto corre por fotograma). */
  PC.signature = function () {
    const s = PC.source();
    if (!s) return 'vacío';
    return [s.side, s.qty.toFixed(10), s.entryPrice.toFixed(6), s.entryTime, s.vivo,
            (s.parts || []).length, (s.additions || 0), s.tpLevels || 0, s.sl, s.tp,
            BR.getIndex(), App.currentPrice(), TE.state.trades.length].join('|');
  };

  /**
   * Curva de PnL no realizado, vela a vela, desde la entrada hasta el cursor.
   * Con cierres parciales el tamaño de las velas pasadas era mayor que el actual:
   * se anota en el comentario del panel (y en la prueba) que la curva usa el
   * tamaño VIGENTE, que es lo que permite comparar el número con la tarjeta.
   */
  PC.build = function () {
    const s = PC.source();
    if (!s) { PC.trace = []; return null; }
    const dir = s.side === 'long' ? 1 : -1;
    const i0 = Math.max(0, indexOfTime(s.entryTime, BR.getIndex()));
    // Si la posición está cerrada, la curva muere en la vela de salida.
    const i1 = s.vivo ? BR.getIndex() : Math.min(BR.getIndex(), Math.max(i0, indexOfTime(s.exitTime, BR.getIndex())));
    if (i1 < i0) { PC.trace = []; return s; }
    const out = [];
    for (let i = i0; i <= i1; i++) {
      const c = App.candles[i];
      if (!c) continue;
      out.push({ time: c.time, pnl: +((c.close - s.entryPrice) * s.qty * dir).toFixed(6), i });
    }
    // La última vela del tramo es la del cursor: si el precio actual difiere del
    // close (replay a media vela, o último precio del motor), se usa ESE para que
    // el punto final coincida con el número de la tarjeta de posición.
    if (out.length && s.vivo) {
      const last = App.currentPrice();
      if (isNum(last)) out[out.length - 1].pnl = +((last - s.entryPrice) * s.qty * dir).toFixed(6);
    }
    PC.trace = out;
    return s;
  };

  /* ------------------------------- panel PnL ------------------------------- */

  PC.init = function () {
    PC.enabled = !!(global.ST && ST.get) ? ST.get(KEY, true) !== false : true;

    const cont = el('chartPnl');
    if (cont && global.LightweightCharts && !PC.chart) {
      const COLORS = { bg: '#141418', text: '#8b8e96', grid: '#1d1d22', border: '#26262c' };
      PC.chart = LightweightCharts.createChart(cont, {
        autoSize: true,
        layout: { background: { type: 'solid', color: COLORS.bg }, textColor: COLORS.text, fontSize: 9, fontFamily: 'ui-monospace, monospace' },
        grid: { vertLines: { color: '#17171b' }, horzLines: { color: COLORS.grid } },
        rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.18, bottom: 0.12 } },
        timeScale: { visible: false, borderColor: COLORS.border },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        handleScroll: false, handleScale: false,
        // Sin marca de agua en el panel: la del gráfico principal basta y aquí solo
        // taparía la curva (Lightweight Charts la pinta en CADA chart que se crea).
        Watermark: { color: 'transparent', visible: false },
        localization: { priceFormatter: (v) => usd(v) },
      });
      // Baseline: todo lo que queda por encima del 0 se rellena de verde y lo de
      // debajo, de rojo. El eje se formatea en dólares (ver priceFormatter).
      PC.series = PC.chart.addBaselineSeries({
        baseValue: { type: 'price', price: 0 },
        topLineColor: '#25ca93', topFillColor1: 'rgba(37,202,147,.34)', topFillColor2: 'rgba(37,202,147,.04)',
        bottomLineColor: '#f65b55', bottomFillColor1: 'rgba(246,91,85,.04)', bottomFillColor2: 'rgba(246,91,85,.34)',
        lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      });
      // Que el panel se alinee con el rango visible del gráfico principal, igual
      // que los paneles de indicadores (CM._syncPanes recorre CM.panes).
      CM.panes.pnl = PC.chart;
      CM.paneSeries.pnlArea = PC.series;
    }

    // Botón de la barra de herramientas: enciende/apaga marcaje + banda + panel.
    const btn = el('btnPnl');
    if (btn) {
      btn.addEventListener('click', () => PC.setEnabled(!PC.enabled));
      btn.setAttribute('aria-pressed', PC.enabled ? 'true' : 'false');
    }
    const cerrar = el('pnlPaneClose');
    if (cerrar) cerrar.addEventListener('click', () => PC.setEnabled(false));

    // La capa DOM va sobre el gráfico: hay que recolocarla al hacer scroll, zoom
    // o resize (los marcadores y la serie se reposicionan solos; la capa, no).
    try {
      CM.main.timeScale().subscribeVisibleLogicalRangeChange(() => PC.place());
    } catch (e) { /* el chart puede no estar listo en el arranque */ }
    window.addEventListener('resize', () => PC.place());

    cls(btn, 'active', PC.enabled);
    if (el('panePnl')) el('panePnl').classList.toggle('hidden', !PC.enabled);
    PC.refresh(true);
  };

  PC.setEnabled = function (on, silencioso) {
    PC.enabled = !!on;
    if (global.ST && ST.set) ST.set(KEY, PC.enabled);
    cls(el('btnPnl'), 'active', PC.enabled);
    if (el('btnPnl')) el('btnPnl').setAttribute('aria-pressed', PC.enabled ? 'true' : 'false');
    cls(el('panePnl'), 'hidden', !PC.enabled);
    if (!PC.enabled) { PC.clearMarks(); PC.hideLayer(); if (PC.series) PC.series.setData([]); }
    else PC.refresh(true);
    try { CM._syncPanes(CM.main.timeScale().getVisibleLogicalRange()); } catch (e) {}
    if (!silencioso) U.log(`📈 PnL en el gráfico ${PC.enabled ? 'ACTIVADO' : 'desactivado'}`, 'sys');
  };

  /* ------------------------------- refrescado ------------------------------- */

  /**
   * Punto de entrada único: se llama desde UI.refreshAll() (cada paso del replay,
   * cada orden, cada cambio de tamaño) y desde los listeners de scroll/resize.
   * Solo recalcula la curva si cambió algo material; si no, mueve la capa DOM.
   */
  PC.refresh = function (forzar) {
    if (!global.TE || !global.CM || !CM.series || !CM.series.candles) return;
    // Al pasar de «posición abierta» a «sin posición» se guarda PRIMERO el resumen
    // de la última fila cerrada y se fuerza el repintado: el marcador de salida y la
    // etiqueta «· cerrado» tienen que aparecer en EL MISMO refresco en el que se
    // cierra (si se leyera la fuente antes, este refresco pintaría «no hay nada» y
    // el resumen quedaría un fotograma en el aire).
    if (PC._hadPos && !TE.state.position) { PC.captureRecap(); forzar = true; }
    PC._hadPos = !!TE.state.position;

    const s = PC.source();

    if (!PC.enabled) { PC.hideLayer(); return; }
    if (!s) { PC.clearMarks(); PC.hideLayer(); if (PC.series) PC.series.setData([]); PC._sig = ''; cls(el('chartWrap'), 'pnl-on', false); return; }

    const sig = PC.signature();
    if (forzar || sig !== PC._sig) {
      PC._sig = sig;
      PC.build();
      PC.paintSeries();
      PC.paintMarks();
    }
    PC.paintBadge();
    PC.place();
  };

  /**.freeze de la última operación cerrada (para follow-up en el gráfico). */
  PC.captureRecap = function () {
    const cerrados = TE.state.trades.filter((t) => t.status === 'closed' && !t.parcial);
    const t = cerrados.length ? cerrados[cerrados.length - 1] : null;
    if (!t) return;
    PC.recap = { side: t.side, qty: t.qty, entryPrice: t.entryPrice, entryTime: t.entryTime,
                 exitTime: t.exitTime, exitPrice: t.exitPrice, pnl: t.pnl, reason: t.reason,
                 parts: [], realized: t.pnl, additions: t.additions || 0, vivo: false };
  };

  /** Curva del panel + líneas de máximo y mínimo. */
  PC.paintSeries = function () {
    if (!PC.series) return;
    const datos = PC.trace.filter((p) => p && isNum(p.pnl)).map((p) => ({ time: p.time, value: p.pnl }));
    PC.series.setData(datos);
    PC._extremes.forEach((l) => { try { PC.series.removePriceLine(l); } catch (e) {} });
    PC._extremes = [];
    if (datos.length > 1) {
      const mx = datos.reduce((a, b) => (b.value > a.value ? b : a));
      const mn = datos.reduce((a, b) => (b.value < a.value ? b : a));
      [[mx, 'PnL máx'], [mn, 'PnL mín']].forEach(([p, titulo]) => {
        if (Math.abs(p.value) < 1e-9) return;
        try {
          PC._extremes.push(PC.series.createPriceLine({
            price: p.value, color: p.value > 0 ? 'rgba(37,202,147,.55)' : 'rgba(246,91,85,.55)',
            lineWidth: 1, lineStyle: 2, axisLabelVisible: false,
            title: `${titulo} ${usd(p.value)}`,
          }));
        } catch (e) { /* la librería puede rechazar precios fuera de rango */ }
      });
    }
    const val = el('pnlPaneVal');
    if (val) {
      const ult = datos.length ? datos[datos.length - 1].value : 0;
      const s = PC.source();
      const realizado = s && !s.vivo ? 0 : (s ? s.realized : 0);
      val.textContent = `${usd(ult)}${realizado ? ' · realizado ' + usd(realizado) : ''}`;
      val.style.color = colorDe(ult);
      const sub = el('pnlPaneNote');
      if (sub) { const n = PC.trace.length;   // «1 vela» y «5 velas»: el texto se pone
        sub.textContent = s && s.vivo ? `${n} ${n === 1 ? 'vela' : 'velas'} desde la entrada` : 'última operación'; }
    }
  };

  /** Marcadores sobre las velas (entrada, promediados, parciales, cierre). */
  PC.paintMarks = function () {
    const s = PC.source();
    const serie = CM.series && CM.series.candles;
    if (!serie) return;
    if (!s) { PC.clearMarks(); return; }
    const marcas = [];
    const existe = (t) => App.candles.some((c) => c.time === t);
    const up = '#25ca93', down = '#f65b55';
    const lado = s.side === 'long';
    const fmt = (v) => U.fmtPrice(v);

    if (existe(s.entryTime)) {
      marcas.push({ time: s.entryTime, position: lado ? 'belowBar' : 'aboveBar',
                    color: lado ? up : down, shape: lado ? 'arrowUp' : 'arrowDown',
                    text: `${lado ? 'LONG' : 'SHORT'} ${s.qty.toLocaleString('es-ES', { maximumFractionDigits: 6 })} @ ${fmt(s.entryPrice)}` });
    }
    // Cada promediado queda marcado con su precio (la primera parte ya es la de arriba).
    (s.parts || []).forEach((pt, i) => {
      if (!i || !existe(pt.time)) return;
      marcas.push({ time: pt.time, position: 'belowBar', color: '#2979ff', shape: 'circle',
                    text: `#${i + 1} ${fmt(pt.entryPrice)}` });
    });
    // Cierres parciales (TP escalonado o botón de cerrar parte).
    TE.state.trades.filter((t) => t.status === 'closed' && t.parcial && existe(t.exitTime)).forEach((t) => {
      marcas.push({ time: t.exitTime, position: t.pnl >= 0 ? 'aboveBar' : 'belowBar',
                    color: t.pnl >= 0 ? up : down, shape: 'circle',
                    text: `parcial ${usd(t.pnl)}` });
    });
    // Cierre total: se marca y se pone el resultado final en el propio gráfico.
    if (!s.vivo && s.exitTime && existe(s.exitTime)) {
      marcas.push({ time: s.exitTime, position: s.pnl >= 0 ? 'aboveBar' : 'belowBar',
                    color: s.pnl >= 0 ? up : down, shape: s.pnl >= 0 ? 'arrowDown' : 'arrowUp',
                    text: `CERRADO ${usd(s.pnl)} · ${s.reason || 'manual'}` });
    }

    marcas.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    PC._marcasTxt = marcas.map((m) => m.text);
    try { serie.setMarkers(marcas); PC._marks = marcas.length; } catch (e) { PC._marks = -1; }
  };

  PC.clearMarks = function () {
    try { if (CM.series && CM.series.candles) CM.series.candles.setMarkers([]); } catch (e) {}
    PC._marks = 0; PC._marcasTxt = [];
  };

  /* ------------------------- capa DOM: banda + etiqueta ------------------------- */

  PC.hideLayer = function () {
    ['pnlLayer', 'pnlBand', 'pnlEntryTick', 'pnlBadge'].forEach((id) => cls(el(id), 'hidden', true));
    cls(el('chartWrap'), 'pnl-on', false);
  };

  /** Texto y color de la etiqueta flotante (se refresca en cada vela). */
  PC.paintBadge = function () {
    const s = PC.source();
    const b = el('pnlBadge');
    if (!b || !s) return;
    const dir = s.side === 'long' ? 1 : -1;
    const precio = s.vivo ? App.currentPrice() : s.exitPrice;
    const pnl = s.vivo
      ? (isNum(precio) ? (precio - s.entryPrice) * s.qty * dir : NaN)
      : s.pnl;                                   // cerrado: el PnL realizado final
    const base = s.entryPrice * s.qty;
    const porcentaje = base ? (pnl / base) * 100 : NaN;
    const antes = (s.vivo && PC.trace.length > 1) ? PC.trace[PC.trace.length - 2].pnl : pnl;
    const delta = pnl - antes;
    setText('pnlBadgeVal', usd(pnl));
    setText('pnlBadgePct', pct(porcentaje));
    const dEl = el('pnlBadgeDelta');
    if (dEl) {
      dEl.textContent = `${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${usd(delta)}`;
      dEl.style.color = colorDe(delta);
    }
    b.style.borderColor = colorDe(pnl);
    b.classList.toggle('ganando', pnl > 0);
    b.classList.toggle('perdiendo', pnl < 0);
    const q = el('pnlBadgeQty');
    if (q) q.textContent = `${s.side === 'long' ? 'LONG' : 'SHORT'} ${s.qty.toLocaleString('es-ES', { maximumFractionDigits: 6 })} @ ${U.fmtPrice(s.entryPrice)}${s.vivo ? '' : ' · cerrado'}`;
    const r = el('pnlBadgeReal');
    if (r) {
      const real = s.vivo ? (s.realized || 0) : 0;
      r.textContent = real ? `realizado ${usd(real)}` : '';
      r.classList.toggle('hidden', !real);
    }
    PC._actual = pnl;
  };

  /**
   * Recoloca la capa: la banda va del precio de entrada al actual, entre la vela
   * de entrada y la del cursor. Si alguna de las dos coordenadas no existe (la
   * entrada se ha ido del rango visible), la banda se recorta al borde izquierdo,
   * que es lo que espera el ojo: «la operación sigue viva por ahí a la izquierda».
   */
  PC.place = function () {
    const s = PC.source();
    const L = el('pnlLayer'), banda = el('pnlBand'), tick = el('pnlEntryTick'), b = el('pnlBadge');
    if (!PC.enabled || !s || !L || !CM.main) { PC.hideLayer(); return; }
    const w = el('mainChart');
    if (!w) return;
    const ancho = w.clientWidth, alto = w.clientHeight;
    const dir = s.side === 'long' ? 1 : -1;
    const precio = App.currentPrice();
    const x0 = CM.timeToX(s.entryTime);
    const tFin = PC.trace.length ? PC.trace[PC.trace.length - 1].time
                                 : ((App.candles[BR.getIndex()] || {}).time);
    const x1 = tFin === undefined || tFin === null ? null : CM.timeToX(tFin);
    const yEnt = CM.priceToY(s.entryPrice);
    const yAct = CM.priceToY(precio);   // cerrado => precio de salida (la banda muere ahí)
    cls(L, 'hidden', false);
    cls(el('chartWrap'), 'pnl-on', true);
    const visible = isNum(yEnt) && isNum(yAct) && isNum(x1) && x1 !== null;
    cls(banda, 'hidden', !visible);
    cls(tick, 'hidden', x0 === null);
    if (x0 !== null) tick.style.left = Math.round(Math.max(0, x0)) + 'px';
    if (visible) {
      const izq = Math.max(0, x0 === null ? 0 : x0);
      const der = Math.max(izq + 2, x1);
      banda.style.left = Math.round(izq) + 'px';
      banda.style.width = Math.round(Math.min(ancho, der) - izq) + 'px';
      banda.style.top = Math.round(Math.min(yEnt, yAct)) + 'px';
      banda.style.height = Math.max(2, Math.round(Math.abs(yAct - yEnt))) + 'px';
      const ganando = pnlBanda(precio, s, dir) >= 0;
      banda.classList.toggle('neg', !ganando);
      banda.classList.toggle('pos', ganando);
    }
    cls(b, 'hidden', !visible);
    if (visible) {
      // La etiqueta se pega a la última vela; si no cabe, se mete hacia dentro.
      const anchoB = b.offsetWidth || 150;
      const x = Math.max(6, Math.min(ancho - anchoB - 6, x1 + 8));
      let arriba = yAct - (b.offsetHeight || 40) / 2;
      const ley = el('ohlcLegend');
      if (ley) {
        const lr = ley.getBoundingClientRect(), rr = w.getBoundingClientRect();
        const chocaria = arriba < lr.bottom - rr.top + 4 && arriba + (b.offsetHeight || 40) > lr.top - rr.top - 4;
        if (chocaria) arriba = Math.max(arriba, lr.bottom - rr.top + 6);   // se mete debajo de la leyenda
      }
      b.style.left = Math.round(x) + 'px';
      b.style.top = Math.round(Math.max(4, Math.min(alto - (b.offsetHeight || 40) - 4, arriba))) + 'px';
    }
  };

  function setText(id, v) { const e = el(id); if (e) e.textContent = v; }

  /** Datos del último estado (para pruebas y para el panel de estadísticas). */
  PC.debug = function () {
    const s = PC.source();
    return {
      enabled: PC.enabled, velas: PC.trace.length,
      primero: PC.trace.length ? PC.trace[0].pnl : null,
      ultimo: PC.trace.length ? PC.trace[PC.trace.length - 1].pnl : null,
      max: PC.trace.length ? Math.max(...PC.trace.map((p) => p.pnl)) : null,
      min: PC.trace.length ? Math.min(...PC.trace.map((p) => p.pnl)) : null,
      actual: PC._actual === undefined ? null : PC._actual,
      marcas: PC._marks === undefined ? 0 : PC._marks,
      marcasTxt: PC._marcasTxt || [],
      vivo: !!(s && s.vivo), recap: !!PC.recap && !(s && s.vivo),
      bandaOculta: !!(el('pnlBand') && el('pnlBand').classList.contains('hidden')),
      etiqueta: el('pnlBadge') ? el('pnlBadge').textContent.replace(/\s+/g, ' ').trim() : '',
      panel: !!(el('panePnl') && !el('panePnl').classList.contains('hidden')),
      // La marca de agua de la librería debe estar apagada en el panel (es la opción
      // con la que se creó el chart; si vuelve a aparecer tapando la curva, esto la
      // delata). Se lee del propio chart, no de una copia en el código.
      agua: (function () {
        try {
          const o = PC.chart && PC.chart.options && PC.chart.options();
          return o && o.Watermark ? (o.Watermark.color === 'transparent' ? 'transparent' : o.Watermark.color) : 'sin-opcion';
        } catch (e) { return 'error'; }
      })(),
      serie: PC.series ? (PC.series.data ? PC.series.data().length : PC.trace.length) : 0,
      colores: { banda: el('pnlBand') ? [...el('pnlBand').classList].filter((c) => c === 'pos' || c === 'neg').join('+') : '',
                 badge: el('pnlBadge') ? [...el('pnlBadge').classList].filter((c) => c === 'ganando' || c === 'perdiendo').join('+') : '' },
      geometria: (() => {
        const r = (id) => { const e = el(id); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
        return { capa: r('pnlLayer'), banda: r('pnlBand'), etiqueta: r('pnlBadge'), tick: r('pnlEntryTick'), chart: r('mainChart') };
      })(),
    };
  };

  /** Al cambiar de par/temporalidad o al recargar la serie, el resumen deja de aplicar. */
  PC.forgetSeries = function () { PC.recap = null; PC._sig = ''; PC.clearMarks(); PC.hideLayer(); };

  global.PC = PC;
})(window);
