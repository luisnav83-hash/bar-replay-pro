/* =========================================================================
 * tests/hedge.test.js — MODO DE POSICIÓN one-way / hedge (capa 4)
 *
 *  1) MOTOR (vm, velas sintéticas, números cerrados): lo que el modo cambia de
 *     verdad. Se exige con dos posiciones vivas a la vez, porque es el único
 *     modo de comprobar que el PnL, el margen, el funding, los niveles y el
 *     cierre van POR DIRECCIÓN y no «a la posición que haya».
 *  2) INTERFAZ (puppeteer sobre el archivo único, a clics): que el conmutador
 *     exista y respete la regla del exchange (200014: no se cambia con
 *     posiciones u órdenes abiertas), que la tarjeta de posición permita llegar
 *     a la dirección no mostrada, que el gráfico conserve las líneas de las dos
 *     y que «Cerrar todo» cierre las dos.
 *
 *  Uso:  node tests/hedge.test.js
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
const eq = (a, b, msg) => ok(a === b, `${msg} (${JSON.stringify(a)}${a !== b ? ' ≠ ' + JSON.stringify(b) : ''})`);
const cerca = (a, b, tol, msg) => ok(Number.isFinite(a) && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol),
  `${msg} (${Number.isFinite(a) ? a.toFixed(4) : a}${Number.isFinite(a) && Math.abs(a - b) > (tol === undefined ? 1e-9 : tol) ? ' ≠ ' + b : ''})`);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══════════════════════ 1) MOTOR ═══════════════════════ */

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
try { U.beep = () => {}; } catch (e) {}

const vela = (t, o, h, l, c) => ({ time: t, open: o, high: h, low: l, close: c, volume: 1 });
// Semilla: el motor necesita un precio de referencia antes de la primera posición.
TE.resetAccount(10000);
TE.configure({ leverage: 10, feePct: 0.05, fundingPct: 0, makerFeePct: null });
TE.onCandle(vela(0, 100, 100, 100, 100));

console.log('\n▸ A) ONE-WAY: una orden al otro lado no abre una segunda posición');
avisos.length = 0;
const l1 = TE.openPosition('long', { mode: 'pct', size: 40, entryPrice: 100 });
ok(!!l1 && TE.posiciones().length === 1, 'hay una LONG abierta (40 % del capital, 10x)');
const s1 = TE.openPosition('short', { mode: 'pct', size: 40, entryPrice: 100 });
eq(s1, null, 'en ONE-WAY la orden contraria se rechaza en vez de abrir una segunda posición');
eq(TE.posiciones().length, 1, 'y solo sigue habiendo una dirección viva');
ok(avisos.some((x) => /Ya hay una posición abierta/.test(x)), 'el aviso dice el motivo y apunta a la salida (cambiar de modo)');
TE.configure({ averaging: false });   // con el promediado activo el mismo lado AÑADE (eso es otra capa: promediar.test.js)
const l2 = TE.openPosition('long', { mode: 'pct', size: 10, entryPrice: 100 });
eq(l2, null, 'en el MISMO lado, con el promediado apagado, no se duplica la posición');
TE.configure({ averaging: true });

console.log('\n▸ B) El cambio de modo respeta la regla medida del exchange (200014)');
const conViva = TE.setPosicionModo('HEDGE');
eq(conViva.ok, false, 'con una posición abierta, cambiar de modo se RECHAZA');
eq(conViva.code, 200014, 'con el mismo código que devuelve la API (estudio §13)');
eq(TE.state.modoPosicion, 'ONE_WAY', 'y el modo NO cambia: quedarse «a medias» sería peor que no poder cambiar');
TE.closePosition(100, 'manual', 0);
eq(TE.posiciones().length, 0, 'se cierra la posición (y la tarjeta queda FLAT)');
const conPendiente = (TE.placeLimit('long', { limitPrice: 90, mode: 'pct', size: 10, efecto: 'GTC', time: 0 }), TE.state.pending.length);
eq(conPendiente, 1, 'queda una orden LÍMITE en espera');
eq(TE.setPosicionModo('HEDGE').ok, false, 'con una orden pendiente también se rechaza (no solo con posición)');
TE.cancelOrder(TE.state.pending[0].id);
const libre = TE.setPosicionModo('HEDGE');
eq(libre.ok, true, 'y en cuanto no hay nada abierto se puede cambiar');
eq(TE.state.modoPosicion, 'HEDGE', 'el motor está en HEDGE');

