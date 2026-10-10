/* =========================================================================
 * tests/futuros.test.js — Las reglas de los futuros de Bitunix, en el motor.
 *
 *   node tests/futuros.test.js
 *
 * Cubre lo que el estudio `docs/estudio-futuros-bitunix.md` dice que hace Bitunix al operar
 * perpetuos y que antes no estaba (o estaba de otra manera): niveles de riesgo y margen de
 * mantenimiento, precio de liquidación y su «no tiene liquidación», disparo de SL/TP contra mark o
 * contra last, ejecución market o limit del nivel, validez de las órdenes (GTC/IOC/FOK/POST_ONLY),
 * reduce-only, órdenes trigger y el funding de 8 h con el signo de cada lado.
 *
 * SIN NAVEGADOR y con VELAS SINTÉTICAS a propósito: cada bloque coloca la vela que toca el nivel o
 * la que no lo toca, así que un rojo aquí significa «la regla está mal», no «la serie de hoy no dio
 * el caso» (que es lo que hace frágiles a las suites que operan sobre datos reales).
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pasan = 0, fallan = 0;
const fallos = [];
const ok = (c, m) => { if (c) { pasan++; console.log('  ✓ ' + m); } else { fallan++; fallos.push(m); console.error('  ✗ ' + m); } };
const near = (a, e, tol, m) => ok(Number.isFinite(a) && Math.abs(a - e) <= tol, `${m} (esperado ≈${e} ±${tol}, obtenido ${a})`);
const eq = (a, e, m) => ok(Object.is(Math.round(+a * 1e8) / 1e8, Math.round(+e * 1e8) / 1e8) || a === e, `${m} (esperado ${e}, obtenido ${a})`);
const seccion = (n) => console.log('\n▸ ' + n);

/* Shim mínimo de navegador para cargar los módulos tal cual (misma convención que logic.test.js). */
const shim = {
  console, Math, JSON, Date, Array, Object, Number, String, Boolean, Error, isNaN, parseFloat, parseInt,
  setTimeout, clearTimeout, performance: { now: () => Date.now() }, devicePixelRatio: 1,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
  addEventListener() {}, dispatchEvent: () => true,
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
  localStorage: null,
  fetch: () => Promise.reject(new Error('sin red')),
};
shim.window = shim; shim.self = shim;
const ctx = vm.createContext(shim);
['js/utils.js', 'js/tradingEngine.js'].forEach((rel) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), ctx, { filename: rel });
});
const { U, TE } = shim;

/* La tabla que documenta la propia API (get_position_tiers): nivel 1 hasta 50 000, nivel 2 hasta 200 000. */
const TABLA = [
  { level: 1, startValue: 0, endValue: 50000, leverage: 125, maintenanceMarginRate: 0.004 },
  { level: 2, startValue: 50000, endValue: 200000, leverage: 100, maintenanceMarginRate: 0.005 },
];
const H = 3600000;
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);          // medianoche UTC: hay liquidación de funding a las 8 y a las 16
const arranque = (capital = 10000) => {
  TE.configure({ niveles: TABLA, fundingPct: 0, feePct: 0, slFirst: 'worst', makerFeePct: null, efecto: 'GTC' });
  TE.resetAccount(capital);
  TE.state.marginMode = 'isolated';
};
const vela = (t, o, h, l, c) => ({ time: t, open: o, high: h, low: l, close: c, volume: 1 });

/* ═══ A · NIVELES DE RIESGO (F8) ═══ */
seccion('A · La tabla de niveles: qué nivel ocupa un notional y qué techo impone');
ok(TE.nivel(10000).level === 1 && TE.nivel(10000).maintenanceMarginRate === 0.004,
   `10 000 de notional cae en el nivel 1 con MMR ${TE.nivel(10000).maintenanceMarginRate} (fueraDeTabla ${TE.nivel(10000).fueraDeTabla})`);
ok(TE.nivel(100000).level === 2 && TE.nivel(100000).maintenanceMarginRate === 0.005,
   '100 000 cae en el nivel 2, con MMR mayor: a más tamaño, más mantenimiento');
ok(TE.nivel(9e6).fueraDeTabla === true && TE.nivel(9e6).maintenanceMarginRate === 0.005,
   'por encima de lo MEDIDO en la documentación se conserva la última tasa y se señala `fueraDeTabla`, en vez de inventar tramos');
