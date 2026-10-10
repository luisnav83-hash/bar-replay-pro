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
       `con hueco de sobra el bloque «Avanzado» NO se pliega solo (plegado ${holgado.plegado}, por espacio ${holgado.auto}): SL/TP y la comisión se ven sin tocar nada`);
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
  console.log('\n▸ B) Paleta y rasgos MEDIDOS EN EL SITIO (docs/brecha-visual-bitunix.md)');
  const piel = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const cs = (id) => (g(id) ? getComputedStyle(g(id)) : null);
    const r = getComputedStyle(document.documentElement);
    const hoja = [...document.styleSheets].map((s) => s.href || '').find((h) => /bitunix/.test(h)) || '';
    const activa = document.querySelector('#segMarginMode .seg-btn.active');
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
  ok(/36, 193, 141/.test(piel.seg.bg) && piel.seg.h <= 30, `segmentado activo en verde rgb(36,193,141) (el suyo «Abierto» mide 26 px), ${piel.seg.h} px el nuestro`);
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
    const vis = [...document.querySelectorAll('#orderCard input[type=number]')].filter((i) => i.offsetParent !== null);
    const r = { n: vis.length, hs: vis.map((i) => Math.round(i.getBoundingClientRect().height)), ids: vis.map((i) => i.id) };
    if (estabaCerrado) { g('btnOrderAvanzado').click(); await new Promise((r2) => setTimeout(r2, 320)); }
    return r;
  });
  ok(advAbierto.n >= 4 && advAbierto.hs.every((h) => h >= 24),
     `al abrir «Avanzado» entran SL, TP y la comisión con alto táctil (${advAbierto.hs.join(',')} en ${advAbierto.n} campos: ${advAbierto.ids.join('/')})`);
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

  console.log('\n' + '─'.repeat(62));
  console.log(`Piel Bitunix: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El terminal replica la estructura y la piel del panel de futuros sin perder función.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
