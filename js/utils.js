/* =========================================================================
 * utils.js — Funciones auxiliares: formateo, fechas UTC, matemáticas,
 * DOM, toasts, sonidos y utilidades varias.
 * =======================================================================*/
(function (global) {
  'use strict';

  const U = {};

  /* ------------------------------ Formateo ------------------------------ */

  /** Formatea un número con separadores de miles y decimales fijos. */
  U.num = function (v, dec = 2) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };

  /** Precio con decimales adaptados a su magnitud (BTC ~2, DOGE ~5). */
  U.fmtPrice = function (v) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const a = Math.abs(v);
    let dec = 2;
    if (a >= 1000) dec = 2;
    else if (a >= 100) dec = 3;
    else if (a >= 1) dec = 4;
    else if (a >= 0.01) dec = 5;
    else dec = 8;
    return U.num(v, dec);
  };

  /** Importe monetario (siempre con signo opcional). */
  U.fmtMoney = function (v, sign = false) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const s = v < 0 ? '-' : (sign && v > 0 ? '+' : '');
    return s + '$' + U.num(Math.abs(v), 2);
  };

  /** Porcentaje. */
  U.fmtPct = function (v, dec = 2, sign = false) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const s = v < 0 ? '-' : (sign && v > 0 ? '+' : '');
    return s + U.num(Math.abs(v), dec) + '%';
  };

  /** Volumen abreviado: 1.24K, 3.7M, 1.1B. */
  U.fmtVol = function (v) {
    if (v === null || v === undefined) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
    return U.num(v, 2);
  };

  /* ------------------------------- Fechas ------------------------------- */
  // Todas las marcas de tiempo del proyecto son SEGUNDOS UNIX en UTC.

  U.pad2 = (n) => String(n).padStart(2, '0');

  /** "2024-03-15 14:00" */
  U.fmtDate = function (tsSec) {
    if (!tsSec && tsSec !== 0) return '—';
    const d = new Date(tsSec * 1000);
    return `${d.getUTCFullYear()}-${U.pad2(d.getUTCMonth() + 1)}-${U.pad2(d.getUTCDate())} ` +
           `${U.pad2(d.getUTCHours())}:${U.pad2(d.getUTCMinutes())}`;
  };

  /** "2024-03-15 14:00:00" */
  U.fmtDateSec = function (tsSec) {
    if (!tsSec && tsSec !== 0) return '—';
    const d = new Date(tsSec * 1000);
    return U.fmtDate(tsSec) + ':' + U.pad2(d.getUTCSeconds());
  };

  /** "15/03/2024 14:00" (formato español) */
  U.fmtDateEs = function (tsSec) {
    if (!tsSec && tsSec !== 0) return '—';
    const d = new Date(tsSec * 1000);
    return `${U.pad2(d.getUTCDate())}/${U.pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
           `${U.pad2(d.getUTCHours())}:${U.pad2(d.getUTCMinutes())}`;
  };

  /** Convierte "2024-03-15T14:00" (valor de input datetime-local) a epoch UTC. */
  U.inputToTs = function (value) {
    if (!value) return null;
    // El input no lleva zona; lo interpretamos como UTC explícitamente.
    const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0) / 1000);
  };

  /** Convierte epoch (segundos) a valor de input datetime-local en UTC. */
  U.tsToInput = function (tsSec) {
    const d = new Date(tsSec * 1000);
    return `${d.getUTCFullYear()}-${U.pad2(d.getUTCMonth() + 1)}-${U.pad2(d.getUTCDate())}T` +
           `${U.pad2(d.getUTCHours())}:${U.pad2(d.getUTCMinutes())}`;
  };

  /** Duración legible entre dos timestamps: "2h 15m", "3d 4h". */
  U.fmtDuration = function (startTs, endTs) {
    let s = Math.max(0, (endTs || 0) - (startTs || 0));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    const parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (!d && m) parts.push(m + 'm');
    return parts.join(' ') || '<1m';
  };

  /* ---------------------------- Matemáticas ---------------------------- */

  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

  /** Media aritmética. */
  U.mean = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

  /** Desviación típica poblacional. */
  U.stdDev = function (arr) {
    if (!arr.length) return 0;
    const m = U.mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  };

  /* ------------------------------- DOM ------------------------------- */
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Crea un elemento con clase y contenido. */
  U.el = function (tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  /** Muestra un toast (notificación) flotante. */
  U.toast = function (msg, type = 'info', ms = 3200) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = U.el('div', 'toast ' + type, msg);
    box.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 260);
    }, ms);
  };

  /* ------------------------------ Log --------------------------------- */
  // El log de eventos se escribe desde aquí para evitar dependencias circulares.

  U.log = function (msg, type = 'info') {
    const list = document.getElementById('logList');
    if (!list) return;
    const line = U.el('div', 'log-line ' + type);
    line.innerHTML = `<span class="log-time">${U.fmtDateSec(Math.floor(Date.now() / 1000))}</span>` +
                     `<span class="log-msg">${msg}</span>`;
    list.appendChild(line);
    // Mantener el log acotado (rendimiento con miles de líneas)
    while (list.childElementCount > 800) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
  };

  /* ------------------------------ Sonidos ------------------------------ */
  // Sonidos sintetizados con WebAudio: sin ficheros externos que cargar.

  U.sound = { enabled: true };

  function beep(freq, dur, type, gain) {
    if (!U.sound.enabled) return;
    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      const ctx = (U._actx = U._actx || new Ctx());
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(gain || 0.06, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + dur + 0.02);
    } catch (e) { /* el audio es opcional: nunca debe romper la app */ }
  }

  U.playSound = function (kind) {
    switch (kind) {
      case 'open':   beep(660, 0.09, 'triangle', 0.05); break;                       // apertura
      case 'close':  beep(420, 0.10, 'triangle', 0.05); break;                       // cierre
      case 'win':    beep(880, 0.09, 'sine', 0.06); setTimeout(() => beep(1320, 0.12, 'sine', 0.05), 90); break;
      case 'loss':   beep(300, 0.13, 'sawtooth', 0.045); setTimeout(() => beep(200, 0.16, 'sawtooth', 0.04), 110); break;
      case 'click':  beep(520, 0.035, 'square', 0.025); break;
      case 'error':  beep(180, 0.18, 'square', 0.04); break;
      default:       beep(600, 0.06, 'sine', 0.04);
    }
  };

  /* --------------------------- Varios --------------------------- */

  /** Genera un id corto. */
  U.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

  /** Espera n milisegundos (promesa). */
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Descarga un texto/cadena como archivo. */
  U.download = function (filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  /** Redondea a un "paso de precio" razonable según el activo. */
  U.priceStep = function (price) {
    const a = Math.abs(price);
    if (a >= 1000) return 0.5;
    if (a >= 100) return 0.05;
    if (a >= 1) return 0.001;
    return 0.00001;
  };

  /** Escapa HTML para inserción segura en tablas. */
  U.esc = function (s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  };

  global.U = U;
})(window);