TE.configure({ niveles: null });
ok(TE.nivel(100000) === null && TE.margenMantenimiento({ entryPrice: 100, qty: 100, notional: 10000 }) === 0,
   'sin tabla no hay margen de mantenimiento: el modelo clásico sigue siendo un caso particular, no algo borrado');
TE.configure({ niveles: TABLA });
{
  const r = TE.apalancamientoPermitido(100000, 200);
  ok(r.leverage === 100 && r.recortado === true && r.max === 100,
   `pedir 200× con 100 000 de notional se RECORTA a ${r.leverage}× (el nivel 2 no da más): el apalancamiento pedido es un techo, no un derecho`);
  const d = TE.apalancamientoPermitido(10000, 100);
  ok(d.leverage === 100 && d.recortado === false, 'y 100× en el nivel 1 (techo 125×) no se recorta');
}

/* ═══ B · LIQUIDACIÓN CON MARGEN DE MANTENIMIENTO (F6) ═══ */
seccion('B · Liquidación: Available Margin = Initial Margin − PnL cae al Maintenance Margin');
arranque();
{
  // 100 % del capital a 10× ⇒ notional 100 000 (nivel 2, MMR 0,005), qty 1000, margen 10 000.
  const p = TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, leverage: 10, time: T0 });
  const MM = 100 * 1000 * 0.005;
  near(TE.margenMantenimiento(p), MM, 1e-9, `mantenimiento = entrada·tamaño·MMR = 100·1000·0,005 = ${MM}`);
  near(TE.liquidationPrice(p), 100 - (10000 - MM) / 1000, 1e-6,
    `liquidación aislada = entrada − (margen − MM)/tamaño = ${TE.liquidationPrice(p).toFixed(2)} (con MM=0 saldrían 90,00)`);
  near(TE.liquidationPrice(p), 90.5, 1e-6, 'y el valor concreto es 90,50: el mantenimiento ACERCA la liquidación, no la aleja');
  const info = TE.liqInfo(p);
  ok(info.nivel === 2 && info.apalancamientoMax === 100 && info.sinNivel === false,
   `la carta sabe el nivel (${info.nivel}), el techo de apalancamiento (${info.apalancamientoMax}×) y que SÍ tiene precio de liquidación`);
  // El margen de mantenimiento se define sobre el precio de ENTRADA (F6), no sobre el actual.
  ok(Math.abs(TE.margenMantenimiento(p) - p.qty * 90.5 * 0.005) > 1,
   'el MM no se recalcula con el precio de la vela: F6 dice «Open Price · Size · MMR», y eso cambia el número');
  // La regla que decide ES «disponible < mantenimiento» (F6), no «ratio < MMR» (el porcentaje que se
  // pinta es otra magnitud: margen sobre VALOR actual, y el MM se define sobre el precio de entrada).
  const lq = TE.liquidationPrice(p);
  ok(TE.marginRate(p, lq + 0.01).enRiesgo === false && TE.marginRate(p, lq - 0.01).enRiesgo === true,
   `el criterio se voltea EXACTAMENTE en el precio de liquidación (${lq.toFixed(2)}): las dos reglas son coherentes entre sí`);
  const sr = TE.marginRate(p, 90.47);
  ok(sr.enRiesgo === true && sr.ratio > sr.mmr,
   `y a 90,47 divergen: F6 dice en riesgo (${sr.disponible.toFixed(0)} < ${sr.mantenimiento.toFixed(0)}) mientras el «Margin Rate» pintado (${(sr.ratio * 100).toFixed(3)} %) aún supera el MMR (${(sr.mmr * 100).toFixed(3)} %) — por eso el flag no puede derivarse del ratio`);
  ok(TE.marginRate(p, 99).enRiesgo === false, 'a 99 no hay riesgo, claro');
  // Y en cruzado el margen libre de la cuenta entra en la cuenta (ya lo hacía antes, se conserva).
  TE.state.marginMode = 'cross';
  const liqCruzada = TE.liquidationPrice(TE.state.position);
  ok(liqCruzada >= 90.5, `en cruzado, con saldo libre cero la liquidación coincide o se aleja (${liqCruzada.toFixed(2)} ≥ 90,50)`);
  TE.state.marginMode = 'isolated';
  const abierta = TE.onCandle(vela(T0 + H, 100, 101, 91, 100.5));
  ok(!abierta, 'a 91,00 todavía NO liquida (el nivel está en 90,50): el MM no adelanta el disparo por sí solo');
  const liq = TE.onCandle(vela(T0 + 2 * H, 90.8, 90.9, 90.0, 90.2));
  ok(liq && liq.reason === 'liq', `liquida al atravesar el nivel (motivo ${liq && liq.reason})`);
  near(liq.pnl, -(100 - 90.5) * 1000, 1e-4, 'la pérdida es hasta el precio de liquidación, no hasta vaciar el margen');
  ok(TE.state.balance > 0, `y sobra margen en la cuenta tras liquidar (${TE.state.balance.toFixed(2)}): se liquida AL tocar el mantenimiento`);
}
{
  // `liqPrice ≤ 0` de la API (F8): «sin precio de liquidación a la vista», no un cero que pintar.
  arranque();
  const p = TE.openPosition('long', { mode: 'pct', size: 10, entryPrice: 100, leverage: 1, time: T0 });
  TE.state.marginMode = 'cross';              // en aislado el margen libre no cuenta y sí hay nivel
  const info = TE.liqInfo(p);
  ok(info.precio === 0 && info.sinNivel === true,
   `con 1× y cuenta holgada el precio sale 0 y «sinNivel» es true (${info.precio}, ${info.sinNivel}): es el «liqPrice ≤ 0» de la API, que significa riesgo bajo`);
  const sigue = TE.onCandle(vela(T0 + H, 100, 100, 1, 2));
  ok(!sigue && !!TE.state.position, 'y una vela que se va a 1,00 NO liquida: no hay nivel que tocar');
  ok(info.mantenimiento > 0, `aunque el mantenimiento existe (${info.mantenimiento.toFixed(2)}) —lo que no existe es el precio al que se agota—`);
}

