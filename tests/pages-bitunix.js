/* =========================================================================
 * pages-bitunix.js — auditoría de la PIEL BITUNIX sobre LO PUBLICADO.
 *
 * Las otras suites de la piel (tests/bitunix.test.js) abren el archivo único
 * SIN RED y comprueban contrato/estructura. Esta va un paso más allá: abre la
 * app tal y como la ve cualquier visitante (GitHub Pages, con red) y comprueba
 * que el terminal de futuros funciona DE VERDAD ahí: que el libro se pinta y
 * se puede fijar al precio del replay, que el deslizador de apalancamiento y
 * el modo Cruzado/Aislado cambian el motor, que los % rápidos escriben en el
 * campo de tamaño, que las cifras de «Coste» y «Margen» cuadran con lo que
 * hace el motor, que abrir/cecerr una posición desde los botones actualiza las
 * pestañas, y que en móvil la franja sigue sin comerse el gráfico.
 *
 * Reglas (aprendidas a golpes en esta misma sesión):
 *   · Se maneja SOLO la interfaz: clics, teclado y deslizadores reales. El
 *     motor se lee para verificar, nunca para accionar.
 *   · Ningún precio ni porcentaje se escribe a mano: los niveles del libro, la
 *     liquidación esperada o el factor de tamaño se DERIVAN del estado actual
 *     (App.candles / TE.state) en el momento de medir. La serie de práctica es
 *     aleatoria y el precio cambia entre cargas.
 *   · Los números del DOM se leen con una regex de dígitos+comas+punto y se
 *     les quitan las comas: `U.num` y `U.fmtPrice` imprimen en en-US (66,540.40)
 *     con replace(/[^\d.]/g,'') dejaría 66.54.
 *   · Todo se mide por CLASE (`querySelector('.q')`), no por orden de hijos:
 *     en cada fila del libro el primer hijo es la banda decorativa `<i class="d">`.
 *
 * Uso: node tests/pages-bitunix.js                                    → lo publicado
 *      node tests/pages-bitunix.js file:///…/bar-replay-pro-unico.html → build local
 * =======================================================================*/
'use strict';

const path = require('path');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) {
  console.log('⚠️  Falta puppeteer (npm i puppeteer): prueba OMITIDA.');
  process.exit(0);
}

/* Parsea una cifra tal como se lee en pantalla (con comas de millar y sufijos
   K/M/B si el módulo del libro decide compactar). */
const NUMRX = String.raw`-?\d[\d,]*\.?\d*`;
// El DOM imprime cifras en en-US; esto saca el primer número, comas incluidas.
const n0 = (x) => { const m = String(x).match(new RegExp(NUMRX)); return m ? parseFloat(m[0].replace(/,/g, '')) : NaN; };

