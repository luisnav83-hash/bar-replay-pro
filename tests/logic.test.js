/* =========================================================================
 * tests/logic.test.js — Pruebas de la lógica (sin navegador).
 *
 *  Ejecutar:  node tests/logic.test.js
 *
 *  Carga los módulos del proyecto en un contexto aislado (vm) con un shim
 *  mínimo de `window`, y verifica indicadores, servicio de datos, motor de
 *  trading, checkpoints, estadísticas y motor de replay.
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------- Mini framework ------------------------------- */
let passed = 0, failed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error('  ✗ ' + msg); }
}
function eq(actual, expected, msg) {
  const a = typeof actual === 'number' ? Math.round(actual * 1e8) / 1e8 : actual;
  const e = typeof expected === 'number' ? Math.round(expected * 1e8) / 1e8 : expected;
  ok(Object.is(a, e), `${msg} (esperado ${e}, obtenido ${a})`);
}
function near(actual, expected, tol, msg) {
  ok(Math.abs(actual - expected) <= tol, `${msg} (esperado ≈${expected} ±${tol}, obtenido ${actual})`);
}
function section(name) { console.log('\n▸ ' + name); }

/* ------------------------------- Shims ------------------------------- */

const listeners = {};
const shim = {
  console,
  Math, JSON, Date, Array, Object, Number, String, Boolean, Error, isNaN, parseFloat, parseInt,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  devicePixelRatio: 1,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  dispatchEvent: (e) => { (listeners[e.type] || []).forEach((f) => f(e)); return true; },
  CustomEvent: class CustomEvent {
    constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); }
  },
  document: {
    getElementById: () => null,
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {},
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  },
  localStorage: null,
  fetch: () => Promise.reject(new Error('sin red en tests')),
};
shim.window = shim;
shim.self = shim;
const ctx = vm.createContext(shim);

function load(rel) {
  const code = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  vm.runInContext(code, ctx, { filename: rel });
}

/* Carga de módulos en orden de dependencias (sin los que tocan el DOM) */
['js/utils.js', 'js/indicators.js', 'js/dataService.js', 'js/tradingEngine.js', 'js/statistics.js', 'js/barReplay.js']
  .forEach(load);

const { U, IND, DS, TE, STATS, BR } = shim;

/* ================================ UTILS ================================ */
section('utils.js — formateo y fechas UTC');
eq(U.fmtPrice(65000.1234), '65,000.12', 'fmtPrice enmascara miles');
eq(U.fmtPrice(0.00012345), '0.00012345', 'fmtPrice con precios diminutos');
eq(U.fmtMoney(-1234.5, true), '-$1,234.50', 'fmtMoney con signo negativo');
eq(U.fmtPct(12.3456, 2, true), '+12.35%', 'fmtPct redondeado');
eq(U.fmtVol(1234567), '1.23M', 'fmtVol abreviado');
eq(U.tsToInput(Date.UTC(2024, 2, 15, 14, 30) / 1000), '2024-03-15T14:30', 'tsToInput en UTC');
eq(U.inputToTs('2024-03-15T14:30'), Math.floor(Date.UTC(2024, 2, 15, 14, 30) / 1000), 'inputToTs interpreta UTC');
eq(U.fmtDuration(0, 3600 * 3 + 60 * 25), '3h 25m', 'fmtDuration horas y minutos');
eq(U.fmtDuration(0, 86400 * 2 + 3600 * 5), '2d 5h', 'fmtDuration días');
eq(U.clamp(15, 0, 10), 10, 'clamp por arriba');
eq(U.round(1.23456, 3), 1.235, 'round a 3 decimales');

/* ============================== INDICADORES ============================== */
section('indicators.js — indicadores técnicos');
const mkC = (closes) => closes.map((c, i) => ({ time: 1000 + i * 3600, open: c, high: c + 1, low: c - 1, close: c, volume: 10 + i }));

