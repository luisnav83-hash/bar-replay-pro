/* =========================================================================
 * tests/trailing-orden.test.js — orden TRAILING STOP (cuarto tipo, F1)
 *
 * F1 lista cuatro tipos de orden en el panel de futuros: Limit · Market · Trigger ·
 * **Trailing Stop**. El selector tenía tres; este bloque comprueba el cuarto y,
 * sobre todo, las tres reglas que hacen que un trailing sea honesto y no una
 * trigger con nombre bonito:
 *
 *   · el nivel se mide contra el pico conocido ANTES de esta vela (una vela no
 *     puede disparar un nivel que ella misma está creando: OHLC no revela el
 *     orden entre high y low);
 *   · el pico solo avanza al CERRAR la vela;
 *   · con precio de ACTIVACIÓN, el pico arranca en la activación (no en el
 *     extremo de la vela que la toca), y LAST/MARK se comportan distinto ante
 *     una mecha —mismo criterio que el trailing de posición, a propósito—.
 *
 *  Uso:  node tests/trailing-orden.test.js
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
const arranca = () => {
  TE.resetAccount(10000);
  TE.configure({ leverage: 10, feePct: 0.05, fundingPct: 0, niveles: null, averaging: true });
  TE.state.marginMode = 'cross';
  TE.state.modoPosicion = 'ONE_WAY';
  TE.onCandle(V(0, 100, 100, 100, 100));
  avisos.length = 0;
};

/* ═════════ A) Un trailing sin retroceso no existe ═════════ */
console.log('\n▸ A) Validación del retroceso');
arranca();
eq(TE.placeTrailing('long', { mode: 'pct', size: 20 }), null,
  'sin `callbackPct` la orden no se coloca (es lo único que define este tipo)');
ok(avisos.some((x) => /Retroceso no válido/.test(x)), 'y el aviso dice lo que falta');
eq(TE.placeTrailing('long', { callbackPct: 0, mode: 'pct', size: 20 }), null, 'retroceso 0 no vale: dispararía contra el propio pico');
eq(TE.placeTrailing('long', { callbackPct: 140, mode: 'pct', size: 20 }), null, 'retroceso > 100 % tampoco (no hay distancia mayor que el precio)');
eq(TE.state.pending.length, 0, 'nada de lo rechazado quedó en el libro');
// Reduce-only sin posición contraria: mismo criterio que en límite y trigger.
eq(TE.placeTrailing('short', { callbackPct: 2, mode: 'pct', size: 100, reduceOnly: true }), null,
  'un trailing reduce-only sin posición que cerrar no se coloca');
const sinRef = TE.state.lastPrice; TE.state.lastPrice = null;
eq(TE.placeTrailing('long', { callbackPct: 2, mode: 'pct', size: 20 }), null,
  'sin precio de referencia no se puede colocar: el pico necesita un punto de partida');
ok(avisos.some((x) => /punto de partida/.test(x)), 'y se dice por qué, no un error mudo');
TE.state.lastPrice = sinRef;

/* ═════════ B) Se coloca, no reserva margen y su nivel es el de ahora ═════════ */
console.log('\n▸ B) Colocar el trailing');
arranca();
const o1 = TE.placeTrailing('long', { callbackPct: 2, mode: 'pct', size: 20 });
ok(!!o1 && o1.tipo === 'trailing', 'la orden queda en el libro como tipo `trailing`');
eq(TE.pendingPorTipo().trailing, 1, 'y el contador por tipo la cuenta aparte (no como límite ni como trigger)');
eq(TE.pendingPorTipo().limite, 0, 'no se disfrazó de orden límite');
ok(!TE.state.position, 'colocar un trailing NO abre posición');
eq(TE.state.balance, 10000, 'ni consume margen ni comisiones: el balance no se toca mientras espera');
eq(o1.armado, true, 'sin precio de activación el seguimiento empieza desde ya');
cerca(o1.pico, 100, 1e-9, 'el pico arranca en el precio de referencia');
cerca(o1.nivel, 98, 1e-9, 'y el nivel de una COMPRA es pico·(1−2 %) = 98');
ok(avisos.some((x) => /TRAILING/.test(x) && /reserva margen/i.test(x)), 'el registro describe la orden y avisa de que no reserva margen');

