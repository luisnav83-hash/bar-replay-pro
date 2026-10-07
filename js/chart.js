/* =========================================================================
 * chart.js — Gestión del gráfico de velas (TradingView Lightweight Charts v4).
 *
 *  · Gráfico principal: velas + volumen + medias y Bollinger + líneas de
 *    posición (entrada / SL / TP / liquidación).
 *  · Paneles inferiores sincronizados: RSI, MACD y ATR (cada uno su chart,
 *    con la misma escala temporal que el principal).
 *  · Gráfico de curva de capital (equity) en la barra lateral.
 *  · Render incremental: al avanzar una vela se usa series.update() (O(1));
 *    al retroceder o saltar se hace un rebuild con setData().
 *  · El acceso a coordenadas (precio ↔ píxel) se expone para las
 *    herramientas de dibujo que pintan sobre el canvas superpuesto.
 * =======================================================================*/
(function (global) {
  'use strict';

  const CM = {};

  const COLORS = {
    bg: '#0b0c16', grid: '#1b1d33', gridSoft: '#15162a', border: '#2c2f52',
    text: '#7d81a8', crosshair: '#5d628f',
    up: '#00c853', down: '#ff1744',
    entry: '#2979ff', sl: '#ff1744', tp: '#00e5ff', liq: '#ff9100',
  };

  /**
   * Formateador compacto para ejes que no son precios (MACD en USD, ATR…):
   * adapta los decimales a la magnitud y evita cosas como «0.0000000».
   */
  function compactFmt(v) {
    const a = Math.abs(v);
    if (v === 0) return '0';
    if (a >= 10000) return (v / 1000).toFixed(1) + 'k';
    if (a >= 1000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    if (a >= 0.0001) return v.toFixed(5);
    return v.toExponential(1);
  }
  CM.compactFmt = compactFmt;

  /* ------------------------------- Estado ------------------------------- */

  CM.candles = [];            // velas completas cargadas (todas)
  CM.indData = {};            // arrays de indicadores (misma longitud que candles)
  CM.cfg = {};                // configuración de indicadores activos
  CM.main = null;
  CM.series = {};
  CM.panes = { rsi: null, macd: null, atr: null };
  CM.paneSeries = {};
  CM.equityChart = null;
  CM.equitySeries = null;
  CM._lastIndex = -1;   // último índice dibujado (para el render incremental)
  CM._index = -1;      // índice actual del replay (persiste entre reconstrucciones)
  CM._priceLines = [];
  CM._hoverCandle = null;
  CM._syncing = false;
  CM.visible = { from: null, to: null };

  /* ============================== INICIALIZACIÓN ============================== */

  CM.init = function () {
    const common = {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: COLORS.bg }, textColor: COLORS.text,
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 10,
        // El logotipo de la librería se oculta en el canvas; el crédito a
        // TradingView Lightweight Charts se muestra en la esquina del gráfico
        // y en el README (la librería es Apache-2.0, © TradingView Inc.).
        attributionLogo: false,
      },
      grid: { vertLines: { color: COLORS.gridSoft }, horzLines: { color: COLORS.grid } },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: COLORS.crosshair, width: 1, style: 3, labelBackgroundColor: '#2979ff' },
        horzLine: { color: COLORS.crosshair, width: 1, style: 3, labelBackgroundColor: '#2979ff' },
      },
      localization: {
        priceFormatter: (p) => U.fmtPrice(p),
        locale: 'es-ES',
      },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 7, shiftVisibleRangeOnNewBar: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    };

    /* ---------------------- Gráfico principal ---------------------- */
    CM.main = LightweightCharts.createChart(document.getElementById('mainChart'), Object.assign({}, common));

    CM.series.candles = CM.main.addCandlestickSeries({
      upColor: COLORS.up, downColor: COLORS.down,
      borderUpColor: COLORS.up, borderDownColor: COLORS.down,
      wickUpColor: COLORS.up, wickDownColor: COLORS.down,
      priceLineVisible: false, lastValueVisible: true,
    });

    CM.series.volume = CM.main.addHistogramSeries({
      priceScaleId: 'vol', priceFormat: { type: 'volume' },
      priceLineVisible: false, lastValueVisible: false,
      color: '#5c6bc0',
    });
    CM.main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    /* ---------------------- Paneles inferiores ---------------------- */
    // El RSI es un índice 0-100: su eje usa un formateador propio (no precios)
    CM.panes.rsi = LightweightCharts.createChart(document.getElementById('chartRsi'), Object.assign({}, common, {
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { visible: false, borderColor: COLORS.border, timeVisible: true },
      localization: { priceFormatter: (v) => v.toFixed(1) },
    }));
    CM.paneSeries.rsiLine = CM.panes.rsi.addLineSeries({
      color: '#b388ff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });
    CM.paneSeries.rsiLine.createPriceLine({ price: 70, color: '#ff174488', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    CM.paneSeries.rsiLine.createPriceLine({ price: 30, color: '#00c85388', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    CM.paneSeries.rsiLine.createPriceLine({ price: 50, color: '#4a4e7d', lineWidth: 1, lineStyle: 3, axisLabelVisible: false });

    // El MACD es una diferencia de medias (en USD): decimales adaptados a la escala
    CM.panes.macd = LightweightCharts.createChart(document.getElementById('chartMacd'), Object.assign({}, common, {
      localization: { priceFormatter: compactFmt },
    }));
    CM.paneSeries.macdHist = CM.panes.macd.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    CM.paneSeries.macdLine = CM.panes.macd.addLineSeries({ color: '#40c4ff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    CM.paneSeries.macdSignal = CM.panes.macd.addLineSeries({ color: '#ffab40', lineWidth: 1.2, priceLineVisible: false, lastValueVisible: false });

    CM.panes.atr = LightweightCharts.createChart(document.getElementById('chartAtr'), Object.assign({}, common, {
      localization: { priceFormatter: compactFmt },
    }));
    CM.paneSeries.atrLine = CM.panes.atr.addLineSeries({ color: '#ffab40', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });

    /* ---------------------- Sincronización de rango ---------------------- */
    CM.main.timeScale().subscribeVisibleLogicalRangeChange((range) => CM._syncPanes(range));
    CM.main.subscribeCrosshairMove((param) => CM._onCrosshair(param));

    /* ---------------------- Curva de capital ---------------------- */
    CM.equityChart = LightweightCharts.createChart(document.getElementById('equityChart'), {
      autoSize: true,
      layout: { background: { type: 'solid', color: COLORS.bg }, textColor: COLORS.text, fontSize: 9, fontFamily: 'ui-monospace, monospace' },
      grid: { vertLines: { color: COLORS.gridSoft }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.15, bottom: 0.1 } },
      timeScale: { visible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Magnet },
      handleScroll: false, handleScale: false,
    });
    CM.equitySeries = CM.equityChart.addAreaSeries({
      lineColor: '#00e5ff', topColor: 'rgba(0,229,255,.35)', bottomColor: 'rgba(0,229,255,.02)',
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });
  };

  /** Reaplica el rango visible del principal a todos los paneles abiertos. */
  CM._syncPanes = function (range) {
    if (!range || CM._syncing) return;
    CM._syncing = true;
    try {
      Object.values(CM.panes).forEach((p) => {
        if (!p) return;
        try { p.timeScale().setVisibleLogicalRange(range); } catch (e) {}
      });
      // Range de tiempo visible (para dibujos y validaciones)
      const vr = CM.main.timeScale().getVisibleRange();
      CM.visible = vr ? { from: vr.from, to: vr.to } : { from: null, to: null };
    } finally { CM._syncing = false; }
  };

  /* ================================ DATOS ================================ */

  /** Carga las velas completas (no se dibujan aún: eso lo hace render()). */
  CM.setCandleData = function (candles) {
    CM.candles = candles || [];
    CM._lastIndex = -1;
  };

  CM.setCandle = function (candle) { CM.candles.push(candle); };

  /** Datos de indicadores precalculados por la app (arrays alineados). */
  CM.setIndicatorData = function (indData, cfg) {
    CM.indData = indData || {};
    CM.cfg = cfg || {};
    CM._applyIndicatorSeriesConfig();
    CM._lastIndex = -1;   // fuerza rebuild
  };

  /* --------------------- Configuración de series de indicadores --------------------- */

  CM._applyIndicatorSeriesConfig = function () {
    const cfg = CM.cfg, s = CM.series, ps = CM.paneSeries;

    const ensure = (key, opts) => {
      if (cfg[key] && cfg[key].on && !s[key]) s[key] = CM.main.addLineSeries(Object.assign({ priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, lineWidth: 1.5 }, opts));
      if (s[key] && opts) s[key].applyOptions(opts);
      if ((!cfg[key] || !cfg[key].on) && s[key]) { CM.main.removeSeries(s[key]); delete s[key]; }
    };

    ensure('sma', { color: cfg.sma ? cfg.sma.color : '#ffd54f' });
    ensure('ema', { color: cfg.ema ? cfg.ema.color : '#00e5ff' });
    ensure('ema2', { color: cfg.ema2 ? cfg.ema2.color : '#e040fb' });

    const bbOn = cfg.bb && cfg.bb.on;
    ['bbU', 'bbM', 'bbL'].forEach((k) => {
      if (bbOn && !s[k]) {
        s[k] = CM.main.addLineSeries({
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          lineWidth: k === 'bbM' ? 1 : 1.2,
          lineStyle: k === 'bbM' ? 0 : 0,
          color: cfg.bb.color,
        });
      }
      if (!bbOn && s[k]) { CM.main.removeSeries(s[k]); delete s[k]; }
    });

    // Volumen
    s.volume.applyOptions({ visible: !(cfg.vol && cfg.vol.on === false), color: cfg.vol ? cfg.vol.color : '#5c6bc0' });

    // RSI
    ps.rsiLine.applyOptions({ color: cfg.rsi ? cfg.rsi.color : '#b388ff' });
    // MACD
    ps.macdLine.applyOptions({ color: cfg.macd ? cfg.macd.color : '#40c4ff' });
    ps.macdSignal.applyOptions({ color: cfg.macd ? cfg.macd.signalColor : '#ffab40' });
    // ATR
    ps.atrLine.applyOptions({ color: cfg.atr ? cfg.atr.color : '#ffab40' });
  };

  /** Muestra u oculta los paneles inferiores según la configuración. */
  CM.applyPaneVisibility = function (cfg) {
    const show = (pane, on) => {
      const el = document.getElementById('pane' + pane.charAt(0).toUpperCase() + pane.slice(1));
      if (el) el.classList.toggle('hidden', !on);
    };
    show('rsi', cfg.rsi && cfg.rsi.on);
    show('macd', cfg.macd && cfg.macd.on);
    show('atr', cfg.atr && cfg.atr.on);
    // La escala temporal solo se dibuja en el panel más bajo visible
    const order = ['atr', 'macd', 'rsi']; // de abajo hacia arriba
    const bottom = order.find((k) => cfg[k] && cfg[k].on) || null;
    Object.keys(CM.panes).forEach((k) => {
      const chart = CM.panes[k];
      if (!chart) return;
      chart.timeScale().applyOptions({ visible: k === bottom });
    });
    CM.main.timeScale().applyOptions({ visible: bottom === null });
    // Re-alinear al aparecer/desaparecer paneles
    setTimeout(() => { try { CM._syncPanes(CM.main.timeScale().getVisibleLogicalRange()); } catch (e) {} }, 40);
  };

  /* ============================== RENDER ============================== */

  /**
   * Dibuja el estado del replay hasta el índice `index` (inclusive).
   * Optimización: si index === _lastIndex + 1 se usa update() incremental.
   */
  CM.render = function (index) {
    if (!CM.candles.length) return;
    index = U.clamp(index, 0, CM.candles.length - 1);
    const candle = CM.candles[index];

    if (index === CM._lastIndex + 1 && CM._lastIndex >= 0) {
      CM._appendCandle(index, candle);
    } else {
      CM._rebuild(index);
    }
    CM._lastIndex = index;
    CM._index = index;
    CM.updateLegend(candle);
    CM.updatePaneValues(index);
  };

  /** Añade una vela (render incremental O(1)). */
  CM._appendCandle = function (index, candle) {
    const t = candle.time;
    CM.series.candles.update({ time: t, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    CM.series.volume.update({ time: t, value: candle.volume || 0, color: candle.close >= candle.open ? 'rgba(0,200,83,.42)' : 'rgba(255,23,68,.42)' });

    const upd = (key, value) => {
      if (CM.series[key] && value !== null && value !== undefined) CM.series[key].update({ time: t, value });
    };
    const d = CM.indData;
    upd('sma', d.sma ? d.sma[index] : null);
    upd('ema', d.ema ? d.ema[index] : null);
    upd('ema2', d.ema2 ? d.ema2[index] : null);
    upd('bbU', d.bb ? d.bb.upper[index] : null);
    upd('bbM', d.bb ? d.bb.middle[index] : null);
    upd('bbL', d.bb ? d.bb.lower[index] : null);

    // Paneles
    if (CM.cfg.rsi && CM.cfg.rsi.on && d.rsi && d.rsi[index] !== null) CM.paneSeries.rsiLine.update({ time: t, value: d.rsi[index] });
    if (CM.cfg.macd && CM.cfg.macd.on && d.macd) {
      const m = d.macd;
      if (m.macd[index] !== null) CM.paneSeries.macdLine.update({ time: t, value: m.macd[index] });
      if (m.signal[index] !== null) CM.paneSeries.macdSignal.update({ time: t, value: m.signal[index] });
      if (m.hist[index] !== null) CM.paneSeries.macdHist.update({ time: t, value: m.hist[index], color: m.hist[index] >= 0 ? 'rgba(0,200,83,.55)' : 'rgba(255,23,68,.55)' });
    }
    if (CM.cfg.atr && CM.cfg.atr.on && d.atr && d.atr[index] !== null) CM.paneSeries.atrLine.update({ time: t, value: d.atr[index] });
  };

  /** Reconstruye todas las series hasta `index` (seek / retroceso). */
  CM._rebuild = function (index) {
    const candles = CM.candles;
    const end = index;

    // --- Velas y volumen ---
    const cd = new Array(end + 1);
    const vd = new Array(end + 1);
    for (let i = 0; i <= end; i++) {
      const c = candles[i];
      cd[i] = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close };
      vd[i] = { time: c.time, value: c.volume || 0, color: c.close >= c.open ? 'rgba(0,200,83,.42)' : 'rgba(255,23,68,.42)' };
    }
    CM.series.candles.setData(cd);
    CM.series.volume.setData(vd);

    // --- Indicadores del panel principal ---
    const setLine = (key, values) => {
      if (!CM.series[key]) return;
      CM.series[key].setData(values ? CM._lineData(candles, values, end) : []);
    };
    const d = CM.indData;
    setLine('sma', d.sma);
    setLine('ema', d.ema);
    setLine('ema2', d.ema2);
    setLine('bbU', d.bb ? d.bb.upper : null);
    setLine('bbM', d.bb ? d.bb.middle : null);
    setLine('bbL', d.bb ? d.bb.lower : null);

    // --- Paneles inferiores ---
    if (CM.cfg.rsi && CM.cfg.rsi.on) CM.paneSeries.rsiLine.setData(d.rsi ? CM._lineData(candles, d.rsi, end) : []);
    if (CM.cfg.macd && CM.cfg.macd.on && d.macd) {
      CM.paneSeries.macdLine.setData(CM._lineData(candles, d.macd.macd, end));
      CM.paneSeries.macdSignal.setData(CM._lineData(candles, d.macd.signal, end));
      const hist = [];
      for (let i = 0; i <= end; i++) {
        const v = d.macd.hist[i];
        if (v === null || v === undefined) continue;
        hist.push({ time: candles[i].time, value: v, color: v >= 0 ? 'rgba(0,200,83,.55)' : 'rgba(255,23,68,.55)' });
      }
      CM.paneSeries.macdHist.setData(hist);
    }
    if (CM.cfg.atr && CM.cfg.atr.on) CM.paneSeries.atrLine.setData(d.atr ? CM._lineData(candles, d.atr, end) : []);
  };

  /** Convierte un array de valores (con nulls) en datos válidos para la serie. */
  CM._lineData = function (candles, values, end) {
    const out = [];
    for (let i = 0; i <= end; i++) {
      const v = values[i];
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      out.push({ time: candles[i].time, value: v });
    }
    return out;
  };
  /** Fuerza un redibujado completo (tras cambiar indicadores o escala). */
  CM.refresh = function (index) {
    // Si no se indica índice se usa CM._index (el del replay) y NO _lastIndex:
    // al cambiar indicadores _lastIndex se resetea y el gráfico se colapsaría
    // a una sola vela hasta el siguiente avance.
    const idx = (index !== undefined && index !== null)
      ? index
      : (CM._index >= 0 ? CM._index : 0);
    CM._lastIndex = -1;
    CM.render(idx);
  };

  /* ============================== LEYENDA ============================== */

  CM.updateLegend = function (candle) {
    if (!candle) return;
    const prev = CM.candles[CM.candles.indexOf(candle) - 1];
    const chg = prev ? ((candle.close - prev.close) / prev.close) * 100 : 0;
    const cls = candle.close >= candle.open ? 'up' : 'down';
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('lgO', U.fmtPrice(candle.open));
    set('lgH', U.fmtPrice(candle.high));
    set('lgL', U.fmtPrice(candle.low));
    set('lgC', U.fmtPrice(candle.close));
    set('lgV', U.fmtVol(candle.volume));
    const c = document.getElementById('lgC'); if (c) c.className = cls;
    const chgEl = document.getElementById('lgChg');
    if (chgEl) {
      chgEl.textContent = U.fmtPct(chg, 2, true);
      chgEl.className = 'lg-item ' + (chg >= 0 ? 'up' : 'down');
    }
    // Resumen de indicadores activos
    const i = CM._lastIndex, d = CM.indData, parts = [];
    if (CM.cfg.sma && CM.cfg.sma.on && d.sma && d.sma[i] != null) parts.push(`SMA${CM.cfg.sma.p}: ${U.fmtPrice(d.sma[i])}`);
    if (CM.cfg.ema && CM.cfg.ema.on && d.ema && d.ema[i] != null) parts.push(`EMA${CM.cfg.ema.p}: ${U.fmtPrice(d.ema[i])}`);
    if (CM.cfg.ema2 && CM.cfg.ema2.on && d.ema2 && d.ema2[i] != null) parts.push(`EMA${CM.cfg.ema2.p}: ${U.fmtPrice(d.ema2[i])}`);
    if (CM.cfg.rsi && CM.cfg.rsi.on && d.rsi && d.rsi[i] != null) parts.push(`RSI: ${U.num(d.rsi[i], 1)}`);
    if (CM.cfg.atr && CM.cfg.atr.on && d.atr && d.atr[i] != null) parts.push(`ATR: ${U.fmtPrice(d.atr[i])}`);
    const e = document.getElementById('lgInd');
    if (e) e.textContent = parts.join('  ');
  };

  /** Valores numéricos de los paneles inferiores en el cursor. */
  CM.updatePaneValues = function (index) {
    const d = CM.indData;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('rsiValue', d.rsi && d.rsi[index] != null ? U.num(d.rsi[index], 1) : '—');
    if (d.macd) {
      const m = d.macd;
      set('macdValue', m.macd[index] != null ? `MACD ${U.num(m.macd[index], 2)} · SIG ${U.num(m.signal[index], 2)} · HIST ${U.num(m.hist[index], 2)}` : '—');
    }
    set('atrValue', d.atr && d.atr[index] != null ? U.fmtPrice(d.atr[index]) : '—');
  };

  /** Leyenda al pasar el ratón por encima del gráfico. */
  CM._onCrosshair = function (param) {
    if (!param || !param.time || !CM.series.candles) {
      CM._hoverCandle = null;
      return;
    }
    const data = param.seriesData.get(CM.series.candles);
    if (data) {
      CM._hoverCandle = {
        time: param.time, open: data.open, high: data.high, low: data.low, close: data.close,
        volume: (param.seriesData.get(CM.series.volume) || {}).value || 0,
      };
      CM.updateLegend(CM._hoverCandle);
    }
    // Paneles: valores en el punto señalado
    const t = param.time;
    const idxOfTime = CM._timeIndex(t);
    if (idxOfTime >= 0) CM.updatePaneValues(idxOfTime);
    if (CM.onCrosshair) CM.onCrosshair(param, idxOfTime);
  };

  CM._timeIndex = function (time) {
    if (typeof time !== 'number') return -1;
    // Búsqueda binaria por tiempo (las velas están ordenadas)
    let lo = 0, hi = CM.candles.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = CM.candles[mid].time;
      if (v === time) return mid;
      if (v < time) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  };

  /* =========================== LÍNEAS DE POSICIÓN =========================== */

  /** Dibuja (o redibuja) las líneas de entrada / SL / TP / liquidación. */
  CM.setPositionLines = function (pos) {
    CM.clearPositionLines();
    if (!pos) return;
    const mk = (price, color, title, style) => {
      const line = CM.series.candles.createPriceLine({
        price, color, lineWidth: 1, lineStyle: style === undefined ? 2 : style,
        axisLabelVisible: true, title,
      });
      CM._priceLines.push(line);
    };
    const entryLabel = (pos.side === 'long' ? 'LONG' : 'SHORT') + ' ' + U.fmtPrice(pos.entryPrice);
    mk(pos.entryPrice, COLORS.entry, entryLabel, 0);
    if (pos.tp !== null && pos.tp !== undefined) mk(pos.tp, COLORS.tp, 'TP ' + U.fmtPrice(pos.tp));
    if (pos.sl !== null && pos.sl !== undefined) mk(pos.sl, COLORS.sl, 'SL ' + U.fmtPrice(pos.sl));
    const liq = TE.liquidationPrice(pos);
    if (liq !== null && pos.leverage > 1) mk(liq, COLORS.liq, 'LIQ ≈ ' + U.fmtPrice(liq), 1);
  };

  CM.updatePositionLines = function (pos) {
    // Rehace las líneas (son solo 3-4 objetos: coste despreciable)
    CM.setPositionLines(pos);
  };

  CM.clearPositionLines = function () {
    CM._priceLines.forEach((l) => { try { CM.series.candles.removePriceLine(l); } catch (e) {} });
    CM._priceLines = [];
  };

  /* ============================== EQUITY ============================== */

  CM.drawEquity = function (points, initialCapital) {
    if (!points || !points.length) { CM.equitySeries.setData([]); return; }
    const data = [];
    let lastTime = -1;
    for (const p of points) {
      const t = p.t || p.time;
      if (t === null || t === undefined) continue;
      if (t <= lastTime) continue;          // la serie exige tiempos estrictamente crecientes
      lastTime = t;
      data.push({ time: t, value: p.value });
    }
    CM.equitySeries.setData(data);
  };

  /* ============================ VISTA / ESCALA ============================ */

  /** Ajusta la vista a las últimas `bars` velas visibles. */
  CM.scrollToLast = function (bars) {
    const idx = CM._lastIndex;
    if (idx < 0) return;
    const n = bars || 120;
    const from = Math.max(0, idx - n);
    const len = CM.candles.length;
    try {
      CM.main.timeScale().setVisibleLogicalRange({ from: from - 0.5, to: idx + 8.5 < len ? idx + 8.5 : len - 0.5 });
    } catch (e) {}
  };

  CM.fitContent = function () {
    try { CM.main.timeScale().fitContent(); } catch (e) {}
  };

  /** Escala de precios automática (true) o manual/fija (false). */
  CM.setAutoScale = function (auto) {
    CM.main.priceScale('right').applyOptions({ autoScale: !!auto });
    return !!auto;
  };

  /** Escala logarítmica de precios. */
  CM.setLogScale = function (log) {
    CM.main.priceScale('right').applyOptions({ mode: log ? 1 : 0 });
    return !!log;
  };

  /** Rangos de tiempo visibles actuales. */
  CM.getVisibleRange = function () { return CM.visible; };

  /* ========================== COORDENADAS ========================== */

  CM.timeToX = function (time) {
    try {
      const x = CM.main.timeScale().timeToCoordinate(time);
      return x === null ? null : x;
    } catch (e) { return null; }
  };

  CM.priceToY = function (price) {
    try {
      const y = CM.series.candles.priceToCoordinate(price);
      return y === null ? null : y;
    } catch (e) { return null; }
  };

  CM.xToTime = function (x) {
    try { return CM.main.timeScale().coordinateToTime(x); } catch (e) { return null; }
  };

  CM.yToPrice = function (y) {
    try {
      const p = CM.series.candles.coordinateToPrice(y);
      return p === null ? null : p;
    } catch (e) { return null; }
  };

  /* ========================== CAPTURA DE PANTALLA ========================== */

  /** Devuelve el canvas del gráfico principal para composiciones. */
  CM.getMainCanvas = function () {
    const wrap = document.getElementById('mainChart');
    return wrap ? wrap.querySelector('canvas') : null;
  };

  /* =========================== HELPERS DE DATOS =========================== */

  /** Velas visibles (útil para exportaciones y mediciones). */
  CM.getVisibleCandles = function () {
    const vr = CM.main.timeScale().getVisibleRange();
    if (!vr) return CM.candles.slice(0, CM._lastIndex + 1);
    return CM.candles.slice(0, CM._lastIndex + 1).filter((c) => c.time >= vr.from && c.time <= vr.to);
  };

  global.CM = CM;
})(window);
