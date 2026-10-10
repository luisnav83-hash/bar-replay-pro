/* =========================================================================
 * tests/apalancamiento-lado.test.js — apalancamiento POR DIRECCIÓN (hedge)
 *
 * La API lo dice con un campo: `set_leverage` admite `holdSide`, y en modo hedge cada dirección
 * tiene su propio apalancamiento (en ONE-WAY no existe la pregunta: hay UNA posición). Consecuencia
 * que importa y que aquí se comprueba con números: el apalancamiento de un lado decide CUÁNTO MARGEN
 * consume ese lado y DÓNDE se liquida, así que separar los lados puede cerrar la puerta de uno sin
 * tocar la del otro.
 *
 *  Uso:  node tests/apalancamiento-lado.test.js
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

const V = (t, o, h, l, c) => ({ time: t, open: o, high: h, low: l, close: c, volume: 1 });
// La tabla de tramos se inyecta a propósito: `niveles: null` es el modo clásico de LIQUIDACIÓN, y
// sin tabla `apalancamientoPermitido` no tiene tope que aplicar —comprobar «me recorta a 125×» con la
// tabla apagada sería un verde falso—.
const TRAMOS = [
  { level: 1, startValue: 0, endValue: 50000, leverage: 125, maintenanceMarginRate: 0.004 },
  { level: 2, startValue: 50000, endValue: 200000, leverage: 100, maintenanceMarginRate: 0.005 },
];
const arranca = (modo) => {
  TE.resetAccount(10000);
  TE.configure({ leverage: 10, feePct: 0.05, fundingPct: 0, niveles: TRAMOS, averaging: true });
  TE.state.marginMode = 'cross';
  TE.setPosicionModo(modo === 'HEDGE' ? 'HEDGE' : 'ONE_WAY');
  TE.onCandle(V(0, 100, 100, 100, 100));
  avisos.length = 0;
};

/* ═════════ A) ONE-WAY: la pregunta no existe ═════════ */
console.log('\n▸ A) En ONE-WAY no hay lados que separar');
arranca('ONE_WAY');
eq(TE.leverageDe('long'), 10, 'los dos lados leen el valor de la cuenta');
eq(TE.leverageDe('short'), 10, '▲ y ▼ no pueden ser distintos aquí');
const a1 = TE.setLeverageLado('long', 25);
eq(a1.aplicado, 'cuenta', 'pedir el lado largo se responde aplicándolo a la cuenta (no se ignora en silencio)');
eq(TE.state.leverage, 25, 'y el valor de cuenta cambia de verdad');
eq(TE.leverageDe('short'), 25, 'los dos lados lo siguen: en one-way solo hay un apalancamiento');
eq(TE.leverageLadoInfo().separado, false, 'y el estado sigue diciendo que no están separados');
ok(avisos.some((x) => /PARA TODA LA cuenta/.test(x) && /ONE-WAY/.test(x)),
  'el registro explica por qué no se guardó por lado, para que el deslizador no parezca roto');
const a2 = TE.setLeverageLado('lado', 5);
eq(a2.ok, false, 'un lado que no es long ni short se rechaza');
ok(/necesita un lado/.test(a2.msg), `y el motivo se lee: «${a2.msg}»`);

/* ═════════ B) HEDGE: cada lado, el suyo ═════════ */
console.log('\n▸ B) En HEDGE cada dirección tiene el suyo');
arranca('HEDGE');
const b1 = TE.setLeverageLado('long', 30);
ok(b1.ok && b1.aplicado === 'lado', 'se puede poner el largo a 30× sin tocar la cuenta');
eq(TE.leverageDe('long'), 30, '▲ a 30×');
eq(TE.leverageDe('short'), 10, '▼ sigue donde estaba (10×): NO se hereda del otro lado');
eq(TE.state.leverage, 10, 'y el valor de cuenta no se toca: es el de un lado no separado');
eq(TE.leverageLadoInfo().separado, true, 'el estado dice que los lados van separados');
ok(avisos.some((x) => /LARGO ▲: 10× → 30×/.test(x) || /fijado en 30×/.test(x)),
  'el registro dice qué lado, de cuánto a cuánto y que la cuenta va a otro valor');
