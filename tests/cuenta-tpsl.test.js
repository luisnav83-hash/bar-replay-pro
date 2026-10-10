/* =========================================================================
 * tests/cuenta-tpsl.test.js — Account TP/SL (el cuarto método de F4, capa 3)
 *
 * No es un nivel de una posición: es un umbral sobre el PnL TOTAL de la cuenta
 * que, al tocarse, cierra TODAS las posiciones del ámbito. Lo delicado son las
 * definiciones, y ahí los números son exactos:
 *   · `modo:'usdt'`  → el umbral es un importe.
 *   · `modo:'pct'` con base `invertido` → % de la suma de márgenes.
 *   · `modo:'pct'` con base `neto`      → % de (margen + PnL abierto), que
 *     el panel recalcula vela a vela: por eso el mismo % da topes distintos
 *     según cómo vaya la posición, y se comprueba las dos cosas (que difiere
 *     del invertido y que en pérdida el neto se contrae y dispara antes).
 *   · el ámbito cross/isolated mide y cierra SOLO las posiciones de ese modo.
 *
 * La parte de interfaz no llama al motor para provocar el disparo: elige el
 * lado mirando la vela que viene en la propia serie y AVANZA el replay, así
 * que el cierre lo produce el mercado simulado, no un atajo del test.
 *
 *  Uso:  node tests/cuenta-tpsl.test.js
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pasan = 0, fallan = 0;
const ok = (cond, msg) => { if (cond) { pasan++; console.log('  ✓ ' + msg); } else { fallan++; console.log('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (${JSON.stringify(a)}${a !== b ? ' ≠ ' + JSON.stringify(b) : ''})`);
const cerca = (a, b, tol, msg) => ok(Number.isFinite(a) && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol),
  `${msg} (${Number.isFinite(a) ? a.toFixed(4) : a}${Number.isFinite(a) && Math.abs(a - b) > (tol === undefined ? 1e-9 : tol) ? ' ≠ ' + b : ''})`);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const avisos = [];
const shim = {
  console, Math, JSON, Date, Array, Object, Number, String, Boolean, Error, isNaN, parseFloat, parseInt,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() }, devicePixelRatio: 1,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16), cancelAnimationFrame: (id) => clearTimeout(id),
  addEventListener() {}, dispatchEvent: () => true, CustomEvent: function () {},
  location: { href: 'file:///test' }, navigator: { userAgent: 'node' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, setAttribute() {}, dataset: {} }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    body: { appendChild() {} }, addEventListener() {},
  },
};
shim.window = shim; shim.global = shim; shim.globalThis = shim;
const ctx = vm.createContext(shim);
for (const f of ['utils.js', 'tradingEngine.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const TE = ctx.TE, U = ctx.U;
U.toast = (m) => { avisos.push('T:' + m); };
U.log = (m) => { avisos.push('L:' + m); };
U.playSound = () => {};

const V = (t, o, h, l, c) => ({ time: t, open: o, high: h, low: l, close: c, volume: 1 });
const arranca = (capital) => {
  TE.resetAccount(capital);
  TE.configure({ leverage: 10, feePct: 0.05, fundingPct: 0, makerFeePct: null, niveles: null, averaging: true });
  TE.state.marginMode = 'cross';
  TE.state.modoPosicion = 'ONE_WAY';
  TE.onCandle(V(0, 100, 100, 100, 100));
  avisos.length = 0;
};

/* ═════════ A) El umbral no se inventa: se valida y se apaga con la cuenta ═════════ */
console.log('\n▸ A) Configurar el umbral de cuenta');
arranca(10000);
eq(TE.state.tpslCuenta.activo, false, 'una cuenta nueva no trae umbral de cuenta armado');
eq(TE.setTpslCuenta({}).ok, false, 'activarlo sin ningún tope se rechaza (no se arma un cortocircuitos sin umbral)');
eq(TE.setTpslCuenta({ ganancia: 0 }).ok, false, 'y un tope de 0 también: cerraría todo al abrir');
const r1 = TE.setTpslCuenta({ ganancia: 5, perdida: -10 });
ok(r1.ok === true && r1.cfg.perdida === 10, `el signo no se usa para la dirección del tope (−10 se lee 10): ${r1.cfg.perdida}`);
eq(TE.state.tpslCuenta.activo, true, 'con un tope válido queda activado');
TE.resetAccount(10000);
eq(TE.state.tpslCuenta.activo, false, 'el reinicio de la cuenta lo apaga (una partida nueva no hereda el cortocircuitos de la anterior)');
ok(avisos.some((x) => /apagado por el reinicio/.test(x)), 'y el apagón se registra, no pasa en silencio');

