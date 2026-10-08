/* =========================================================================
 * entradas.test.js — TODOS LOS CAMINOS DE ENTRADA y su reflejo en el historial.
 *
 * Motivo: el usuario reportó «cuando toma una entrada no aparece como trade».
 * Aquí se recorren los caminos reales (botón, teclado, orden límite) y se
 * comprueba que cada uno deja rastro visible, además de dos fallos concretos:
 *
 *   E1 Mayús+B / Mayús+S colocan una ORDEN LÍMITE (antes llamaban a una función
 *      inexistente: TypeError y el atajo no hacía nada)
 *   E2 pulsar el lado CONTRARIO con posición abierta INVIERTE (cierra y abre);
 *      antes el motor lo rechazaba y parecía que el botón no funcionaba
 *   E3 pulsar el MISMO lado avisa y no toca la posición
 *   E4 toda entrada deja fila viva en el historial (botón y teclado)
 *   E5 una orden límite cruzada con el precio se ejecuta a mercado y lo avisa
 *
 * Uso:  node tests/entradas.test.js
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
    pos: TE.state.position ? TE.state.position.side : null,
    pend: (TE.state.pending || []).length,
    cerradas: TE.state.trades.filter((t) => t.status === 'closed').length,
    cnt: document.getElementById('tabTradeCount').textContent,
    abierta: !!document.getElementById('tradeOpenRow'),
    filas: document.querySelectorAll('#tradesBody tr').length,
    motivos: Array.from(document.querySelectorAll('#tradesBody tr:not(.open) td:nth-child(11)')).map((td) => td.textContent),
    motivoVivo: (document.querySelector('#tradeOpenRow td:nth-child(11)') || {}).textContent || '',
    toasts: document.getElementById('toasts').innerText.replace(/\n/g, ' · '),
    log: document.getElementById('logList').innerText,
  }));

  /** Deja el entorno limpio: sin posición, sin pendientes, campos vacíos. */
  const limpiar = async () => {
    await page.evaluate(() => {
      if (TE.state.position) App.flatten();
      if ((TE.state.pending || []).length) App.cancelAllOrders();
      App.orderType = 'market';
      document.getElementById('sizeInput').value = '10';
      document.getElementById('slInput').value = '';
      document.getElementById('tpInput').value = '';
      document.getElementById('limitInput').value = '';
    });
    await wait(700);
  };
  const shift = async (tecla) => {
    await page.keyboard.down('Shift');
    await page.keyboard.press(tecla);
    await page.keyboard.up('Shift');
  };

  /* ---------------- E1) Mayús+B / Mayús+S → orden límite ---------------- */
  console.log('\n▸ E1) Atajos de orden límite (Mayús+B / Mayús+S)');
  await limpiar();
  await shift('B');
  await wait(800);
  const a = await estado();
  ok(a.pend === 1, `Mayús+B deja una orden límite pendiente (${a.pend})`);
  ok(a.pos === null && !a.abierta, 'no abre posición: queda esperando a que el precio llegue');
  ok(/límite|limite/i.test(a.toasts + a.log), 'el log/toast confirma la orden límite');

  await limpiar();
  await shift('S');
  await wait(800);
  const b = await estado();
  ok(b.pend === 1, `Mayús+S deja una orden límite pendiente (${b.pend})`);

  // Con posición abierta el límite no se ignora: queda EN ESPERA y se AVISA.
  await limpiar();
  await page.evaluate(() => App.placeOrder('long'));
  await wait(700);
  await page.evaluate(() => {
    document.getElementById('limitInput').value = (App.currentPrice() * 1.01).toFixed(2);
    App.placeLimitOrder('short');
  });
  await wait(800);
  const b2 = await estado();
  ok(b2.pend === 1 && b2.pos === 'long', 'con posición abierta el límite queda en espera (no se pierde)');
  ok(/esperará a que la cierres/i.test(b2.log), 'el log explica que entrará en vigor al cerrar la posición');
  await page.evaluate(() => { App.cancelAllOrders(); });
  await wait(300);
  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);

  /* ---------------- E5) Límite cruzada → a mercado, avisando ---------------- */
  console.log('\n▸ E5) Orden límite cruzada con el precio');
  await limpiar();
  await page.evaluate(() => {
    App.orderType = 'limite';
    document.getElementById('limitInput').value = (App.currentPrice() * 1.02).toFixed(2);  // compra por encima
    App.placeOrder('long');
  });
  await wait(900);
  const c = await estado();
  ok(c.pos === 'long', `se ejecuta a mercado (pos=${c.pos}) y se avisa`);
  ok(c.pend === 0 && c.abierta, `no queda pendiente colgada y la entrada se ve en el historial (filas=${c.filas})`);
  ok(/se ejecutó a mercado/i.test(c.toasts + c.log), 'el aviso explica la ejecución a mercado');

  /* ---------------- E4) Entrada con botón → fila viva ---------------- */
  console.log('\n▸ E4) Toda entrada deja fila viva en el historial');
  await limpiar();
  const base = await estado();
  ok(!base.abierta && base.pos === null, `partimos sin posición (cerradas previas: ${base.cerradas})`);
  await page.click('#btnLong');
  await wait(900);
  const d = await estado();
  ok(d.pos === 'long' && d.abierta, `botón LONG → fila viva (pos=${d.pos})`);
  ok(d.filas === base.filas + 1 && d.cerradas === base.cerradas, `la fila nueva es la viva (filas ${base.filas}→${d.filas})`);

  /* ---------------- E2) Inversión: SHORT con LONG abierto ---------------- */
  console.log('\n▸ E2) Pulsar el lado contrario invierte la posición');
  await page.click('#btnShort');
  await wait(1000);
  const e = await estado();
  ok(e.pos === 'short', `la posición pasa a SHORT (${e.pos})`);
  ok(e.cerradas === base.cerradas + 1, `la LONG se cierra y se registra (cerradas ${base.cerradas}→${e.cerradas})`);
  ok(/inversi/i.test(e.motivos[0] || ''), `el historial anota el motivo (${e.motivos[0]})`);
  ok(e.abierta && e.filas === base.filas + 2, `la nueva entrada también se ve como fila viva (filas=${e.filas})`);
  ok(/Inversión/i.test(e.log), 'el log explica la inversión');

  /* ---------------- E3) Mismo lado: avisa y no rompe nada ---------------- */
  console.log('\n▸ E3) El mismo lado avisa en vez de no hacer nada');
  await page.click('#btnShort');
  await wait(700);
  const f = await estado();
  ok(f.pos === 'short' && f.cerradas === base.cerradas + 1 && f.filas === base.filas + 2,
     'la posición SHORT sigue viva y no se duplica');
  ok(/Ya hay una posición abierta/i.test(f.toasts), 'se avisa al usuario con el motivo');

  /* ---------------- E2b) Inversión con teclado ---------------- */
  console.log('\n▸ E2b) Inversión también con el teclado');
  await page.keyboard.press('b');
  await wait(900);
  const g = await estado();
  ok(g.pos === 'long' && g.cerradas === base.cerradas + 2, `tecla B invierte a LONG (pos=${g.pos} cerradas=${g.cerradas})`);
  ok(/inversión/i.test(g.motivos[0] || ''), 'el motivo de la inversión por teclado también queda anotado');

  /* ---------------- Cierre y coherencia final ---------------- */
  console.log('\n▸ Cierre y coherencia');
  await page.keyboard.press('Escape');
  await wait(900);
  const h = await estado();
  ok(h.pos === null && h.cerradas === base.cerradas + 3, `cierre manual registrado (cerradas=${h.cerradas})`);
  ok(h.cnt === String(h.cerradas), `el contador de la pestaña coincide (${h.cnt})`);
  ok(!h.abierta, 'no queda ninguna fila viva');
  await page.screenshot({ path: path.join(ROOT, 'docs', 'captura-27-entradas-e-inversion.png') });
  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);
  await browser.close();

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Entradas y atajos: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ Todos los caminos de entrada dejan rastro visible.\n');
  else { console.log('❌ Quedan fallos en los caminos de entrada.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
