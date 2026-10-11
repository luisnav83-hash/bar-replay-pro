/* TP/SL de la posición completa (diálogo «Editar TP/SL», pestaña Posición). Contra el BUILD:
   `node tools/build-single.js` antes. */
const path = require('path');
const puppeteer = require(process.env.PPTR_PATH || 'puppeteer');
const FILE = 'file://' + path.resolve(__dirname, '..', 'bar-replay-pro-unico.html');
const ESP = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
const cerca = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e).slice(0, 160)));
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(FILE, { waitUntil: 'load' });
  await ESP(3000);

  console.log('TP/SL de la posición: diálogo de la pestaña Posición');

  ok(await p.evaluate(() => !!document.getElementById('btnPosTpSl') && !!document.getElementById('modalPosTpSl')),
    'la tarjeta tiene el botón «Editar TP/SL» y existe el diálogo');

  // Sin posición: el diálogo avisa y no deja editar
  await p.evaluate(() => { document.getElementById('btnPosTpSl').click(); });
  await ESP(200);
  const sinPos = await p.evaluate(() => ({
    abierto: document.getElementById('modalPosTpSl').classList.contains('open'),
    info: document.getElementById('pdInfo').textContent,
    deshab: document.getElementById('pdConfirmar').disabled,
  }));
  ok(sinPos.abierto && /No hay posición/.test(sinPos.info) && sinPos.deshab,
    'sin posición, el diálogo se abre, avisa y bloquea Confirmar');
  await p.evaluate(() => UI.closeModal('modalPosTpSl'));

  // Abrimos una LONG 10X al 50 %
  await p.evaluate(() => {
    TE.state.leverage = 10; TE.state.leverageLado = { long: 10, short: 10 };
    document.querySelector('#segOrderType [data-otype="market"]').click();
  });
  await ESP(300);
  await p.evaluate(() => { document.querySelector('#quickSize [data-pct="50"]').click(); });
  await ESP(300);
  await p.evaluate(() => { document.getElementById('btnLong').click(); });
  await ESP(1200);
  const entrada = await p.evaluate(() => TE.state.position && TE.state.position.entryPrice);
  ok(Number.isFinite(entrada), `hay posición LONG abierta (entrada ${entrada})`);

  await p.evaluate(() => { document.getElementById('btnPosTpSl').click(); });
  await ESP(200);
  const inicio = await p.evaluate(() => ({
    info: document.getElementById('pdInfo').textContent,
    tp: document.getElementById('pdTpPrecio').value, sl: document.getElementById('pdSlPrecio').value,
    deshab: document.getElementById('pdConfirmar').disabled,
  }));
  ok(/LONG · 10X/.test(inicio.info) && inicio.tp === '' && inicio.sl === '' && !inicio.deshab,
    `el diálogo muestra la posición (${inicio.info}) y los campos vacíos sin nivel`);

  // TP por precio: entrada +2 % → retorno +20 % (10X)
  await p.evaluate((e) => { const i = document.getElementById('pdTpPrecio'); i.value = (e * 1.02).toFixed(2); i.dispatchEvent(new Event('input')); }, entrada);
  const tpPorPrecio = await p.evaluate(() => ({
    roi: +document.getElementById('pdTpRoi').value, rango: +document.getElementById('pdTpRango').value,
    pnl: document.getElementById('pdTpPnl').textContent, cambio: document.getElementById('pdTpCambio').textContent,
  }));
  ok(cerca(tpPorPrecio.roi, 20, 0.05) && cerca(tpPorPrecio.rango, 20, 0.05),
    `precio +2 % con 10X da retorno +20 % (retorno ${tpPorPrecio.roi}, deslizador ${tpPorPrecio.rango})`);
  ok(/^\+/.test(tpPorPrecio.pnl) && /\+2\.00%/.test(tpPorPrecio.cambio),
    `PnL estimado positivo y cambio de precio +2,00% (${tpPorPrecio.pnl}, ${tpPorPrecio.cambio})`);

  // SL por retorno: −10 % → precio −1 % con 10X
  await p.evaluate(() => { const i = document.getElementById('pdSlRoi'); i.value = '-10'; i.dispatchEvent(new Event('input')); });
  const slPorRoi = await p.evaluate((e) => ({ precio: +document.getElementById('pdSlPrecio').value, esperado: e * 0.99 }), entrada);
  ok(cerca(slPorRoi.precio, slPorRoi.esperado, 0.02), `retorno −10 % da precio ${slPorRoi.precio} (esperado ${slPorRoi.esperado.toFixed(2)})`);

  // Deslizador del TP: 50 % → precio +5 %
  await p.evaluate(() => { const r = document.getElementById('pdTpRango'); r.value = '50'; r.dispatchEvent(new Event('input')); });
  const rangoTp = await p.evaluate((e) => ({ precio: +document.getElementById('pdTpPrecio').value, esperado: e * 1.05 }), entrada);
  ok(cerca(rangoTp.precio, rangoTp.esperado, 0.02), `el deslizador del TP en 50 % pone el precio en ${rangoTp.precio} (esperado ${rangoTp.esperado.toFixed(2)})`);

  // Confirmar: TP y SL llegan al motor
  await p.evaluate(() => { document.getElementById('pdTpRango').value = '20'; document.getElementById('pdTpRango').dispatchEvent(new Event('input')); });
  await p.evaluate(() => document.getElementById('pdConfirmar').click());
  await ESP(300);
  const tras = await p.evaluate(() => ({
    tp: TE.state.position.tp, sl: TE.state.position.sl, entrada: TE.state.position.entryPrice,
    abierto: document.getElementById('modalPosTpSl').classList.contains('open'),
  }));
  ok(cerca(tras.tp, tras.entrada * 1.02, 0.02), `Confirmar fija el TP en el motor (${tras.tp})`);
  ok(cerca(tras.sl, tras.entrada * 0.99, 0.02), `Confirmar fija el SL en el motor (${tras.sl})`);
  ok(!tras.abierto, 'tras confirmar, el diálogo se cierra');

  // Reabrir: muestra los niveles guardados
  await p.evaluate(() => { document.getElementById('btnPosTpSl').click(); });
  await ESP(150);
  const reabre = await p.evaluate(() => ({ tp: +document.getElementById('pdTpPrecio').value, sl: +document.getElementById('pdSlPrecio').value, tpRoi: document.getElementById('pdTpRoi').value }));
  ok(cerca(reabre.tp, tras.tp, 0.02) && cerca(reabre.sl, tras.sl, 0.02), `al reabrir, el diálogo muestra TP ${reabre.tp} y SL ${reabre.sl}`);

  // SL por encima de la entrada en LONG: el motor lo rechaza y el diálogo se queda abierto
  await p.evaluate((e) => { const i = document.getElementById('pdSlPrecio'); i.value = (e * 1.01).toFixed(2); i.dispatchEvent(new Event('input')); }, entrada);
  await p.evaluate(() => document.getElementById('pdConfirmar').click());
  await ESP(200);
  const rechazo = await p.evaluate((s) => ({ abierto: document.getElementById('modalPosTpSl').classList.contains('open'), sl: TE.state.position.sl, previo: s }), tras.sl);
  ok(rechazo.abierto && cerca(rechazo.sl, rechazo.previo, 1e-9), 'un SL por encima de la entrada en LONG se rechaza y el diálogo sigue abierto');

  // Quitar el TP con su botón
  await p.evaluate(() => { document.querySelector('[data-quitar="tp"]').click(); });
  await p.evaluate(() => document.getElementById('pdSlPrecio').value = String(TE.state.position.sl));
  await p.evaluate(() => { document.getElementById('pdSlPrecio').dispatchEvent(new Event('input')); document.getElementById('pdConfirmar').click(); });
  await ESP(200);
  const quitado = await p.evaluate(() => ({ tp: TE.state.position.tp, sl: TE.state.position.sl, abierto: document.getElementById('modalPosTpSl').classList.contains('open') }));
  ok(quitado.tp === null && !quitado.abierto && quitado.sl !== null, 'Quitar el TP lo borra en el motor y el SL se queda');

  // Limpieza: cerrar la posición y comprobar el estado sin posición
  await p.evaluate(() => { TE.closePosition(TE.state.position.entryPrice, 'manual'); });
  await ESP(200);
  await p.evaluate(() => { document.getElementById('btnPosTpSl').click(); });
  await ESP(150);
  const sin2 = await p.evaluate(() => ({ deshab: document.getElementById('pdConfirmar').disabled, tp: TE.state.position }));
  ok(sin2.deshab && sin2.tp === null, 'sin posición otra vez, el diálogo queda bloqueado');
  await p.evaluate(() => UI.closeModal('modalPosTpSl'));

  ok(errores.length === 0, `sin errores de JavaScript (${errores.length}${errores.length ? ': ' + errores[0] : ''})`);
  console.log(`\nTP/SL de la posición: ${pass} superadas, ${fail} fallidas`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('💥', e); process.exit(1); });