/* ═════════ B) Base «invertido»: % sobre la suma de márgenes ═════════ */
console.log('\n▸ B) Porcentaje sobre el margen invertido');
arranca(10000);
const L = TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100 });
eq(TE.posiciones().length, 1, 'LONG al 100 % del capital a 10x, entrada 100');
cerca(L.notional, 100000, 1e-6, 'nocional 100 000');
cerca(L.qty, 1000, 1e-6, 'cantidad 1000 (así el PnL vale 1 USDT por cada 0,001 de precio: números revisables)');
cerca(TE.marginUsed(), 10000, 1e-6, 'margen invertido 10 000');
TE.setTpslCuenta({ modo: 'pct', base: 'invertido', ganancia: 5, perdida: 10 });
const i1 = TE.tpslCuentaInfo(100);
cerca(i1.umbralG, 500, 1e-6, '5 % de la base = 500 USDT');
cerca(i1.umbralP, 1000, 1e-6, '10 % de la base = 1000 USDT');
// A 99,20 el PnL es −800: por debajo del tope de pérdida.
TE.onCandle(V(1000, 100, 100.1, 99.1, 99.2));
eq(TE.posiciones().length, 1, 'con −800 de PnL el tope de −1000 no se ha tocado y la posición sigue viva');
// A 98,90 el PnL es −1100 ⇒ se cierra TODO.
TE.onCandle(V(2000, 99.2, 99.2, 98.5, 98.9));
eq(TE.posiciones().length, 0, 'al cruzar el umbral se cierra la posición (y cerrarían todas las que hubiera)');
const cerrada = TE.state.trades[TE.state.trades.length - 1];
eq(cerrada.reason, 'cuenta', 'el motivo registrado es el umbral de cuenta, no «manual» ni «sl»');
ok(avisos.some((x) => /Umbral de cuenta \(pérdida\) tocado/.test(x)), 'y la línea del registro dice cuál de los dos topos');
ok(avisos.some((x) => /UMBRAL DE CUENTA/.test(x)), 'la etiqueta del motivo aparece en el cierre');
eq(TE.state.tpslCuenta.activo, true, 'el umbral SIGUE armado después de disparar (es un ajuste de la cuenta, no una orden de un uso)');

/* ═════════ C) Base «neto»: el mismo % da otro tope, y se recalcula ═════════ */
console.log('\n▸ C) Base «valor neto»: el tope se mueve con la posición');
arranca(10000);
TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100 });
TE.setTpslCuenta({ modo: 'pct', base: 'neto', ganancia: 5, perdida: 10 });
// Con el PnL en +500, la base neta es 10 500 → el 5 % pide 525, no 500: NO toca.
TE.onCandle(V(1000, 100, 100.6, 100, 100.5));
eq(TE.posiciones().length, 1, 'a +500 con base neta no se cierra (el 5 % de 10 500 son 525)');
const n1 = TE.tpslCuentaInfo(100.5);
cerca(n1.baseUsdt, 10500, 1e-6, 'la base «neta» es margen + PnL no realizado');
cerca(n1.umbralG, 525, 1e-6, 'y el tope de ganancia se recalcula con ese PnL');
// Con `invertido` en cambio, el mismo 5 % son 500 y a +500 SÍ toca: se cierra.
TE.setTpslCuenta({ modo: 'pct', base: 'invertido', ganancia: 5, perdida: 10 });
TE.onCandle(V(2000, 100.5, 100.55, 100.4, 100.5));
eq(TE.posiciones().length, 0, 'con base «margen invertido» el mismo 5 % cierra en +500');
// Y en pérdida la base neta SE CONTRAE: el tope cae y dispara antes que el invertido.
arranca(10000);
TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100 });
TE.setTpslCuenta({ modo: 'pct', base: 'neto', perdida: 10 });
TE.onCandle(V(3000, 100, 100, 98.8, 98.9));     // PnL −1100, base neta 8900 ⇒ tope 890
eq(TE.posiciones().length, 0, 'en pérdida la base neta se contrae (8900 → tope 890) y dispara antes que los 1000 del invertido');