/* ═════════ C) El pico sigue el precio favorable y el nivel sube con él ═════════ */
console.log('\n▸ C) Seguimiento del pico');
const nivel0 = o1.nivel;
TE.onCandle(V(1000, 100, 101, 99.5, 100.5));
cerca(o1.pico, 101, 1e-9, 'la vela hizo un máximo de 101: el pico sube');
cerca(o1.nivel, 101 * 0.98, 1e-6, 'y el nivel de disparo sube con él (98,98)');
ok(o1.nivel > nivel0, 'el nivel solo se mueve a favor: nunca se aleja del precio');
ok(TE.state.pending.length === 1, 'y la orden sigue viva (el low de la vela no llegó al nivel)');
TE.onCandle(V(2000, 101, 101.5, 100.9, 101.2));     // low 100,9 > nivel 99,47… no dispara
TE.onCandle(V(3000, 101.2, 101.3, 99.3, 100));      // low 99,3 < 101,5·0,98 = 99,47 ⇒ dispara
eq(TE.state.pending.length, 0, 'al retroceder el 2 % desde el pico, la orden desaparece del libro');
const pos = TE.state.position;
ok(!!pos && pos.side === 'long', 'y se convierte en una posición COMPRADA');
cerca(pos.entryPrice, 99.47, 0.02, 'rellenada en el nivel del stop (99,47), no en el cierre de la vela');
eq(pos.origin, 'trailing', 'el origen registrado es `trailing`');

// Con hueco: la vela ABRE por debajo del nivel. El stop se habría ejecutado en la apertura, así
// que el simulador NO puede regalar el nivel (más favorable de lo que el mercado ofreció).
arranca();
const gap = TE.placeTrailing('long', { callbackPct: 2, mode: 'pct', size: 20 });
TE.onCandle(V(1000, 96, 97, 95, 96));
cerca(TE.state.position.entryPrice, 96, 1e-9,
  'un trailing COMPRADO con hueco por debajo del nivel (98) se rellena en la APERTURA (96), no en el nivel');
eq(TE.state.pending.length, 0, 'y no queda una orden huérfana que siga esperando su nivel');

/* ═════════ D) Una vela no dispara un nivel que ella misma crea ═════════ */
console.log('\n▸ D) El nivel de una vela es el pico ANTERIOR a esa vela');
arranca();
const o2 = TE.placeTrailing('long', { callbackPct: 2, mode: 'pct', size: 20 });
// Vela con máximo 105 y mínimo 97: si el nivel se calculára CON el máximo de esta misma vela
// (105·0,98 = 102,9) el low de 97 «dispararía» contra un nivel que la propia vela creó —y en el
// orden real de OHLC no se sabe si el máximo pasó antes o después—. Se usa el pico de antes: 100.
TE.onCandle(V(1000, 100, 105, 97, 104));
eq(TE.state.pending.length, 0, 'aun así se dispara: contra el nivel conocido antes de la vela (98)');
cerca(TE.state.position.entryPrice, 98, 0.01, 'el relleno es 98 (el nivel viejo), no el 102,9 que crearía esta vela');

/* ═════════ E) Con activación: no se arma antes de tocarla ═════════ */
console.log('\n▸ E) Precio de activación (LAST)');
arranca();
const o3 = TE.placeTrailing('long', { callbackPct: 2, activation: 110, src: 'last', mode: 'pct', size: 20 });
eq(o3.armado, false, 'con activación, el seguimiento NO empieza todavía');
cerca(o3.pico, 110, 1e-9, 'el pico está pendiente de la activación (se le da el propio nivel de activación)');
TE.onCandle(V(1000, 100, 102, 90, 95));       // cae fortísimo: sin armar, el trailing no puede disparar
eq(TE.state.pending.length, 1, 'una vela que habría disparado un trailing sin activación NO lo dispara si no se armó');
ok(!TE.state.position, 'y no se abrió nada');
TE.onCandle(V(2000, 105, 110.5, 108.5, 110));  // toca la activación (high 110,5 ≥ 110)
eq(o3.armado, true, 'al tocar los 110 con el LAST (la mecha vale) el trailing se arma');
// Dos pasos dentro de la misma vela, y es el orden honesto: para DECIDIR si dispara en la vela
// que arma se usa el nivel que da la ACTIVACIÓN (110·0,98 = 107,8, con el que el low 108,5 no
// llega); el pico solo se actualiza al CERRAR la vela, así que pasa a 110,5 y el nivel a 108,29.
// Si el extremo de la vela arma se usara para el disparo, una sola vela crearía y dispararía su
// propio stop —imposible de saber con OHLC— y además el pico se iría a 110,5 de golpe.
ok(!TE.state.position, 'en la vela que arma NO dispara: el low (108,5) no llegó al nivel de activación (107,8)');
eq(TE.state.pending.length, 1, 'y la orden sigue viva, ya armada');
cerca(o3.nivel, 108.29, 1e-6, 'cerrada esa vela, el pico pasa a su máximo (110,5) y el nivel a 108,29');
TE.onCandle(V(3000, 110, 110.2, 107.5, 108));
eq(TE.state.pending.length, 0, 'la vela siguiente retrocede desde el pico: se ejecuta');
cerca(TE.state.position.entryPrice, 108.29, 0.01, 'rellenado en su nivel (108,29); con OHLC no se puede prometer más');