/* ═══ C · DISPARO CONTRA MARK O CONTRA LAST (F7 tpStopType/slStopType) ═══ */
seccion('C · El disparo: una mecha que toca el nivel cierra con `last« y NO cierra con »mark`');
for (const src of ['last', 'mark']) {
  arranque();
  const p = TE.openPosition('long', { mode: 'pct', size: 20, entryPrice: 100, sl: 90, leverage: 5, time: T0, slSrc: src });
  ok(p.slSrc === src, `posición con SL medido contra ${src.toUpperCase()}`);
  const tocada = TE.onCandle(vela(T0 + H, 100, 100.5, 89.4, 100.2));   // solo la MECHA toca 90
  if (src === 'last') ok(tocada && tocada.reason === 'sl', 'con LAST la mecha basta: el stop se dispara (89,40 < 90)');
  else ok(!tocada && !!TE.state.position, 'con MARK la mecha NO dispara: el cuerpo de la vela (100 → 100,2) no tocó el nivel');
  if (src === 'mark') {
    const cerrada = TE.onCandle(vela(T0 + 2 * H, 100.2, 100.4, 89, 89.5));   // el CUERPO cruza el nivel
    ok(cerrada && cerrada.reason === 'sl', 'y en cuanto el cuerpo cruza el nivel, el mark sí cierra');
  }
}

