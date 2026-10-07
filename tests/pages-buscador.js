/* =========================================================================
 * pages-buscador.js — Verifica LA APP PUBLICADA en GitHub Pages con un
 * navegador real: abre el buscador de símbolos en vivo (catálogo de Binance
 * por el proxy), comprueba el contador, la búsqueda y las temporalidades, y
 * guarda capturas (escritorio y móvil) en docs/.
 *
 * Uso:  node tests/pages-buscador.js
 * =======================================================================*/
'use strict';

const path = require('path');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) {
  console.log('⚠️  Falta puppeteer: prueba OMITIDA.');
  process.exit(0);
}

let pasan = 0, fallan = 0;
const ok = (cond, msg) => {
  if (cond) { pasan++; console.log('  ✓ ' + msg); }
  else { fallan++; console.log('  ✗ ' + msg); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://luisnav83-hash.github.io/bar-replay-pro/bar-replay-pro-unico.html';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 880 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  console.log('\n▸ Abriendo la app publicada en GitHub Pages');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 60000 });
  await wait(1500);

  /* --- A) Catálogo completo: primero con el proxy local, luego en Pages --- */

  // A1) Servida por server.js (proxy del mismo origen)
  const LOCAL = 'http://localhost:8080/bar-replay-pro-unico.html';
  let localOk = false;
  try {
    const r = await page.goto(LOCAL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    localOk = !!r && r.status() < 400;
  } catch (e) { localOk = false; }

  if (localOk) {
    console.log('\n▸ A1) Catálogo completo servida por server.js (proxy local)');
    await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 60000 });
    await wait(800);
    await page.evaluate(() => UI.openSymbols());
    await wait(2000);
    await page.evaluate(() => document.querySelector('.sym-cat[data-cat="todos"]').click());
    await wait(1200);
    const A1 = await page.evaluate(() => ({
      filas: document.querySelectorAll('#symList .sym-row').length,
      contador: document.getElementById('symCount').textContent.trim(),
    }));
    const n1 = parseInt((A1.contador.match(/[\d.]+/) || ['0'])[0].replace(/\./g, ''), 10);
    ok(n1 >= 800, `el proxy local entrega el catálogo real (${A1.contador} · ${A1.filas} filas)`);
  } else {
    console.log('\n▸ A1) (servidor local no disponible: se omite)');
  }

  // A2) Publicada en GitHub Pages (sin proxy: catálogo directo de Binance)
  console.log('\n▸ A2) Catálogo completo en GitHub Pages (sin servidor propio)');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 60000 });
  await wait(1500);
  await page.evaluate(() => UI.openSymbols());
  await wait(2500);
  const A0 = await page.evaluate(() => ({
    abierto: document.getElementById('modalSymbols').classList.contains('open'),
    par: document.getElementById('sbPair').textContent,
  }));
  ok(A0.abierto, 'la ventana del buscador se abre');
  const A0filas = await page.evaluate(() => document.querySelectorAll('#symList .sym-row').length);
  const A0cat = await page.evaluate(() => (document.querySelector('#symCats .sym-cat.active') || {}).dataset?.cat);
  ok(A0filas >= 5, `al abrir no sale vacío: arranca en «${A0cat}» con ${A0filas} pares (primer uso, sin favoritos)`);
  await page.evaluate(() => document.querySelector('.sym-cat[data-cat="todos"]').click());
  await wait(1500);
  const A = await page.evaluate(() => ({
    filas: document.querySelectorAll('#symList .sym-row').length,
    contador: document.getElementById('symCount').textContent.trim(),
  }));
  const nA = parseInt((A.contador.match(/[\d.]+/) || ['0'])[0].replace(/\./g, ''), 10);
  ok(nA >= 800, `sin servidor propio también lista el catálogo de Binance (${A.contador} · ${A.filas} filas)`);
  ok(A.filas >= 20, `la lista se pinta (${A.filas} filas visibles)`);

  /* --- B) Búsqueda al escribir --- */
  await page.type('#symQuery', 'sol');
  await wait(500);
  const B = await page.evaluate(() => [...document.querySelectorAll('#symList .sym-row .sym-name b')]
    .slice(0, 4).map((e) => e.textContent));
  ok(B.length >= 1 && B.some((s) => /SOL/i.test(s)), `busca al escribir (${B.join(', ')})`);

  await page.evaluate(() => {
    const i = document.getElementById('symQuery');
    i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(600);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-21-buscador-github.png') });

  /* --- C) Categorías y elección --- */
  console.log('\n▸ C) Categorías y cambio de par');
  await page.evaluate(() => document.querySelector('.sym-cat[data-cat="principales"]').click());
  await wait(800);
  const C1 = await page.evaluate(() => ({
    filas: document.querySelectorAll('#symList .sym-row').length,
    borrar: document.getElementById('symQuery').value,
  }));
  ok(C1.filas >= 5, `«Principales» lista los pares de referencia (${C1.filas} filas)`);

  await page.evaluate(() => {
    const i = document.getElementById('symQuery');
    i.value = 'xrp'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(500);
  await page.evaluate(() => document.querySelector('#symList .sym-row').click());
  await wait(3000);
  const C2 = await page.evaluate(() => ({
    sel: document.getElementById('pairSelect').value,
    boton: document.getElementById('sbPair').textContent,
    velas: App.candles.length,
    fuente: (document.getElementById('srcLabel') || {}).textContent || '',
  }));
  ok(C2.sel === 'XRPUSDT' && C2.boton === 'XRP/USDT', `cambia el par en la app publicada (${C2.sel} · ${C2.boton})`);
  ok(C2.velas > 500, `y recarga velas reales (${C2.velas} velas)`);

  /* --- D) Temporalidad --- */
  await page.evaluate(() => document.querySelector('#tfQuick .tf-btn[data-tf="4h"]').click());
  await wait(2500);
  const D = await page.evaluate(() => ({
    tf: document.getElementById('tfSelect').value,
    activo: document.querySelector('#tfQuick .tf-btn.active').dataset.tf,
  }));
  ok(D.tf === '4h' && D.activo === '4h', `los botones de temporalidad funcionan (${D.tf})`);

  /* --- E) Móvil --- */
  console.log('\n▸ E) En el móvil');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await wait(1200);
  await page.evaluate(() => UI.openSymbols && UI.openSymbols());
  await wait(1200);
  const E = await page.evaluate(() => {
    const box = document.querySelector('#modalSymbols .modal-box');
    const r = box.getBoundingClientRect();
    return { dentro: r.left >= -1 && r.right <= window.innerWidth + 1, ancho: Math.round(r.width) };
  });
  ok(E.dentro, `la ventana cabe en la pantalla del móvil (${E.ancho} px de ancho)`);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-22-buscador-movil.png') });

  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);

  await browser.close();
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`App publicada: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El buscador funciona en la app publicada (GitHub Pages).\n');
  else { console.log('❌ Hay fallos en la app publicada.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