// MISMA exposición en los dos lados, distinto apalancamiento ⇒ distinto margen. Con `pct` no se
// vería (el % fija el MARGEN y deja el nocional libre), así que se comparan dos nocionales iguales.
const largo = TE.openPosition('long', { mode: 'notional', size: 10000, entryPrice: 100, time: 0 });
eq(largo.leverage, 30, 'la posición larga nace con el apalancamiento de SU lado (30×), no con el de la cuenta');
TE.setLeverageLado('short', 4);
const corto = TE.openPosition('short', { mode: 'notional', size: 10000, entryPrice: 100, time: 1000 });
eq(corto.leverage, 4, 'y la corta, con el suyo (4×)');
cerca(largo.notional / 30 + corto.notional / 4, TE.marginUsed(), 1e-6,
  'el margen usado de la cuenta es la SUMA de los dos, cada uno con su propio divisor');
cerca(largo.notional, corto.notional, 1e-6, 'los dos lados tienen el MISMO nocional (10 000 USD de exposición)');
ok(corto.notional / 4 > largo.notional / 30 * 5,
  `y 10 000 USD cuestan ${ (corto.notional / 4).toFixed(0) } de margen al corto a 4× frente a ${ (largo.notional / 30).toFixed(0) } al largo a 30×: la misma exposición no cuesta lo mismo en los dos lados`);

/* ═════════ C) El tramo manda sobre el deseo ═════════ */
console.log('\n▸ C) Máximo por tramo (F8), aplicado por lado');
arranca('HEDGE');
const c1 = TE.setLeverageLado('long', 500);
ok(c1.ok && c1.recortado, 'pedir 500× con una posición de 0 de nocional no se acepta tal cual');
eq(c1.leverage, 125, 'y se recorta al máximo del tramo de la tabla local (125× para el primer tramo)');
eq(TE.leverageDe('long'), 125, 'el lado se queda en el tope, no en el capricho');
ok(avisos.some((x) => /no puede ir a 500×/.test(x) && /máximo 125×/.test(x)),
  'el aviso dice el tope y por qué (el tramo, no un número mágico)');
TE.openPosition('long', { mode: 'pct', size: 40, entryPrice: 100, time: 0 });   // nocional 160 000 → tramo 2
const c2 = TE.setLeverageLado('long', 200);
eq(c2.leverage, 100, 'con la posición de 160 000 USD puesta, el tope del tramo 2 es 100× y ahí se corta');
ok(TE.posicionDe('long').leverage === 100, 'y la posición pasa a ese tope, no al pedido');

/* ═════════ D) Bajar el apalancamiento con posición abierta paga margen ═════════ */
console.log('\n▸ D) Cambiar con el lado abierto: quién paga la diferencia');
arranca('HEDGE');
TE.setLeverageLado('long', 50);
const p = TE.openPosition('long', { mode: 'notional', size: 8000, entryPrice: 100, time: 0 });
const margen0 = p.notional / 50, libre0 = TE.freeMargin();
TE.onCandle(V(1000, 100, 100, 100, 100));
const liq0 = TE.liquidationPrice(p);
const d1 = TE.setLeverageLado('long', 10);
ok(d1.ok, 'bajar de 50× a 10× con 8 000 de exposición se puede: el margen de la posición pasa de 160 a 800');
eq(p.leverage, 10, 'la posición pasa a 10×');
ok(margen0 === 160, `arrancaba en ${margen0.toFixed(0)} de margen (8 000 / 50)`);
cerca(TE.marginUsed(), p.notional / 10, 1e-6,
  'el margen que ocupa la posición pasa a ser su nocional partido por el NUEVO apalancamiento');
ok(TE.freeMargin() < libre0 - 600, `el margen extra sale de la cuenta: libre ${libre0.toFixed(0)} → ${TE.freeMargin().toFixed(0)}`);
// Y aquí está la consecuencia que de verdad importa, con su matiz por modo de margen: en CRUZADO el
// cambio de apalancamiento NO mueve la liquidación, porque `margen + libre` es el mismo dinero; en
// AISLADO sí, porque solo respalda el margen de esa posición.
cerca(TE.liquidationPrice(p), liq0, 1e-6,
  'en CRUZADO la liquidación se queda donde estaba: separar el apalancamiento no es una palanca de riesgo escondida');