// SMA: media de 1,2,3 = 2; y comprobación de la ventana móvil
let candles = mkC([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
let sma = IND.sma(candles, 3);
eq(sma[0], null, 'SMA no tiene valor antes del período');
eq(sma[2], 2, 'SMA(3) en la 3ª vela');
eq(sma[3], 3, 'SMA(3) en la 4ª vela');
eq(sma[9], 9, 'SMA(3) en la última vela');

// EMA: semilla = SMA del período y decaimiento exponencial
candles = mkC([1, 2, 3, 4, 5]);
let ema = IND.ema(candles, 3);
eq(ema[1], null, 'EMA no tiene valor antes del período');
eq(ema[2], 2, 'EMA(3) primera semilla = SMA');
near(ema[3], 3, 1e-9, 'EMA(3) siguiente valor');
near(ema[4], 4, 1e-9, 'EMA(3) valor final');

// RSI: serie estrictamente creciente → 100; estrictamente decreciente → 0
equalRSI(100, 'RSI en serie creciente = 100');
function equalRSI(expected, msg) {
  const inc = mkC(Array.from({ length: 30 }, (_, i) => 100 + i));
  const r = IND.rsi(inc, 14);
  near(r[29], expected, 1e-6, msg);
  const dec = mkC(Array.from({ length: 30 }, (_, i) => 200 - i));
  near(IND.rsi(dec, 14)[29], 100 - expected, 1e-6, msg.replace('100', '0'));
}
const flat = mkC(new Array(30).fill(100));
eq(IND.rsi(flat, 14)[29], 100, 'RSI en serie plana = 100 (sin pérdidas)');

// Bollinger: en serie plana, las bandas coinciden con la media
const bb = IND.bollinger(flat, 20, 2);
near(bb.middle[25], 100, 1e-9, 'Bollinger media en serie plana');
near(bb.upper[25], 100, 1e-9, 'Bollinger banda superior en serie plana');
near(bb.lower[25], 100, 1e-9, 'Bollinger banda inferior en serie plana');

// ATR: con high-low = 2 constante, el ATR debe ser 2
const atrC = mkC(new Array(30).fill(100)).map((c) => ({ ...c, high: 101, low: 99 }));
near(IND.atr(atrC, 14)[29], 2, 1e-9, 'ATR con rango constante');

// MACD: en serie plana, macd y señal valen 0
const macd = IND.macd(flat, 12, 26, 9);
near(macd.macd[29], 0, 1e-9, 'MACD en serie plana = 0');
near(macd.signal[29], 0, 1e-9, 'Señal MACD en serie plana = 0');
near(macd.hist[29], 0, 1e-9, 'Histograma MACD en serie plana = 0');

// Causalidad: los valores hasta i no deben cambiar al añadir velas futuras
const base = mkC([5, 7, 6, 9, 8, 10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 21, 20, 22, 24, 23, 25, 27, 26, 28, 30]);
const extended = mkC([...base.map((c) => c.close), 32, 31, 33, 35, 34, 36, 38, 37, 39, 41]);
['sma', 'ema'].forEach((fn) => {
  const p = fn === 'sma' ? 5 : 7;
  const a = IND[fn](base, p);
  const b = IND[fn](extended, p);
  ok(a.every((v, i) => (v === null && b[i] === null) || Math.abs(v - b[i]) < 1e-12),
    `${fn.toUpperCase()} es causal (no usa datos futuros)`);
});
const rsiA = IND.rsi(base, 14), rsiB = IND.rsi(extended, 14);
ok(rsiA.every((v, i) => (v === null && rsiB[i] === null) || Math.abs(v - rsiB[i]) < 1e-12), 'RSI es causal');
const bbA = IND.bollinger(base, 10, 2), bbB = IND.bollinger(extended, 10, 2);
ok(bbA.upper.every((v, i) => (v === null && bbB.upper[i] === null) || Math.abs(v - bbB.upper[i]) < 1e-12), 'Bollinger es causal');

/* ============================== DATA SERVICE ============================== */
section('dataService.js — CSV, datos sintéticos y resample');

const csv1 = `time,open,high,low,close,volume
2024-01-01 00:00:00,42000,42100,41900,42050,120.5
2024-01-01 01:00:00,42050,42200,42000,42180,98.2`;
const p1 = DS.parseCSV(csv1);
eq(p1.length, 2, 'CSV con cabecera: 2 velas');
eq(p1[0].open, 42000, 'CSV: precio open');
eq(p1[0].time, Math.floor(Date.UTC(2024, 0, 1, 0, 0, 0) / 1000), 'CSV: fecha ISO interpretada en UTC');

const csv2 = `1704067200000;100;110;95;105;10
1704070800000;105;115;104;112;12`;
const p2 = DS.parseCSV(csv2);
eq(p2.length, 2, 'CSV sin cabecera con separador «;»: 2 velas');
eq(p2[0].time, 1704067200, 'CSV: epoch en milisegundos convertido a segundos');
eq(p2[1].close, 112, 'CSV: cierre leído');

const p3 = DS.parseCSV(csv1 + '\n' + csv1.split('\n')[1]); // duplicado
eq(p3.length, 2, 'CSV: los duplicados por tiempo se eliminan');

// Datos sintéticos: determinismo e integridad OHLC
const s1 = DS.synth({ n: 500, interval: '1h', startPrice: 50000, seed: 123, startTs: 1700000000 });
const s2 = DS.synth({ n: 500, interval: '1h', startPrice: 50000, seed: 123, startTs: 1700000000 });
eq(s1.length, 500, 'synth: nº de velas correcto');
eq(JSON.stringify(s1.slice(0, 20)), JSON.stringify(s2.slice(0, 20)), 'synth: reproducible con la misma semilla');
ok(s1.every((c, i) => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)),
  'synth: high/low coherentes con open/close');
ok(s1.every((c, i) => i === 0 || c.time === s1[i - 1].time + 3600), 'synth: velas equiespaciadas 1h');
ok(s1.every((c) => c.close > 0 && Number.isFinite(c.volume)), 'synth: precios positivos y volumen finito');

// Resample 1h → 4h (las velas se agrupan en bloques anclados al reloj UTC)
const res = DS.resample(s1, 4 * 3600e3);
const bucketMs = 4 * 3600 * 1000;
const firstBucket = Math.floor(s1[0].time * 1000 / bucketMs) * bucketMs;
const block = s1.filter((c) => Math.floor(c.time * 1000 / bucketMs) * bucketMs === firstBucket);
eq(res[0].open, block[0].open, 'resample: open de la primera vela del bloque');
eq(res[0].close, block[block.length - 1].close, 'resample: close de la última vela del bloque');
eq(res[0].high, Math.max(...block.map((c) => c.high)), 'resample: high máximo del bloque');
eq(res[0].volume, block.reduce((a, c) => a + c.volume, 0), 'resample: volumen agregado');
ok(block.length <= 4 && block.length >= 1, 'resample: bloques de como máximo 4 velas de 1h');

/* ============================== TRADING ENGINE ============================== */
section('tradingEngine.js — cuentas, SL/TP, liquidación y checkpoints');
TE.configure({ initialCapital: 10000, leverage: 1, feePct: 0.1, fundingPct: 0, slFirst: 'worst' });
TE.resetAccount(10000);

// Apertura LONG
let pos = TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, sl: 95, tp: 110, leverage: 1, feePct: 0.1, time: 1000 });
ok(!!pos, 'se abre una posición LONG');
eq(pos.qty, 100, 'cantidad = notional / precio');
eq(pos.notional, 10000, 'notional = 100% del equity a 1x');
near(TE.state.balance, 9990, 1e-9, 'la comisión de apertura se descuenta del balance');
eq(pos.riskUsd, 500, 'riesgo inicial al SL');
ok(TE.openPosition('long', { mode: 'pct', size: 10, entryPrice: 100 }) === null, 'no se permite una segunda posición simultánea');

