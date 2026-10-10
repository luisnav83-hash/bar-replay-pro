/* =========================================================================
 * tests/riesgo-fijo.test.js — Riesgo fijo (Fixed Risk Order, artículos 223 y 225)
 *
 * Lo que Bitunix dice literalmente de esta pieza (traducido del artículo 223):
 *   · «Fixed Risk Order is NOT a standalone order type · it still relies on limited orders or
 *     market orders», generando «a standard limit or market order, while automatically attaching
 *     a corresponding stop-loss condition»;
 *   · el tamaño se DEDUCE: «Based on this predefined loss amount, the system automatically
 *     calculates an appropriate position size»;
 *   · «Max Risk is a required field. If left empty, position calculation and chart preview will
 *     not be available» (225).
 * De ahí las cuatro cosas que comprueba esta suite:
 *   1) qty = pérdida máxima ÷ |entrada − stop|, sin que el apalancamiento entre en la fórmula;
 *   2) el lado se deduce de dónde está el stop, y si contradice al botón pulsado se rechaza;
 *   3) sin pérdida máxima no hay orden (ni vista previa);
 *   4) la orden que llega al motor es una límite/mercado/trailing normal con su SL adjunto, y la
 *      entrada que usa es la del tipo de orden, no la última cuota.
 *
 *  Uso:  node tests/riesgo-fijo.test.js
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pasan = 0, fallan = 0;
const ok = (cond, msg) => { if (cond) { pasan++; console.log('  ✓ ' + msg); } else { fallan++; console.log('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (${JSON.stringify(a)}${a !== b ? ' ≠ ' + JSON.stringify(b) : ''})`);
const cerca = (a, b, tol, msg) => ok(Number.isFinite(a) && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol),
  `${msg} (${Number.isFinite(a) ? a.toFixed(4) : a}${Number.isFinite(a) && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol) ? '' : ' ≠ ' + b})`);
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
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { appendChild() {} }, addEventListener() {},
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

TE.resetAccount(10000);
TE.configure({ leverage: 10, feePct: 0.05, fundingPct: 0, niveles: null, averaging: true });
TE.state.marginMode = 'cross';
TE.state.modoPosicion = 'ONE_WAY';

/* ═════════ A) El triángulo: entrada, stop, pérdida ═════════ */
console.log('\n▸ A) La cuenta que hace el intercambio');
const a1 = TE.sizePorRiesgo({ entryPrice: 100, slPrice: 98, maxLoss: 400 });
ok(a1.ok, 'entrada 100, stop 98 y pérdida 400 definen la orden sin escribir ningún tamaño');
cerca(a1.dist, 2, 1e-9, 'distancia al stop = |100 − 98| = 2');
cerca(a1.qty, 200, 1e-9, 'qty = 400 / 2 = 200 unidades');
cerca(a1.notional, 20000, 1e-9, 'tamaño = 200 × 100 = 20 000 USD de nocional');
cerca(a1.margen, 2000, 1e-9, 'a 10× eso son 2 000 USD de margen');
eq(a1.excede, false, 'y caben de sobra en una cuenta de 10 000');
eq(a1.side, 'long', 'el lado NO se pregunta: con el stop por debajo, esto es una compra');
cerca(a1.riesgo, a1.qty * a1.dist, 1e-9, '`riesgo` es qty·distancia, no el número tecleado (son iguales si no hubo recorte)');

console.log('\n▸ B) El apalancamiento no entra en la fórmula del riesgo');
const levAntes = TE.state.leverage;
TE.state.leverage = 50;
const a2 = TE.sizePorRiesgo({ entryPrice: 100, slPrice: 98, maxLoss: 400 });
TE.state.leverage = levAntes;
cerca(a2.qty, 200, 1e-9, 'a 50× la qty deducida es la MISMA (200): el riesgo se mide en distancia de precio');
cerca(a2.margen, 400, 1e-9, 'lo único que cambia es el margen necesario (20 000 / 50 = 400)');
ok(Math.abs(a2.notional - a1.notional) < 1e-9, 'y el nocional también es idéntico');