console.log('\n▸ C) HEDGE: dos direcciones conviven, cada una por su cuenta');
avisos.length = 0;
const L = TE.openPosition('long', { mode: 'pct', size: 40, entryPrice: 100, sl: 95, tp: 110 });
const S = TE.openPosition('short', { mode: 'pct', size: 40, entryPrice: 100, sl: 105, tp: 90 });
ok(!!L && !!S, 'LONG y SHORT abiertas a la vez sobre el mismo símbolo');
eq(TE.posiciones().length, 2, 'el sitio de las dos es `state.posiciones`, una ranura por lado');
eq(TE.state.position, L, '`state.position` sigue siendo la principal (la larga), que es lo que leen las ~40 vistas antiguas');
cerca(TE.unrealized(100), 0, 1e-9, 'con las dos al mismo precio el PnL abierto suma cero');
// Las dos patas NO tienen el mismo notional (la segunda se calcula sobre el balance que quedó
// tras la comisión de la primera), así que se comprueba la SUMA por dirección, no un cero de
// manual que solo saldría con tamaños idénticos.
const uL102 = (102 - L.entryPrice) * L.qty, uS102 = (102 - S.entryPrice) * S.qty * -1;
cerca(TE.unrealized(102), uL102 + uS102, 1e-6, 'y a 102 el PnL abierto es la suma de los dos lados, cada uno con su tamaño');
ok(uL102 > 0 && uS102 < 0, `los signos son opuestos (+${uL102.toFixed(2)} / ${uS102.toFixed(2)})`);
cerca(TE.marginUsed(), L.notional / L.leverage + S.notional / S.leverage, 1e-6, 'el margen consumido es la SUMA de los dos lados');
eq(TE.posicionDe('short'), S, '`posicionDe` encuentra la corta');
eq(TE.posicionEncontra('long'), S, '`posicionEncontra(long)` es la corta (la que una compra puede reducir)');

console.log('\n▸ D) SL y liquidación van POR DIRECCIÓN');
const antesCorta = { qty: S.qty, sl: S.sl };
TE.onCandle(vela(1000, 100, 100.5, 94.5, 95));          // toca el SL de la LONG, no el de la SHORT
eq(TE.posiciones().length, 1, 'el SL de la LONG la cierra y la SHORT sigue viva');
eq(TE.posicionDe('long'), null, 'la ranura larga queda libre');
ok(TE.posicionDe('short') === S && S.qty === antesCorta.qty && S.sl === antesCorta.sl,
  'a la SHORT no le cambió ni el tamaño ni el nivel (no se llevó nada por arrastre)');
cerca(TE.unrealized(95), (95 - 100) * S.qty * -1, 1e-6, 'y el PnL abierto del superviviente es el suyo, no la suma con una muerta');

console.log('\n▸ E) Funding en las dos direcciones, con signos contrarios');
TE.resetAccount(10000);
TE.onCandle(vela(0, 100, 100, 100, 100));
TE.setPosicionModo('HEDGE');
const L2 = TE.openPosition('long', { mode: 'pct', size: 40, entryPrice: 100, time: 0 });
const S2 = TE.openPosition('short', { mode: 'pct', size: 40, entryPrice: 100, time: 0 });
TE.configure({ fundingPct: 0.01 });
// Una vela diaria que se salta las tres horas de liquidación (00/08/16 UTC+8) paga tres veces.
TE.onCandle({ time: L2.entryTime + 86400000, open: 100, high: 100, low: 100, close: 100, volume: 1 });
const fL = L2.funding || 0, fS = S2.funding || 0;
ok(fL < 0 && fS > 0, `la LARGA paga y la CORTA cobra (${fL.toFixed(2)} / ${fS.toFixed(2)})`);
ok(Math.abs(fL + fS) < Math.abs(fL) * 0.05,
  `el neto de la cuenta se compensa (${(fL + fS).toFixed(4)} junto a un pago de ${fL.toFixed(2)}; las patas difieren en el nocional)`);