// Avance sin tocar niveles
candles = [{ time: 2000, open: 100, high: 105, low: 99, close: 104, volume: 1 }];
let closed = TE.onCandle(candles[0]);
eq(closed, null, 'sin evento si no se toca SL/TP');
eq(TE.state.position.bars, 1, 'contador de velas de la posición');
near(TE.unrealized(104), 400, 1e-9, 'PnL no realizado a 104');

// Take profit: 110 → se ejecuta al nivel exacto
candles = [{ time: 3000, open: 104, high: 111, low: 103, close: 110.5, volume: 1 }];
closed = TE.onCandle(candles[0]);
ok(!!closed && closed.reason === 'tp', 'el take profit se ejecuta automáticamente');
eq(closed.exitPrice, 110, 'el TP se ejecuta al precio del nivel');
near(closed.pnl, 1000 - 10 - 11, 1e-9, 'PnL del trade = bruto − comisión de apertura − comisión de cierre');
near(TE.state.balance, 10000 + 979, 1e-9, 'balance tras cerrar en TP');
near(closed.pnlPct, (979 / 9990) * 100, 1e-9, 'pnlPct respecto al capital al entrar');
near(closed.rMultiple, 979 / 500, 1e-9, 'R múltiplo = PnL / riesgo');
eq(closed.fees, 10 + 11, 'comisiones de ida y vuelta registradas en el trade');
eq(TE.state.position, null, 'la posición queda cerrada');

// Stop loss
TE.resetAccount(10000);
pos = TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, sl: 95, tp: 120, leverage: 1, feePct: 0.1, time: 1000 });
closed = TE.onCandle({ time: 2000, open: 100, high: 101, low: 94, close: 94.5, volume: 1 });
ok(closed && closed.reason === 'sl', 'el stop loss se ejecuta automáticamente');
near(closed.pnl, -(500 + 10 + 9.5), 1e-9, 'pérdida = −riesgo − comisiones de ida y vuelta');
near(TE.state.balance, 10000 - 519.5, 1e-9, 'balance tras el SL');