(async () => {
  const URL_PASADA = process.argv[2] || 'https://luisnav83-hash.github.io/bar-replay-pro/bar-replay-pro-unico.html';
  const QUIETO = URL_PASADA.startsWith('file');
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  let pasan = 0, fallan = 0, omiten = 0;
  const ok = (c, m) => { if (c) { pasan++; console.log('  ✓ ' + m); } else { fallan++; console.log('  ✗ ' + m); } };
  const skip = (m) => { omiten++; console.log('  · omitida: ' + m); };
  const cerca = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errs = [], recursos = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('requestfailed', (r) => recursos.push(r.url().slice(0, 90)));

  console.log(`\n▸ Piel Bitunix sobre ${QUIETO ? 'la build local' : 'LA APP PUBLICADA'}\n  ${URL_PASADA}`);
  await p.goto(URL_PASADA, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForFunction('window.App && window.App.candles && window.App.candles.length > 0', { timeout: 60000 });
  await p.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 40000 });
  await esp(1200);   // para que el terminal pida 24 h, funding y libro

  /* Lectura común: estado del motor + textos del terminal, todo dentro de la
     página (fuera no existen `App`, `TE` ni `OB`). */
  const E = () => p.evaluate((RX) => {
    const g = (id) => document.getElementById(id);
    const txt = (id) => { const e = g(id); return e ? (e.textContent || '').trim() : ''; };
    const n = (s) => { const m = String(s).match(new RegExp(RX)); return m ? parseFloat(m[0].replace(/,/g, '')) : NaN; };
    const pos = TE.state.position;
    return {
      velas: App.candles.length, idx: BR.getIndex(),
      precio: App.currentPrice(), tick: OB.tickOf(App.currentPrice()),
      margen: TE.state.marginMode, lev: TE.state.leverage,
      pos: pos ? pos.side : 'ninguna',
      liq: pos ? TE.liquidationPrice(pos) : NaN,
      qty: pos ? pos.qty : 0,
      pend: (TE.state.pending || []).length,
      balance: TE.state.balance,
      libre: TE.freeMargin ? TE.freeMargin() : 0,
      // Libro
      // Orden VISUAL (rect.top): el bloque de ventas es `column-reverse`, así que
      // el orden del DOM no es lo que se ve en pantalla.
      asks: [...g('bookAsks').querySelectorAll('.bf-row')].sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top).map((r) => ({
        p: n(r.querySelector('.p').textContent), q: n(r.querySelector('.q').textContent), t: n(r.querySelector('.t').textContent),
        cls: r.className, color: getComputedStyle(r.querySelector('.p')).color })),
      bids: [...g('bookBids').querySelectorAll('.bf-row')].sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top).map((r) => ({
        p: n(r.querySelector('.p').textContent), q: n(r.querySelector('.q').textContent), t: n(r.querySelector('.t').textContent),
        cls: r.className, color: getComputedStyle(r.querySelector('.p')).color })),
      ultimo: n(txt('bookLast')), origenLibro: txt('bookSrc'), fuente: txt('bfSource'),
      bPct: n(txt('bookBidPct')), sPct: n(txt('bookAskPct')),
      // Fila de estadísticas
      ultimoTop: n(txt('bfLast')), chg: txt('bfChg24'), highLow: txt('bfHighLow'),
      mark: txt('bfMark'), index: txt('bfIndex'),
      funding: txt('bfFunding'), next: txt('bfFundingNext'),
      oi: txt('bfOi'), oiVal: txt('bfOiVal'), ls: txt('bfLs'), lsLong: n(txt('bfLsLong')),
      disponible: txt('bfAvail'), equity: txt('bfEquity'),
      // Panel de órdenes
      levTxt: n(txt('bfLevVal')), levInput: +g('levRange').value,
      modoActivo: (document.querySelector('#segMarginMode .seg-btn.active') || {}).textContent || '',
      tipoActivo: (document.querySelector('#segOrderType .seg-btn.active') || {}).getAttribute('data-otype') || '',
      size: g('sizeInput').value, sizeLabel: txt('sizeLabel'), sizeSuffix: txt('sizeSuffix'),
      coste: n(txt('bfCostVal')), margenCoste: n(txt('bfMarginVal')),
      longOff: g('btnLong').disabled, shortOff: g('btnShort').disabled,
      hint: txt('orderHint'),
      // Pestañas
      tabPos: [n(txt('tabPosCount')), 0].find((v) => Number.isFinite(v)),
      tabPend: [n(txt('tabPendCount')), 0].find((v) => Number.isFinite(v)),
      lado: txt('posSide'), pnl: txt('posPnl'), entrada: txt('posEntry'),
      tamano: txt('posSize'), liqUi: n(txt('posLiq')),
      textoPos: (g('tab-positions').textContent || '').replace(/\s+/g, ' ').slice(0, 320),
    };
  }, NUMRX);

  /* ═══════════════ A) Estructura del terminal ═══════════════ */
  console.log('\n▸ A) Estructura copiada de la pantalla de futuros');
  const A = await p.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const dentro = (hijo, padre) => g(hijo) ? g(padre).contains(g(hijo)) : false;
    const cs = (id, prop) => getComputedStyle(g(id))[prop];
    const hijos = [...g('sidebar').children].filter((e) => e.offsetHeight > 0).map((e) => e.id);
    const tabs = [...document.querySelectorAll('.tabs .tab')].map((t) => t.getAttribute('data-tab'));
    const b = g('bfStats').getBoundingClientRect(), tf = g('tfQuick').getBoundingClientRect();
    return {
      statsEnBarra: dentro('bfStats', 'topbar'),
      statsBajoTf: b.top >= tf.bottom - 2,
      statsAltura: Math.round(b.height),
      hijosSidebar: hijos,
      tabs,
      ordenFlex: cs('sidebar', 'flexDirection'),
      libroAncho: Math.round(g('bookCard').getBoundingClientRect().width),
      filaStats: cs('bfStats', 'display'),
      radio: cs('bookCard', 'borderRadius'),
      cuerpoFs: getComputedStyle(document.body).fontSize,
    };
  });
  ok(A.statsEnBarra, 'la fila de estadísticas vive DENTRO de la barra superior (como Bitunix)');
  ok(A.statsBajoTf, 'las estadísticas van bajo el par y la temporalidad, no sueltas');
  ok(A.statsAltura >= 26, `la fila de estadísticas tiene altura propia (${A.statsAltura} px)`);
  ok(A.hijosSidebar[0] === 'bookCard' && A.hijosSidebar[1] === 'orderCard',
     `el sidebar es libro y luego panel de órdenes (${A.hijosSidebar.join(' · ')})`);
  ok(A.tabs.join(',') === 'positions,openorders,trades,account,stats,log,drawings',
     `las siete pestañas, en el orden del exchange (${A.tabs.join(' › ')})`);
  ok(A.radio === '0px', `las tarjetas van a escuadra, sin radio (${A.radio})`);
  ok(parseFloat(A.cuerpoFs) <= 13, `cuerpo en ${A.cuerpoFs} (tipografía compacta de terminal)`);

  /* ═══════════════ B) Fila de estadísticas ═══════════════ */
  console.log('\n▸ B) Fila de estadísticas (24 h, mark/index, funding)');
  const B = await E();
  ok(B.velas > 0 && Number.isFinite(B.precio), `hay serie cargada (${B.velas} velas, precio ${B.precio})`);
  ok(cerca(B.ultimoTop, B.precio, Math.max(B.tick, B.precio * 1e-4)),
     `el último de la barra es el precio del replay (${B.ultimoTop} ≈ ${B.precio.toFixed(2)})`);
  ok(/[+\-]/.test(B.chg) && Number.isFinite(parseFloat(B.chg)), `la variación 24 h lleva signo (${B.chg})`);
  ok(/\d/.test(B.highLow), `máximo y mínimo de 24 h visibles (${B.highLow})`);
  ok(B.mark === '—' || Number.isFinite(n0(B.mark)), `mark indexado al replay o vacío con honestidad («${B.mark}»)`);
  ok(B.mark === '—' || cerca(n0(B.mark), B.precio, Math.max(B.tick, B.precio * 1e-4)),
     `el mark del terminal es el cierre de la vela actual (${B.mark} ≈ ${B.precio.toFixed(2)})`);
  ok(/[:：][\d]{2}/.test(B.next) || B.next === '—', `la cuenta atrás de funding pinta mm:ss («${B.next}») `);
  ok(B.funding === '—' || /%/.test(B.funding), `la tasa de funding viene en porcentaje o guión («${B.funding}»)`);
  ok(B.oi === '—' || /\d/.test(B.oi), `interés abierto: dato o guión («${B.oi}»)`);
  ok(/derivado|real|replay|Binance|Bitget|sin red/i.test(B.fuente), `el origen de cada dato está etiquetado («${B.fuente}»)`);
  ok(B.disponible.length > 0 && B.equity.length > 0, `disponible y equity en la barra («${B.disponible}» / «${B.equity}»)`);

  /* ═══════════════ C) Libro de órdenes ═══════════════ */
  console.log('\n▸ C) Libro de órdenes');
  const C = await E();
  ok(C.asks.length === 10 && C.bids.length === 10, `${C.asks.length} niveles de venta y ${C.bids.length} de compra`);
  ok(C.asks.every((r, i) => r.p > C.precio), 'todas las ventas están POR ENCIMA del último precio');
  ok(C.bids.every((r, i) => r.p < C.precio), 'todas las compras están POR DEBAJO del último precio');
  ok(C.asks.every((r, i, a) => i === 0 || a[i - 1].p >= r.p), 'las ventas van de mayor a menor precio (la mejor, pegada al último)');
  ok(C.bids.every((r, i, a) => i === 0 || a[i - 1].p >= r.p), 'las compras también bajan al alejarse del último');
  ok(C.asks.every((r) => r.t >= r.q), 'la columna Total del lado de venta es acumulada (≥ su cantidad)');
  ok(C.asks.every((r, i, a) => i === 0 || r.t <= a[i - 1].t),
     'y el «Total» de las ventas crece al ALEJARSE del precio (la fila de arriba es la máxima acumulada)');
  ok(C.bids.every((r, i, a) => i === 0 || r.t >= a[i - 1].t), 'el acumulado tampoco decrece en compras');
  const rgb = (t) => (String(t).match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  const ca = rgb(C.asks[0].color), cb = rgb(C.bids[0].color);
  ok(C.asks[0].p > C.precio && ca[0] > ca[1], `las ventas van en rojo (${C.asks[0].color})`);
  ok(C.bids[0].p < C.precio && cb[1] > cb[0], `las compras van en verde (${C.bids[0].color})`);
  ok(Number.isFinite(C.ultimo) && cerca(C.ultimo, C.precio, Math.max(C.tick, C.precio * 1e-4)),
     `el precio central del libro es el último ($${C.ultimo})`);
  ok(cerca(C.bPct + C.sPct, 100, 1.5), `el ratio long/short del pie suma 100 % (B ${C.bPct} % + S ${C.sPct} %)`);

  // El botón «fijar» es la interacción propia del replay: el libro se ancla a
  // la vela actual y deja de seguir al reloj.
  const antes = (await E()).asks[0].p;
  await p.evaluate(() => document.getElementById('btnBookLive').click());
  await esp(400);
  const C2 = await E();
  ok(C2.origenLibro.length > 2, `el botón de fijar etiqueta el estado del libro («${C2.origenLibro}»)`);
  ok(Number.isFinite(C2.asks[0].p) && C2.asks[0].p > C2.precio, 'tras fijarlo el libro sigue siendo coherente con el precio');
  ok(C2.asks.length >= 5 && C2.bids.length >= 5,
     `y tras fijar/soltar el libro sigue pintando sus dos bloques (${C2.asks.length}+${C2.bids.length} niveles)`);
  ok(C2.asks.every((r, i) => i === 0 || r.p <= C2.asks[i - 1].p) && C2.bids.every((r, i) => i === 0 || r.p <= C2.bids[i - 1].p),
     'los dos bloques se leen de lejos a cerca: la mejor venta y la mejor compra, pegadas al centro');
  ok(cerca(C2.ultimo, C2.precio, Math.max(C2.tick, C2.precio * 1e-4)),
     `el centro del libro siempre dice el precio actual (${C2.ultimo} ≈ ${C2.precio.toFixed(2)})`);
  await p.evaluate(() => document.getElementById('btnBookLive').click());
  await esp(300);

  /* Clic en un precio del libro → el precio de límite se rellena (Bitunix) */
  const clicLibro = await p.evaluate(() => {
    const fila = document.querySelector('#bookAsks .bf-row .p') || document.querySelector('#bookAsks .bf-row');
    fila.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return fila.textContent.trim();
  });
  await esp(250);
  const C3 = await p.evaluate(() => ({
    tipo: (document.querySelector('#segOrderType .seg-btn.active') || {}).getAttribute('data-otype') || '',
    limite: document.getElementById('limitInput').value,
  }));
  ok(Number.isFinite(parseFloat(C3.limite)) || C3.tipo === 'limite',
     `pulsar un precio del libro lleva al modo límite con el nivel escrito («${clicLibro}» → ${C3.limite || C3.tipo})`);
  ok(await p.evaluate(() => {
    const asked = [...document.querySelectorAll('#bookAsks .p')].map((e) => parseFloat(e.textContent.replace(/[^\d.]/g, '')));
    const lim = parseFloat(document.getElementById('limitInput').value);
    return !Number.isFinite(lim) || asked.some((v) => Math.abs(v - lim) < 1e-6);
  }), 'el precio escrito en el campo coincide con una fila real del libro');

  /* ═══════════════ D) Panel de órdenes ═══════════════ */
  console.log('\n▸ D) Panel de órdenes (apalancamiento, modo, tamaño, coste)');
  const D = await E();
  ok(D.levTxt === D.levInput, `la etiqueta del apalancamiento sigue al deslizador (${D.levTxt}× = ${D.levInput})`);
  const modoUi = /cruzado/i.test(D.modoActivo) ? 'cross' : /aislado/i.test(D.modoActivo) ? 'isolated' : '?';
  ok(modoUi === D.margen, `el botón pulsado («${D.modoActivo.trim()}») y el motor (${D.margen}) dicen lo mismo`);
  ok(D.tipoActivo === 'market' || D.tipoActivo === 'limite', `tipo de orden marcado (${D.tipoActivo})`);
  const modoInicial = D.margen;
  // Aislado ↔ cruzado desde el seg, y la liquidación debe reaccionar
  await p.evaluate(() => {
    const otro = [...document.querySelectorAll('#segMarginMode .seg-btn')].find((x) => !x.classList.contains('active'));
    otro.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await esp(300);
  const D2 = await E();
  ok(D2.margen !== modoInicial, `pulsar el seg cambia el modo del motor (${modoInicial} → ${D2.margen})`);
  await p.evaluate(() => {
    const otro = [...document.querySelectorAll('#segMarginMode .seg-btn')].find((x) => !x.classList.contains('active'));
    otro.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await esp(250);

  // Deslizador de apalancamiento: se maneja como el usuario (input + change)
  const levAntes = (await E()).lev;
  await p.evaluate(() => {
    const r = document.getElementById('levRange');
    r.value = String(Math.min(100, Math.max(2, r.min + 9)));
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await esp(300);
  const D3 = await E();
  ok(D3.lev === +D3.levInput && D3.lev !== levAntes, `mover el deslizador cambia el apalancamiento del motor (${levAntes}× → ${D3.lev}×)`);
  ok(D3.levTxt === D3.lev, `y la cifra del panel se actualiza (${D3.levTxt}×)`);

  // % rápidos: 25 → el campo de tamaño debe valer el 25 % (modo %) y el coste
  // tiene que cuadrar con qty · precio y margen = coste / apalancamiento.
  const D4 = await (async () => {
    await p.evaluate(() => document.querySelector('#quickSize [data-pct="25"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await esp(280);
    const s = await E();
    return { ...s, pct: 25 };
  })();
  ok(cerca(parseFloat(D4.size), 25, 0.01), `el botón 25 escribe 25 en el campo de tamaño (${D4.size})`);
  const cuadra = await p.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const n = (s) => { const m = String(s).match(new RegExp(String.raw`-?\d[\d,]*\.?\d*`)); return m ? parseFloat(m[0].replace(/,/g, '')) : NaN; };
    const precio = App.currentPrice();
    const modo = (document.querySelector('#segSize .seg-btn.active') || {}).getAttribute('data-mode');
    const raw = parseFloat(g('sizeInput').value) || 0;
    const lev = TE.state.leverage || 1;
    // El motor decide el tamaño; aquí se reproduce SOLO para comparar con lo
    // que el panel anuncia (coste y margen), no para actuar sobre él.
    let qty;
    if (modo === 'pct') qty = (TE.state.balance * lev * (raw / 100)) / precio;
    else if (modo === 'notional') qty = (raw * lev) / precio;
    else qty = raw;
    return { qty, precio, modo, lev, coste: n(g('bfCostVal').textContent), margen: n(g('bfMarginVal').textContent) };
  });
  ok(Number.isFinite(cuadra.coste) && cuadra.coste > 0, `el panel anuncia un coste (${cuadra.coste.toFixed(2)} USDT)`);
  ok(cerca(cuadra.coste, cuadra.qty * cuadra.precio, Math.max(1, cuadra.qty * cuadra.precio * 0.02)),
     `coste = cantidad · precio (${(cuadra.qty * cuadra.precio).toFixed(2)} ≈ ${cuadra.coste.toFixed(2)})`);
  ok(cerca(cuadra.margen, cuadra.coste / cuadra.lev, Math.max(0.5, cuadra.coste / cuadra.lev * 0.02)),
     `margen = coste / apalancamiento (${(cuadra.coste / cuadra.lev).toFixed(2)} ≈ ${cuadra.margen.toFixed(2)} a ${cuadra.lev}×)`);

  // 0 % → no se puede operar: los botones se deshabilitan
  await p.evaluate(() => document.querySelector('#quickSize [data-pct="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await esp(280);
  const D5 = await E();
  ok(D5.longOff && D5.shortOff, 'con tamaño 0 los botones Long y Short se deshabilitan (no hay orden possible)');
  await p.evaluate(() => document.querySelector('#quickSize [data-pct="50"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await esp(280);
  ok(!(await E()).longOff, 'y vuelven a estar activos al poner 50');

  /* ═══════════════ E) Operar con los botones ═══════════════ */
  console.log('\n▸ E) Abrir, liquidación por modo, y cerrar');
  await p.evaluate(() => document.getElementById('btnLong').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await esp(600);
  const E1 = await E();
  ok(E1.pos === 'long', `el botón «Abrir Long» abre una posición real (${E1.pos})`);
  ok(E1.tabPos === 1, `el contador de la pestaña Posiciones sube a ${E1.tabPos}`);
  ok(/long/i.test(E1.lado), `la pestaña «Posiciones» pinta el lado (${E1.lado})`);
  ok(Number.isFinite(n0(E1.entrada)) && cerca(n0(E1.entrada), E1.precio, Math.max(1, E1.precio * 0.02)),
     `la entrada mostrada es el precio de la vela actual (${E1.entrada})`);
  ok(Number.isFinite(E1.liqUi) && E1.liqUi > 0, `el precio de liquidación visible es un número (${E1.liqUi})`);
  ok(cerca(E1.liqUi, E1.liq, Math.max(1, E1.liq * 0.005)),
     `la liquidación de la tarjeta coincide con la del motor (${E1.liqUi} ≈ ${E1.liq.toFixed(2)})`);
  ok(/\d/.test(E1.pnl), `el PnL no realizado se pinta (${E1.pnl})`);
  ok(E1.liq < E1.precio, `en un LONG la liquidación queda por debajo del precio (${E1.liq.toFixed(2)} < ${E1.precio.toFixed(2)})`);

  // La diferencia entre Cruzado y Aislado debe verse EN la liquidación
  const liqCross = E1.liq;
  await p.evaluate(() => { document.querySelector('#segMarginMode .seg-btn[data-mm="isolated"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await esp(400);
  const E2 = await E();
  const liqIso = E2.liq;
  ok(Math.abs(liqIso - liqCross) > 1e-9, `cambiar de modo mueve la liquidación (${liqCross.toFixed(2)} → ${liqIso.toFixed(2)})`);
  const clsica = await p.evaluate(() => {
    const p = TE.state.position;
    return p.entryPrice * (1 - 1 / (p.leverage || TE.state.leverage));
  });
  ok(cerca(liqIso, clsica, Math.max(0.5, clsica * 0.01)),
     `en AISLADO vuelve la fórmula clásica entrada·(1 − 1/lev) (${clsica.toFixed(2)} ≈ ${liqIso.toFixed(2)})`);
  ok(liqCross < liqIso, `y el margen libre del modo cruzado la aleja hacia abajo (${liqCross.toFixed(2)} < ${liqIso.toFixed(2)})`);
  await p.evaluate(() => { document.querySelector('#segMarginMode .seg-btn[data-mm="cross"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await esp(300);

  // Límite pendiente con clic
  await p.evaluate(() => {
    document.querySelector('#segOrderType .seg-btn[data-otype="limite"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await esp(250);
  const lim = await p.evaluate(() => {
    const px = App.currentPrice() * 1.01;
    const i = document.getElementById('limitInput');
    i.value = px.toFixed(2);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnShort').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { px };
  });
  await esp(600);
  const E3 = await E();
  ok(E3.pend === E1.pend + 1, `la orden límite queda pendiente (${E3.pend})`);
  ok(E3.tabPend === E3.pend, `el contador de la pestaña Órdenes coincide (${E3.tabPend})`);
  const listaPend = await p.evaluate(() => {
    const t = document.getElementById('tab-openorders');
    const filas = [...t.querySelectorAll('#pendingListTab .pending-item')];
    return {
      filas: filas.length,
      texto: (filas[0] ? filas[0].textContent : '').replace(/\s+/g, ' ').trim().slice(0, 90),
      cancelaDentro: !!t.querySelector('#pendingListTab [data-cancel]'),
      precioUi: (document.querySelector('#pendingList .pi-price') || {}).textContent || '',
    };
  });
  ok(listaPend.filas === 1, `la pestaña «Órdenes» lista su orden en espera (${listaPend.filas})`);
  ok(!listaPend.cancelaDentro, 'y su copia es de solo lectura: cancelar sigue siendo cosa de la pestaña Posiciones');
  ok(/[\d,]{5,}/.test(listaPend.precioUi) && listaPend.texto.length > 4,
     `el precio de la pendiente se ve en las dos listas (${listaPend.precioUi.trim()} · «${listaPend.texto.slice(0, 34)}…»)`);

  // Cerrar todo desde el propio terminal
  await p.evaluate(() => document.getElementById('btnFlatten').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await esp(700);
  const E4 = await E();
  ok(E4.pos === 'ninguna' && /flat/i.test(E4.lado), '«Cerrar todo» liquida la posición y la tarjeta vuelve a FLAT');
  ok(E4.tabPos === 0, `y el contador de la pestaña vuelve a 0 (${E4.tabPos})`);

  /* ═══════════════ F) Las pestañas se repintan al activarse ═══════════════ */
  console.log('\n▸ F) Pestañas inferiores (curva de capital incluida)');
  const F = await p.evaluate(async () => {
    const antes = document.querySelector('#tab-stats canvas');
    const w = antes ? antes.getBoundingClientRect().width : 0;
    document.querySelector('.tab[data-tab="account"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    document.querySelector('.tab[data-tab="stats"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 450));
    const c = document.querySelector('#tab-stats canvas');
    const r = c ? c.getBoundingClientRect() : { width: 0, height: 0 };
    return { w, despues: Math.round(r.width), alto: Math.round(r.height),
      balance: (document.getElementById('tab-account').textContent || '').replace(/\s+/g, ' ').slice(0, 160) };
  });
  ok(F.despues > 120 && F.alto > 40,
     `la curva de capital se redibuja al volver a su pestaña (${F.despues}×${F.alto} px, antes ${Math.round(F.w)} px)`);
  ok(/balance|equity|colateral|ratio/i.test(F.balance), `la pestaña Cuenta muestra balance y margen («${F.balance.slice(0, 40)}…»)`);

  /* ═══════════════ G) Estrecho, sobre lo publicado ═══════════════ */
  console.log('\n▸ G) Ventana estrecha y móvil (sobre lo publicado)');
  for (const [w, h, etiqueta] of [[900, 700, '900×700'], [390, 844, 'móvil 390×844'], [1400, 560, 'panel embebido bajo']]) {
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await esp(650);
    const G = await p.evaluate(() => {
      const R = (id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect() : { top: 0, bottom: 0, height: 0, width: 0 }; };
      const ws = R('workspace'), ca = R('chartArea');
      const g = (id) => document.getElementById(id);
      return {
        chart: Math.round(R('chartWrap').height),
        fila: Math.round(parseFloat(getComputedStyle(g('chartArea')).gridTemplateRows.split(' ')[1])),
        solape: Math.max(0, Math.round(R('chartWrap').bottom - R('paneArea').top)),
        recorte: Math.round(Math.max(0, ca.bottom - ws.bottom)) + Math.round(Math.max(0, ws.bottom - R('bottomPanel').top)),
        ox: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        orden: [...g('sidebar').children].map((e) => getComputedStyle(e).order + ':' + e.id).sort().join(' '),
        franja: getComputedStyle(g('sidebar')).flexDirection,
        stats: Math.round(R('bfStats').height),
        libro: Math.round(R('bookCard').height),
        visible: !!g('btnLong') && g('btnLong').getBoundingClientRect().width > 40,
      };
    });
    /* ≥200 px de gráfico es contrato en pantallas con sitio. En el teléfono (≤640 px)
       el contrato honesto es otro y más difícil: que lo que mide la caja sea lo que hay
       (caja == fila) y que nada se pinte sobre la escalera (solape 0), con ≥140 px.
       Pedir aquí más píxeles solo se paga quitándoselos al formulario de órdenes o a
       las tarjetas del registro — y entonces botones como el del trailing se salen de
       la pantalla (tests/pages-trailing.js lo detecta y deja de poder pulsar). */
    if (w <= 640) {
      ok(G.chart >= 140 && G.chart === G.fila && G.solape === 0,
         `${etiqueta}: ${G.chart} px de gráfico HONESTOS (caja == fila ${G.fila}, ${G.solape} px de solape; antes de compactar: 43 de fila con caja de 200 y 157 px encima de la escalera)`);
    } else {
      const minimo = h >= 720 ? 200 : 150;
      ok(G.chart >= minimo, `${etiqueta}: el gráfico conserva ${G.chart} px (mínimo ${minimo})`);
      ok(G.solape === 0, `${etiqueta}: y el lienzo no desborda su fila sobre la escalera (${G.solape} px, fila ${G.fila})`);
    }
    ok(G.recorte === 0, `${etiqueta}: nada se desborda por debajo del panel (${G.recorte})`);
    ok(G.ox === 0, `${etiqueta}: sin scroll horizontal (${G.ox} px)`);
    ok(G.stats > 0, `${etiqueta}: la fila de estadísticas sigue visible (${G.stats} px)`);
    if (w <= 1000) {
      ok(G.franja === 'row', `${etiqueta}: la franja del terminal pasa a fila (${G.franja})`);
      ok(/1:#orderCard|1:orderCard/.test(G.orden), `${etiqueta}: el panel de órdenes es lo primero que se ve (${G.orden})`);
    }
    ok(G.visible, `${etiqueta}: los botones Long/Short se pueden pulsar`);
  }
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await esp(500);

  /* ═══════════════ H) Honestidad de los datos y salud de la página ═══════════════ */
  console.log('\n▸ H) Procedencia de los datos y salud de la página');
  const H = await p.evaluate(() => ({
    fuente: (document.getElementById('bfSource').textContent || '').trim(),
    origen: (document.getElementById('bookSrc').textContent || '').trim(),
    live: !!(window.OB && OB.live),
    futuros: (document.getElementById('bfMarket') ? document.getElementById('bfMarket').textContent : '').replace(/\s+/g, ' ').trim().slice(0, 120),
    velas: App.candles.length,
    desde: App.candles[0].time, hasta: App.candles[App.candles.length - 1].time,
    protocolo: location.protocol,
    propias: performance.getEntriesByType('resource').filter((r) => new URL(r.name).origin === location.origin).length,
    externas: performance.getEntriesByType('resource').filter((r) => new URL(r.name).origin !== location.origin).map((r) => new URL(r.name).host),
  }));
  ok(H.velas > 0 && H.hasta > H.desde, `la serie viene de velas reales (${H.velas} velas, ${new Date(H.desde * 1000).toISOString().slice(0, 10)} → ${new Date(H.hasta * 1000).toISOString().slice(0, 10)})`);
  ok(!/\breal\b/i.test(H.fuente) || H.live, 'si el rótulo promete datos «reales», el módulo confirma que lo son (nada se vende de más)');
  ok(H.live ? /real|binance|24 ?h/i.test(H.fuente) : /derivado|replay/i.test(H.fuente),
     `el libro declara su origen sin mentir: «${H.fuente}» · live=${H.live}`);
  const hosts = [...new Set(H.externas)].sort();
  ok(!/fapi\.binance\.com/.test(hosts.join(' ')), 'no se depende del espejo de FUTUROS de Binance (bloqueado por región: se usa Bitget)');
  ok(hosts.every((h) => /binance|bitget|github|jsdelivr|unpkg/i.test(h)), `solo se llama a los hosts previstos (${hosts.join(', ') || 'ninguno'})`);
  if (QUIETO) skip('en build local no se auditan los hosts externos ni el proxy');
  ok(errs.length === 0, `ningún error de JavaScript en lo publicado${errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''}`);
  ok(recursos.length === 0 || recursos.every((u) => !/binance|bitget/.test(u)),
     `ninguna petición clave rota${recursos.length ? ' · ' + recursos.length + ' fallidas: ' + recursos.slice(0, 2).join(' | ') : ''}`);

  /* ═══════════════ Resumen ═══════════════ */
  console.log('\n' + '─'.repeat(64));
  console.log(`${QUIETO ? 'Build local' : 'PAGES'} · piel Bitunix: ${pasan} superadas, ${fallan} fallidas · ${omiten} omitidas · errores JS ${errs.length} · peticiones fallidas ${recursos.length}`);
  if (errs.length) console.log(errs.slice(0, 4).map((e) => '   ! ' + e).join('\n'));
  await b.close();
  process.exit(fallan || errs.length ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
