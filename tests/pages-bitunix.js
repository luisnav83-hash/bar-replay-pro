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

    /* ═══ «AVANZADO» del formulario, TOCADO con dedo sobre lo publicado ═══
       En el teléfono el cuerpo del formulario pedía 510 px dentro de 214 de caja: once
       controles vivían bajo el recorte. Se prueban las dos mitades del arreglo —lo
       esencial alcanzable sin deslizar, lo plegado alcanzable al abrir— porque la
       segunda sin la primera es simplemente esconder cosas. */
    if (w <= 640) {
      /* La barra superior compactada, SOBRE LO PUBLICADO: la promesa no es «que quepa»,
         es que quepa sin perder dato ni botón. Se mide el andamio, el recorte con
         ellipsis de cada chip de 24 h y si lo que queda fuera del deslizador horizontal
         se alcanza deslizando. */
      const TB = await p.evaluate(async () => {
        const g = (id) => document.getElementById(id);
        const tb = g('topbar'), q = tb.getBoundingClientRect();
        const pisa = (e) => { const r = e.getBoundingClientRect();
          const c = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
          return (c === e || e.contains(c) || (c && c.contains(e))) ? 'si' : 'no'; };
        const corte = [...g('bfStats').children].filter((c) =>
          [...c.querySelectorAll('.bf-k, .bf-v, .bf-sub')].some((k) => k.scrollWidth > k.clientWidth + 1)).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18));
        const grupo = tb.querySelector('.topbar-group');
        const tf = g('tfQuick').querySelector('.tf-btn.active');
        const antes = pisa(tf);
        tf.scrollIntoView({ inline: 'center', block: 'nearest' });
        await new Promise((r) => setTimeout(r, 260));
        const despues = pisa(tf);
        return { alto: Math.round(q.height), filas: getComputedStyle(tb).gridTemplateRows,
          stats: Math.round(g('bfStats').getBoundingClientRect().height),
          iconos: [...tb.querySelectorAll('.topbar-right button')].map((e) => Math.round(e.getBoundingClientRect().height)),
          scrollea: grupo.scrollWidth > grupo.clientWidth + 2, corte, antes, despues,
          chart: Math.round(g('chartWrap').getBoundingClientRect().height),
          fila: Math.round(parseFloat(getComputedStyle(g('chartArea')).gridTemplateRows.split(' ')[1] || '0')),
          solape: Math.max(0, Math.round(g('chartWrap').getBoundingClientRect().bottom - g('paneArea').getBoundingClientRect().top)) };
      });
      ok(TB.alto <= 96 && TB.stats <= 26 && TB.iconos.every((h) => h >= 20),
         `${etiqueta}: la barra superior del teléfono mide ${TB.alto} px (filas ${TB.filas}, estadísticas ${TB.stats}, iconos ${TB.iconos.join('/')})`);
      ok(TB.corte.length === 0, `${etiqueta}: ningún número de las 24 h queda cortado con ellipsis${TB.corte.length ? ' (' + TB.corte.join(' | ') + ')' : ''}`);
      ok(TB.scrollea && TB.antes === 'no' && TB.despues === 'si',
         `${etiqueta}: la fila del par desliza y la temporalidad activa se alcanza deslizando (${TB.antes} → ${TB.despues})`);
      ok(TB.chart >= 120 && TB.chart === TB.fila && TB.solape === 0,
         `${etiqueta}: y el gráfico se queda con ${TB.chart} px de verdad (fila ${TB.fila}, solape ${TB.solape})`);

      /* LA BARRA DE REPLAY DEL TELÉFONO, SOBRE LO PUBLICADO. Medido en local antes de
         tocar: 795 px de contenido en 389 de caja, el deslizador de posición empezaba en
         x 458 (fuera) con 4 px de alto, y la línea de información —hora, contador,
         estado— caía FUERA por debajo del borde de la barra porque `chart.css` la ponía en
         columna y `responsive.css` envolvía la barra: sin scroll vertical, en un móvil
         nunca se había visto dónde va el replay. Salió además un bug de escala que estaba
         en todas las pantallas: el `<input>` tenía `max="100"` mientras el código escribe
         `fracción*1000` y divide por 1000 → el navegador clampaba el valor, la perilla vivía
         pegada a la derecha desde la vela 1 y arrastrarla no salía del 10 % del histórico. */
      const RB = await p.evaluate(async () => {
        const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
        const g = (id) => document.getElementById(id);
        const app = window.App || window.__BR_APP__;
        const b = g('replayBar'); if (!b) return null;
        const R = (e) => { const r = e.getBoundingClientRect(); return { h: r.height, t: r.top, b: r.bottom, l: r.left, r: r.right, x: r.x, y: r.y, w: r.width }; };
        const q = R(b);
        const pisa = (e) => { const r = R(e); if (!r.h) return 'oculto';
          const el = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
          return el && (e === el || e.contains(el) || el.contains(e)) ? 'si' : 'no'; };
        const dentro = (e) => { const r = R(e); return r.h > 0 && r.b <= q.b + 0.5 && r.t >= q.t - 0.5 ? 'si' : 'recortado'; };
        const control = {};
        ['btnReset', 'btnStepBack', 'btnPlay', 'btnStepFwd', 'btnJumpEnd', 'progressRange', 'pbIndex', 'pbStatus']
          .forEach((id) => { const e = g(id); control[id] = e ? pisa(e) + '/' + Math.round(R(e).h) + '/' + dentro(e) : 'no existe'; });
        const chips = [...b.querySelectorAll('.speed-btn')];
        const max = b.scrollWidth - b.clientWidth;
        const alcanzable = chips.map((e) => pisa(e) === 'si');   // cada chip, ¿es pulsable ya?
        if (getComputedStyle(b).overflowX === 'auto' && max > 0) {
          for (let s = 0.2; s <= 1.001; s += 0.2) {
            b.scrollLeft = max * s; await esperar(80);
            chips.forEach((e, k) => { if (pisa(e) === 'si') alcanzable[k] = true; });
          }
        }
        b.scrollLeft = 0;   // se deja como estaba, como en el resto de la suite
        const s = g('progressRange');
        let ida = null;
        if (window.BR && app && app.candles && app.candles.length > 4) {
          const n = app.candles.length;
          BR.seek(Math.round(n * 0.7)); await esperar(240);
          ida = { idx: Math.round((BR.getIndex() + 1) / n * 100), valor: Math.round(+s.value) };
          s.value = '500'; s.dispatchEvent(new Event('input', { bubbles: true })); await esperar(240);
          ida.vuelta = Math.round((BR.getIndex() + 1) / n * 100);
          BR.seek(Math.round(n * 0.2)); await esperar(140);
          /* Con el deslizador enfocado: el guard viejo era `document.activeElement !== slider`,
             así que en cuanto lo tocabas la perilla dejaba de seguir al replay (y al soltar
             tampoco se enganchaba hasta la vela siguiente). */
          s.focus(); App.stepForward(); App.stepForward(); await esperar(280);
          ida.conFoco = { valor: Math.round(+s.value), pide: Math.round(BR.progressTotal() * 1000) };
          s.blur();
        }
        return { alto: Math.round(q.h), sw: b.scrollWidth, cw: b.clientWidth,
                 deslizable: getComputedStyle(b).overflowX === 'auto', control,
                 escala: s ? [ +s.min, +s.max ] : [], inalcanzables: chips.filter((e, k) => !alcanzable[k]).map((e) => e.textContent.trim()),
                 ida };
      });
      const c = (id) => (RB ? RB.control[id] : 'sin barra');
      ok(RB && RB.alto === 34, `${etiqueta}: la barra de replay mide ${RB ? RB.alto : '?'} px con la línea de posición DENTRO (antes 38 px y la segunda línea colgando por debajo del borde, sin scroll donde buscarla)`);
      ok(/^si\/2\d\/si$/.test(c('progressRange')),
         `${etiqueta}: el deslizador de posición se ve, se pulsa y no se recorta —${c('progressRange')}— (antes «no/4/recortado») y usa la escala del código (0..${RB ? RB.escala[1] : '?'}, no 0..100)`);
      ok(['pbIndex', 'pbStatus'].every((id) => /^si\/\d+\/si$/.test(c(id))),
         `${etiqueta}: contador y estado del replay a la vista sin deslizar (${c('pbIndex')} · ${c('pbStatus')})`);
      ok(['btnReset', 'btnStepBack', 'btnPlay', 'btnStepFwd', 'btnJumpEnd'].every((id) => /^si\/2\d\/si$/.test(c(id))),
         `${etiqueta}: los cinco botones de transporte siguen siendo diana y caben (${['btnReset', 'btnStepBack', 'btnPlay', 'btnStepFwd', 'btnJumpEnd'].map((id) => c(id).split('/')[1] + 'px').join(' ')})`);
      ok(RB && RB.inalcanzables.length === 0,
         RB && RB.inalcanzables.length ? `${etiqueta}: detrás del swipe hay velocidades inalcanzables: ${RB.inalcanzables.join(' ')}`
           : `${etiqueta}: lo que no cabe de la barra no está enterrado (${RB ? RB.sw : '?'} px en ${RB ? RB.cw : '?'}, ${RB && RB.deslizable ? 'deslizable' : 'sin overflow'}): todas las velocidades se pulsan en algún punto del deslizamiento`);
      ok(RB && RB.ida && RB.ida.conFoco && Math.abs(RB.ida.conFoco.valor - RB.ida.conFoco.pide) <= 2,
         `${etiqueta}: la perilla sigue al replay con el deslizador enfocado (${RB && RB.ida && RB.ida.conFoco ? RB.ida.conFoco.valor + ' · índice ' + RB.ida.conFoco.pide : '?'} puntos de 1000; con el guard por foco se quedaba congelada)`);

      /* LA ESCALERA DE INDICADORES EN EL TELÉFONO, SOBRE LO PUBLICADO. Antes de esto cada
         panel medía 44 px con la cabecera de 24 y el eje de tiempo pintado DENTRO del panel
         de abajo: a ese panel le quedaban 2 px de gráfico en el móvil (y 12 px a 1440×900).
         Ahora el eje se pinta donde hay hueco (CM._reparteEje) y los paneles son de 56 px
         con el PnL a 60, topando la escalera a su fila de siempre para que lo que sobre se
         desplace en vez de comerle píxeles al gráfico. */
      const ESC = await p.evaluate(async () => {
        const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
        const g = (id) => document.getElementById(id);
        /* ESTE BLOQUE TOCA EL ESTADO DE LOS INDICADORES, así que tiene que dejarlo EXACTAMENTE
           como lo encontró: más abajo, el bloque de «Avanzado» compara el alto del gráfico con
           el que midió arriba (`AV.vuelta.caja === G.chart`) y le daba igual porque nadie había
           tocado nada —los paneles que abrió la iteración de 900×700 seguían abiertos—; con
           este bloque apagándolos, el gráfico crecía 56 px y ese assert saltaba por los aires.
           Se guarda y se devuelve, y el bloque no puede dejar huella en la geometría. */
        const antes = { rsi: App.indicators.rsi.on, macd: App.indicators.macd.on, atr: App.indicators.atr.on };
        App.indicators.rsi.on = true; App.indicators.macd.on = true;
        App.applyIndicators(App.indicators, true);
        await esperar(700);
        const pa = g('paneArea'), q = pa.getBoundingClientRect(), rp = g('replayBar').getBoundingClientRect();
        const franja = (id) => { const c = g(id); const cv = c && c.querySelector('canvas');
          return c && cv ? Math.round(c.getBoundingClientRect().height - cv.getBoundingClientRect().height) : -1; };
        const paneles = [...pa.querySelectorAll('.indPane')].filter((e) => !e.classList.contains('hidden'))
          .map((e) => { const cv = e.querySelector('canvas'), cont = e.querySelector('.pane-chart');
            return { id: e.id.replace('pane', ''), h: Math.round(e.getBoundingClientRect().height),
              canvas: cv ? Math.round(cv.getBoundingClientRect().height) : 0,
              inline: e.style.height || '—',
              recortado: e.getBoundingClientRect().bottom > pa.getBoundingClientRect().bottom + 0.5 }; });
        const max = pa.scrollHeight - pa.clientHeight;
        pa.scrollTop = max; await esperar(200);
        const ultimoDentro = (() => { const e = [...pa.querySelectorAll('.indPane')].filter((x) => !x.classList.contains('hidden')).pop();
          const a = e.querySelector('.pane-close').getBoundingClientRect(), c = pa.getBoundingClientRect();
          return a.bottom <= c.bottom + 0.5 && a.top >= c.top - 0.5; })();
        pa.scrollTop = 0;
        App.indicators.rsi.on = antes.rsi; App.indicators.macd.on = antes.macd; App.indicators.atr.on = antes.atr;
        App.applyIndicators(App.indicators, true);
        await esperar(320);
        return { paneles, alto: Math.round(q.height), bot: Math.round(q.bottom), rpTop: Math.round(rp.top),
          scrollea: pa.scrollHeight > pa.clientHeight + 2, max, eje: CM._ejeEn, franja: franja('chartWrap'),
          franjaMacd: franja('chartMacd'), chart: Math.round(g('chartWrap').getBoundingClientRect().height),
          devueltos: 'rsi:' + App.indicators.rsi.on + ' macd:' + App.indicators.macd.on,
          igual: App.indicators.rsi.on === antes.rsi && App.indicators.macd.on === antes.macd
            && App.indicators.atr.on === antes.atr };
      });
      const deInd = ESC.paneles.filter((x) => x.id !== 'Pnl');
      ok(deInd.length === 2 && deInd.every((x) => x.h >= 56 && x.canvas >= 30),
         `${etiqueta}: cada indicador de la escalera tiene ${deInd.map((x) => x.canvas + ' px de gráfico en ' + x.h + ' de panel').join(' y ')} (antes: 2 px, el RSI y el MACD no se veían en el móvil)`);
      ok(ESC.eje === 'principal' && ESC.franja >= 10 && ESC.franjaMacd < 10,
         `${etiqueta}: el eje de tiempo se pinta en el gráfico principal (franja de ${ESC.franja} px) y el panel de abajo no lo paga (${ESC.franjaMacd} px): ${ESC.eje}`);
      ok(ESC.alto <= 118 && ESC.bot <= ESC.rpTop + 1 && ESC.chart >= 180,
         `${etiqueta}: la escalera queda topada a ${ESC.alto} px, termina en y ${ESC.bot} con el replay en y ${ESC.rpTop} y el gráfico conserva ${ESC.chart} px`);
      ok(ESC.igual === true,
         `${etiqueta}: y el bloque deja los indicadores como los encontró (${ESC.devueltos}) —la geometría de las comprobaciones siguientes depende de eso, así que se comprueba la vuelta, no la buena voluntad—`);
      ok(!ESC.scrollea || ESC.max > 0,
         `${etiqueta}: lo que no cabe de la escalera se desplaza por dentro (${ESC.max} px deslizables)${ESC.scrollea ? '' : ' —y con la escalera por defecto no hace falta—'}`);
      ok(!RB || !RB.ida || (RB.ida.valor >= 690 && RB.ida.valor <= 710 && RB.ida.idx >= 68 && RB.ida.idx <= 72 && RB.ida.vuelta >= 48 && RB.ida.vuelta <= 52),
         `${etiqueta}: la perilla sigue la posición real (${RB && RB.ida ? RB.ida.valor : '?'} puntos de 1000 en la vela 70 %) y arrastrarla al 50 % lleva el replay a la mitad (${RB && RB.ida ? RB.ida.vuelta : '?'} %) —con el tope a 100 se leía 100 y el gesto no salía del 10 %—`);

      const AV = await p.evaluate(async () => {
        const g = (id) => document.getElementById(id);
        const pisa = (e) => {
          if (!e || e.offsetParent === null) return 'oculto';
          const q = e.getBoundingClientRect();
          const c = document.elementFromPoint(Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2));
          return (c === e || e.contains(c) || (c && c.contains(e))) ? 'si' : 'no';
        };
        // `#feeInput` no está en la lista: es el control HEREDADO del tema anterior,
        // dentro de un `.visually-hidden` y fuera del recorte por diseño (su centro mide
        // x = −11 px). Se comprueba lo que la persona ve y toca.
        /* Los cinco de arriba tienen que estar A LA VISTA sin deslizar nada; «Cerrar
           todo» y los precios de SL/TP viven en la parte que puede quedar debajo (es un
           botón destructivo y dos campos de uso puntual, y la barra de Long/Short es fija
           por diseño), así que se comprueba alcanzABLES deslizando la tarjeta. */
        const esenciales = ['segOrderType', 'segSize', 'sizeInput', 'btnLong', 'btnShort'];
        const bajoPie = ['btnFlatten'];
        const cb = g('orderCard').querySelector('.card-body');
        const recorte = () => Math.round(cb.scrollHeight - cb.clientHeight);
        // Se mide la tarjeta DESDE SU ARRIBA: las secciones anteriores de esta suite ya
        // han jugado con el deslizador y un «no se pulsa» sin volver a 0 sería un falso
        // positivo (el control está, solo que fuera del hueco en ese instante).
        cb.scrollTop = 0;
        const antes = { hitos: esenciales.map((id) => pisa(g(id))), recorte: recorte(), desborda: g('orderCard').classList.contains('desborda'),
                        abajo: bajoPie.map((id) => g(id).getBoundingClientRect().top > cb.getBoundingClientRect().bottom - 2),
                        aria: g('btnOrderAvanzado').getAttribute('aria-expanded'),
                        oculto: !g('orderAvanzado').offsetParent,
                        docH: document.documentElement.scrollHeight, vh: window.innerHeight,
                        head: Math.round(g('orderCard').querySelector('.card-head').getBoundingClientRect().height) };
        g('btnOrderAvanzado').click();
        await new Promise((r) => setTimeout(r, 420));
        const sl = g('slInput');
        sl.scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 220));
        sl.focus(); sl.value = '70000'; sl.dispatchEvent(new Event('input', { bubbles: true }));
        const despues = {
          aria: g('btnOrderAvanzado').getAttribute('aria-expanded'), visible: !!g('orderAvanzado').offsetParent,
          sl: (document.activeElement === sl ? 'foco' : 'SIN FOCO') + '/' + pisa(sl) + '/' + sl.value,
          recorte: (() => { const cb = g('orderCard').querySelector('.card-body'); return Math.round(cb.scrollHeight - cb.clientHeight); })(),
          desborda: g('orderCard').classList.contains('desborda'),
          solape: Math.max(0, Math.round(g('chartWrap').getBoundingClientRect().bottom - g('paneArea').getBoundingClientRect().top)),
          caja: Math.round(g('chartWrap').getBoundingClientRect().height),
          fila: Math.round(parseFloat(getComputedStyle(g('chartArea')).gridTemplateRows.split(' ')[1] || '0')),
          franja: Math.round(g('sidebar').getBoundingClientRect().height),
        };
        g('btnOrderAvanzado').click();
        await new Promise((r) => setTimeout(r, 400));
        cb.scrollTop = 0;
        const trasDeslizar = [];
        for (const id of bajoPie) { g(id).scrollIntoView({ block: 'center' }); await new Promise((r2) => setTimeout(r2, 200)); trasDeslizar.push(id + ':' + pisa(g(id))); }
        cb.scrollTop = 0;
        const vuelta = { aria: g('btnOrderAvanzado').getAttribute('aria-expanded'), oculto: !g('orderAvanzado').offsetParent,
                         caja: Math.round(g('chartWrap').getBoundingClientRect().height), sy: Math.round(window.scrollY),
                         hitos: esenciales.map((id) => pisa(g(id))), recorte: recorte(), trasDeslizar,
                         desborda: g('orderCard').classList.contains('desborda'),
                         st: window.ST && ST.get('ordenAvanzado', null) };
        return { antes, despues, vuelta };
      });
      /* Aquí la app viene del bloque anterior en modo «Límite» (su fila de precio y sus
         siete atajos: ~54 px más), así que el formulario NO cabe en los 221 px de caja.
         No se pide que quepa: se pide que lo ESENCIAL esté arriba sin deslizar y que si
         algo queda debajo, la tarjeta lo avise (su deslizador + el degradado del pie). */
      ok(AV.antes.hitos.every((x) => x === 'si') && AV.antes.aria === 'false' && AV.antes.oculto
         && (AV.antes.recorte <= 1 ? AV.antes.desborda === false : AV.antes.desborda === true),
         `${etiqueta}: con el formulario plegado se puede pulsar TODO lo esencial sin deslizar y el pie avisa solo cuando hace falta (${AV.antes.hitos.join(' ')} · recorte ${AV.antes.recorte}, aviso ${AV.antes.desborda} · doc ${AV.antes.docH}/${AV.antes.vh})`);
      ok(AV.antes.head >= 22, `${etiqueta}: la cabecera de la tarjeta no se aplasta (${AV.antes.head} px) —es el flex de la franja, que antes la dejaba en 19—`);
      ok(AV.despues.visible && AV.despues.aria === 'true' && AV.despues.sl.startsWith('foco/si/'),
         `${etiqueta}: al abrir «Avanzado», el stop loss se ve, se enfoca y se escribe (${AV.despues.sl})`);
      ok(AV.despues.solape === 0 && AV.despues.caja === AV.despues.fila && AV.despues.caja === G.chart,
         `${etiqueta}: abrir no le quita un píxel al gráfico (${AV.despues.caja} == fila ${AV.despues.fila} == los ${G.chart} de antes) y no pinta sobre la escalera`);
      ok(AV.despues.recorte >= 80 && AV.despues.desborda === true,
         `${etiqueta}: lo que no cabe se alcanza deslizando la tarjeta (${AV.despues.recorte} px, con el aviso del pie)`);
      ok(AV.vuelta.oculto && AV.vuelta.aria === 'false' && AV.vuelta.st === false && AV.vuelta.recorte === AV.antes.recorte && AV.vuelta.hitos.every((x) => x === 'si') && AV.vuelta.trasDeslizar.every((x) => x.endsWith(':si')),
         `${etiqueta}: cerrar devuelve el estado anterior de verdad (aria ${AV.vuelta.aria}, ST ${AV.vuelta.st}, recorte ${AV.vuelta.recorte} = ${AV.antes.recorte}, ${AV.vuelta.hitos.join(' ')})`);
      ok(AV.vuelta.caja === G.chart, `${etiqueta}: y el gráfico recupera píxel a píxel lo que tenía antes de abrir (${AV.vuelta.caja} == ${G.chart})`);
    }
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
