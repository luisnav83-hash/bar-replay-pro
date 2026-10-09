/* =========================================================================
 * dibujos.test.js — DIBUJOS: herramientas nuevas + gestor
 *
 *   A) La elipse (que crea el gesto) se PINTA de verdad y se puede tocar
 *      (antes su código de pintado estaba en la función equivocada)
 *   B) Flecha: 2 clics crean una flecha y vuelve al cursor
 *   C) Camino: clics + doble clic (o Enter) crean una polilínea de N puntos
 *   D) El gestor lista, cuenta, oculta (👁), renombra y borra (✕ / borrar todo)
 *   E) Lo oculto no se pinta ni se puede seleccionar, y se guarda al serializar
 *   F) Sin errores de JavaScript
 *
 * Uso:  node tests/dibujos.test.js
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.accept());          // «¿Borrar todos los dibujos?» → sí

  // Sin red: se usan las velas de la instantánea / DEMO
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    return (u.startsWith('file://') || u.startsWith('data:')) ? r.continue() : r.abort('failed');
  });

  const FILE = 'file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html').replace(/\\/g, '/');
  console.log('\n▸ Abriendo el archivo único sin red');
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await wait(900);

  // Zona de trabajo en el gráfico (fracciones del rectángulo del chart)
  const rect = await page.evaluate(() => {
    const r = document.getElementById('chartWrap').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const P = (fx, fy) => ({ x: Math.round(rect.x + rect.w * fx), y: Math.round(rect.y + rect.h * fy) });
  const clic = async (fx, fy) => { const p = P(fx, fy); await page.mouse.click(p.x, p.y); await wait(140); };
  const mover = async (fx, fy) => { const p = P(fx, fy); await page.mouse.move(p.x, p.y); await wait(60); };
  const dbl = async (fx, fy) => {
    const p = P(fx, fy);
    await page.mouse.click(p.x, p.y, { clickCount: 2, delay: 40 });
    await wait(250);
  };
  const tipos = () => page.evaluate(() => DT.drawings.map((d) => d.type));
  const nDib = () => page.evaluate(() => DT.drawings.length);

  /* ---------- A) La elipse se pinta y se puede tocar ---------- */
  console.log('\n▸ A) Elipse (regresión del gesto)');
  const A = await page.evaluate(() => {
    DT.clearAll(true);
    // Se coloca dentro de lo que se ve ahora mismo (el replay solo muestra
    // las velas hasta el índice actual, así que hay que usar el rango visible)
    const vr = CM.main.timeScale().getVisibleLogicalRange();
    const i1 = Math.max(0, Math.round(vr.from + (vr.to - vr.from) * 0.30));
    const i2 = Math.max(0, Math.round(vr.from + (vr.to - vr.from) * 0.62));
    const v1 = CM.candles[i1], v2 = CM.candles[i2];
    DT._addDrawing({ type: 'ellipse', style: { color: '#00e5ff', width: 2, style: 'solid' },
                     points: [{ dtime: v1.time, price: v1.low }, { dtime: v2.time, price: v2.high }] });
    const d = DT.drawings[0];
    // ¿Se pinta? Comparamos los píxeles del lienzo con y sin el dibujo
    DT.render();
    const ctx = DT.canvas.getContext('2d');
    const con = ctx.getImageData(0, 0, DT.width, DT.height).data;
    let pintados = 0;
    for (let i = 3; i < con.length; i += 4) if (con[i] > 0) pintados++;
    const alto = DT.height;
    DT.drawings.forEach((x) => { x.hidden = true; });
    DT.render();
    const sin = ctx.getImageData(0, 0, DT.width, DT.height).data;
    let pintadosSin = 0;
    for (let i = 3; i < sin.length; i += 4) if (sin[i] > 0) pintadosSin++;
    DT.drawings.forEach((x) => { x.hidden = false; });
    DT.render();
    // ¿Se puede seleccionar con el ratón? (esto lanzaba un error antes)
    // Punto del BORDE derecho de la elipse (k = 1): ahí sí debe reconocerla
    const p = DT._screenPoint(d.points[0]);
    const q = DT._screenPoint(d.points[1]);
    const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2, rx = Math.abs(q.x - p.x) / 2;
    const hit = DT._hitTest(cx + rx, cy);
    return { pintados, pintadosSin, alto, tocado: !!(hit && hit.drawing === d) };
  });
  ok(A.pintados > 0 && A.pintados > A.pintadosSin, `la elipse se pinta (${A.pintados} píxeles con dibujo vs ${A.pintadosSin} sin él)`);
  ok(A.tocado, 'se puede seleccionar sin errores (el clic la reconoce)');

  /* ---------- B) Flecha ---------- */
  console.log('\n▸ B) Flecha (2 clics)');
  await page.evaluate(() => DT.clearAll(true));
  await page.click('#drawToolbar .tool[data-tool="arrow"]');
  await wait(200);
  const B0 = await page.evaluate(() => !!document.querySelector('#drawToolbar .tool.active[data-tool="arrow"]'));
  ok(B0, 'la barra marca la herramienta Flecha como activa');
  await clic(0.30, 0.68);
  await clic(0.52, 0.40);
  const B1 = await tipos();
  ok(B1.length === 1 && B1[0] === 'arrow', `dos clics crean la flecha (${B1.join(', ')})`);
  const B2 = await page.evaluate(() => DT.tool);
  ok(B2 === 'cursor', 'al terminar vuelve al cursor');

  /* ---------- C) Camino ---------- */
  console.log('\n▸ C) Camino / polilínea');
  await page.click('#drawToolbar .tool[data-tool="path"]');
  await wait(200);
  await clic(0.25, 0.75);
  await clic(0.38, 0.55);
  await mover(0.50, 0.62);
  await dbl(0.62, 0.45);                       // doble clic = terminar
  const C1 = await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'path');
    return d ? d.points.length : 0;
  });
  ok(C1 >= 3, `el doble clic cierra el camino con sus ${C1} puntos`);
  const C2 = await page.evaluate(() => DT.tool);
  ok(C2 === 'cursor', 'y también vuelve al cursor');

  // Un segundo camino, terminado con Enter
  await page.click('#drawToolbar .tool[data-tool="path"]');
  await wait(150);
  await clic(0.66, 0.30);
  await clic(0.74, 0.22);
  await mover(0.82, 0.30);
  await page.keyboard.press('Enter');
  await wait(300);
  const C3 = await page.evaluate(() => DT.drawings.filter((x) => x.type === 'path').length);
  ok(C3 === 2, `Enter también lo termina (hay ${C3} caminos)`);

  /* ---------- D) Gestor de dibujos ---------- */
  console.log('\n▸ D) Gestor de dibujos (panel inferior)');
  await page.evaluate(() => {
    const t = document.querySelector('.tab[data-tab="drawings"]');
    if (t) t.click();
  });
  await wait(300);
  const D1 = await page.evaluate(() => ({
    filas: document.querySelectorAll('#drawList .draw-item').length,
    total: (document.querySelector('#drawList .draw-total') || {}).textContent || '',
    barra: !!document.querySelector('#drawList .draw-bar'),
    ojos: document.querySelectorAll('#drawList [data-eye]').length,
    contador: document.getElementById('tabDrawCount').textContent,
  }));
  ok(D1.filas === 3 && D1.contador === '3', `lista los 3 dibujos (${D1.filas} filas · contador ${D1.contador})`);
  ok(D1.barra && D1.ojos === 3, `con barra de gestor y un 👁 por fila (${D1.total})`);

  // 👁 ocultar la flecha
  await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'arrow');
    document.querySelector(`#drawList [data-eye="${d.id}"]`).click();
  });
  await wait(250);
  const D2 = await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'arrow');
    const fila = document.querySelector(`#drawList .draw-item[data-id="${d.id}"]`);
    return { oculto: !!d.hidden, clase: fila.classList.contains('oculto'), total: document.querySelector('#drawList .draw-total').textContent };
  });
  ok(D2.oculto && D2.clase, `el 👁 oculta la flecha (${D2.total})`);

  // Renombrar un camino con doble clic en su nombre
  await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'path');
    const nom = document.querySelector(`#drawList [data-nombre="${d.id}"]`);
    nom.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await wait(250);
  await page.evaluate(() => {
    const inp = document.querySelector('#drawList .draw-edit');
    inp.value = 'Mi camino';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await wait(300);
  const D3 = await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'path');
    return { label: d.label, enLista: document.querySelector(`#drawList [data-nombre="${d.id}"]`).textContent };
  });
  ok(D3.label === 'Mi camino' && /Mi camino/.test(D3.enLista), `doble clic en el nombre lo renombra (${D3.enLista})`);

  // ✕ borra solo ese dibujo
  await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.label === 'Mi camino');
    document.querySelector(`#drawList [data-del="${d.id}"]`).click();
  });
  await wait(250);
  ok((await nDib()) === 2, `la ✕ borra ese dibujo (quedan ${await nDib()})`);

  /* ---------- E) Oculto = ni se pinta ni se toca; y se guarda ---------- */
  console.log('\n▸ E) Lo oculto no molesta y se guarda');
  const E1 = await page.evaluate(() => {
    const d = DT.drawings.find((x) => x.type === 'arrow');
    const p = DT._screenPoint(d.points[0]);
    const q = DT._screenPoint(d.points[1]);
    return !!DT._hitTest((p.x + q.x) / 2, (p.y + q.y) / 2);
  });
  ok(!E1, 'un dibujo oculto no se puede seleccionar por error');
  const E2 = await page.evaluate(() => {
    const json = JSON.parse(JSON.stringify(DT.serialize()));
    DT.restore(json);
    const d = DT.drawings.find((x) => x.type === 'arrow');
    return { oculto: !!d.hidden, n: DT.drawings.length };
  });
  ok(E2.oculto && E2.n === 2, 'el estado oculto se guarda y se recupera (sesiones/instantáneas)');

  // «Borrar todo» de la barra del gestor
  await page.evaluate(() => document.querySelector('#drawList [data-eye-all]').click());
  await wait(250);
  const E3 = await page.evaluate(() => DT.drawings.every((d) => d.hidden));
  ok(E3, 'el botón «Ocultar todos» funciona');
  await page.evaluate(() => document.querySelector('#drawList [data-clear]').click());
  await wait(300);
  ok((await nDib()) === 0, '«Borrar todo» deja el gráfico limpio (con confirmación)');

  /* ---------- F) Captura y errores ---------- */
  await page.evaluate(() => {
    // Quitamos los avisos flotantes para que la captura salga limpia
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    DT.clearAll(true);
    DT._addDrawing({ type: 'arrow', style: { color: '#00c853', width: 2, style: 'solid' },
                     points: [{ dtime: CM.candles[700].time, price: CM.candles[700].low * 0.999 },
                              { dtime: CM.candles[760].time, price: CM.candles[760].high }] });
    DT._addDrawing({ type: 'path', style: { color: '#ffab00', width: 2, style: 'solid' },
                     points: [0, 90, 170, 240].map((k) => ({ dtime: CM.candles[640 + k].time, price: CM.candles[640 + k].close })) });
    DT._addDrawing({ type: 'path', label: 'Mi camino', style: { color: '#00e5ff', width: 2, style: 'solid' },
                     points: [0, 60, 130, 190, 250].map((k) => ({ dtime: CM.candles[700 + k].time, price: CM.candles[700 + k].high * 1.001 })) });
    // Elipse dentro de lo que se ve ahora mismo (zona de giro del precio)
    const vr = CM.main.timeScale().getVisibleLogicalRange();
    const iE1 = Math.max(0, Math.round(vr.from + (vr.to - vr.from) * 0.10));
    const iE2 = Math.max(0, Math.round(vr.from + (vr.to - vr.from) * 0.26));
    DT._addDrawing({ type: 'ellipse', style: { color: '#2979ff', width: 2, style: 'solid' },
                     points: [{ dtime: CM.candles[iE1].time, price: CM.candles[iE1].low * 0.994 },
                              { dtime: CM.candles[iE2].time, price: CM.candles[iE2].high * 1.006 }] });
    const t = document.querySelector('.tab[data-tab="drawings"]');
    if (t) t.click();
    DT.render(); DT.renderList(document.getElementById('drawList'));
  });
  await wait(600);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-23-dibujos-flecha-camino.png') });

  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);

  await browser.close();
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Dibujos (herramientas + gestor): ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El gestor de dibujos y las herramientas nuevas funcionan.\n');
  else { console.log('❌ Hay fallos en los dibujos.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
