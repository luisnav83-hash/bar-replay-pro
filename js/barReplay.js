/* =========================================================================
 * barReplay.js — Motor del Bar Replay.
 *
 *  Gestiona el "cursor" del replay: qué vela es la última visible.
 *  Todo lo que ocurre después de ese índice está OCULTO para el usuario.
 *
 *  · play/pause con velocidades 0.5x … 50x y modo MAX
 *  · avance y retroceso de una vela
 *  · seek a cualquier punto (slider de progreso)
 *  · reset al inicio del replay
 *
 *  El avance usa requestAnimationFrame con acumulador: si la pestaña se
 *  ralentiza o el usuario sube la velocidad, se avanzan varias velas por
 *  fotograma sin perder ninguna (el handler recibe el rango completo).
 * =======================================================================*/
(function (global) {
  'use strict';

  const BR = {};

  /** Retardo base (ms) por vela a velocidad 1x, según la temporalidad. */
  const BASE_DELAY = {
    '1m': 700, '5m': 900, '15m': 1100, '1h': 1500, '4h': 1700, '1d': 2000, '1w': 2200,
  };

  /** ms por vela según multiplicador. El mínimo práctico es 24 ms. */
  function delayForSpeed(base, mult) {
    if (mult === 'max') return 16;      // lo más rápido: 1 vela por fotograma (o más)
    return Math.max(24, base / mult);
  }

  /* ------------------------------- Estado ------------------------------- */

  BR.state = {
    candles: [],       // todas las velas cargadas
    startIndex: 0,     // primera vela "activa" del replay (fin del warmup)
    index: 0,          // última vela revelada
    minWarmup: 20,     // velas mínimas de contexto
    speed: 1,          // 0.5 | 1 | 2 | 5 | 10 | 50 | 'max'
    interval: '1h',
    baseDelay: 1500,
    playing: false,
    _raf: null,
    _last: 0,
    _acc: 0,
  };

  /* ------------------------------- Eventos ------------------------------- */
  // Se asignan desde app.js / uiController.js
  BR.onAdvance = null;      // (fromIndex, toIndex) — se revelaron velas [from+1 .. to]
  BR.onSeek = null;         // (index, direction) — salto (retroceso o slider)
  BR.onStateChange = null;  // (playing)
  BR.onEnd = null;          // se llegó a la última vela disponible

  /* ------------------------------- Datos ------------------------------- */

  /**
   * Carga las velas y sitúa el cursor del replay.
   * @param {Array} candles
   * @param {number} startIndex  índice de la última vela visible al empezar
   * @param {string} interval
   */
  BR.setData = function (candles, startIndex, interval) {
    const s = BR.state;
    s.candles = candles || [];
    s.interval = interval || s.interval;
    s.baseDelay = BASE_DELAY[s.interval] || 1500;
    const maxIdx = Math.max(0, s.candles.length - 1);
    s.startIndex = U.clamp(Math.round(startIndex || 0), Math.min(s.minWarmup, maxIdx), maxIdx);
    s.index = s.startIndex;
    s._acc = 0;
    BR.pause();
    BR._emitState();
    return s.index;
  };

  /** Añade velas al final (por ejemplo al paginar más histórico). */
  BR.extendCandles = function (extra) {
    if (!Array.isArray(extra) || !extra.length) return;
    const s = BR.state;
    const lastT = s.candles.length ? s.candles[s.candles.length - 1].time : 0;
    const add = extra.filter((c) => c.time > lastT);
    s.candles = s.candles.concat(add);
  };

  /* --------------------------- Consultas --------------------------- */

  BR.getCandles = () => BR.state.candles;
  BR.getIndex = () => BR.state.index;
  BR.getStartIndex = () => BR.state.startIndex;
  BR.getCandle = (i) => BR.state.candles[i];
  BR.currentCandle = () => BR.state.candles[BR.state.index] || null;
  BR.total = () => BR.state.candles.length;
  BR.hiddenCount = () => Math.max(0, BR.state.candles.length - BR.state.index - 1);
  BR.isPlaying = () => BR.state.playing;
  BR.isAtEnd = () => BR.state.index >= BR.state.candles.length - 1;
  BR.isAtStart = () => BR.state.index <= BR.state.startIndex;

  /* ------------------------------ Control ------------------------------ */

  BR.play = function () {
    const s = BR.state;
    if (!s.candles.length) { U.toast('Carga datos antes de reproducir', 'warn'); return; }
    if (s.playing) return;
    if (BR.isAtEnd()) { U.toast('🏁 Replay finalizado: ya estás en la última vela', 'warn'); return; }
    s.playing = true;
    s._last = performance.now();
    s._acc = 0;
    s._raf = requestAnimationFrame(BR._loop);
    BR._emitState();
  };

  BR.pause = function () {
    const s = BR.state;
    if (!s.playing) { BR._emitState(); return; }
    s.playing = false;
    if (s._raf) cancelAnimationFrame(s._raf);
    s._raf = null;
    BR._emitState();
  };

  BR.togglePlay = function () { BR.state.playing ? BR.pause() : BR.play(); };

  /** Bucle de reproducción. */
  BR._loop = function (now) {
    const s = BR.state;
    if (!s.playing) return;

    const dt = Math.min(500, now - s._last);   // clamp para evitar saltos tras pestañas inactivas
    s._last = now;

    const maxSpeed = s.speed === 'max';
    const delay = delayForSpeed(s.baseDelay, s.speed);
    s._acc += dt;

    let steps = 0;
    if (maxSpeed) {
      // Máxima velocidad: varias velas por fotograma, limitado por el render
      steps = Math.min(12, Math.max(1, Math.floor(s._acc / 16)));
    } else {
      steps = Math.floor(s._acc / delay);
      if (steps > 40) steps = 40;              // límite de seguridad por fotograma
    }
    if (steps > 0) {
      s._acc -= steps * delay;
      BR._advance(steps);
    }
    if (s.playing) s._raf = requestAnimationFrame(BR._loop);
  };

  /** Avanza `n` velas (usado por el bucle y por el botón de paso). */
  BR._advance = function (n) {
    const s = BR.state;
    const from = s.index;
    const to = Math.min(s.candles.length - 1, s.index + n);
    if (to === from) {                 // ya no queda histórico
      BR.pause();
      if (BR.onEnd) BR.onEnd();
      U.toast('🏁 Fin del histórico cargado', 'info');
      return;
    }
    s.index = to;
    if (BR.onAdvance) BR.onAdvance(from, to);
    if (BR.isAtEnd()) {
      BR.pause();
      if (BR.onEnd) BR.onEnd();
      U.log('🏁 Replay llegado al final del histórico', 'sys');
    }
  };

  /** Avanza una sola vela (paso manual). */
  BR.stepForward = function () {
    BR.pause();
    if (BR.isAtEnd()) { U.toast('Fin del histórico cargado', 'warn'); return false; }
    BR._advance(1);
    return true;
  };

  /** Retrocede una o varias velas. */
  BR.stepBack = function (n = 1) {
    const s = BR.state;
    BR.pause();
    const to = Math.max(s.startIndex, s.index - n);
    if (to === s.index) { U.toast('Ya estás al principio del replay', 'warn'); return false; }
    const from = s.index;
    s.index = to;
    if (BR.onSeek) BR.onSeek(to, -1, from);
    return true;
  };

  /** Salta a un índice concreto (slider de progreso). */
  BR.seek = function (index, fromUser = true) {
    const s = BR.state;
    const to = U.clamp(Math.round(index), s.startIndex, s.candles.length - 1);
    if (to === s.index) return;
    const from = s.index;
    s.index = to;
    if (BR.onSeek) BR.onSeek(to, to > from ? 1 : -1, from, fromUser);
  };

  /** Vuelve al punto de inicio del replay. */
  BR.reset = function () {
    BR.pause();
    BR.seek(BR.state.startIndex);
    U.log('⏮ Replay reiniciado al inicio', 'sys');
  };

  /** Salta a la última vela cargada (revela todo el histórico). */
  BR.goToEnd = function () {
    BR.pause();
    const target = BR.state.candles.length - 1;
    const from = BR.state.index;
    if (target === from) { U.toast('Ya estás en la última vela', 'info'); return; }
    BR.state.index = target;
    // Se recorre como avance para que la lógica de trading procese cada vela
    if (BR.onAdvance) BR.onAdvance(from, target);
  };

  /* ------------------------------ Velocidad ------------------------------ */

  /** @param {number|'max'} mult */
  BR.setSpeed = function (mult) {
    const s = BR.state;
    s.speed = mult === 'max' ? 'max' : +mult;
    s._acc = 0;
    U.log(`⏩ Velocidad de replay: ${BR.speedLabel()}`, 'sys');
    BR._emitState();
  };

  BR.speedLabel = function () { return BR.state.speed === 'max' ? 'MAX' : BR.state.speed + 'x'; };

  /** Sube/baja de velocidad recorriendo la lista de pasos. */
  BR.speedUp = function (dir) {
    const steps = [0.5, 1, 2, 5, 10, 50, 'max'];
    const i = steps.indexOf(BR.state.speed);
    const ni = U.clamp(i + dir, 0, steps.length - 1);
    BR.setSpeed(steps[ni]);
    return steps[ni];
  };

  /* ------------------------------- Estado ------------------------------- */

  BR._emitState = function () {
    if (BR.onStateChange) BR.onStateChange(BR.state.playing);
  };

  /** Progreso del replay de 0 a 1 (sobre el tramo útil). */
  BR.progress = function () {
    const s = BR.state;
    const span = (s.candles.length - 1) - s.startIndex;
    if (span <= 0) return 0;
    return U.clamp((s.index - s.startIndex) / span, 0, 1);
  };

  /** Posición del cursor como % del histórico total (para el slider). */
  BR.progressTotal = function () {
    const s = BR.state;
    if (s.candles.length <= 1) return 0;
    return s.index / (s.candles.length - 1);
  };

  /* ----------------------------- Persistencia ----------------------------- */

  BR.serialize = function () {
    const s = BR.state;
    return { index: s.index, startIndex: s.startIndex, speed: s.speed, interval: s.interval };
  };

  BR.restore = function (d, candles) {
    if (!d) return;
    if (candles) BR.state.candles = candles;
    BR.state.interval = d.interval || BR.state.interval;
    BR.state.baseDelay = BASE_DELAY[BR.state.interval] || 1500;
    BR.state.startIndex = d.startIndex ?? 0;
    BR.state.index = U.clamp(d.index ?? 0, 0, Math.max(0, BR.state.candles.length - 1));
    if (d.speed) BR.state.speed = d.speed;
    BR.pause();
  };

  global.BR = BR;
})(window);