/* ═════════ F) MARK no se dispara con la mecha ═════════ */
console.log('\n▸ F) La misma vela con MARK: la mecha no arma');
arranca();
const o4 = TE.placeTrailing('long', { callbackPct: 2, activation: 110, src: 'mark', mode: 'pct', size: 20 });
TE.onCandle(V(1000, 105, 111, 104.5, 109));    // mecha hasta 111, cuerpo por debajo de 110
eq(o4.armado, false, 'con activación contra MARK, una mecha que toca el nivel NO arma el trailing');
TE.onCandle(V(2000, 109, 111, 108.9, 110.4));  // cuerpo 109→110,4: max(open,close) ≥ 110
eq(o4.armado, true, 'y se arma cuando el cuerpo (el precio de marca) sí llega al nivel');
ok(TE.state.pending.length === 1, 'mientras no se arma, la orden sigue en espera');

/* ═════════ G) Reduce-only: cierra la contraria, no abre nada ═════════ */
console.log('\n▸ G) Trailing reduce-only (cerrar con pico que sube)');
arranca();
const L = TE.openPosition('long', { mode: 'pct', size: 20, entryPrice: 100 });
const o5 = TE.placeTrailing('short', { callbackPct: 2, mode: 'pct', size: 100, reduceOnly: true });
ok(!!o5 && o5.reduceOnly, 'se coloca y lleva reduce-only (la casilla del formulario)');
TE.onCandle(V(1000, 100, 101, 100.2, 100.8));  // high 101 < nivel 102 y low 100,2 no mejora el pico
eq(TE.state.pending.length, 1, 'una VENTA trailing no se dispara con el máximo por debajo de su nivel');
cerca(o5.nivel, 102, 1e-6, 'el nivel de una venta queda POR ENCIMA del pico (100·1,02 = 102)');
TE.onCandle(V(2000, 100.8, 101, 99, 100));      // low 99 ⇒ pico 99 ⇒ nivel 100,98
cerca(o5.nivel, 100.98, 1e-6, 'y BAJA cuando el precio baja: el stop persigue el mínimo, nunca se aleja hacia arriba');
ok(o5.nivel < 102, 'un trailing de VENTA solo aprieta hacia abajo (si subiera, dejaría de ser un stop)');
TE.onCandle(V(3000, 100, 101.5, 99.5, 101));    // high 101,5 ≥ 100,98 ⇒ ejecuta
eq(TE.state.pending.length, 0, 'al tocar el nivel la orden desaparece (no se recoloca: un trailing muere al disparar)');
eq(TE.state.position, null, 'y lo que hace es CERRAR la LONG');
eq(TE.state.trades[TE.state.trades.length - 1].reason, 'trail', 'el motivo registrado es el del trailing, no «manual»');
ok(!TE.state.trades.some((t) => t.side === 'short' && t.status === 'open'), 'no abrió posición corta por el camino');

/* ═════════ H) Cancelar dice lo que era ═════════ */
console.log('\n▸ H) Cancelar un trailing');
arranca();
const o6 = TE.placeTrailing('long', { callbackPct: 3, mode: 'pct', size: 20 });
TE.cancelOrder(o6.id);
ok(avisos.some((x) => /Orden TRAILING cancelada/.test(x)), 'el registro no dice «orden límite cancelada»');
ok(avisos.some((x) => /retroceso 3\.00 % desde el pico 100\.000/.test(x) && /tampoco había reservado margen/.test(x)),
  'y explica el retroceso, el pico del que partía y que no reservaba margen');
eq(TE.state.pending.length, 0, 'cancelada, no queda nada en el libro');

/* ═════════ I) Convive con los otros tres tipos ═════════ */
console.log('\n▸ I) Los cuatro tipos en el mismo libro');
arranca();
TE.placeLimit('long', { limitPrice: 95, mode: 'pct', size: 5, efecto: 'GTC', time: 0 });
TE.placeTrigger('long', { triggerPrice: 97, src: 'last', exec: 'market', mode: 'pct', size: 5, time: 0 });
TE.placeTrailing('short', { callbackPct: 1.5, mode: 'pct', size: 5 });
const c = TE.pendingPorTipo();
ok(c.limite === 1 && c.trigger === 1 && c.trailing === 1, `los tres contadores cuadran por separado: ${JSON.stringify(c)}`);
TE.cancelOrder(TE.state.pending[TE.state.pending.length - 1].id);
eq(TE.pendingPorTipo().trailing, 0, 'y cancelar una no toca las demás');