ok(avisos.some((x) => /CRUZADO: el resto de la cuenta absorbe/.test(x)),
  'y el registro lo dice en vez de dejarlo adivinar');
TE.setMarginMode('isolated');
const liqA = TE.liquidationPrice(TE.posicionDe('long'));
const d1b = TE.setLeverageLado('long', 5);
ok(d1b.ok && TE.posicionDe('long').leverage === 5, 'en AISLADO el mismo tipo de cambio se aplica igual');
ok(TE.liquidationPrice(TE.posicionDe('long')) !== liqA,
  `y aquí la liquidación SÍ se mueve (${liqA && liqA.toFixed(2)} → ${TE.liquidationPrice(TE.posicionDe('long')).toFixed(2)}): solo respalda el margen de la posición`);
ok(avisos.some((x) => /AISLADO: solo cambia el de esta posición/.test(x)), 'con el aviso que distingue los dos casos');
TE.setMarginMode('cross');
// Y cuando no hay margen libre, se rechaza SIN dejar la posición a medias.
arranca('HEDGE');
TE.setLeverageLado('long', 5);
// 12 000 de exposición a 5× ocupan 2 400; bajar a 1× exigiría 12 000 de margen y la cuenta entera
// son 10 000, así que el único final honesto es rechazar.
const q = TE.openPosition('long', { mode: 'notional', size: 12000, entryPrice: 100, time: 0 });
const antes = q.leverage;
const d2 = TE.setLeverageLado('long', 1);
eq(d2.ok, false, 'subir el tamaño de margen que la cuenta no tiene se rechaza');
eq(d2.code, 20015, 'con el código de margen insuficiente de la API (20015)');
eq(q.leverage, antes, 'y la posición conserva su apalancamiento: no hay estado a medias');
ok(avisos.some((x) => /no aguanta 2×/.test(x) || /margen/.test(x)), 'el aviso dice cuánta diferencia falta');

/* ═════════ E) Unificar y sobrevivir al guardar ═════════ */
console.log('\n▸ E) Unificar los lados y persistencia');
arranca('HEDGE');
TE.setLeverageLado('long', 40);
TE.setLeverageLado('short', 20);
const e0 = TE.openPosition('short', { mode: 'pct', size: 20, entryPrice: 100, time: 0 });
eq(e0.leverage, 20, 'el corto abierto con su lado a 20×');
const cp = TE.serialize();
const u = TE.offLeverageLado();
eq(u.ok, true, 'unificar los lados es una acción explícita, no un side-effect');
eq(TE.leverageDe('long'), TE.state.leverage, '▲ vuelve al valor de cuenta');
eq(TE.leverageDe('short'), TE.state.leverage, '▼ también');
eq(TE.posicionDe('short').leverage, TE.state.leverage, 'y las posiciones abiertas se recalculan con él');
TE.state.leverageLado = { long: 7, short: 8 };
TE.state.leverage = 3;
const snap = TE.serialize();
TE.resetAccount(10000);
TE.restore(snap);
eq(TE.leverageDe('long'), 7, 'el lado separado sobrevive a guardar/cargar (si no, una posición volvería a la vida con el apalancamiento del otro lado)');
eq(TE.leverageDe('short'), 8, 'los dos lados viajan en el snapshot');
ok(!!cp && !Number.isNaN(JSON.stringify(cp).length), 'el snapshot anterior al cambio sigue siendo serializable');