// Gap: abre por debajo del SL → se ejecuta al open (peor precio)
TE.resetAccount(10000);
TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, sl: 95, tp: 120, leverage: 1, feePct: 0, time: 1000 });
closed = TE.onCandle({ time: 2000, open: 90, high: 91, low: 89, close: 90.5, volume: 1 });
eq(closed.exitPrice, 90, 'con gap, el SL se rellena al precio de apertura del hueco');
near(closed.pnl, -1000, 1e-9, 'el gap genera pérdida mayor que el riesgo previsto');
near(TE.state.balance, 9000, 1e-9, 'el balance refleja la pérdida del hueco');

// Ambigüedad en la misma vela: por defecto se asume lo peor (SL primero)
TE.configure({ slFirst: 'worst' });
TE.resetAccount(10000);
TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, sl: 95, tp: 110, leverage: 1, feePct: 0, time: 1000 });
closed = TE.onCandle({ time: 2000, open: 100, high: 111, low: 94, close: 105, volume: 1 });
eq(closed.reason, 'sl', 'modo pesimista: si la vela toca SL y TP, gana el SL');
TE.configure({ slFirst: 'best' });
TE.resetAccount(10000);
TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, sl: 95, tp: 110, leverage: 1, feePct: 0, time: 1000 });
closed = TE.onCandle({ time: 2000, open: 100, high: 111, low: 94, close: 105, volume: 1 });
eq(closed.reason, 'tp', 'modo optimista: se ejecuta el TP primero');
TE.configure({ slFirst: 'worst' });

// SHORT y validación de niveles
TE.resetAccount(10000);
pos = TE.openPosition('short', { mode: 'pct', size: 50, entryPrice: 100, sl: 105, tp: 90, leverage: 2, feePct: 0.1, time: 1000 });
near(pos.notional, 10000, 1e-9, 'SHORT al 50% con 2x → notional = capital');
near(pos.qty, 100, 1e-9, 'cantidad del SHORT');
near(TE.marginUsed(), 5000, 1e-9, 'margen bloqueado = notional / apalancamiento');
// La liquidación depende del MODO DE MARGEN (Cruzado/Aislado, como en el panel de futuros) y,
// desde el estudio de Bitunix (docs/estudio-futuros-bitunix.md §2), del MARGEN DE MANTENIMIENTO:
// F6 dice «Maintenance Margin = Open Price · Size · MMR» y «se liquida cuando Available Margin =
// Initial Margin − PnL cae por debajo de ese MM». Despejado el precio:
//     aislado:  liq = entrada · (1 + 1/lev − MMR)          (short)
//     cruzado:  liq = entrada + (margen + libre − entrada·tamaño·MMR) / tamaño
// El nivel (y su MMR) se mira sobre el notional de ENTRADA, que es la misma base que usa la fórmula
// de Bitunix («Open Price · Size»), no sobre el notional actual.
const MMR1 = 0.004;                              // nivel 1 de la tabla de get_position_tiers
TE.state.marginMode = 'isolated';
near(TE.liquidationPrice(pos), 100 * (1 + 1 / 2 - MMR1), 1e-9,
   `liquidación AISLADA (2x short) = entrada·(1 + 1/lev − MMR) = ${(100 * (1 + 0.5 - MMR1)).toFixed(2)}`);
// El modelo viejo (sin margen de mantenimiento) sigue siendo un CASO PARTICULAR, no algo perdido:
TE.configure({ niveles: null });
near(TE.liquidationPrice(pos), 150, 1e-9, 'con niveles:null vuelve la fórmula clásica entrada·(1 + 1/lev)');
TE.configure({ niveles: [{ level: 1, startValue: 0, endValue: 50000, leverage: 125, maintenanceMarginRate: MMR1 },
                         { level: 2, startValue: 50000, endValue: 200000, leverage: 100, maintenanceMarginRate: 0.005 }] });
