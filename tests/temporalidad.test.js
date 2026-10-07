/* =========================================================================
 * temporalidad.test.js — CAMBIO DE TEMPORALIDAD y REGISTRO DE LA ENTRADA.
 *
 * Cubre los dos fallos reportados sobre el archivo único publicado:
 *
 *   A) «al cambiar de temporalidad va mal»
 *      A1 el desplegable recarga solo (motor, select, leyenda y velas
 *         coherentes; antes el select decía una TF y el gráfico otra)
 *      A2 el replay se queda en la MISMA fecha (no vuelve al inicio)
 *      A3 con posición abierta: se cierra a mercado, avisa y el trade queda
 *         registrado (antes la posición sobrevivía con precios de la serie
 *         anterior y su PnL se calculaba contra velas de otra temporalidad)
 *      A4 con orden límite pendiente: se cancela con aviso
 *
 *   B) «cuando toma una entrada no aparece como trade»
 *      B1 la posición abierta aparece en el historial como fila «ABIERTA»
 *      B2 su PnL flotante se actualiza al avanzar velas
 *      B3 el contador de la pestaña cuenta sólo los trades CERRADOS
 *      B4 al cerrarse, la fila viva desaparece y el trade entra en el historial
 *
 * Uso:  node tests/temporalidad.test.js
 * =======================================================================*/
'use strict';

const path = require('path');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) {
  console.log('⚠️  Falta puppeteer (npm i puppeteer en /home/user/.cache/pptr): prueba OMITIDA.');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'bar-replay-pro-unico.html');

