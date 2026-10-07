/* =========================================================================
 * visor-sanitizado.test.js — Simula el visor de vista previa que NO ejecuta
 * JavaScript y que, además, "sanea" el HTML quitando las etiquetas <script>
 * pero DEJANDO su contenido dentro del documento (es lo que hace la app móvil:
 * por eso el código aparecía como texto suelto por la pantalla).
 *
 * Qué debe cumplirse:
 *   1) El aviso de emergencia sale visible y en primer plano
 *   2) NO se ve ni una línea de código JavaScript por la página
 *   3) La página no genera elementos fantasma a partir del código
 *
 * Uso:  node tests/visor-sanitizado.test.js
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
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

/** Saneado tal y como lo hace el visor: fuera etiquetas, dentro contenido. */
function sanear(html) {
  return html
    .replace(/<script\b[^>]*>/gi, '')     // quita la etiqueta de apertura
    .replace(/<\/script\s*>/gi, '')       // quita la de cierre
    .replace(/<link\b[^>]*>/gi, '');      // (y cualquier recurso externo)
}

(async () => {
  const SRC = path.join(__dirname, '..', 'bar-replay-pro-unico.html');
  const html = fs.readFileSync(SRC, 'utf8');
  const saneado = sanear(html);
  const tmp = path.join(os.tmpdir(), 'brp-saneado.html');
  fs.writeFileSync(tmp, saneado);
  console.log(`\n▸ Original: ${(html.length / 1024).toFixed(0)} KB · tras "sanear" como el visor: ${(saneado.length / 1024).toFixed(0)} KB`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915 });          // móvil típico
  await page.goto('file://' + tmp.replace(/\\/g, '/'), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 800)));

  const r = await page.evaluate(() => {
    const aviso = document.getElementById('brpNoJS');
    const caja = aviso ? aviso.getBoundingClientRect() : null;
    const cajaJS = document.getElementById('brpJS');
    const texto = document.body.innerText || '';
    // Fragmentos de código que aparecían sueltos en la captura del problema
    const marcas = ['U.esc(', 'window.BRP_SNAPSHOT', "' + '", 'function(', 'const ', '=>', 'kline', '</h', 'BRP_'];
    // ¿Qué hay en el centro de la pantalla? Debe ser el aviso, no el código
    const centro = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    // Texto de los bloques visibles que NO son el aviso: no debe oler a código
    const otros = [...document.body.children]
      .filter((e) => e.id !== 'brpNoJS' && e.tagName !== 'STYLE' && getComputedStyle(e).display !== 'none')
      .map((e) => e.textContent || '').join(' ');
    return {
      tapado: !!(caja && centro && aviso.contains(centro)),
      cubreVentana: !!(caja && caja.width >= window.innerWidth - 2 && caja.height >= window.innerHeight - 2),
      avisoTexto: aviso ? aviso.innerText.replace(/\s+/g, ' ').slice(0, 100) : '',
      alto: document.documentElement.scrollHeight,
      restos: marcas.filter((m) => texto.includes(m)),
      restosFuera: marcas.filter((m) => otros.includes(m)),
      contenedorOculto: !!cajaJS && getComputedStyle(cajaJS).display === 'none'
        && (cajaJS.childNodes.length > 0) && (cajaJS.textContent || '').length > 100000,
      largoTexto: texto.replace(/\s+/g, ' ').trim().length,
    };
  });

  console.log('  aviso: «' + r.avisoTexto + '…»');
  console.log('  página: ' + r.alto + 'px de alto · ' + r.largoTexto + ' car. de texto visible (el aviso + la interfaz de la app)');
  ok(r.cubreVentana && r.tapado, 'el aviso ocupa toda la pantalla y está por encima de todo');
  ok(r.restos.length === 0, r.restos.length ? 'quedan restos de código: ' + r.restos.join(' ') : 'ni rastro de código JavaScript en el texto de la página');
  ok(r.restosFuera.length === 0, 'el código no se ha colado en ningún bloque visible fuera del aviso');
  ok(r.alto < 2500, `la página no se estira con el código (${r.alto}px de alto)`);
  ok(r.contenedorOculto, 'el código queda encerrado dentro del contenedor oculto');

  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-13-visor-sin-js.png'), fullPage: false });

  /* Y ahora lo contrario: el archivo SIN sanear debe ejecutarse con normalidad */
  console.log('\n▸ El mismo archivo SIN sanear (navegador normal) sigue funcionando');
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1280, height: 800 });
  await page2.setRequestInterception(true);
  page2.on('request', (q) => {
    const u = q.url();
    return (u.startsWith('file://') || u.startsWith('data:')) ? q.continue() : q.abort('failed');
  });
  await page2.goto('file://' + SRC.replace(/\\/g, '/'), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page2.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  const st = await page2.evaluate(() => ({
    velas: App.candles.length, fuente: App.source,
    aviso: !!document.getElementById('brpNoJS'),
    contenedorInvisible: getComputedStyle(document.getElementById('brpJS')).display,
    grafico: Math.round(document.getElementById('chartWrap').getBoundingClientRect().height),
  }));
  console.log('  ', JSON.stringify(st));
  ok(st.velas >= 2000, `arranca con las velas reales (${st.velas} · ${st.fuente})`);
  ok(!st.aviso, 'el aviso de emergencia desaparece cuando sí hay JavaScript');
  ok(st.contenedorInvisible === 'none', 'el contenedor del código sigue invisible (no afecta al diseño)');
  ok(st.grafico > 150, `el gráfico se dibuja (${st.grafico}px)`);

  await browser.close();
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Visor sin JavaScript: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ Con o sin JavaScript, la página siempre se ve bien.\n');
  else { console.log('❌ El visor sin JS no está bien resuelto.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
