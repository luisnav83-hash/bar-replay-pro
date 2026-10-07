/* =========================================================================
 * pages-dibujos.js — Comprueba en LA APP PUBLICADA (GitHub Pages) las
 * herramientas nuevas de dibujo y el gestor:
 *   · botones de flecha y camino en la barra
 *   · flecha con 2 clics (atajo A)
 *   · camino con clics + Enter (atajo P)
 *   · gestor: lista, 👁 ocultar/mostrar, renombrar y borrar
 *
 * Uso:  node tests/pages-dibujos.js
 * =======================================================================*/
'use strict';

const path = require('path');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) { console.log('⚠️  Falta puppeteer: prueba OMITIDA.'); process.exit(0); }

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
  await page.setViewport({ width: 1360, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.accept());

  console.log('\n▸ Abriendo la app publicada');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 60000 });
  await wait(1500);

  const rect = await page.evaluate(() => {
    const r = document.getElementById('chartWrap').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const clic = async (fx, fy) => {
    await page.mouse.click(Math.round(rect.x + rect.w * fx), Math.round(rect.y + rect.h * fy));
    await wait(180);
  };

  /* --- A) Las herramientas están en la barra --- */
  console.log('\n▸ A) Barra de dibujo');
  const A = await page.evaluate(() => ({
    flecha: !!document.querySelector('#drawToolbar .tool[data-tool="arrow"]'),
    camino: !!document.querySelector('#drawToolbar .tool[data-tool="path"]'),
  }));
  ok(A.flecha && A.camino, 'están los botones de flecha (➤) y camino (✎)');

  /* --- B) Flecha con el atajo A --- */
  console.log('\n▸ B) Flecha (atajo A + 2 clics)');
  await page.evaluate(() => DT.clearAll(true));
  await page.keyboard.press('a');
  await wait(200);
  await clic(0.30, 0.70);
  await clic(0.52, 0.42);
  const B = await page.evaluate(() => DT.drawings.map((d) => d.type));
  ok(B.length === 1 && B[0] === 'arrow', `se dibuja la flecha (${B.join(', ')})`);

  /* --- C) Camino con el atajo P y Enter --- */
  console.log('\n▸ C) Camino (atajo P + clics + Enter)');
  await page.keyboard.press('p');
  await wait(200);
  await clic(0.24, 0.78);
  await clic(0.36, 0.60);
  await clic(0.48, 0.72);
  await page.mouse.move(Math.round(rect.x + rect.w * 0.62), Math.round(rect.y + rect.h * 0.50));
  await wait(150);
  await page.keyboard.press('Enter');
  await wait(350);
  const C = await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'path');
    return { puntos: d ? d.points.length : 0, total: DT.drawings.length, tool: DT.tool };
  });
  ok(C.puntos >= 4 && C.tool === 'cursor', `el camino se cierra con ${C.puntos} puntos y vuelve al cursor`);

  /* --- D) Gestor: lista, 👁 y renombrar --- */
  console.log('\n▸ D) Gestor de dibujos');
  await page.evaluate(() => {
    const t = document.querySelector('.tab[data-tab="drawings"]');
    if (t) t.click();
  });
  await wait(400);
  const D0 = await page.evaluate(() => ({
    filas: document.querySelectorAll('#drawList .draw-item').length,
    barra: !!document.querySelector('#drawList .draw-bar'),
    ojos: document.querySelectorAll('#drawList [data-eye]').length,
  }));
  ok(D0.filas === 2 && D0.barra, `el gestor lista los ${D0.filas} dibujos con su barra de acciones`);
  ok(D0.ojos === 2, 'cada fila tiene su 👁 para ocultar');

  await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'path');
    document.querySelector(`#drawList [data-eye="${d.id}"]`).click();
  });
  await wait(300);
  const D1 = await page.evaluate(() => !!DT.drawings.find((x) => x.type === 'path').hidden);
  ok(D1, 'el 👁 oculta el camino sin borrarlo');

  await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'path');
    document.querySelector(`#drawList [data-nombre="${d.id}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await wait(250);
  await page.evaluate(() => {
    const inp = document.querySelector('#drawList .draw-edit');
    inp.value = 'Suelo del rango'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await wait(350);
  const D2 = await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'path');
    return { label: d.label, visible: document.querySelector('#drawList').textContent.indexOf('Suelo del rango') >= 0 };
  });
  ok(D2.label === 'Suelo del rango' && D2.visible, `el nombre se guarda y se ve en la lista («${D2.label}»)`);

  await page.evaluate(() => document.querySelector('#drawList [data-eye-all]').click());
  await wait(250);
  await page.evaluate(() => document.querySelector('#drawList [data-eye-all]').click());
  await wait(250);
  const D3 = await page.evaluate(() => DT.drawings.every((d) => !d.hidden));
  ok(D3, '«Ocultar todos» y volver a mostrar funcionan');

  const D4 = await page.evaluate(() => { const n = DT.drawings.length; document.querySelector('#drawList [data-del]').click(); return n; });
  await wait(300);
  const D5 = await page.evaluate(() => DT.drawings.length);
  ok(D5 === D4 - 1, `la ✕ elimina un solo dibujo (${D4} → ${D5})`);

  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-24-dibujos-github.png') });
  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);

  await browser.close();
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Dibujos en la app publicada: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ Flecha, camino y gestor funcionan en la app publicada.\n');
  else { console.log('❌ Hay fallos en la app publicada.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
