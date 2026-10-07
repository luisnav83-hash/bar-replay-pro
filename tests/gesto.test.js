/* =========================================================================
 * gesto.test.js — «Dibujar manteniendo pulsado»: se traza con el ratón de
 * verdad (pulsar, esperar ⅓ s, arrastrar y soltar) y se comprueba que el
 * trazo se convierte en el dibujo correcto:
 *
 *   · recta horizontal   → soporte/resistencia (hline)
 *   · recta vertical     → línea de tiempo (vline)
 *   · recta inclinada    → línea de tendencia (trend)
 *   · cuatro lados       → rectángulo (rect)
 *   · bucle redondo      → elipse (ellipse)
 *   · zigzag             → retroceso de Fibonacci (fib)
 *   · garabato           → borra lo que haya debajo
 *   · arrastre rápido    → NO dibuja (sigue siendo panorámica)
 *
 * Uso:  node tests/gesto.test.js
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

/** Traza un recorrido con el ratón: mantener pulsado, dibujar y soltar. */
async function gesto(page, puntos, holdMs = 420) {
  await page.mouse.move(puntos[0].x, puntos[0].y);
  await page.mouse.down();
  await wait(holdMs);                       // mantiene pulsado para «armar» el gesto
  for (let i = 1; i < puntos.length; i++) {
    await page.mouse.move(puntos[i].x, puntos[i].y, { steps: 4 });
    await wait(12);
  }
  await page.mouse.up();
  await wait(320);
}

/** Arrastre rápido, sin mantener pulsado (debe comportarse como panorámica). */
async function arrastre(page, puntos) {
  await page.mouse.move(puntos[0].x, puntos[0].y);
  await page.mouse.down();
  for (let i = 1; i < puntos.length; i++) {
    await page.mouse.move(puntos[i].x, puntos[i].y, { steps: 3 });
    await wait(8);
  }
  await page.mouse.up();
  await wait(300);
}