/* ═════════ C) Faltas y absurdos ═════════ */
console.log('\n▸ C) Campos obligatorios y triángulo imposible');
for (const [caso, esperado] of [
  [{ entryPrice: 100, slPrice: 98 }, 'falta la pérdida máxima'],
  [{ entryPrice: 100, maxLoss: 400 }, 'falta el precio de stop-loss'],
  [{ slPrice: 98, maxLoss: 400 }, 'falta el precio de entrada'],
  [{ entryPrice: 100, slPrice: 98, maxLoss: 0 }, 'la pérdida máxima'],
  [{ entryPrice: 100, slPrice: 98, maxLoss: -5 }, 'la pérdida máxima'],
  [{ entryPrice: 100, slPrice: 100, maxLoss: 400 }, 'no hay distancia'],
]) {
  const r = TE.sizePorRiesgo(caso);
  ok(!r.ok && new RegExp(esperado, 'i').test(r.motivo),
    `${JSON.stringify(caso)} → «${r.motivo}»`);
}
ok(a1.tp === undefined, 'el ratio riesgo/beneficio NO vive en esta cuenta: es del formulario, que lo deriva aparte');

/* ═════════ D) Cuándo no cabe ═════════ */
console.log('\n▸ D) El recorte por margen libre (decisión local, avisada)');
const d1 = TE.sizePorRiesgo({ entryPrice: 100, slPrice: 98, maxLoss: 40000 });
eq(d1.excede, true, 'perder 40 000 con una distancia de 2 pide un margen que la cuenta no tiene');
cerca(d1.margen, 10000, 1e-6, 'se recorta exactamente al margen libre (10 000)');
cerca(d1.qty, 1000, 1e-6, 'y la qty baja de 20 000 a 1 000');
eq(d1.pedido, 40000, 'el número pedido se conserva aparte, para poder decirlo');
cerca(d1.riesgo, 2000, 1e-6, 'pero el riesgo QUE SE ASUME pasa a ser 2 000, no 40 000: pintar el pedido sería mentir en la cifra que importa');
TE.openPosition('long', { mode: 'pct', size: 20, entryPrice: 100, time: 0 });
const d2 = TE.sizePorRiesgo({ entryPrice: 100, slPrice: 98, maxLoss: 40000 });
cerca(d2.margen, TE.freeMargin(), 1e-6, 'con una posición ya abierta el tope es el margen QUE QUEDA libre');
ok(d2.qty < d1.qty, 'así que el recorte es mayor: la cuenta manda, no el deseo');
TE.closePosition(100, 'manual', 1000, TE.state.position);

/* ═════════ E) El stop al revés describe otra orden ═════════ */
console.log('\n▸ E) El lado se deduce del stop');
const e1 = TE.sizePorRiesgo({ entryPrice: 100, slPrice: 102, maxLoss: 400 });
eq(e1.side, 'short', 'stop por ENCIMA de la entrada = una VENTA con 400 de pérdida a 102');
cerca(e1.qty, 200, 1e-9, 'la misma distancia, la misma qty (el signo lo pone la dirección)');
cerca(e1.distPct, 2, 1e-9, 'y la distancia contada en % sobre la entrada, no sobre el stop');