/* ═══ D · EJECUCIÓN DEL NIVEL: MARKET O LIMIT (F7 tpOrderType) ═══ */
seccion('D · TP con ejecución LÍMITE: al disparar se COLOCA un cierre, puede no rellenarse');
arranque();
{
  const p = TE.openPosition('long', { mode: 'pct', size: 20, entryPrice: 100, tp: 110, leverage: 5, time: T0,
    tpExec: 'limit', tpExecPrice: 110.4 });
  ok(p.tpExec === 'limit' && p.tpExecPrice === 110.4, 'el nivel lleva su tipo y su precio de ejecución');
  const noCierra = TE.onCandle(vela(T0 + H, 100, 110.6, 100, 110.2));    // toca el trigger, no llega al 110,4
  ok(!noCierra && !!TE.state.position, 'el trigger se alcanzó y la posición SIGUE ABIERTA: con ejecución límite puede no rellenarse');
  const pend = TE.state.pending.filter((o) => o.tipo === 'limite');
  ok(pend.length === 1 && pend[0].limitPrice === 110.4 && pend[0].reduceOnly === true,
   `lo que se colocó es una orden LÍMITE de cierre en ${pend[0] && pend[0].limitPrice} marcada reduce-only (${pend.length} pendiente(s))`);
  TE.onCandle(vela(T0 + 2 * H, 110.2, 110.3, 110, 110.25));             // no llega al límite
  ok(TE.state.pending.length === 1, 'una vela que no toca 110,40 deja la orden de cierre en espera (no se re-coloca)');
  TE.onCandle(vela(T0 + 3 * H, 110.2, 110.5, 110.1, 110.45));           // la cruza
  const cierre = TE.state.trades.find((t) => t.status !== 'open');
  ok(!TE.state.position && !!cierre, 'al cruzar el precio límite, el cierre se rellena y la posición termina');
  ok(cierre && cierre.reason === 'tp', `y el historial dice por qué cerró (${cierre && cierre.reason}): un TP ejecutado con límite sigue siendo un TP, no un cierre manual`);
  // Mover el nivel vuelve a permitir colocar la orden (el flag de «ya colocada» se reinicia).
  arranque();
  // El límite de cierre se pone lejos (115) para que la vela que dispara el TP nuevo no lo rellene
  // antes: si lo rellenara, la posición ya habría cerrado y no habría nada que reemplazar.
  const q = TE.openPosition('long', { mode: 'pct', size: 20, entryPrice: 100, tp: 110, leverage: 5, time: T0, tpExec: 'limit', tpExecPrice: 115 });
  TE.onCandle(vela(T0 + H, 100, 110.6, 100, 110.2));
  eq(TE.state.pending.length, 1, 'primera colocación (límite de cierre a 115, sin tocar)');
  TE.setTP(111);
  ok(q._tpLimitPlaced === false, 'modificar el TP reinicia el «ya coloqué mi orden»: Bitunix permite cambiar TP/SL hasta que ejecuta');
  TE.onCandle(vela(T0 + 2 * H, 111.2, 111.3, 111, 111.25));
  eq(TE.state.pending.length, 1, 'y al disparar el nivel nuevo la orden anterior se SUSTITUYE: en el libro no pueden quedar dos cierres del mismo TP (para eso está `modify_order`)');
  eq(TE.state.pending[0] && TE.state.pending[0].creada, T0 + 2 * H, 'la que queda es la del disparo nuevo, no la vieja');
  ok(TE.state.position && TE.state.position.qty === q.qty, 'y la posición sigue viva: el TP era límite y 115 no se ha tocado');
}

