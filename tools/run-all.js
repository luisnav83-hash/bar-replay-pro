/* =========================================================================
 * tools/run-all.js — ejecuta TODAS las suites y suma los contadores.
 *
 * Sustituye a encadenar `npm run a && npm run b && …`, que tenía un defecto
 * real: en cuanto fallaba una suite, las siguientes NO se ejecutaban y el
 * informe quedaba a medias (pasó con `arrastrar` tapando a `promediar`).
 * Aquí cada suite corre siempre, y al final se imprime la tabla con cuántas
 * comprobaciones ha hecho cada una, cuántas han fallado y cuántas se han
 * omitido por falta de dependencias (puppeteer, jsdom…).
 *
 * Uso:  node tools/run-all.js   ·   npm run test:all
 *       node tools/run-all.js promediar trailing   → solo esas dos
 * =======================================================================*/
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));

// Orden del script `test:all` original: se toman los `test:*` declarados, en orden.
// Las suites «publicadas» (test:pages, test:pages-dibujos) comprueban lo que ya
// está en GitHub Pages: tardan, dependen de la red y fallan durante el minuto que
// Pages tarda en desplegar. No van en la batería local; se piden con --publicadas.
const PUBLICADAS = ['test:pages', 'test:pages-dibujos'];
const pedirPublicadas = process.argv.includes('--publicadas');
const nombres = Object.keys(pkg.scripts)
  .filter((k) => k.startsWith('test') && k !== 'test:all')
  .filter((k) => pedirPublicadas || !PUBLICADAS.includes(k))
  .filter((k) => k !== '--publicadas');
const filtro = process.argv.slice(2);
const elegir = filtro.length
  ? nombres.filter((n) => filtro.some((f) => n === f || n === 'test:' + f || n.endsWith(f)))
  : nombres;
if (!elegir.length) { console.error('Ninguna suite coincide con el filtro: ' + filtro.join(', ')); process.exit(2); }

/** Los scripts imprimen su resumen con formatos distintos: se aceptan todos. */
function leerContador(salida) {
  const patrones = [
    /(\d+)\s+superadas,\s*(\d+)\s+fallidas/g,                 // la mayoría (ok/fallo propios)
    /Pruebas(?: de DOM| de red| en iframe sandboxeado)?\s*superadas:\s*(\d+)\s+Fallidas:\s*(\d+)/g,
    /superadas:\s*(\d+)[^\n]*?fallidas:\s*(\d+)/gi,
  ];
  let mejor = null;
  for (const re of patrones) {
    let m;
    while ((m = re.exec(salida)) !== null) mejor = { pasan: +m[1], fallan: +m[2] };
  }
  return mejor;
}

const filas = [];
let totPasan = 0, totFallan = 0, totSinContador = 0;

for (const nombre of elegir) {
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const t0 = Date.now();
  const r = spawnSync(cmd, ['run', '-s', nombre], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const salida = (r.stdout || '') + (r.stderr || '');
  const c = leerContador(salida);
  const fallos = (salida.match(/✗/g) || []).length;
  const omitidas = (salida.match(/OMIT/g) || []).length;
  const code = r.status === null ? 'señal' : r.status;
  const pasan = c ? c.pasan : 0;
  const fallan = c ? c.fallan : (code === 0 ? 0 : 1);
  if (!c) totSinContador++;
  totPasan += pasan; totFallan += fallan;
  filas.push({
    nombre, pasan, fallan, omitidas, fallos, code,
    ms: Math.round((Date.now() - t0) / 1000),
    salida,
  });
  const marca = fallan || code !== 0 ? '✗' : '✓';
  console.log(`${marca} ${nombre.padEnd(22)} ${String(pasan || '—').padStart(4)} ✓  ${String(fallan).padStart(2)} ✗  ${String(omitidas).padStart(2)} omit  ${filas[filas.length - 1].ms}s`);
  if (fallan || code !== 0) {
    const lineas = salida.split('\n').filter((l) => /✗|Error|💥/.test(l)).slice(0, 12);
    for (const l of lineas) console.log('      ' + l.trim());
  }
}

console.log('\n' + '─'.repeat(64));
console.log(`${elegir.length} suites · ${totPasan} comprobaciones contadas · ${totFallan} fallidas` +
            (totSinContador ? ` · ${totSinContador} sin contador propio` : ''));
const malas = filas.filter((f) => f.fallan || f.code !== 0);
if (malas.length) {
  console.log('❌ Fallan: ' + malas.map((f) => f.nombre).join(', '));
  process.exit(1);
}
console.log('✅ Todas las suites pasan.');