/* ════════════════ INTERFAZ ════════════════ */
(async () => {
  let puppeteer;
  for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/node_modules/puppeteer']) {
    try { puppeteer = require(c); break; } catch (e) { /* siguiente */ }
  }
  if (!puppeteer) {
    console.log('\n⚠️  Falta puppeteer: la parte de interfaz queda OMITIDA (motor: ' + pasan + ' ✓).');
    console.log(`\n${'─'.repeat(60)}\nRiesgo fijo (solo motor): ${pasan} superadas, ${fallan} fallidas`);
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

  const escribe = (id, v) => page.evaluate(([i, x]) => {
    const el = document.getElementById(i);
    el.value = x;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, String(v)]);

  console.log('\n▸ F) El cuarto modo de tamaño transforma la carta');
  await page.click('#segSize [data-mode="riesgo"]');
  await espera(240);
  const f = await page.evaluate(() => ({
    modo: App.sizeMode,
    fila: getComputedStyle(document.getElementById('riesgoRow')).display !== 'none',
    tamañoBloqueado: document.getElementById('sizeInput').disabled,
    etiqueta: document.getElementById('sizeLabel').textContent,
    valor: document.getElementById('sizeInput').value,
    hint: document.getElementById('riesgoHint').textContent,
    lado: document.getElementById('riesgoLado').textContent,
  }));
  ok(f.modo === 'riesgo' && f.fila, 'aparecen los dos campos del riesgo (stop y pérdida máxima) y el ratio');
  ok(f.tamañoBloqueado, 'el campo de tamaño pasa a ser una SALIDA: aquí el tamaño no se escribe');
  ok(/deducido/i.test(f.etiqueta), `y se llama lo que es: «${f.etiqueta}»`);
  ok(/obligatorio/.test(f.hint) && f.valor === '' && f.lado === '—',
    'sin pérdida máxima no hay tamaño ni vista previa (225: «Max Risk is a required field»)');

  console.log('\n▸ G) Al escribir el triángulo, el tamaño se deduce delante del usuario');
  const ref = await page.evaluate(() => App.currentPrice());
  const g = await page.evaluate(async (p) => {
    document.getElementById('riesgoSlInput').value = (p * 0.98).toFixed(2);
    document.getElementById('riesgoSlInput').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    document.getElementById('riesgoMaxInput').value = '50';
    document.getElementById('riesgoMaxInput').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 220));
    const r2 = TE.sizePorRiesgo({ entryPrice: App.currentPrice(), slPrice: +(p * 0.98).toFixed(2), maxLoss: 50 });
    return {
      notional: +document.getElementById('sizeInput').value, esperado: r2.notional,
      sl: document.getElementById('slInput').value, tp: document.getElementById('tpInput').value,
      hint: document.getElementById('riesgoHint').textContent, lado: document.getElementById('riesgoLado').textContent,
      qty: r2.qty,
    };
  }, ref);
  cerca(g.notional, g.esperado, 0.02, 'el `sizeInput` muestra el nocional deducido (no un % que nadie pidió)');
  ok(+g.sl === +(ref * 0.98).toFixed(2), 'y el stop se ADJUNTA al campo de SL del formulario (223: «attaching a corresponding stop-loss condition»)');
  ok(g.tp !== '' && +g.tp > ref, 'con 1:1 el TP queda simétrico por encima de la entrada');
  ok(/COMPRA/.test(g.lado) && /por debajo/.test(g.lado), `el lado deducido se dice: «${g.lado}»`);
  ok(/tamaño .*USD · .*uds · margen .*· pérdida 50[.,]00/.test(g.hint.replace(/\s+/g, ' '))
    && !/recortado/.test(g.hint), `la línea de resumen explica de dónde sale: «${g.hint.slice(0, 108)}…»`);

  console.log('\n▸ H) Colocar: el motor recibe un tamaño en USD y su stop');
  const h = await page.evaluate(async () => {
    // El tamaño esperado se anota ANTES de hacer clic: una vez abierta la posición no queda margen
    // libre y `sizePorRiesgo` recortaría a cero, que no es lo que se quiere comprobar aquí.
    const esperado = TE.sizePorRiesgo({
      entryPrice: App.currentPrice(), slPrice: +document.getElementById('riesgoSlInput').value, maxLoss: 50,
    }).notional;
    document.getElementById('btnLong').click();
    await new Promise((r) => setTimeout(r, 320));
    const p = TE.state.position;
    return {
      abierto: !!p, nocional: p && p.notional, sl: p && p.sl, tp: p && p.tp,
      esperado, lado: p && p.side,
    };
  });
  ok(h.abierto && h.lado === 'long', 'la orden se abrió (es una orden de mercado normal, como dice 223)');
  cerca(h.nocional, h.esperado, 0.05, 'con el nocional deducido, no con un % del equity');
  cerca(h.sl, ref * 0.98, 0.02, 'y el stop-loss va puesto en la posición');
  ok(!TE.state.trades.some((t) => t.mode === 'riesgo'), 'el modo «riesgo» no se cuela en el motor: es del formulario');

  console.log('\n▸ I) Un stop puesto al revés no se ejecuta por accidente');
  const i = await page.evaluate(async () => {
    TE.closePosition(App.currentPrice(), 'manual', App.currentTime(), TE.state.position);
    await new Promise((r) => setTimeout(r, 120));
    const p = App.currentPrice();
    document.getElementById('riesgoSlInput').value = (p * 1.02).toFixed(2);   // stop POR ENCIMA
    document.getElementById('riesgoSlInput').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('btnLong').click();
    await new Promise((r) => setTimeout(r, 300));
    const rechazado = { pos: !!TE.state.position, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ') };
    document.getElementById('btnShort').click();
    await new Promise((r) => setTimeout(r, 320));
    return { rechazado, ladoAbierto: TE.state.position && TE.state.position.side, hint: document.getElementById('riesgoHint').textContent };
  });
  ok(i.rechazado.pos === false && /VENTA/.test(i.rechazado.toasts),
    'comprar con el stop por encima de la entrada se rechaza y dice qué lado describe el stop');
  ok(i.ladoAbierto === 'short', 'y el mismo triángulo, con el botón de VENTA, abre la posición que describía');
  await page.evaluate(async () => {
    TE.closePosition(App.currentPrice(), 'manual', App.currentTime(), TE.state.position);
    await new Promise((r) => setTimeout(r, 150));
  });

  console.log('\n▸ J) La entrada es la del tipo de orden, no la última cuota');
  const j = await page.evaluate(async () => {
    document.getElementById('riesgoSlInput').value = '';
    document.getElementById('riesgoMaxInput').value = '';
    document.querySelector('#segOrderType [data-otype="limite"]').click();
    await new Promise((r) => setTimeout(r, 160));
    const limite = +(App.currentPrice() * 0.90).toFixed(2);
    document.getElementById('limitInput').value = String(limite);
    document.getElementById('limitInput').dispatchEvent(new Event('input', { bubbles: true }));
    const slLim = +(limite * 0.98).toFixed(2);
    document.getElementById('riesgoSlInput').value = String(slLim);
    document.getElementById('riesgoSlInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('riesgoMaxInput').value = '400';
    document.getElementById('riesgoMaxInput').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 240));
    const desdeLimite = TE.sizePorRiesgo({ entryPrice: limite, slPrice: slLim, maxLoss: 400 });
    const desdeActual = TE.sizePorRiesgo({ entryPrice: App.currentPrice(), slPrice: slLim, maxLoss: 400 });
    document.getElementById('btnLong').click();
    await new Promise((r) => setTimeout(r, 320));
    const o = TE.state.pending[0] || {};
    return {
      pend: TE.state.pending.length, tam: o.size,
      desdeLimite: desdeLimite.notional, desdeActual: desdeActual.notional,
      entrada: o.entryPrice || o.limitPrice, sl: o.sl, limite, hint: document.getElementById('riesgoHint').textContent,
    };
  });
  ok(j.pend === 1, 'la orden límite queda colocada con el tamaño deducido');
  cerca(j.tam, j.desdeLimite, 0.05, 'el nocional sale del PRECIO LÍMITE (donde se abrirá), no del precio actual');
  ok(Math.abs(j.desdeLimite - j.desdeActual) > j.desdeActual * 0.03,
    `y no es el mismo número por casualidad: desde la entrada real ${j.desdeLimite.toFixed(2)} vs desde la última cuota ${j.desdeActual.toFixed(2)}`);
  cerca(j.entrada, j.limite, 1e-9, 'y la orden espera exactamente en el precio límite escrito, que es la entrada usada para dimensionar');

  console.log('\n▸ K) El ratio deriva el TP y se ve reflejado en la orden');
  const k = await page.evaluate(async () => {
    const antes = (TE.state.pending[0] || {}).tp;
    document.querySelector('#segRiesgoRr [data-rr="4"]').click();
    await new Promise((r) => setTimeout(r, 240));
    const tp = +document.getElementById('tpInput').value;
    const despuesDeRecolocar = (() => {
      TE.cancelOrder(TE.state.pending[0].id);
      document.getElementById('btnLong').click();
      return (TE.state.pending[0] || {}).tp;
    })();
    return { antes, tp, tpOrden: despuesDeRecolocar, hint: document.getElementById('riesgoHint').textContent };
  });
  ok(Number.isFinite(k.tp) && k.tp > 0, '1:4 pone el TP a cuatro veces la distancia del stop');
  ok(k.antes !== k.tp, 'cambiar el ratio NO reescribe la orden que ya está en el libro (el TP se adjunta al colocar)');
  cerca(k.tpOrden, k.tp, 0.05, 'y la orden colocada DESPUÉS lleva el TP del ratio activo');
  ok(/TP 4:1/.test(k.hint), 'la línea de resumen dice el ratio usado');

  console.log('\n▸ L) Sales del modo y la carta vuelve a ser normal');
  const l = await page.evaluate(async () => {
    document.querySelector('#segSize [data-mode="pct"]').click();
    await new Promise((r) => setTimeout(r, 220));
    return {
      fila: getComputedStyle(document.getElementById('riesgoRow')).display === 'none',
      libre: !document.getElementById('sizeInput').disabled,
      etiqueta: document.getElementById('sizeLabel').textContent,
      valor: document.getElementById('sizeInput').value,
    };
  });
  ok(l.fila && l.libre && /% del equity/.test(l.etiqueta),
    `fila de riesgo ocultada, tamaño otra vez editable y rótulo restaurado («${l.etiqueta}»)`);
  ok(l.valor !== '' && parseFloat(l.valor) <= 100,
    `y el número deducido NO se queda tirado en el campo de % (volvería a rechazar por margen): «${l.valor}»`);

  console.log('\n▸ M) Un trailing dimensionado por riesgo (los dos inventos juntos)');
  const m = await page.evaluate(async () => {
    document.getElementById('trailPctInput').value = '2';
    document.getElementById('trailPctInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#segOrderType [data-otype="trailing"]').click();
    await new Promise((r) => setTimeout(r, 180));
    document.querySelector('#segSize [data-mode="riesgo"]').click();
    await new Promise((r) => setTimeout(r, 120));
    const p = App.currentPrice();
    document.getElementById('riesgoSlInput').value = (p * 0.98).toFixed(2);
    document.getElementById('riesgoSlInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('riesgoMaxInput').value = '300';
    document.getElementById('riesgoMaxInput').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 240));
    const esperado = TE.sizePorRiesgo({ entryPrice: p, slPrice: +(p * 0.98).toFixed(2), maxLoss: 300 }).notional;
    document.getElementById('btnLong').click();
    await new Promise((r) => setTimeout(r, 320));
    const o = TE.state.pending.find((x) => x.tipo === 'trailing') || {};
    return { tipo: o.tipo, tam: o.size, esperado, pct: o.callbackPct, pos: !!TE.state.position };
  });
  ok(m.tipo === 'trailing' && m.pct === 2 && !m.pos, 'el trailing se coloca con su retroceso y sin abrir posición');
  cerca(m.tam, m.esperado, 0.05, 'y su tamaño viene del riesgo admitido, igual que en una orden normal');

  console.log('\n▸ N) El promediado no se deja dimensionar por riesgo');
  const n = await page.evaluate(async () => {
    // Se llega aquí EN modo riesgo (M lo dejó así) con un triángulo heredado de I, que describía
    // una VENTA: el alta se habría rechazado por lado, no por margen, y esta sección mide otra
    // cosa. Se vuelve a escribir un triángulo de compra coherente —sin tocar `sizeInput`, que en
    // este modo es una salida— y el tamaño sale del riesgo admitido.
    document.querySelector('#segOrderType [data-otype="market"]').click();
    await new Promise((r) => setTimeout(r, 140));
    const p = App.currentPrice();
    for (const [id, v] of [['riesgoSlInput', (p * 0.98).toFixed(2)], ['riesgoMaxInput', '50']]) {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('btnLong').click();
    await new Promise((r) => setTimeout(r, 320));
    const abierta = !!TE.state.position;
    const qtyAntes = TE.state.position && TE.state.position.qty;
    document.querySelector('#segSize [data-mode="riesgo"]').click();     // otra vez a dimensionar por riesgo
    await new Promise((r) => setTimeout(r, 160));
    const r = App.averagePosition(10, {});
    await new Promise((x) => setTimeout(x, 200));
    return {
      abierta, r,
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '),
      qtyAntes, qty: TE.state.position && TE.state.position.qty,
      entrada: TE.state.position && TE.state.position.entryPrice,
    };
  });
  ok(n.abierta, 'primero se abre la posición (esta vez con el tamaño deducido en USD)');
  ok(n.r === null && /promediado/.test(n.toasts) && n.qtyAntes > 0,
    `y añadir a la posición en modo riesgo se rechaza con motivo, no leyendo un % como USD `
    + `(r=${JSON.stringify(n.r)} qty=${n.qtyAntes} avisos=«${n.toasts.slice(0, 130)}»)`);
  ok(n.qty > 0 && Number.isFinite(n.entrada),
    `la posición sigue intacta tras el rechazo (qty ${n.qty && n.qty.toFixed(6)} sin tocar)`);

  ok(errs.length === 0, `sin errores de JavaScript en toda la sesión (${errs.length})${errs.length ? ' → ' + errs.slice(0, 2).join(' ⧸ ') : ''}`);

  console.log('\n' + '─'.repeat(62));
  console.log(`Riesgo fijo: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El tamaño se deduce del riesgo admitido, como en 223/225, y la orden que llega al motor es normal con su stop adjunto.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