TE.state.marginMode = 'cross';
{
  const liqCruzada = TE.liquidationPrice(pos);
  const mm = 100 * 100 * MMR1;                   // margen de mantenimiento de esta posición
  const esperadoCruzada = 100 + (5000 + (TE.state.balance - 5000) - mm) / 100;
  near(liqCruzada, esperadoCruzada, 1e-6,
    `liquidación CRUZADA (2x short) = entrada + (margen + libre − MM)/qty, con MM = 100·100·${MMR1} = ${mm}`);
  ok(liqCruzada > TE.liquidationPrice(Object.assign({}, pos)) || liqCruzada > 149,
    `el cruzado aleja la liquidación del short (${liqCruzada.toFixed(2)} > 149,6 de aislado)`);
  ok(mm > 0 && Math.abs((esperadoCruzada - (100 + (5000 + (TE.state.balance - 5000)) / 100))) < 1,
    'el margen de mantenimiento acerca la liquidación (menos precio de referencia), no la aleja');
}
TE.state.marginMode = 'cross';
closed = TE.onCandle({ time: 2000, open: 100, high: 101, low: 89, close: 91, volume: 1 });
ok(closed && closed.reason === 'tp', 'SHORT cierra en TP al bajar el precio');
near(closed.pnl, (100 - 90) * 100 - 10 - 9, 1e-9, 'PnL del SHORT en TP (con comisiones)');
near(TE.state.balance, 10000 + 981, 1e-9, 'balance tras el SHORT en TP');

// Liquidación con apalancamiento
TE.resetAccount(10000);
pos = TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, sl: null, tp: null, leverage: 10, feePct: 0.1, time: 1000 });
const liq = TE.liquidationPrice(pos);
// notional 100 000 ⇒ NIVEL 2 de la tabla (50 000…200 000, MMR 0,005, apalancamiento máx 100):
//   liq = 100 − (10 000 + libre − 100·1000·0,005)/1000
const MMR2 = 0.005, mm2 = 100 * 1000 * MMR2;
const libreEn10x = Math.max(0, TE.freeMargin());
near(liq, 100 - (10000 + libreEn10x - mm2) / 1000, 1e-6,
   `liquidación a 10x con el MMR del NIVEL 2 (${liq.toFixed(2)}): entrada − (margen + libre − ${mm2})/qty`);
ok(TE.liqInfo(pos).nivel === 2 && TE.liqInfo(pos).apalancamientoMax === 100,
   `y la carta sabe en qué nivel está la posición (nivel ${TE.liqInfo(pos).nivel}, apalancamiento máx ${TE.liqInfo(pos).apalancamientoMax})`);
ok(TE.apalancamientoPermitido(100000, 200).leverage === 100 && TE.apalancamientoPermitido(100000, 200).recortado,
   'pedir 200x en el nivel 2 se RECORTA a 100x: el apalancamiento pedido es un techo, no un derecho');
closed = TE.onCandle({ time: 2000, open: 95, high: 96, low: 85, close: 86, volume: 1 });
eq(closed.reason, 'liq', 'se cierra por liquidación al tocar el nivel');
// Y aquí está la diferencia de fondo con el modelo viejo: al liquidar se pierde hasta el MARGEN DE
// MANTENIMIENTO, no hasta cero. Eso es lo que dice F6 («Available Margin < Maintenance Margin») y
// lo que hace que queden restos en la cuenta.
const perdida = (100 - liq) * 1000;
near(closed.pnl, -perdida - 100 - liq * 1000 * 0.001, 1e-4,
   'PnL de la liquidación = −(distancia·tamaño) − comisiones de ida y vuelta (no −margen entero)');
ok(TE.state.balance > 0, `al liquidar queda margen en la cuenta (${TE.state.balance.toFixed(2)} > 0): se liquida AL tocar el mantenimiento, no al vaciar el capital`);

// Checkpoints: retroceder restaura el estado exacto
TE.resetAccount(10000);
const cps = [];
const allCandles = DS.synth({ n: 40, interval: '1h', startPrice: 100, seed: 7, startTs: 1700000000 });
cps[0] = null;
allCandles.forEach((c) => {
  TE.onCandle(c);
  cps.push({
    bal: TE.state.balance, eq: TE.state.equity, fees: TE.state.feesPaid, seq: TE.state.seq,
    tradesLen: TE.state.trades.length, eqLen: TE.state.equitySeries.length,
    hasPos: !!TE.state.position, pos: TE.state.position ? JSON.parse(JSON.stringify(TE.state.position)) : null,
    lastPrice: TE.state.lastPrice, lastTime: TE.state.lastTime,
  });
});
// Abrimos posición a mitad y avanzamos dejando checkpoints por vela
TE.openPosition('long', { mode: 'pct', size: 25, entryPrice: allCandles[20].close, leverage: 3, feePct: 0.1, time: allCandles[20].time });
for (let i = 21; i < 30; i++) {
  TE.onCandle(allCandles[i]);
  cps[i] = {
    bal: TE.state.balance, eq: TE.state.equity, fees: TE.state.feesPaid, seq: TE.state.seq,
    tradesLen: TE.state.trades.length, eqLen: TE.state.equitySeries.length,
    hasPos: !!TE.state.position, pos: TE.state.position ? JSON.parse(JSON.stringify(TE.state.position)) : null,
    lastPrice: TE.state.lastPrice, lastTime: TE.state.lastTime,
  };
}
// Rebobinamos al índice 22 y comprobamos que el estado vuelve a ser el de ese momento
TE.restoreFromCheckpoint(cps[22]);
eq(TE.state.lastTime, allCandles[22].time, 'rewind: tiempo de la última vela restaurado');
eq(TE.state.trades.length, cps[22].tradesLen, 'rewind: historial de trades restaurado');
near(TE.state.balance, cps[22].bal, 1e-9, 'rewind: balance restaurado al del checkpoint');

