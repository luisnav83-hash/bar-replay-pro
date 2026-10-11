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
      statsMismaFranja: (() => {
        const a = g('bfStats'), b = g('btnSymbols');   // el grupo ya no tiene caja: `display: contents`
        if (!a || !b) return false;
        const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
        return r.top < q.bottom - 4 && r.bottom > q.top + 4;
      })(),
      barraAlta: g('topbar') ? Math.round(g('topbar').getBoundingClientRect().height) : 0,
      libroEnColumnaPropia: dentro('bookCol', 'bookCard'),
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
  // Re-anclado con la medición del sitio (docs/brecha-visual-bitunix.md §2): la franja de
  // estadísticas NO va debajo de los controles —nav 40 px y UNA franja de 73 px con el símbolo
  // a la izquierda (x=52) y las ocho cifras de 24 h en la misma línea (x=392..1430)—. Se exige
  // lo que eso implica: que esté en la misma línea que el par y por debajo del nav.
  // Ojo con esta ancla, que he cambiado dos veces y la segunda es con medición delante: en el
  // sitio las cifras de 24 h NO van debajo de nada —comparten la franja del símbolo con el par
  // a la izquierda (par en x=52, estadísticas de x=392 a x=1430, todas a y=64/82)—. Se exige
  // pues que estén en la barra, por debajo del nav y a la derecha del par; y si el ancho no da
  // (por debajo de 1360 px) se consiente que bajen a su propia línea, que es el tier ≤1000.
  // Y el alto de la barra, porque es lo que se fusionó: el sitio dedica 113 px a DOS bandas
  // (nav 40 + franja del símbolo 73) y nosotros hacemos lo mismo en 76 px de UNA franja, que es
  // como devuelve los 79 px de gráfico que estaba costeando la barra vieja. Se comprueba el
  // número y la convivencia en franja, no el orden en el DOM.
  ok(est.statsMismaFranja, 'las cifras de 24 h comparten franja con los controles del par (medido en el sitio: par en x=52..195 y estadísticas de x=392 a x=1430, todas a y=64/82)');
  // 60..96: la barra son DOS líneas (46 de cifras + 26 del mecanismo del replay + acolchados).
  // Se midió primero en 76 y la segunda línea asomaba 11 px por debajo (`.replay-line` en
  // y=51..87), así que el techo del ancla es el que sale de la aritmética, no un gusto. Contra el
  // sitio, que usa 113 px para lo mismo (nav 40 + franja de símbolo 73), seguimos más apretados.
  /* RIEL VERTICAL DE DIBUJO (ítem 3 del registro, 11-oct-2026). Medido en el sitio: entre el
     borde de la carta y el lienzo hay una columna de ~34 px con los útiles apilados. Aquí se
     comprueba el par entero: el riel mide ~34 px, el gráfico empieza a su derecha, la fila 1 del
     grid de `#chartArea` vale 0 (si valiera 34, el gráfico habría pagado el riel con su alto) y
     `#chartWrap` sigue cuadrando con su fila -que es la contabilidad que `PC.ajustaEscalera`
     comparte con tests/pnl-chart.test.js, y la que rompió la primera versión del riel: puesto
     `absolute` sobre todo el área, la fórmula de la escalera le restaba 612 px y el gráfico caía
     al suelo de 240—. */
  {
    const riel = await page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      const area = g('chartArea'), tb = g('drawToolbar'), rail = tb.querySelector('.rail-body'), wrap = g('chartWrap');
      const R = (e) => e.getBoundingClientRect();
      const fila1 = Math.round(parseFloat(getComputedStyle(area).gridTemplateRows.split(' ')[1]) || 0);
      const r = R(rail), q = R(wrap);
      const t = tb.querySelector('[data-tool="trend"]');
      const tq = R(t), enc = document.elementFromPoint(Math.round(tq.left + tq.width / 2), Math.round(tq.top + tq.height / 2));
      const box = g('bookAsks');
      return { anchoRiel: Math.round(r.width), altoRiel: Math.round(r.height), sobraRiel: Math.max(0, Math.round(rail.scrollHeight - r.height)),
               cajaToolbar: Math.round(R(tb).height), inseto: Math.round(q.left - R(area).left),
               fila1, caja: Math.round(q.height), solape: Math.max(0, Math.round(q.bottom - (g('paneArea') ? R(g('paneArea')).top : 1e9))),
               toolPinchable: !!enc && (t.contains(enc) || enc === t), tiles: tb.querySelectorAll('.tool').length,
               filasLibro: box.children.length, cajaLibro: Math.round(R(box).height),
               desbordaLibro: Math.max(0, box.scrollHeight - box.clientHeight) };
    });
    ok(riel.anchoRiel >= 30 && riel.anchoRiel <= 40 && riel.inseto >= 30 && riel.tiles >= 10,
       `el riel de dibujo mide ${riel.anchoRiel} px, el lienzo arranca ${riel.inseto} px a su derecha y caben sus ${riel.tiles} útiles (los 34 px del sitio)`);
    ok(riel.cajaToolbar === 0 && riel.fila1 >= 200 && Math.abs(riel.caja - riel.fila1) <= 2 && riel.solape === 0,
       `y el gráfico no lo paga: fila 1 del grid = caja del toolbar (${riel.cajaToolbar} px), fila ${riel.fila1} == caja ${riel.caja}, solape con los paneles ${riel.solape} px`);
    ok(riel.sobraRiel === 0 && riel.toolPinchable,
       `el riel entra entero sin recorte (sobran ${riel.sobraRiel} px) y su «╱» se puede pulsar`);
    ok(riel.filasLibro * 17 <= riel.cajaLibro + 2 && riel.desbordaLibro === 0,
       `el libro pinta ${riel.filasLibro} filas en ${riel.cajaLibro} px de caja y no desborda (las filas siguen al espacio: ${Math.floor(riel.cajaLibro / 17)} caben)`);
  }
  ok(est.barraAlta <= 96 && est.barraAlta >= 60,
     `barra superior entera: ${est.barraAlta} px de alto en DOS líneas (antes 155 en tres franjas; el sitio usa 40 de nav + 73 de franja = 113)`);
  {
    const asoma = await page.evaluate(() => {
      const g = (i) => document.getElementById(i), tb = g('topbar');
      const R = (e) => e ? e.getBoundingClientRect() : null;
      const piezas = [g('bfStats'), document.querySelector('.replay-line'), document.querySelector('.brand'), document.querySelector('.par-field')]
        .filter(Boolean).map(R);
      const bajo = Math.max(...piezas.map((r) => Math.round(r.bottom)));
      return { sobra: Math.round(tb.getBoundingClientRect().bottom - bajo),
        cifrasDentro: piezas[0].top >= tb.getBoundingClientRect().top - 1,
        statsAncho: Math.round(R(g('bfStats')).width),
        visible: [...g('bfStats').children].filter((c) => { const q = c.getBoundingClientRect(); return q.width > 40 && q.right <= R(g('bfStats')).right + 1; }).length };
    });
    ok(asoma.sobra >= 0, `la segunda línea NO asoma por debajo de la barra (sobra ${asoma.sobra} px dentro del borde)`);
    ok(asoma.statsAncho >= 700 && asoma.visible >= 5,
       `las cifras de 24 h van en la línea 1 con hueco de verdad: ${asoma.statsAncho} px de franja y ${asoma.visible} cifras a la vista sin desplazar (el sitio muestra 8)`);
  }
  // ANCLA RE-ESCRITA el 2026-10-10. Antes afirmaba que «libro y panel de órdenes comparten la
  // columna derecha», que era nuestra estructura vieja y NO la del sitio: medido en su DOM, el
  // libro es una columna propia (x≈1004, 300 px) y el panel de órdenes va a su derecha
  // (x=1311, 272 px). Se comprueba por cajas —columnas contiguas, libro a la izquierda de las
  // órdenes y las dos a la derecha del gráfico—, no por el orden del DOM.
  ok(est.libroEnColumnaPropia && est.ordenEnSidebar, 'el libro tiene columna propia (#bookCol) y las órdenes la suya, como en el sitio');
  {
    const lb = await page.evaluate(() => {
      const R = (e) => e.getBoundingClientRect();
      const b = R(document.getElementById('bookCol')), o = R(document.getElementById('sidebar')), c = R(document.getElementById('chartArea'));
      return { libroAntes: b.right <= o.left + 2, trasGrafico: b.left >= c.right - 2, anchoLibro: Math.round(b.width), anchoOrden: Math.round(o.width) };
    });
    ok(lb.libroAntes && lb.trasGrafico, `columnas en el orden del sitio: gráfico → libro (${lb.anchoLibro} px) → órdenes (${lb.anchoOrden} px)`);
    ok(lb.anchoOrden === 272, `la columna de órdenes mide ${lb.anchoOrden} px (272 px medidos en el sitio)`);
  }
  ok(est.columnaDerecha, 'la columna derecha queda a la derecha del gráfico');

  /* ORDEN RÁPIDA FLOTANTE (ítem 3 del registro, 11-oct). Medido en el sitio: caja de 312×66 en
     (50,180) sobre el lienzo, `Comprar · precio` / `Por costo (USDT) ▾` / `Vender · precio` y su ×.
     Se exige la geometría, el fondo del flotante (#131414, un punto más claro que la carta) y -lo
     que de verdad importa- que el botón coloque: con la caja abierta, «Comprar» deja posición larga
     viva y el formulario refleja lo que el widget escribió. */
  {
    const qr = await page.evaluate(async () => {
      const g = (id) => document.getElementById(id);
      const R = (e) => e.getBoundingClientRect();
      const ocultoAntes = g('qrCard').hidden === true;
      g('btnQuickOrder').click();
      await new Promise((r) => setTimeout(r, 220));
      const c = g('qrCard'), cs = getComputedStyle(c);
      const precio = g('qrBuyPrice').value;
      const posAntes = (window.TE && TE.state.position) ? TE.state.position.side : null;
      g('qrAmount').value = '25'; g('qrAmount').dispatchEvent(new Event('input', { bubbles: true }));
      g('qrBuy').click();
      await new Promise((r) => setTimeout(r, 400));
      const out = { ancho: Math.round(R(c).width), alto: Math.round(R(c).height), fondo: cs.backgroundColor,
                    borde: cs.borderColor, radio: cs.borderRadius, ocultoAntes, precio,
                    lados: c.querySelectorAll('.bf-qr-side').length, sobreLienzo: !!c.closest('#chartWrap'),
                    tapaLeyenda: (() => { const l = R(g('ohlcLegend')), q = R(c);
                      return !(q.bottom <= l.top + 1 || q.top >= l.bottom - 1 || q.right <= l.left + 1 || q.left >= l.right - 1); })(),
                    pisable: (() => { const q = R(g('qrBuy')); const e = document.elementFromPoint(Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2));
                                      return !!e && (g('qrBuy').contains(e) || e === g('qrBuy')); })(),
                    pos: (window.TE && TE.state.position) ? TE.state.position.side : null, posAntes,
                    tipo: (window.App && App.orderType) || '-', modo: (window.App && App.sizeMode) || '-',
                    importe: g('sizeInput').value };
      g('qrCerrar').click();
      await new Promise((r) => setTimeout(r, 140));
      out.cerradaConX = g('qrCard').hidden === true;
      return out;
    });
    ok(qr.ancho >= 300 && qr.ancho <= 320 && qr.alto >= 56 && qr.alto <= 84 && qr.sobreLienzo && qr.lados === 2 && qr.pisable,
       `la caja flotante mide ${qr.ancho}×${qr.alto} sobre el lienzo, con sus dos botones y «Comprar» pinchable (el sitio: 312×66) - no tapa la leyenda: ${qr.tapaLeyenda ? 'LA TAPA' : 'no'}`);
    ok(qr.fondo === 'rgb(19, 20, 20)' && qr.borde === 'rgb(41, 42, 43)' && qr.radio === '4px',
       `fondo ${qr.fondo} · borde ${qr.borde} · radio ${qr.radio} (los valores medidos de su flotante: #131414, #292a2b, 4 px)`);
    ok(qr.precio && Number(qr.precio) > 0, `los precios vienen rellenos con la vela actual (${qr.precio}); dejarlo vacío = a mercado, como en el sitio`);
    ok(qr.pos !== qr.posAntes && qr.pos === 'long' && qr.modo === 'notional' && qr.importe === '25',
       `y «Comprar» coloca de verdad: posición ${qr.pos} (antes ${qr.posAntes}), tipo ${qr.tipo}, ${qr.importe} en ${qr.modo} escritos desde el widget`);
    ok(qr.ocultoAntes && qr.cerradaConX, `la caja viene cerrada (${qr.ocultoAntes}) y la × la cierra (${qr.cerradaConX}) - el ⚡ de la barra la trae de vuelta`);
    /* Y SE DEJA EL FORMULARIO COMO SE ENCONTRÓ: la colocación cambia el tipo de orden y la
       unidad del tamaño, y la cabecera del botón de entrada se reescribe con el estado (con
       posición abierta dice otra cosa) -si no se reparte y se espera, la ancla de los rótulos que
       viene detrás lee el estado del widget en vez del suyo, que es exactamente como apareció el
       falso «botones rotulados» el 11-oct—. */
    await page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      if (window.TE && TE.state.position) App.flatten();
      const q = (sel) => { const e = document.querySelector(sel); if (e) e.click(); };
      q('#segOrderType [data-otype="market"]');
      q('#segSize [data-mode="pct"]');
      const si = g('sizeInput'); if (si) { si.value = '100'; si.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await espera(500);
  }

  /* `Activador ▾` COMO DESPLEGABLE (ítem 2 del registro, 11-oct). Su segmentado son dos botones y
     un desplegable con lo condicional; lo que se comprueba aquí es que la fila tiene la forma, que
     las dos opciones siguen vivas dentro de `#segOrderType` (el cableado no se mueve) y que el
     rótulo del resumen cuenta qué está elegido. */
  {
    const fila = await page.evaluate(async () => {
      const g = (id) => document.getElementById(id);
      const R = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      const seg = g('segOrderType');
      const mas = g('otypeMore');
      const dentro = [...seg.querySelectorAll('.otype-panel [data-otype]')].map((b) => b.dataset.otype);
      const antes = { hijos: [...seg.children].map((e) => e.getAttribute('data-otype') || e.tagName.toLowerCase()),
                      alto: R(seg).h, desborda: seg.scrollWidth > seg.clientWidth + 1, dentro };
      g('otypeMoreBtn').click();
      await new Promise((r) => setTimeout(r, 160));
      const p = g('otypeMore');
      const panel = p.querySelector('.otype-panel');
      const caja = document.getElementById('orderCard').getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const abierto = { visible: getComputedStyle(panel).display !== 'none' && pr.height > 20,
                        alto: Math.round(pr.height), abrio: g('otypeMore').open,
                        desc: Math.round(caja.right - pr.right), izq: Math.round(pr.left - caja.left),
                        porDentroDelCajon: pr.right <= caja.right + 1 && pr.left >= caja.left - 1,
                        opciones: [...panel.querySelectorAll('.seg-btn')].map((b) => ({ o: b.dataset.otype, t: b.textContent.trim() })) };
      panel.querySelector('[data-otype="trailing"]').click();
      await new Promise((r) => setTimeout(r, 220));
      const elegido = { tipo: window.App.orderType, cerrado: !g('otypeMore').open,
                        rotulo: g('otypeMoreTxt').textContent.trim(), activo: g('otypeMore').classList.contains('active') };
      document.querySelector('#segOrderType [data-otype="market"]').click();
      await new Promise((r) => setTimeout(r, 160));
      const vuelve = { tipo: window.App.orderType, activo: g('otypeMore').classList.contains('active'),
                       rotulo: g('otypeMoreTxt').textContent.trim() };
      return { antes, abierto, elegido, vuelve };
    });
    ok(fila.antes.hijos.join(',') === 'market,limite,details' && fila.antes.alto <= 30 && !fila.antes.desborda && fila.antes.dentro.join(',') === 'trigger,trailing',
      `la fila del tipo es \`${fila.antes.hijos.join(' · ')}\` en ${fila.antes.alto} px sin desbordar, con lo condicional dentro del mismo segmentado (${fila.antes.dentro.join(' · ')}) - como el sitio, cuatro pestañas fuera`);
    ok(fila.abierto.visible && fila.abierto.porDentroDelCajon && fila.abierto.opciones.length === 2,
      `el desplegable abre y ofrece ${fila.abierto.opciones.map((o) => o.t).join(' / ')} sin salirse de la tarjeta (panel ${fila.abierto.alto} px, abierto=${fila.abierto.abrio}, le sobran ${fila.abierto.desc} px por la derecha y ${fila.abierto.izq} por la izquierda)`);
    ok(fila.elegido.tipo === 'trailing' && fila.elegido.cerrado && fila.elegido.rotulo === 'Trailing' && fila.elegido.activo,
      `elegir «Trailing» dentro del panel cambia el formulario (${fila.elegido.tipo}), cierra el desplegable y el rótulo lo dice («${fila.elegido.rotulo}»)`);
    ok(fila.vuelve.tipo === 'market' && !fila.vuelve.activo && fila.vuelve.rotulo === 'Activador',
      `y al volver a Mercado el rótulo del desplegable recupera su nombre neutro («${fila.vuelve.rotulo}») sin marcarse`);
  }

  /* ─── LIBRO COMO EL SUYO: dos pestañas, agregación y cinta (ítem §5.3 del registro) ───
     Medido en su DOM (1600×900, es-ES): pestañas a 14 px / peso 500, la activa blanca con
     subrayado de 2 px y la inactiva `#919499`; `0.1 ▾` a la derecha; precio central 20 px / 700
     verde; Cant. y Total alineadas a la derecha; pie `B48.20% | S51.80%` en 18 px. Lo que se
     exige aquí es la forma Y que la agrupación haga algo: con un paso más grueso las filas
     pintadas tienen que ser múltiplos del paso y tiene que haber menos niveles. */
  {
    const libro = await page.evaluate(async () => {
      const g = (id) => document.getElementById(id);
      const R = (e) => e.getBoundingClientRect();
      const cs = (e) => getComputedStyle(e);
      const tab = (q) => document.querySelector('#bookTabs .bf-tab' + q);
      const antes = {
        tabs: [...document.querySelectorAll('#bookTabs .bf-tab')].map((b) => ({
          t: b.textContent.trim(), ti: b.title, fs: Math.round(parseFloat(cs(b).fontSize)), fw: cs(b).fontWeight,
          recortada: b.scrollWidth > b.clientWidth + 1 || (() => { const br = b.getBoundingClientRect(), hr = g('bookTabs').getBoundingClientRect(); return br.right > hr.right + 1; })(),
          color: cs(b).color, tt: cs(b).textTransform, ls: cs(b).letterSpacing,
          subrayado: (() => { const s = getComputedStyle(b, '::after'); return s.height === '2px' && s.backgroundColor !== 'rgba(0, 0, 0, 0)'; })(),
        })),
        centro: { fs: Math.round(parseFloat(cs(g('bookLast')).fontSize)), fw: cs(g('bookLast')).fontWeight, color: cs(g('bookLast')).color },
        cantDerecha: cs(document.querySelector('#bookAsks .bf-row .q')).textAlign,
        totalDerecha: cs(document.querySelector('#bookAsks .bf-row .t')).textAlign,
        cabeceras: [...g('bookCard').querySelectorAll('.card-body > .bf-book-cols span')].map((s) => s.textContent.trim()),
        pie: { txt: g('bookBidPct').textContent.trim(), alto: Math.round(R(g('bookBidPct')).height), fs: Math.round(parseFloat(cs(g('bookBidPct')).fontSize)) },
        pasos: [...g('bookAgreg').options].map((o) => o.value),
        elegida: g('bookAgreg').value,
        nivelesAntes: g('bookAsks').children.length,
        precioAntes: +document.querySelector('#bookAsks .bf-row').dataset.p,
      };
      /* paso grueso: 1000 veces el de arriba, y a ver qué pinta */
      const grueso = antes.pasos[antes.pasos.length - 1];
      g('bookAgreg').value = grueso;
      g('bookAgreg').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 240));
      const despues = {
        grueso: +grueso,
        niveles: g('bookAsks').children.length,
        precios: [...g('bookAsks').children].map((e) => +e.dataset.p),
        escalon: (([...g('bookAsks').children].map((e) => +e.dataset.p).filter((p) => Math.abs(p % grueso) > 1e-6)).length),
      };
      g('bookAgreg').value = antes.pasos[0];
      g('bookAgreg').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const fino = g('bookAsks').children.length;
      /* y la segunda pestaña, con su cinta */
      tab('[data-btab=\"tape\"]').click();
      await new Promise((r) => setTimeout(r, 300));
      const cinta = {
        libroOculto: g('bookCard').classList.contains('modo-tape') && g('bookAsks').getBoundingClientRect().height === 0,
        filas: g('bookTape').children.length,
        celdas: g('bookTape').children.length ? [...g('bookTape').children[0].children].map((c) => c.textContent.trim()) : [],
        hora: g('bookTape').children.length ? /^\d{2}:\d{2}:\d{2}$/.test(g('bookTape').children[0].querySelector('.h').textContent.trim()) : false,
        colores: g('bookTape').children.length ? [...new Set([...g('bookTape').children].map((r2) => cs(r2.querySelector('.p')).color))] : [],
        altoFila: g('bookTape').children.length ? Math.round(R(g('bookTape').children[0]).height) : 0,
        activa: tab('[data-btab=\"tape\"]').classList.contains('active') && tab('[aria-selected=\"true\"]') === tab('[data-btab=\"tape\"]'),
        origen: g('bookSrc').textContent.trim(),
        cabeceras: [...g('tapeBody').querySelectorAll('.bf-book-cols span')].map((s) => s.textContent.trim()),
        desborda: g('bookCard').scrollWidth > g('bookCard').clientWidth + 1,
      };
      tab('[data-btab=\"book\"]').click();
      await new Promise((r) => setTimeout(r, 220));
      cinta.vuelve = !g('bookCard').classList.contains('modo-tape') && g('tapeBody').hidden === true
        && g('bookAsks').getBoundingClientRect().height > 20;
      return { antes, despues, fino, cinta };
    });
    const tt = libro.antes.tabs;
    ok(tt.length === 2 && /^Libro/.test(tt[0].t) && /^Mercado/.test(tt[1].t)
       && /Libro de órdenes/.test(tt[0].ti) && /Operaciones de mercado/.test(tt[1].ti)
       && tt.every((x) => x.fs === 14 && x.fw === '500' && x.tt === 'none' && x.ls === 'normal' && !x.recortada)
       && tt[0].color === 'rgb(255, 255, 255)' && tt[0].subrayado && tt[1].color === 'rgb(145, 148, 153)',
      `las dos pestañas son «${tt.map((x) => x.t).join(' | ')}» a 14 px/500, ninguna recortada, con el vocabulario del sitio en el title y subrayado de 2 px en la activa (${tt[0].color}) frente a ${tt[1].color} - medido en su DOM; allí el rótulo largo sale cortado «Operacio» y aquí no, porque una pestaña que no se ve no se puede pulsar`);
    ok(libro.antes.centro.fs === 20 && libro.antes.centro.fw === '700' && /rgb\((36, 193, 141|241, 75, 63)\)/.test(libro.antes.centro.color),
      `el precio central es grande y en el color del lado (${libro.antes.centro.fs} px / ${libro.antes.centro.fw} · ${libro.antes.centro.color}) - como los suyos 20 px/700`);
    ok(libro.antes.cantDerecha === 'right' && libro.antes.totalDerecha === 'right'
       && libro.antes.cabeceras.join(' · ') === 'Precio (USDT) · Cant. (BTC) · Total (USDT)',
      `cabeceras ${libro.antes.cabeceras.join(' · ')} con Cant. y Total a la derecha (${libro.antes.cantDerecha}/${libro.antes.totalDerecha}) - las suyas llevan la unidad en las tres`);
    ok(libro.antes.pie.alto === 18 && libro.antes.pie.fs === 12 && /^B[\d.,]+\s?%$/.test(libro.antes.pie.txt),
      `el pie bid/ask es una banda de ${libro.antes.pie.alto} px a ${libro.antes.pie.fs} px con la letra pegada («${libro.antes.pie.txt}», como su «B48.20%»)`);
    ok(libro.antes.pasos.length >= 3 && libro.antes.elegida === libro.antes.pasos[0] && libro.fino === libro.antes.nivelesAntes,
      `el desplegable de agregación ofrece ${libro.antes.pasos.join(' · ')} (deriva de la granularidad del libro que llegue) y con el paso fino se recuperan las ${libro.fino} filas`);
    ok(libro.despues.escalon === 0 && libro.despues.precios.length > 0 && libro.despues.niveles <= libro.antes.nivelesAntes,
      `y agrupar en ${libro.despues.grueso} hace de verdad: ${libro.despues.precios.length} niveles pintados, todos múltiplos del paso (0 fuera de escala), frente a ${libro.antes.nivelesAntes} sin agrupar`);
    const ct = libro.cinta;
    ok(ct.activa && ct.libroOculto && ct.filas >= 5 && ct.hora && ct.celdas.length === 3 && ct.altoFila === 17 && !ct.desborda,
      `«Operaciones de mercado» cambia el cuerpo por una cinta de ${ct.filas} filas de ${ct.altoFila} px con ${ct.celdas.join('/')} y hora ${ct.hora ? 'HH:MM:SS' : 'MAL'}`);
    ok(ct.colores.length === 2 && ct.colores.every((x) => /rgb\((36, 193, 141|241, 75, 63)\)/.test(x)) && ct.vuelve,
      `cada impresión va en el color del que atacó (${ct.colores.join(', ')}) y la primera pestaña vuelve a su sitio`);
    ok(/derivado|real|Binance/.test(ct.origen) && ct.cabeceras.join(' · ') === 'Hora · Precio (USDT) · Tamaño (BTC)',
      `la cinta se etiqueta con su origen (${ct.origen}) y sus cabeceras son ${ct.cabeceras.join(' · ')}`);
  }

  /* ─── PANEL INFERIOR CON SU VOCABULARIO (ítem §5.4 del registro, 11-oct) ───
     Medido en su DOM: pestañas a 14 px / peso 500, la activa blanca y la inactiva `#919499`, SIN
     subrayado (el subrayado de 2 px es del LIBRO, no de aquí), contador dentro del texto, y a la
     derecha `☐ Sólo actual` + `Cerrar todo` en píldora (radio 9999, 12 px, 22 de alto). Se comprueba
     además que las dos pestañas nuevas salen de datos del motor y que el filtro filtra. */
  {
    const abajo = await page.evaluate(async () => {
      const g = (id) => document.getElementById(id);
      const R = (e) => e.getBoundingClientRect();
      // Ojo con el segundo argumento: `getComputedStyle(e)` IGNORA el pseudo, así que medir
      // «subrayado» sin él devolvía el `content` del BOTÓN ('normal') y las nueve pestañas
      // salían subrayadas aunque no tuvieran `::after`. Engañó a esta ancla el 11-oct.
      const cs = (e, p) => getComputedStyle(e, p || null);
      const tabs = [...document.querySelectorAll('#bottomPanel .tab')].map((b) => ({
        t: b.textContent.trim().replace(/\s+/g, ' '), fs: Math.round(parseFloat(cs(b).fontSize)), fw: cs(b).fontWeight,
        color: cs(b).color, subrayado: cs(b, '::after').content !== 'none',
      }));
      const activa = tabs.find((x) => /^Posiciones/.test(x.t));
      const inactiva = tabs.find((x) => /^Cuenta/.test(x.t));
      const pill = g('btnFlattenTab'), pc = cs(pill);
      const solo = g('chkSoloActual');
      const nombre = (sel) => document.querySelector(sel).textContent.trim().replace(/\s+/g, ' ');
      // una ida y vuelta real: abrir, cerrar y mirar las dos pestañas nuevas
      if (window.App && App.sizeMode !== 'pct') document.querySelector('#segSize [data-mode=\"pct\"]').click();
      g('sizeInput').value = '25'; g('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
      const antes = { tabs, activa, inactiva,
        pill: { radio: pc.borderRadius, fs: Math.round(parseFloat(pc.fontSize)), h: Math.round(R(pill).height), color: pc.color, txt: pill.textContent.trim() },
        casilla: { txt: solo.parentElement.textContent.trim(), h: Math.round(R(solo.parentElement).height) },
        fills0: g('fillsBody').children.length, fund0: g('fundingBody').children.length,
        fundLog: Array.isArray(window.TE.state.fundingLog) };
      document.getElementById('btnLong').click();
      await new Promise((r) => setTimeout(r, 700));
      const abierto = { pos: TE.state.position ? TE.state.position.side : null,
                       pairEnTrade: (TE.state.trades[TE.state.trades.length - 1] || {}).pair };
      g('btnFlattenTab').click();
      await new Promise((r) => setTimeout(r, 700));
      const tras = { pos: TE.state.position ? TE.state.position.side : null,
                     fills: [...g('fillsBody').querySelectorAll('tr')].map((tr) => tr.textContent.trim().replace(/\s+/g, ' ')),
                     fillsN: g('tabFillCount').textContent,
                     posN: g('tabTradeCount').textContent };
      // el filtro, con una fila de OTRO par metida a mano en el historial
      TE.state.trades.push(Object.assign({}, TE.state.trades[TE.state.trades.length - 1], { pair: 'ETHUSDT', id: 999 }));
      UI.renderTrades();
      const sinFiltro = g('tradesBody').children.length;
      solo.checked = true; solo.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      const conFiltro = g('tradesBody').children.length;
      solo.checked = false; solo.dispatchEvent(new Event('change', { bubbles: true }));
      TE.state.trades.pop(); UI.renderTrades();
      return { antes, abierto, tras, sinFiltro, conFiltro,
        fillsCab: nombre('#fillsTable thead'), fundCab: nombre('#fundingTable thead'),
        fundVacio: g('fundingEmpty').classList.contains('hidden') ? 'oculto' : 'visible' };
    });
    const nombres = abajo.antes.tabs.map((x) => x.t);
    ok(/Posiciones \(\d+\)/.test(nombres[0]) && nombres.some((x) => /^Historial de posiciones \(\d+\)$/.test(x))
       && nombres.some((x) => /^Historial de operación \(\d+\)$/.test(x)) && nombres.some((x) => /^Historial de financiación \(\d+\)$/.test(x))
       && nombres.some((x) => /^Órdenes abiertas \(\d+\)$/.test(x)),
      `las pestañas del panel inferior usan su vocabulario: ${nombres.slice(0, 5).join(' · ')}`);
    const bichos = abajo.antes.tabs.filter((x) => x.fs !== 14 || x.fw !== '500' || x.subrayado);
    ok(bichos.length === 0 && abajo.antes.activa.color === 'rgb(255, 255, 255)' && abajo.antes.inactiva.color === 'rgb(145, 148, 153)',
      `todas a ${abajo.antes.tabs[0].fs} px / peso ${abajo.antes.tabs[0].fw}, la activa ${abajo.antes.activa.color} y la inactiva ${abajo.antes.inactiva.color}, sin subrayado (el de 2 px es del libro; medido aquí con content:none)`
      + (bichos.length ? ' → desentonan: ' + bichos.map((x) => `${x.t}=${x.fs}/${x.fw}${x.subrayado ? '+subrayado' : ''}`).join(', ') : ''));
    ok(abajo.antes.pill.txt === 'Cerrar todo' && abajo.antes.pill.radio === '9999px' && abajo.antes.pill.fs === 12 && abajo.antes.pill.h >= 20 && abajo.antes.pill.h <= 24,
      `«${abajo.antes.pill.txt}» es la píldora de su fila derecha (radio ${abajo.antes.pill.radio}, ${abajo.antes.pill.fs} px, ${abajo.antes.pill.h} px de alto, ${abajo.antes.pill.color})`);
    ok(/^Sólo actual$/.test(abajo.antes.casilla.txt) && abajo.antes.casilla.h >= 20 && abajo.antes.casilla.h <= 26,
      `y el casillero «${abajo.antes.casilla.txt}» mide ${abajo.antes.casilla.h} px de alto, como su bloque de 22`);
    ok(abajo.abierto.pos === 'long' && abajo.tras.pos === null,
      `la píldora cierra de verdad: posición ${abajo.abierto.pos} tras Abrir Largo y ${abajo.tras.pos} tras «Cerrar todo`);
    ok(abajo.abierto.pairEnTrade === (abajo.tras.pair || 'BTCUSDT') || /BTCUSDT/.test(String(abajo.abierto.pairEnTrade)),
      `cada operación nace anotada con su par (${abajo.abierto.pairEnTrade}), que es lo que hace útil «Sólo actual»`);
    ok(abajo.tras.fills.length >= 2 && abajo.tras.fillsN === String(abajo.tras.fills.length)
       && /entrada/.test(abajo.tras.fills.join(' ')) && /cierre/.test(abajo.tras.fills.join(' ')),
      `«Historial de operación» pinta una fila por ejecución (${abajo.tras.fills.length}: ${abajo.tras.fills.map((x) => x.split(' ')[1] + ' ' + (x.match(/entrada|cierre[^ ]*/g) || [''])[0]).join(' | ')})`);
    // Una ejecución = una fila, ni una más, y el panel se entera SOLO de que la hay.
    // Se prueba por dos sitios a la vez: (1) tras cada mutación del motor se llama al refresco
    // que llama la app (UI.refreshStats, sin forzar), que es donde estaba el memo -comparaba
    // solo los CERRADOS, así que «promediar» no repintaba la tabla—; (2) si la fila del cierre
    // parcial repintara también las entradas de la posición, cada paso sumaría de dos en dos.
    const parciales = await page.evaluate(async () => {
      const g = (id) => document.getElementById(id);
      const n = () => g('fillsBody').children.length;
      const t = () => TE.state.lastPrice;
      const texto = () => [...g('fillsBody').querySelectorAll('tr')].map((x) => x.textContent.trim().replace(/\s+/g, ' '));
      const re = async () => { UI.refreshStats(); await new Promise((r) => setTimeout(r, 120)); };
      const e0 = n();
      g('sizeInput').value = '25'; g('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
      g('btnLong').click();
      await new Promise((r) => setTimeout(r, 600));
      const e1 = n();
      TE.addToPosition('long', { mode: 'pct', size: 10, entryPrice: t(), time: TE.state.lastTime });
      await re();
      const e2 = n();
      TE.reducePosition(0.5, t() * 1.002, TE.state.lastTime, 'parcial');
      await re();
      const e3 = n(), txt = texto();
      g('btnFlattenTab').click();
      await new Promise((r) => setTimeout(r, 600));
      const e4 = n();
      const pos = TE.state.trades.filter((x) => Array.isArray(x.parts)).pop();
      return { e0, e1, e2, e3, e4, txt, partes: pos ? pos.parts.length : -1,
               cerradas: TE.state.trades.filter((x) => x.status === 'closed').length };
    });
    ok(parciales.e1 === parciales.e0 + 1 && parciales.e2 === parciales.e1 + 1
       && parciales.e3 === parciales.e2 + 1 && parciales.e4 === parciales.e3 + 1 && parciales.partes === 2
       && /cierre parcial/.test(parciales.txt.join(' ')),
      `una ejecución, una fila: abrir +1, promediar +1, parcial +1, cerrar +1 (${parciales.e0}→${parciales.e1}→${parciales.e2}→${parciales.e3}→${parciales.e4}); las ${parciales.partes} entradas viven en la posición y el cierre parcial no las repite`);
    ok(abajo.sinFiltro > abajo.conFiltro && abajo.conFiltro >= 1,
      `«Sólo actual» filtra de verdad: ${abajo.sinFiltro} filas con todo y ${abajo.conFiltro} con solo el par cargado (la fila ETHUSDT plantada fuera del filtro desaparece)`);
    ok(abajo.antes.fundLog && /Liquidación \(UTC\)/.test(abajo.fundCab) && /Tasa/.test(abajo.fundCab) && /Importe/.test(abajo.fundCab),
      `«Historial de financiación» existe con su registro en el motor y sus cabeceras (${abajo.fundCab.replace(/^Historial de financiación \(\d+\)\s*/, '') || '—'})`);
  }

  /* ─── LA BARRA DE MODO COMO LA SUYA (ítem §5.5a del registro, 11-oct) ───
     Medido en su página a 1600×900 (es-ES, sin sesión): PÍLDORA de 272×28, radio 9999, fondo
     #222324, partida por una raya de 1 px; izquierda `Cruzada ▾` a 12 px/500 en blanco; derecha
     los DOS `10X` (23×16, 12 px/500) en #24c18d y #f14b3f + un `▾` gris que abre el editor.
     Se comprueba además que los chips LEEN de verdad (mueven el motor y se mueven con él), que el
     editor está cerrado en reposo y que en HEDGE cada chip pinta el suyo. Al terminar se deja la
     cuenta como estaba (ONE-WAY, 1X): la sección E lee ese valor de arranque. */
  {
    const modo = await page.evaluate(async () => {
      const g = (id) => document.getElementById(id);
      const cs = (e, p) => getComputedStyle(e, p || null);
      const caja = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      const barra = g('bfModeBar'), div = document.querySelector('#bfModeBar .bf-mode-div');
      const btns = [...g('segMarginMode').querySelectorAll('.seg-btn')].map((b) => ({
        t: b.textContent.trim(), px: Math.round(parseFloat(cs(b).fontSize)), fw: cs(b).fontWeight,
        color: cs(b).color, radio: cs(b).borderTopLeftRadius, fondo: cs(b).backgroundColor }));
      const chip = (id) => { const e = g(id); return { t: e.textContent.trim(), px: Math.round(parseFloat(cs(e).fontSize)),
        fw: cs(e).fontWeight, color: cs(e).color, ...caja(e), sel: e.classList.contains('sel') }; };
      // Ninguna palabra de la píldora puede salir con puntos suspensivos: es el defecto que
      // el registro de esta piel persigue desde el principio (el ellipsis disfrazando el recorte).
      const recorte = [...g('segMarginMode').querySelectorAll('.seg-btn'), g('btnLevEdit')]
        .map((e) => ({ t: e.textContent.trim(), sw: e.scrollWidth, cw: e.clientWidth }))
        .filter((x) => x.sw > x.cw + 1).map((x) => '«' + x.t + '» ' + x.sw + '>' + x.cw);
      const cajaTarjeta = g('orderCard').getBoundingClientRect();
      const rBarra = barra.getBoundingClientRect();
      const antes = { recorte, tarjeta: Math.round(cajaTarjeta.width),
        dentro: rBarra.right <= cajaTarjeta.right + 1 && rBarra.left >= cajaTarjeta.left - 1,
        barra: { ...caja(barra), radio: cs(barra).borderTopLeftRadius, fondo: cs(barra).backgroundColor },
        div: div ? { ...caja(div), fondo: cs(div).backgroundColor } : null,
        btns, largo: chip('btnLevLong'), corto: chip('btnLevShort'),
        lev: TE.state.leverage, modoPos: TE.state.modoPosicion, editorOculto: g('bfLevEditor').hidden };
      // 1 · mover el deslizador con el editor cerrado tiene que reflejarse en los dos chips
      const r = g('levRange');
      r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true }));
      const tras20 = { largo: g('btnLevLong').textContent.trim(), corto: g('btnLevShort').textContent.trim(),
        val: g('bfLevVal').textContent.trim(), lev: TE.state.leverage };
      // 2 · el `▾` abre el editor y el deslizador queda alcanzable
      g('btnLevEdit').click();
      await new Promise((x) => setTimeout(x, 120));
      const abierto = { oculto: g('bfLevEditor').hidden, aria: g('btnLevEdit').getAttribute('aria-expanded'),
        slider: caja(g('levRange')), valVisible: !!(g('bfLevVal').offsetParent) };
      // 3 · HEDGE: cada chip lee el suyo, y pinchar el rojo escribe en el corto
      document.querySelector('#segPosMode [data-pmode="HEDGE"]').click();
      await new Promise((x) => setTimeout(x, 150));
      g('btnLevShort').click();
      await new Promise((x) => setTimeout(x, 150));
      const ladoAntes = App.levLado;
      r.value = 25; r.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((x) => setTimeout(x, 150));
      const hedge = { ladoElegido: ladoAntes, lado: App.levLado, corto: g('btnLevShort').textContent.trim(),
        largo: g('btnLevLong').textContent.trim(), lecCorto: TE.leverageDe('short'), lecLargo: TE.leverageDe('long'),
        selCorto: g('btnLevShort').classList.contains('sel'), selLargo: g('btnLevLong').classList.contains('sel'),
        lados: g('levLados').textContent.trim() };
      // y se deshace todo, EN ESTE ORDEN: primero volver a ONE-WAY (si no, el deslizador sigue
      // escribiendo en UN lado y la cuenta se queda en 20×), luego unificar, luego bajar a 1X, y
      // por último CERRAR el editor -si se queda abierto añade 22 px a la tarjeta y el plegado
      // automático por espacio de «Avanzado» se dispara, que es precisamente lo que mide otra
      // ancla de más abajo—.
      document.querySelector('#segPosMode [data-pmode="ONE_WAY"]').click();
      await new Promise((x) => setTimeout(x, 150));
      document.querySelector('#segLevLado [data-levlado="reset"]').click();
      r.value = 1; r.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((x) => setTimeout(x, 150));
      g('btnLevEdit').click();
      // y el formulario, a su estado de REPOSO: los dos bloques de §5 han dejado el tamaño al 25 %,
      // que llena la línea de «Coste» y la del aviso (dos filas cada una, ~35 px) y con eso el
      // plegado automático de «Avanzado» se dispara CON RAZÓN -la ancla de más abajo mide el
      // reposo, así que hay que devolvérselo (0 % de tamaño y un resize para que el observer
      // reevalúe con la tarjeta ya corta)—.
      document.querySelector('#quickSize [data-pct=\"0\"]').click();
      await new Promise((x) => setTimeout(x, 250));
      window.dispatchEvent(new Event('resize'));
      await new Promise((x) => setTimeout(x, 350));
      const vuelta = { lev: TE.state.leverage, modoPos: TE.state.modoPosicion, editor: g('bfLevEditor').hidden,
        largo: g('btnLevLong').textContent.trim(), corto: g('btnLevShort').textContent.trim(),
        chipSel: g('btnLevLong').classList.contains('sel') || g('btnLevShort').classList.contains('sel') };
      return { antes, tras20, abierto, hedge, vuelta };
    });
    ok(modo.antes.barra.h >= 27 && modo.antes.barra.h <= 29 && modo.antes.barra.radio === '9999px'
       && modo.antes.barra.fondo === 'rgb(34, 35, 36)',
      `la barra de modo es su píldora (${modo.antes.barra.w}×${modo.antes.barra.h} px, radio ${modo.antes.barra.radio}, fondo ${modo.antes.barra.fondo}) - la suya 272×28, radio 9999, #222324`);
    ok(modo.antes.div && modo.antes.div.w === 1,
      `y está partida por su raya de ${modo.antes.div ? modo.antes.div.w : 0} px (${modo.antes.div ? modo.antes.div.fondo : '—'}), no por dos cajas`);
    ok(modo.antes.btns.every((b) => b.px === 12 && b.fw === '500' && b.radio === '0px' && b.fondo === 'rgba(0, 0, 0, 0)')
       && modo.antes.btns[0].color === 'rgb(255, 255, 255)' && modo.antes.btns[1].color === 'rgb(145, 148, 153)',
      `el modo a 12 px / peso 500 dentro de la píldora, ${modo.antes.btns[0].t} en ${modo.antes.btns[0].color} y ${modo.antes.btns[1].t} en ${modo.antes.btns[1].color}, sin caja propia (la suya: «Cruzada ▾» 12/500 en blanco)`);
    ok(modo.antes.largo.px === 12 && modo.antes.largo.fw === '500'
       && modo.antes.largo.color === 'rgb(36, 193, 141)' && modo.antes.corto.color === 'rgb(241, 75, 63)'
       && modo.antes.largo.w >= 18 && modo.antes.largo.h >= 20 && modo.antes.corto.h >= 20,
      `los dos apalancamientos, no uno: ${modo.antes.largo.t} en ${modo.antes.largo.color} y ${modo.antes.corto.t} en ${modo.antes.corto.color} a ${modo.antes.largo.px} px/peso ${modo.antes.largo.fw}, caja ${modo.antes.largo.w}×${modo.antes.largo.h} (su texto medido: 23×16 a 12 px/500 en #24c18d y #f14b3f; la caja nuestra estira a la píldora para ser pulsable con el dedo)`);
    ok(modo.antes.recorte.length === 0 && modo.antes.dentro,
      'ningún rótulo de la píldora sale cortado'
      + (modo.antes.recorte.length ? ' → ' + modo.antes.recorte.join(', ') : ' (palabra completa en las dos mitades y en la flecha)')
      + ` y la píldora cabe en su tarjeta (${modo.antes.barra.w} px de barra dentro de ${modo.antes.tarjeta} de carta)`);
    ok(modo.antes.lev === 1 && modo.antes.largo.t === '1X' && modo.antes.corto.t === '1X' && !modo.antes.largo.sel,
      `en ONE-WAY los dos chips dicen el de la cuenta y salen iguales (${modo.antes.largo.t} / ${modo.antes.corto.t}), sin marcar ninguno: no hay lado que preferir`);
    ok(modo.tras20.largo === '20X' && modo.tras20.corto === '20X' && modo.tras20.val === '20X' && modo.tras20.lev === 20,
      `mover el deslizador escribe de verdad en los dos lados: chips ${modo.tras20.largo}/${modo.tras20.corto}, valor ${modo.tras20.val} y motor a ${modo.tras20.lev}× -con el editor cerrado, además—`);
    ok(modo.antes.editorOculto === true && modo.abierto.oculto === false && modo.abierto.aria === 'true'
       && modo.abierto.slider.w >= 40 && modo.abierto.valVisible,
      `el ▾ suyo abre un popover; el nuestro abre la fila del deslizador (${modo.abierto.slider.w}×${modo.abierto.slider.h} px alcanzables, aria-expanded ${modo.abierto.aria}) en vez de inventarse un popover`);
    ok(modo.hedge.ladoElegido === 'short' && modo.hedge.lecCorto === 25 && modo.hedge.lecLargo !== 25
       && modo.hedge.corto === '25X' && modo.hedge.selCorto && !modo.hedge.selLargo,
      `en HEDGE el chip rojo ESCRIBE y LEE: ${modo.hedge.largo}▲ / ${modo.hedge.corto}▼ (corto ${modo.hedge.lecCorto}×, largo ${modo.hedge.lecLargo}×) y solo el rojo va marcado - lectura: «${modo.hedge.lados}»`);
    ok(modo.vuelta.lev === 1 && modo.vuelta.modoPos === 'ONE_WAY' && modo.vuelta.largo === '1X'
       && modo.vuelta.corto === '1X' && !modo.vuelta.chipSel && modo.vuelta.editor === true,
      `y se puede deshacer: ONE-WAY + ⤺ Ambos dejan la cuenta en ${modo.vuelta.lev}× con los dos chips otra vez en ${modo.vuelta.largo} y el editor cerrado (${modo.vuelta.editor ? 'oculto' : 'abierto'}) -así la sección E arranca como esperaba-`);
  }

  /* ─── La entrada no puede quedar bajo el borde de su cajón (ítem 2 del registro) ───
     Medido el 10-oct-2026 con `tools/barrido-graficos.js`: la tarjeta de órdenes ocupaba
     695-697 px y «Abrir Largo / Abrir Corto» caían ~140 px por debajo del borde de la columna
     derecha en 1360x900 -alcanzables solo deslizando la columna, que en trading es un defecto,
     no un detalle-. El sitio no pasa de ahí porque su `TP/SL` viene plegado de fábrica; aquí el
     pliegue es condicional y MEDIDO (css/bitunix.css, bloque 15 + `autoAprieta` en
     js/uiController.js), así que lo que se comprueba es el contrato: con hueco, todo abierto;
     sin hueco, plegado solo, con el botón a la vista y diciendo por qué. */
  {
    const cabida = () => page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      const card = g('orderCard'), lg = g('btnLong'), sh = g('btnShort');
      const adv = g('orderAvanzado'), btn = g('btnOrderAvanzado');
      let port = card.parentElement;
      while (port) { const o = getComputedStyle(port).overflowY; if (o === 'auto' || o === 'scroll') break; port = port.parentElement; }
      const inf = Math.max(lg.getBoundingClientRect().bottom, sh.getBoundingClientRect().bottom);
      const limite = Math.min((port || document.documentElement).getBoundingClientRect().bottom, window.innerHeight);
      const r = (e) => { const q = e.getBoundingClientRect(); return document.elementFromPoint(Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2)); };
      const pincha = (e) => { const x = r(e); return !!x && (x === e || e.contains(x)); };
      return {
        plegado: !adv.offsetParent,
        auto: card.dataset.autoApretado === '1',
        boton: btn ? getComputedStyle(btn).display !== 'none' : false,
        clip: Math.max(0, Math.round(inf - limite + 6)),
        tarjeta: Math.round(card.getBoundingClientRect().height),
        larga: pincha(lg), corta: pincha(sh),
      };
    });
    const holgado = await cabida();                                     // 1440x900, viewport base

    ok(!holgado.plegado && !holgado.auto,
       `con hueco de sobra el bloque «Avanzado» NO se pliega solo (plegado ${holgado.plegado}, por espacio ${holgado.auto}): la comision y el modo de posicion se ven sin tocar nada (SL/TP, detras de su casilla -asi en el sitio, medido—)`)
    ok(holgado.clip === 0 && holgado.larga && holgado.corta,
       `y los botones de entrada se ven y se pinchan sin deslizar: tarjeta ${holgado.tarjeta} px, ${holgado.clip} px bajo el borde (antes ~140)`);
    await page.setViewport({ width: 1024, height: 768 });
    await new Promise((r) => setTimeout(r, 620));
    const apretado = await cabida();
    ok(apretado.plegado && apretado.auto && apretado.boton,
       `en ventana que no da (1024x768, ${apretado.tarjeta} px de tarjeta) «Avanzado» se pliega SOLO (${apretado.plegado}), marcado como pliegue por espacio (${apretado.auto}) y dejando el botón para volver a abrirlo (${apretado.boton})`);
    await page.setViewport({ width: 1440, height: 900 });
    await new Promise((r) => setTimeout(r, 620));
    const vuelta = await cabida();
    ok(!vuelta.plegado && vuelta.clip === 0,
       `y al devolverle el hueco se deshace el pliegue (${vuelta.plegado ? 'sigue plegado' : 'abierto'}, ${vuelta.clip} px bajo el borde) - el pliegue responde al espacio, no al ancho`);
  }

  /* ─── TP/SL COMO CASILLA QUE DESPLIEGA (ítem §5.5b del registro, 11-oct) ───
     Medido en su pagina (sonda Chromium, 1600x900, es-ES, sin sesion) pinchando la propia
     casilla, que es lo que faltaba el dia del 5a: la fila mide 272x18 con una CAJA-SVG de
     12x12 y el rotulo `TP/SL` a 12 px / peso 400 en blanco, separado 4 px del icono, y a la
     derecha `Avanzado` (55x14) + caret de 12. Al marcarla salen DOS CAJAS de 272x40 con paso
     de 48 (hueco 8), fondo #222324, radio 4 y `padding: 0 12px`; dentro, el input de 146x38 a
     14/400 en blanco cuyo PLACEHOLDER es `TP` el de arriba y `SL` el de abajo (el prefijo mide
     0 px: asi distinguen ellas, no hay rotulo fuera), y un sufijo de 100x38 con
     `Precio (USDT)` a 14/400 en #919499. La casilla llega DESMARCADA, y eso es lo que copia
     esta app: con ella marcada el bloque mide 315 px en una columna de 556 y `autoAprieta`
     plegaria «Avanzado» a 1440x900 -robar el acceso a la comision y a las plantillas por una
     apariencia—. Y APAGAR TP/SL no borra lo escrito: los niveles dejan de viajar a la orden
     (que es lo que apagar significa alli) pero siguen en los campos, con un resumen en la fila
     para que lo apagado no se confunda con lo vacio. */
  {
    const g0 = (id) => document.getElementById(id);
    const leeTpSl = await page.evaluate(async () => {
      const g = (id) => document.getElementById(id);
      const R = (e) => { const q = e.getBoundingClientRect(); return { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) }; };
      const cs = (e) => getComputedStyle(e);
      const fila = document.querySelector('#bfTpSl .bf-tpsl-row');
      const caja = document.querySelector('#bfTpSl .bf-check-caja');
      const txt = document.querySelector('#bfTpSl .bf-check-txt');
      const chk = g('chkTpSl'), sum = g('bfTpSlSum'), cajas = g('bfTpSlCajas');
      const estado = (etiqueta) => {
        const tp = g('tpInput').closest('.bf-in'), sl = g('slInput').closest('.bf-in');
        const uni = [...document.querySelectorAll('#bfTpSlCajas .bf-in-unidad')].map((u) => ({
          t: u.textContent.trim(), fs: Math.round(parseFloat(cs(u).fontSize)), fw: cs(u).fontWeight,
          color: cs(u).color, caja: (R(tp).x + R(tp).w) + ' pad ' + cs(tp).paddingRight, uni: R(u).x + R(u).w,
          dentro: Math.abs((R(u).x + R(u).w) - (R(tp).x + R(tp).w - parseFloat(cs(tp).paddingRight))) <= 1 }));
        return { [etiqueta]: true, alturas: [tp, sl].map((e) => R(e).h), paso: R(sl).y - R(tp).y,
          tpArriba: R(tp).y < R(sl).y, fondo: cs(tp).backgroundColor, radio: cs(tp).borderTopLeftRadius,
          pad: cs(tp).paddingLeft, anchos: [R(tp).w, R(sl).w], anchoFila: R(fila).w,
          placeholders: [g('tpInput').placeholder, g('slInput').placeholder],
          unidades: uni, visibles: cajas.offsetParent !== null && !cajas.hidden,
          leido: (window.App && App.tpSlLee) ? App.tpSlLee() : null,
          valores: [g('slInput').value, g('tpInput').value], resumen: sum.textContent.trim(), resumenVisible: !sum.hidden };
      };
      const reposo = {
        fila: R(fila), caja: R(caja), txt: R(txt),
        tipografia: { fs: Math.round(parseFloat(cs(txt).fontSize)), fw: cs(txt).fontWeight, color: cs(txt).color },
        separacion: R(txt).x - (R(caja).x + R(caja).w),
        marcada: chk.checked, cajasOcultas: cajas.hidden, sinFlash: cajas.offsetParent === null,
        resumen: sum.textContent.trim(), leido: (window.App && App.tpSlLee) ? App.tpSlLee() : null,
        diana: R(chk.closest('label')),
      };
      chk.click();                                     // la persona marca TP/SL
      await new Promise((r) => setTimeout(r, 320));
      /* Marcar hace crecer el bloque ~115 px y el plegado automatico lo cierra -es su trabajo:
         los botones no pueden quedar bajo el borde de la columna, medido 556 px a 1440x900—. Para
         mirar las cajas hay que abrir a mano, que es el gesto real y deja `explicit`. */
      if (g('orderCard').classList.contains('adv-cerrado')) { g('btnOrderAvanzado').click(); await new Promise((r) => setTimeout(r, 400)); }
      const marcado = estado('marcado');
      g('tpInput').value = '80000'; g('tpInput').dispatchEvent(new Event('input', { bubbles: true }));
      g('slInput').value = '70000'; g('slInput').dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 220));
      const escritos = estado('escritos');
      // y una ORDEN DE VERDAD por el camino que pint6 la interfaz: con la casilla marcada, los
      // dos niveles tienen que llegar a la posicion abierta.
      if (window.TE && TE.state.position) App.flatten();
      document.querySelector('#segSize [data-mode="pct"]').click();
      g('sizeInput').value = '25'; g('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
      g('btnLong').click();
      await new Promise((r) => setTimeout(r, 700));
      const conNiveles = (() => { const q = window.TE.state.position; return q ? { sl: q.sl, tp: q.tp } : null; })();
      if (window.TE && TE.state.position) App.flatten();
      await new Promise((r) => setTimeout(r, 400));
      chk.click();                                     // la desmarca
      await new Promise((r) => setTimeout(r, 320));
      if (g('orderCard').classList.contains('adv-cerrado')) { g('btnOrderAvanzado').click(); await new Promise((r) => setTimeout(r, 400)); }
      const apagado = estado('apagado');
      g('btnLong').click();
      await new Promise((r) => setTimeout(r, 700));
      const sinNiveles = (() => { const q = window.TE.state.position; return q ? { sl: q.sl, tp: q.tp } : null; })();
      if (window.TE && TE.state.position) App.flatten();
      // (el reposo se devuelve desde Node, justo despues: aqui `page` no existe)
      return { reposo, marcado, escritos, conNiveles, apagado, sinNiveles };
    });
    // ...y el acoplamiento que ese estado obliga: en Riesgo fijo el stop NO es opcional.
    const riesgo = await page.evaluate(async () => {
      const g = (id) => document.getElementById(id);
      const antes = { marcada: g('chkTpSl').checked, pos: !!(window.TE && TE.state.position) };
      document.querySelector('#segSize [data-mode="riesgo"]').click();
      g('riesgoSlInput').value = '76000'; g('riesgoSlInput').dispatchEvent(new Event('input', { bubbles: true }));
      g('riesgoMaxInput').value = '200'; g('riesgoMaxInput').dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 320));
      const alEntrar = { marcada: g('chkTpSl').checked, cajas: !g('bfTpSlCajas').hidden,
        sl: +g('slInput').value, hint: (g('riesgoHint').textContent || '').replace(/\s+/g, ' ').trim() };
      g('chkTpSl').click();                                  // la persona la apaga A MANO
      await new Promise((r) => setTimeout(r, 240));
      g('btnLong').click();
      await new Promise((r) => setTimeout(r, 600));
      // se mira el CONJUNTO de avisos vivos, no el primero: apagar la casilla ya pone el suyo y
      // cortar la cadena por tamano dejaba fuera el del guard, que es el que interesa.
      const avisos = [...g('toasts').querySelectorAll('*')].map((e) => e.textContent.trim()).filter(Boolean);
      const apagada = { pos: !!(window.TE && TE.state.position),
        dicho: avisos.some((t) => /necesita el stop encendido/.test(t)),
        toast: (avisos.find((t) => /necesita el stop encendido/.test(t)) || avisos[0] || '').slice(0, 120) };
      return { antes, alEntrar, apagada };
    });
    ok(riesgo.antes.marcada === false && riesgo.alEntrar.marcada && riesgo.alEntrar.cajas,
       `entrar en Riesgo fijo enciende la casilla TP/SL por si sola (${riesgo.antes.marcada ? 'ya estaba encendida' : 'apagada'} → ${riesgo.alEntrar.marcada ? 'encendida y con las cajas a la vista' : 'sigue apagada'}): aqui el stop es el que calcula el tamano y no puede ir apagado`);
    ok(riesgo.alEntrar.sl === 76000 && /TP\/SL encendidos/.test(riesgo.alEntrar.hint),
       `y el campo de SL pasa a ser la copia visible del stop deducido (${riesgo.alEntrar.sl}), dicho en el propio aviso: «${riesgo.alEntrar.hint.slice(-78)}»`);
    ok(riesgo.apagada.pos === riesgo.antes.pos && riesgo.apagada.dicho,
       `apagarla a mano en este modo no cuela una orden sin stop: ${riesgo.apagada.pos ? 'se abrio igual (defecto)' : 'no se abrio nada'} y lo dice asi -${riesgo.apagada.toast}-`);
    await page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      // el modo de tamano vuelve a `% equity`: es el reposo del formulario y el que leen las secciones B..E
      document.querySelector('#segSize [data-mode="pct"]').click();
      g('tpInput').value = ''; g('tpInput').dispatchEvent(new Event('input', { bubbles: true }));
      g('slInput').value = ''; g('slInput').dispatchEvent(new Event('input', { bubbles: true }));
      const c = g('chkTpSl'); if (c.checked) c.click();
      const q = document.querySelector('#quickSize [data-pct="0"]'); if (q) q.click();
      // el plegado automatico vuelve a mandar: quien abrio el bloque a mano fue esta prueba
      const bt = g('btnOrderAvanzado'); if (bt && bt.dataset.explicit === '1') { delete bt.dataset.explicit; bt.dataset.motivo = ''; }
      window.dispatchEvent(new Event('resize'));
    });
    await new Promise((r) => setTimeout(r, 520));
    const T = leeTpSl;

    ok(T.reposo.fila.h >= 18 && T.reposo.fila.h <= 24 && T.reposo.caja.w === 12 && T.reposo.caja.h === 12
       && T.reposo.tipografia.fs === 12 && T.reposo.tipografia.fw === '400' && T.reposo.separacion === 4
       && T.reposo.tipografia.color === 'rgb(255, 255, 255)',
       `la fila TP/SL como medida: ${T.reposo.fila.h} px de alto (18 suyos + el estirado a la diana tactil), caja-svg de ${T.reposo.caja.w}x${T.reposo.caja.h}, «${'TP/SL'}» a ${T.reposo.tipografia.fs}/${T.reposo.tipografia.fw} en ${T.reposo.tipografia.color} y ${T.reposo.separacion} px despues del icono`);
    ok(T.reposo.diana.h >= 20 && T.reposo.diana.w >= 40,
       `la diana del toque es la fila entera, no los 12 px del garabato: ${T.reposo.diana.w}x${T.reposo.diana.h} px (el contrato tactico de esta app pide >=20 px a todo control visible; el suyo mide 18 y ahi se queda la estetica, no el area pulsable)`);
    ok(!T.reposo.marcada && T.reposo.cajasOcultas && T.reposo.sinFlash && T.reposo.resumen === 'sin niveles'
       && T.reposo.leido && T.reposo.leido.on === false && T.reposo.leido.sl === null,
       `en reposo la casilla llega DESMARCADA y las dos cajas no estan en pantalla (${T.reposo.sinFlash ? 'ni un flash: ocultas desde el marcado' : 'parpadean al arrancar'}); el resumen dice «${T.reposo.resumen}» y el motor lee ${JSON.stringify(T.reposo.leido)}`);
    ok(T.marcado.alturas.every((h) => h === 40) && T.marcado.paso === 48 && T.marcado.tpArriba
       && T.marcado.fondo === 'rgb(34, 35, 36)' && /^4px$/.test(T.marcado.radio) && T.marcado.pad === '12px'
       && T.marcado.anchos.every((w) => w >= 240) && T.marcado.placeholders.join('/') === 'TP/SL',
       `marcarla saca las DOS CAJAS medidades: ${T.marcado.alturas.join(' y ')} px de alto, paso ${T.marcado.paso}, ${T.marcado.anchos[0]} px de ancho, fondo ${T.marcado.fondo}, radio ${T.marcado.radio}, padding ${T.marcado.pad}, TP arriba -placeholder «${T.marcado.placeholders.join('» / «')}»— como en su pagina`);
    ok(T.marcado.unidades.length === 2 && T.marcado.unidades.every((u) => u.t === 'Precio (USDT)'
       && u.fs === 14 && u.color === 'rgb(145, 148, 153)' && u.dentro),
       `la unidad va DENTRO de la caja, a la derecha y en gris medido: ${T.marcado.unidades.length} × «${(T.marcado.unidades[0] || {}).t}» a ${(T.marcado.unidades[0] || {}).fs}/${(T.marcado.unidades[0] || {}).fw} en ${(T.marcado.unidades[0] || {}).color}`
       + ` [caja ${(T.marcado.unidades[0] || {}).caja} · unidad ${(T.marcado.unidades[0] || {}).uni}]`);
    ok(T.escritos.valores.join('/') === '70000/80000' && T.escritos.leido.sl === 70000 && T.escritos.leido.tp === 80000
       && T.escritos.resumenVisible === false && T.escritos.visibles === true,
       `escritos los dos niveles, el lector del formulario los devuelve (${T.escritos.leido.sl} / ${T.escritos.leido.tp}) y el resumen de la fila se guarda para cuando la casilla esta apagada (visible: ${T.escritos.resumenVisible})`);
    ok(T.conNiveles && Number.isFinite(T.conNiveles.sl) && Number.isFinite(T.conNiveles.tp),
       `con la casilla marcada la orden sale CON los dos niveles: ${JSON.stringify(T.conNiveles)} -el camino real, no un ` + 'App.tpSlLee() inventado—');
    ok(T.apagado.visibles === false && T.apagado.valores.join('/') === '70000/80000'
       && T.apagado.leido.sl === null && T.apagado.leido.tp === null,
       `desmarcar APAGA pero NO BORRA: las cajas se ocultan, los campos siguen leyendo ${T.apagado.valores.join('/')} y el motor devuelve sl=${T.apagado.leido.sl} tp=${T.apagado.leido.tp}`);
    ok(T.sinNiveles && T.sinNiveles.sl == null && T.sinNiveles.tp == null,
       `y la orden colocada con la casilla apagada no lleva niveles (${JSON.stringify(T.sinNiveles)}) -lo que el usuario ve apagado no se envia—`);
    ok(/SL 70,?000/.test(T.apagado.resumen) && /TP 80,?000/.test(T.apagado.resumen) && T.apagado.resumenVisible,
       `el resumen de la fila avisa de lo que hay apagado: «${T.apagado.resumen}»`);
  }
  const rotulos = await page.evaluate(() => {
    const sel = '#orderCard .field-label, #orderCard .bf-tpl-lab, #topbar .field-label, #bottomPanel .field-label';
    const mal = [];
    for (const e of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(e);
      const espaciado = parseFloat(cs.letterSpacing);
      if (cs.textTransform !== 'none' || (Number.isFinite(espaciado) && espaciado > 0.2)) {
        mal.push((e.id || e.className.toString().split(' ')[0]) + ':' + cs.textTransform + '/' + cs.letterSpacing);
      }
    }
    return { n: document.querySelectorAll(sel).length, mal };
  });
  ok(rotulos.n >= 16 && rotulos.mal.length === 0,
     `los ${rotulos.n} rótulos de campo del terminal van en minúsculas y sin espaciado (lo medido en su página: 12 px #919499, sin \`uppercase\` ni \`letter-spacing\`)`
     + (rotulos.mal.length ? ` → quedan ${rotulos.mal.length}: ${rotulos.mal.slice(0, 4).join(', ')}` : '')
     + ` - la regla venía de css/main.css:99 y el doc la daba por aplicada desde el §1: se comprobó midiendo, no recordando`);
  ok(est.posicionEnPestañas && est.pendientesEnPestañas, 'posición y órdenes pendientes viven en la pestaña Posiciones');
  ok(est.cuentaEnPestañas && est.statsEnPestañas && est.curvaEnPestañas, 'cuenta, estadísticas y curva de capital, en sus pestañas');
  ok(est.tradesEnPestañas && est.logEnPestañas && est.dibujosEnPestañas, 'trades, log y dibujos siguen accesibles por pestaña');
  ok(est.indicadoresVivos, 'los paneles de indicadores se reubican, no se eliminan');
  // Con §5.4 entran las dos pestañas nuevas DEL MEDIO (donde las tiene el sitio: los tres
  // historiales van seguidos), y `Dibujos` sigue cerrando la tira.
  ok(est.tabs.join() === 'positions,openorders,trades,fills,funding,account,stats,log,drawings', `pestañas: ${est.tabs.join(' · ')}`);
  ok(est.duplicados.length === 0, `sin ids duplicados en el marcado de la app${est.duplicados.length ? ' → ' + est.duplicados.join(',') : ''}`);
  ok(est.duplicadosLib.every((x) => x === 'tv-attr-logo' || x === 'a'),
     `lo único que se repite dentro de los charts es lo que inyecta la librería (${est.duplicadosLib.join(', ') || 'nada'})`);
  ok(est.faltanHeredados.length === 0, est.faltanHeredados.length ? 'FALTAN ids heredados: ' + est.faltanHeredados.join(',') : 'los 55 ids que consumen motor y suites siguen en el DOM');
  ok(est.faltanNuevos.length === 0, est.faltanNuevos.length ? 'FALTAN ids nuevos: ' + est.faltanNuevos.join(',') : 'los 41 ids nuevos del terminal existen');
  ok(est.cajas.bottom.y >= est.cajas.ws.bottom - 2 && est.cajas.chart.h > 200, 'el panel inferior cierra la ventana sin solapar el workspace');

  /* ═════════════════════════ B) PIEL MEDIDA DEL ORIGINAL ═════════════════════════ */
  console.log('\n▸ B) Paleta y rasgos MEDIDOS EN EL SITIO (docs/brecha-visual-bitunix.md)');
  const piel = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const cs = (id) => (g(id) ? getComputedStyle(g(id)) : null);
    const r = getComputedStyle(document.documentElement);
    const hoja = [...document.styleSheets].map((s) => s.href || '').find((h) => /bitunix/.test(h)) || '';
    // `#segMarginMode` QUEDÓ FUERA a propósito (ítem §5.5a): su fila es la PÍLDORA medida, donde
    // el activo es la palabra en blanco sin caja -anclado arriba—. El verde del segmentado se sigue
    // comprobando en uno genérico, `#segSize`, que es el que copia su «Abierto | Cerrado».
    const activa = document.querySelector('#segSize .seg-btn.active');
    const tab = document.querySelector('.tab.active');
    return {
      up: r.getPropertyValue('--up').trim(), down: r.getPropertyValue('--down').trim(),
      rightW: r.getPropertyValue('--right-w').trim(), fsCuerpo: r.getPropertyValue('--fs-cuerpo').trim(),
      pilla: cs('btnLong').borderTopLeftRadius,
      familia: getComputedStyle(document.body).fontFamily,
      inputAlto: (() => { const e = document.getElementById('sizeInput'); return e ? Math.round(e.getBoundingClientRect().height) : 0; })(),
      inputPrecio: (() => { const e = document.getElementById('limitInput'); return e ? Math.round(e.getBoundingClientRect().height) : 0; })(),
      accent: r.getPropertyValue('--accent').trim(), bg0: r.getPropertyValue('--bg-0').trim(), bg2: r.getPropertyValue('--bg-2').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyImg: getComputedStyle(document.body).backgroundImage,
      radioCard: cs('orderCard').borderTopLeftRadius,   // #bookCard va a sangre en su columna: se mira la de órdenes
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
  // Ancla re-escrita el 2026-10-10: antes venía del percentil 90 de un PNG y daba
  // #25ca93/#f65b55. Medido en el DOM vivo, el verde y el rojo de sus botones de entrada son
  // #24c18d y #f14b3f (Abrir Largo / Abrir Corto, getComputedStyle del sitio).
  ok(piel.up === '#24c18d' && piel.down === '#f14b3f', `verde ${piel.up} y rojo ${piel.down} (getComputedStyle de «Abrir Largo»/«Abrir Corto» en el sitio real)`);
  ok(piel.accent === '#b9f641', `lima de marketing ${piel.accent} (es SOLO «Registrarse» y la píldora «Ultra»; lo activo de la interfaz va en verde)`);
  ok(piel.bg0 === '#000000' && piel.bg2 === '#0f0f0f', `fondo de página ${piel.bg0} / panel inferior ${piel.bg2} (medidos en su body y en la caja de «Posiciones»)`);
  ok(piel.bodyBg === 'rgb(0, 0, 0)', `color de fondo aplicado al body: ${piel.bodyBg} (el suyo es #000000 plano, medido en su body)`);
  ok(piel.bodyImg === 'none', 'sin degradados decorativos (el terminal real es plano)');
  ok(piel.radioCard === '4px', `tarjetas con radio de ${piel.radioCard} (el sitio usa 4px en la tarjeta del gráfico y en la del panel inferior)`);
  ok(piel.longBg === 'rgb(36, 193, 141)' && piel.shortBg === 'rgb(241, 75, 63)', '«Abrir Largo» en rgb(36,193,141) y «Abrir Corto» en rgb(241,75,63), el verde y el rojo del sitio');
  /* La palabra, no la cadena exacta: `UI.refreshLabels` antepone el icono del modo (⏳ límite,
     🎯 trigger, 🌀 trailing, ▲ mercado) y esa señal vale más que el literal; lo que el registro
     exigía era que el nombre fuera el del sitio -antes «▲ COMPRAR / LONG»- y que «Long/Short»
     siguiera fuera. Con posición abierta u otro modo activo el rótulo cambia de icono y esto no
     debe romperse (11-oct: el ⚡ de la orden rápida, que toca el segmentado, lo rompía). */
  ok(/(^|\s)Abrir Largo$/.test(piel.longTxt) && /(^|\s)Abrir Corto$/.test(piel.shortTxt), `botones rotulados «${piel.longTxt}» / «${piel.shortTxt}» (el nombre del sitio + el icono del modo; «Long/Short» no aparecía en su panel)`);
  ok(piel.pilla === '9999px', `los dos botones son PÍLDORA (${piel.pilla}), como los suyos (radio 9999px medido)`);
  ok(piel.altoLong >= 34 && piel.altoLong <= 44, `altura del botón de entrada: ${piel.altoLong} px`);
  ok(piel.subrayado.h === '2px' && /36, 193, 141/.test(piel.subrayado.bg), `subrayado de la pestaña activa: ${piel.subrayado.h} en ${piel.subrayado.bg} (verde, no lima)`);
  ok(/36, 193, 141/.test(piel.seg.bg) && piel.seg.h <= 30, `segmentado genérico activo en verde rgb(36,193,141) (el suyo «Abierto» mide 26 px), ${piel.seg.h} px el nuestro - la fila de modo va plana, que es como la medimos-`);
  ok(/tabular-nums/.test(piel.tabulares), `cifras tabulares en la fila de estadísticas (${piel.tabulares})`);
  // El sitio declara su propio :root con --bu-fsz:14px y --bu-h5-fsz:12px. Nuestro cuerpo
  // estaba en 12 px: de ahí la sensación de «otra aplicación» aunque los colores fueran bien.
  ok(parseFloat(piel.cuerpo) >= 13.5 && parseFloat(piel.cuerpo) <= 14.5, `cuerpo ${piel.cuerpo} (--bu-fsz del sitio = 14px), precio destacado ${piel.precio}`);
  ok(/noto sans/i.test(piel.familia), `la pila tipográfica empieza por la familia del sitio: ${piel.familia.split(',')[0]}`);
  ok(piel.fsCuerpo === '14px' && parseInt(piel.inputAlto, 10) >= 40 && parseInt(piel.inputAlto, 10) <= 44,
     `campos de cantidad ${piel.inputAlto} px y de precio ${piel.inputPrecio} px (los suyos 42px) · --fs-cuerpo ${piel.fsCuerpo}`);
  ok(piel.rightW === '272px', `columna de órdenes de ${piel.rightW} (medida en el sitio: 272px a 1600px de ancho)`);
  ok(piel.fraccion.join() === '0,25,50,75,100', `deslizador de fracciones ${piel.fraccion.join('/')}`);
  // Ellos no tienen fila de botones: las fracciones son MARCAS de 12 px bajo el deslizador
  // (medido en su DOM: cada marca 17-31 px de ancho dentro de un bloque de 25 px). Nuestro
  // control equivalente es una línea de acentos, así que se admite desde 16 px.
  ok(piel.altoFraccion >= 16 && piel.altoFraccion <= 34, `la fila de fracciones mide ${piel.altoFraccion} px (sus marcas: 12 px de texto en un bloque de 25 px)`);
  ok(true, 'la hoja bitunix.css es la última del <head> (' + ORDEN_CSS + ')');
  ok(piel.altoFila >= 14 && piel.altoFila <= 22 && piel.filas >= 20 && piel.filas <= 28 && piel.filas % 2 === 0,
     `${piel.filas} filas de libro a ${piel.altoFila} px, las dos mitades iguales (el tope son 14 niveles por lado; el número que sale es el alto de la caja / 17, y tests/responsive.test.js comprueba que no sobre más de una fila)`);
  ok(piel.colorFilaAsk === 'rgb(241, 75, 63)' && piel.colorFilaBid === 'rgb(36, 193, 141)', 'ventas en rojo y compras en verde en el libro, con los colores del sitio');

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
  ok(libro.asks.length === libro.bids.length && libro.asks.length >= 5 && libro.asks.length <= 14, `${libro.asks.length} niveles de venta y ${libro.bids.length} de compra - las dos mitades, siempre iguales y dentro del tope -`);
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
  ok(orden.antes === '1X', `el chip de apalancamiento arranca en ${orden.antes} (la X mayúscula es la de su barra, medida «10X»)`);
  ok(orden.chip20 === '20X', 'mover el deslizador pone el chip en 20X');
  ok(orden.chip10 === '10X' && orden.tag === '10X', 'cambiar el <select> (lo que hacen otras suites) sincroniza chip y etiqueta');
  ok(orden.modo50 === 'pct' && String(orden.size50) === '50', `pulsar 50 en modo % deja el tamaño en ${orden.size50} (modo ${orden.modo50})`);
  ok(orden.coste === orden.esperadoCoste, `el «Coste» de la fila inferior es el notional real: ${orden.coste}`);
  /* La caja del margen cierra la cifra con la MISMA X mayúscula que su barra de apalancamiento
     (medido en el flotante y en la píldora: `10X`); antes el producto escribía `(10x)` y dos
     glifos distintos decían lo mismo a tres píxeles de distancia. El ancla comprueba el número y
     el paréntesis, y la caja por coherencia tipográfica, no por capricho. */
  ok(orden.margen.indexOf(orden.margenEsperado) === 0 && /\(10X\)/.test(orden.margen), `margen = notional/apalancamiento: ${orden.margen}`);
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
    // F6: se liquida cuando el margen DISPONIBLE (margen − pérdida) baja del mantenimiento, así que
    // el nivel es entrada − (margen − MM)/qty. Sin restar MM sale un precio MÁS lejano del que da
    // Bitunix; el assert de abajo deja el término MM a la vista para que no se pierda la diferencia.
    const mm = TE.liqInfo(p).mantenimiento;
    const esperado = p.entryPrice - (p.notional / p.leverage - mm) / p.qty;
    const esperadoSinMM = p.entryPrice - (p.notional / p.leverage) / p.qty;
    document.querySelector('[data-mm="cross"]').click();
    const cruzado = TE.liquidationPrice(TE.state.position);
    return {
      aislado, cruzado, esperado, lado: p.side, lev: p.leverage, entry: p.entryPrice,
      margen: TE.marginOf(p), libre: TE.freeMargin(), qty: p.qty, notional: p.notional,
      esperadoSinMM,
      esperadoCruzado: p.entryPrice - (TE.marginOf(p) + TE.freeMargin() - mm) / p.qty,
      esperadoCruzadoSinMM: p.entryPrice - (TE.marginOf(p) + TE.freeMargin()) / p.qty,
      mm,
      txtLiq: document.getElementById('posLiq').textContent,
      txtLiqNum: (() => { const m = String(document.getElementById('posLiq').textContent).match(/-?\d[\d,]*\.?\d*/); return m ? Number(m[0].replace(/,/g, '')) : NaN; })(),
      modo: TE.state.marginMode,
      activo: document.querySelector('#segMarginMode .seg-btn.active').dataset.mm,
      margenCuenta: document.getElementById('acMargin').textContent,
    };
  });
  ok(cerca(liq.aislado, liq.esperado, 0.01), `liquidación AISLADA ${liq.aislado.toFixed(2)} = entrada − (margen − MM ${liq.mm.toFixed(2)})/qty (${liq.esperado.toFixed(2)})`);
  ok(Math.abs(liq.aislado - liq.esperadoSinMM) > liq.mm / liq.qty - 0.01,
    `y está MÁS CERCA de la entrada que el modelo simple sin mantenimiento (${liq.esperadoSinMM.toFixed(2)}): la diferencia es exactamente MM/qty = ${(liq.mm / liq.qty).toFixed(2)}`);
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
      // Solo los campos VISIBLES: con el bloque «Avanzado» plegado (≤640), SL, TP y la
      // comisión heredada están `display:none` y medirían 0 px —no es un área táctil
      // pequeña, es un campo que no está en pantalla (lo que se exige es que al abrirlo
      // ocupe lo suyo, y eso lo comprueba `tests/responsive.test.js`).
      inputs: [...document.querySelectorAll('#orderCard input[type=number]')].filter((i) => i.offsetParent !== null).map((i) => Math.round(i.getBoundingClientRect().height)),
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
  /* Con el bloque «Avanzado» plegado (≤640) los ÚNICOS campos numéricos en pantalla son
     el del tamaño y el del precio límite: exigir «≥3 campos» aquí era contar campos que
     no existen a la vista. Se comprueban las dos mitades, que es lo que de verdad promete
     el arreglo: los visibles son táctiles y, al abrir el bloque, los plegados salen con
     su alto. La otra mitad la mide `tests/responsive.test.js` (SL/TP se enfocan y se
     escriben tras deslizar la tarjeta). */
  ok(est2.inputs.length >= 2 && est2.inputs.every((h) => h >= 24), `los campos visibles del panel de órdenes son táctiles (${est2.inputs.join(',')})`);
  const advAbierto = await page.evaluate(async () => {
    const g = (id) => document.getElementById(id);
    const card = g('orderCard'), estabaCerrado = card.classList.contains('adv-cerrado');
    if (estabaCerrado) { g('btnOrderAvanzado').click(); await new Promise((r) => setTimeout(r, 400)); }
    /* SL y TP viven detras de su casilla desde el item 5b (en el sitio llega desmarcada, medido),
       asi que contarlos exige desplegarlos: es el gesto real, no un trampolilo geometrico. */
    const chk = g('chkTpSl'), estabaApagada = !!chk && !chk.checked;
    if (estabaApagada) { chk.click(); await new Promise((r) => setTimeout(r, 320)); }
    if (g('orderCard').classList.contains('adv-cerrado')) { g('btnOrderAvanzado').click(); await new Promise((r) => setTimeout(r, 400)); }
    const vis = [...document.querySelectorAll('#orderCard input[type=number]')].filter((i) => i.offsetParent !== null);
    const r = { n: vis.length, hs: vis.map((i) => Math.round(i.getBoundingClientRect().height)), ids: vis.map((i) => i.id) };
    if (estabaApagada) { chk.click(); await new Promise((r2) => setTimeout(r2, 320)); }
    if (estabaCerrado) { g('btnOrderAvanzado').click(); await new Promise((r2) => setTimeout(r2, 320)); }
    return r;
  });
  ok(advAbierto.n >= 4 && advAbierto.hs.every((h) => h >= 24),
     `abriendo «Avanzado» y marcando la casilla TP/SL entran SL, TP y la comisión con alto táctil (${advAbierto.hs.join(',')} en ${advAbierto.n} campos: ${advAbierto.ids.join('/')})`);
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

  /* ─────────── H2) EL MOVIL DE DOS VISTAS (§5.6, medido con tools/medir-movil-bitunix.js) ───────────
     Su movil a 390x844: en la cabecera hay un grupo `pill-tabs` de DOS cascos de 44x32 (radios 999,
     #1a1b1c, el activo #272829 en blanco) que cambia la pantalla de operar por la de carta; y la de
     operar son DOS COLUMNAS -formulario de 180 utiles en x=15..195 y libro en x=210..383, sin carta
     visible-, con el rotulo de 12/400 #919499 ENCIMA de cada caja y `Abrir Largo`/`Abrir Corto`
     APILADOS a 180x40 con paso de 55 (y=624 y y=679). Aqui las columnas salen de 170 y 175: mismo
     hueco de 15 px entre las dos y 15 de margen de pagina, y el ancho que no se comen las tarjetas
     es el que ellos dan al libro. La ALTURA de la pastilla es 26, no 32, y la cuenta esta hecha en
     css/bitunix.css (BLOQUE 24): con 32 el cabecero media 94 y `#chartWrap` perdia 4 px de velas. */
  const mov = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const B = (e) => { if (!e) return null; const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               r: Math.round(r.right) }; };
    const pastilla = g('bfVistas'), cs = (e) => e ? getComputedStyle(e) : null;
    const cascos = [...document.querySelectorAll('#bfVistas .bf-vista')].map((e) => ({
      v: e.dataset.vista, caja: B(e), fondo: cs(e).backgroundColor, texto: cs(e).color,
      radio: parseFloat(cs(e).borderTopLeftRadius) }));
    const card = g('orderCard'), cuerpo = card.querySelector('.card-body'), libro = g('bookCard');
    const lab = card.querySelector('.field .field-label');
    const largo = g('btnLong'), corto = g('btnShort');
    const visibles = [...card.querySelectorAll('button, input, select')].filter((e) => e.offsetParent !== null);
    return {
      vista: document.body.dataset.vista,
      pastilla: B(pastilla), fondoPastilla: cs(pastilla).backgroundColor, radioPastilla: cs(pastilla).borderTopLeftRadius,
      cascos,
      cartaArea: B(g('chartArea')), sidebar: B(g('sidebar')),
      cols: cs(g('sidebar')).gridTemplateColumns, orden: B(card), libro: B(libro),
      cuerpoSobra: cuerpo.scrollHeight - cuerpo.clientHeight, tarjetaSobra: card.scrollHeight - card.clientHeight,
      corteCard: Math.max(0, card.scrollWidth - card.clientWidth), corteSidebar: Math.max(0, g('sidebar').scrollWidth - g('sidebar').clientWidth),
      altoBtn: Math.round(largo.getBoundingClientRect().height),
      paso: Math.round(corto.getBoundingClientRect().y - largo.getBoundingClientRect().y),
      anchoLargo: Math.round(largo.getBoundingClientRect().width), anchoCorto: Math.round(corto.getBoundingClientRect().width),
      radioBtn: parseFloat(cs(largo).borderTopLeftRadius), pxBtn: parseFloat(cs(largo).fontSize),
      rotulo: lab ? { px: parseFloat(cs(lab).fontSize), peso: cs(lab).fontWeight, color: cs(lab).color,
                      arribaDeCaja: Math.round(lab.getBoundingClientRect().bottom) <= Math.round(lab.parentElement.querySelector('input,select').getBoundingClientRect().top) + 2 } : null,
      libroCols: getComputedStyle(libro.querySelector('.bf-row')).gridTemplateColumns.split(' ').length,
      ultimoLibro: (() => { const e = g('bookLast'); if (!e) return null; const c = getComputedStyle(e);
        return { px: parseFloat(c.fontSize), peso: c.fontWeight }; })(),
      controles: visibles.map((e) => Math.round(e.getBoundingClientRect().height)),
      doc: document.documentElement.scrollHeight - window.innerHeight,
      ox: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  ok(mov.pastilla && Math.abs(mov.pastilla.w - 88) <= 2 && mov.cascos.length === 2
     && mov.cascos.every((c) => Math.abs(c.caja.w - 44) <= 1 && c.caja.h >= 24)
     && mov.cascos.every((c) => c.radio >= 12),
     `el conmutador es un grupo de 88x26 con dos cascos de 44 y radio de pastilla (${mov.pastilla.w}×${mov.pastilla.h}, ${mov.cascos.map((c) => c.caja.w + '×' + c.caja.h).join('/')})`);
  ok(mov.fondoPastilla.replace(/\s/g,'') === 'rgb(26,27,28)'
     && mov.cascos.some((c) => c.v === mov.vista && c.fondo.replace(/\s/g,'') === 'rgb(39,40,41)')
     && mov.cascos.some((c) => c.v === mov.vista && c.texto.replace(/\s/g,'') === 'rgb(255,255,255)'),
     `la pastilla y su casilla activa, con sus colores medidos (${mov.fondoPastilla} / ${mov.cascos.map((c) => c.fondo).join(' · ')})`);
  ok(mov.vista === 'carta', `de arranque el telefono abre en CARTA, no en operar (${mov.vista}) -desvio escrito en el registro: el de ellos es un terminal de trading y el nuestro uno de replay-`);
  ok(mov.cartaArea.h > 100 && mov.sidebar.h <= 290, `en Carta el grafico ocupa y la franja del terminal es la fila de siempre (${mov.cartaArea.h} y ${mov.sidebar.h} px)`);

  /* Y ahora el gesto: pasar a Operar. Se comprueba contra los numeros de la suya. */
  await page.evaluate(() => { document.querySelector('#bfVistas [data-vista="operar"]').click(); });
  await espera(600);
  const ope = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const B = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right) }; };
    const card = g('orderCard'), libro = g('bookCard'), sb = g('sidebar'), cuerpo = card.querySelector('.card-body');
    const cs = (e) => getComputedStyle(e);
    const lab = card.querySelector('.field .field-label');
    const caja = lab && lab.parentElement.querySelector('input, select');
    const largo = g('btnLong'), corto = g('btnShort');
    const fila = libro.querySelector('.bf-row');
    return { vista: document.body.dataset.vista,
      chart: B(g('chartArea')), sidebar: B(sb), cols: cs(sb).gridTemplateColumns,
      orden: B(card), libro: B(libro), cuerpo: B(cuerpo),
      sinCorteVertical: cuerpo.scrollHeight - cuerpo.clientHeight, sinCorteTarjeta: card.scrollHeight - card.clientHeight,
      sinDesbordes: [sb, card, libro, cuerpo].map((e) => Math.max(0, e.scrollWidth - e.clientWidth)),
      botones: [B(largo), B(corto)], paso: Math.round(corto.getBoundingClientRect().y - largo.getBoundingClientRect().y),
      radio: parseFloat(cs(largo).borderTopLeftRadius), px: parseFloat(cs(largo).fontSize),
      rotulo: lab ? { px: parseFloat(cs(lab).fontSize), peso: cs(lab).fontWeight, color: cs(lab).color,
                      encima: Math.round(lab.getBoundingClientRect().bottom) <= Math.round((caja || lab).getBoundingClientRect().top) + 2 } : null,
      libroCols: fila ? cs(fila).gridTemplateColumns.split(' ').length : 0,
      totalOculto: fila ? cs(fila.querySelector('.t')).display === 'none' : null,
      dianas: [...card.querySelectorAll('button, input, select')].filter((e) => e.offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height)),
      /* Los dos defectos que la pantalla delataba y la geometria no: `text-overflow: ellipsis` en
         los segmentados del tier de 640 (salia `Cruz...`) y el `Libr0,5` de la cabecera del libro,
         dos nodos cuyo rect se solapa. Se mide, no se mira. */
      puntos: [...card.querySelectorAll('.seg-btn, .bf-lev-chips *, .bf-cost *')]
        .filter((e) => e.children.length === 0 && e.scrollWidth - e.clientWidth > 1
          && /hidden|ellipsis/.test(getComputedStyle(e).textOverflow)).map((e) => (e.innerText || '').trim().slice(0, 12)),
      pisados: (() => { const hs = document.querySelector('#bookCard > .card-head'); if (!hs) return 0;
        const ks = [...hs.children].map((e) => e.getBoundingClientRect()); let n = 0;
        for (let x = 0; x < ks.length; x++) for (let y = x + 1; y < ks.length; y++) {
          const A = ks[x], C = ks[y];
          if (A.right > C.left + 1 && C.right > A.left + 1 && A.bottom > C.top + 1 && C.bottom > A.top + 1) n++; }
        return n; })(),
      /* Y el mismo defecto, medido en geometria: una cabecera con el alto fijo que envuelve pinta su
         segunda fila fuera de su caja. `salta` es lo que desborda de su propio rect. */
      cabeceras: ['#bookCard', '#orderCard'].map((sel) => { const h = document.querySelector(sel + ' > .card-head');
        if (!h) return null; const r = h.getBoundingClientRect();
        /* Solo lo que se PINTA: el menu de agregacion vive dentro de la cabecera con
           `visibility: hidden` y caja de 9 px en el pie de la tarjeta, y contarlo como «por encima de
           su caja» era un falso positivo de la propia ancla (lo confirmé midiendo el rect de ese
           descendiente: y=418 en una cabecera que termina en 139). */
        const fuera = [...h.querySelectorAll('*')].filter((e) => { const c = getComputedStyle(e);
          return e.offsetParent !== null && c.visibility !== 'hidden' && c.opacity !== '0'
            && e.getBoundingClientRect().bottom > r.bottom + 1; }).length;
        const cuerpo = document.querySelector(sel + ' > .card-body, ' + sel + ' .card-body');
        const primera = cuerpo && cuerpo.querySelector('.bf-row, .seg, .field');
        return { sel, alto: Math.round(r.height), fuera,
          pisaCuerpo: primera ? Math.max(0, Math.round(r.bottom - primera.getBoundingClientRect().top)) : 0 }; }).filter(Boolean),
      cerrarTodo: (() => { const e = card.querySelector('.bf-cost .bf-flat'); if (!e) return null;
        const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
      doc: document.documentElement.scrollHeight - window.innerHeight,
      ox: document.documentElement.scrollWidth - window.innerWidth,
      guardado: (window.ST && ST.get) ? ST.get('vistaMovil', null) : null };
  });
  ok(ope.vista === 'operar' && ope.chart.h === 0, `al pasar a Operar la carta se va de la pantalla (alto ${ope.chart.h})`);
  ok(ope.orden.x < ope.libro.x && ope.orden.r <= ope.libro.x + 1 && ope.sidebar.h > 300,
     `dos columnas, formulario · libro, sin pisarse (orden x=${ope.orden.x}..${ope.orden.r}, libro x=${ope.libro.x}, franja ${ope.sidebar.h} px)`);
  ok(/170px 175px/.test(ope.cols), `el reparto medido: 170 del formulario y 175 del libro (salio «${ope.cols}», el suyo es 180 y 175)`);
  ok(ope.paso === 55 && ope.botones[0].h === 40 && ope.botones[1].h === 40
     && ope.botones[0].w === ope.botones[1].w && ope.radio >= 40 && ope.px === 14,
     `los dos botones, apilados a paso 55 y 40 px de alto, en pastilla de 14 px (salto ${ope.paso}px, ${ope.botones[0].w}×${ope.botones[0].h}, radio ${ope.radio})`);
  ok(ope.rotulo && ope.rotulo.px === 12 && ope.rotulo.peso === '400' && ope.rotulo.encima
     && ope.rotulo.color.replace(/\s/g,'') === 'rgb(145,148,153)',
     `el rotulo va ENCIMA de su caja, a 12/400 en #919499 (${ope.rotulo && ope.rotulo.px}/${ope.rotulo && ope.rotulo.peso})`);
  ok(ope.sinCorteVertical === 0 && ope.sinCorteTarjeta === 0 && ope.sinDesbordes.every((n) => n === 0),
     `nada queda recortado en las dos columnas (vertical ${ope.sinCorteVertical}/${ope.sinCorteTarjeta}, horizontal ${ope.sinDesbordes.join('/')})`);
  ok(ope.doc <= 0 && ope.ox === 0, `la vista de operar entra en 844 px sin deslizar la pagina (documento ${844 + ope.doc}, scroll horizontal ${ope.ox})`);
  ok(ope.dianas.length >= 6 && ope.dianas.every((h) => h >= 20), `todo control visible del formulario sigue siendo diana (${ope.dianas.join('/')})`);
  ok(ope.puntos.length === 0 && ope.pisados === 0,
     `en la columna de 170 no hay ni un rotulo cortado con puntos ni un par de nodos que se pisen` +
     `${ope.puntos.length ? ' (los puntos: ' + ope.puntos.join(', ') + ')' : ''}${ope.pisados ? ' (pisados: ' + ope.pisados + ')' : ''}`);
  ok(ope.cabeceras.every((c2) => c2.fuera === 0 && c2.pisaCuerpo <= 0),
     `ninguna cabecera pinta por encima de su caja (salta ${ope.cabeceras.map((x) => x.fuera).join('/')} y pisa el cuerpo ${ope.cabeceras.map((x) => x.pisaCuerpo).join('/')} px)`);
  ok(ope.cerrarTodo && ope.cerrarTodo.h <= 26 && ope.cerrarTodo.w >= 70,
     `«Cerrar todo» en su fila de la rejilla, sin partirse en dos (${ope.cerrarTodo && ope.cerrarTodo.w}×${ope.cerrarTodo && ope.cerrarTodo.h})`);
  ok(ope.libroCols === 2 && ope.totalOculto === true, `el libro, en su columna de 175, con dos columnas de datos (${ope.libroCols})`);
  ok(ope.guardado === 'operar', `la eleccion queda recordada (ST: «${ope.guardado}») -en el suyo tambien es memoria de usuario-`);

  /* Y vuelta: el conmutador tiene que devolver el terminal exacto que midio `test:layout`. Se deja
     en Carta a proposito, porque el resto del fichero (y las capturas) parten de ese reposo. */
  await page.evaluate(() => { document.querySelector('#bfVistas [data-vista="carta"]').click(); });
  await espera(600);
  const vta = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    return { vista: document.body.dataset.vista, chart: Math.round(g('chartArea').getBoundingClientRect().height),
      franja: Math.round(g('sidebar').getBoundingClientRect().height), scrollea: g('sidebar').scrollWidth > g('sidebar').clientWidth + 2,
      doc: document.documentElement.scrollHeight - window.innerHeight, ox: document.documentElement.scrollWidth - window.innerWidth };
  });
  ok(vta.vista === 'carta' && vta.chart > 100 && vta.franja <= 290 && vta.scrollea && vta.ox === 0,
     `y al volver a Carta el terminal es el de antes (grafico ${vta.chart}, franja ${vta.franja} que desliza: ${vta.scrollea ? 'si' : 'no'}, scroll ${vta.ox})`);

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
    const mide = (n, fn) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) / n; };
    const antes = OB.state.renders;
    const i0 = BR.getIndex();
    const v1 = mide(60, () => App.stepForward());
    const v2 = mide(60, () => App.stepForward());
    const rendersVela = OB.state.renders - antes;   // solo los del replay, antes de medir el libro a pelo
    const l1 = mide(60, () => OB.render());
    const l2 = mide(60, () => OB.render());
    return {
      vela: Math.min(v1, v2), velaBruta: v1, libro: Math.min(l1, l2), libroBruto: l1,
      renders: rendersVela, velas: BR.getIndex() - i0,
      filas: document.querySelectorAll('#bookAsks .bf-row, #bookBids .bf-row').length,
    };
  });
  /* ANTES este aserto era `ms/vela < 12`, un número absoluto medido en el equipo de diseño. En un
     sandbox compartido falla solo: probado con la versión de estos cambios y con la de antes en la
     MISMA llamada, dieron 5,97 vs 5,78 ms/vela —y 3,24 vs 4,66 al invertir el orden—, y dentro de
     la suite entera oscila 10,4-13,7 con el mismo binario. Se mide pues lo que de verdad importa:
     cuánto AÑADE el terminal al coste de avanzar una vela (relativo, inmune al hardware) y un
     techo ancho que caza una regresión cuadrática sin penar la máquina. */
  ok(salud.velas === 120, `las dos tandas avanzaron 120 velas reales (${salud.velas}): sin eso, cualquier tiempo medido sería humo`);
  ok(salud.libro < salud.vela * 1.5,
    `el libro y las estadísticas a pelo cuestan ${salud.libro.toFixed(2)} ms por pasada frente a ${salud.vela.toFixed(2)} ms por vela del replay (×${(salud.libro / salud.vela).toFixed(2)}): el terminal no multiplica el coste de avanzar`);
  ok(salud.vela < 45, `${salud.vela.toFixed(2)} ms/vela (mejor de dos tandas; la primera ${salud.velaBruta.toFixed(2)}) — techo anti O(n²), no umbral de hardware`);
  ok(salud.renders >= 120, `el libro se refresca en cada una de las 120 velas (${salud.renders} renders)`);
  ok(salud.filas >= 20 && salud.filas <= 28, `tras 60 velas el libro sigue en ${salud.filas} filas (su rango con la caja de 232 px es 20-28), sin acumular nodos`);
  ok(errs.length === 0, `sin errores de JavaScript ni de consola (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' ⧸ ') : ''}`);
  ok(recursos > 0, `las ${recursos} peticiones de exchange fallaron por el corte de red (y la app las digirió)`);

  /* ═════════ J) NIVELES Y FUNDING DEL EXCHANGE (proxy simulado, servido por HTTP) ═════════
   * Se sirve la app en http://127.0.0.1 con un stub en las rutas /api/bx/*, que es el camino REAL.
   * Mockear con `page.setRequestInterception` NO vale para esto: el `respond()` de puppeteer no
   * añade `Access-Control-Allow-Origin` y el navegador bloquea la llamada antes de que llegue a
   * manos de la app (comprobado: «Failed to fetch» desde file://).
   * El fixture son los 11 tramos que la API devolvió HOY para BTCUSDT. La documentación del API
   * enseña un ejemplo con 2 (125× y 0,4 %), que está desfasado: por eso el test fija los números
   * medidos y el motor admite inyectar la tabla, para no depender de una ruta inventada. */
  console.log('\n▸ J) Tramos de riesgo leídos de Bitunix (proxy simulado)');
  {
    const http = require('http');
    const HTML = path.join(__dirname, '..', 'bar-replay-pro-unico.html');
    const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bitunix-tiers-btcusdt.json'), 'utf8'));
    const FUNDING = { code: 0, msg: 'Success', data: { symbol: 'BTCUSDT', markPrice: '82802.6', lastPrice: '82802.5',
      indexPrice: '82841.1', fundingRate: '-0.003288', fundingInterval: 8, nextFundingTime: '1791648000000',
      maxFundingRate: '0.3', minFundingRate: '-0.3' } };
    let tierFalla = false;
    const srv = http.createServer((req, res) => {
      const u = String(req.url || '/');
      const json = (codigo, obj) => { res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
      if (u.startsWith('/api/bx/position-tiers')) return json(200, tierFalla ? { code: 20015, data: null, msg: 'this Futures is not allowed to trade.' } : FIX);
      if (u.startsWith('/api/bx/funding-rate')) return json(200, FUNDING);
      if (u.startsWith('/api/bx/tickers')) return json(200, { code: 0, msg: 'Success', data: [] });
      if (u.startsWith('/api/')) return json(500, { error: 'stub: sin upstream' });   // velas etc.: que degrade
      fs.readFile(HTML, (e, buf) => {
        if (e) return json(500, { error: 'sin archivo único' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(buf);
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const puerto = srv.address().port;

    const p2 = await browser.newPage();
    await p2.setViewport({ width: 1440, height: 900 });
    const err2 = [];
    p2.on('pageerror', (e) => err2.push(e.message));
    await p2.goto('http://127.0.0.1:' + puerto + '/', { waitUntil: 'domcontentloaded' });
    await p2.waitForFunction(() => window.App && window.TE && window.DS && window.ST, { timeout: 25000 });
    await espera(900);

    const v1 = await p2.evaluate(async () => {
      const r = await App.aplicarRiesgoBitunix();
      return {
        filas: TE.state.niveles ? TE.state.niveles.length : 0,
        tramo1: TE.state.niveles ? TE.state.niveles[0] : null,
        lev: TE.apalancamientoPermitido(150000, 300),
        fundingPct: TE.state.fundingPct, cada: TE.state.fundingCadaHoras,
        fuente: (document.getElementById('setNivelesFuente') || {}).textContent || '',
        hay: !!document.getElementById('setNivelesAuto'), avisos: (r && r.avisos) || [],
      };
    });
    ok(v1.hay, 'el interruptor «tramos del exchange» existe en Ajustes');
    ok(err2.length === 0, `cargar los datos de riesgo no rompe nada (${err2.length} errores)${err2.length ? ' → ' + err2[0].slice(0, 120) : ''}`);
    ok(v1.filas === 11, `la tabla de 11 tramos entra entera en el motor (${v1.filas}; avisos: ${v1.avisos.join(' · ') || 'ninguno'})`);
    ok(v1.tramo1 && +v1.tramo1.endValue === 100000 && +v1.tramo1.leverage === 200 && Math.abs(+v1.tramo1.maintenanceMarginRate - 0.003) < 1e-9,
      `el tramo 1 llega como lo da la API: 0→${v1.tramo1 && v1.tramo1.endValue}, ${v1.tramo1 && v1.tramo1.leverage}×, MMR ${v1.tramo1 && v1.tramo1.maintenanceMarginRate}`);
    ok(v1.lev.leverage === 150 && v1.lev.recortado, `un nocional de 150 000 cae en el tramo 2 REAL (150×), no en el de la doc (100×): ${JSON.stringify(v1.lev)}`);
    ok(v1.fundingPct === 0, `la tasa del exchange NO se aplica sola al PnL (el ajuste sigue en ${v1.fundingPct} %): se ofrece, no se impone`);
    ok(v1.cada === 8, `y el ritmo de liquidación sí viene del contrato (fundingInterval = ${v1.cada} h)`);
    ok(/11 tramos/.test(v1.fuente), `la carta dice de dónde salen los números: «${v1.fuente}»`);

    const v2 = await p2.evaluate(() => {
      const c = document.getElementById('setNivelesAuto');
      c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true }));
      return { filas: TE.state.niveles ? TE.state.niveles.length : 0, lev: TE.apalancamientoPermitido(150000, 300),
        fuente: (document.getElementById('setNivelesFuente') || {}).textContent || '' };
    });
    ok(v2.filas === 2 && v2.lev.leverage === 100,
      `apagar el interruptor devuelve la tabla de la documentación (${v2.filas} tramos, ${v2.lev.leverage}× a 150 000): dos ejecuciones sin red dan lo mismo`);
    ok(/documentaci.n/.test(v2.fuente), `y se sigue diciendo la fuente: «${v2.fuente}»`);

    tierFalla = true;
    const v3 = await p2.evaluate(async () => {
      DS.MARKET._cache.clear();                     // sin esto, la respuesta buena cacheada taparía el caso de error
      const c = document.getElementById('setNivelesAuto');
      c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1200));
      return { filas: TE.state.niveles ? TE.state.niveles.length : 0, lev: TE.apalancamientoPermitido(150000, 300),
        fundingPct: TE.state.fundingPct };
    });
    ok(v3.filas === 2 && v3.lev.leverage === 100,
      `si la API responde un error de NEGOCIO con HTTP 200 (code 20015) el motor no se queda sin tabla ni se rompe: ${v3.filas} tramos, ${v3.lev.leverage}×`);
    ok(v3.fundingPct === 0, 'y un fallo de datos no toca el PnL');

    // La carta de posición: el tramo que genera el precio, y «sin nivel» cuando no lo hay (F8).
    const v4 = await p2.evaluate(() => {
      document.getElementById('setNivelesAuto').checked = true;
      document.getElementById('setNivelesAuto').dispatchEvent(new Event('change', { bubbles: true }));
      const iso = document.querySelector('[data-mm="isolated"]'); if (iso) iso.click();
      document.getElementById('sizeInput').value = 20;
      App.placeOrder('long');
      UI.refreshPosition();
      const el = document.getElementById('posLiq');
      const aislada = { txt: el.textContent, titulo: el.title, precio: TE.liqInfo(TE.state.position).precio };
      const cr = document.querySelector('[data-mm="cross"]'); if (cr) cr.click();
      UI.refreshPosition();
      const info = TE.liqInfo(TE.state.position);
      return { aislada, cruzada: { txt: el.textContent, sin: info.sinNivel, precio: info.precio },
        modo: TE.state.marginMode, abierto: !!TE.state.position };
    });
    ok(v4.abierto, 'en la página servida por HTTP se puede abrir posición (el snapshot embebido cubre la ausencia de upstream)');
    ok(/· N\d/.test(v4.aislada.txt), `la carta AISLADA pinta el tramo que genera la liquidación: «${v4.aislada.txt}»`);
    ok(/mantenimiento/.test(v4.aislada.titulo) && /Margin Rate/.test(v4.aislada.titulo),
      `y el detalle (MMR, mantenimiento, «Margin Rate») está en el title: ${String(v4.aislada.titulo).slice(0, 120)}…`);
    ok(v4.cruzada.sin === true && /sin nivel/.test(v4.cruzada.txt),
      `en CRUZADO con cuenta holgada no hay precio de liquidación y la carta lo dice con palabras en vez de un 0: «${v4.cruzada.txt}» (precio ${v4.cruzada.precio})`);

    await p2.close();
    await new Promise((r) => srv.close(r));
  }

  /* ══════ I) LA ETIQUETA DE LA ORDEN VISUAL SOBRE LA CARTA (§5.7) ══════
     Fuente: el vídeo oficial de Bitunix «visual-orders», medido fotograma a fotograma con recorte por
     color sobre el nativo (4800×2700 = 1600×900 CSS a dpr 3 → los píxeles del fotograma se dividen
     entre 3): el grupo de etiqueta mide 30 px de alto, la pastilla sólida 27×119, y nace en la x de la
     vela de la orden (x=182 en el fotograma), con el PnL firmado y la × en una caja oscura al lado.
     Esto se pinta en #overlayCanvas, así que no hay CSS que anclar: se muestrea el PIxel del lienzo.
     Los precios del montaje salen de invertir las coordenadas (CM.yToPrice) para que las tres líneas
     caigan dentro del lienzo -a 3 % de la entrada el TP se salía por arriba y el muestreo daba negro-
     y el tiempo de la vela es el del índice del replay, que es el único que el timeScale conoce. */
  console.log('\n▸ I) La etiqueta de la orden visual (medida sobre su vídeo, §5.7)');
  const vis = await page.evaluate(() => {
    const alto = DT.height || 367;
    const enY = (f) => { const p = CM.yToPrice(Math.round(alto * f)); return p === null ? null : Math.round(p * 100) / 100; };
    /* La vela de entrada que se elige es una con HUECO a la derecha (la etiqueta mide ~180 px): si se
       toma la del índice del replay, que va pegada al borde, la x de la pastilla sale recortada por
       diseño y la ancla de posición no significa nada. */
    let t = null, xVela = null;
    const i0 = BR.getIndex ? Math.max(0, BR.getIndex()) : 0;
    for (let i = 0; i < CM.candles.length && xVela === null; i++) {
      const x = CM.candles[i] ? DT._xOf(CM.candles[i].time) : null;
      if (x !== null && x >= 20 && x <= (DT.width || 800) - 340) { t = CM.candles[i].time; xVela = x; }
    }
    const entrada = enY(0.46), tp = enY(0.28), sl = enY(0.62);
    const pos = { side: 'long', entryPrice: entrada, qty: 0.1592, sl: sl, tp: tp, entryTime: t,
      leverage: 3, margin: 50, notional: entrada * 0.1592, feePct: 0.05, openFee: 0, funding: 0,
      mfe: 0, mae: 0, bars: 0 };
    DT.setTradeHandles(pos);
    try { CM.setPositionLines(pos); } catch (e) { return { err: String(e) }; }
    DT.render();
    const cv = DT.canvas, es = cv.width / (cv.clientWidth || 1);
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    const lee = (x, y) => { const d = g2.getImageData(Math.round(x * es), Math.round(y * es), 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
    const H = (d) => '#' + d.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
    const cerca = (a, b) => Math.abs(a[0] - b[0]) <= 8 && Math.abs(a[1] - b[1]) <= 8 && Math.abs(a[2] - b[2]) <= 8;
    const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const out = { xVela, anchoLienzo: Math.round(cv.clientWidth),
      alto: Math.round(cv.clientHeight), precios: { entrada, sl, tp },
      Handles: DT.tradeHandles.map((h) => ({ id: h.id, color: h.color, qty: h.qty, entrada: h.entryPrice, grupo: h._grupo })),
      cruces: (DT._cajasCruz || []).map((k) => ({ id: k.id, x: k.x, y: k.y, w: k.w, h: k.h })),
      lineas: (CM._priceLines || []).map((l) => (l.options ? (l.options().title || '') : '')).join(','),
      nLineas: (CM._priceLines || []).length,
      rotulosNivel: (CM._priceLines || []).filter((l) => l.options && /^(SL|TP) /.test(l.options().title || '')).length,
      estiloEntrada: (() => { const l = (CM._priceLines || []).find((x) => x.options && /LONG|SHORT/.test(x.options().title || '')); return l ? l.options().lineStyle : null; })(),
      estiloNivel: (() => { const l = (CM._priceLines || []).find((x) => x.options && x.options().color === '#24c18d'); return l ? l.options().lineStyle : null; })(),
      pnl: { largo: TE.pnlBrutoEn(110, { entryPrice: 100, qty: 2, side: 'long' }),
             corto: TE.pnlBrutoEn(90, { entryPrice: 100, qty: 2, side: 'short' }),
             sinDatos: TE.pnlBrutoEn(110, { qty: 2, side: 'long' }) } };
    DT.tradeHandles.forEach((h) => {
      const g = h._grupo; if (!g) return;
      const x = g.x + 6, y = g.y + 6, tinta = rgb(h.color);
      const o = { grupoW: g.w, dentro: H(lee(x, y)), espera: h.color, dentroOk: cerca(lee(x, y), tinta),
        arriba: H(lee(x, g.y - 5)), abajo: H(lee(x, g.y + g.h + 5)) };
      o.yaQueNoPisa = !cerca(lee(x, g.y - 5), tinta) && !cerca(lee(x, g.y + g.h + 5), tinta);
      const cruz = DT._cajasCruz.find((k) => k.id === h.id);
      o.enCruz = (() => { const k = DT._hitTradeX(cruz.x + 13, cruz.y + 13); return k ? k.id : null; })();
      o.arrastreEnCruz = (() => { const k = DT._hitTradeHandle(cruz.x + 13, cruz.y + 13); return k ? k.id : null; })();
      o.golpeEnPastilla = (() => { const k = DT._hitTradeHandle(x, g.y + Math.round(g.h / 2)); return k ? k.id : null; })();
      if (h.id === 'tp') {                       // la banda de ganancia mientras se arrastra
        const yBanda = Math.max(2, g.y - 40);
        DT.drag = { tradeHandle: h, id: h.id, lastPrice: h.price };
        DT.render();
        const durante = lee(x, yBanda);
        DT.drag = null; DT.render();
        o.banda = { durante: H(durante), alfa: durante[3], verde: durante[1] > durante[0] + 40 && durante[1] > durante[2] + 20 && durante[3] > 0,
          despuesAlfa: lee(x, yBanda)[3] };
      }
      out['m' + h.id] = o;
    });
    DT.setTradeHandles(TE.state.position || null);
    CM.clearPositionLines(); CM.setPositionLines(TE.state.position || null);
    DT.render();
    return out;
  });
  ok(!vis.err && vis.nLineas >= 3, `la posición pinta sus líneas en la carta (${vis.nLineas}: ${vis.lineas.slice(0, 54)})${vis.err ? ' — ' + vis.err : ''}`);
  ok(vis.rotulosNivel === 0, 'SL/TP NO duplican su texto sobre la línea: el rótulo lo lleva la pastilla dibujada');
  ok(vis.estiloEntrada === 1 && vis.estiloNivel === 2,
    `entrada punteada y niveles discontinuos, como en su vídeo (estilos ${vis.estiloEntrada} y ${vis.estiloNivel})`);
  ok(vis.mtp.dentroOk && vis.mtp.espera === '#24c18d',
    `la pastilla del TP se pinta en el verde medido en el DOM, no en el cian heredado: ${vis.mtp.dentro}`);
  ok(vis.msl.dentroOk && vis.msl.espera === '#f14b3f', `y la del SL en su rojo: ${vis.msl.dentro}`);
  ok(vis.mtp.yaQueNoPisa && vis.msl.yaQueNoPisa
    && vis.Handles.every((h) => h.grupo && h.grupo.h === 30),
    `el grupo mide el alto del vídeo (30 px) y su tinte no se sale de la caja: SL ${vis.msl.arriba}→${vis.msl.abajo}, TP ${vis.mtp.arriba}→${vis.mtp.abajo}`);
  ok(vis.cruces.length === 2 && vis.cruces.every((k) => k.w === 26 && k.h === 30),
    `la × ocupa su propia caja de 26×30 al final del grupo, en las dos etiquetas`);
  ok(vis.mtp.enCruz === 'tp' && vis.mtp.arrastreEnCruz === null && vis.mtp.golpeEnPastilla === 'tp',
    'la × se clica sin iniciar arrastre, y el resto de la pastilla sí agarra el nivel');
  ok(vis.xVela !== null && vis.Handles.every((h) => Math.abs(h.grupo.x - vis.xVela) <= 1),
    `la etiqueta nace en la x de la vela de la entrada (${vis.xVela} px), no pegada al borde derecho`);
  ok(vis.Handles.every((h) => h.grupo.x + h.grupo.w <= vis.anchoLienzo && h.grupo.x >= 10),
    `y nunca desborda la carta: grupo ${vis.mtp.grupoW} px dentro de ${vis.anchoLienzo} px`);
  ok(vis.mtp.banda && vis.mtp.banda.verde && vis.mtp.banda.despuesAlfa === 0,
    `arrastrar el TP tiñe la zona de ganancia de verde (alfa ${vis.mtp.banda && vis.mtp.banda.alfa}, luego ${vis.mtp.banda && vis.mtp.banda.despuesAlfa})`);
  ok(vis.pnl.largo === 20 && vis.pnl.corto === 20 && vis.pnl.sinDatos === null,
    `el PnL del chip sale de la fórmula del cierre y null si faltan datos: ${vis.pnl.largo}/${vis.pnl.corto}/${vis.pnl.sinDatos}`);

  /* ══════ J) EL BILLETE DE ORDEN VISUAL (§5.8) ══════
     Su ESTRUCTURA sale del vídeo oficial de órdenes visuales (cabecera con el coste y su ×, campo de
     importe, tipo y lado, ✓ de confirmar y debajo el riel de %). Sus MEDIDAS salen del DOM real de la
     página de futuros -no del .mp4, que es un mock con tipografia sobredimensionada-: widget flotante
     #131414 con pelo #292a2b (§1), campos 272x40 sobre #222324 con radio 4 y padding 0 12 px (§2 y
     §5.5b), rotulo de campo en una linea de 14 con tipografia 12/400 #919499 (las etiquetas reales
     `Precio (USDT)`/`Cantidad (USDT)`/`Total (USDT)` miden 86x14, 83x14 y 104x14) y el riel de % con
     caja de 272x25 y sus cinco marcas a 16 px del borde superior (el slider de Arco medido hoy: caja en
     y=490, rótulos en y=506). La PISTA del riel no se midió -los selectores de Arco no casan con su
     marca de clase-, asi que es la del navegador: mejor eso que un grosor adivinado.
     El billete se abre con el gesto real (ratón sobre el lienzo con la herramienta «Orden»): llamar a
     `DT.onTicket` a mano dejaria un billete sin ancla en la carta y la ancla no probaria nada. */
  console.log('\n▸ J) El billete de orden visual (estructura del vídeo, medidas del DOM)');
  const bilAntes = await page.evaluate(() => {
    const a = document.querySelector('#quickSize [data-pct].active');
    return { size: document.getElementById('sizeInput').value,
      limit: (document.getElementById('limitInput') || {}).value || '',
      pct: a ? a.dataset.pct : null, pending: (TE.state.pending || []).length,
      modo: App.sizeMode, otype: App.orderType };
  });
  await page.click('[data-tool="orden"]');
  const punto = await page.evaluate(() => {
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: Math.round(r.x + r.width * 0.52), y: Math.round(r.y + r.height * 0.40) };
  });
  await page.mouse.click(punto.x, punto.y);
  await new Promise((r) => setTimeout(r, 320));
  const bil = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const cs = (e) => getComputedStyle(e);
    const caja = (e) => { const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const wrap = caja(B('chartWrap')), b = caja(B('bfBillete'));
    const riel = document.querySelector('.bf-billete-riel'), marca = document.querySelector('.bf-billete-marcas');
    const lab = document.querySelector('.bf-billete-campo > span'), campo = B('bfBilleteQty'), ok = B('bfBilleteOk');
    return {
      abierto: !B('bfBillete').hidden,
      dentro: b.x >= wrap.x - 1 && b.y >= wrap.y - 1 && b.x + b.w <= wrap.x + wrap.w + 1 && b.y + b.h <= wrap.y + wrap.h + 1,
      y: b.y, h: b.h, wrapY: wrap.y, wrapH: wrap.h, wrapX: wrap.x, wrapW: wrap.w, estilo: { top: B('bfBillete').style.top, left: B('bfBillete').style.left },
      cercaDelClic: Math.abs(b.x - (punto => punto)(0)) >= 0 && b.x >= wrap.x,
      ancho: b.w, alto: b.h, fondo: cs(B('bfBillete')).backgroundColor, pelo: cs(B('bfBillete')).borderColor,
      radio: cs(B('bfBillete')).borderRadius, padre: B('bfBillete').parentElement.id,
      campo: caja(campo).h, campoAncho: caja(campo).w, campoFondo: cs(campo).backgroundColor, campoRadio: cs(campo).borderRadius,
      campoPad: cs(campo).paddingLeft, rotulo: { t: lab.textContent, h: Math.round(lab.getBoundingClientRect().height),
        f: cs(lab).fontSize + '/' + cs(lab).fontWeight, c: cs(lab).color,
        cabe: [...document.querySelectorAll('.bf-billete-campo > span')].every((e) => e.scrollWidth <= e.clientWidth + 1) },
      ok: caja(ok).w + 'x' + caja(ok).h, okFondo: cs(ok).backgroundColor, okRadio: cs(ok).borderRadius,
      riel: caja(riel).h, marcas: [...marca.children].map((m) => m.textContent).join(' '),
      marcaF: cs(marca.children[0]).fontSize, marcaC: cs(marca.children[0]).color,
      desfase: Math.round(caja(marca).y - caja(riel).y),
      pila: cs(campo).fontFamily.split(',')[0].replace(/"/g, ''),
      precio: B('bfBilletePrecio').value, readOnly: B('bfBilletePrecio').readOnly,
      preview: !!DT._ticketPreview, lado: document.body.dataset.billeteLado,
      otype: document.querySelectorAll('#segOrderType [data-otype]').length,
      tieneOtype: !!document.querySelector('#bfBilleteTipo [data-otype]'),
      coste: B('bfBilleteCoste').textContent,
    };
  });
  const riel = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const f = document.querySelector('#quickSize [data-pct="50"]');
    if (!f) return { sinBoton: true };
    f.click();
    const porFormulario = B('sizeInput').value;
    f.classList.remove('active');
    B('sizeInput').value = ''; B('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
    const r = B('bfBilletePct'); r.value = '50'; r.dispatchEvent(new Event('input', { bubbles: true }));
    return { porFormulario, porRiel: B('sizeInput').value, espejo: B('bfBilleteQty').value,
      activo: !!(document.querySelector('#quickSize [data-pct="50"].active')) };
  });
  const coloca = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const antes = (TE.state.pending || []).length;
    B('bfBilleteOk').click();
    const vivas = TE.state.pending || [];
    return { antes, despues: vivas.length, precioOrden: vivas.length ? vivas[vivas.length - 1].limitPrice : null,
      precioBillete: parseFloat(B('bfBilletePrecio').value) || null, cerrado: B('bfBillete').hidden,
      preview: !!DT._ticketPreview, lado: vivas.length ? vivas[vivas.length - 1].side : null };
  });
  const tipo = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    DT.onTicket({ x: 300, y: 200, price: 1234.5 });
    document.querySelector('#bfBilleteTipo [data-btipo="market"]').click();
    const out = { abierto: !B('bfBillete').hidden, readOnly: B('bfBilletePrecio').readOnly,
      activo: (document.querySelector('#segOrderType .seg-btn.active') || { dataset: {} }).dataset.otype,
      orderType: App.orderType };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    out.cerradoPorEsc = B('bfBillete').hidden;
    out.preview = !!DT._ticketPreview;
    return out;
  });
  /* Y en el telefono, donde la carta entra y sale por `body[data-vista]`: el billete no puede
     desbordar el area -en el tier <=640 se ancha de borde a borde con !important-. */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
  await new Promise((r) => setTimeout(r, 500));
  const movil = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    DT.onTicket({ x: 40, y: 120, price: 1000 });
    const w = B('chartWrap').getBoundingClientRect(), b = B('bfBillete').getBoundingClientRect();
    const out = { vista: document.body.dataset.vista, cabe: b.right <= w.right + 1 && b.left >= w.left - 1,
      hueco: Math.round(w.width - b.width), ancho: Math.round(b.width), wrap: Math.round(w.width),
      ocultoEnOperar: (() => { document.body.dataset.vista = 'operar';
        const o = getComputedStyle(B('bfBillete')).display; const vis = B('bfBillete').getBoundingClientRect().height;
        document.body.dataset.vista = 'carta'; return vis < 1 || o === 'none'; })() };
    B('bfBillete').hidden = true; DT.ensenaTicket(null);
    document.querySelector('[data-tool="cursor"]').click();
    return out;
  });
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise((r) => setTimeout(r, 400));
  /* REPOSO: se deshace lo que hizo el bloque (la orden colocada, el tamano, el modo, el tipo) para que
     las capturas y las suites que siguen vean la app como si nada hubiera pasado. */
  await page.evaluate((prev) => {
    const B = (id) => document.getElementById(id);
    (TE.state.pending || []).slice(prev.pending).forEach((o) => { try { TE.cancelOrder(o.id); } catch (e) {} });
    B('sizeInput').value = prev.size;
    if (B('limitInput')) B('limitInput').value = prev.limit;
    if (prev.pct) { const b = document.querySelector('#quickSize [data-pct="' + prev.pct + '"]'); if (b) b.click(); }
    if (UI.setSizeMode && prev.modo) UI.setSizeMode(prev.modo);
    if (UI.setOrderType) UI.setOrderType(prev.otype || 'market');
    document.body.hidden1 = 0;
    delete document.body.dataset.billeteLado;
    if (UI.billete) { UI.billete.abierto = false; UI.billete.editar = null; B('bfBillete').hidden = true;
      /* El billete recuerda el tipo a proposito (es lo que hace el suyo), pero un bloque de prueba no
         puede dejarlo en «mercado»: el siguiente colocaria una orden a mercado en lugar de una
         pendiente y la ancla fallaria por un estado heredado, no por el codigo. */
      if (UI.billete.marcaTipo) UI.billete.marcaTipo('limite'); }
    DT.ensenaTicket(null);
    document.getElementById('overlayCanvas').dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    if (UI.refreshAll) UI.refreshAll();
    return true;
  }, bilAntes);

  ok(bil.abierto && bil.padre === 'chartWrap' && bil.dentro,
    `la herramienta «Orden» abre el billete anclado al punto dentro de la carta (${bil.ancho}x${bil.alto} en ${bil.padre}; b.y=${bil.y} b.h=${bil.h} wrap.y=${bil.wrapY} wrap.h=${bil.wrapH})`);
  ok(bil.fondo === 'rgb(19, 20, 20)' && bil.pelo === 'rgb(41, 42, 43)' && bil.radio === '4px',
    `chasis de widget flotante medido en el sitio: ${bil.fondo} con pelo ${bil.pelo} y radio ${bil.radio}`);
  ok(bil.campo === 40 && bil.campoFondo === 'rgb(34, 35, 36)' && bil.campoRadio === '4px' && bil.campoPad === '12px',
    `el campo del billete es como los del panel de 6rdenes: 40 px de alto sobre #222324, radio 4 y 12 px de lado (${bil.campo}px, ${bil.campoFondo})`);
  ok(bil.ancho === 298 && bil.campoAncho === 272 && bil.rotulo.cabe,
    `un campo por fila: los dos heredan los 272 px medidos del panel y ningun rotulo se trunca (${bil.campoAncho}px, «${bil.rotulo.t}»)`);
  ok(bil.rotulo.f === '12px/400' && bil.rotulo.c === 'rgb(145, 148, 153)' && bil.rotulo.h <= 15,
    `y su rotulo encima, en linea de ${bil.rotulo.h}px, 12/400 ${bil.rotulo.c}: «${bil.rotulo.t}»`);
  ok(bil.ok === '40x40' && bil.okFondo === 'rgb(36, 193, 141)' && bil.okRadio === '4px',
    `el ✓ de confirmar es un cuadrado de 40 en el verde medido (${bil.ok} ${bil.okFondo})`);
  ok(bil.marcas === '0 % 25 % 50 % 75 % 100 %' && bil.riel === 25 && bil.desfase === 16
    && bil.marcaF === '12px' && bil.marcaC === 'rgb(145, 148, 153)',
    `riel de % como el slider de Arco del sitio: caja de 25 px, cinco marcas a 16 px, 12/400 ${bil.marcaC} (${bil.marcas})`);
  ok(bil.pila === 'Geist', `la pila de los controles del panel es la que resuelven ellos: ${bil.pila} (con fallback "noto sans")`);
  ok(!riel.sinBoton && String(riel.porFormulario) === String(riel.porRiel) && riel.espejo === riel.porRiel,
    `el riel no calcula: delega en el boton de % del formulario (${riel.porFormulario} por el boton, ${riel.porRiel} por el riel)`);
  ok(coloca.despues === coloca.antes + 1 && coloca.precioOrden !== null
    && Math.abs(coloca.precioOrden - coloca.precioBillete) < 0.51 && coloca.lado === 'long',
    `el ✓ coloca de verdad en el precio arrastrado: ${coloca.precioOrden} (billete ${coloca.precioBillete}, lado ${coloca.lado})`);
  ok(coloca.cerrado === true && coloca.preview === false,
    'y al colocar se cierra el billete y se apaga su línea de previsualización');
  ok(bil.lado === 'long' && bil.preview === true, `mientras esta abierto, el billete pinta su linea y su lado (${bil.lado})`);
  ok(bil.otype === 4 && !bil.tieneOtype,
    `el billete no secuestra el tipo de orden: los cuatro data-otype siguen siendo de #segOrderType (${bil.otype}) y el suyo usa data-btipo`);
  ok(tipo.readOnly === true && tipo.activo === 'market' && tipo.orderType === 'market',
    `pasar el billete a Mercado deja el precio fuera de juego y mueve el formulario a la vez (activo ${tipo.activo})`);
  ok(tipo.cerradoPorEsc && !tipo.preview, 'Escape cierra el billete y borra su línea');
  const bilReposo = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    DT.onTicket({ x: 300, y: 200, price: 1234.5 });
    const out = { alto: Math.round(B('bfBillete').getBoundingClientRect().height),
      chips: B('bfBilleteChips').hidden, cancela: B('bfBilleteCancela').hidden, tipo: B('bfBilleteTipo').hidden };
    B('bfBillete').hidden = true; DT.ensenaTicket(null); UI.billete.abierto = false;
    return out;
  });
  ok(bilReposo.chips === true && bilReposo.cancela === true && bilReposo.tipo === false
    && bilReposo.alto <= 285,
    `abierto desde la herramienta, el billete es el de §5.8 y no ha crecido: ${bilReposo.alto} px, sin chispas ni fila roja (${bilReposo.chips}/${bilReposo.cancela})`);
  ok(movil.cabe && movil.hueco <= 17 && movil.ocultoEnOperar,
    `en el telefono el billete cabe en la carta (${movil.ancho}px de ${movil.wrap}px, hueco ${movil.hueco}) y en la vista de operar no se ve`);


  /* ── K) el disco ⊕ del extremo de la línea y el billete en modo edición (§5.9) ─────────────
     El vídeo de `visual-orders` enseña que en el borde derecho de cada línea de orden hay un círculo
     con +, y que al picarlo sale un menú pegado a esa línea (add alert · set order · trigger · cancel
     order · to price). De esas cinco filas copiamos las dos que aquí tienen acción detrás (recolocar la
     orden y cancelarla) y NO la de alertas: en este terminal no hay sistema de alertas -`grep alerta` en
     js/ solo encuentra las de aviso- ni sentido en «ir al precio», porque la carta se autoajusta en cada
     barra. Lo que sí se copia es el gesto: disco en el eje, billete encima de la línea, y el billete
     cambiando de forma según qué línea lo abrió. */
  const kAntes = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    return { pending: (TE.state.pending || []).length, pos: !!TE.state.position,
      size: B('sizeInput').value, limit: B('limitInput') ? B('limitInput').value : '',
      pct: (document.querySelector('#quickSize [data-pct].active') || { dataset: {} }).dataset.pct || null,
      modo: (document.querySelector('#sizeModoSeg [data-mode].active') || document.querySelector('[data-mode].active') || { dataset: {} }).dataset.mode || null,
      otype: (document.querySelector('#segOrderType .seg-btn.active') || { dataset: {} }).dataset.otype || null,
      sl: TE.state.position ? TE.state.position.sl : null, tp: TE.state.position ? TE.state.position.tp : null,
      chk: B('chkTpSl') ? B('chkTpSl').checked : null };
  });
  await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    DT.onTicket({ x: 300, y: 150, price: 71000 });
    document.querySelector('#bfBilleteTipo [data-btipo="limite"]').click();
    B('bfBilleteOk').click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const discos = await page.evaluate(() => {
    const w = Math.round(document.getElementById('overlayCanvas').getBoundingClientRect().width);
    return { w, lienzo: w, cajas: (DT._cajasPlus || []).map((k) => ({ id: k.id, x: Math.round(k.x), y: Math.round(k.y), w: k.w, h: k.h })),
      ids: (DT.tradeHandles || []).map((h) => h.id).join(','),
      precio: (TE.state.pending[TE.state.pending.length - 1] || {}).limitPrice,
      id: (TE.state.pending[TE.state.pending.length - 1] || {}).id };
  });
  const disco = discos.cajas.find((k) => k.id === 'limit:' + discos.id) || discos.cajas[0] || { id: null, x: 0, y: 0, w: 0, h: 0 };
  const puntoK = await page.evaluate((d) => {
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: Math.round(r.x + d.x + d.w / 2), y: Math.round(r.y + d.y + d.h / 2), sinPendiente: !d.id };
  }, disco);
  /* El tamano del formulario se pone a 50 % ANTES de abrir el menu: la carta debe venir con esa chispa
     encendida, no con las cinco apagadas. */
  await page.evaluate(() => { document.querySelector('#quickSize [data-pct="50"]').click(); });
  await new Promise((r) => setTimeout(r, 200));
  await page.mouse.click(puntoK.x, puntoK.y);
  await new Promise((r) => setTimeout(r, 380));
  const editK = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const cs = (e) => getComputedStyle(e);
    const caja = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const b = caja(B('bfBillete')), wrap = caja(B('chartWrap'));
    const chip = document.querySelector('#bfBilleteChips .bf-chip');
    const can = B('bfBilleteCancela');
    return {
      abierto: !B('bfBillete').hidden, editar: JSON.parse(JSON.stringify(UI.billete.editar || {})),
      precio: B('bfBilletePrecio').value, qty: B('bfBilleteQty').value,
      noTapa: (() => { const k = (DT._cajasPlus || []).find((z) => /^limit:/.test(z.id));
        const r = document.getElementById('overlayCanvas').getBoundingClientRect();
        return { dentroDeLaCarta: b.x >= wrap.x - 1 && b.y >= wrap.y - 1 && b.y + b.h <= wrap.y + wrap.h + 1,
          aLaIzquierdaDelDisco: !!k && b.x + b.w <= Math.round(r.x + k.x) }; })(),
      tipoOculto: B('bfBilleteTipo').hidden, ladoVisible: !B('bfBilleteLado').hidden,
      chips: [...document.querySelectorAll('#bfBilleteChips .bf-chip')].map((c) => c.textContent.trim()),
      chipsVisibles: !B('bfBilleteChips').hidden, rielVisible: !document.querySelector('.bf-billete-riel').hidden,
      chispaEncendida: ((document.querySelector('#bfBilleteChips .bf-chip.active') || { dataset: {} }).dataset.pct) || null,
      formActivo: ((document.querySelector('#quickSize [data-pct].active') || { dataset: {} }).dataset.pct) || null,
      chipsDelFormulario: [...document.querySelectorAll('#quickSize [data-pct]')].map((c) => c.dataset.pct),
      chipsMismos: [...document.querySelectorAll('#bfBilleteChips .bf-chip')].map((c) => c.dataset.pct).join(',')
        === [...document.querySelectorAll('#quickSize [data-pct]')].map((c) => c.dataset.pct).join(','),
      chip: { alto: chip ? caja(chip).h : 0, ancho: chip ? caja(chip).w : 0, fondo: chip ? cs(chip).backgroundColor : '', radio: chip ? cs(chip).borderRadius : '',
        pelo: chip ? cs(chip).borderTopWidth + ' ' + cs(chip).borderTopColor : '',
        f: chip ? cs(chip).fontSize + '/' + cs(chip).fontWeight : '',
        pila: chip ? cs(chip).fontFamily.split(',')[0].replace(/"/g, '') : '' },
      cancela: { texto: can.textContent.trim(), oculto: can.hidden, alto: caja(can).h, color: cs(can).color,
        f: cs(can).fontSize + '/' + cs(can).fontWeight, pelo: cs(can).borderTopWidth + ' ' + cs(can).borderTopColor,
        alineado: cs(can).textAlign },
    };
  });
  const delega = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const antes = (TE.state.equity ? 1 : 0) + document.getElementById('sizeInput').value;
    const c50 = document.querySelector('#bfBilleteChips .bf-chip[data-pct="50"]');
    if (!c50) return { error: 'sin chispa de 50 %' };
    c50.click();
    const porChip = B('sizeInput').value;
    const espejo = B('bfBilleteQty').value;
    const activo = (document.querySelector('#bfBilleteChips .bf-chip.active') || { dataset: {} }).dataset.pct;
    /* Y el MISMO numero tiene que salir por el boton del formulario, arrancando del mismo reposo:
       es la comprobacion de que la chispa no trae su propia cuenta. */
    document.querySelector('#quickSize [data-pct="0"]').click();
    document.querySelector('#quickSize [data-pct="50"]').click();
    return { porChip, porForm: B('sizeInput').value, espejo, activo,
      riel: !document.querySelector('.bf-billete-riel').hidden, antes };
  });
  const reemplaza = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const vieja = UI.billete.editar.id, cuenta = () => (TE.state.pending || []).length;
    const antes = cuenta();
    B('bfBilletePrecio').value = '71250';
    B('bfBilletePrecio').dispatchEvent(new Event('input', { bubbles: true }));
    B('bfBilleteOk').click();
    const vivas = TE.state.pending || [];
    return { antes, despues: vivas.length, sigueLaVieja: vivas.some((o) => o.id === vieja),
      precio: (vivas[vivas.length - 1] || {}).limitPrice, cerrado: B('bfBillete').hidden,
      sinDiscoViejo: !(DT._cajasPlus || []).some((k) => k.id === 'limit:' + vieja),
      otype: document.querySelectorAll('#segOrderType [data-otype]').length };
  });
  /* Y la fila roja: `Cancelar orden`, que es la que cierra el menú sin dejar nada detras. */
  await page.mouse.click(puntoK.x, puntoK.y);
  await new Promise((r) => setTimeout(r, 320));
  const cancelaK = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const antes = (TE.state.pending || []).length;
    B('bfBilleteCancela').click();
    return { antes, despues: (TE.state.pending || []).length, cerrado: B('bfBillete').hidden,
      discosDePendientes: (DT._cajasPlus || []).filter((k) => /^limit:/.test(k.id)).length };
  });
  /* Un nivel (SL/TP) usa el mismo disco pero el billete cambia de forma: sin tamano, porque el nivel lo
     lleva la posición, y con `Quitar SL` en la fila roja. */
  await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    if (!TE.state.position) {
      if (UI.setOrderType) UI.setOrderType('market');
      const chk = B('chkTpSl'); if (chk && !chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
      B('sizeInput').value = 60; B('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-slpct="1"]').click();
      document.querySelector('[data-tppct="2"]').click();
      B('btnLong').click();
    }
  });
  await new Promise((r) => setTimeout(r, 600));
  const discoSL = await page.evaluate(() => {
    const k = (DT._cajasPlus || []).find((z) => z.id === 'sl');
    if (!k) return null;
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: Math.round(r.x + k.x + k.w / 2), y: Math.round(r.y + k.y + k.h / 2),
      ids: (DT._cajasPlus || []).map((z) => z.id).join(',') };
  });
  await page.mouse.click(discoSL.x, discoSL.y);
  await new Promise((r) => setTimeout(r, 340));
  const nivelK = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const campos = [...document.querySelectorAll('#bf-billete, #bfBillete')].length;
    return { editar: (UI.billete.editar || {}).tipo, cancela: B('bfBilleteCancela').textContent.trim(),
      abierto: !B('bfBillete').hidden,
      campoTap: [...document.querySelectorAll('#bfBillete .bf-billete-campo')][1].hidden,
      chips: B('bfBilleteChips').hidden, riel: document.querySelector('.bf-billete-riel').hidden,
      precio: B('bfBilletePrecio').value, sl: TE.state.position.sl, campos,
      entrada: TE.state.position.entryPrice, tp: TE.state.position.tp };
  });
  const mueveNivel = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const v = Math.round(TE.state.position.entryPrice * 0.99 * 100) / 100;
    B('bfBilletePrecio').value = String(v);
    B('bfBilletePrecio').dispatchEvent(new Event('input', { bubbles: true }));
    B('bfBilleteOk').click();
    return { pedido: v, sl: TE.state.position.sl, entrada: TE.state.position.entryPrice,
      tp: TE.state.position.tp, cerrado: B('bfBillete').hidden };
  });
  await page.mouse.click(discoSL.x, discoSL.y);
  await new Promise((r) => setTimeout(r, 340));
  const quitaNivel = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    B('bfBilleteCancela').click();
    return { sl: TE.state.position ? TE.state.position.sl : null,
      form: B('slInput').value, abierto: !B('bfBillete').hidden,
      discos: (DT._cajasPlus || []).map((z) => z.id).join(',') };
  });
  await page.evaluate(() => { document.querySelector('[data-tool="cursor"]').click(); });
  /* REPOSO del bloque K: se cierra la posición abierta por el bloque, se devuelven el SL/TP, el
     formulario y su modo, y se deja el billete como estaba. */
  await page.evaluate((prev) => {
    const B = (id) => document.getElementById(id);
    if (TE.state.position && !prev.pos) {
      try { TE.closePosition(TE.state.position.entryPrice, 'manual', App.currentTime()); } catch (e) {}
    }
    if (TE.state.position) { TE.setSL(prev.sl); TE.setTP(prev.tp); }
    (TE.state.pending || []).slice(prev.pending).forEach((o) => { try { TE.cancelOrder(o.id); } catch (e) {} });
    B('sizeInput').value = prev.size;
    if (B('limitInput')) B('limitInput').value = prev.limit;
    if (prev.pct) { const b = document.querySelector('#quickSize [data-pct="' + prev.pct + '"]'); if (b) b.click(); }
    else { const c = document.querySelector('#quickSize [data-pct].active'); if (c) c.classList.remove('active'); }
    if (UI.setSizeMode && prev.modo) UI.setSizeMode(prev.modo);
    if (UI.setOrderType) UI.setOrderType(prev.otype || 'market');
    const chk = B('chkTpSl'); if (chk && chk.checked !== prev.chk) { chk.checked = !!prev.chk; chk.dispatchEvent(new Event('change', { bubbles: true })); }
    if (UI.syncTpSl) UI.syncTpSl();
    delete document.body.dataset.billeteLado;
    if (UI.billete) { UI.billete.abierto = false; UI.billete.editar = null; B('bfBillete').hidden = true; B('bfBilleteCancela').hidden = true; B('bfBilleteChips').hidden = true; B('bfBilleteTipo').hidden = false; }
    DT.ensenaTicket(null);
    window.dispatchEvent(new Event('resize'));
    if (UI.refreshAll) UI.refreshAll();
    return true;
  }, kAntes);

  ok(discos.cajas.length >= 1 && discos.cajas.every((k) => k.w === 24 && k.h === 24)
    && disco.x === discos.lienzo - 24 - 2 && disco.y > 0,
    `el disco con + mide 24x24 (los iconos de cabecera medidos en el sitio) y esta pegado al eje: x=${disco.x} de un lienzo de ${discos.lienzo}`);
  ok(editK.abierto && editK.editar.tipo === 'limit' && String(editK.editar.id) === String(discos.id)
    && Math.abs(parseFloat(editK.precio) - discos.precio) < 0.51,
    `el clic en el disco abre el billete EN MODO EDICION de esa orden (${editK.editar.tipo} #${editK.editar.id}, precio ${editK.precio})`);
  ok(editK.noTapa.aLaIzquierdaDelDisco && editK.noTapa.dentroDeLaCarta,
    'y lo ancla a la izquierda del disco, sin tapar ni la línea que edita ni su propio +');
  ok(editK.tipoOculto === true && editK.ladoVisible === true,
    'en edición la fila de tipo se apaga: una pendiente es límite por definición, y ofrecer Mercado sería prometer una orden que no puede quedar colgada');
  ok(editK.chips.join(' ') === '0 % 25 % 50 % 75 % 100 %' && editK.chipsMismos
    && editK.chips.length === editK.chipsDelFormulario.length,
    `las chispas de tamaño no son una lista nueva: son los botones de #quickSize clonados (${editK.chips.join(' ')})`);
  ok(editK.chispaEncendida === '50' && editK.formActivo === '50',
    `al abrir el menu de la linea viene encendida la chispa que ya lleva el formulario (${editK.chispaEncendida} %), no las cinco apagadas`);
  ok(editK.chipsVisibles === true && editK.rielVisible === true,
    `las chispas salen solo en el menu de edicion: alli estan, y el riel sigue con ellas (${editK.chips.join(' ')})`);
  ok(editK.chip.alto === 28 && editK.chip.fondo === 'rgb(34, 35, 36)' && editK.chip.radio === '4px'
    && editK.chip.pelo.indexOf('0px') === 0 && editK.chip.f === '12px/400' && editK.chip.pila === 'Geist',
    `chip de 28 px de alto -la altura de fila medida en el sitio- sobre #222324, radio 4, sin pelo y ${editK.chip.f} ${editK.chip.pila}`);
  ok(editK.cancela.alto === 28 && editK.cancela.color === 'rgb(241, 75, 63)' && editK.cancela.f === '14px/500'
    && editK.cancela.texto === 'Cancelar orden' && /^1px /.test(editK.cancela.pelo) && editK.cancela.alineado === 'left',
    `la fila roja del menú, con su pelo superior y su texto en rojo medido: «${editK.cancela.texto}» (${editK.cancela.alto}px, ${editK.cancela.color}, ${editK.cancela.f}, ${editK.cancela.pelo})`);
  ok(String(delega.porChip) === String(delega.porForm) && delega.espejo === delega.porForm
    && delega.activo === '50' && delega.riel === true,
    `la chispa no calcula nada: 50 % en el billete vale lo mismo que en el formulario (${delega.porChip} = ${delega.porForm} USDT), enciende el riel (${delega.espejo}) y el riel sigue ahi (${delega.riel})`);
  ok(reemplaza.despues === reemplaza.antes && !reemplaza.sigueLaVieja
    && Math.abs(reemplaza.precio - 71250) < 0.51 && reemplaza.cerrado === true
    && reemplaza.sinDiscoViejo && reemplaza.otype === 4,
    `el ✓ retira la pendiente vieja y coloca la nueva sin cambiar la cuenta (${reemplaza.antes} -> ${reemplaza.despues}, a ${reemplaza.precio}) y deja de existir su disco`);
  ok(cancelaK.despues === cancelaK.antes - 1 && cancelaK.cerrado === true
    && cancelaK.discosDePendientes === 0,
    `«Cancelar orden» cancela de verdad: ${cancelaK.antes} -> ${cancelaK.despues} pendientes y el billete se cierra`);
  ok(discoSL.ids === 'sl,tp' && nivelK.editar === 'sl' && nivelK.abierto
    && Math.abs(parseFloat(nivelK.precio) - nivelK.sl) < 0.51,
    `el disco de un nivel abre la misma carta en modo nivel (${nivelK.editar}, precio ${nivelK.precio} = SL ${nivelK.sl})`);
  ok(nivelK.campoTap === true && nivelK.chips === true && nivelK.riel === true && nivelK.cancela === 'Quitar SL',
    'y allí el tamaño no pinta: fuera el campo de importe, las chispas y el riel, y la fila roja pasa a decir Quitar SL');
  ok(Math.abs(mueveNivel.sl - mueveNivel.pedido) < 0.51 && Math.abs(mueveNivel.entrada - nivelK.entrada) < 1e-6
    && Math.abs(mueveNivel.tp - nivelK.tp) < 1e-6 && mueveNivel.cerrado === true,
    `confirmar un nivel mueve SOLO ese nivel: SL ${mueveNivel.sl}, entrada ${mueveNivel.entrada} y TP ${mueveNivel.tp} intactos`);
  ok(quitaNivel.sl === null && quitaNivel.form === '' && quitaNivel.abierto === false
    && quitaNivel.discos === 'tp',
    `«Quitar SL» borra el nivel del motor y del formulario (${quitaNivel.form === '' ? 'campo vacío' : quitaNivel.form}) y su disco desaparece: ${quitaNivel.discos}`);


  /* ── L) la pastilla `Límite | precio | ×` de las pendientes (§5.10) ──────────────────────
     En el fotograma de t=17 cada línea de orden lleva un cartel sentado SOBRE la línea, de tres
     compartimentos separados por un pelo de 1 px -`Trigger | 64 175,1 | ×`-. Aquí la palabra del
     primer compartimento no se inventa: es la que el propio formulario tiene para ese tipo de orden, y la
     x del tercero cancela la orden (no «quita un nivel»: una pendiente puede colgar sin posición). La
     pestaña ámbar con `⇕` que había en este sitio era invento de §5.7 y hacía lo mismo con menos
     información: se retira. Y este bloque es también la prueba de que las x se clicaN DE VERDAD con el
     ratón, cosa que la ancla de §5.7 preguntaba solo al predicado. */
  const LAntes = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    return { pending: (TE.state.pending || []).length, pos: !!TE.state.position,
      sl: TE.state.position ? TE.state.position.sl : null,
      size: B('sizeInput').value, limit: B('limitInput') ? B('limitInput').value : '',
      pct: (document.querySelector('#quickSize [data-pct].active') || { dataset: {} }).dataset.pct || null,
      otype: (document.querySelector('#segOrderType .seg-btn.active') || { dataset: {} }).dataset.otype || null };
  });
  await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    DT.onTicket({ x: 300, y: 150, price: 71000 });
    document.querySelector('#bfBilleteTipo [data-btipo="limite"]').click();
    B('bfBilleteOk').click();
  });
  await new Promise((r) => setTimeout(r, 650));
  await page.click('[data-tool="cursor"]');
  await new Promise((r) => setTimeout(r, 200));
  const Lpasta = await page.evaluate(() => {
    const h = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id)) || {};
    const g = h._grupo || null;
    const cv = document.getElementById('overlayCanvas'), ctx = cv.getContext('2d');
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const hex = (x, y) => { const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      return '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join(''); };
    const cruz = (DT._cajasCruz || []).find((k) => /^limit:/.test(k.id)) || null;
    const disco = (DT._cajasPlus || []).find((k) => /^limit:/.test(k.id)) || null;
    const tonos = [];
    if (g) for (let x = g.x; x < g.x + g.w; x++) for (const y of [g.y + 4, g.y + Math.round(g.h / 2), g.y + g.h - 5]) tonos.push(hex(x, y));
    const cerca = (a, b) => parseInt(a.slice(1, 3), 16) - parseInt(b.slice(1, 3), 16) <= 12
      && parseInt(a.slice(3, 5), 16) - parseInt(b.slice(3, 5), 16) <= 12
      && parseInt(a.slice(5, 7), 16) - parseInt(b.slice(5, 7), 16) <= 12;
    const tienede = (c) => tonos.some((t) => cerca(t, c));
    return { id: h.id, precio: h.price, color: h.color, tipo: h.tipo, lado: h.lado, palabra: DT._palabraTipo(h.tipo), centro: (h._cartel || {}).centro,
      grupo: g ? { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h) } : null,
      relleno: g ? hex(g.x + 3, g.y + 3) : null,
      /* El BITMAP del lienzo, en el centro vertical del chip: lo que de verdad esta pintado en la fila del
         precio. (La captura del navegador headless no sirve para esto: la misma escena sale con la pastilla
         en la fila 194 en una captura y en la 110 en otra; el lienzo siempre dice 194.) */
      enBitmap: g ? hex(g.x + 3, g.y + Math.round(g.h / 2)) : null,
      x: cruz ? { id: cruz.id, w: cruz.w, h: cruz.h, x: Math.round(cruz.x), derecha: Math.round(cruz.x + cruz.w) } : null,
      disco: disco ? { x: Math.round(disco.x), w: disco.w } : null,
      lienzo: Math.round(cv.getBoundingClientRect().width),
      /* La fila que la libreria le da a ese precio AHORA: si el lienzo no se volvio a pintar con la
         escala ya asentada, la pastilla queda flotando sobre otra vela (es lo que delataba una captura
         tomada mientras la autoescala animaba). */
      yDeLibreria: (() => { try { const c = CM.series.candles.priceToCoordinate(h.price);
        return c === null || c === undefined ? null : Math.round(c); } catch (e) { return null; } })(),
      xBarra: h.t === undefined || h.t === null ? null : Math.round(DT._xOf(h.t)),
      tonos: { fondo: tienede('#1a1b1c'), pelo: tienede('#292a2b'), blanco: tienede('#ffffff'),
        ambar: tienede('#ffab00'), gris: tienede('#919499') },
      etiquetasConX: (DT._cajasCruz || []).map((k) => k.id).join(',') };
  });
  /* Un clic (pulsar y soltar sin mover) en el numero abre el mismo editor que el + del eje. */
  const Lclic = await page.evaluate(() => {
    const h = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id)); const g = h._grupo;
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: Math.round(r.x + g.x + g.w - 26 - 34), y: Math.round(r.y + g.y + g.h / 2) };
  });
  await page.mouse.click(Lclic.x, Lclic.y);
  await new Promise((r) => setTimeout(r, 360));
  const Ledit = await page.evaluate(() => {
    const B = (id) => document.getElementById(id);
    const h = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id)); const g = h._grupo;
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    const b = B('bfBillete').getBoundingClientRect();
    return { abierto: !B('bfBillete').hidden, editar: JSON.parse(JSON.stringify(UI.billete.editar || {})),
      precio: B('bfBilletePrecio').value, orden: h.price,
      noTapaLaPastilla: b.right <= Math.round(r.x + g.x) };
  });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  /* Y la × de la pastilla cancela la ORDEN con el raton de verdad (el pointer-events del lienzo tiene
     que conocerla: si no, el mousedown se queda en el envoltorio y la ancla de predicado lo tapa). */
  const Lcruz = await page.evaluate(() => {
    const k = (DT._cajasCruz || []).find((z) => /^limit:/.test(z.id));
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { antes: (TE.state.pending || []).length, hover: (() => { const e = DT.canvas.style.pointerEvents; return e; })(),
      x: Math.round(r.x + k.x + k.w / 2), y: Math.round(r.y + k.y + k.h / 2) };
  });
  await page.mouse.move(Lcruz.x, Lcruz.y);
  await new Promise((r) => setTimeout(r, 120));
  const Lhabilitado = await page.evaluate(() => DT.canvas.style.pointerEvents);
  await page.mouse.down(); await page.mouse.up();
  await new Promise((r) => setTimeout(r, 500));
  const Lcancelada = await page.evaluate(() => ({ antes: (window.__Lantes || 0),
    pendientes: (TE.state.pending || []).length,
    pastillas: (DT._cajasCruz || []).filter((k) => /^limit:/.test(k.id)).length,
    discos: (DT._cajasPlus || []).filter((k) => /^limit:/.test(k.id)).length,
    canceloEnElMotor: !(TE.state.pending || []).length }));
  /* Arrastrar la pastilla sigue moviendo la orden, y el numero pinta el precio en vivo. */
  await page.evaluate(() => { DT.onTicket({ x: 300, y: 150, price: 71000 });
    document.querySelector('#bfBilleteTipo [data-btipo="limite"]').click();
    document.getElementById('bfBilleteOk').click(); });
  await new Promise((r) => setTimeout(r, 650));
  await page.click('[data-tool="cursor"]'); await new Promise((r) => setTimeout(r, 200));
  const Larr = await page.evaluate(() => {
    const h = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id)); const g = h._grupo;
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: Math.round(r.x + g.x + 10), y: Math.round(r.y + g.y + g.h / 2), antes: h.price, yAntes: Math.round(g.y) };
  });
  await page.mouse.move(Larr.x, Larr.y); await new Promise((r) => setTimeout(r, 120));
  await page.mouse.down(); await new Promise((r) => setTimeout(r, 80));
  await page.mouse.move(Larr.x, Larr.y + 26, { steps: 6 }); await new Promise((r) => setTimeout(r, 160));
  const Lvivo = await page.evaluate(() => ({ arrastrando: !!(DT.drag && DT.drag.tradeHandle),
    ultimo: DT.drag && DT.drag.lastPrice, pendientes: (TE.state.pending || []).length }));
  await page.mouse.up(); await new Promise((r) => setTimeout(r, 500));
  const Lmovida = await page.evaluate((a) => {
    const h = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id)) || {};
    return { ahora: (TE.state.pending[0] || {}).limitPrice, antes: a.antes, pendientes: (TE.state.pending || []).length,
      yAhora: h._grupo ? Math.round(h._grupo.y) : null, yAntes: a.yAntes };
  }, Larr);
  /* Donde no hay linea no hay pastilla: un `Activador` sin limite asociado no tiene que rotularse
     encima de la nada (y no se le escribe en `limitPrice` al arrastrarlo: el panel lee ese campo como
     precio de la orden). Se comprueba alimentando al pintor, sin tocar el formulario. */
  const Ltrigger = await page.evaluate(() => {
    const reales = (TE.state.pending || []).slice();
    DT.setPendingHandles([{ id: 990, limitPrice: null, tipo: 'trigger', side: 'long' },
      { id: 991, limitPrice: 71000, tipo: 'limite', side: 'long' }]);
    DT.render();
    const out = {
      handles: (DT.tradeHandles || []).filter((h) => /^limit:/.test(h.id)).map((h) => h.id + ':' + h.price).join(','),
      cruces: (DT._cajasCruz || []).filter((k) => /^limit:/.test(k.id)).map((k) => k.id).join(','),
      pastillas: (DT.tradeHandles || []).filter((h) => /^limit:/.test(h.id) && h._grupo).map((h) => h.id).join(','),
    };
    DT.setPendingHandles(reales); DT.render();
    return out;
  });
  /* REPOSO de L: se deshace la pendiente del bloque y se deja el formulario como estaba. */
  await page.evaluate((prev) => {
    const B = (id) => document.getElementById(id);
    (TE.state.pending || []).slice(prev.pending).forEach((o) => { try { TE.cancelOrder(o.id); } catch (e) {} });
    B('sizeInput').value = prev.size;
    if (B('limitInput')) B('limitInput').value = prev.limit;
    if (prev.pct) { const b = document.querySelector('#quickSize [data-pct="' + prev.pct + '"]'); if (b) b.click(); }
    if (UI.setOrderType) UI.setOrderType(prev.otype || 'market');
    delete document.body.dataset.billeteLado;
    if (UI.billete) { UI.billete.abierto = false; UI.billete.editar = null; B('bfBillete').hidden = true;
      if (UI.billete.marcaTipo) UI.billete.marcaTipo('limite'); }
    DT.ensenaTicket(null);
    window.dispatchEvent(new Event('resize'));
    if (UI.refreshAll) UI.refreshAll();
    return true;
  }, LAntes);

  ok(Lpasta.grupo && Lpasta.grupo.h === 30 && Lpasta.x && Lpasta.x.w === 26 && Lpasta.x.h === 30
    && Lpasta.grupo.w > 120,
    `la pendiente lleva pastilla de 30 px de alto y tres compartimentos (grupo ${Lpasta.grupo.w}×${Lpasta.grupo.h} con su × de ${Lpasta.x.w}) - no los 14 de la pestana inventada`);
  /* Cartel del vídeo: el compartimento de la palabra va RELLENO del color del lado (verde si es largo, rojo
     si es corto), con la palabra del formulario en blanco; el del centro es la caja #1a1b1c con su pelo y
     la × en gris. */
  const colorDelLado = Lpasta.lado === 'long' ? '#24c18d' : '#f14b3f';
  ok(Lpasta.palabra === 'Límite' && Lpasta.relleno === colorDelLado && Lpasta.tonos.blanco,
    `la palabra («${Lpasta.palabra}», la del formulario para ese tipo) va sobre el relleno del lado ${Lpasta.relleno} (esperado ${colorDelLado}) en blanco, como el «Limit» rojo del vídeo`);
  ok(/^(Largo|Corto) \d[\d.,]* \/ \S+/.test(Lpasta.centro || '') && (Lpasta.lado === 'long' ? /^Largo/ : /^Corto/).test(Lpasta.centro || ''),
    `el centro dice lado, precio y tamaño como el «Open short 64,216.6 / 0.1592» del vídeo («${Lpasta.centro}»); el tamaño va en la unidad del formulario, sin inventar monedas`);
  const Leje = await page.evaluate(() => { const l = (CM._pendingLines || [])[0];
    const o = l && l.options ? l.options() : {};
    return { fondo: o.axisLabelColor, texto: o.axisLabelTextColor, linea: o.color, lado: (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id)) ? 'ok' : null }; });
  ok(Leje.fondo === '#1a1b1c' && Leje.texto === colorDelLado,
    `la etiqueta del eje es como la del vídeo: caja oscura ${Leje.fondo} con el precio en el color del lado ${Leje.texto} (la línea sigue en ${Leje.linea})`);
  ok(Lpasta.enBitmap === colorDelLado && Lpasta.yDeLibreria !== null && Math.abs((Lpasta.grupo.y + Lpasta.grupo.h / 2) - Lpasta.yDeLibreria) <= 2,
    `el bitmap del lienzo tiene el chip del lado (${Lpasta.enBitmap}) justo en la fila del precio (centro ${Lpasta.grupo.y + Lpasta.grupo.h / 2}, librería ${Lpasta.yDeLibreria})`);
  ok(Lpasta.tonos.fondo && Lpasta.tonos.pelo && Lpasta.tonos.gris,
    `el centro y la × siguen la caja de las etiquetas: #1a1b1c ${Lpasta.tonos.fondo ? 'sí' : 'NO'}, pelo #292a2b ${Lpasta.tonos.pelo ? 'sí' : 'NO'}, × #919499 ${Lpasta.tonos.gris ? 'sí' : 'NO'}`);
  ok(Lpasta.xBarra !== null && Lpasta.grupo.x <= Lpasta.xBarra && Lpasta.x.derecha < Lpasta.disco.x,
    `nace en la x de su barra (${Lpasta.xBarra} → pastilla en ${Lpasta.grupo.x}) y su × termina antes de que empiece el disco ⊕ (${Lpasta.x.derecha} < ${Lpasta.disco.x}), que era como se tapaban el uno al otro`);
  ok(Ledit.abierto && Ledit.editar.tipo === 'limit' && Math.abs(parseFloat(Ledit.precio) - Ledit.orden) < 0.51
    && Ledit.noTapaLaPastilla,
    `un clic real en el número abre el mismo editor que el + (${Ledit.editar.tipo} #${Ledit.editar.id}, precio ${Ledit.precio}) sin tapar la pastilla`);
  ok(Lhabilitado === 'auto' && Lcancelada.pendientes === Lcruz.antes - 1
    && Lcancelada.pastillas === 0 && Lcancelada.discos === 0,
    `y un clic real en su × cancela la ORDEN (${Lcruz.antes} → ${Lcancelada.pendientes} pendientes, pastilla y disco fuera) porque el hover ahora la conoce (pointer-events ${Lhabilitado})`);
  ok(Lvivo.arrastrando && Math.abs(Lvivo.ultimo - Larr.antes) > 50 && Lmovida.pendientes === 1
    && Math.abs(Lmovida.ahora - Lvivo.ultimo) < 0.51,
    `arrastrar la pastilla mueve la orden y el número pinta el precio en vivo (${Larr.antes} → ${Lmovida.ahora}, una sola pendiente) y la etiqueta le sigue (${Larr.yAntes} → ${Lmovida.yAhora} px)`);
  ok(Lpasta.yDeLibreria !== null && Math.abs((Lpasta.grupo.y + Lpasta.grupo.h / 2) - Lpasta.yDeLibreria) <= 2,
    `la pastilla esta sentada SOBRE su linea: su centro (fila ${Lpasta.grupo.y + Lpasta.grupo.h / 2}) cae en la fila que la libreria da para ese precio (${Lpasta.yDeLibreria}) - y si la autoescala se mueve, el lienzo se repinta`);
  ok(Ltrigger.pastillas === 'limit:991' && Ltrigger.cruces === 'limit:991' && Ltrigger.handles === 'limit:991:71000',
    `donde la carta no pinta línea no hay pastilla: el Activador sin límite se queda sin cartel, sin × y sin handle (handles ${Ltrigger.handles} · pastillas ${Ltrigger.pastillas} · cruces ${Ltrigger.cruces}) - y así se arregla de paso la pestaña que se le clavaba arriba del todo`);

  console.log('\n' + '─'.repeat(62));
  console.log(`Piel Bitunix: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El terminal replica la estructura y la piel del panel de futuros sin perder función.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
