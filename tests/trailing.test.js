/* =========================================================================
 * tests/trailing.test.js — TRAILING STOP (stop dinámico, estilo Bitunix)
 *
 * Dos partes deliberadamente distintas:
 *
 *  1) MOTOR (vm, sin navegador, con velas sintéticas): aquí los números son
 *     exactos y se puede exigir el criterio de simulación, que es lo delicado:
 *       · el pico solo se mueve al CERRAR la vela (una vela no puede disparar un
 *         nivel que ella misma acaba de crear: intra-vela se ignora el orden real
 *         entre high y low);
 *       · la activación se detecta dentro de la vela y el pico arranca en el
 *         precio de activación, no en el extremo de esa vela;
 *       · se ejecuta como un stop: con hueco en contra se rellena a la apertura;
 *       · con SL fijo y trailing tocados en la misma vela dispara el más cercano.
 *
 *  2) INTERFAZ (puppeteer sobre el archivo único, sin red): tarjeta, línea en el
 *     gráfico, tecla V, botón ✕, tamaño táctil a 390 px y disparo real dentro del
 *     replay (sin llamar a funciones internas).
 *
 *  Uso:  node tests/trailing.test.js
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pasan = 0, fallan = 0;
const ok = (cond, msg) => {
  if (cond) { pasan++; console.log('  ✓ ' + msg); }
  else { fallan++; console.log('  ✗ ' + msg); }
};
const cerca = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ════════════════════ 1) MOTOR — contexto aislado, velas sintéticas ════════════════════ */

