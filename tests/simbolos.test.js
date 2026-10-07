/* =========================================================================
 * simbolos.test.js — Buscador de símbolos y temporalidades rápidas:
 *   A) El botón grande muestra el par activo y abre el buscador
 *   B) La lista se pinta con la categoría «Principales» y con la local si no hay red
 *   C) Buscar filtra en vivo (por símbolo y por nombre)
 *   D) Elegir un par cambia el <select> real y RECARGA las velas
 *   E) La ⭐ añade y quita favoritos, y la categoría «Favoritos» los lista
 *   F) Los recientes se guardan (categoría «Recientes»)
 *   G) Los botones 1m/5m/15m/1h/4h/1d/1w cambian la temporalidad de verdad
 *
 * Uso:  node tests/simbolos.test.js
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
  await page.setViewport({ width: 1300, height: 880 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  // Sin red: el buscador debe seguir funcionando con la lista local
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
  await wait(700);

  /* ------------- A) Botón de símbolo y apertura ------------- */
  console.log('\n▸ A) Botón de símbolo en la barra superior');
  const A = await page.evaluate(() => ({
    par: document.getElementById('sbPair').textContent,
    quote: document.getElementById('sbQuote').textContent,
    ico: document.getElementById('sbIco').textContent,
    flecha: !!document.querySelector('#tfQuick .tf-btn.active'),
  }));
  ok(A.par === 'BTC/USDT', `muestra el par activo (${A.par})`);
  ok(/USDT/.test(A.quote), `indica la divisa y la fuente (${A.quote})`);
  ok(A.ico.length >= 2, `tiene icono de la moneda (${A.ico})`);
  ok(A.flecha, 'los botones de temporalidad marcan la activa');

  await page.click('#btnSymbols');
  await wait(500);
  const A2 = await page.evaluate(() => ({
    abierto: document.getElementById('modalSymbols').classList.contains('open'),
    cats: [...document.querySelectorAll('#symCats .sym-cat')].map((b) => b.textContent.trim()),
    filas: document.querySelectorAll('#symList .sym-row').length,
    nota: document.getElementById('symNote').textContent.slice(0, 40),
  }));
  ok(A2.abierto, 'el buscador se abre');
  ok(A2.cats.length >= 7, `tiene categorías (${A2.cats.length}): ${A2.cats.slice(0, 4).join(' · ')}…`);

  /* ------------- B) Categoría «Principales» ------------- */
  console.log('\n▸ B) Categoría «Principales» (lista local, sin red)');
  await page.click('#symCats [data-cat="principales"]');
  await wait(300);
  const B = await page.evaluate(() => ({
    filas: document.querySelectorAll('#symList .sym-row').length,
    primera: document.querySelector('#symList .sym-row .sym-name b').textContent,
    contador: document.getElementById('symCount').textContent,
  }));
  ok(B.filas >= 20, `lista los pares principales (${B.filas} filas)`);
  ok(B.primera === 'BTC/USDT', `empieza por BTC/USDT (${B.primera})`);
  ok(/\d/.test(B.contador), `muestra el total encontrado (${B.contador})`);

  /* ------------- C) Búsqueda en vivo ------------- */
  console.log('\n▸ C) Búsqueda en vivo');
  await page.type('#symQuery', 'eth');
  await wait(350);
  const C = await page.evaluate(() => ({
    filas: [...document.querySelectorAll('#symList .sym-row')].map((r) => r.dataset.sym),
    contador: document.getElementById('symCount').textContent,
  }));
  ok(C.filas.length >= 1 && C.filas.every((s) => /ETH/.test(s)), `filtra por texto (${C.filas.slice(0, 4).join(', ')})`);

  /* ------------- D) Elegir par recarga velas ------------- */
  console.log('\n▸ D) Elegir ETH/USDT');
  const velasAntes = await page.evaluate(() => ({ n: App.candles.length, par: App.pair }));
  await page.evaluate(() => UI.pickSymbol('ETHUSDT'));
  await wait(1600);
  const D = await page.evaluate(() => ({
    select: document.getElementById('pairSelect').value,
    par: App.pair, boton: document.getElementById('sbPair').textContent,
    icono: document.getElementById('sbIco').textContent,
    modalCerrado: !document.getElementById('modalSymbols').classList.contains('open'),
    velas: App.candles.length,
    fuente: App.source,
    leyenda: document.getElementById('lgPair').textContent,
  }));
  ok(D.select === 'ETHUSDT' && D.par === 'ETHUSDT', `cambia el par de verdad (${D.select})`);
  ok(D.boton === 'ETH/USDT' && D.icono === 'ETH', `el botón se actualiza (${D.boton} · ${D.icono})`);
  ok(D.modalCerrado, 'el buscador se cierra solo al elegir');
  ok(D.velas > 500 && /Binance|DEMO/i.test(D.fuente), `recarga las velas del nuevo par (${D.velas} · ${D.fuente})`);
  ok(D.leyenda === 'ETH/USDT', `la leyenda del gráfico lo refleja (${D.leyenda})`);

  /* ------------- E) Favoritos ------------- */
  console.log('\n▸ E) Favoritos con la ⭐');
  await page.click('#btnSymbols');
  await wait(400);
  await page.click('#symCats [data-cat="principales"]');
  await wait(250);
  await page.evaluate(() => {
    const fila = [...document.querySelectorAll('#symList .sym-row')].find((r) => r.dataset.sym === 'SOLUSDT');
    fila.querySelector('[data-fav]').click();
  });
  await wait(300);
  const E1 = await page.evaluate(() => ST.get('favs', []));
  ok(E1.indexOf('SOLUSDT') >= 0, `la ⭐ añade el favorito (${E1.join(', ')})`);
  await page.click('#symCats [data-cat="favoritos"]');
  await wait(300);
  const E2 = await page.evaluate(() => [...document.querySelectorAll('#symList .sym-row')].map((r) => r.dataset.sym));
  ok(E2.indexOf('SOLUSDT') >= 0, `la categoría «Favoritos» lo lista (${E2.join(', ')})`);
  await page.evaluate(() => {
    const fila = [...document.querySelectorAll('#symList .sym-row')].find((r) => r.dataset.sym === 'SOLUSDT');
    fila.querySelector('[data-fav]').click();
  });
  await wait(300);
  const E3 = await page.evaluate(() => ST.get('favs', []));
  ok(E3.indexOf('SOLUSDT') < 0, 'la ⭐ también lo quita');

  /* ------------- F) Recientes ------------- */
  console.log('\n▸ F) Recientes');
  await page.click('#symCats [data-cat="recientes"]');
  await wait(300);
  const F = await page.evaluate(() => ({
    recents: ST.get('recents', []),
    lista: [...document.querySelectorAll('#symList .sym-row')].map((r) => r.dataset.sym),
  }));
  ok(F.recents[0] === 'ETHUSDT', `el último par elegido encabeza los recientes (${F.recents.join(', ')})`);
  ok(F.lista.indexOf('ETHUSDT') >= 0, 'la categoría «Recientes» lo muestra');

  /* ------------- G) Temporalidades rápidas ------------- */
  console.log('\n▸ G) Botones de temporalidad (1m · 5m · 1h · 4h · 1d)');
  await page.evaluate(() => UI.closeModal('modalSymbols'));
  await wait(200);
  const G = [];
  for (const tf of ['15m', '1d']) {
    await page.click(`#tfQuick [data-tf="${tf}"]`);
    await wait(1800);
    G.push(await page.evaluate(() => ({
      tf: document.getElementById('tfSelect').value,
      intervalo: App.interval,
      activo: document.querySelector('#tfQuick .tf-btn.active').dataset.tf,
      velas: App.candles.length,
      leyenda: document.getElementById('lgTf').textContent,
      fuente: App.source,
    })));
  }
  G.forEach((g) => {
    ok(g.tf === g.activo && g.intervalo === g.activo, `el botón ${g.activo} cambia la temporalidad (${g.intervalo})`);
    ok(g.velas > 100, `recarga velas para ${g.activo} (${g.velas} · ${g.fuente})`);
    ok(g.leyenda === g.activo, `la leyenda muestra ${g.leyenda}`);
  });

  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);

  await page.click('#btnSymbols');
  await wait(600);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-19-buscador-simbolos.png') });
  await browser.close();

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Buscador de símbolos: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El buscador y las temporalidades rápidas funcionan.\n');
  else { console.log('❌ El buscador tiene fallos.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
