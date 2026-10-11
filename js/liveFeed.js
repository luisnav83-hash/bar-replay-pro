/* =====================================================================
   liveFeed.js — modo EN VIVO: velas reales de Binance en el gráfico.

   · Fuente: API PÚBLICA de Binance (klines), sin claves ni cuenta. Se
     usan los mismos hosts que la descarga de historial (DS.BINANCE_HOSTS).
   · Carga las últimas 1000 velas de la temporalidad elegida, deja el
     cursor en la vela ACTUAL (la que aún no ha cerrado) y consulta cada
     POLL_MS las dos últimas velas: actualiza la vela en curso en sitio y,
     si se abre una nueva, reconstruye la serie con el mismo camino que la
     carga normal (App.useCandles), así indicadores y motor ven lo mismo.
   · Lo que NO es: no hay órdenes reales. Las operaciones siguen siendo
     del simulador (TradingEngine) sobre este precio en vivo. Bitunix no
     tiene demo por API (ver docs/), así que esto solo da datos.
   ===================================================================== */
(function (global) {
  'use strict';
  const LF = {
    on: false,
    timer: null,
    POLL_MS: 5000,
    par: null,          // par con el que se arrancó (si cambia, se reinicia)
    tf: null,           // temporalidad de Binance con la que se arrancó
    fallos: 0,
  };

  /** Fila de klines de Binance → vela interna (igual que dataService, que no la exporta). */
  function norm(r) {
    return {
      time: Math.floor(r[0] / 1000),
      open: +r[1], high: +r[2], low: +r[3], close: +r[4],
      volume: +r[5], quoteVolume: +r[7], trades: +r[8],
    };
  }

  /** Pide las últimas `limit` velas probando los hosts en orden. */
  async function pide(symbol, interval, limit) {
    let ultimo = null;
    for (const host of DS.BINANCE_HOSTS) {
      try {
        const r = await fetch(`${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        if (!r.ok) { ultimo = new Error('HTTP ' + r.status); continue; }
        const j = await r.json();
        if (!Array.isArray(j)) { ultimo = new Error('respuesta no válida'); continue; }
        return j.map(norm);
      } catch (e) { ultimo = e; }
    }
    throw ultimo || new Error('sin conexión con Binance');
  }

  function tfBinance() {
    const t = DS.TIMEFRAMES && DS.TIMEFRAMES[App.interval];
    return (t && t.binance) || App.interval;
  }

  function marcaBoton() {
    const b = document.getElementById('btnVivo');
    if (!b) return;
    b.classList.toggle('active', LF.on);
    b.setAttribute('aria-pressed', LF.on ? 'true' : 'false');
    b.textContent = LF.on ? '● En vivo' : 'En vivo';
    b.title = LF.on
      ? 'Datos en vivo de Binance (pulsa para parar)'
      : 'Mostrar velas en vivo de Binance (API pública, sin claves)';
  }

  /** Arranca: carga las últimas 1000 velas y deja el cursor en la vela en curso. */
  LF.start = async function () {
    const par = App.pair, tf = tfBinance();
    LF.par = par; LF.tf = tf; LF.on = true; LF.fallos = 0;
    if (BR.isPlaying && BR.isPlaying()) BR.pause();
    marcaBoton();
    try {
      const velas = DS.clean(await pide(par, tf, 1000));
      if (velas.length < 30) throw new Error('Binance devolvió solo ' + velas.length + ' velas');
      App.useCandles(velas, { source: 'Binance en vivo', startIndex: velas.length - 1 });
      // App.useCandles limita el cursor a length-2 (pensado para el replay): en vivo la vela
      // actual es la de la última posición, así que se coloca ahí.
      BR.state.index = velas.length - 1;
      if (global.U) U.toast(`🔴 En vivo: ${velas.length.toLocaleString('es-ES')} velas de ${DS.label ? DS.label(par) : par} ${App.interval}`, 'ok');
    } catch (err) {
      LF.stop();
      if (global.U) U.toast('⚠️ En vivo no disponible: ' + err.message, 'warn', 5200);
      return false;
    }
    clearInterval(LF.timer);
    LF.timer = setInterval(LF.tick, LF.POLL_MS);
    return true;
  };

  LF.stop = function () {
    clearInterval(LF.timer); LF.timer = null;
    LF.on = false;
    marcaBoton();
  };

  /** Una consulta: actualiza la vela en curso o abre la siguiente. */
  LF.tick = async function () {
    if (!LF.on) return;
    if (App.pair !== LF.par || tfBinance() !== LF.tf) return LF.start();   // cambió el par o la temporalidad
    let filas;
    try {
      filas = await pide(LF.par, LF.tf, 2);
      LF.fallos = 0;
    } catch (err) {
      LF.fallos++;
      if (LF.fallos === 3 && global.U) U.toast('⚠️ En vivo: sin respuesta de Binance, reintentando', 'warn', 4000);
      return;
    }
    const velas = App.candles;
    if (!velas || !velas.length || !filas.length) return;
    const ultima = velas[velas.length - 1];
    /* Si la serie quedó lejos de lo que pide Binance (p. ej. se cargó historial sin parar el modo),
       no se encadenan velas con huecos: se vuelve a arrancar limpio. */
    const tfSeg = ((DS.TIMEFRAMES && DS.TIMEFRAMES[App.interval]) || { ms: 3600e3 }).ms / 1000;
    if (filas[filas.length - 1].time - ultima.time > 2 * tfSeg) return LF.start();
    let cambio = false, nueva = false;
    filas.sort((a, b) => a.time - b.time).forEach((f) => {
      if (f.time === ultima.time) {
        if (f.high !== ultima.high || f.low !== ultima.low || f.close !== ultima.close || f.volume !== ultima.volume) {
          Object.assign(ultima, f); cambio = true;
        }
      } else if (f.time > ultima.time) {
        velas.push(f); nueva = true;
      }
    });
    if (nueva) {
      // Vela nueva: misma ruta que la carga, para que indicadores y cursor queden coherentes.
      App.useCandles(velas, { source: 'Binance en vivo', startIndex: velas.length - 1 });
      BR.state.index = velas.length - 1;
    } else if (cambio) {
      // Mismo bloque, precio nuevo: el array de BR es esta misma referencia, así que basta repintar.
      CM.setCandleData(velas);
      App.rebuildIndicatorData();
    }
  };

  LF.toggle = function () { return LF.on ? LF.stop() : LF.start(); };

  // Botón (si la página lo tiene). Se enlaza al cargar, con App ya definido.
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('btnVivo');
    if (b) b.addEventListener('click', () => LF.toggle());
    // «Cargar datos» pide historial a propósito: si el modo en vivo sigue activo lo pisaría.
    const carga = document.getElementById('btnLoad');
    if (carga) carga.addEventListener('click', () => { if (LF.on) LF.stop(); });
    marcaBoton();
  });

  global.LF = LF;
})(typeof window !== 'undefined' ? window : globalThis);