/* ═════════ D) Importe absoluto ═════════ */
console.log('\n▸ D) Umbral expresado en USDT (la guía: «por importe o por %»)');
arranca(10000);
TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100 });
TE.setTpslCuenta({ modo: 'usdt', perdida: 750 });
const d0 = TE.tpslCuentaInfo(100);
cerca(d0.umbralP, 750, 1e-6, 'el importe manda tal cual, sin base ni porcentaje');
TE.onCandle(V(1000, 100, 100, 99.3, 99.25));    // PnL −750 exacto
eq(TE.posiciones().length, 0, 'y se toca en el momento exacto en que el PnL llega a ese importe');

/* ═════════ E) Ámbito: mide y cierra solo las posiciones de ese modo de margen ═════════ */
console.log('\n▸ E) Ámbito cruzado / aislado');
arranca(10000);
const enCruz = TE.openPosition('long', { mode: 'pct', size: 10, entryPrice: 100 });
TE.state.marginMode = 'isolated';
TE.state.modoPosicion = 'HEDGE';
const enAisl = TE.openPosition('short', { mode: 'pct', size: 10, entryPrice: 100 });
eq(TE.posiciones().length, 2, 'dos posiciones vivas: una cruzada y una aislada (en hedge, el otro lado no la toca)');
eq(enCruz.marginMode, 'cross', 'cada posición recuerda el modo con el que se abrió');
eq(enAisl.marginMode, 'isolated', 'y la segunda el suyo');
TE.state.marginMode = 'cross';
TE.setTpslCuenta({ modo: 'usdt', perdida: 1e-9 });
eq(TE.posicionesEnAmbito().length, 2, 'ámbito «toda la cuenta»: las dos posiciones');
TE.state.tpslCuenta.ambito = 'isolated';
eq(TE.posicionesEnAmbito().length, 1, 'ámbito «solo aislado»: una');
eq(TE.posicionesEnAmbito()[0], enAisl, 'y es la corta aislada, no la larga cruzada');
TE.onCandle(V(4000, 100, 100.0001, 100, 100.0001));   // la corta pierde 0,01; la larga gana (y no mira)
eq(TE.posiciones().length, 1, 'al tocar el tope se cierra solo la del ámbito (la cruzada sigue viva)');
eq(TE.state.trades[TE.state.trades.length - 1].side, 'short', 'la que cerró fue la corta');
TE.state.tpslCuenta.ambito = 'ambos';
TE.onCandle(V(5000, 100.0001, 100.0001, 99.9, 99.9));   // ahora la larga pierde
eq(TE.posiciones().length, 0, 'con el ámbito puesto a «toda la cuenta» cierra también la cruzada');

/* ═════════ F) Suma: el PnL total es de TODAS las vivas ═════════ */
console.log('\n▸ F) El umbral mide la suma, no la primera posición');
arranca(10000);
TE.state.modoPosicion = 'HEDGE';
TE.openPosition('long', { mode: 'pct', size: 10, entryPrice: 100 });      // 100 unidades
TE.onCandle(V(500, 100, 100, 100, 100));
TE.openPosition('short', { mode: 'pct', size: 5, entryPrice: 100 });       // 50 unidades
TE.setTpslCuenta({ modo: 'usdt', ganancia: 100 });
// A +1 % la larga suma +100 y la corta resta −50: el NETO de la cuenta son +50, que no llega al
// tope de 100. Si el umbral mirara la primera posición (que sí llegó a +100) ya se habría cerrado.
TE.onCandle(V(1000, 100, 101, 100, 101));
eq(TE.posiciones().length, 2, 'a +1 % la larga gana 100 y la corta pierde 50: el tope de 100 NO se toca, porque se mide la suma');
TE.setTpslCuenta({ modo: 'usdt', ganancia: 40 });
TE.onCandle(V(2000, 101, 101.2, 101, 101.2));
eq(TE.posiciones().length, 0, 'y al bajar el tope a 40 cierra las DOS posiciones a la vez (es un umbral de cuenta, no una orden por posición)');
ok(TE.state.trades.slice(-2).every((t) => t && t.reason === 'cuenta'), 'las dos filas del historial llevan el motivo del umbral');

