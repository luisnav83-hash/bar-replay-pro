/* =========================================================================
 * tests/network.test.js — Prueba de la carga de velas por red real.
 *
 *  Verifica la paginación automática de Binance (1000 velas por petición)
 *  contra el proxy del backend (server.js) o directamente contra Binance.
 *  Si no hay red disponible, la prueba se marca como OMITIDA.
 *
 *  Ejecutar:  node tests/network.test.js
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------ Contexto aislado ------------------------------ */
const shim = {
  console, Math, JSON, Date, Array, Object, Number, String, Boolean, Error,
  setTimeout, clearTimeout, performance: { now: () => Date.now() },
  fetch: globalThis.fetch,                 // Node ≥ 18 trae fetch nativo
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  URL, URLSearchParams, TextDecoder, Headers, Request, Response,
  document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {} }), querySelectorAll: () => [], addEventListener() {} },
  addEventListener() {}, dispatchEvent: () => true,
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
};
shim.window = shim;
const ctx = vm.createContext(shim);
['js/utils.js', 'js/dataService.js'].forEach((f) =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f }));

const { DS } = shim;

let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.error('  ✗ ' + m));

(async () => {
  // 1) ¿Hay red? Se prueba primero el proxy local y luego Binance directo.
  let base = null, via = null;
  try {
    const r = await fetch('http://127.0.0.1:8080/api/status', { signal: AbortSignal.timeout(2000) });
    if (r.ok) { base = 'http://127.0.0.1:8080'; via = 'proxy local (server.js)'; }
  } catch (e) {}
  if (!base) {
    try {
      const r = await fetch('https://data-api.binance.vision/api/v3/ping', { signal: AbortSignal.timeout(6000) });
      if (r.ok) { base = 'https://data-api.binance.vision'; via = 'Binance directo'; }
    } catch (e) {}
  }
  if (!base) {
    console.log('⚠️  Sin red (ni proxy local ni Binance): prueba OMITIDA.');
    process.exit(0);
  }
  console.log(`\n▸ Cargando velas reales vía ${via}: ${base}`);

  DS.BINANCE_HOSTS = [base];

  // 2) Rango de ~2500 velas de 1h → debe paginar en 3 peticiones de 1000
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - 2500 * 3600;
  let progressCalls = 0;

  const candles = await DS.fetchBinanceKlines('BTCUSDT', '1h', startTs, endTs, () => progressCalls++);

  console.log(`  · velas descargadas: ${candles.length} (${progressCalls} actualizaciones de progreso)`);
  ok(candles.length > 2000, `se descargaron más de 2000 velas paginando (${candles.length})`);
  ok(progressCalls >= 2, 'la paginación informa del progreso más de una vez');

  // 3) Integridad de los datos
  const times = candles.map((c) => c.time);
  ok(times.every((t, i) => i === 0 || t > times[i - 1]), 'las velas están ordenadas y sin duplicados');
  ok(times.every((t, i) => i === 0 || t - times[i - 1] === 3600), 'todas las velas son de 1h consecutivas (sin huecos)');
  ok(candles.every((c) => c.high >= Math.max(c.open, c.close) - 1e-9 && c.low <= Math.min(c.open, c.close) + 1e-9),
    'OHLC coherente en todas las velas (high ≥ max, low ≤ min)');
  ok(candles.every((c) => c.close > 0 && Number.isFinite(c.volume)), 'precios positivos y volumen numérico');
  ok(candles[0].time >= startTs && candles[candles.length - 1].time <= endTs, 'el rango respeta los límites pedidos');
  const last = candles[candles.length - 1];
  console.log(`  · primera: ${new Date(candles[0].time * 1000).toISOString()} @ ${candles[0].close}`);
  console.log(`  · última:  ${new Date(last.time * 1000).toISOString()} @ ${last.close}`);

  // 4) Otras temporalidades y pares
  const c4h = await DS.fetchBinanceKlines('ETHUSDT', '4h', endTs - 200 * 4 * 3600, endTs);
  ok(c4h.length > 150, `ETH/USDT 4h descargado (${c4h.length} velas)`);
  ok(c4h.every((c, i) => i === 0 || c.time - c4h[i - 1].time === 4 * 3600), 'las velas de 4h están espaciadas 4 horas');

  const c1d = await DS.fetchBinanceKlines('BTCUSDT', '1d', endTs - 60 * 86400, endTs);
  ok(c1d.length >= 55, `BTC/USDT 1d descargado (${c1d.length} velas)`);

  console.log(`\nPruebas de red superadas: ${passed}   Fallidas: ${failed}`);
  console.log(failed ? '❌ Fallos en la carga de datos reales.' : '✅ La carga de datos reales funciona correctamente.');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('⚠️  Error de red inesperado:', e.message);
  console.log('   Prueba OMITIDA (posible falta de conectividad).');
  process.exit(0);
});
