/* =========================================================================
 * storage.js — Persistencia en localStorage:
 *   · Caché de velas descargadas (por par + temporalidad)
 *   · Sesiones de backtest completas (estado + trades + dibujos)
 *   · Ajustes de usuario
 * =======================================================================*/
(function (global) {
  'use strict';

  const ST = {};
  const PREFIX = 'brp_';

  /** Escritura segura: si el almacenamiento está lleno, avisa y depura. */
  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      U.log('⚠ localStorage lleno: se limpia la caché de velas antiguas', 'warn');
      ST.pruneCache(0.5);
      try { localStorage.setItem(key, value); return true; } catch (e2) { return false; }
    }
  }

  ST.get = function (key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  };

  ST.set = function (key, value) {
    return safeSet(PREFIX + key, JSON.stringify(value));
  };

  ST.del = function (key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  };

  ST.keys = function () {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
      }
    } catch (e) {}
    return out;
  };

  /* ------------------------------ Velas ------------------------------ */
  // Cada entrada: { symbol, interval, candles, savedAt }

  ST.saveCandles = function (symbol, interval, candles) {
    const key = 'kl_' + symbol + '_' + interval;
    const payload = { symbol, interval, candles, savedAt: Date.now() };
    const ok = ST.set(key, payload);
    if (ok) U.log(`💾 ${candles.length} velas guardadas en caché local (${symbol} ${interval})`, 'sys');
    return ok;
  };

  ST.loadCandles = function (symbol, interval) {
    const p = ST.get('kl_' + symbol + '_' + interval);
    if (p && Array.isArray(p.candles) && p.candles.length) {
      U.log(`⚡ ${p.candles.length} velas cargadas desde caché local (${U.fmtDate(p.candles[0].time)} → ${U.fmtDate(p.candles[p.candles.length - 1].time)})`, 'sys');
      return p.candles;
    }
    return null;
  };

  /** Información de todas las entradas de caché. */
  ST.cacheInfo = function () {
    return ST.keys().filter((k) => k.startsWith('kl_')).map((k) => {
      const p = ST.get(k) || {};
      let size = 0;
      try { size = (localStorage.getItem(PREFIX + k) || '').length; } catch (e) { size = 0; }
      return { key: k, symbol: p.symbol, interval: p.interval, count: (p.candles || []).length, savedAt: p.savedAt, sizeKB: Math.round(size / 1024) };
    }).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  };

  ST.clearCache = function () {
    ST.keys().filter((k) => k.startsWith('kl_')).forEach((k) => ST.del(k));
    U.log('🧹 Caché de velas vaciada', 'sys');
  };

  /** Elimina el porcentaje `ratio` de las entradas más antiguas. */
  ST.pruneCache = function (ratio = 0.5) {
    const info = ST.cacheInfo();
    const n = Math.max(1, Math.floor(info.length * ratio));
    info.slice(-n).forEach((i) => ST.del(i.key));
  };

  /* ---------------------------- Sesiones ---------------------------- */
  // Se guarda: { name, savedAt, config, replay, indicators, drawings, trading, trades }

  ST.listSessions = function () {
    return ST.keys().filter((k) => k.startsWith('ses_')).map((k) => {
      const s = ST.get(k) || {};
      return { key: k, name: s.name, savedAt: s.savedAt, meta: s.meta || {} };
    }).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  };

  ST.saveSession = function (name, data) {
    const key = 'ses_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const payload = Object.assign({ name, savedAt: Date.now() }, data);
    const ok = ST.set(key, payload);
    if (ok) U.log(`💾 Sesión guardada: «${name}»`, 'sys');
    return ok ? key : null;
  };

  ST.loadSession = function (key) { return ST.get(key); };
  ST.deleteSession = function (key) { ST.del(key); U.log('🗑️ Sesión eliminada', 'sys'); };

  /* ---------------------------- Ajustes ---------------------------- */

  const DEFAULTS = {
    capital: 10000,
    fee: 0.1,
    leverage: 1,
    warmup: 150,
    sound: true,
    autoReveal: true,
    gestureDraw: true,     // dibujar manteniendo pulsado ⅓ s
    funding: 0,
    slFirst: 'worst',
    pair: 'BTCUSDT',
    interval: '1h',
    sizeMode: 'pct',
    sizeValue: 100,
  };

  ST.getSettings = function () {
    return Object.assign({}, DEFAULTS, ST.get('settings', {}));
  };

  ST.setSettings = function (patch) {
    const s = Object.assign(ST.getSettings(), patch || {});
    ST.set('settings', s);
    return s;
  };

  ST.DEFAULTS = DEFAULTS;
  global.ST = ST;
})(window);