const listeners = {};
const shim = {
  console, Math, JSON, Date, Array, Object, Number, String, Boolean, Error, isNaN, parseFloat, parseInt,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  devicePixelRatio: 1,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  dispatchEvent: (e) => { (listeners[e.type] || []).forEach((f) => f(e)); return true; },
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  document: {
    getElementById: () => null,
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {},
    }),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  },
  localStorage: null,
  fetch: () => Promise.reject(new Error('sin red en tests')),
};
shim.window = shim; shim.self = shim;
const ctx = vm.createContext(shim);
for (const rel of ['js/utils.js', 'js/tradingEngine.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), ctx, { filename: rel });
}
const { U, TE } = shim;

const C = (time, open, high, low, close) => ({ time, open, high, low, close, volume: 1 });
const seccion = (n) => console.log('\n▸ ' + n);
const cerradasHoy = () => TE.state.trades.filter((x) => x.status === 'closed');

/** Abre un LONG con tamaño y comisiones controlados (para dejar margen libre). */
function abrirLong(precio, opts) {
  const o = opts || {};
  TE.configure(Object.assign({ initialCapital: 10000, leverage: 1, feePct: 0, fundingPct: 0, slFirst: 'worst' }, o.cfg || {}));
  TE.resetAccount(10000);
  const pos = TE.openPosition('long', {
    mode: 'pct', size: o.size === undefined ? 100 : o.size, entryPrice: precio,
    sl: o.sl || null, tp: o.tp || null,
    leverage: 1, feePct: o.feePct === undefined ? 0 : o.feePct, time: 1000,
  });
  TE.updateEquity(precio, 1000);              // precio de referencia desde el que sigue el trailing
  return pos;
}

seccion('A) Activar y seguir: matemática exacta del nivel');
TE.resetAccount(10000);
ok(TE.setTrailing({ pct: 2 }) === null, 'sin posición no hay trailing que activar');

let p = abrirLong(100);
ok(!p.trail, 'una posición recién abierta no lleva trailing');
let t = TE.setTrailing({ pct: 2 });
ok(!!t, 'TE.setTrailing({pct:2}) activa el trailing');
ok(t.armed === true && t.activation === null, 'sin precio de activación nace ARMADO (sigue desde el precio actual)');
ok(cerca(t.peak, 100), `el pico arranca en el precio de referencia (${t.peak})`);
ok(cerca(TE.trailingPrice(p), 98), `nivel de disparo = pico·(1−2 %) = 98 (${TE.trailingPrice(p)})`);
ok(TE.trailingInfo(p).pct === 2 && TE.trailingInfo(p).frac === 1, 'la info para la UI trae % y fracción (100 % por defecto)');
ok(cerradasHoy().length === 0, 'activar el trailing NO cierra nada');

seccion('B) El pico sube al cerrar la vela, y la vela no se dispara a sí misma');
let r = TE.onCandle(C(2000, 100, 103, 99, 102));
ok(r === null, 'si la vela no toca el nivel, la posición sigue viva');
ok(cerca(p.trail.peak, 103), `el pico absorbe el máximo de la vela cerrada (${p.trail.peak})`);
ok(cerca(TE.trailingPrice(p), 100.94), `nivel = 103·0.98 = 100.94 (${TE.trailingPrice(p)})`);

// Vela que hace un máximo de 110 (nivel nuevo 107.8) con mínimo 101.5: si el nivel
// se actualizara ANTES de evaluar, esta vela se habría cerrado a sí misma.
r = TE.onCandle(C(3000, 102, 110, 101.5, 109));
ok(r === null, 'una vela no dispara un nivel que ella misma acaba de crear');
ok(cerca(TE.trailingPrice(p), 107.8), `y desde la vela siguiente el nivel sí es 110·0.98 = 107.8 (${TE.trailingPrice(p)})`);
ok(p.trail.peak === 110 && TE.state.position === p, 'el pico queda en 110 y la posición intacta');
ok(cerca(TE.trailingInfo(p).level, 107.8) && cerca(TE.trailingInfo(p).peak, 110), 'trailingInfo() reporta lo mismo que el motor');

// Vela que abre con HUECO por debajo del nivel → se rellena a la apertura
r = TE.onCandle(C(4000, 106, 108, 105, 106.5));
ok(!!r && r.reason === 'trail', 'el retroceso del 2 % desde el pico cierra la posición con motivo «trail»');
ok(cerca(r.exitPrice, 106), `con hueco en contra se rellena a la apertura, no al nivel (${r.exitPrice})`);
ok(TE.reasonLabel('trail') === 'TRAILING STOP', 'el historial lo etiqueta «TRAILING STOP»');
ok(TE.state.position === null && cerca(TE.state.balance, 10600), 'posición cerrada y balance 10 000 + 6·100 = 10 600');
ok(cerca(r.pnl, 600) && cerca(TE.state.balance, 10000 + r.pnl), 'sin comisiones: balance = capital + PnL');
ok(p.trail && cerca(p.trail.peak, 110), 'la fila cerrada conserva el pico con el que se defendió');

seccion('C) Ejecución dentro del rango: se rellena AL nivel exacto');
p = abrirLong(100);
TE.setTrailing({ pct: 2 });
r = TE.onCandle(C(2000, 99.5, 100, 97, 97.5));
ok(!!r && cerca(r.exitPrice, 98), `sin hueco el stop se ejecuta en 98 exacto (${r && r.exitPrice})`);
ok(!!r && r.reason === 'trail', 'y registrado como trailing');

seccion('D) Precio de activación (Activation price)');
p = abrirLong(100);
t = TE.setTrailing({ pct: 1, activation: 120 });
ok(t.armed === false, 'por debajo de la activación el trailing está EN ESPERA');
ok(TE.trailingPrice(p) === null, 'en espera no hay nivel de disparo (no puede cerrar nada)');
ok(cerca(TE.trailingInfo(p).toActivation, 20), `la UI puede decir cuánto falta: +20 % (${TE.trailingInfo(p).toActivation})`);
r = TE.onCandle(C(2000, 100, 110, 90, 108));
ok(r === null && p.trail.armed === false, 'una vela que no llega a 120 no arma nada ni cierra (aunque caiga 10 %)');
r = TE.onCandle(C(3000, 108, 125, 107, 120));
ok(p.trail.armed === true, 'la vela que toca 120 arma el trailing');
ok(cerca(p.trail.peak, 120) && cerca(TE.trailingPrice(p), 118.8),
   `el pico arranca en la ACTIVACIÓN (120), no en el high de la vela → nivel 118.8 (pico ${p.trail.peak})`);
r = TE.onCandle(C(4000, 121, 124, 119, 123));
ok(r === null && cerca(p.trail.peak, 124), 'a partir de ahí el pico ya sigue los máximos (124)');
r = TE.onCandle(C(5000, 123, 123.5, 120, 122));
ok(!!r && r.reason === 'trail' && cerca(r.exitPrice, 124 * 0.99),
   `dispara al retroceder el 1 % desde 124 → 122.76 (${r && r.exitPrice})`);
p = abrirLong(100);
t = TE.setTrailing({ pct: 1, activation: 90 });
ok(t.armed === true && cerca(t.peak, 100), 'activación ya superada → arma de inmediato con el precio actual');

seccion('E) Choque con el SL fijo: dispara el más cercano');
p = abrirLong(100, { sl: 90 });
TE.setTrailing({ pct: 2 });                     // nivel 98, por encima del SL
r = TE.onCandle(C(2000, 100, 100, 85, 86));
ok(!!r && r.reason === 'trail' && cerca(r.exitPrice, 98),
   'con SL 90 y TRAIL 98 tocados en la misma vela, ejecuta el TRAILING (más cerca del precio)');
p = abrirLong(100, { sl: 90 });
TE.setTrailing({ pct: 15 });                     // nivel 85, por debajo del SL
r = TE.onCandle(C(2000, 100, 100, 84, 86));
ok(!!r && r.reason === 'sl' && cerca(r.exitPrice, 90), 'si el SL está más cerca, gana el SL y el trailing solo acompaña');

seccion('F) Cierre parcial con el trailing (frac) y contabilidad');
p = abrirLong(100, { size: 60, feePct: 0.1 });
const q0 = p.qty;
t = TE.setTrailing({ pct: 2, frac: 50 });
const openFeeF = p.openFee;                       // comisión de apertura viva, antes del parcial
ok(cerca(t.frac, 0.5), 'frac 50 → el trailing cierra media posición y deja el resto viva');
r = TE.onCandle(C(2000, 99, 100, 97, 98));      // nivel 98 → tocado
const filasF = cerradasHoy();
ok(TE.state.position !== null && cerca(TE.state.position.qty, q0 * 0.5),
   `cerrado el 50 %: quedan ${TE.state.position && TE.state.position.qty} de ${q0}`);
ok(filasF.length === 1 && filasF[0].parcial === true && filasF[0].reason === 'trail',
   'la fila queda como cierre parcial con motivo «trail»');
ok(TE.state.position.trail && TE.state.position.trail.armed === true,
   'el trailing sigue activo sobre lo que queda (no se apaga solo)');
const sumaF = filasF.reduce((a, x) => a + x.pnl, 0);
ok(cerca(TE.state.balance + (TE.state.position.openFee || 0), 10000 + sumaF, 1e-6),
   `invariante: balance + comisión viva = capital + Σ PnL (${TE.state.balance.toFixed(4)})`);
// PnL del parcial = bruto − comisión de cierre − LA PARTE proporcional de la de
// apertura (que ya se pagó al abrir). Se calcula con los datos del propio test.
const esperadoF = (98 - 100) * (q0 * 0.5) - 98 * (q0 * 0.5) * 0.001 - openFeeF * 0.5;
ok(cerca(filasF[0].pnl, esperadoF, 1e-6),
   `el parcial en pérdida descuenta su parte de comisión (${filasF[0].pnl} = bruto − cierre − apertura/2)`);
ok(cerca(filasF[0].notional, 100 * (q0 * 0.5), 1e-6), `la fila guarda el notional de la parte cerrada (${filasF[0].notional})`);
const lvlF = TE.trailingPrice(TE.state.position);
ok(cerca(lvlF, 98), `tras el parcial el pico no se mueve (98 = 100·0.98) y sigue defendiendo ahí`);
r = TE.onCandle(C(3000, 98, 98.5, 90, 92));
ok(cerradasHoy().length === 2 && cerradasHoy()[1].reason === 'trail',
   'la vela siguiente vuelve a disparar el trailing sobre lo que queda');
ok(TE.state.position && cerca(TE.state.position.qty, q0 * 0.25),
   `y cierra otra mitad (quedan ${TE.state.position && TE.state.position.qty} de ${q0})`);
ok(TE.removeTrailing() === true && TE.state.position.trail === null,
   'quitar el trailing deja la posición viva, sin stop dinámico y sin tocar su tamaño');

seccion('G) Validaciones y retirada');
p = abrirLong(100);
ok(TE.setTrailing({ pct: 0 }) === null, 'un retracement de 0 % se rechaza (cerraría al momento)');
ok(TE.setTrailing({ pct: 150 }) === null, 'un retracement > 100 % se rechaza');
ok(TE.setTrailing({ pct: NaN }) === null, 'un % que no es número se rechaza');
ok(TE.setTrailing({ pct: '' }) === null, 'el % vacío no activa nada');
ok(TE.setTrailing({ pct: 2, activation: -5 }) === null, 'una activación negativa se rechaza');
ok(TE.setTrailing({ pct: 2, activation: 'hola' }) === null, 'una activación que no es número se rechaza');
ok(TE.setTrailing({ pct: 2, activation: '12000' }) !== null, 'una activación escrita como texto se acepta si es número');
ok(TE.state.position.trail.armed === false, 'y con activación lejana nace en espera');
ok(TE.removeTrailing() === true && p.trail === null, 'TE.removeTrailing() lo quita');
ok(TE.removeTrailing() === false, 'quitarlo dos veces devuelve false (no hay nada que quitar)');
ok(TE.trailingPrice(p) === null && TE.trailingInfo(p) === null, 'sin trailing no hay nivel ni info que pintar');

seccion('H) Convive con el promediado y con la persistencia');
p = abrirLong(100, { size: 60 });
TE.setTrailing({ pct: 1 });
TE.onCandle(C(2000, 100, 106, 100.5, 105));       // pico 106 → nivel 104.94
const picoAntes = p.trail.peak, nivelAntes = TE.trailingPrice(p);
ok(cerca(nivelAntes, 104.94), `nivel antes de promediar: 106·0.99 = 104.94 (${nivelAntes})`);
const add = TE.addToPosition('long', { mode: 'qty', size: 30, entryPrice: 104, time: 2500 });
ok(!!add, 'se puede añadir a la posición con trailing activo');
ok(cerca(p.trail.peak, picoAntes) && cerca(TE.trailingPrice(p), nivelAntes),
   `el trailing defiende el PICO de la posición, no el precio medio nuevo (${p.trail.peak} → ${TE.trailingPrice(p)})`);
ok(p.entryPrice > 100, `el precio medio sí cambió (100 → ${p.entryPrice.toFixed(2)})`);
ok(TE.state.trades.filter((x) => x.status === 'closed').length === 0, 'promediar con trailing no genera cierres');
const dataH = TE.serialize();
const ser = JSON.parse(JSON.stringify(dataH));
ok(ser.position.trail && cerca(ser.position.trail.peak, picoAntes) && ser.position.trail.armed === true,
   'serialize() se lleva el trailing (guardar sesión no lo pierde)');
TE.resetAccount(1);                                  // estado basura que el restore debe borrar
TE.restore(dataH);
ok(cerca(TE.trailingPrice(TE.state.position), nivelAntes), 'restore() lo devuelve tal cual');

/* ════════════════ 2) INTERFAZ — puppeteer sobre el archivo único ════════════════ */

(async () => {
  let puppeteer;
  for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/node_modules/puppeteer']) {
    try { puppeteer = require(c); break; } catch (e) {}
  }
  if (!puppeteer) {
    console.log('\n⚠️  Falta puppeteer: la parte de interfaz queda OMITIDA.');
    console.log('\n' + '─'.repeat(60));
    console.log(`Trailing stop (solo motor): ${pasan} superadas, ${fallan} fallidas`);
    process.exit(fallan ? 1 : 0);
  }
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().startsWith('file://') || r.url().startsWith('data:') ? r.continue() : r.abort('failed')));

  const FILE = 'file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html');
  console.log('\n▸ Interfaz: archivo único sin red');
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 15000 });
  await espera(700);

  // A práctica rápida: serie guardada y determinista (con velas live el plan de
  // abajo cambiaría en cada ejecución y el test fallaría sin culpa de la app).
  await page.evaluate(() => { const b = document.getElementById('btnQuick'); if (b) b.click(); });
  await page.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 20000 });
  await espera(500);

  const estado = () => page.evaluate(() => {
    const p = TE.state.position;
    const i = TE.trailingInfo(p);
    const txt = (document.getElementById('posTrail') || {}).textContent || '';
    const lineas = (CM._priceLines || []).map((l) => (l.options ? l.options() : {}));
    const trail = lineas.filter((o) => /^TRAIL/.test(o.title || ''))[0] || null;
    return {
      pos: p && p.side,
      trail: !!p && !!p.trail,
      armed: i ? i.armed : null, pct: i && i.pct,
      peak: i && i.peak, level: i && i.level,
      txt: txt.trim(),
      picoEnTxt: p && p.trail ? txt.indexOf(U.fmtPrice(p.trail.peak)) !== -1 : txt.trim() === '—',
      btnOn: document.getElementById('btnTrailOn').textContent.trim(),
      offActivo: !document.getElementById('btnTrailOff').disabled,
      lineaTrail: trail ? +trail.price : null,
      hayTrail: !!trail,
      filas: [...document.querySelectorAll('#tradesTable tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()).slice(-2),
      log: [...document.querySelectorAll('#logList .log-line')].slice(-12).map((d) => d.textContent.trim()),
      balance: +TE.state.balance.toFixed(4),
      capital: TE.state.initialCapital,
      cerradas: TE.state.trades.filter((x) => x.status === 'closed').map((x) => x.reason),
      sumaPnl: +TE.state.trades.filter((x) => x.status === 'closed').reduce((a, x) => a + x.pnl, 0).toFixed(4),
    };
  });
  const avanzar = async (n) => {
    for (let i = 0; i < n; i++) await page.evaluate(() => App.stepForward());
    await espera(120);
  };
  /**
   * Busca, DESDE LA VELA ACTUAL, un tramo real donde el trailing se arme (el high
   * de una vela toca la activación) y luego se dispare (un low posterior baja del
   * nivel). Devuelve offsets de velas, no índices absolutos.
   */
  const planTrailing = () => page.evaluate(() => {
    const i = BR.getIndex(), c = App.candles, pct = 0.05;
    for (let j = 1; j < Math.min(c.length - i, 150); j++) {
      const act = c[i + j].high;
      const nivel = act * (1 - pct / 100);
      for (let k = 1; k <= 40 && i + j + k < c.length; k++) {
        if (c[i + j + k].low <= nivel) return { j, k, act, nivel, ref: App.currentPrice() };
      }
    }
    return null;
  });

  console.log('\n▸ I) La tarjeta de posición manda el trailing');
  await page.evaluate(() => {
    document.getElementById('sizeInput').value = '30';
    document.getElementById('slInput').value = '';
    document.getElementById('tpInput').value = '';
  });
  await page.evaluate(() => App.placeOrder('long'));
  await espera(400);
  let E = await estado();
  ok(E.pos === 'long' && !E.trail, 'posición abierta sin trailing: la tarjeta dice «—»');
  ok(E.txt === '—' && E.btnOn === 'Activar' && !E.offActivo,
     `sin trailing el botón dice «${E.btnOn}» y la ✕ está deshabilitada`);
  ok(!E.hayTrail, 'y el gráfico no pinta línea de TRAIL');

  await page.evaluate(() => { document.getElementById('trailPct').value = '0.4'; document.getElementById('trailAct').value = ''; });
  await page.click('#btnTrailOn');
  await espera(350);
  E = await estado();
  ok(E.trail && E.armed === true && cerca(E.pct, 0.4), '«Activar» con % y sin activación → trailing armado');
  ok(/0[.,]40\s*%/.test(E.txt) && /pico/.test(E.txt) && /→/.test(E.txt), `la tarjeta lo describe: «${E.txt}»`);
  ok(E.btnOn === 'Re-ajustar' && E.offActivo, 'el botón pasa a «Re-ajustar» y la ✕ se habilita');
  ok(E.hayTrail, 'el gráfico pinta la línea TRAIL');
  ok(Number.isFinite(E.lineaTrail) && cerca(E.lineaTrail, E.level, E.level * 1e-4),
     `la línea está en el precio de disparo (${E.lineaTrail} ≈ ${E.level})`);
  ok(E.log.some((l) => /Trailing/i.test(l)), 'el registro avisa de la activación');
  ok(E.picoEnTxt, `la tarjeta muestra el pico por el que está defendiendo (${E.peak})`);

  console.log('\n▸ J) El trailing se mueve solo con el replay');
  await avanzar(2);
  const E2 = await estado();
  ok(E2.trail && E2.peak >= E.peak, `el pico solo sube (o se queda): ${E.peak} → ${E2.peak}`);
  ok(cerca(E2.level, E2.peak * (1 - 0.4 / 100), 1e-6),
     `y el nivel de disparo es pico·(1−0.4 %) = ${E2.level}`);
  ok(E2.lineaTrail !== null && cerca(E2.lineaTrail, E2.level, E2.level * 1e-4), 'la línea del gráfico se mueve con él');

  console.log('\n▸ K) Tecla V y botón ✕');
  await page.keyboard.press('v');
  await espera(320);
  const E3 = await estado();
  ok(!E3.trail, 'V con trailing activo lo QUITA');
  ok(!E3.hayTrail, 'y la línea del gráfico desaparece');
  ok(E3.txt === '—' && E3.btnOn === 'Activar', 'la tarjeta vuelve a «—» y el botón a «Activar»');
  await page.evaluate(() => { document.getElementById('trailPct').value = '0.5'; });
  await page.keyboard.press('v');
  await espera(320);
  const E4 = await estado();
  ok(E4.trail && cerca(E4.pct, 0.5), 'V otra vez lo activa con el % escrito en la tarjeta');
  await page.click('#btnTrailOff');
  await espera(300);
  ok(!(await estado()).trail, 'la ✕ de la fila también lo quita (no solo el teclado)');
  await page.keyboard.press('v');
  await espera(300);
  ok((await estado()).trail, 'y V lo vuelve a poner (es un alterno de verdad)');
  await page.click('#btnTrailOff');
  await espera(250);

  console.log('\n▸ L) Se arma y se dispara dentro del replay, sin tocar el motor a mano');
  const pl = await planTrailing();
  ok(!!pl, pl ? `hay un tramo del replay cargado donde el trailing se arma y dispara (velas ${pl.j}/${pl.k})` : 'no hay tramo utilizable');
  if (pl) {
    await page.evaluate((act) => {
      document.getElementById('trailPct').value = '0.05';
      document.getElementById('trailAct').value = String(act);
      document.getElementById('btnTrailOn').click();
    }, pl.act);
    await espera(320);
    const E5 = await estado();
    ok(E5.trail && E5.armed === false, 'con la activación por encima del precio, el trailing queda EN ESPERA');
    ok(/arma en/.test(E5.txt), `la tarjeta lo dice: «${E5.txt}»`);
    ok(E5.log.slice(-3).some((l) => /espera de la activación/i.test(l)), 'y el log lo distingue de un trailing ya activo');
    await avanzar(pl.j);
    const E6 = await estado();
    ok(E6.armed === true, `tras ${pl.j} velas la activación se tocó y el trailing se armó (pico ${E6.peak})`);
    let disparado = false;
    for (let k = 0; k < pl.k + 8 && !disparado; k++) {
      await avanzar(1);
      disparado = (await estado()).cerradas.slice(-1)[0] === 'trail';
    }
    const E7 = await estado();
    ok(disparado, `a los ${pl.k} velas (o antes) el retroceso del 0.05 % cerró la posición`);
    ok(E7.pos === null, 'la posición quedó cerrada del todo');
    ok(/TRAILING STOP/.test(E7.filas.join(' ')), 'la fila del historial pone el motivo «TRAILING STOP»');
    ok(E7.log.some((l) => /Trailing stop/.test(l) && /retroced/i.test(l)), 'el log explica cuánto retrocedió desde el pico');
    ok(cerca(E7.balance, E7.capital + E7.sumaPnl, 1e-3),
       `la contabilidad cuadra (${E7.balance} = ${E7.capital} + ${E7.sumaPnl})`);
    ok(cerca(E7.lineaTrail === null ? 0 : 1, 0) || E7.lineaTrail === null, 'sin posición ya no queda línea TRAIL en el gráfico');
  }

  console.log('\n▸ M) Ventana de móvil (390 × 844) y salud de la página');
  await page.setViewport({ width: 390, height: 844 });
  await espera(450);
  await page.evaluate(() => App.placeOrder('long'));
  await espera(400);
  const movil = await page.evaluate(() => {
    const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) }; };
    const W = window.innerWidth;
    return {
      pct: r('trailPct'), act: r('trailAct'), on: r('btnTrailOn'), off: r('btnTrailOff'),
      desborda: document.documentElement.scrollWidth > W + 1,
      fuera: ['trailPct', 'trailAct', 'btnTrailOn', 'btnTrailOff'].some((id) => {
        const b = document.getElementById(id).getBoundingClientRect();
        return b.right > W + 1 || b.left < -1 || b.width === 0;
      }),
      W,
    };
  });
  const f = (o) => (o ? `${o.w}×${o.h}` : 'null');
  ok(movil.pct && movil.pct.h >= 28 && movil.act && movil.act.h >= 28,
     `los campos del trailing tienen tamaño táctil (activación ${f(movil.pct)} y % ${f(movil.act)})`);
  ok(movil.on && movil.on.h >= 28 && movil.on.w >= 40, `el botón «Activar» es táctil (${f(movil.on)} px)`);
  ok(movil.off && movil.off.h >= 28, `la ✕ también (${f(movil.off)} px)`);
  ok(!movil.desborda, `a ${movil.W} px la fila nueva no provoca scroll horizontal`);
  ok(!movil.fuera, 'y ningún control del trailing se sale de la pantalla');

  await page.setViewport({ width: 1360, height: 900 });
  await espera(300);
  await page.evaluate(() => { const b = document.getElementById('btnTrailOn'); if (b) b.click(); });
  await espera(250);
  await page.evaluate(() => App.flatten('manual'));
  await espera(350);
  const F = await estado();
  ok(F.txt === '—' && !F.trail, 'al cerrar, la tarjeta limpia el estado del trailing');
  ok(F.btnOn === 'Activar' && !F.offActivo, 'y los controles vuelven a su estado inactivo');
  ok(errs.length === 0, `sin errores de JavaScript (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' ⧸ ') : ''}`);

  console.log('\n' + '─'.repeat(60));
  console.log(`Trailing stop: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El trailing stop sigue el pico, se dispara al retroceder y se ve en la tarjeta y en el gráfico.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
