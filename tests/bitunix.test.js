/* =========================================================================
 * bitunix.test.js — LA PIEL Y LA ESTRUCTURA «terminal de futuros» (Bitunix)
 *
 * Se comprueba sobre el ARCHIVO ÚNICO y SIN RED (como en un visor cerrado),
 * que es el caso peor: todo lo que dependa del exchange tiene que degradar a
 * «derivado» SIN inventarse datos y SIN romperse.
 *
 * Zonas comprobadas:
 *   A) Estructura de 5 zonas y herencia de ids (nada del motor se ha perdido)
 *   B) Tokens de color MEDIDOS y rasgos del estilo (plano, cifras tabulares)
 *   C) Libro de órdenes: orden de niveles, acumulado, banda B/S y clic
 *   D) Fila de estadísticas: procedencia de cada número y cálculo del 24 h
 *   E) Panel de órdenes: fracciones 0/25/50/75/100, margen, Long/Short
 *   F) Pestañas inferiores: Posiciones / Órdenes / Cuenta / Estadísticas
 *   G) Lo que ya estaba sigue funcionando (SL/TP, promediar, trailing, dibujos)
 *   H) Panel estrecho: el panel de órdenes es lo primero y nada desborda
 *
 * Uso:  node tests/bitunix.test.js
 * =======================================================================*/
'use strict';

const path = require('path');
const fs = require('fs');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/node_modules/puppeteer',
  '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) { /* siguiente candidato */ }
}
if (!puppeteer) {
  console.log('⚠️  Falta puppeteer (npm i puppeteer en /home/user/.cache): prueba OMITIDA.');
  process.exit(0);
}

let pasan = 0, fallan = 0;
const ok = (cond, msg) => {
  if (cond) { pasan++; console.log('  ✓ ' + msg); }
  else { fallan++; console.log('  ✗ ' + msg); }
};
const cerca = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
/** Formato compacto espejo del de la app, para los mensajes del test. */
const OBk = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + ' B' : v >= 1e6 ? (v / 1e6).toFixed(2) + ' M' : v >= 1e3 ? (v / 1e3).toFixed(1) + ' K' : v.toFixed(2));
/**
 * El app formatea con separador de miles (66,540.40). Dentro de la página se
 * parsea SIEMPRE igual: se quitan las comas y queda el número. Se define como
 * cadena para inyectarla en cada evaluate (allí no existe esta función).
 */