let pasan = 0, fallan = 0;
const ok = (cond, msg) => {
  if (cond) { pasan++; console.log('  ✓ ' + msg); }
  else { fallan++; console.log('  ✗ ' + msg); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940 });

  const errs = [];
  page.on('pageerror', (e) => errs.push('EXC: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.App && window.App.candles && window.App.candles.length > 0, { timeout: 40000 });
  await wait(900);

  const estado = () => page.evaluate(() => ({
    tfMotor: App.interval,
    tfSelect: document.getElementById('tfSelect').value,
    velas: BR.total(),
    index: BR.getIndex(),
    fecha: BR.currentCandle() ? BR.currentCandle().time : null,
    legendTF: (document.querySelector('#ohlcLegend') || {}).innerText || '',
    posicion: TE.state.position ? TE.state.position.side : null,
    pendientes: (TE.state.pending || []).length,
    cerradas: TE.state.trades.filter((t) => t.status === 'closed').length,
    contadorTab: (document.getElementById('tabTradeCount') || {}).textContent,
    filasTabla: document.querySelectorAll('#tradesBody tr').length,
    filaAbierta: !!document.getElementById('tradeOpenRow'),
    pnlAbierto: (document.getElementById('openPnl') || {}).textContent,
    emptyVisible: !document.getElementById('tradesEmpty').classList.contains('hidden'),
    avisos: (document.getElementById('toasts') || {}).innerText || '',
  }));

  /* ---------------- A1) el desplegable recarga solo ---------------- */
  console.log('\n▸ A1) El desplegable de temporalidad recarga al instante');
  const antes = await estado();
  await page.select('#tfSelect', '15m');
  await wait(4000);
  const trasSelect = await estado();
  ok(trasSelect.tfMotor === '15m', `el motor queda en 15m (${trasSelect.tfMotor})`);
  ok(trasSelect.tfSelect === '15m', 'el desplegable sigue en 15m');
  ok(trasSelect.velas !== antes.velas || trasSelect.fecha !== antes.fecha,
     `las velas cambian de serie (${antes.velas} → ${trasSelect.velas})`);
  ok(/15m/.test(trasSelect.legendTF), 'la leyenda muestra la temporalidad nueva');
  ok(trasSelect.tfMotor === trasSelect.tfSelect, 'motor y desplegable coinciden (no hay estado incoherente)');

  /* ---------------- A2) se conserva la fecha del replay ---------------- */
  console.log('\n▸ A2) El replay se queda en la misma fecha');
  const fecha1h = trasSelect.fecha;
  await page.select('#tfSelect', '1h');
  await wait(4000);
  const vuelta1h = await estado();
  ok(vuelta1h.tfMotor === '1h', 'vuelve a 1h');
  ok(Math.abs(vuelta1h.fecha - fecha1h) <= 3600,
     `la vela del replay no cambia de fecha (${new Date(fecha1h * 1000).toISOString().slice(0, 16)} vs ${new Date(vuelta1h.fecha * 1000).toISOString().slice(0, 16)})`);

  /* ---------------- B1/B2/B3) la entrada aparece como trade ---------------- */
  console.log('\n▸ B) La entrada abierta se ve en el historial');
  await page.evaluate(() => {
    document.getElementById('sizeInput').value = '5';
    document.getElementById('slInput').value = '';
    document.getElementById('tpInput').value = '';
    App.placeOrder('long');
  });
  await wait(900);
  const conPos = await estado();
  ok(conPos.posicion === 'long', 'la posición está abierta');
  ok(conPos.filaAbierta, 'aparece la fila «ABIERTA» en el historial');
  ok(conPos.contadorTab === '0', `el contador cuenta sólo cerradas (${conPos.contadorTab})`);
  ok(!conPos.emptyVisible, 'el mensaje «no hay trades cerrados» se oculta cuando hay posición');

  const pnl0 = conPos.pnlAbierto;
  await page.screenshot({ path: path.join(ROOT, 'docs', 'captura-26-trade-abierto-en-vivo.png') });
  await page.evaluate(() => { for (let i = 0; i < 5; i++) App.stepForward(); });
  await wait(900);
  const avanzado = await estado();
  ok(avanzado.pnlAbierto !== pnl0,
     `el PnL de la fila abierta se actualiza con las velas (${pnl0} → ${avanzado.pnlAbierto})`);
  ok(avanzado.filaAbierta, 'la fila sigue visible mientras la posición vive');
  const coherente = await page.evaluate(() => {
    const bars = TE.state.position ? TE.state.position.bars : null;
    const celda = document.getElementById('openBars') ? document.getElementById('openBars').textContent : '';
    return { bars, celda };
  });
  ok(coherente.celda.startsWith(String(coherente.bars)),
     `la columna «Velas» de la fila viva va al día (estado ${coherente.bars} · celda «${coherente.celda}»)`);

  /* ---------------- A3) cambiar de TF cierra la posición y la registra ---------------- */
  console.log('\n▸ A3) Cambiar de temporalidad con posición abierta');
  await page.select('#tfSelect', '5m');
  await wait(4500);
  const trasCambio = await estado();
  ok(trasCambio.posicion === null, 'la posición se ha cerrado al cambiar de serie');
  ok(trasCambio.cerradas === 1, `el trade queda registrado (cerradas: ${trasCambio.cerradas})`);
  ok(trasCambio.contadorTab === '1', `el contador refleja el cierre (${trasCambio.contadorTab})`);
  ok(!trasCambio.filaAbierta, 'la fila «ABIERTA» desaparece al cerrarse');
  ok(/cambio de serie|cerrada/i.test(trasCambio.avisos) || /cambio de serie/i.test(await page.evaluate(() => document.getElementById('logList').innerText)),
     'se avisa del cierre por cambio de temporalidad');

  /* ---------------- A4) los límites pendientes se cancelan ---------------- */
  console.log('\n▸ A4) Cambiar de temporalidad con orden límite pendiente');
  await page.evaluate(() => {
    App.orderType = 'limite';
    document.getElementById('sizeInput').value = '5';
    document.getElementById('limitInput').value = (App.currentPrice() * 0.995).toFixed(2);
    App.placeOrder('long');
  });
  await wait(700);
  const conPend = await estado();
  ok(conPend.pendientes === 1, `la orden límite queda pendiente (${conPend.pendientes})`);
  await page.select('#tfSelect', '1h');
  await wait(4500);
  const sinPend = await estado();
  ok(sinPend.pendientes === 0, 'la orden pendiente se cancela al cambiar de serie');
  ok(/cancelada|canceladas/i.test(sinPend.avisos) || /cancelad/i.test(await page.evaluate(() => document.getElementById('logList').innerText)),
     'se avisa de la cancelación');

  /* ---------------- B4) cerrar manualmente mete el trade en el historial ---------------- */
  console.log('\n▸ B4) Al cerrar, el trade pasa al historial');
  await page.evaluate(() => { App.orderType = 'market'; App.placeOrder('short'); });
  await wait(700);
  const conShort = await estado();
  ok(conShort.filaAbierta && conShort.posicion === 'short', 'la entrada SHORT también se ve como fila abierta');
  await page.evaluate(() => App.flatten());
  await wait(900);
  const cerrado = await estado();
  ok(cerrado.cerradas === 2, `el trade se añade al historial (cerradas: ${cerrado.cerradas})`);
  ok(cerrado.filasTabla === 2, `la tabla tiene las dos filas de cerrados (${cerrado.filasTabla})`);
  ok(!cerrado.filaAbierta, 'no queda fila abierta');

  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);
  await page.screenshot({ path: path.join(ROOT, 'docs', 'captura-25-temporalidad-trade-abierto.png') });
  await browser.close();

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Temporalidad y registro de entradas: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El cambio de temporalidad es coherente y la entrada se ve como trade.\n');
  else { console.log('❌ Quedan fallos en el cambio de temporalidad o en el registro.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