// Prueba limpia: checkpoint con posición abierta y retroceso real
TE.resetAccount(10000);
const pos1 = TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, sl: 90, tp: 130, leverage: 1, feePct: 0.1, time: 1000 });
const cpAtOpen = {
  bal: TE.state.balance, eq: TE.state.equity, fees: TE.state.feesPaid, seq: TE.state.seq,
  tradesLen: TE.state.trades.length, eqLen: TE.state.equitySeries.length,
  hasPos: true, pos: JSON.parse(JSON.stringify(TE.state.position)),
  lastPrice: 100, lastTime: 1000,
};
for (let i = 0; i < 5; i++) TE.onCandle({ time: 2000 + i * 3600, open: 100 + i, high: 106 + i, low: 99 + i, close: 105 + i, volume: 1 });
const balanceAfterAdvance = TE.state.balance;
const barsAfterAdvance = TE.state.position ? TE.state.position.bars : -1;
TE.restoreFromCheckpoint(cpAtOpen);
eq(TE.state.balance, cpAtOpen.bal, 'rewind: balance restaurado');
eq(TE.state.position.bars, 0, 'rewind: contador de velas de la posición restaurado');
eq(TE.state.position.mfe, 0, 'rewind: excursión favorable reiniciada');
eq(TE.state.equitySeries.length, cpAtOpen.eqLen, 'rewind: la curva de capital se recorta al checkpoint');
eq(TE.state.trades.length, cpAtOpen.tradesLen, 'rewind: el historial se recorta al checkpoint');
// Y al reavanzar las mismas velas se llega al mismo resultado (determinismo)
for (let i = 0; i < 5; i++) TE.onCandle({ time: 2000 + i * 3600, open: 100 + i, high: 106 + i, low: 99 + i, close: 105 + i, volume: 1 });
eq(TE.state.balance, balanceAfterAdvance, 'rewind: reavanzar reproduce el mismo balance');
eq(TE.state.position.bars, barsAfterAdvance, 'rewind: reavanzar reproduce el mismo contador');

// FUNDING (estudio §3): cada 8 h, en las horas UTC 00/08/16, sobre el notional, y con el signo del
// lado. El modelo viejo —un % por vela, igual para long y short— no existe en ningún perpetuo:
// medía de más en temporalidades pequeñas, de menos en las grandes, y cobraba a los dos lados.
TE.configure({ fundingPct: 0.01 });
TE.resetAccount(10000);
const H = 3600000;                                // las velas del motor van en milisegundos
const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);        // medianoche UTC: hay liquidación a las 8 h
TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, leverage: 1, feePct: 0, time: t0 });
const balLargo = TE.state.balance;
TE.onCandle({ time: t0 + 7 * H, open: 100, high: 101, low: 99, close: 100, volume: 1 });
near(TE.state.balance, balLargo, 1e-9, 'antes de la hora de liquidación NO se cobra funding (ni una vela antes)');
TE.onCandle({ time: t0 + 8 * H, open: 100, high: 101, low: 99, close: 100, volume: 1 });
near(balLargo - TE.state.balance, 10000 * 0.0001, 1e-9,
   'a las 08:00 UTC el LARGO PAGA el funding sobre el notional (10 000 × 0,01 % = 1 USDT)');
TE.resetAccount(10000);
TE.openPosition('short', { mode: 'pct', size: 100, entryPrice: 100, leverage: 1, feePct: 0, time: t0 });
const balCorto = TE.state.balance;
TE.onCandle({ time: t0 + 8 * H, open: 100, high: 101, low: 99, close: 100, volume: 1 });
near(TE.state.balance - balCorto, 10000 * 0.0001, 1e-9,
   'y el CORTO LO COBRA con tasa positiva: el mismo importe, signo contrario (así se paga el funding, no es un coste)');