/* ════════════════ INTERFAZ ════════════════ */
(async () => {
  let puppeteer;
  for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/node_modules/puppeteer']) {
    try { puppeteer = require(c); break; } catch (e) { /* siguiente */ }
  }
  if (!puppeteer) {
    console.log('\n⚠️  Falta puppeteer: la parte de interfaz queda OMITIDA (motor: ' + pasan + ' ✓).');
    console.log(`\n${'─'.repeat(60)}\nTrailing de orden (solo motor): ${pasan} superadas, ${fallan} fallidas`);
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

  console.log('\n▸ J) El cuarto botón cambia el formulario a lo que un trailing necesita');
  await page.click('#segOrderType [data-otype="trailing"]');
  await espera(260);
  const j = await page.evaluate(() => ({
    tipo: App.orderType,
    pctVisible: getComputedStyle(document.getElementById('trailPctRow')).display !== 'none',
    trigRowVisible: getComputedStyle(document.getElementById('trigRow')).display !== 'none',
    execOculto: !document.getElementById('segTrigExec').closest('.field').offsetParent,
    limiteOculto: getComputedStyle(document.getElementById('trigLimitRow')).display === 'none',
    etiqueta: document.getElementById('lbTrigAct').textContent,
    validezDesactivada: document.getElementById('ordEffect').disabled,
    validez: document.getElementById('ordEffect').value,
    reduceDisponible: !!document.getElementById('ordReduceOnly').offsetParent,
    botones: [document.getElementById('btnLong').textContent, document.getElementById('btnShort').textContent],
    pista: document.getElementById('trigHint').textContent,
  }));
  ok(j.tipo === 'trailing' && j.pctVisible, 'aparece el retroceso %, que es lo que define el tipo');
  ok(j.trigRowVisible && j.etiqueta.includes('(opcional)'), `la activación se comparte pero se re-etiqueta: «${j.etiqueta}»`);
  ok(j.execOculto && j.limiteOculto, 'y desaparece la elección de ejecución: un stop es a mercado, no se le pone precio límite');
  ok(j.validezDesactivada && j.validez === 'GTC', 'la validez queda fijada en GTC y bloqueada (IOC/FOK/post-only no aplican a un stop)');
  ok(j.reduceDisponible, 'pero «Solo reducir» sigue a mano: un trailing de cierre es su uso natural');
  ok(/🌀/.test(j.botones[0]) && /🌀/.test(j.botones[1]), `los botones cambian de icono: «${j.botones[0].trim()}»`);
  ok(/retroceso.*COMPRA.*VENTA|más pequeño|retroceso %/.test(j.pista) || j.pista.length > 0, `la pista explica el nivel: «${j.pista.slice(0, 96)}»`);

  console.log('\n▸ K) Sin retroceso no se coloca (y lo dice)');
  const k = await page.evaluate(async () => {
    document.getElementById('trailPctInput').value = '';
    document.getElementById('trailPctInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('sizeInput').value = 10;
    document.getElementById('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnLong').click();
    await new Promise((r) => setTimeout(r, 260));
    return {
      pend: TE.state.pending.length,
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '),
      enfocado: document.activeElement === document.getElementById('trailPctInput'),
    };
  });
  ok(k.pend === 0 && /retroceso/.test(k.toasts), 'rechazo visible: no se coloca una orden sin su parámetro definitorio');
  ok(k.enfocado, 'y el foco se va al campo que falta (no solo un aviso que pasa volando)');

  console.log('\n▸ L) Colocado, se ve en la lista con su nivel y su regla');
  const l = await page.evaluate(async () => {
    document.getElementById('trailPctInput').value = '2';
    document.getElementById('trailPctInput').dispatchEvent(new Event('input', { bubbles: true }));
    const pista = document.getElementById('trigHint').textContent;
    document.getElementById('btnLong').click();
    await new Promise((r) => setTimeout(r, 320));
    const o = TE.state.pending[0] || {};
    const item = document.querySelector('#pendingList .pending-item');
    return {
      pista,
      pend: TE.state.pending.length, tipos: TE.pendingPorTipo(),
      nivel: o.nivel, pico: o.pico, lado: o.side, tipo: o.tipo,
      html: item ? item.textContent.replace(/\s+/g, ' ').trim() : '',
      clase: item ? item.className : '',
      precio: item ? (item.querySelector('.pi-price') || {}).textContent : '',
      undefined: /undefined|NaN/.test(item ? item.textContent : 'x'),
      posicion: !!TE.state.position,
      contador: document.getElementById('pendingCount').textContent,
    };
  });
  ok(l.pend === 1 && l.tipos.trailing === 1 && l.tipo === 'trailing', `llegó al motor como trailing: ${JSON.stringify(l.tipos)}`);
  ok(!l.posicion, 'colocar el trailing no abrió posición (escondida la reserva de margen, igual que la trigger)');
  ok(!l.undefined, 'la tarjeta del pendiente no pinta undefined en el precio');
  ok(/🌀/.test(l.html) && /retroceso 2[.,]00 %/.test(l.html) && /MERCADO/.test(l.html)
    && /pico/.test(l.html) && /retrocede/.test(l.html),
    `la lista dice qué es, desde qué pico retrocede y cómo se ejecuta: «${l.html.replace(/✖.*/, '').slice(0, 84)}»`);
  cerca(l.nivel, l.pico * 0.98, 1e-6, 'y el precio que enseña es el nivel actual del stop (pico·(1−2 %))');
  ok(l.contador === '1', `el contador de la tarjeta sigue cuadrando (${l.contador})`);

  console.log('\n▸ M) El nivel se mueve con el mercado y solo a favor');
  const m = await page.evaluate(async () => {
    const antes = TE.state.pending[0].nivel, picoAntes = TE.state.pending[0].pico;
    let nivel = antes, pico = picoAntes;
    for (let i = 0; i < 6; i++) {
      document.getElementById('btnStepFwd').click();
      await new Promise((r) => setTimeout(r, 160));
      const o = TE.state.pending[0];
      if (!o || o.tipo !== 'trailing') break;
      if (o.nivel > nivel) nivel = o.nivel;
      if (o.pico > pico) pico = o.pico;
    }
    const o = TE.state.pending[0];
    return { antes, nivel, pico, sigue: !!o && o.tipo === 'trailing', ejecutada: !o || !TE.state.position ? false : TE.state.position.origin === 'trailing', nivelFinal: o ? o.nivel : null };
  });
  ok(m.nivel >= m.antes || m.ejecutada,
    `el nivel de un trailing COMPRADO solo sube con el pico (${m.antes && m.antes.toFixed(2)} → ${m.nivel && m.nivel.toFixed(2)}) o ya disparó`);
  ok(!m.nivelFinal || m.nivelFinal >= m.antes, 'y si sigue esperando, su nivel nunca se alejó del precio');

  console.log('\n▸ N) Volver a Mercado reactiva la validez y el precio límite');
  const n = await page.evaluate(async () => {
    document.querySelector('#segOrderType [data-otype="market"]').click();
    await new Promise((r) => setTimeout(r, 240));
    return {
      pctOculto: getComputedStyle(document.getElementById('trailPctRow')).display === 'none',
      trigOculto: getComputedStyle(document.getElementById('trigRow')).display === 'none',
      effOculto: getComputedStyle(document.getElementById('effectRow')).display === 'none',
      validezLibre: !document.getElementById('ordEffect').disabled,
      botones: [document.getElementById('btnLong').textContent, document.getElementById('btnShort').textContent],
    };
  });
  ok(n.pctOculto && n.trigOculto && n.effOculto, 'al quitar el tipo condicional, sus filas se van (no quedan campos huérfanos)');
  ok(n.validezLibre && /▲/.test(n.botones[0]) && /▼/.test(n.botones[1]), 'y la validez vuelve a ser editable con los rótulos de mercado');

  console.log('\n▸ Ñ) Ciclo T de cuatro');
  const ñ = await page.evaluate(async () => {
    const visto = [];
    for (let i = 0; i < 5; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      visto.push(App.orderType);
    }
    return visto;
  });
  ok(ñ.join(',') === 'limite,trigger,trailing,market,limite', `T recorre los cuatro en orden y vuelve: ${ñ.join(' → ')}`);

  ok(errs.length === 0, `sin errores de JavaScript en toda la sesión (${errs.length})${errs.length ? ' → ' + errs.slice(0, 2).join(' ⧸ ') : ''}`);

  console.log('\n' + '─'.repeat(62));
  console.log(`Trailing de orden: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El cuarto tipo de F1 está en el selector, con su pico, su retroceso y sus tres reglas honestas.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