cerca(Math.abs(fL), 3 * L2.notional * 0.0001, 1e-6, 'cada lado paga tres liquidaciones sobre SU propio nocional a 0,01 %');

console.log('\n▸ F) `tradeSide`: Abrir y Cerrar son papeles distintos');
TE.resetAccount(10000);
TE.onCandle(vela(0, 100, 100, 100, 100));
TE.setPosicionModo('HEDGE');
const sinNada = TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, tradeSide: 'close' });
eq(sinNada, null, 'CLOSE sin posición contraria no inventa nada: se rechaza');
ok(avisos.some((x) => /lado contrario/.test(x)), 'y el aviso lo explica');
const L3 = TE.openPosition('long', { mode: 'pct', size: 40, entryPrice: 100, tradeSide: 'open' });
ok(!!L3, 'Abrir LONG funciona igual que en one-way');
// `size` en una orden CLOSE es la CANTIDAD QUE SE CIERRA (el `qty` de la API), no un sí/no: con
// 40 % se cerraría solo ese trozo, así que para el caso «cerrar la posición entera» se pide 100.
const cerrar = TE.openPosition('short', { mode: 'pct', size: 100, entryPrice: 100, tradeSide: 'close' });
eq(TE.posicionDe('short'), null, 'una orden SHORT con tradeSide=CLOSE NO abre posición corta');
eq(TE.posicionDe('long'), null, 'y cierra la LONG (el `tradeSide: CLOSE` de la API, que exige posición)');
ok(!!cerrar && cerrar.status === 'closed', 'lo que devuelve es el CIERRE, no una apertura');
const abreOtra = TE.openPosition('short', { mode: 'pct', size: 40, entryPrice: 100, tradeSide: 'open' });
ok(!!abreOtra && !!TE.posicionDe('short') && !TE.posicionDe('long'),
  'con tradeSide=OPEN, en cambio, la SHORT se abre sola donde antes había una LONG cerrada');
// Un límite con CLOSE también debe llegar como reduce-only al relleno.
const ordenCierre = TE.placeLimit('long', { limitPrice: 90, mode: 'pct', size: 100, tradeSide: 'close', efecto: 'GTC', time: 0 });
ok(!!ordenCierre && ordenCierre.reduceOnly === true,
  'el límite con «Cerrar» se coloca como reduce-only (una orden así jamás puede aumentar la corta)');
TE.cancelOrder(ordenCierre.id);

console.log('\n▸ G) La partida guarda y devuelve las DOS posiciones y el modo');
TE.resetAccount(10000);
TE.onCandle(vela(0, 100, 100, 100, 100));
TE.setPosicionModo('HEDGE');
TE.openPosition('long', { mode: 'pct', size: 30, entryPrice: 100, sl: 96 });
TE.openPosition('short', { mode: 'pct', size: 25, entryPrice: 100, sl: 104 });
const foto = JSON.parse(JSON.stringify(TE.serialize()));
eq(foto.posiciones.length, 2, 'la serialización lleva las dos direcciones');
eq(foto.state.modoPosicion, 'HEDGE', 'y el modo viaja DENTRO de `state` (si cayera fuera, restore no lo vería)');
TE.resetAccount(10000);
TE.onCandle(vela(0, 100, 100, 100, 100));
eq(TE.posiciones().length, 0, 'se limpia la cuenta (en one-way, sin modo hedge)');
TE.restore(foto);
eq(TE.state.modoPosicion, 'HEDGE', 'el restore devuelve el modo ANTES que las posiciones');
eq(TE.posiciones().length, 2, 'y las dos direcciones vivas (si cayeran por `position` se perdería una)');
ok(TE.state.trades.filter((t) => t && t.status === 'open').length === 2,
  'sus dos filas del historial vuelven a ser el mismo objeto (si no, cerrar una no actualizaría la hoja)');
TE.onCandle(vela(1e12, 100, 95.5, 95.4, 95.5));
eq(TE.posiciones().length, 1, 'restaurada la pareja, el SL de la larga sigue vivo y se dispara');
ok(!!TE.posicionDe('short'), 'y la corta sigue intacta después del idas y venidas');