// Dos liquidaciones en una vela grande (diaria): se pagan las DOS, no una.
TE.resetAccount(10000);
TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, leverage: 1, feePct: 0, time: t0 });
const balDos = TE.state.balance;
TE.onCandle({ time: t0 + 24 * H, open: 100, high: 101, low: 99, close: 100, volume: 1 });
near(balDos - TE.state.balance, 3 * 10000 * 0.0001, 1e-9,
   'una vela de 1 día cruza las TRES liquidaciones del día (00/08/16 UTC) y se cobran las tres');
TE.configure({ fundingPct: 0 });

/* ============================== ESTADÍSTICAS ============================== */
section('statistics.js — métricas de rendimiento');
const trades = [
  { status: 'closed', pnl: 100, pnlPct: 1, rMultiple: 2, fees: 2, entryTime: 0, exitTime: 3600, reason: 'tp', side: 'long' },
  { status: 'closed', pnl: -50, pnlPct: -0.5, rMultiple: -1, fees: 2, entryTime: 0, exitTime: 3600, reason: 'sl', side: 'long' },
  { status: 'closed', pnl: 200, pnlPct: 2, rMultiple: 3, fees: 2, entryTime: 0, exitTime: 7200, reason: 'tp', side: 'short' },
  { status: 'closed', pnl: -30, pnlPct: -0.3, rMultiple: null, fees: 2, entryTime: 0, exitTime: 3600, reason: 'manual', side: 'short' },
];
const st = STATS.compute(trades, [], 10000);
eq(st.total, 4, 'nº total de trades');
eq(st.wins, 2, 'trades ganadores');
eq(st.losses, 2, 'trades perdedores');
eq(st.winRate, 50, 'win rate');
eq(st.totalPnl, 220, 'PnL total');
eq(st.profitFactor, 300 / 80, 'profit factor');
eq(st.expectancy, 55, 'expectancy por trade');
eq(st.best, 200, 'mejor trade');
eq(st.worst, -50, 'peor trade');
near(st.avgR, (2 + -1 + 3) / 3, 1e-9, 'R medio de los trades con riesgo definido');
eq(st.maxDD, 50, 'máximo drawdown sobre la curva realizada');
eq(st.totalFees, 8, 'comisiones acumuladas');
eq(st.byReason.tp, 2, 'recuento de salidas por TP');
eq(st.byReason.sl, 1, 'recuento de salidas por SL');

const streakTrades = [1, 2, -1, -1, -1, 3].map((p) => ({ status: 'closed', pnl: p, fees: 0, entryTime: 0, exitTime: 1, reason: 'manual', side: 'long' }));
const st2 = STATS.compute(streakTrades, [], 10000);
eq(st2.bestStreak, 2, 'mejor racha ganadora');
eq(st2.worstStreak, 3, 'peor racha perdedora');
eq(st2.currentStreak, 1, 'racha actual');
eq(st2.streakType, 'W', 'tipo de la racha actual');

// Drawdown sobre la equity real (incluye curvas intradía)
const st3 = STATS.compute([], [{ value: 10000 }, { value: 12000 }, { value: 9000 }, { value: 11000 }], 10000);
eq(st3.maxDD, 3000, 'máximo drawdown desde el pico de equity');
eq(st3.maxDDPct, 0.25, 'drawdown porcentual respecto al pico');

const csv = STATS.tradesToCSV([{ side: 'long', entryTime: 1700000000, exitTime: 1700003600, entryPrice: 100, exitPrice: 110, qty: 1, notional: 100, leverage: 1, pnl: 10, pnlPct: 1, rMultiple: 1, reason: 'tp', bars: 1, fees: 0.2 }], 'BTCUSDT', '1h');
ok(csv.includes('BTCUSDT') && csv.includes('LONG') && csv.split('\n').length === 3, 'exportación CSV de trades');

/* ============================== BAR REPLAY ============================== */
section('barReplay.js — control del replay');
const series = DS.synth({ n: 100, interval: '1h', startPrice: 100, seed: 3, startTs: 1700000000 });
let advanced = [], seeks = [];
BR.onAdvance = (from, to) => advanced.push([from, to]);
BR.onSeek = (index) => seeks.push(index);
BR.setData(series, 20, '1h');
eq(BR.total(), 100, 'total de velas');
eq(BR.getIndex(), 20, 'cursor en el índice inicial');
eq(BR.hiddenCount(), 79, 'velas ocultas al inicio');
near(BR.progressTotal(), 20 / 99, 1e-9, 'progreso total');
near(BR.progress(), 0, 1e-9, 'progreso del tramo de replay al inicio');