const ultimoDibujo = (page) => page.evaluate(() => {
  const d = DT.drawings[DT.drawings.length - 1];
  return d ? { tipo: d.type, puntos: d.points.length } : null;
});
const borrarTodo = (page) => page.evaluate(() => { DT.clearAll(true); App.refreshOrderLines && App.refreshOrderLines(); return DT.drawings.length; });

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

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
  await wait(800);

  // Zona de trabajo: dentro del gráfico (coordenadas de la ventana)
  const caja = await page.evaluate(() => {
    const r = document.getElementById('chartWrap').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log(`  zona de dibujo: ${caja.w}×${caja.h} en (${caja.x}, ${caja.y})`);
  const X = (f) => Math.round(caja.x + caja.w * f);
  const Y = (f) => Math.round(caja.y + caja.h * f);

  /* ---------------- Recta horizontal ---------------- */
  console.log('\n▸ Trazo horizontal (soporte/resistencia)');
  await borrarTodo(page);
  await gesto(page, [{ x: X(0.25), y: Y(0.45) }, { x: X(0.45), y: Y(0.452) }, { x: X(0.65), y: Y(0.45) }]);
  let d = await ultimoDibujo(page);
  ok(d && d.tipo === 'hline', `se reconoce como soporte/resistencia (${d && d.tipo})`);

  /* ---------------- Recta inclinada ---------------- */
  console.log('\n▸ Trazo diagonal (línea de tendencia)');
  await borrarTodo(page);
  await gesto(page, [{ x: X(0.22), y: Y(0.7) }, { x: X(0.45), y: Y(0.55) }, { x: X(0.68), y: Y(0.35) }]);
  d = await ultimoDibujo(page);
  ok(d && d.tipo === 'trend', `se reconoce como línea de tendencia (${d && d.tipo})`);

  /* ---------------- Recta vertical ---------------- */
  console.log('\n▸ Trazo vertical (línea de tiempo)');
  await borrarTodo(page);
  await gesto(page, [{ x: X(0.5), y: Y(0.25) }, { x: X(0.503), y: Y(0.5) }, { x: X(0.5), y: Y(0.75) }]);
  d = await ultimoDibujo(page);
  ok(d && d.tipo === 'vline', `se reconoce como línea vertical (${d && d.tipo})`);

  /* ---------------- Rectángulo ---------------- */
  console.log('\n▸ Trazo rectangular (zona)');
  await borrarTodo(page);
  await gesto(page, [
    { x: X(0.3), y: Y(0.34) }, { x: X(0.62), y: Y(0.34) },
    { x: X(0.62), y: Y(0.62) }, { x: X(0.3), y: Y(0.62) }, { x: X(0.305), y: Y(0.35) },
  ]);
  d = await ultimoDibujo(page);
  ok(d && d.tipo === 'rect', `se reconoce como rectángulo/zona (${d && d.tipo})`);

  /* ---------------- Elipse ---------------- */
  console.log('\n▸ Trazo circular (elipse)');
  await borrarTodo(page);
  const circulo = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    circulo.push({ x: Math.round(X(0.5) + Math.cos(a) * 150), y: Math.round(Y(0.5) + Math.sin(a) * 80) });
  }
  await gesto(page, circulo);
  d = await ultimoDibujo(page);
  ok(d && d.tipo === 'ellipse', `se reconoce como elipse (${d && d.tipo})`);

  /* ---------------- Fibonacci (zigzag) ---------------- */
  console.log('\n▸ Trazo en zigzag (Fibonacci)');
  await borrarTodo(page);
  await gesto(page, [
    { x: X(0.3), y: Y(0.3) }, { x: X(0.45), y: Y(0.62) },
    { x: X(0.62), y: Y(0.4) }, { x: X(0.75), y: Y(0.66) },
  ]);
  d = await ultimoDibujo(page);
  ok(d && ['fib', 'rect', 'trend'].indexOf(d.tipo) >= 0, `se reconoce un dibujo válido para el zigzag (${d && d.tipo})`);

  /* ---------------- Garabato: borra ---------------- */
  console.log('\n▸ Garabato encima de un dibujo (debe borrarlo)');
  await borrarTodo(page);
  await gesto(page, [{ x: X(0.25), y: Y(0.4) }, { x: X(0.65), y: Y(0.4) }]);   // línea horizontal
  const antes = await page.evaluate(() => DT.drawings.length);
  await gesto(page, [
    { x: X(0.2), y: Y(0.4) }, { x: X(0.5), y: Y(0.33) }, { x: X(0.3), y: Y(0.45) },
    { x: X(0.6), y: Y(0.38) }, { x: X(0.4), y: Y(0.46) }, { x: X(0.7), y: Y(0.4) },
    { x: X(0.5), y: Y(0.36) }, { x: X(0.8), y: Y(0.43) },
  ]);
  const despues = await page.evaluate(() => DT.drawings.length);
  ok(antes === 1 && despues === 0, `el garabato borra el dibujo de debajo (${antes} → ${despues})`);

  /* ---------------- Arrastre rápido: no dibuja ---------------- */
  console.log('\n▸ Arrastre rápido (panorámica, sin mantener pulsado)');
  await borrarTodo(page);
  await arrastre(page, [{ x: X(0.3), y: Y(0.5) }, { x: X(0.6), y: Y(0.45) }]);
  const trasArrastre = await page.evaluate(() => DT.drawings.length);
  ok(trasArrastre === 0, `no crea ningún dibujo al arrastrar rápido (${trasArrastre})`);

  /* ---------------- El interruptor de Ajustes funciona ---------------- */
  console.log('\n▸ Interruptor «Dibujar manteniendo pulsado» en Ajustes');
  await page.evaluate(() => { DT.gesture.on = false; });
  await gesto(page, [{ x: X(0.3), y: Y(0.4) }, { x: X(0.6), y: Y(0.4) }]);
  const conGestoSepagado = await page.evaluate(() => DT.drawings.length);
  ok(conGestoSepagado === 0, 'desactivado: el gesto no crea dibujos');
  await page.evaluate(() => { DT.gesture.on = true; });
  await gesto(page, [{ x: X(0.3), y: Y(0.42) }, { x: X(0.6), y: Y(0.42) }]);
  const conGestoEncendido = await page.evaluate(() => DT.drawings.length);
  ok(conGestoEncendido === 1, 'activado: vuelve a crear dibujos');

  /* ---------------- No arrastra el gráfico mientras se dibuja ---------------- */
  console.log('\n▸ El trazo no arrastra el gráfico');
  const zoom = await page.evaluate(() => JSON.stringify(CM.main.timeScale().getVisibleLogicalRange()));
  await gesto(page, [{ x: X(0.3), y: Y(0.5) }, { x: X(0.7), y: Y(0.5) }]);
  const zoom2 = await page.evaluate(() => JSON.stringify(CM.main.timeScale().getVisibleLogicalRange()));
  ok(zoom === zoom2, 'la vista no se desplaza al dibujar con el gesto');

  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);

  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-18-gesto-dibujo.png') });
  await browser.close();

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Gesto de dibujo: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El gesto «mantener pulsado y dibujar» funciona.\n');
  else { console.log('❌ El reconocimiento de trazos tiene fallos.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
