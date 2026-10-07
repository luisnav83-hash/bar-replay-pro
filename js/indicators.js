/* =========================================================================
 * indicators.js — Cálculo de indicadores técnicos en JavaScript puro.
 * Todos los indicadores devuelven arrays de la MISMA longitud que la serie
 * de velas, con `null` en las posiciones donde aún no hay valor suficiente.
 * Esto simplifica el mapeo a las series del gráfico.
 * =======================================================================*/
(function (global) {
  'use strict';

  const IND = {};

  /* ------------------------- Media móvil simple ------------------------- */
  /** SMA sobre el cierre. Optimizada con suma rodante: O(n). */
  IND.sma = function (candles, period) {
    const out = new Array(candles.length).fill(null);
    if (period < 1) return out;
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  };

  /* ----------------------- Media móvil exponencial ----------------------- */
  /** EMA con semilla = SMA del primer período (estándar en trading). */
  IND.ema = function (candles, period) {
    const out = new Array(candles.length).fill(null);
    if (period < 1 || candles.length < period) return out;
    const k = 2 / (period + 1);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += candles[i].close;
    let prev = sum / period;
    out[period - 1] = prev;
    for (let i = period; i < candles.length; i++) {
      prev = candles[i].close * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  };

  /** EMA genérica sobre un array de números (usada por MACD y RSI). */
  IND.emaArray = function (values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let sum = 0, started = false, prev = 0;
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null || v === undefined || Number.isNaN(v)) { count = 0; prev = 0; continue; }
      if (!started) {
        sum += v; count++;
        if (count === period) { started = true; prev = sum / period; out[i] = prev; }
      } else {
        prev = v * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  };

  /* ------------------------------- RSI ------------------------------- */
  /** RSI de Wilder con alisado exponencial (período típico 14). */
  IND.rsi = function (candles, period = 14) {
    const n = candles.length;
    const out = new Array(n).fill(null);
    if (n <= period) return out;

    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = candles[i].close - candles[i - 1].close;
      if (d >= 0) gain += d; else loss -= d;
    }
    let avgG = gain / period, avgL = loss / period;
    out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);

    for (let i = period + 1; i < n; i++) {
      const d = candles[i].close - candles[i - 1].close;
      const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    return out;
  };

  /* ------------------------------- MACD ------------------------------- */
  /** MACD: { macd, signal, hist } — hist = macd - signal. */
  IND.macd = function (candles, fast = 12, slow = 26, signalP = 9) {
    const n = candles.length;
    const emaFast = IND.emaArray(candles.map((c) => c.close), fast);
    const emaSlow = IND.emaArray(candles.map((c) => c.close), slow);

    const macd = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (emaFast[i] !== null && emaSlow[i] !== null) macd[i] = emaFast[i] - emaSlow[i];
    }
    const signal = IND.emaArray(macd, signalP);
    const hist = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (macd[i] !== null && signal[i] !== null) hist[i] = macd[i] - signal[i];
    }
    return { macd, signal, hist };
  };

  /* -------------------------- Bandas de Bollinger -------------------------- */
  /** Bandas de Bollinger: { middle, upper, lower } con k desviaciones típicas. */
  IND.bollinger = function (candles, period = 20, k = 2) {
    const n = candles.length;
    const middle = new Array(n).fill(null);
    const upper = new Array(n).fill(null);
    const lower = new Array(n).fill(null);

    let sum = 0, sumSq = 0;
    for (let i = 0; i < n; i++) {
      const c = candles[i].close;
      sum += c; sumSq += c * c;
      if (i >= period) { const o = candles[i - period].close; sum -= o; sumSq -= o * o; }
      if (i >= period - 1) {
        const m = sum / period;
        // Varianza poblacional insesgada por desviación típica poblacional (igual que TV/Binance)
        const variance = Math.max(0, sumSq / period - m * m);
        const sd = Math.sqrt(variance);
        middle[i] = m;
        upper[i] = m + k * sd;
        lower[i] = m - k * sd;
      }
    }
    return { middle, upper, lower };
  };

  /* ------------------------------- ATR ------------------------------- */
  /** Average True Range de Wilder (volatilidad media real). */
  IND.atr = function (candles, period = 14) {
    const n = candles.length;
    const out = new Array(n).fill(null);
    if (n <= period) return out;

    const tr = new Array(n).fill(null);
    tr[0] = candles[0].high - candles[0].low;
    for (let i = 1; i < n; i++) {
      const c = candles[i], p = candles[i - 1];
      tr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += tr[i];
    let prev = sum / period;
    out[period] = prev;
    for (let i = period + 1; i < n; i++) {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
    return out;
  };

  /* --------------------- Estimación de volatilidad --------------------- */
  /**
   * Volatilidad media (en %) del log-retorno de las últimas `lookback` velas.
   * Se usa para los datos de demostración.
   */
  IND.volatility = function (candles, lookback = 200) {
    const n = candles.length;
    const start = Math.max(1, n - lookback);
    let sum = 0, count = 0;
    for (let i = start; i < n; i++) {
      const r = Math.log(candles[i].close / candles[i - 1].close);
      sum += r * r; count++;
    }
    return count ? Math.sqrt(sum / count) : 0;
  };

  /* ------------------- Volumen relativo (contexto) ------------------- */
  /** Volumen medio de las últimas n velas. */
  IND.avgVolume = function (candles, period = 20) {
    const n = candles.length;
    const start = Math.max(0, n - period);
    let sum = 0;
    for (let i = start; i < n; i++) sum += candles[i].volume;
    return sum / Math.max(1, n - start);
  };

  /* ====================================================================
   * Motor incremental para el replay:
   * en lugar de recalcular todo el histórico en cada vela, mantiene estado
   * y hace append()/truncate() en O(1)-O(n) mínimo.
   * ==================================================================== */

  /** SMA incremental. */
  IND.IncrementalSMA = class {
    constructor(period) { this.p = period; this.buf = []; this.sum = 0; this.vals = []; }
    push(close) {
      this.buf.push(close); this.sum += close;
      if (this.buf.length > this.p) this.sum -= this.buf.shift();
      const v = this.buf.length === this.p ? this.sum / this.p : null;
      this.vals.push(v); return v;
    }
    truncate(len) {
      while (this.vals.length > len) {
        this.vals.pop();
        const c = this.buf.pop(); if (c !== undefined) this.sum -= c;
      }
    }
  };

  /** EMA incremental. */
  IND.IncrementalEMA = class {
    constructor(period) { this.p = period; this.k = 2 / (period + 1); this.seed = []; this.prev = null; this.vals = []; }
    push(close) {
      let v;
      if (this.prev === null) {
        this.seed.push(close);
        if (this.seed.length === this.p) {
          const s = this.seed.reduce((a, b) => a + b, 0) / this.p;
          this.prev = s; v = s;
        } else v = null;
      } else {
        this.prev = close * this.k + this.prev * (1 - this.k);
        v = this.prev;
      }
      this.vals.push(v); return v;
    }
    truncate(len) { while (this.vals.length > len) this.vals.pop(); this._rebuild(); }
    _rebuild() {
      // Reconstrucción completa (barata: sólo ocurre al retroceder velas)
      const target = this.vals.length;
      const full = [];
      let seed = [], prev = null;
      for (const v of this.vals) {
        // Reproducimos la secuencia desde el estado actual no es trivial; se hace en el motor
        seed.push(v);
        if (prev === null && seed.length === this.p) { prev = seed.reduce((a, b) => a + b, 0) / this.p; }
        else if (prev !== null && v !== null) prev = v;
        full.push(prev);
      }
      this.vals = full.slice(0, target);
      this.prev = full.length ? full[full.length - 1] : null;
    }
  };

  /**
   * Motor de indicadores incrementales usado por el Bar Replay.
   * Se alimenta vela a vela con `onNewCandle` y permite `rebuild(index)`
   * para el retroceso. Mantiene SMA/EMA/Bollinger/RSI/ATR/MACD al día.
   */
  IND.StreamEngine = class {
    constructor(cfg) {
      this.cfg = cfg || {};
    }

    /**
     * Recalcula TODO hasta el índice `index` (inclusive). Se llama al
     * cargar datos y al retroceder. Con ~10k velas es instantáneo.
     */
    build(candles, index) {
      const slice = candles.slice(0, index + 1);
      const c = this.cfg;
      this.sma = c.sma ? IND.sma(slice, c.smaP) : null;
      this.ema = c.ema ? IND.ema(slice, c.emaP) : null;
      this.ema2 = c.ema2 ? IND.ema(slice, c.ema2P) : null;
      this.bb = c.bb ? IND.bollinger(slice, c.bbP, c.bbK) : null;
      this.rsi = c.rsi ? IND.rsi(slice, c.rsiP) : null;
      this.macd = c.macd ? IND.macd(slice, c.macdF, c.macdS, c.macdSig) : null;
      this.atr = c.atr ? IND.atr(slice, c.atrP) : null;
    }
  };

  global.IND = IND;
})(window);
