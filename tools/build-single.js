/* =========================================================================
 * tools/build-single.js — Construye una versión AUTOCONTENIDA y de UN SOLO
 * ARCHIVO de la aplicación (bar-replay-pro-unico.html):
 *
 *   · CSS incrustado en <style>
 *   · Todo el JavaScript incrustado en <script>
 *   · Lightweight Charts incrustada
 *   · Favicon como data URI
 *
 *  Sirve para abrir la app con doble clic (file://), incrustarla en un
 *  visor o enviarla por correo. Sin red externa arranca en modo DEMO, así
 *  que es totalmente funcional en cualquier entorno aislado.
 *
 *  Uso:  node tools/build-single.js
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'bar-replay-pro-unico.html');

/** Evita que el contenido incrustado cierre la etiqueta <script>. */
const safeJS = (code) => code.replace(/<\/script/gi, '<\\/script');

/** Minificado muy ligero: comentarios de bloque y líneas en blanco sobrantes. */
function lightMinifyCSS(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n+/g, '\n').trim();
}

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ------------------------------ 1) CSS ------------------------------ */
const cssFiles = [...html.matchAll(/<link[^>]+href="(css\/[^"]+)"[^>]*>/g)].map((m) => m[1]);
if (!cssFiles.length) throw new Error('No se encontraron hojas de estilo enlazadas en index.html');

const cssBundle = cssFiles
  .map((f) => `/* ==== ${f} ==== */\n` + lightMinifyCSS(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .join('\n');
html = html.replace(/<link[^>]+href="css\/[^"]+"[^>]*>\s*/g, '');
html = html.replace('</head>', () => `<style>\n${safeJS(cssBundle)}\n</style>\n</head>`);

/* --------------------------- 2) Favicon --------------------------- */
try {
  const svg = fs.readFileSync(path.join(ROOT, 'assets/icons/favicon.svg'), 'utf8');
  const dataUri = 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/%20/g, ' ');
  html = html.replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" type="image/svg+xml" href="${dataUri}">`);
} catch (e) { /* el favicon es opcional */ }

/* ---------------------------- 3) JavaScript ---------------------------- */
const scriptRe = /<script src="([^"]+)"><\/script>/g;
const scripts = [...html.matchAll(scriptRe)];
if (scripts.length < 5) throw new Error('No se encontraron los scripts esperados en index.html');

console.log('Archivos incrustados:');
let jsBundle = '';
for (const [, src] of scripts) {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  console.log(`  · ${src.padEnd(52)} ${(code.length / 1024).toFixed(0)} KB`);
  jsBundle += `\n/* ==================== ${src} ==================== */\n${safeJS(code)}\n`;
}
html = html.replace(scriptRe, '');

/* ------------------- 3.5) Velas REALES incrustadas -------------------
 * snapshot/velas-reales.json se genera con `node tools/snapshot.js` y contiene
 * velas reales de Binance. Van dentro del archivo para que, cuando el entorno
 * no tenga salida a internet (visores embebidos), la app muestre PRECIOS
 * REALES en lugar de datos sintéticos. */
const snapPath = path.join(ROOT, 'snapshot', 'velas-reales.json');
let snapJS = '';
if (fs.existsSync(snapPath)) {
  const raw = fs.readFileSync(snapPath, 'utf8').trim();
  snapJS = `\n/* ============ snapshot/velas-reales.json (velas reales incrustadas) ============ */\n` +
           `window.BRP_SNAPSHOT = ${raw.replace(/<\/script/gi, '<\\/script')};\n`;
  const kb = (raw.length / 1024).toFixed(0);
  console.log(`  · snapshot/velas-reales.json (velas reales)`.padEnd(62) + `${kb} KB`);
} else {
  console.log('  ⚠ snapshot/velas-reales.json no encontrado: el archivo único saldrá SIN velas reales guardadas.');
}

/* ------------------------- 4) Aviso de versión ------------------------- */
html = html.replace('<body>', () => `<body>
<!-- =====================================================================
     VERSIÓN DE UN SOLO ARCHIVO (generada por tools/build-single.js)
     Todo el HTML, CSS y JavaScript está incrustado: se puede abrir con doble
     clic, sin servidor. Sin acceso a internet arranca en MODO DEMO (velas
     sintéticas); con conexión descarga velas reales de Binance.
     ===================================================================== -->`);

/* ---------------------------------------------------------------------------
 * 4.5) ENVOLTORIO A PRUEBA DE VISORES QUE "SANEAN" EL HTML
 *
 * Algunos visores (p. ej. la vista previa del móvil) NO ejecutan JavaScript:
 * eliminan las etiquetas <script> pero dejan su CONTENIDO en el documento, así
 * que el código aparecía como texto suelto por toda la página.
 *
 * Solución: el <script> va dentro de un contenedor OCULTO. Si el visor elimina
 * las etiquetas, el código restante queda dentro de ese contenedor invisible
 * (no se ve nada raro); y si el navegador es normal, el script se ejecuta con
 * total normalidad, porque la ejecución no depende de que sea visible.
 * ------------------------------------------------------------------------ */
html = html.replace('</body>', () =>
  `<div id="brpJS" hidden style="display:none">\n` +
  `<!-- Contenedor del código. Se oculta a propósito: si un visor elimina la\n` +
  `     etiqueta <script> sin borrar su contenido, el código NO se verá como texto. -->\n` +
  `${''}\n</div>\n</body>`);

/* El script real se inserta DENTRO del contenedor oculto. */
html = html.replace('<div id="brpJS" hidden style="display:none">', () =>
  `<div id="brpJS" hidden style="display:none">\n<script>\n${snapJS}${jsBundle}\n</script>`);

/* --------------------------- 5) Escritura --------------------------- */
fs.writeFileSync(OUT, html);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`\n✅ Generado: ${path.relative(ROOT, OUT)}  (${kb} KB, archivo único)`);
