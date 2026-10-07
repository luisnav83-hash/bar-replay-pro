/* =========================================================================
 * limites.test.js — ÓRDENES LÍMITE: comprobación de extremo a extremo en un
 * navegador real, sobre el archivo único y sin red.
 *
 * Se verifica el ciclo completo:
 *   A) Colocar la orden: queda pendiente, se dibuja y aparece en la lista
 *   B) El replay la ejecuta sola al alcanzar el nivel (nunca peor que el nivel)
 *   C) Retroceder velas devuelve la orden a «pendiente» (los checkpoints la
 *      incluyen)
 *   D) Cancelar desde la interfaz la retira y borra su línea
 *   E) Un límite cruzado se ejecuta a mercado (como en un exchange real)
 *   F) El usuario recibe aviso por toast
 *
 * Uso:  node tests/limites.test.js
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

let pasan = 0, fallan = 0;
const ok = (cond, msg) => {
  if (cond) { pasan++; console.log('  ✓ ' + msg); }
  else { fallan++; console.log('  ✗ ' + msg); }
};

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 820 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  // Sin red: como en un visor. La app usa las velas reales guardadas.
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    return (u.startsWith('file://') || u.startsWith('data:')) ? r.continue() : r.abort('failed');
  });

  const FILE = 'file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html').replace(/\\/g, '/');
  console.log('\n▸ Abriendo el archivo único sin red');
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 700));

  /* ---------------- A) Colocar la orden ---------------- */
  console.log('\n▸ A) Colocar una orden límite de compra (0,4% por debajo)');
  await page.click('#segOrderType [data-otype="limite"]');
  await new Promise((r) => setTimeout(r, 250));
  const modo = await page.evaluate(() => ({
    tipo: App.orderType,
    fila: document.getElementById('limitRow').style.display !== 'none',
    boton: document.getElementById('btnLong').textContent.trim(),
  }));
  ok(modo.tipo === 'limite' && modo.fila, `el modo «⏳ Límite» activa el campo de precio (${modo.boton})`);

  const A = await page.evaluate(() => {
    const ref = App.currentPrice();
    document.getElementById('limitInput').value = (ref * 0.996).toFixed(2);
    document.getElementById('sizeInput').value = '50';
    App.placeLimitOrder('long');
    return { pend: TE.pendingCount(), lineas: CM._pendingLines.length, lista: document.querySelectorAll('#pendingList .pending-item').length };
  });
  ok(A.pend === 1, 'la orden queda pendiente');
  ok(A.lineas === 1, 'se dibuja su línea en el gráfico');
  ok(A.lista === 1, 'aparece en la lista de órdenes pendientes');

  /* ---------------- B) Ejecución automática ---------------- */
  console.log('\n▸ B) Avanzar velas hasta que el precio llegue al nivel');
  let B = null;
  for (let i = 0; i < 300 && !B; i++) {
    await page.evaluate(() => App.stepForward());
    B = await page.evaluate(() => {
      const pos = TE.state.position;
      return pos && pos.origin === 'limite'
        ? { entrada: pos.entryPrice, limite: pos.limitPrice, pend: TE.pendingCount(), lista: document.querySelectorAll('#pendingList .pending-item').length }
        : null;
    });
  }
  ok(!!B, 'el replay la ejecuta SOLA al alcanzar el nivel');
  if (B) {
    ok(B.pend === 0 && B.lista === 0, 'desaparece de pendientes al ejecutarse');
    ok(B.entrada <= B.limite + 1e-6, `se ejecuta en el nivel o mejor (${B.entrada.toFixed(2)} ≤ ${B.limite.toFixed(2)})`);
  }

  /* ---------------- C) Retroceso ---------------- */
  console.log('\n▸ C) Retroceder velas (la orden debe volver a estar pendiente)');
  for (let i = 0; i < 25; i++) await page.evaluate(() => App.stepBack());
  const C = await page.evaluate(() => ({ pend: TE.pendingCount(), pos: !!TE.state.position }));
  ok(C.pend === 1 && !C.pos, `el checkpoint devuelve la orden a «pendiente» (pend=${C.pend}, posición=${C.pos})`);

  /* ---------------- D) Cancelar ---------------- */
  console.log('\n▸ D) Cancelar desde la interfaz');
  await page.click('#pendingList .pi-cancel');
  await new Promise((r) => setTimeout(r, 250));
  const D = await page.evaluate(() => ({ pend: TE.pendingCount(), lineas: CM._pendingLines.length }));
  ok(D.pend === 0 && D.lineas === 0, 'el botón ✖ la cancela y borra su línea del gráfico');

  /* ---------------- E) Límite cruzado ---------------- */
  console.log('\n▸ E) Límite al otro lado del precio (se cruzaría al instante)');
  const E = await page.evaluate(() => {
    const ref = App.currentPrice();
    document.getElementById('limitInput').value = (ref * 1.02).toFixed(2);
    App.placeLimitOrder('long');
    const pos = TE.state.position;
    return { pos: !!pos, origen: pos && pos.origin, pend: TE.pendingCount(), entry: pos && pos.entryPrice, ref };
  });
  ok(E.pos && E.origen === 'market' && E.pend === 0, 'se ejecuta a mercado, como en un exchange real');
  ok(Math.abs(E.entry - E.ref) < 1e-6, 'se ejecuta al precio de mercado (no a un nivel imposible)');

  /* ---------------- F) Aviso ---------------- */
  console.log('\n▸ F) Avisos al usuario');
  await new Promise((r) => setTimeout(r, 300));
  const F = await page.evaluate(() => document.getElementById('toasts').innerText.replace(/\s+/g, ' '));
  ok(/l[íi]mite/i.test(F), 'hay aviso en pantalla sobre la orden límite');
  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);

  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-15-ordenes-limite.png') });
  await browser.close();

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Órdenes límite: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ Las órdenes límite funcionan de principio a fin.\n');
  else { console.log('❌ Las órdenes límite tienen fallos.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