/* ═════════ G) Persistencia ═════════ */
console.log('\n▸ G) El umbral viaja en la partida');
arranca(10000);
TE.setTpslCuenta({ modo: 'pct', base: 'neto', ambito: 'isolated', ganancia: 30, perdida: 12 });
TE.openPosition('long', { mode: 'pct', size: 20, entryPrice: 100 });
const foto = JSON.parse(JSON.stringify(TE.serialize()));
ok(foto.state.tpslCuenta && foto.state.tpslCuenta.activo === true && foto.state.tpslCuenta.base === 'neto'
  && foto.state.tpslCuenta.ambito === 'isolated', `el estado serializado lleva el umbral: ${JSON.stringify(foto.state.tpslCuenta)}`);
arranca(10000);
TE.restore(foto);
ok(TE.state.tpslCuenta.activo && TE.state.tpslCuenta.ganancia === 30 && TE.state.tpslCuenta.perdida === 12,
  'y al restaurar la cuenta sigue protegida por el mismo umbral (no se pierde el ajuste)');
TE.offTpslCuenta();
eq(TE.state.tpslCuenta.activo, false, '`offTpslCuenta` lo apaga');
eq(TE.offTpslCuenta(), false, 'apagar dos veces no hace nada raro');
TE.state.tpslCuenta.activo = true;
TE.state.tpslCuenta.perdida = 1e-9;
// El ámbito restaurado de la foto es «solo aislado» y esta posición es cruzada: si se quedara
// así NO estaría cubierta (correcto, y conviene decirlo en el test). Se pone a «toda la cuenta».
TE.state.tpslCuenta.ambito = 'ambos';
TE.onCandle(V(3000, 100, 100, 99.99, 99.99));
ok(TE.posiciones().length === 0, 'con el umbral re-armado y el ámbito a «toda la cuenta», la posición restaurada también queda cubierta');
// (La vela de arriba ya cerró la posición, así que se abre otra para probar el filtro al revés.)
TE.onCandle(V(3500, 100, 100, 99.99, 99.99));
TE.openPosition('long', { mode: 'pct', size: 20, entryPrice: 100 });
TE.state.tpslCuenta.ambito = 'isolated';
TE.onCandle(V(4000, 100, 100, 99, 99));
ok(TE.posiciones().length === 1 && !!TE.posicionDe('long'), 'con el ámbito en «solo aislado», una posición CRUZADA NO se cierra aunque el PnL pase del tope: el filtro manda');
TE.state.tpslCuenta.ambito = 'ambos';
TE.onCandle(V(4500, 99, 99, 98.9, 98.9));
eq(TE.posiciones().length, 0, 'y en cuanto el ámbito vuelve a «toda la cuenta» esa misma posición cae por el umbral');