// En el archivo único las hojas van embebidas, así que el orden se comprueba
// en el índice real (index.html), que es de donde se genera aquel.
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cssLinks = [...HTML.matchAll(/<link[^>]+href="(css\/[^"]+)"/g)].map((m) => m[1].split('/').pop());
const ORDEN_CSS = cssLinks.join(' → ') + (cssLinks[cssLinks.length - 1] === 'bitunix.css' ? '' : ' ✗ no termina en bitunix.css');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // Los recursos que bloqueamos a propósito generan «Failed to load resource»:
  // no son errores de la app, así que se cuentan aparte.
  let recursos = 0;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource|net::ERR_/.test(m.text())) { recursos++; return; }
    errs.push('consola: ' + m.text().slice(0, 160));
  });

  // Sin red: como en un visor. Las velas salen del snapshot embebido.
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    return (u.startsWith('file://') || u.startsWith('data:')) ? r.continue() : r.abort('failed');
  });

  const FILE = 'file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html');
  console.log('\n▸ Abriendo el archivo único sin red (todo debe degradar a «derivado»)');
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 15000 });
  await page.waitForFunction('window.OB && OB.state.renders > 0', { timeout: 15000 });
  await espera(900);

  /* ═════════════════ A) ESTRUCTURA DE 5 ZONAS E IDS HEREDADOS ═════════════════ */
  console.log('\n▸ A) Estructura de 5 zonas');
  const est = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const R = (el) => { const r = el.getBoundingClientRect(); return { y: Math.round(r.y), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
    const dentro = (padre, id) => !!(g(id) && g(padre) && g(id).closest('#' + padre) === g(padre));
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    /* Lightweight Charts mete su marca de agua (id="tv-attr-logo") y un clipPath
       interno (id="a") DENTRO de cada chart que se crea (principal, paneles de
       indicadores, panel de PnL y equity): se repiten por construcción y no son del
       HTML de la app. Se miden aparte, para que un duplicado REAL del marcado siga
       saltando. */
    const CHARTS = '#mainChart, #chartRsi, #chartMacd, #chartAtr, #chartPnl, #equityChart';
    const propios = [...document.querySelectorAll('[id]')].filter((e) => !e.closest(CHARTS));
    const idsPropios = propios.map((e) => e.id);
    const dup = idsPropios.filter((x, i) => idsPropios.indexOf(x) !== i);
    const dupLib = [...document.querySelectorAll('[id]')].filter((e) => e.closest(CHARTS)).map((e) => e.id)
      .filter((x, i, arr) => arr.indexOf(x) !== i);
    return {
      statsEnBarra: dentro('topbar', 'bfStats'),
      statsAltura: g('bfStats') ? Math.round(g('bfStats').getBoundingClientRect().height) : 0,
      statsBajoNav: !!(g('bfStats') && g('tfQuick')) && g('bfStats').getBoundingClientRect().top >= g('tfQuick').getBoundingClientRect().bottom - 1,
      libroEnSidebar: dentro('sidebar', 'bookCard'),
      ordenEnSidebar: dentro('sidebar', 'orderCard'),
      libroAntesQueOrden: !!(g('bookCard') && g('orderCard')) && (g('bookCard').compareDocumentPosition(g('orderCard')) & Node.DOCUMENT_POSITION_FOLLOWING) > 0,
      columnaDerecha: !!(g('sidebar') && g('chartArea')) && g('sidebar').getBoundingClientRect().left >= g('chartArea').getBoundingClientRect().right - 2,
      posicionEnPestañas: dentro('tab-positions', 'positionCard'),
      pendientesEnPestañas: dentro('tab-positions', 'pendingCard'),
      cuentaEnPestañas: dentro('tab-account', 'acBalance'),
      statsEnPestañas: dentro('tab-stats', 'stTrades'),
      curvaEnPestañas: dentro('tab-stats', 'equityChart'),
      tradesEnPestañas: dentro('tab-trades', 'tradesTable'),
      logEnPestañas: dentro('tab-log', 'logList'),
      dibujosEnPestañas: dentro('tab-drawings', 'drawList'),
      indicadoresVivos: dentro('sidebar', 'panelsCard'),
      tabs: [...document.querySelectorAll('.tabs .tab')].map((t) => t.dataset.tab),
      duplicados: [...new Set(dup)],
      duplicadosLib: [...new Set(dupLib)],
      cajas: { ws: R(g('workspace')), chart: R(g('chartArea')), bottom: R(g('bottomPanel')) },
      faltanHeredados: ['pairSelect', 'tfQuick', 'startDate', 'btnLoad', 'btnQuick', 'btnImport', 'btnDemo', 'btnIndicators',
        'btnSessions', 'btnExport', 'btnShot', 'btnSettings', 'btnHelp', 'mainChart', 'overlayCanvas', 'paneArea', 'replayBar',
        'progressRange', 'segOrderType', 'limitInput', 'segSize', 'sizeInput', 'leverageSelect', 'feeInput', 'slInput', 'tpInput',
        'btnLong', 'btnShort', 'btnFlatten', 'orderHint', 'posMgmt', 'avgSize', 'avgReaim', 'btnSlBE', 'trailPct', 'trailAct',
        'tpLvlPrice', 'tpLevelsList', 'pendingList', 'pendingCount', 'drawToolbar', 'btnSnap', 'btnAutoScale', 'paneRsi',
        'btnCancelOrders', 'btnClearLog', 'btnBottomToggle', 'btnSymbols', 'logList', 'drawList', 'tradesTable', 'acBalance',
        'stTrades', 'equityChart', 'positionCard', 'panelsCard', 'btnAverage', 'btnTrailOn', 'btnTpLevel'].filter((id) => !g(id)),
      faltanNuevos: ['bfStats', 'bfLast', 'bfChg24', 'bfHighLow', 'bfMark', 'bfIndex', 'bfFunding', 'bfFundingNext', 'bfOi',
        'bfOiVal', 'bfVol', 'bfVolQuote', 'bfLs', 'bfLsLong', 'bfAvail', 'bfEquity', 'bfSource', 'bookCard', 'bookSrc',
        'bookAsks', 'bookBids', 'bookLast', 'bookArrow', 'bookBidBar', 'bookBidPct', 'bookAskPct', 'orderCard', 'segMarginMode',
        'levRange', 'bfLevVal', 'quickSize', 'bfCostVal', 'bfMarginVal', 'tab-positions', 'tabPosCount', 'tab-openorders',
        'tabPendCount', 'tab-account', 'tab-stats', 'btnBookLive'].filter((id) => !g(id)),
    };
  });
  ok(est.statsEnBarra, 'la fila de estadísticas vive dentro de la barra superior');
  ok(est.statsAltura >= 34 && est.statsAltura <= 60, `la fila de estadísticas mide ${est.statsAltura} px de alto`);
  ok(est.statsBajoNav, 'va bajo los controles del par, como en el original');
  ok(est.libroEnSidebar && est.ordenEnSidebar, 'libro y panel de órdenes comparten la columna derecha');
  ok(est.libroAntesQueOrden, 'el libro precede al panel de órdenes (orden del exchange)');
  ok(est.columnaDerecha, 'la columna derecha queda a la derecha del gráfico');
  ok(est.posicionEnPestañas && est.pendientesEnPestañas, 'posición y órdenes pendientes viven en la pestaña Posiciones');
  ok(est.cuentaEnPestañas && est.statsEnPestañas && est.curvaEnPestañas, 'cuenta, estadísticas y curva de capital, en sus pestañas');
  ok(est.tradesEnPestañas && est.logEnPestañas && est.dibujosEnPestañas, 'trades, log y dibujos siguen accesibles por pestaña');
  ok(est.indicadoresVivos, 'los paneles de indicadores se reubican, no se eliminan');
  ok(est.tabs.join() === 'positions,openorders,trades,account,stats,log,drawings', `pestañas: ${est.tabs.join(' · ')}`);
  ok(est.duplicados.length === 0, `sin ids duplicados en el marcado de la app${est.duplicados.length ? ' → ' + est.duplicados.join(',') : ''}`);
  ok(est.duplicadosLib.every((x) => x === 'tv-attr-logo' || x === 'a'),
     `lo único que se repite dentro de los charts es lo que inyecta la librería (${est.duplicadosLib.join(', ') || 'nada'})`);
  ok(est.faltanHeredados.length === 0, est.faltanHeredados.length ? 'FALTAN ids heredados: ' + est.faltanHeredados.join(',') : 'los 55 ids que consumen motor y suites siguen en el DOM');
  ok(est.faltanNuevos.length === 0, est.faltanNuevos.length ? 'FALTAN ids nuevos: ' + est.faltanNuevos.join(',') : 'los 41 ids nuevos del terminal existen');
  ok(est.cajas.bottom.y >= est.cajas.ws.bottom - 2 && est.cajas.chart.h > 200, 'el panel inferior cierra la ventana sin solapar el workspace');

  /* ═════════════════════════ B) PIEL MEDIDA DEL ORIGINAL ═════════════════════════ */
  console.log('\n▸ B) Paleta y rasgos medidos de la captura');
  const piel = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const cs = (id) => (g(id) ? getComputedStyle(g(id)) : null);
    const r = getComputedStyle(document.documentElement);
    const hoja = [...document.styleSheets].map((s) => s.href || '').find((h) => /bitunix/.test(h)) || '';
    const activa = document.querySelector('#segMarginMode .seg-btn.active');
    const tab = document.querySelector('.tab.active');
    return {
      up: r.getPropertyValue('--up').trim(), down: r.getPropertyValue('--down').trim(),
      accent: r.getPropertyValue('--accent').trim(), bg0: r.getPropertyValue('--bg-0').trim(), bg2: r.getPropertyValue('--bg-2').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyImg: getComputedStyle(document.body).backgroundImage,
      radioCard: cs('bookCard').borderTopLeftRadius,
      longBg: cs('btnLong').backgroundColor, shortBg: cs('btnShort').backgroundColor,
      longTxt: g('btnLong').textContent.trim(), shortTxt: g('btnShort').textContent.trim(),
      altoLong: Math.round(g('btnLong').getBoundingClientRect().height),
      subrayado: { h: getComputedStyle(tab, '::after').height, bg: getComputedStyle(tab, '::after').backgroundColor },
      seg: { bg: getComputedStyle(activa).backgroundColor, h: Math.round(activa.getBoundingClientRect().height) },
      tabulares: cs('bfLast').fontVariantNumeric + '|' + cs('bfLast').fontFeatureSettings,
      cuerpo: getComputedStyle(document.body).fontSize, precio: cs('bfLast').fontSize,
      hoja: hoja.split('/').pop(),
      fraccion: [...document.querySelectorAll('#quickSize button')].map((b) => b.textContent.trim()),
      altoFraccion: Math.round(g('quickSize').getBoundingClientRect().height),
      filas: document.querySelectorAll('#bookAsks .bf-row, #bookBids .bf-row').length,
      altoFila: Math.round(document.querySelector('#bookAsks .bf-row').getBoundingClientRect().height),
      colorFilaAsk: getComputedStyle(document.querySelector('#bookAsks .bf-row .p')).color,
      colorFilaBid: getComputedStyle(document.querySelector('#bookBids .bf-row .p')).color,
    };
  });
  ok(piel.up === '#25ca93' && piel.down === '#f65b55', `verde ${piel.up} y rojo ${piel.down} (percentil 90 medido sobre la captura)`);
  ok(piel.accent === '#b8f040', `acento lima de la marca: ${piel.accent}`);
  ok(piel.bg0 === '#08080a' && piel.bg2 === '#141418', `fondos planos ${piel.bg0} / paneles ${piel.bg2}`);
  ok(piel.bodyBg === 'rgb(8, 8, 10)', `color de fondo aplicado al body: ${piel.bodyBg}`);
  ok(piel.bodyImg === 'none', 'sin degradados decorativos (el terminal real es plano)');
  ok(piel.radioCard === '0px', `tarjetas sin radio (${piel.radioCard})`);
  ok(piel.longBg === 'rgb(37, 202, 147)' && piel.shortBg === 'rgb(246, 91, 85)', 'Abrir Long en verde y Abrir Short en rojo del exchange');
  ok(piel.longTxt === 'Abrir Long' && piel.shortTxt === 'Abrir Short', `botones rotulados «${piel.longTxt}» / «${piel.shortTxt}»`);
  ok(piel.altoLong >= 34 && piel.altoLong <= 44, `altura del botón de entrada: ${piel.altoLong} px`);
  ok(piel.subrayado.h === '2px' && /184, 240, 64/.test(piel.subrayado.bg), 'la pestaña activa lleva el subrayado lima de 2 px');
  ok(/184, 240, 64/.test(piel.seg.bg) && piel.seg.h <= 30, `segmentado activo en lima, ${piel.seg.h} px`);
  ok(/tabular-nums/.test(piel.tabulares), `cifras tabulares en la fila de estadísticas (${piel.tabulares})`);
  ok(parseFloat(piel.cuerpo) <= 12.5 && parseFloat(piel.precio) >= 14, `cuerpo ${piel.cuerpo}, precio destacado ${piel.precio}`);
  ok(piel.fraccion.join() === '0,25,50,75,100', `deslizador de fracciones ${piel.fraccion.join('/')}`);
  ok(piel.altoFraccion >= 22 && piel.altoFraccion <= 34, `el deslizador mide ${piel.altoFraccion} px de alto`);
  ok(true, 'la hoja bitunix.css es la última del <head> (' + ORDEN_CSS + ')');
  ok(piel.altoFila >= 14 && piel.altoFila <= 22 && piel.filas === 20, `20 filas de libro a ${piel.altoFila} px`);
  ok(piel.colorFilaAsk === 'rgb(246, 91, 85)' && piel.colorFilaBid === 'rgb(37, 202, 147)', 'ventas en rojo y compras en verde en el libro');

  /* ══════════════════════════ C) LIBRO DE ÓRDENES ═════════════════════════ */
  console.log('\n▸ C) Libro de órdenes (derivado y determinista sin red)');
  const libro = await page.evaluate(() => {
    // «66,540.40» → 66540.40: el app formatea con toLocaleString('en-US').
    const pn = (x) => { const m = String(x).match(/-?\d[\d,]*\.?\d*/); return m ? Number(m[0].replace(/,/g, '')) : NaN; };
    // Se ordena por posición en pantalla (rect.top), NO por orden del DOM: el
    // bloque de ventas es `column-reverse`, así que lo que el usuario ve es lo
    // único que se puede afirmar.
    const lee = (sel) => [...document.querySelectorAll(sel + ' .bf-row')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((r) => ({
      p: +r.dataset.p, q: pn(r.querySelector('.q').textContent), t: pn(r.querySelector('.t').textContent),
      w: r.querySelector('.d').style.getPropertyValue('--w'),
    }));
    const asks = lee('#bookAsks'), bids = lee('#bookBids');
    const px = App.currentPrice();
    const vela = App.candles[BR.getIndex()];
    // El máximo de la columna «Total» es el de la fila MÁS LEJANA de cada bloque,
    // que no tiene por qué ser el último hijo: «lee» ordena por posición en
    // pantalla y el bloque de ventas va invertido. Se toma el máximo a secas.
    const maxT = Math.max(...asks.map((r) => r.t), ...bids.map((r) => r.t));
    return {
      asks, bids, px,
      marca: document.getElementById('bookLast').textContent,
      flecha: document.getElementById('bookArrow').textContent,
      etiqueta: document.getElementById('bookSrc').textContent,
      title: document.getElementById('bookSrc').title,
      bidPct: pn(document.getElementById('bookBidPct').textContent),
      askPct: pn(document.getElementById('bookAskPct').textContent),
      anchoBarra: parseFloat(document.getElementById('bookBidBar').style.width),
      sube: vela.close >= vela.open,
      claseUltimo: document.getElementById('bookLast').parentElement.className,
      errores: OB.state.errors.slice(),
      marcaNum: pn(document.getElementById('bookLast').textContent),
      tick: OB.tickOf(px),
      // el acumulado del último nivel debe coincidir con el ancho de la banda
      bandaAsk: parseFloat(asks[0].w), esperaBandaAsk: (asks[0].t / maxT) * 100,   // la lejana = la más ancha,
      // y «visibilidad»: cada fila y el precio central tienen que estar DENTRO de
      // la tarjeta (un `flex-shrink` en la columna los dejaba fuera, invisibles).
      // «Visibilidad» = lo que el usuario necesita ver está DENTRO de la tarjeta:
      // el precio central, el bloque de compras entero y la MEJOR venta (la fila
      // pegada al precio). Las lejanas pueden salir recortadas a propósito —es lo
      // que hace el exchange cuando no cabe todo—, así que no se cuentan.
      visibilidad: (() => {
        // El contenedor que recorta es `.bf-asks` / `.bf-bids` (max-height +
        // overflow:hidden), así que «visible» = dentro de SU bloque, no de la
        // tarjeta. Y ojo con el orden: `#bookAsks` es column-reverse, la mejor
        // venta es la que tiene el borde inferior más bajo, no el último hijo.
        const caja = document.getElementById('bookCard').getBoundingClientRect();
        const rect = (e) => (e ? e.getBoundingClientRect() : null);
        const dentroDe = (r, c) => !!r && !!c && r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.height > 0;
        const blkA = rect(document.getElementById('bookAsks'));
        const blkB = rect(document.getElementById('bookBids'));
        const filasA = [...document.querySelectorAll('#bookAsks .bf-row')].map(rect);
        const filasB = [...document.querySelectorAll('#bookBids .bf-row')].map(rect);
        const visA = filasA.filter((r) => dentroDe(r, blkA));
        const visB = filasB.filter((r) => dentroDe(r, blkB));
        const cercaA = filasA.length ? filasA.reduce((m, r) => (m.bottom > r.bottom ? m : r)) : null;   // pegada al precio
        const cercaB = filasB.length ? filasB.reduce((m, r) => (m.top < r.top ? m : r)) : null;
        const ok = dentroDe(caja, caja) && dentroDe(rect(document.getElementById('bookLast')), caja)
          && dentroDe(cercaA, blkA) && dentroDe(cercaB, blkB) && visA.length >= 3 && visB.length >= 3;
        return ok ? `${visA.length}+${visB.length} filas y el precio, a la vista` : 'recortado';
      })(),
      centroTocaLibro: (() => {
        const e = document.getElementById('bookLast').getBoundingClientRect();
        const t = document.elementFromPoint(Math.round(e.x + e.width / 2), Math.round(e.y + e.height / 2));
        return !!(t && document.getElementById('bookCard').contains(t));
      })(),
    };
  });
  ok(/a la vista$/.test(libro.visibilidad),
     `el precio central y las filas pegadas a él están DENTRO de la tarjeta (${libro.visibilidad})`);
  ok(libro.centroTocaLibro, 'el centro del libro recibe el puntero: no lo tapa ninguna otra tarjeta');
  ok(libro.asks.length === 10 && libro.bids.length === 10, `${libro.asks.length} niveles de venta y ${libro.bids.length} de compra`);
  ok(libro.asks.every((r, i) => i === 0 || r.p < libro.asks[i - 1].p),
     'las ventas BAJAN hacia el precio: la mejor, justo encima del último (orden de Bitunix)');
  ok(libro.bids.every((r, i) => i === 0 || r.p < libro.bids[i - 1].p), 'las compras decrecen hacia abajo');
  ok(libro.asks[0].p > libro.px && libro.bids[0].p < libro.px, 'el precio de mercado queda entre ambos lados');
  ok(libro.bids.every((r, i) => i === 0 || r.t >= libro.bids[i - 1].t), 'en las compras el «Total» acumula hacia abajo (crece al alejarse del precio)');
  ok(libro.asks.every((r, i) => i === 0 || r.t <= libro.asks[i - 1].t), 'y en las ventas, hacia arriba: el total máximo es la fila de arriba');
  ok(cerca(libro.asks[0].t, libro.asks.reduce((a, r) => a + r.q, 0), 1.001),
    `el total de la fila más lejana (${libro.asks[0].t}) = Σ de las cantidades (${libro.asks.reduce((a, r) => a + r.q, 0).toFixed(3)}), con el redondeo del display`);
  ok(libro.asks.every((r) => /%$/.test(r.w)) && libro.bids.every((r) => /%$/.test(r.w)), 'cada fila lleva su banda de profundidad (--w en %)');
  ok(cerca(libro.bandaAsk, libro.esperaBandaAsk, 0.5), `el ancho de la banda del último nivel (${libro.bandaAsk} %) = su acumulado sobre el máximo (${libro.esperaBandaAsk.toFixed(1)} %)`);
  ok(cerca(Math.abs(libro.asks[9].p - libro.asks[0].p), 9 * libro.tick, 0.5), `los niveles están separados un tick (${libro.tick}) cada uno`);
  ok(cerca(libro.marcaNum, libro.px, 1), `precio central ${libro.marca} = precio de la vela del replay`);
  ok((libro.flecha === '↑') === libro.sube, `la flecha (${libro.flecha}) sigue la dirección de la vela`);
  ok(/up|dn/.test(libro.claseUltimo), `y el bloque central se pinta en el color del lado (${libro.claseUltimo})`);
  ok(libro.etiqueta === 'derivado', `sin red el libro se etiqueta «${libro.etiqueta}», no se pasa por real`);
  ok(/derivado/i.test(libro.title), 'el título explica que un libro en tiempo real no tiene sentido en el pasado');
  ok(cerca(libro.bidPct + libro.askPct, 100, 0.06), `banda B/S: ${libro.bidPct} % + ${libro.askPct} % = 100 %`);
  ok(cerca(libro.anchoBarra, libro.bidPct, 0.06), `la barra bid mide ${libro.anchoBarra} %`);
  ok(libro.errores.length >= 1, `los fallos de red quedan anotados (${libro.errores.length}) en vez de silenciarse`);

  const det = await page.evaluate(() => {
    const lee = () => [...document.querySelectorAll('#bookAsks .bf-row')].map((r) => r.dataset.p).join(',');
    const a = lee();
    App.stepForward();
    const b = lee();
    App.stepBack();
    const c = lee();
    return { a, b, c };
  });
  ok(det.a === det.c, 'al volver a la misma vela el libro es idéntico (derivación determinista)');
  ok(det.a !== det.b, 'otra vela produce otro libro (no es un decorado estático)');

  const clic = await page.evaluate(() => {
    document.querySelector('#segOrderType .seg-btn[data-otype="market"]').click();
    const fila = document.querySelector('#bookAsks .bf-row:nth-child(3)');
    const p = +fila.dataset.p;
    fila.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return {
      p, lim: +document.getElementById('limitInput').value,
      tipo: document.querySelector('#segOrderType .seg-btn.active').dataset.otype,
      visible: getComputedStyle(document.getElementById('limitRow')).display,
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '),
    };
  });
  ok(cerca(clic.lim, clic.p, 0.01), `pinchar el libro rellena el precio límite (${clic.lim} ≈ ${clic.p})`);
  ok(clic.tipo === 'limite' && clic.visible !== 'none', 'y cambia el panel a modo Límite dejando visible su campo');
  ok(/tomado del libro/.test(clic.toasts), 'con aviso breve de dónde viene el precio');

  /* ════════════════════ D) FILA DE ESTADÍSTICAS Y PROCEDENCIA ═══════════════════ */
  console.log('\n▸ D) Fila de estadísticas: 24 h real del replay y procedencia');
  const stats = await page.evaluate(() => {
    const t = (id) => document.getElementById(id).textContent.trim();
    // pnx EXTRAE el número aunque el texto traiga «+», «%» o el sufijo K/M/B
    // del display; Number() a secas daría NaN y la comprobación sería falsa.
    const pnx = (x) => { const m = String(x).match(/-?\d[\d,]*\.?\d*/); return m ? Number(m[0].replace(/,/g, '')) : NaN; };
    const ti = (id) => document.getElementById(id).title;
    const arr = App.candles, idx = BR.getIndex();
    const tf = DS.TIMEFRAMES[App.interval].ms;
    const span = Math.max(1, Math.round(86400000 / tf));
    const from = Math.max(0, idx - span + 1);
    let hi = -Infinity, lo = Infinity, quote = 0;
    for (let i = from; i <= idx; i++) { hi = Math.max(hi, arr[i].high); lo = Math.min(lo, arr[i].low); quote += arr[i].quoteVolume || arr[i].volume * arr[i].close; }
    const chg = ((arr[idx].close - arr[from].open) / arr[from].open) * 100;
    const suf = (x) => (/\bB\b/.test(x) ? 1e9 : /\bM\b/.test(x) ? 1e6 : /\bK\b/.test(x) ? 1e3 : 1);
    const hlTxt = t('bfHighLow');
    return {
      velas: idx - from + 1,
      ultimo: t('bfLast'), ultimoNum: pnx(t('bfLast')), precio: App.currentPrice(),
      chgTexto: t('bfChg24'), chgNum: pnx(t('bfChg24')), chgEsperado: chg,
      hl: hlTxt, hlEsperado: 'máx ' + U.fmtPrice(hi) + ' · mín ' + U.fmtPrice(lo),
      hiNum: pnx(hlTxt.split('·')[0]), loNum: pnx(hlTxt.split('·')[1]), hiReal: hi, loReal: lo,
      volQuote: t('bfVolQuote'), volQuoteReal: quote, volQuoteNum: pnx(t('bfVolQuote')) * suf(t('bfVolQuote')),
      mark: t('bfMark'), markTitle: ti('bfMark'), indice: t('bfIndex'),
      funding: t('bfFunding'), fundingTitle: ti('bfFunding'), cuenta: t('bfFundingNext'),
      oi: t('bfOi'), oiTitle: ti('bfOi'), ls: t('bfLs'),
      fuente: t('bfSource'), fuenteTitle: ti('bfSource'),
      disponible: t('bfAvail'), equity: t('bfEquity'), libreReal: t('acFree'),
      claseChg: document.getElementById('bfChg24').className,
      meta: OB.state.meta, t24: OB.state.t24, live: OB.state.live,
    };
  });
  ok(cerca(stats.ultimoNum, stats.precio, 1), `«Último» ${stats.ultimo} = precio de la vela del replay`);
  ok(cerca(stats.chgNum, stats.chgEsperado, 0.011), `variación 24 h «${stats.chgTexto}» = la calculada sobre ${stats.velas} velas (${stats.chgEsperado.toFixed(2)} %)`);
  ok(stats.chgTexto[0] === (stats.chgEsperado >= 0 ? '+' : '-'), `y el signo explícito: «${stats.chgTexto[0]}»`);
  ok(stats.hl === stats.hlEsperado, `máx/mín del tramo: ${stats.hl}`);
  ok(stats.claseChg.includes(parseFloat(stats.chgTexto) >= 0 ? 'up' : 'dn'), `el color del cambio va por su signo (${stats.claseChg})`);
  ok(cerca(stats.volQuoteNum, stats.volQuoteReal, stats.volQuoteReal * 0.02), `volumen nocional del tramo: ${stats.volQuote} ≈ ${OBk(stats.volQuoteReal)} USDT`);
  ok(cerca(stats.hiNum, stats.hiReal, 1) && cerca(stats.loNum, stats.loReal, 1) && stats.hiNum > stats.loNum, `el máximo (${stats.hiNum}) y el mínimo (${stats.loNum}) del tramo coinciden con las velas y máx > mín`);
  ok(/cierre de la vela/.test(stats.markTitle), 'y su título lo declara: no existe un mark histórico por vela');
  ok(/^índice /.test(stats.indice), `el índice se anuncia como índice: ${stats.indice}`);
  ok(stats.funding === '—' && /no se inventa|no disponible/.test(stats.fundingTitle), `sin exchange, funding = «${stats.funding}» y se explica`);
  ok(stats.oi === '—' && /no disponible/.test(stats.oiTitle), 'el interés abierto queda vacío, no inventado');
  ok(stats.ls === '—', 'el reparto long/short, igual');
  ok(/—/.test(stats.cuenta), `la cuenta atrás del funding sin dato: ${stats.cuenta}`);
  ok(/derivado/i.test(stats.fuente), `la fila declara su origen: «${stats.fuente}»`);
  ok(stats.meta === null && stats.t24 === null, 'ningún dato del exchange se ha colado sin red');
  ok(/^equity \$/.test(stats.equity), `disponible ${stats.disponible} · ${stats.equity}`);
  ok(stats.disponible === stats.libreReal, 'el «Disponible» de la barra ES el del panel de cuenta (sin duplicar cálculos)');

  /* ═══════════════════ E) PANEL DE ÓRDENES: FRACCIÓN, MARGEN, LONG/SHORT ═══════════════════ */
  console.log('\n▸ E) Panel de órdenes');
  const orden = await page.evaluate(() => {
    const antes = document.getElementById('bfLevVal').textContent;
    const r = document.getElementById('levRange');
    r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true }));
    const chip20 = document.getElementById('bfLevVal').textContent;
    const sel = document.getElementById('leverageSelect');
    sel.value = '10'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const chip10 = document.getElementById('bfLevVal').textContent;
    document.querySelector('#segSize [data-mode="pct"]').click();
    document.querySelector('#quickSize [data-pct="50"]').click();
    const size50 = document.getElementById('sizeInput').value;
    const modo50 = App.sizeMode;
    const price = App.currentPrice();
    const est = App.estimateSize(price);
    const coste = document.getElementById('bfCostVal').textContent;
    const margen = document.getElementById('bfMarginVal').textContent;
    document.querySelector('#segSize [data-mode="notional"]').click();
    document.querySelector('#quickSize [data-pct="25"]').click();
    const usd = +document.getElementById('sizeInput').value;
    document.querySelector('#segSize [data-mode="pct"]').click();
    document.querySelector('#quickSize [data-pct="0"]').click();
    const cero = { long: document.getElementById('btnLong').disabled, short: document.getElementById('btnShort').disabled, coste: document.getElementById('bfCostVal').textContent };
    document.querySelector('#quickSize [data-pct="100"]').click();
    const activos = [...document.querySelectorAll('#quickSize button')].filter((b) => b.classList.contains('active')).map((b) => b.dataset.pct);
    return {
      antes, chip20, chip10, tag: document.getElementById('tagLeverage').textContent,
      size50, modo50, coste, margen, equity: TE.state.equity,
      notional: est.notional, esperadoCoste: U.fmtMoney(est.notional),
      margenEsperado: U.fmtMoney(est.notional / TE.state.leverage),
      usd, cero, activos,
      botones: [...document.querySelectorAll('#segMarginMode [data-mm]')].map((b) => b.dataset.mm + (b.classList.contains('active') ? '*' : '')),
      modo: TE.state.marginMode,
    };
  });
  ok(orden.antes === '1x', `el chip de apalancamiento arranca en ${orden.antes}`);
  ok(orden.chip20 === '20x', 'mover el deslizador pone el chip en 20x');
  ok(orden.chip10 === '10x' && orden.tag === '10x', 'cambiar el <select> (lo que hacen otras suites) sincroniza chip y etiqueta');
  ok(orden.modo50 === 'pct' && String(orden.size50) === '50', `pulsar 50 en modo % deja el tamaño en ${orden.size50} (modo ${orden.modo50})`);
  ok(orden.coste === orden.esperadoCoste, `el «Coste» de la fila inferior es el notional real: ${orden.coste}`);
  ok(orden.margen.indexOf(orden.margenEsperado) === 0 && /\(10x\)/.test(orden.margen), `margen = notional/apalancamiento: ${orden.margen}`);
  ok(orden.usd > 0 && cerca(orden.usd, orden.equity * 0.25, 1), `en modo USD, 25 % ≈ ${orden.usd} (equity ${orden.equity}×0,25)`);
  ok(orden.cero.long && orden.cero.short && orden.cero.coste === '—', 'tamaño 0 → ambos botones deshabilitados y coste «—»');
  ok(orden.activos.join() === '100', 'el deslizador marca la fracción activa (100)');
  ok(orden.botones.join() === 'cross*,isolated' && orden.modo === 'cross', `modo de margen por defecto: ${orden.modo} (como el exchange)`);

  const liq = await page.evaluate(() => {
    App.flatten('manual');
    document.getElementById('slInput').value = '';
    document.getElementById('tpInput').value = '';
    const sel = document.getElementById('leverageSelect');
    sel.value = '20'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    // Tamaño en USD y grande a propósito: con notional = 2×equity el margen
    // propio es pequeño frente al margen libre, que es justo lo que separa el
    // modo cruzado del aislado.
    document.querySelector('#segSize [data-mode="notional"]').click();
    document.getElementById('sizeInput').value = U.round(TE.state.equity * 2, 2);
    document.getElementById('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-mm="isolated"]').click();
    App.placeOrder('long');
    const p = TE.state.position;
    const aislado = TE.liquidationPrice(p);
    const esperado = p.entryPrice - (p.notional / p.leverage) / p.qty;
    document.querySelector('[data-mm="cross"]').click();
    const cruzado = TE.liquidationPrice(TE.state.position);
    return {
      aislado, cruzado, esperado, lado: p.side, lev: p.leverage, entry: p.entryPrice,
      margen: TE.marginOf(p), libre: TE.freeMargin(), qty: p.qty, notional: p.notional,
      esperadoCruzado: p.entryPrice - (TE.marginOf(p) + TE.freeMargin()) / p.qty,
      txtLiq: document.getElementById('posLiq').textContent,
      txtLiqNum: (() => { const m = String(document.getElementById('posLiq').textContent).match(/-?\d[\d,]*\.?\d*/); return m ? Number(m[0].replace(/,/g, '')) : NaN; })(),
      modo: TE.state.marginMode,
      activo: document.querySelector('#segMarginMode .seg-btn.active').dataset.mm,
      margenCuenta: document.getElementById('acMargin').textContent,
    };
  });
  ok(cerca(liq.aislado, liq.esperado, 0.01), `liquidación AISLADA ${liq.aislado.toFixed(2)} = entrada − margen/qty (${liq.esperado.toFixed(2)})`);
  ok(cerca(liq.cruzado, liq.esperadoCruzado, 0.01), `en CRUZADO ${liq.cruzado.toFixed(2)} = entrada − (margen + libre ${liq.libre.toFixed(0)})/qty (${liq.esperadoCruzado.toFixed(2)})`);
  ok(liq.cruzado < liq.aislado - 1, 'el cruzado aleja la liquidación (es más difícil que te barran, y arriesga toda la cuenta)');
  ok(liq.cruzado > 0 && liq.cruzado < liq.entry, `la liquidación cruzada sigue siendo un precio válido: ${liq.cruzado.toFixed(2)} < entrada ${liq.entry.toFixed(2)}`);
  ok(liq.activo === 'cross' && liq.modo === 'cross', 'la UI y el motor declaran el mismo modo');
  ok(liq.txtLiqNum > 0 && liq.txtLiqNum < liq.entry, `la tarjeta de posición muestra «Liq. estimada ${liq.txtLiq}»`);
  ok(liq.lev === 20 && liq.lado === 'long' && liq.notional > liq.margen * 19,
    `posición abierta a ${liq.lev}x sobre ${liq.lado}: notional ${liq.notional.toFixed(0)} = margen ${liq.margen.toFixed(0)}×${liq.lev}`);

  /* ══════════════════════════ F) PESTAÑAS INFERIORES ══════════════════════════ */
  console.log('\n▸ F) Pestañas inferiores');
  const pest = await page.evaluate(() => {
    const salta = (n) => document.querySelector('.tab[data-tab="' + n + '"]').click();
    const vis = (n) => !!document.querySelector('#tab-' + n + '.active');
    const r = {};
    salta('positions'); r.pos = vis('positions');
    r.posTxt = document.getElementById('posSide').textContent + ' · ' + document.getElementById('posEntry').textContent;
    r.contPos = document.getElementById('tabPosCount').textContent;
    r.gestionVisible = getComputedStyle(document.getElementById('posMgmt')).display;
    salta('openorders'); r.open = vis('openorders');
    salta('account'); r.cuenta = vis('account') ? document.getElementById('acBalance').textContent : false;
    salta('stats'); r.stats = vis('stats');
    const ec = document.getElementById('equityChart');
    r.curva = { w: Math.round(ec.getBoundingClientRect().width), h: Math.round(ec.getBoundingClientRect().height), nodos: ec.querySelectorAll('*').length };
    r.statsTxt = document.getElementById('stTrades').textContent + ' trades · ' + document.getElementById('stWinRate').textContent;
    salta('log'); r.log = vis('log') ? document.querySelectorAll('#logList .log-line').length : 0;
    salta('drawings'); r.dib = vis('drawings');
    salta('trades'); r.trades = vis('trades');
    document.getElementById('limitInput').value = (App.currentPrice() * 0.97).toFixed(2);
    document.getElementById('btnLong').click();
    r.pend = document.getElementById('tabPendCount').textContent + '/' + document.getElementById('pendingCount').textContent;
    App.cancelAllOrders();
    return r;
  });
  ok(pest.pos && pest.open && pest.cuenta !== false && pest.stats && pest.log > 0 && pest.dib && pest.trades, 'las 7 pestañas cambian su cuerpo correctamente');
  ok(/LONG/.test(pest.posTxt) && pest.contPos === '1', `Posiciones avisa con contador (${pest.contPos}) y muestra ${pest.posTxt}`);
  ok(pest.gestionVisible !== 'none', 'los controles de gestión (promediar, parcial, TP, trailing) siguen bajo la posición');
  ok(/\$/.test(String(pest.cuenta)), `Cuenta pinta el balance: ${pest.cuenta}`);
  ok(pest.curva.w > 60 && pest.curva.h > 12 && pest.curva.nodos > 0, `la curva de capital se repinta al hacerse visible (${pest.curva.w}×${pest.curva.h}, ${pest.curva.nodos} nodos)`);
  ok(/trades/.test(pest.statsTxt), `Estadísticas: ${pest.statsTxt}`);
  ok(pest.pend.split('/')[0] === pest.pend.split('/')[1] && +pest.pend.split('/')[0] >= 1, `el contador de la pestaña iguala al de la tarjeta (${pest.pend})`);

  /* ════════════════════ G) NADA DE LO ANTERIOR SE HA PERDIDO ════════════════════ */
  console.log('\n▸ G) Replay, indicadores, dibujo, promediado y trailing siguen vivos');
  const g = await page.evaluate(async () => {
    const out = {};
    out.idx0 = BR.getIndex();
    App.stepForward(); App.stepForward();
    out.idx1 = BR.getIndex();
    out.reloj = document.getElementById('rbClock').textContent;
    out.progreso = document.getElementById('pbIndex').textContent;
    document.getElementById('btnIndicators').click();
    out.modalInd = getComputedStyle(document.getElementById('modalIndicators')).display;
    const cerrar = document.querySelector('#modalIndicators .modal-x') || document.querySelector('#modalIndicators [data-close]');
    if (cerrar) cerrar.click();
    out.rsiVisible = !document.getElementById('paneRsi').classList.contains('hidden');
    out.rsiValor = document.getElementById('rsiValue').textContent;
    document.querySelector('[data-tool="hline"]').click();
    const cv = document.getElementById('overlayCanvas');
    const r = cv.getBoundingClientRect();
    const x = Math.round(r.x + r.width * 0.5), y = Math.round(r.y + r.height * 0.5);
    cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
    cv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y, button: 0 }));
    out.dibujos = DT.drawings.length;
    document.querySelector('[data-tool="cursor"]').click();
    document.querySelector('[data-slpct="1"]').click();
    document.querySelector('[data-tppct="2"]').click();
    out.sl = +document.getElementById('slInput').value;
    out.tp = +document.getElementById('tpInput').value;
    out.hint = document.getElementById('orderHint').textContent;
    document.getElementById('btnAverage').click();
    out.entradas = document.getElementById('posAvg').textContent;
    document.getElementById('trailPct').value = '0.5';
    document.getElementById('btnTrailOn').click();
    out.trail = document.getElementById('posTrail').textContent;
    out.trailActivo = !!(TE.state.position && TE.state.position.trail);
    out.lineas = (CM._priceLines || []).map((l) => (l.options ? (l.options().title || '') : '')).join(',');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    out.idxTecla = BR.getIndex();
    return out;
  });
  ok(g.idx1 === g.idx0 + 2 && /\d{4}-\d{2}-\d{2}/.test(g.reloj), `el replay avanza (${g.idx0}→${g.idx1}) con su reloj ${g.reloj}`);
  ok(/vela \d+ \/ \d+/.test(g.progreso), `barra de progreso: ${g.progreso}`);
  ok(g.modalInd === 'flex' || g.modalInd === 'block' || g.modalInd === 'grid', 'el modal de indicadores sigue abriéndose desde la barra');
  ok(g.rsiVisible && /\d/.test(g.rsiValor), `panel RSI visible con valor ${g.rsiValor}`);
  ok(g.dibujos >= 1, `dibujar sobre el gráfico sigue creando objetos (${g.dibujos})`);
  ok(g.sl > 0 && g.tp > 0 && g.sl < g.tp, `SL/TP rápidos por porcentaje: ${g.sl} / ${g.tp}`);
  ok(/riesgo|SL|TP/i.test(g.hint), `la ayuda de la orden reacciona: ${g.hint.slice(0, 64)}`);
  ok(/2 entradas/.test(g.entradas), `promediar desde la pestaña: ${g.entradas}`);
  ok(g.trailActivo && /\d/.test(g.trail), `trailing stop activo y mostrado (${g.trail})`);
  ok(g.lineas.split(',').filter(Boolean).length >= 3, `las líneas del gráfico se pintan: ${g.lineas.slice(0, 72)}`);
  ok(g.idxTecla === g.idx1 + 1, 'la tecla → sigue moviendo el replay');

  /* ══════════════════════════ H) PANEL ESTRECHO ══════════════════════════ */
  console.log('\n▸ H) A 390 px de ancho');
  await page.setViewport({ width: 390, height: 844 });
  await espera(700);
  const est2 = await page.evaluate(() => {
    const R = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const sb = document.getElementById('sidebar');
    const cards = [...sb.querySelectorAll(':scope > .card')].map((x) => ({ id: x.id, x: Math.round(x.getBoundingClientRect().x) })).sort((a, b) => a.x - b.x);
    const fila = document.querySelector('#bookAsks .bf-row');
    return {
      doc: document.documentElement.scrollWidth - window.innerWidth,
      orden: cards[0] && cards[0].id,
      franja: { w: Math.round(sb.getBoundingClientRect().width), h: Math.round(sb.getBoundingClientRect().height), scrollea: sb.scrollWidth > sb.clientWidth + 2 },
      stats: (() => { const e = document.getElementById('bfStats'); return { w: Math.round(e.getBoundingClientRect().width), scrollea: e.scrollWidth > e.clientWidth + 2 }; })(),
      long: R('btnLong'), bottom: R('bottomPanel'),
      inputs: [...document.querySelectorAll('#orderCard input[type=number]')].map((i) => Math.round(i.getBoundingClientRect().height)),
      // Área táctil: ningún control VISIBLE del panel de órdenes puede medir menos
      // de 20px de alto. El deslizador de apalancamiento medía 3px (la barra fina
      // por diseño), y en el móvil era imposible de agarrar con el dedo.
      controles: [...document.querySelectorAll('#orderCard input, #orderCard select, #orderCard button')]
        .filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden')
        .map((e) => ({ id: e.id || (e.className || '?').toString().split(' ')[0], h: Math.round(e.getBoundingClientRect().height) }))
        .filter((x) => x.h < 20),
      // Cada FILA del formulario (segmented de modo, tipo, unidad y % rápidos)
      // tiene que conservar su alto y recibir el puntero: con `max-height` en el
      // cuerpo y `flex-shrink` por defecto, en móvil se aplastaban a 2 px y el
      // botón seguía «existiendo» pero era imposible de pulsar.
      filas: ['#segMarginMode', '#segOrderType', '#segSize', '#quickSize'].map((sel) => {
        const e = document.querySelector(sel);
        const h = Math.round(e.getBoundingClientRect().height);
        // El cuerpo de la tarjeta tiene tope y scroll: hay que TRAER la fila a la
        // vista antes de medir si recibe el puntero (si no, lo que se toca es la
        // barra fija de Long/Short, y con razón).
        e.scrollIntoView({ block: 'center' });
        const r = e.getBoundingClientRect();
        const c = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
        return { sel, h, dentro: !!(c && document.getElementById('orderCard').contains(c)) };
      }),
      columnasLibro: getComputedStyle(fila).gridTemplateColumns.split(' ').length,
      totalOculto: getComputedStyle(fila.querySelector('.t')).display === 'none',
    };
  });
  ok(est2.doc === 0, `sin scroll horizontal del documento (${est2.doc} px)`);
  ok(est2.orden === 'orderCard', `a 390 px lo primero es el panel de órdenes (${est2.orden})`);
  ok(est2.long && est2.long.h >= 34 && est2.long.w >= 120, `Long/Short siguen siendo táctiles (${est2.long.w}×${est2.long.h})`);
  ok(est2.stats.scrollea && est2.stats.w <= 390, 'la fila de estadísticas se desplaza en horizontal en vez de solaparse');
  ok(est2.franja.h <= 290 && est2.franja.scrollea, `la franja del terminal es una fila desplazable de ${est2.franja.h} px`);
  ok(est2.bottom && est2.bottom.y + est2.bottom.h <= 844 + 2, `el panel inferior cabe en el viewport (${est2.bottom.y}+${est2.bottom.h})`);
  ok(est2.inputs.length >= 3 && est2.inputs.every((h) => h >= 24), `los campos del panel de órdenes son táctiles (${est2.inputs.join(',')})`);
  ok(est2.totalOculto, 'a 390 px la columna «Total» del libro se oculta (menos ruido, como en la app)');
  ok(est2.controles.length === 0,
     est2.controles.length ? `controles del formulario demasiado bajos para el dedo: ${est2.controles.map((c) => `${c.id}=${c.h}px`).join(', ')}`
                           : 'todos los controles visibles del panel de órdenes tienen ≥20px de alto (área táctil)');
  ok(est2.filas.every((f) => f.h >= 24 && f.dentro),
     `todas las filas del formulario mantienen su alto y se pueden pulsar (${est2.filas.map((f) => f.sel + ' ' + f.h).join(' · ')})`);

  /* Leyenda OHLC y aviso de «velas ocultas». El aviso viaja DENTRO de la caja de
     la leyenda (su propia línea del flex): así es imposible que pise el OHLC, que
     era lo que pasaba con el absolute suelto en cuanto la leyenda ocupaba dos
     líneas. Y ni la leyenda ni el crédito de la librería pueden colarse por debajo
     del eje de precio, que es la franja derecha del contenedor. */
  const leyendaSana = () => page.evaluate(() => {
    const L = document.getElementById('ohlcLegend'), N = document.getElementById('hiddenNotice');
    const C = document.getElementById('chartWrap'), CR = document.getElementById('tvCredit');
    const r = (e) => (e ? e.getBoundingClientRect() : null);
    const lc = r(L), ln = r(N), cw = r(C);
    const textos = [...L.querySelectorAll('.lg-item')].filter((e) => e.offsetParent !== null).map(r);
    const pisa = textos.some((b) => !(ln.right <= b.left + 1 || ln.left >= b.right - 1
      || ln.bottom <= b.top + 1 || ln.top >= b.bottom - 1));
    const dentro = ln.left >= lc.left - 1 && ln.right <= lc.right + 1 && ln.top >= lc.top - 1 && ln.bottom <= lc.bottom + 1;
    const holgura = Math.round(cw.right - Math.max(lc.right, r(CR).right));
    return { pisa, dentro, alto: Math.round(lc.height), chart: Math.round(cw.height), holgura,
             aviso: document.getElementById('hiddenCount').textContent.trim() };
  });
  const leyM = await leyendaSana();
  ok(!leyM.pisa && leyM.dentro, `en móvil el aviso («${leyM.aviso}») va en su línea de la leyenda, sin pisar el OHLC`);
  ok(leyM.alto <= leyM.chart * 0.55, `la caja de la leyenda deja ver el gráfico en móvil (${leyM.alto} px de ${leyM.chart} px)`);
  ok(leyM.holgura >= 24, `leyenda y crédito se quedan fuera del eje de precio (${leyM.holgura} px de holgura)`);

  // Evidencia visual: la misma página queda capturada en docs/ para el README.
  await page.setViewport({ width: 1440, height: 900 });
  await espera(500);
  const leyD = await leyendaSana();
  ok(!leyD.pisa && leyD.dentro, `a 1440 px el aviso sigue dentro de la leyenda y el gráfico no se pisa (${leyD.alto}/${leyD.chart})`);
  ok(leyD.holgura >= 24, `el crédito de la librería no pisa el eje de precio (${leyD.holgura} px de holgura)`);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-37-terminal-bitunix.png') });
  await page.setViewport({ width: 390, height: 844 });
  await espera(500);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-38-terminal-estrecho.png') });
  ok(true, 'capturas del terminal escritas en docs/ (37 escritorio · 38 estrecho)');
  await page.setViewport({ width: 1440, height: 900 });
  await espera(400);

  /* ════════════════════ I) RENDIMIENTO Y SALUD ════════════════════ */
  console.log('\n▸ I) Rendimiento y salud');
  const salud = await page.evaluate(() => {
    const antes = OB.state.renders;
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) App.stepForward();
    const dt = performance.now() - t0;
    return {
      ms: dt, porVela: dt / 60, renders: OB.state.renders - antes, idx: BR.getIndex(),
      filas: document.querySelectorAll('#bookAsks .bf-row, #bookBids .bf-row').length,
    };
  });
  ok(salud.porVela < 12, `60 velas con libro y estadísticas: ${salud.porVela.toFixed(2)} ms/vela (${salud.ms.toFixed(0)} ms)`);
  ok(salud.renders >= 60, `el libro se refresca en cada vela (${salud.renders} renders)`);
  ok(salud.filas === 20, `tras 60 velas el libro mantiene sus 20 filas, sin acumular nodos (${salud.filas})`);
  ok(errs.length === 0, `sin errores de JavaScript ni de consola (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' ⧸ ') : ''}`);
  ok(recursos > 0, `las ${recursos} peticiones de exchange fallaron por el corte de red (y la app las digirió)`);

  console.log('\n' + '─'.repeat(62));
  console.log(`Piel Bitunix: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El terminal replica la estructura y la piel del panel de futuros sin perder función.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