console.log('\n▸ H) Reduce-only en HEDGE: compra para cerrar la CORTA');
const corta = TE.posicionDe('short');
avisos.length = 0;
const antes = corta.qty;
TE.openPosition('long', { reduceOnly: true, mode: 'pct', size: 100, entryPrice: 100, time: 0 });
ok(!TE.posicionDe('long'), 'una compra reduce-only NO abre larga en hedge');
eq(TE.posicionDe('short'), null, 'y cierra la corta (que es la posición que una compra puede reducir)');
ok(antes > 0, `la corta tenía tamaño que cerrar (${antes.toFixed(6)})`);
TE.closePosition(100, 'manual', 0);
TE.state.modoPosicion = 'ONE_WAY';
TE.resetAccount(10000);
TE.onCandle(vela(0, 100, 100, 100, 100));
TE.openPosition('long', { mode: 'pct', size: 40, entryPrice: 100 });
avisos.length = 0;
TE.openPosition('long', { reduceOnly: true, mode: 'pct', size: 100, entryPrice: 100, time: 0 });
ok(avisos.some((x) => /mismo lado AUMENTARÍA/.test(x)), 'en ONE-WAY se conserva el aviso preciso de siempre para la reduce-only mal orientada');

/* ═══════════════════════ 2) INTERFAZ ═══════════════════════ */
(async () => {
  let puppeteer;
  for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/node_modules/puppeteer']) {
    try { puppeteer = require(c); break; } catch (e) { /* siguiente ruta */ }
  }
  if (!puppeteer) {
    console.log('\n⚠️  Falta puppeteer: la parte de interfaz queda OMITIDA (motor: ' + pasan + ' ✓).');
    console.log('\n' + '─'.repeat(60));
    console.log(`Modo hedge (solo motor): ${pasan} superadas, ${fallan} fallidas`);
    process.exit(fallan ? 1 : 0);
  }
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().startsWith('file://') || r.url().startsWith('data:') ? r.continue() : r.abort('failed')));

  await page.goto('file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html'),
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.waitForFunction(() => Number.isFinite(App.currentPrice()) && App.currentPrice() > 0, { timeout: 30000, polling: 120 });
  await espera(500);

  console.log('\n▸ I) El conmutador de modo en la tarjeta de órdenes');
  const i0 = await page.evaluate(() => ({
    enAvanzado: !!document.querySelector('#orderAvanzado #posModeRow'),
    modo: TE.state.modoPosicion,
    papelOculto: getComputedStyle(document.getElementById('segTradeSide')).display === 'none',
    botones: [...document.querySelectorAll('#segPosMode .seg-btn')].map((b) => b.textContent.trim()),
    activo: ((document.querySelector('#segPosMode .seg-btn.active') || {}).dataset || {}).pmode || 'ninguno',
  }));
  ok(i0.enAvanzado, 'vive dentro de «Avanzado» (es un ajuste de la cuenta, y el formulario en reposo no puede crecer: lo vigila responsive.test.js)');
  ok(i0.botones.join('/') === 'ONE-WAY/HEDGE', `los dos nombres del exchange: ${i0.botones.join(' / ')}`);
  ok(i0.modo === 'ONE_WAY' && i0.activo === 'ONE_WAY',
    `se abre en ONE-WAY, el modo por defecto (motor: ${i0.modo}; segmentado: ${i0.activo})`);
  ok(i0.papelOculto, 'y en ONE-WAY no se ofrece «Abrir/Cerrar»: allí la orden contraria ya reduce');

  await page.click('#segPosMode [data-pmode="HEDGE"]');
  await espera(260);
  const i1 = await page.evaluate(() => ({
    modo: TE.state.modoPosicion,
    papelVisible: getComputedStyle(document.getElementById('segTradeSide')).display !== 'none',
  }));
  ok(i1.modo === 'HEDGE' && i1.papelVisible, 'al pulsar HEDGE el motor cambia y aparece el papel de la orden');

  console.log('\n▸ J) Con una posición abierta, el cambio se rechaza como en el exchange');
  await page.$eval('#sizeInput', (el) => { el.value = 15; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#btnLong');
  await espera(320);
  const j = await page.evaluate(async () => {
    document.querySelector('#segPosMode [data-pmode="ONE_WAY"]').click();
    await new Promise((r) => setTimeout(r, 280));
    return {
      modo: TE.state.modoPosicion,
      marcado: ((document.querySelector('#segPosMode .seg-btn.active') || {}).dataset || {}).pmode || 'ninguno',
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '),
      log: [...document.querySelectorAll('#logList .log-line')].slice(-1)[0].textContent.replace(/\s+/g, ' '),
      vivas: TE.posiciones().length,
    };
  });
  ok(j.modo === 'HEDGE' && j.vivas === 1, `el modo NO cambia con una posición abierta (${j.modo}, ${j.vivas} viva(s))`);
  ok(j.marcado === 'HEDGE', `y el segmentado sigue marcando el modo REAL, no el que se intentó (${j.marcado})`);
  ok(/200014/.test(j.log), 'el registro cita el código del exchange: «…200014…»');
  ok(/abierta/.test(j.toasts), 'y el aviso en pantalla dice por qué');

  console.log('\n▸ K) Dos direcciones a la vez, y la tarjeta deja llegar a la otra');
  const k = await page.evaluate(async () => {
    const ref = App.currentPrice();
    document.getElementById('sizeInput').value = 10;
    document.getElementById('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnShort').click();                 // OPEN en el otro lado (hedge)
    await new Promise((r) => setTimeout(r, 320));
    const vivas = TE.posiciones();
    const pS = document.getElementById('segPosLado');
    return {
      vivas: vivas.length, lados: vivas.map((p) => p.side),
      segVisible: pS && getComputedStyle(pS).display !== 'none',
      botones: pS ? [...pS.querySelectorAll('.seg-btn')].map((b) => b.textContent.trim()) : [],
      otra: (document.getElementById('posOtroLado') || {}).textContent || '',
      otraVisible: document.getElementById('posOtroLado').style.display !== 'none',
      tag: document.getElementById('posSide').textContent,
      contador: document.getElementById('tabPosCount').textContent,
      entrada: document.getElementById('posEntry').textContent,
      entradaCorta: vivas.find((p) => p.side === 'short') ? vivas.find((p) => p.side === 'short').entryPrice : null,
      lineas: (window.CM && CM._priceLines ? CM._priceLines.length : -1),
      undefined: /undefined|NaN/.test(document.getElementById('posOtroLado').textContent),
    };
  });
  ok(k.vivas === 2 && k.lados.includes('long') && k.lados.includes('short'),
    `la orden contraria abrió su propia posición con el modo hedge (${k.lados.join(' + ')})`);
  ok(k.segVisible && k.botones.join('/') === 'LONG/SHORT', 'la tarjeta de posición ofrece los dos lados');
  ok(k.otraVisible && !k.undefined && /LONG|SHORT/.test(k.otra),
    `y resume la dirección no mostrada en una línea: «${k.otra.trim().slice(0, 84)}»`);
  ok(k.contador === '2', `el contador de la pestaña cuenta las dos (${k.contador})`);

  await page.click('#segPosLado [data-lado="short"]');
  await espera(280);
  const k2 = await page.evaluate(() => ({
    tag: document.getElementById('posSide').textContent,
    activa: App.posicionActiva() ? App.posicionActiva().side : null,
    entrada: document.getElementById('posEntry').textContent,
    lineas: (window.CM && CM._priceLines ? CM._priceLines.length : -1),
    precioLineas: (window.CM && CM._priceLines ? CM._priceLines.map((l) => l && l.priceIndex && l.priceIndex.price).filter((x) => Number.isFinite(x)) : []),
  }));
  ok(k2.activa === 'short' && /SHORT/.test(k2.tag), `al elegir SHORT la tarjeta se le pasa a esa dirección (${k2.tag})`);
  ok(k2.lineas > 0, `el gráfico conserva líneas de nivel con las dos posiciones vivas (${k2.lineas})`);

  console.log('\n▸ L) «Cerrar todo» cierra las dos');
  const l = await page.evaluate(async () => {
    const antes = TE.posiciones().map((p) => p.side);
    document.getElementById('btnFlatten').click();
    await new Promise((r) => setTimeout(r, 360));
    return {
      antes, despues: TE.posiciones().length,
      tag: document.getElementById('posSide').textContent,
      contador: document.getElementById('tabPosCount').textContent,
      cierres: [...document.querySelectorAll('#logList .log-line')].map((x) => x.textContent).filter((x) => /cerrada|Por|TAKE|manual/i.test(x)).length,
      otra: document.getElementById('posOtroLado').style.display,
      seg: getComputedStyle(document.getElementById('segPosLado')).display,
    };
  });
  ok(l.antes.length === 2 && l.despues === 0, `de ${l.antes.join('+')} a ninguna posición viva`);
  ok(/FLAT/.test(l.tag) && l.contador === '0', `la tarjeta y el contador vuelven a FLAT (${l.tag} · ${l.contador})`);
  ok(l.otra === 'none' && l.seg === 'none', 'y desaparecen la línea de la otra dirección y el conmutador de lado (no queda ruido)');

  console.log('\n▸ M) «Abrir/Cerrar» cambia el papel de la orden');
  const m = await page.evaluate(async () => {
    document.getElementById('sizeInput').value = 10;
    document.getElementById('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnLong').click();                          // abre LONG
    await new Promise((r) => setTimeout(r, 300));
    const conLong = TE.posiciones().map((p) => p.side).join('+');
    document.querySelector('#segTradeSide [data-tside="close"]').click();
    await new Promise((r) => setTimeout(r, 120));
    // «Cerrar» cierra la posición contraria ENTERA: el tamaño es un tope, así que se pide el 100 %
    // (dejarlo en 10 % cerraría un diezmo y el aserto de abajo mentiría sobre lo que hace CLOSE).
    document.getElementById('sizeInput').value = 100;
    document.getElementById('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
    const papel = App.tradeSide;
    document.getElementById('btnShort').click();                         // SHORT con CLOSE ⇒ cierra la LONG
    await new Promise((r) => setTimeout(r, 320));
    return {
      conLong, papel, despues: TE.posiciones().map((p) => p.side).join('+') || 'ninguna',
      toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '),
    };
  });
  ok(m.conLong === 'long', 'primero hay una LONG abierta');
  ok(m.papel === 'close', 'el segmentado de papel llega al formulario («Cerrar»)');
  ok(m.despues === 'ninguna', `la venta con «Cerrar» liquidó la LONG y NO abrió una corta (${m.despues})`);
  ok(/CERRARÁ|cerrar/i.test(m.toast), 'y el aviso dice lo que va a hacer este formulario');

  console.log('\n▸ N) Salud');
  const n = await page.evaluate(() => {
    const card = document.getElementById('orderCard');
    const cuerpo = card.querySelector('.card-body');
    return { fuera: cuerpo.scrollWidth - cuerpo.clientWidth, desborda: card.classList.contains('desborda') };
  });
  // El desborde horizontal de la tarjeta es el de `.grid-2` (19 px, preexistente y reportado a
  // propósito: arreglarlo mueve medidas de otras seis suites). Aquí solo interesa que la fila nueva
  // NO sume, así que se compara contra ese número en lugar de exigir 0.
  ok(n.fuera <= 19, `la fila del modo no añade desborde horizontal a la tarjeta (${n.fuera} px; la línea de 19 px es la de .grid-2, previa)`);
  // Solo tamaño, sin `isMobile`: cambiar la emulación de dispositivo hace que puppeteer
  // RECARGUE la página, y el recargo no termina con la interceptor de red de esta suite.
  await page.setViewport({ width: 390, height: 844 });
  await espera(500);
  const n2 = await page.evaluate(() => {
    const cuerpo = document.getElementById('orderCard').querySelector('.card-body');
    return { recorte: cuerpo.scrollHeight - cuerpo.clientHeight, plegado: !document.getElementById('orderAvanzado').offsetParent };
  });
  ok(n2.plegado && n2.recorte <= 0,
    `en el teléfono el reposo sigue entrando entero (avanzado plegado: ${n2.plegado}, recorte ${n2.recorte} px) —por eso la fila vive dentro de «Avanzado»—`);
  ok(errs.length === 0, `sin errores de JavaScript en toda la sesión (${errs.length})${errs.length ? ' → ' + errs.slice(0, 2).join(' ⧸ ') : ''}`);

  console.log('\n' + '─'.repeat(62));
  console.log(`Modo hedge: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ LONG y SHORT conviven con su propio margen, sus niveles y su funding, y no se puede cambiar de modo a traición.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