/* ════════════════ INTERFAZ ════════════════ */
(async () => {
  let puppeteer;
  for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/node_modules/puppeteer']) {
    try { puppeteer = require(c); break; } catch (e) { /* siguiente */ }
  }
  if (!puppeteer) {
    console.log('\n⚠️  Falta puppeteer: la parte de interfaz queda OMITIDA (motor: ' + pasan + ' ✓).');
    console.log(`\n${'─'.repeat(60)}\nTP/SL de cuenta (solo motor): ${pasan} superadas, ${fallan} fallidas`);
    process.exit(fallan ? 1 : 0);
  }
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().startsWith('file://') || r.url().startsWith('data:') ? r.continue() : r.abort('failed')));
  await page.goto('file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html'), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.waitForFunction(() => Number.isFinite(App.currentPrice()) && App.currentPrice() > 0, { timeout: 30000, polling: 120 });
  await espera(500);

  console.log('\n▸ H) La tarjeta de posición ofrece el cuarto método');
  const h = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    return {
      enTarjeta: !!document.querySelector('#positionCard #acctTpRow'),
      estado: g('acctTpEstado').textContent.trim(),
      cfgOculta: getComputedStyle(g('acctTpCfg')).display === 'none',
      hint: (g('acctTpHint') || {}).textContent || '',
      campos: ['acctModo', 'acctBase', 'acctAmbito', 'acctGanancia', 'acctPerdida'].map((id) => !!g(id)),
    };
  });
  ok(h.enTarjeta, 'el bloque vive en la tarjeta de posición (lo que mide es el PnL de esa tarjeta)');
  ok(h.estado === 'apagado', `arranca apagado: «${h.estado}»`);
  ok(h.cfgOculta && h.campos.every(Boolean), 'los campos existen pero vienen plegados (el hueco vertical lo vigila responsive.test.js)');
  ok(/cada posición se gestiona/.test(h.hint), 'y la pista lo dice en una línea');

  await page.click('#btnAcctEdit');
  await espera(220);
  const h2 = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById('acctTpCfg')).display !== 'none',
    hint: document.getElementById('acctTpHint').textContent,
    vacio: document.getElementById('acctGanancia').value === '',
  }));
  ok(h2.visible && h2.vacio, 'al desplegar, los campos vienen vacíos si no hay umbral (no inventa un 0)');

  console.log('\n▸ I) Rellenar y activar, y el estado se ve sin desplegar');
  await page.select('#acctModo', 'pct');
  await page.select('#acctBase', 'invertido');
  await page.$eval('#acctGanancia', (el) => { el.value = '7'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('#acctPerdida', (el) => { el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#btnAcctOn');
  await espera(320);
  const i = await page.evaluate(() => ({
    cfg: JSON.parse(JSON.stringify(TE.state.tpslCuenta)),
    estado: document.getElementById('acctTpEstado').textContent.trim(),
    chip: document.getElementById('btnAcctOn').classList.contains('active'),
    toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '),
    log: [...document.querySelectorAll('#logList .log-line')].map((x) => x.textContent).slice(-1)[0].replace(/\s+/g, ' '),
  }));
  ok(i.cfg.activo && i.cfg.ganancia === 7 && i.cfg.perdida === 3 && i.cfg.base === 'invertido',
    `lo escrito en la tarjeta llega al motor: ${JSON.stringify(i.cfg)}`);
  ok(/activado · \+7 % \/ −3 %/.test(i.estado), `la línea del estado lo resume: «${i.estado}»`);
  ok(i.chip, 'y el botón «Activar» queda marcado (no hay forma de no saber si está armado)');
  ok(/cerrará TODAS las posiciones/.test(i.toasts), 'el aviso dice lo que hace, que no es lo mismo que un SL de posición');
  ok(/TP\/SL de cuenta/.test(i.log), `el registro deja constancia: «${i.log.slice(0, 88)}…»`);

  console.log('\n▸ J) Reabrir el ajuste muestra los valores reales');
  await page.click('#btnAcctEdit');
  await espera(200);
  await page.click('#btnAcctEdit');
  await espera(200);
  const j = await page.evaluate(() => ({
    g: document.getElementById('acctGanancia').value,
    p: document.getElementById('acctPerdida').value,
    b: document.getElementById('acctBase').value,
  }));
  ok(j.g === '7' && j.p === '3' && j.b === 'invertido', 'los campos se rellenan con lo que hay armado (un formulario vacío parecería «sin umbral»)');

  console.log('\n▸ K) El disparo lo produce la propia serie, avanzando el replay');
  const k = await page.evaluate(async () => {
    // Se elige el lado mirando la vela que sigue en la serie cargada: así el disparo lo provoca
    // el mercado simulado (un paso del replay), no una llamada al motor desde el test.
    // Si el replay está plantado al final de la serie se retrocede una vela: hace falta una vela
    // POR DELANTE para poder pisarla con ▶▶.
    if (!App.candles[BR.getIndex() + 1]) { document.getElementById('btnStepBack').click(); await new Promise((r) => setTimeout(r, 260)); }
    const i = BR.getIndex(), siguiente = App.candles[i + 1];
    if (!siguiente) return { sinDatos: true };
    const ref = App.currentPrice();
    const lado = siguiente.close > ref ? 'long' : 'short';
    document.getElementById('sizeInput').value = 20;
    document.getElementById('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById(lado === 'long' ? 'btnLong' : 'btnShort').click();
    await new Promise((r) => setTimeout(r, 320));
    // El umbral se re-escribe POR LOS CAMPOS (importe mínimo), no tocando el motor: aquí se juzga
    // que la tarjeta y el disparo reaccionen al cierre de la vela siguiente. La aritmética exacta
    // va en el bloque de motor.
    document.getElementById('acctModo').value = 'usdt';
    document.getElementById('acctModo').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('acctGanancia').value = '0.0001';
    document.getElementById('acctGanancia').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('acctPerdida').value = '';
    document.getElementById('acctPerdida').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnAcctOn').click();
    await new Promise((r) => setTimeout(r, 220));
    const infoAntes = TE.tpslCuentaInfo(App.currentPrice());
    document.getElementById('btnStepFwd').click();
    await new Promise((r) => setTimeout(r, 420));
    const cerrada = TE.state.trades[TE.state.trades.length - 1];
    return {
      lado, ref, vivas: TE.posiciones().length, motivo: cerrada && cerrada.reason,
      pnl: infoAntes.pnl, base: infoAntes.baseUsdt, umbral: infoAntes.umbralG,
      estado: document.getElementById('acctTpEstado').textContent.trim(),
      hint: document.getElementById('acctTpHint').textContent,
      pnlPanel: document.getElementById('posPnl').textContent,
      tag: document.getElementById('posSide').textContent,
    };
  });
  ok(!k.sinDatos, 'hay una vela más que pisar en la serie (si no, el disparo no se puede provocar con el replay)');
  if (!k.sinDatos) {
    ok(k.vivas === 0 && k.motivo === 'cuenta',
      `al avanzar la vela elegida se cierra la posición por el umbral de cuenta (motivo «${k.motivo}», lado ${k.lado})`);
    ok(/activado · \+0/.test(k.estado) || /activado/.test(k.estado),
      `el umbral sigue armado después de disparar (es un ajuste de la cuenta): «${k.estado}»`);
    ok(/Nada abierto que medir/.test(k.hint), `y la pista pasa a decir que no hay nada que medir: «${k.hint.slice(0, 88)}»`);
    ok(/FLAT/.test(k.tag), `la tarjeta vuelve a FLAT (${k.tag}) con el umbral puesto`);
  }

  console.log('\n▸ L) Quitarlo desde la tarjeta');
  const l = await page.evaluate(async () => {
    document.getElementById('btnAcctEdit').click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('btnAcctOff').click();
    await new Promise((r) => setTimeout(r, 260));
    return {
      activo: TE.state.tpslCuenta.activo,
      estado: document.getElementById('acctTpEstado').textContent.trim(),
      chip: document.getElementById('btnAcctOn').classList.contains('active'),
      hint: document.getElementById('acctTpHint').textContent,
    };
  });
  ok(!l.activo && l.estado === 'apagado' && !l.chip, `apagar deja el estado, el botón y el motor de acuerdo (${l.estado})`);
  ok(/cada posición se gestiona/.test(l.hint), 'y la pista vuelve a la explicación de siempre');
  const m = await page.evaluate(() => {
    const cuerpo = document.getElementById('positionCard').querySelector('.card-body');
    return { fuera: cuerpo.scrollWidth - cuerpo.clientWidth };
  });
  ok(m.fuera <= 0, `la tarjeta de posición no desborda en horizontal con el bloque (${m.fuera} px)`);
  await page.setViewport({ width: 390, height: 844 });
  await espera(420);
  const n = await page.evaluate(() => ({
    plegado: getComputedStyle(document.getElementById('acctTpCfg')).display === 'none',
    fuera: document.getElementById('positionCard').querySelector('.card-body').scrollWidth
      - document.getElementById('positionCard').querySelector('.card-body').clientWidth,
  }));
  ok(n.plegado && n.fuera <= 0, `en el teléfono el bloque viene plegado y no desborda (fuera ${n.fuera} px)`);
  ok(errs.length === 0, `sin errores de JavaScript en toda la sesión (${errs.length})${errs.length ? ' → ' + errs.slice(0, 2).join(' ⧸ ') : ''}`);

  console.log('\n' + '─'.repeat(62));
  console.log(`TP/SL de cuenta: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El cuarto método de F4 está operativo: umbral de cuenta por importe o %, con ámbito, y cierra todas las posiciones.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