/* ═══ E · VALIDEZ DE LAS ÓRDENES (F7 effect) ═══ */
seccion('E · GTC · IOC · FOK · POST_ONLY sobre las órdenes límite');
{
  // Con `lastPrice` vacío, placeLimit devuelve null por «no hay precio de referencia» y los cuatro
  // asserts de abajo pasarían sin probar nada. Se siembra una vela plana primero.
  arranque();
  TE.onCandle(vela(T0, 100, 100, 100, 100));
  eq(TE.state.lastPrice, 100, 'referencia del motor sembrada a 100 (sin esto, los rechazos de abajo serían verdes gratis)');
  // POST_ONLY: si cruzaría, NO se coloca (es la única forma de asegurarse el maker).
  arranque();
  const cruzada = TE.placeLimit('long', { limitPrice: 105, mode: 'pct', size: 20, leverage: 5, time: T0, efecto: 'POST_ONLY' });
  ok(cruzada === null && !TE.state.position && TE.state.pending.length === 0,
   'POST_ONLY con el límite por ENCIMA del precio (cruzaría): rechazada, sin posición y sin pendiente');
  const descansando = TE.placeLimit('long', { limitPrice: 95, mode: 'pct', size: 20, leverage: 5, time: T0, efecto: 'POST_ONLY' });
  ok(descansando && TE.state.pending.length === 1 && descansando.efecto === 'POST_ONLY', 'POST_ONLY sin cruzar: descansa normal, con su efecto guardado en la orden');
  // IOC/FOK: lo que no está cruzado ahora no pasa la vela esperando.
  const ioc = TE.placeLimit('short', { limitPrice: 105, mode: 'pct', size: 20, leverage: 5, time: T0, efecto: 'IOC' });
  ok(ioc === null && TE.state.pending.length === 1, 'IOC sin cruzar: cancelada en el acto (no se añade a las pendientes)');
  const fok = TE.placeLimit('short', { limitPrice: 105, mode: 'pct', size: 20, leverage: 5, time: T0, efecto: 'FOK' });
  ok(fok === null && TE.state.pending.length === 1, 'FOK igual: todo-o-nada AHORA, y si no hay cruce, nada');
  // IOC cruzada se ejecuta ya (y ese fill es TAKER, porque cruza el libro).
  arranque();
  TE.configure({ feePct: 0.1, makerFeePct: null });
  const ya = TE.placeLimit('long', { limitPrice: 105, mode: 'pct', size: 20, leverage: 5, time: T0, efecto: 'IOC' });
  ok(!!TE.state.position && TE.state.pending.length === 0, 'IOC con el nivel cruzado: se ejecuta inmediatamente (ninguna pendiente)');
  ok(TE.state.position.entryPrice === 100, 'y se rellena al precio de referencia de la vela (100), no al del límite (105) —mejor precio para el comprador, como en un exchange—');
  // Rol maker/taker (F7 roleType en el histórico de fills): lo que llega cruzado es TAKER; lo que
  // descansa y se rellena después es MAKER. Sin `makerFeePct` medido los dos pagan lo mismo, y eso
  // es lo honesto: las tasas concretas de Bitunix por nivel de cuenta NO están medidas aquí.
  ok(TE.state.position.origin === 'market', 'un límite que llega cruzado se ejecuta como orden a mercado (taker)');
  near(TE.state.position.openFee, 10000 * 0.1 / 100, 1e-6,
    `y sin tasa de maker medida paga la configurada (${TE.state.position.openFee}) —no se inventa un 0,02 %—`);
  arranque(); TE.onCandle(vela(T0, 100, 100, 100, 100));
  TE.configure({ feePct: 0.1, makerFeePct: 0.02 });
  TE.placeLimit('long', { limitPrice: 95, mode: 'pct', size: 20, leverage: 5, time: T0 + H, efecto: 'POST_ONLY' });
  TE.onCandle(vela(T0 + 2 * H, 100, 100, 94.9, 95.2));
  ok(TE.state.position && TE.state.position.origin === 'limite', 'la que descansó se rellena como MAKER (llegó al libro antes que el precio)');
  near(TE.state.position.openFee, 10000 * 0.02 / 100, 1e-6,
    `y con makerFeePct puesto, ese relleno paga la de maker (${TE.state.position.openFee}) en vez de la de taker`);
}

/* ═══ F · REDUCE-ONLY (F7 reduceOnly) ═══ */
seccion('F · reduce-only: solo reduce, nunca abre ni invierte');
{
  arranque();
  ok(TE.openPosition('long', { mode: 'pct', size: 20, entryPrice: 100, leverage: 5, time: T0, reduceOnly: true }) === null,
   'sin posición abierta, una reduce-only se retira (no abre una posición nueva)');
  TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, leverage: 5, time: T0 });
  const q = TE.state.position;
  ok(TE.openPosition('long', { mode: 'pct', size: 50, entryPrice: 100, leverage: 5, time: T0, reduceOnly: true }) === null,
   'y en el MISMO lado también se retira: añadir no es reducir');
  eq(q.qty, TE.state.position.qty, 'la posición intacta tras los dos rechazos');
  const antes = TE.state.position.qty;
  TE.openPosition('short', { mode: 'pct', size: 50, entryPrice: 100, leverage: 5, time: T0 + H, reduceOnly: true });
  ok(TE.state.position && Math.abs(TE.state.position.qty - antes / 2) < 1e-9,
   `una reduce-only del otro lado REDUCE la posición (${antes} → ${TE.state.position.qty}), sin abrir cortos`);
  TE.state.pending.push({ id: 991, tipo: 'limite', side: 'short', limitPrice: 90, mode: 'pct', size: 100,
    leverage: 5, feePct: 0, efecto: 'GTC', rol: 'maker', reduceOnly: true, estado: 'pendiente', creada: T0 + 2 * H });
  TE.onCandle(vela(T0 + 2 * H, 100, 100.2, 89.8, 90));
  ok(!TE.state.position, 'una reduce-only límite que se cruza CERRÓ la posición (no invirtió): el caso que sin la marca quedaría abierto en corto');
  ok(TE.state.trades.every((t) => t.side === 'long'), 'ningún trade nuevo es del lado contrario: no se abrió posición corta en ningún momento');
}