/* ════════════════ INTERFAZ ════════════════ */
(async () => {
  let puppeteer;
  for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/node_modules/puppeteer']) {
    try { puppeteer = require(c); break; } catch (e) { /* siguiente */ }
  }
  if (!puppeteer) {
    console.log('\n⚠️  Falta puppeteer: la parte de interfaz queda OMITIDA (motor: ' + pasan + ' ✓).');
    console.log(`\n${'─'.repeat(60)}\nApalancamiento por lado (solo motor): ${pasan} superadas, ${fallan} fallidas`);
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

  console.log('\n▸ F) En ONE-WAY no hay fila de lados');
  const f = await page.evaluate(() => ({
    fila: getComputedStyle(document.getElementById('segLevLado')).display !== 'none',
    lectura: !document.getElementById('levLados').hidden,
  }));
  ok(!f.fila && !f.lectura, 'ni el selector de lado ni la lectura de los dos aparecen (un control que no cambia nada es ruido)');

  console.log('\n▸ G) Al pasar a hedge aparecen, unificados');
  await page.click('#segPosMode [data-pmode="HEDGE"]');
  await espera(320);
  const g = await page.evaluate(() => ({
    fila: getComputedStyle(document.getElementById('segLevLado')).display !== 'none',
    lectura: !document.getElementById('levLados').hidden,
    texto: document.getElementById('levLados').textContent.replace(/\s+/g, ' ').trim(),
    cuenta: TE.state.leverage,
    activo: ((document.querySelector('#segLevLado .seg-btn.active') || {}).dataset || {}).levlado || '—',
  }));
  ok(g.fila && g.lectura, 'la fila del lado y la lectura de los dos aparecen con el modo hedge');
  ok(/▲ \d+× · ▼ \d+×/.test(g.texto) && /unificados/.test(g.texto), `y dicen lo que son: «${g.texto}»`);
  ok(g.activo === 'long', 'el deslizador empieza mirando al lado largo');

  console.log('\n▸ H) El deslizador escribe en el lado elegido, no en la cuenta');
  const h = await page.evaluate(async () => {
    document.querySelector('#segLevLado [data-levlado="short"]').click();
    await new Promise((r) => setTimeout(r, 140));
    const r = document.getElementById('levRange');
    r.value = '24';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((x) => setTimeout(x, 260));
    const sel = document.getElementById('leverageSelect');
    return {
      short: TE.leverageDe('short'), long: TE.leverageDe('long'), cuenta: TE.state.leverage,
      select: +sel.value, texto: document.getElementById('levLados').textContent.replace(/\s+/g, ' ').trim(),
      dif: document.getElementById('levLados').className.includes('dif'),
      deslizador: +r.value, info: TE.leverageLadoInfo(),
    };
  });
  eq(h.short, 24, 'el corto se va a 24× arrastrando el deslizador con ▼ elegido');
  eq(h.cuenta, h.long, 'y el apalancamiento de cuenta NO se toca (es el largo el que lo sigue)');
  eq(h.select, h.cuenta, 'el <select> heredado se queda con el valor de cuenta: escribir un lado no reescribe la cuenta');
  eq(h.deslizador, 24, 'el deslizador refleja el lado que edita, no la cuenta');
  ok(/▲ 1?0?0?\d*× · ▼ 24×/.test(h.texto), `la lectura de los dos: «${h.texto}»`);
  ok(h.dif, 'y se pinta el estado «separado» (es el que cambia una liquidación)');
  ok(h.info.separado && h.info.long !== h.info.short, 'el estado del motor cuadra con lo pintado');

  console.log('\n▸ I) Cada posición nace con el apalancamiento de su lado');
  const i = await page.evaluate(async () => {
    document.getElementById('sizeInput').value = 5;
    document.getElementById('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#segTradeSide [data-tside="open"]').click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('btnShort').click();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('#segLevLado [data-levlado="long"]').click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('btnLong').click();
    await new Promise((r) => setTimeout(r, 300));
    const L = TE.posicionDe('long'), S = TE.posicionDe('short');
    return {
      dos: !!L && !!S, levL: L && L.leverage, levS: S && S.leverage,
      margenL: L && L.notional / L.leverage, margenS: S && S.notional / S.leverage,
      suma: TE.marginUsed(), libre: TE.freeMargin(),
      posNotional: (document.getElementById('posNotional') || {}).textContent || '',
      cuenta: TE.state.leverage, balance: TE.state.balance,
    };
  });
  ok(i.dos, 'las dos posiciones conviven (hedge) y las dos se abrieron por el formulario');
  eq(i.levS, 24, 'la corta lleva el 24× que se le puso a su lado');
  eq(i.levL, i.cuenta, 'la larga lleva el de cuenta, porque al largo no se le puso un valor propio');
  ok(i.levL !== i.levS, `los dos lados están abiertos con apalancamientos DISTINTOS: ▲ ${i.levL}× · ▼ ${i.levS}×`);
  cerca(i.margenL + i.margenS, i.suma, 0.02, 'el margen usado de la cuenta es la suma de los dos, cada uno con su divisor');
  // (El balance se lee DENTRO de la página: `TE` del test es el motor del vm, otro contexto, y
  // comparar contra él daba un verde imposible de conseguir —o un rojo falso, como este—.)
  ok(i.suma > 0 && i.libre >= 0 && Math.abs(i.libre + i.suma - i.balance) < 0.05,
    `libre + usado = balance de la página (${i.libre.toFixed(2)} + ${i.suma.toFixed(2)} = ${i.balance.toFixed(2)})`);
  ok(/\d[xX]/.test(i.posNotional), `la carta de posición pinta el suyo: «${i.posNotional}»`);

  console.log('\n▸ J) Bajar el apalancamiento de un lado con la cuenta justa');
  const j = await page.evaluate(async () => {
    const S = TE.posicionDe('short');
    const antes = S.leverage;
    const r = document.getElementById('levRange');
    document.querySelector('#segLevLado [data-levlado="short"]').click();
    await new Promise((x) => setTimeout(x, 140));
    r.value = '2';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((x) => setTimeout(x, 280));
    const toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent.replace(/\s+/g, ' ')).join(' || ');
    return {
      antes, ahora: TE.posicionDe('short').leverage, rechazado: TE.posicionDe('short').leverage === antes && /margen/.test(toasts),
      aceptado: TE.posicionDe('short').leverage === 2, toasts: toasts.slice(-160),
      deslizador: +r.value, lectura: document.getElementById('levLados').textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  ok(j.aceptado || j.rechazado,
    `o se aplica (▲ ${j.ahora}×) o se rechaza con motivo —nunca se queda a medias—: «${j.toasts.slice(0, 110)}»`);
  if (j.rechazado) ok(j.deslizador === j.antes,
    'y si se rechaza, el deslizador VUELVE al valor real (dejarlo en el número imposible es mentir en el control)');
  else ok(j.lectura.includes('▼ 2×'), `la lectura de los dos se actualiza tras aplicarlo: «${j.lectura}»`);

  console.log('\n▸ K) «⤺ Ambos» deshace la separación');
  const k = await page.evaluate(async () => {
    document.querySelector('#segLevLado [data-levlado="reset"]').click();
    await new Promise((r) => setTimeout(r, 280));
    return {
      long: TE.leverageDe('long'), short: TE.leverageDe('short'), cuenta: TE.state.leverage,
      lectura: document.getElementById('levLados').textContent.replace(/\s+/g, ' ').trim(),
      dif: document.getElementById('levLados').className.includes('dif'),
      pos: TE.posiciones().map((p) => p.side + ':' + p.leverage).join(' '),
      todosCuenta: TE.posiciones().length > 0 && TE.posiciones().every((p) => p.leverage === TE.state.leverage),
    };
  });
  ok(k.long === k.cuenta && k.short === k.cuenta, `los dos lados vuelven al valor de cuenta (${k.long}× / ${k.short}× vs ${k.cuenta}×)`);
  ok(/unificados/.test(k.lectura) && !k.dif, `y la lectura lo dice sin el aviso de diferencia: «${k.lectura}»`);
  ok(k.todosCuenta, `las posiciones abiertas se recalculan al unificar (${k.pos || 'ninguna'})`);

  console.log('\n▸ L) Sales de hedge y la fila desaparece (con su estado guardado)');
  const l = await page.evaluate(async () => {
    for (const p of TE.posiciones().slice()) TE.closePosition(App.currentPrice(), 'manual', App.currentTime(), p);
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector('#segPosMode [data-pmode="ONE_WAY"]').click();
    await new Promise((r) => setTimeout(r, 260));
    return {
      fila: getComputedStyle(document.getElementById('segLevLado')).display !== 'none',
      lectura: !document.getElementById('levLados').hidden,
      modo: TE.state.modoPosicion,
    };
  });
  ok(l.modo === 'ONE_WAY' && !l.fila && !l.lectura, 'en one-way vuelven a no existir: ni control ni lectura');

  ok(errs.length === 0, `sin errores de JavaScript en toda la sesión (${errs.length})${errs.length ? ' → ' + errs.slice(0, 2).join(' ⧸ ') : ''}`);

  console.log('\n' + '─'.repeat(62));
  console.log(`Apalancamiento por lado: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ Cada dirección tiene su apalancamiento en hedge, con su margen, su liquidación y su camino de vuelta.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