BR.stepForward();
eq(BR.getIndex(), 21, 'avance de una vela');
eq(advanced.length, 1, 'el avance notifica al consumidor');
eq(advanced[0][0], 20, 'índice de origen del aviso');
eq(advanced[0][1], 21, 'índice de destino del aviso');

BR.stepBack();
eq(BR.getIndex(), 20, 'retroceso de una vela');
eq(seeks[0], 20, 'el retroceso notifica por onSeek');
ok(BR.stepBack() === false, 'no se puede retroceder más allá del inicio del replay');

BR.seek(60);
eq(BR.getIndex(), 60, 'seek a un índice concreto');
near(BR.progress(), (60 - 20) / 79, 1e-9, 'progreso del tramo tras el seek');

BR.reset();
eq(BR.getIndex(), 20, 'reset vuelve al inicio del replay');

eq(BR.setSpeed(5) || BR.state.speed, 5, 'velocidad configurable');
eq(BR.speedUp(1), 10, 'subir velocidad');
eq(BR.speedUp(1), 50, 'subir velocidad hasta 50x');
eq(BR.speedUp(1), 'max', 'subir velocidad hasta MAX');
eq(BR.speedUp(1), 'max', 'MAX es el tope');
eq(BR.speedUp(-1), 50, 'bajar velocidad');
BR.setSpeed(1);
eq(BR.speedLabel(), '1x', 'etiqueta de velocidad');

// Ir al final
BR.goToEnd();
eq(BR.getIndex(), 99, 'goToEnd sitúa el cursor en la última vela');
ok(BR.isAtEnd(), 'isAtEnd detecta el final');

// Serialización
BR.setData(series, 20, '1h');
BR.seek(45);
const ser = BR.serialize();
eq(ser.index, 45, 'serialización del cursor');
const series2 = DS.synth({ n: 120, interval: '1h', startPrice: 100, seed: 3, startTs: 1700000000 });
BR.restore({ index: 60, startIndex: 10, speed: 2, interval: '1h' }, series2);
eq(BR.getIndex(), 60, 'restauración del cursor');
eq(BR.state.speed, 2, 'restauración de la velocidad');

/* ============================== INTEGRACIÓN ============================== */
section('Integración: replay + trading sobre datos sintéticos');
TE.configure({ initialCapital: 10000, leverage: 1, feePct: 0.1, fundingPct: 0, slFirst: 'worst' });
TE.resetAccount(10000);
const sim = DS.synth({ n: 600, interval: '1h', startPrice: 30000, seed: 99, startTs: 1700000000 });
BR.onAdvance = (from, to) => { for (let i = from + 1; i <= to; i++) TE.onCandle(sim[i]); };
BR.onSeek = () => {};
BR.setData(sim, 200, '1h');

// Estrategia mecánica: compra cuando el precio sube, con SL/TP simétricos
let tradesDone = 0;
for (let i = 0; i < 400; i++) {
  const cur = BR.currentCandle();
  if (!TE.state.position && i % 25 === 0) {
    TE.openPosition('long', {
      mode: 'pct', size: 100, entryPrice: cur.close,
      sl: cur.close * 0.98, tp: cur.close * 1.03, leverage: 1, feePct: 0.1, time: cur.time,
    });
  }
  BR.stepForward();
}
const closedTrades = TE.state.trades.filter((t) => t.status === 'closed');
ok(closedTrades.length > 0, 'la simulación produce trades cerrados (' + closedTrades.length + ')');
ok(closedTrades.every((t) => ['sl', 'tp', 'liq', 'manual'].includes(t.reason)), 'todas las salidas tienen motivo válido');
ok(closedTrades.every((t) => Number.isFinite(t.pnl)), 'todos los PnL son finitos');
ok(TE.state.balance === TE.state.initialCapital + closedTrades.reduce((a, t) => a + t.pnl, 0),
  'el balance coincide con el capital inicial más la suma de PnL');
const finalStats = STATS.compute(TE.state.trades, TE.state.equitySeries, 10000);
ok(finalStats.total === closedTrades.length, 'las estadísticas cuadran con el historial');
ok(finalStats.maxDD >= 0 && finalStats.winRate >= 0 && finalStats.winRate <= 100, 'métricas en rango válido');

/* ------------------------------- Resultado ------------------------------- */
console.log('\n' + '─'.repeat(60));
console.log(`Pruebas superadas: ${passed}   Fallidas: ${failed}`);
if (failed) {
  console.log('\nFallos:');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('✅ Todas las pruebas de lógica han pasado.\n');