/* ═══ G · ORDEN TRIGGER / PLAN (F1) ═══ */
seccion('G · Trigger: espera sin reservar margen, dispara contra mark o last, y puede fallar al disparar');
{
  arranque();
  const margenAntes = TE.marginUsed(), balanceAntes = TE.state.balance;
  const o = TE.placeTrigger('long', { triggerPrice: 110, exec: 'market', mode: 'pct', size: 50, leverage: 5, time: T0 });
  ok(o && o.tipo === 'trigger' && o.estado === 'en espera', `trigger colocada (${o && o.tipo}, ${o && o.estado})`);
  ok(TE.marginUsed() === margenAntes && TE.state.balance === balanceAntes,
   'mientras espera NO congela margen ni mueve el balance —que es justo lo que la documentación de Bitunix repite—');
  ok(TE.pendingPorTipo().trigger === 1 && TE.pendingPorTipo().limite === 0, `el panel distingue los tipos (${JSON.stringify(TE.pendingPorTipo())})`);
  ok(!TE.onCandle(vela(T0 + H, 100, 109.9, 99, 100)) && TE.state.pending.length === 1, 'a 109,90 no se disparó: sigue pendiente');
  TE.onCandle(vela(T0 + 2 * H, 100, 110, 100, 109.5));
  ok(TE.state.position && TE.state.position.entryPrice === 110, `al tocar 110 se ejecuta a mercado (entrada ${TE.state.position.entryPrice}) y la pendiente desaparece (${TE.state.pending.length})`);
  // Hueco por encima del nivel: rellena a la APERTURA (peor precio), no al trigger.
  arranque();
  TE.placeTrigger('long', { triggerPrice: 110, exec: 'market', mode: 'pct', size: 50, leverage: 5, time: T0 });
  TE.onCandle(vela(T0 + H, 115, 116, 114, 115.5));
  ok(TE.state.position && TE.state.position.entryPrice === 115,
   `con hueco que ABRE por encima del trigger, el relleno es la apertura (${TE.state.position && TE.state.position.entryPrice}), no el 110 soñado: modo pesimista`);
  // Ejecución límite: al disparar se COLOCA el límite y NO se rellena en la misma vela.
  arranque();
  TE.placeTrigger('long', { triggerPrice: 110, exec: 'limit', limitPrice: 108, mode: 'pct', size: 50, leverage: 5, time: T0 });
  TE.onCandle(vela(T0 + H, 109, 111, 108, 109.5));         // la vela toca trigger Y el límite, en cualquier orden
  ok(!TE.state.position && TE.state.pending.length === 1 && TE.state.pending[0].tipo === 'limite',
   'trigger con ejecución límite: se colocó el límite y NO se ejecutó en esa vela (con OHLC no se sabe si la mecha lo cruzó después del trigger)');
  TE.onCandle(vela(T0 + 2 * H, 109.5, 109.6, 107.9, 108.5));
  ok(TE.state.position && TE.state.position.entryPrice === 108, `y desde la vela siguiente el límite se rellena (${TE.state.position && TE.state.position.entryPrice})`);
  // mark vs last en el disparo.
  for (const src of ['last', 'mark']) {
    arranque();
    TE.placeTrigger('long', { triggerPrice: 110, exec: 'market', mode: 'pct', size: 50, leverage: 5, time: T0, src });
    TE.onCandle(vela(T0 + H, 100, 110.5, 100, 100.5));      // solo la mecha llega al nivel
    const abierta = !!TE.state.position;
    ok(src === 'last' ? abierta : !abierta,
      `disparo contra ${src.toUpperCase()}: una mecha que toca el nivel ${src === 'last' ? 'SÍ' : 'NO'} abre la posición`);
  }
  // Al disparar puede no caber: la trigger se consume y se cancela.
  arranque();
  TE.placeTrigger('long', { triggerPrice: 110, exec: 'market', mode: 'notional', size: 1e9, leverage: 5, time: T0 });
  TE.onCandle(vela(T0 + H, 109, 111, 109, 110.5));
  ok(!TE.state.position && TE.state.pending.length === 0,
   'trigger alcanzada y CANCELADA por no caber el tamaño: no reserva margen, así que el rechazo al disparar es el comportamiento documentado');
  // Cancelar una pendiente.
  arranque();
  const o2 = TE.placeTrigger('short', { triggerPrice: 90, exec: 'market', mode: 'pct', size: 50, leverage: 5, time: T0 });
  ok(TE.cancelTrigger(o2.id) && TE.state.pending.length === 0, 'una trigger pendiente se cancela y deja de existir');
}

