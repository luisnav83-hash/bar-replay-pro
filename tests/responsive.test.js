/* =========================================================================
 * responsive.test.js — La app debe ser usable en CUALQUIER tamaño de panel:
 * sin recortes, sin solapes y con los controles de replay siempre a la vista.
 *
 * Se prueba el PEOR CASO: el archivo único (modo visor, sin red) con DOS
 * paneles de indicadores abiertos (RSI + MACD), que es lo que más espacio
 * consume por debajo del gráfico.
 *
 * No necesita servidor: abre bar-replay-pro-unico.html con file://
 * Uso:  node tests/responsive.test.js
 * =======================================================================*/
'use strict';

const path = require('path');
const puppeteer = require((process.env.PPTR_PATH || '/home/user/.cache/pptr/node_modules/puppeteer'));

const TAMANOS = [
  [1680, 950], [1400, 900], [1280, 800], [1100, 820],
  [1000, 780], [900, 700], [1400, 560], [1600, 880], [1440, 760], [480, 900],
];

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
  page.on('pageerror', (e) => { fallan++; console.log('  ✗ error de JS: ' + e.message); });

  // Sin red: exactamente como dentro del visor
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.abort('failed');
  });

  const FILE = 'file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html').replace(/\\/g, '/');
  console.log('\n▸ Abriendo el archivo único sin red (peor caso: RSI + MACD abiertos)');
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.evaluate(() => {
    App.indicators.rsi.on = true; App.indicators.macd.on = true;
    App.applyIndicators(App.indicators, true);
  });
  await wait(400);

  console.log('\n▸ Tamaños de panel (gráfico · solape con la barra de replay · desbordes)');
  for (const [w, h] of TAMANOS) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await wait(450);
    const m = await page.evaluate(() => {
      const R = (id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect() : null; };
      const wrap = R('chartWrap'), rp = R('replayBar'), ws = R('workspace'), ca = R('chartArea');
      const panes = [...document.querySelectorAll('.indPane')].filter((e) => e.offsetHeight > 0).map((e) => e.getBoundingClientRect());
      const paneBottom = panes.length ? Math.max(...panes.map((x) => x.bottom)) : 0;
      const play = R('btnPlay');
      return {
        chart: Math.round(wrap.height), panes: panes.length,
        fila: Math.round(parseFloat(getComputedStyle(document.getElementById('chartArea')).gridTemplateRows.split(' ')[1] || '0')),
        sobrePaneles: Math.max(0, Math.round(wrap.bottom - (R('paneArea') || { bottom: wrap.bottom }).bottom)),
        solape: paneBottom > rp.top + 2 ? Math.round(paneBottom - rp.top) : 0,
        ovx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        recorteInterno: Math.round(Math.max(0, ca.bottom - ws.bottom)) + Math.round(Math.max(0, ws.bottom - R('bottomPanel').top)),
        playVisible: play.width > 0 && play.top >= 0 && play.bottom <= window.innerHeight + 2,
      };
    });
    /* QUÉ SE PROMETE AQUÍ, y por qué no es «200 px siempre». Este bloque abre RSI + MACD
       ANTES de medir —es el PEOR caso de la escalera—, y en un panel de 780 px de alto
       con tres paneles no hay 200 px de velas sin robarle el sitio al formulario de
       órdenes o a las tarjetas del registro (medido con los 240 px de `min-height` del
       gráfico: se pintaban 66 px ENCIMA de sus propios paneles; ver PC.comprimeEscalera).
       Lo que este contrato sí exige, y es lo que deja la app usable, es geométrico: la
       caja del gráfico mide lo que hay (caja == fila), 0 px pintados sobre la escalera y
       al menos el suelo duro de 120 px. La promesa numérica de «≥200 px de alto útil»
       vive donde se mide con la escalera por defecto (un solo panel de indicadores):
       tests/browser.capture.js, en 480×900 —204 px medidos, y 146 px honestos en el
       teléfono de 390×844, que es lo que cabe sin tocar nada alcanzable—. */
    const etiqueta = `${w}×${h}`;
    ok(m.chart >= 120 && m.chart === m.fila, `${etiqueta}: el gráfico conserva ${m.chart}px en el PEOR caso de escalera (fila ${m.fila}px, suelo 120px)`);
    ok(m.solape === 0, `${etiqueta}: los paneles de indicadores no tapan la barra de replay`);
    ok(m.sobrePaneles === 0, `${etiqueta}: y el gráfico no pinta encima de los paneles de indicadores (${m.sobrePaneles}px)`);
    ok(m.ovx === 0, `${etiqueta}: sin desbordamiento horizontal (${m.ovx}px)`);
    ok(m.recorteInterno === 0, `${etiqueta}: nada se recorta entre el gráfico y el panel inferior`);
    ok(m.playVisible, `${etiqueta}: el botón PLAY es visible sin desplazar`);
  }

  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await wait(400);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-08-visor-embebido.png') });

  await browser.close();
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Comprobaciones adaptables: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ La app es usable en cualquier tamaño de panel.\n');
  else { console.log('❌ Hay tamaños donde el diseño falla.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
