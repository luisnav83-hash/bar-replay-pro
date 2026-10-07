/* =========================================================================
 * enlaces.test.js — Enlace al proyecto hermano (OpenMarket Chart):
 *   1) Está en el modal de ayuda de index.html, en «Proyectos relacionados»
 *   2) Apunta a la app publicada y al repositorio, con URLs correctas
 *   3) Se abre en pestaña nueva y con rel seguro (noopener noreferrer)
 *   4) También viaja en el archivo único (bar-replay-pro-unico.html)
 *   5) Los estilos del bloque existen en css/modals.css
 *
 * Es una prueba estática (sin navegador ni jsdom).
 * Uso:  node tests/enlaces.test.js
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const modalsCss = fs.readFileSync(path.join(ROOT, 'css', 'modals.css'), 'utf8');
const singlePath = path.join(ROOT, 'bar-replay-pro-unico.html');
const singleHtml = fs.existsSync(singlePath) ? fs.readFileSync(singlePath, 'utf8') : '';

const APP = 'https://luisnav83-hash.github.io/openmarket-chart/';
const REPO = 'https://github.com/luisnav83-hash/openmarket-chart';

let pasan = 0, fallan = 0;
const ok = (cond, msg) => {
  if (cond) { pasan++; console.log('  ✓ ' + msg); }
  else { fallan++; console.log('  ✗ ' + msg); }
};

console.log('\n▸ 1) El bloque existe en el modal de ayuda');
const ayuda = indexHtml.slice(indexHtml.indexOf('id="modalHelp"'));
const bloque = ayuda.slice(ayuda.indexOf('<h4>Proyectos relacionados</h4>'), ayuda.indexOf('</div>\n    <div class="modal-foot"'));
ok(ayuda.includes('<h4>Proyectos relacionados</h4>'), 'sección «Proyectos relacionados» dentro del modal de ayuda');
ok(/<ul class="help-links">/.test(bloque), 'la lista usa la clase .help-links');
ok(bloque.includes('OpenMarket Chart'), 'menciona OpenMarket Chart por su nombre');
ok(/React \+ Vite/.test(bloque), 'aclara que el clon es React + Vite');

console.log('\n▸ 2) Las URLs apuntan donde deben');
ok(indexHtml.includes(`href="${APP}"`), `enlace a la app publicada (${APP})`);
ok(indexHtml.includes(`href="${REPO}"`), `enlace al repositorio del clon (${REPO})`);
ok(indexHtml.includes('href="https://github.com/luisnav83-hash/bar-replay-pro"'), 'enlace al repositorio de este proyecto');
const PERMITIDOS = [
  'https://luisnav83-hash.github.io/openmarket-chart/',
  'https://github.com/luisnav83-hash/openmarket-chart',
  'https://github.com/luisnav83-hash/bar-replay-pro',
];
const ajenos = (bloque.match(/href="([^"]+)"/g) || [])
  .map((h) => h.slice(6, -1))
  .filter((h) => !PERMITIDOS.includes(h));
ok(ajenos.length === 0, `solo los destinos previstos (ajenos: ${ajenos.join(', ') || 'ninguno'})`);

console.log('\n▸ 3) Apertura segura en pestaña nueva');
const enlaces = bloque.match(/<a\b[^>]*>/g) || [];
ok(enlaces.length >= 3, `hay ${enlaces.length} enlaces en el bloque`);
ok(enlaces.every((a) => /target="_blank"/.test(a)), 'todos abren en pestaña nueva');
ok(enlaces.every((a) => /rel="noopener noreferrer"/.test(a)), 'todos llevan rel="noopener noreferrer"');

console.log('\n▸ 4) Estilos del bloque');
ok(modalsCss.includes('.help-links{'), 'la lista tiene estilos en css/modals.css');
ok(modalsCss.includes('.help-link-note{'), 'la nota de cada enlace tiene estilos');

console.log('\n▸ 5) El archivo único también lo lleva');
if (!singleHtml) {
  console.log('  ⚠️  bar-replay-pro-unico.html no está generado: ejecuta `npm run build:single`');
} else {
  ok(singleHtml.includes('Proyectos relacionados'), 'el archivo único incluye la sección');
  ok(singleHtml.includes(APP) && singleHtml.includes(REPO), 'el archivo único incluye las dos URLs del clon');
  ok(singleHtml.length > 300000, `el archivo único sigue completo (${Math.round(singleHtml.length / 1024)} KB)`);
}

console.log('\n────────────────────────────────────────────────────────────');
console.log(`Enlaces: ${pasan} superadas, ${fallan} fallidas`);
if (fallan === 0) console.log('✅ El enlace al proyecto hermano está correcto y es seguro.\n');
else { console.log('❌ Revisa el enlace al proyecto hermano.\n'); process.exit(1); }