/* ═══ H · FUNDING DE 8 H, CON SIGNO (F3) ═══ */
seccion('H · Funding: cada 8 h en 00/08/16 UTC, sobre el notional, largo paga / corto cobra');
{
  const prima = 10000 * 0.01 / 100;
  for (const lado of ['long', 'short']) {
    arranque();
    TE.configure({ fundingPct: 0.01 });
    TE.openPosition(lado, { mode: 'pct', size: 100, entryPrice: 100, leverage: 1, time: T0 });
    const antes = TE.state.balance;
    TE.onCandle(vela(T0 + 7 * H, 100, 101, 99, 100));
    eq(TE.state.balance, antes, `${lado}: a las 07:00 UTC aún no se cobra nada`);
    TE.onCandle(vela(T0 + 8 * H, 100, 101, 99, 100));
    const delta = TE.state.balance - antes;
    eq(delta, lado === 'long' ? -prima : prima,
      `${lado}: a las 08:00 UTC el ${lado === 'long' ? 'largo PAGA' : 'corto COBRA'} ${prima} USDT (tasa positiva)`);
    near(TE.state.position.funding, lado === 'long' ? -prima : prima, 1e-9,
      `y la posición acumula el funding CON su signo (${TE.state.position.funding.toFixed(4)}) para que el historial cuadre`);
  }
  arranque();
  TE.configure({ fundingPct: 0.01 });
  TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, leverage: 1, time: T0 });
  const b0 = TE.state.balance;
  TE.onCandle(vela(T0 + 24 * H, 100, 101, 99, 100));
  eq(b0 - TE.state.balance, 3 * prima, 'una vela diaria cruza las TRES liquidaciones del día y se cobran las tres (no una)');
  arranque();
  TE.configure({ fundingPct: 0.01, fundingCadaHoras: 1 });
  TE.openPosition('long', { mode: 'pct', size: 100, entryPrice: 100, leverage: 1, time: T0 });
  const b1 = TE.state.balance;
  TE.onCandle(vela(T0 + 2 * H, 100, 101, 99, 100));
  eq(b1 - TE.state.balance, 2 * prima, 'con `fundingCadaHoras: 1` (contratos recién listados o ilíquidos) el ritmo es horario: dos velas, dos liquidaciones');
}

/* ═══ I · INVARIANTES ═══ */
seccion('I · Invariantes con la tabla de niveles puesta');
{
  arranque();
  const p = TE.openPosition('short', { mode: 'pct', size: 33, entryPrice: 100, sl: 111, tp: 88, leverage: 7, time: T0 });
  let nan = 0;
  for (let i = 1; i <= 40; i++) {
    const c = vela(T0 + i * H, 100 + Math.sin(i) * 8, 102 + Math.sin(i) * 8, 98 + Math.sin(i) * 8, 100 + Math.cos(i) * 6);
    TE.onCandle(c);
    const liq = TE.liquidationPrice(TE.state.position);
    for (const v of [TE.state.balance, TE.state.equity, liq, TE.margenMantenimiento(TE.state.position), TE.state.position && TE.state.position.pnl]) {
      if (v !== null && v !== undefined && !Number.isFinite(v)) nan++;
    }
  }
  eq(nan, 0, `40 velas con niveles, SL/TP y recálculos: cero NaN/Infinitos (liquidación ${TE.state.position ? TE.liquidationPrice(TE.state.position).toFixed(2) : 'cerrada'})`);
  ok(TE.margenMantenimiento(null) === 0 && TE.liquidationPrice(null) === null && TE.liqInfo(null).sinNivel === true,
    'con la carta sin posición las helpers devuelven 0/null/sinNivel en vez de romper al pintar');
  const sr = TE.marginRate(TE.state.position, 100);
  ok(TE.state.position ? (sr && Number.isFinite(sr.ratio)) : true, 'y `marginRate` devuelve un número finito mientras la posición viva');
}

console.log('\n────────────────────────────────────────────────────────────');
console.log(`Futuros de Bitunix en el motor: ${pasan} superadas, ${fallan} fallidas`);
if (fallan === 0) { console.log('✅ Niveles, liquidación, disparo, validez, reduce-only, trigger y funding se operan como en Bitunix.\n'); process.exit(0); }
console.log('❌ Revísalo:\n' + fallos.map((f) => '   · ' + f).join('\n') + '\n');
process.exit(1);
