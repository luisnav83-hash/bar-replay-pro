/* =========================================================================
 * responsive.test.js — La app debe ser usable en CUALQUIER tamaño de panel:
 * sin recortes, sin solapes y con los controles de replay siempre a la vista.
 *
 * Se prueba el PEOR CASO: el archivo único (modo visor, sin red) con DOS
 * paneles de indicadores abiertos (RSI + MACD), que es lo que más espacio
 * consume por debajo del gráfico.
 *
 * No necesita servidor: abre bar-replay-pro-unico.html con file://
 * Uso:  node tests/responsive.test.js
 * =======================================================================*/
'use strict';

const path = require('path');
const puppeteer = require((process.env.PPTR_PATH || '/home/user/.cache/pptr/node_modules/puppeteer'));

const TAMANOS = [
  [1680, 950], [1400, 900], [1280, 800], [1100, 820],
  [1000, 780], [900, 700], [1400, 560], [1600, 880], [1440, 760], [480, 900],
];

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
  page.on('pageerror', (e) => { fallan++; console.log('  ✗ error de JS: ' + e.message); });

  // Sin red: exactamente como dentro del visor
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.abort('failed');
  });

  const FILE = 'file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html').replace(/\\/g, '/');
  console.log('\n▸ Abriendo el archivo único sin red (peor caso: RSI + MACD abiertos)');
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.evaluate(() => {
    App.indicators.rsi.on = true; App.indicators.macd.on = true;
    App.applyIndicators(App.indicators, true);
  });
  await wait(400);

  console.log('\n▸ Tamaños de panel (gráfico · solape con la barra de replay · desbordes)');
  for (const [w, h] of TAMANOS) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await wait(450);
    const m = await page.evaluate(() => {
      const R = (id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect() : null; };
      const wrap = R('chartWrap'), rp = R('replayBar'), ws = R('workspace'), ca = R('chartArea');
      const pa0 = R('paneArea');
      const ind = [...document.querySelectorAll('.indPane')].filter((e) => e.offsetHeight > 0);
      const panes = ind.map((e) => e.getBoundingClientRect());
      /* El último panel puede sobresalir de la caja de `#paneArea` A PROPÓSITO (en el
         teléfono la escalera se desplaza en vertical). Un `getBoundingClientRect()` de un
         hijo desbordado sigue midiendo fuera, pero ahí no se pinta nada: lo que importa es
         lo que se ve, así que el borde de abajo se toma de la caja que recorta. Sin esto,
         el contrato «los paneles no tapan la barra de replay» daba rojo por un píxel
         invisible — y bajarlo habría sido tapar el defecto, no arreglarlo. */
      const recorte = pa0 ? pa0.bottom : Infinity;
      const paneBottom = panes.length ? Math.max(...panes.map((x) => Math.min(x.bottom, recorte))) : 0;
      const play = R('btnPlay');
      return {
        chart: Math.round(wrap.height), panes: panes.length,
        fila: Math.round(parseFloat(getComputedStyle(document.getElementById('chartArea')).gridTemplateRows.split(' ')[1] || '0')),
        sobrePaneles: Math.max(0, Math.round(wrap.bottom - (R('paneArea') || { bottom: wrap.bottom }).bottom)),
        solape: paneBottom > rp.top + 2 ? Math.round(paneBottom - rp.top) : 0,
        // La caja de la escalera, en cambio, SÍ tiene que quedar por encima del replay.
        areaFuera: pa0 ? Math.max(0, Math.round(pa0.bottom - rp.top)) : 0,
        scrolleaArea: pa0 ? pa0.scrollHeight > pa0.clientHeight + 2 : false,
        // Lo que de verdad pinta cada panel de indicador (su canvas).
        huecoMin: ind.length ? Math.min(...ind.map((e) => {
          const cv = e.querySelector('canvas'); return cv ? Math.round(cv.getBoundingClientRect().height) : 999;
        })) : 999,
        // El eje de tiempo: ni duplicado (principal + panel) ni perdido.
        /* Dónde se PINTA el eje, medido en el lienzo —no preguntando a la librería, que en
           v4 no expone `timeScale().getOptions()`: lo que pregunta por la opción devolvía
           `undefined` y el recuento de ejes salía 0 (fue el primer intento de este
           assert). La franja que le falta al canvas dentro de su contenedor ES el eje. */
        eje: (() => {
          const franja = (cont, sel) => {
            const c = document.getElementById(cont) || document.querySelector(sel);
            if (!c) return -1;
            const cv = c.tagName === 'CANVAS' ? c : c.querySelector('canvas');
            if (!cv) return -1;
            return Math.round(c.getBoundingClientRect().height - cv.getBoundingClientRect().height);
          };
          const f = { principal: franja('chartWrap', null), rsi: franja('chartRsi'), macd: franja('chartMacd'), atr: franja('chartAtr') };
          const conEje = Object.keys(f).filter((k) => f[k] >= 10);
          return { en: (window.CM && CM._ejeEn) || '?', hueco: (window.CM && CM._ejeHueco) || 0,
                   conEje, franja: f, visibles: conEje.length };
        })(),
        ovx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        recorteInterno: Math.round(Math.max(0, ca.bottom - ws.bottom)) + Math.round(Math.max(0, ws.bottom - R('bottomPanel').top)),
        sliderEscala: (() => { const r = document.getElementById('progressRange');
          return r ? [ +r.min, +r.max, Math.round(+r.value) ] : null; })(),
        sliderCoherente: (() => { const r = document.getElementById('progressRange');
          return r && window.BR ? Math.abs(+r.value - Math.round(BR.progressTotal() * 1000)) : -1; })(),
        playVisible: play.width > 0 && play.top >= 0 && play.bottom <= window.innerHeight + 2,
      };
    });
    /* QUÉ SE PROMETE AQUÍ, y por qué no es «200 px siempre». Este bloque abre RSI + MACD
       ANTES de medir —es el PEOR caso de la escalera—, y en un panel de 780 px de alto
       con tres paneles no hay 200 px de velas sin robarle el sitio al formulario de
       órdenes o a las tarjetas del registro (medido con los 240 px de `min-height` del
       gráfico: se pintaban 66 px ENCIMA de sus propios paneles; ver PC.comprimeEscalera).
       Lo que este contrato sí exige, y es lo que deja la app usable, es geométrico: la
       caja del gráfico mide lo que hay (caja == fila), 0 px pintados sobre la escalera y
       al menos el suelo duro de 120 px. La promesa numérica de «≥200 px de alto útil»
       vive donde se mide con la escalera por defecto (un solo panel de indicadores):
       tests/browser.capture.js, en 480×900, y en el bloque de la barra superior de abajo
       (390×844 con el andamio compactado: 190 px medidos de gráfico). */
    const etiqueta = `${w}×${h}`;
    ok(m.chart >= 120 && m.chart === m.fila, `${etiqueta}: el gráfico conserva ${m.chart}px en el PEOR caso de escalera (fila ${m.fila}px, suelo 120px)`);
    ok(m.solape === 0 && m.areaFuera === 0, `${etiqueta}: los paneles de indicadores no tapan la barra de replay (${m.scrolleaArea ? 'el último desborda su caja y se desplaza —recortado, no pintado—' : 'sin desbordar'})`);
    ok(m.huecoMin >= 12, `${etiqueta}: ningún panel de indicadores pinta en menos de ${m.huecoMin} px de gráfico (el hueco mínimo exigido es 12; el defecto arreglado era 2 px)`);
    ok(m.eje.visibles === 1 && m.eje.conEje[0] === m.eje.en
       && (m.eje.en === 'principal' ? m.eje.hueco < 48 : m.eje.hueco >= 48),
       `${etiqueta}: el eje de tiempo se pinta una sola vez y en «${m.eje.en}» (franja de ${m.eje.franja[m.eje.conEje[0]]} px; el panel de abajo tiene ${m.eje.hueco} px de hueco, umbral 48 — con menos, el panel se queda sin gráfico: era el defecto)`);
    ok(m.sobrePaneles === 0, `${etiqueta}: y el gráfico no pinta encima de los paneles de indicadores (${m.sobrePaneles}px)`);
    ok(m.ovx === 0, `${etiqueta}: sin desbordamiento horizontal (${m.ovx}px)`);
    ok(m.recorteInterno === 0, `${etiqueta}: nada se recorta entre el gráfico y el panel inferior`);
    ok(m.playVisible, `${etiqueta}: el botón PLAY es visible sin desplazar`);
    /* La escala del `<input>` de posición: el código escribe `fracción*1000` y divide por
       1000, así que con `max="100"` (como estaba) el navegador clampaba el valor —la perilla
       vivía pegada a la derecha desde la primera vela y el arrastre no pasaba del 10 % del
       histórico—. Se comprueba el tope Y que el valor pintado sea el que pide el replay. */
    ok(m.sliderEscala && m.sliderEscala[0] === 0 && m.sliderEscala[1] >= 1000
       && m.sliderCoherente >= 0 && m.sliderCoherente <= 10,
       `${etiqueta}: el deslizador de posición habla la escala del código (0..${m.sliderEscala ? m.sliderEscala[1] : '?'};`
       + ` valor ${m.sliderEscala ? m.sliderEscala[2] : '?'} a ${m.sliderCoherente} del que pide el replay)`);
  }

  /* ═══════════ LA BARRA SUPERIOR DEL TELÉFONO: 135 → 90 px, y al gráfico ═══════════
     Con el formulario de órdenes ya compactado, lo único que separaba al gráfico de
     200 px en el teléfono era el andamio de arriba: 38 (marca + iconos) + 51 (par,
     temporalidad, fechas, DEMO) + 36 (estadísticas 24 h) + 10 de padding = 135 px.
     Se aprieta sin ocultar nada, así que lo que hay que comprobar es doble: que la barra
     mide lo prometido y que NINGÚN dato se perdió por el camino (ni un «máx 72,966 ·
     mín 68,39…» con el número cortado a ellipsis, ni un botón que se quede fuera del
     deslizador sin forma de llegar a él). */
  console.log('\n▸ La barra superior del teléfono (andamio que come altura)');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await wait(500);
  /* La escalera vuelve a su estado POR DEFECTO antes de mirar el gráfico: lo que se
     juzga aquí es el andamio, y con RSI + MACD abiertos (el peor caso del bucle de
     arriba) el alto del lienzo lo fija el mínimo de los paneles, no la barra —ahí la
     ganancia se la comen los paneles y la medida no diría nada—. */
  await page.evaluate(() => {
    App.indicators.macd.on = false; App.indicators.rsi.on = false;
    App.applyIndicators(App.indicators, true);
  });
  await wait(450);
  const TB = await page.evaluate(async () => {
    const g = (id) => document.getElementById(id);
    const pisa = (e) => { const q = e.getBoundingClientRect();
      const c = document.elementFromPoint(Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2));
      return (c === e || e.contains(c) || (c && c.contains(e))) ? 'si' : 'no'; };
    const tb = g('topbar'), q = tb.getBoundingClientRect();
    const fila = (i) => Math.round(parseFloat(getComputedStyle(tb).gridTemplateRows.split(' ')[i] || '0'));
    const grupo = tb.querySelector('.topbar-group');
    const tfActivo = g('tfQuick').querySelector('.tf-btn.active');
    const sinCorte = [...g('bfStats').children].every((c) =>
      [...c.querySelectorAll('.bf-k, .bf-v, .bf-sub, .bf-bar')].every((k) => k.scrollWidth <= k.clientWidth + 1));
    const textoFuera = [...g('bfStats').children].filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.id || c.className);
    const rect = (e) => ({ t: Math.round(e.getBoundingClientRect().top), b: Math.round(e.getBoundingClientRect().bottom) });
    return {
      alto: Math.round(q.height), filas: [fila(0), fila(1), fila(2)], stats: Math.round(g('bfStats').getBoundingClientRect().height),
      marca: Math.round(tb.querySelector('.brand').getBoundingClientRect().height),
      iconos: [...tb.querySelectorAll('.topbar-right button')].map((e) => Math.round(e.getBoundingClientRect().height)),
      scrolleaStats: g('bfStats').scrollWidth > g('bfStats').clientWidth + 2,
      scrolleaGrupo: grupo.scrollWidth > grupo.clientWidth + 2,
      anchoGrupo: [grupo.scrollWidth, grupo.clientWidth],
      sinCorte, textoFuera,
      // Fila 1 y 2 no se pisan, y las estadísticas empiezan por debajo del grupo del par.
      pisaStats: rect(g('bfStats')).t >= rect(g('tfQuick')).b - 2,
      pisaMarca: pisa(tb.querySelector('.brand-name')) === 'si' || pisa(g('btnIndicators')) === 'si',
      par: pisa(g('btnSymbols')),
      demoAntes: pisa(g('btnDemo')),
      tfAntes: pisa(tfActivo),
      tfTrasSwipe: (tfActivo.scrollIntoView({ inline: 'center', block: 'nearest' }), await new Promise((r) => setTimeout(() => r(pisa(tfActivo)), 240))),
      demoTrasSwipe: (g('btnDemo').scrollIntoView({ inline: 'center', block: 'nearest' }), await new Promise((r) => setTimeout(() => r(pisa(g('btnDemo'))), 240))),
      /* Y la fila del par vuelve a su principio: los `scrollIntoView` de arriba dejan el
         deslizador en el extremo derecho, y esta suite captura las pantallas después —una
         galería con «...argar datos» cortado a la izquierda no enseña nada—. */
      devuelta: (grupo.scrollLeft = 0, g('bfStats').scrollLeft = 0, Math.round(grupo.scrollLeft)),
      chart: Math.round(g('chartWrap').getBoundingClientRect().height),
      filaChart: Math.round(parseFloat(getComputedStyle(g('chartArea')).gridTemplateRows.split(' ')[1] || '0')),
      solape: Math.max(0, Math.round(g('chartWrap').getBoundingClientRect().bottom - g('paneArea').getBoundingClientRect().top)),
      ovx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      docH: document.documentElement.scrollHeight, vh: window.innerHeight,
    };
  });
  ok(TB.alto <= 96 && TB.stats <= 26 && TB.marca <= 30,
     `la barra del teléfono pasa de 135 a ${TB.alto} px (filas ${TB.filas.join('/')} · marca ${TB.marca} · estadísticas ${TB.stats})`);
  ok(TB.chart >= 180 && TB.chart === TB.filaChart && TB.solape === 0,
     `y esos píxeles son del gráfico: ${TB.chart} px de fila ${TB.filaChart} con la escalera por defecto (antes 189, y 43 al empezar el trabajo del móvil), solape ${TB.solape}`);
  ok(TB.iconos.every((h) => h >= 20) && TB.par === 'si',
     `la marca y los iconos siguen siendo diana (${TB.iconos.join('/')} px) y el botón del par se puede pulsar (${TB.par})`);
  ok(TB.sinCorte && TB.textoFuera.length === 0,
     `ningún dato de las 24 h se corta con ellipsis${TB.textoFuera.length ? ' (' + TB.textoFuera.join(', ') + ')' : ''} —los chips piden su ancho y la fila desliza (${TB.scrolleaStats ? 'sí' : 'no'})—`);
  ok(TB.scrolleaGrupo && TB.anchoGrupo[0] > TB.anchoGrupo[1],
     `la fila del par no esconde nada: desliza en horizontal (${TB.anchoGrupo[0]} px de contenido en ${TB.anchoGrupo[1]})`);
  ok(TB.devuelta === 0 && TB.tfTrasSwipe === 'si' && TB.demoTrasSwipe === 'si',
     `y tras deslizarla se alcanza la temporalidad activa y el botón DEMO (tf ${TB.tfAntes}→${TB.tfTrasSwipe}, demo ${TB.demoAntes}→${TB.demoTrasSwipe})`);
  ok(TB.pisaStats && TB.ovx === 0 && TB.docH === TB.vh,
     `las tres filas no se pisan (estadísticas bajo el grupo del par), el documento no desliza (${TB.docH} = ${TB.vh}) y no hay scroll horizontal (${TB.ovx}px)`);

  /* ═══════════ «AVANZADO» del formulario en el teléfono (390×844) ═══════════
     Mide el plegado de verdad: lo esencial cabe y se puede pulsar SIN scroll, y lo
     guardado detrás del botón aparece al abrir (con el documento deslizando, nunca con
     controles bajo el borde de la franja). El motivo es medido: el cuerpo del formulario
     pedía 510 px dentro de 214 de caja, y once controles vivían fuera del recorte. */
  console.log('\n▸ «Avanzado» del panel de órdenes en el teléfono');
  // Se vuelve a la escalera POR DEFECTO (un solo panel de indicadores): las filas del
  // formulario y las del gráfico se miden aquí sobre lo que ve la persona al abrir la
  // app, no sobre el peor caso de arriba —que tiene su propio contrato geométrico—.
  await page.evaluate(() => {
    App.indicators.macd.on = false; App.indicators.rsi.on = false;
    App.applyIndicators(App.indicators, true);
    // Y al tipo de orden POR DEFECTO (Mercado): las secciones de arriba dejan la app en
    // «Límite», que añade su fila de precio y sus siete atajos (53 px más). No es un
    // adorno: así lo que se mide aquí es el formulario que ve quien abre la app.
    document.querySelector('#segOrderType [data-otype="market"]').click();
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await wait(600);
  const AV = await page.evaluate(async () => {
    const g = (id) => document.getElementById(id);
    const pisa = (e) => { if (!e || e.offsetParent === null) return 'oculto';
      const q = e.getBoundingClientRect(); const c = document.elementFromPoint(Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2));
      return (c === e || e.contains(c) || (c && c.contains(e))) ? 'si' : 'no'; };
    const esenciales = ['segOrderType', 'segSize', 'sizeInput', 'btnLong', 'btnShort', 'btnFlatten'];
    /* `#feeInput` NO está en la lista a propósito: es el control HEREDADO del tema
       anterior, que sigue en el DOM porque `UI.syncLeverage` y varias suites lo usan como
       fuente de verdad del apalancamiento, pero va dentro de un `.visually-hidden` y está
       fuera del recorte por diseño (su centro mide x = −11 px). Lo que se comprueba aquí
       es lo que la persona ve y toca: los precios de SL/TP y los atajos de % . */
    const avanzados = ['slInput', 'tpInput'];
    const geo = () => ({
      area: Math.round(g('chartArea').getBoundingClientRect().height),
      fila: Math.round(parseFloat(getComputedStyle(g('chartArea')).gridTemplateRows.split(' ')[1])),
      caja: Math.round(g('chartWrap').getBoundingClientRect().height),
      solape: Math.max(0, Math.round(g('chartWrap').getBoundingClientRect().bottom - g('paneArea').getBoundingClientRect().top)),
      franja: Math.round(g('sidebar').getBoundingClientRect().height),
      docH: document.documentElement.scrollHeight, vh: window.innerHeight,
      head: Math.round(g('orderCard').querySelector('.card-head').getBoundingClientRect().height),
      filas: [...g('orderCard').querySelector('.card-body').children].map((e) => Math.round(e.getBoundingClientRect().height)),
      // Lo que la tarjeta tiene que deslizar por dentro y si su pie avisa de ello.
      recorte: (() => { const cb = g('orderCard').querySelector('.card-body'); return Math.round(cb.scrollHeight - cb.clientHeight); })(),
      desborda: g('orderCard').classList.contains('desborda'),
    });
    const cerrado = { ...geo(), aria: g('btnOrderAvanzado').getAttribute('aria-expanded'),
                      adv: g('orderAvanzado').offsetParent !== null,
                      hitos: esenciales.map((id) => pisa(g(id))), ocultos: avanzados.map((id) => pisa(g(id))) };
    g('btnOrderAvanzado').click();
    await new Promise((r) => setTimeout(r, 420));
    const abierto = { ...geo(), aria: g('btnOrderAvanzado').getAttribute('aria-expanded'),
                      adv: g('orderAvanzado').offsetParent !== null,
                      hitos: esenciales.concat(avanzados).map((id) => pisa(g(id))),
                      st: window.ST && ST.get('ordenAvanzado', null) };
    // Y la prueba de verdad, no la geométrica: con el panel abierto, cada campo de
    // SL/TP se enfoca CON CLIC y escribe (si estuviera bajo un recorte, el foco se
    // quedaría en el body y el valor no entraría).
    abierto.escritos = [];
    for (const id of avanzados) {
      const e = g(id);
      e.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 200));
      const q = e.getBoundingClientRect();
      const cx = Math.round(q.left + q.width / 2), cy = Math.round(q.top + q.height / 2);
      const bajo = pisa(e);
      if (id === 'slInput') {
        // Caida de la fila de dos columnas: cada campo tiene que caber EN la tarjeta.
        // (Con `1fr` y etiquetas en línea, Take Profit se iba a x 303..601 dentro de una
        // caja de 379 px: fuera, y el `scrollIntoView` lo tapaba desplazando la tarjeta.)
        const caja = g('orderCard').querySelector('.card-body').getBoundingClientRect();
        const cuerpo2 = g('orderCard').querySelector('.card-body');
        abierto.desbordeX = Math.round(cuerpo2.scrollWidth - cuerpo2.clientWidth);
        abierto.dentroTp = (() => { const q = g('tpInput').closest('.field').getBoundingClientRect();
          return { l: Math.round(q.left - caja.left), r: Math.round(q.right - caja.left), caja: Math.round(caja.width) }; })();
          
        // Además del campo: la fila de la comisión no puede dejar media fila en negro
        // (el `select` heredado, oculto, ocupaba su columna de rejilla de 1fr).
        const cb2 = g('orderCard').querySelector('.card-body');
        const fee = g('orderCard').querySelector('.bf-fee-row .field:not(.visually-hidden)');
        abierto.anchoFee = Math.round(fee.getBoundingClientRect().width);
        abierto.anchoCaja = Math.round(cb2.clientWidth);
      }
      e.focus(); e.value = id === 'slInput' ? '70000' : '80000';
      e.dispatchEvent(new Event('input', { bubbles: true }));
      abierto.escritos.push(id + ':' + (document.activeElement === e ? 'foco' : 'SIN FOCO') + '/' + (bajo === 'si' ? 'visible' : bajo) + '/' + e.value);
    }
    g('btnOrderAvanzado').click();
    await new Promise((r) => setTimeout(r, 420));
    const deVuelta = { ...geo(), aria: g('btnOrderAvanzado').getAttribute('aria-expanded'),
                       adv: g('orderAvanzado').offsetParent !== null,
                       st: window.ST && ST.get('ordenAvanzado', null), sy: Math.round(window.scrollY) };
    return { cerrado, abierto, deVuelta };
  });

  ok(AV.cerrado.hitos.every((x) => x === 'si'),
     `cerrado, lo esencial se puede pulsar sin desplazarse (${AV.cerrado.hitos.join(' ')})`);
  ok(!AV.cerrado.adv && AV.cerrado.ocultos.every((x) => x === 'oculto') && AV.cerrado.aria === 'false',
     `y lo avanzado está plegado de verdad (ocultos: ${AV.cerrado.ocultos.join(' ')}, aria-expanded=${AV.cerrado.aria})`);
  ok(AV.cerrado.docH === AV.cerrado.vh && AV.cerrado.recorte <= 1 && AV.cerrado.desborda === false,
     `en reposo no hay que deslizar NADA: ni la página (${AV.cerrado.docH} = ${AV.cerrado.vh} px) ni la tarjeta (recorte ${AV.cerrado.recorte} px, aviso de desborde ${AV.cerrado.desborda})`);
  ok(AV.cerrado.fila >= 140 && AV.cerrado.caja === AV.cerrado.fila && AV.cerrado.solape === 0,
     `con el formulario plegado el gráfico tiene ${AV.cerrado.fila} px honestos (caja ${AV.cerrado.caja}, solape ${AV.cerrado.solape})`);
  ok(AV.cerrado.head >= 22 && AV.cerrado.filas.every((h) => h === 0 || h >= 18),
     `ninguna fila del formulario se aplasta (cabecera ${AV.cerrado.head} px; filas ${AV.cerrado.filas.join('/')}) —el flex de la tarjeta lo hacía antes a 19 px—`);
  ok(AV.abierto.adv && AV.abierto.aria === 'true' && AV.abierto.st === true,
     `un toque lo abre (aria-expanded=${AV.abierto.aria}) y se recuerda (ST «ordenAvanzado» = ${AV.abierto.st})`);
  /* Lo importante del diseño, medido: abrir «Avanzado» NO le quita un píxel al gráfico
     (la franja está topada y es la TARJETA la que desliza por dentro), no queda nada
     recortado sin señal (el pie avisa) y la escalera sigue sin solaparse. La versión
     anterior de este arreglo destopaba la franja y dejaba deslizar la página: los mismo
     108 px se le robaban al gráfico (medido: fila 144 → 209 del área, pero con la
     página entera desplazándose y el registro empujado fuera). */
  /* La franja está topada, así que abrir no toca el alto del gráfico: se permite ±2 px
     porque el toggle re-ejecuta el reparto de la escalera (PC.ajustaEscalera) y el redondeo
     de `1fr` puede mover un píxel de la fila del gráfico a los paneles. Lo que no se
     consiente es que ABRIR LE ROBE ALTURA al gráfico, que era el defecto de la versión
     anterior de este arreglo (la franja se destopaba y el área perdía ~40 px). El tope de
     250 px de la franja se comprueba contra el MÁXIMO, no contra sí mismo: en reposo la
     franja mide 249 (lo que pide la tarjeta del libro) y con el bloque abierto pasa a
     250 exactos —un píxel del contenido, no del gráfico—. */
  ok(Math.max(AV.abierto.franja, AV.cerrado.franja) <= 250 && Math.abs(AV.abierto.fila - AV.cerrado.fila) <= 2 && AV.abierto.fila >= AV.cerrado.fila - 1,
     `abrir «Avanzado» no le roba altura al gráfico (${AV.abierto.fila} px abierto vs ${AV.cerrado.fila} cerrado) ni a la franja su tope (${AV.cerrado.franja} → ${AV.abierto.franja}, máximo 250)`);
  ok(AV.abierto.solape === 0 && AV.abierto.caja === AV.abierto.fila,
     `y el gráfico sigue sin pintar sobre la escalera (caja ${AV.abierto.caja} == fila ${AV.abierto.fila}, solape ${AV.abierto.solape})`);
  ok(AV.abierto.desbordeX <= 1 && AV.abierto.dentroTp.r <= AV.abierto.dentroTp.caja + 1,
     `ninguna fila se sale de la tarjeta por la derecha (desborde horizontal ${AV.abierto.desbordeX} px; campo TP de ${AV.abierto.dentroTp.l} a ${AV.abierto.dentroTp.r} en ${AV.abierto.dentroTp.caja} px de caja)`);
  ok(AV.abierto.anchoFee >= AV.abierto.anchoCaja * 0.8,
     `la fila de la comisión ocupa la fila entera (${AV.abierto.anchoFee} px de ${AV.abierto.anchoCaja}) en vez de media rejilla por culpa del control heredado oculto`);
  ok(AV.abierto.recorte >= 80 && AV.abierto.desborda === true,
     `lo plegado sale deslizando la propia tarjeta (${AV.abierto.recorte} px por debajo del pie, con su aviso) —no bajo un recorte mudo—`);
  ok(AV.abierto.escritos.every((x) => x.includes('foco/visible') && /\/(\d{5})$/.test(x) && x.split('/').pop().length === 5),
     `con el panel abierto, SL y TP se enfocan, se ven y aceptan el número escrito (${AV.abierto.escritos.join(' · ')})`);
  ok(AV.deVuelta.adv === false && AV.deVuelta.aria === 'false' && AV.deVuelta.st === false
     && AV.deVuelta.sy === 0 && AV.deVuelta.recorte <= 1 && AV.deVuelta.desborda === false,
     `y se cierra como se abrió (aria ${AV.deVuelta.aria}, ST ${AV.deVuelta.st}, scroll ${AV.deVuelta.sy}, recorte ${AV.deVuelta.recorte})`);
  ok(AV.deVuelta.fila === AV.cerrado.fila && AV.deVuelta.caja === AV.deVuelta.fila,
     `el reparto vuelve exacto al estado cerrado (fila ${AV.deVuelta.fila} = ${AV.cerrado.fila})`);

  /* ═══════════ LA BARRA DE REPLAY EN EL TELÉFONO: QUE TODO SE VEA Y SE PUEDA PULSAR ═══════════
     Medido antes de tocar (390×844 sobre el archivo único): la barra medía 38 px con 795 px
     de contenido en 389 de caja; el deslizador de posición empezaba en x 458 —fuera de la
     barra— y su caja tenía 4 px de alto. Y no era soloen vertical: `chart.css` ponía el bloque de
     progreso en columna (`.rb-progress{flex-direction:column}`) y `responsive.css`, al
     envolver la barra (`flex-wrap:wrap`), mandaba la línea de información (hora, contador,
     estado) a una segunda línea que caía FUERA por debajo del borde de una barra de 34 px,
     sin scroll vertical: en un móvil la posición del replay nunca se había visto.
     Se reordena (transporte · posición · velocidades), se aprieta y se desactivan los
     duplicados; aquí se comprueba la geometría, que la cola deslizable sea alcanzable y —el
     bug que salió en el camino, también en escritorio— que la escala del `<input>` sea la del
     código. */
  console.log('\\n▸ La barra de replay del teléfono (390×844)');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await wait(420);
  const RB = await page.evaluate(async () => {
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const g = (id) => document.getElementById(id);
    const app = window.App || window.__BR_APP__;
    const barra = g('replayBar');
    const R = (e) => { const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const q = R(barra);
    // Cortado = sale del alto de la barra (el defecto que nadie veía); fuera = del ancho.
    const cortado = (e) => { const r = R(e); return r.h > 0 && (r.b > q.b + 0.5 || r.t < q.t - 0.5); };
    const fuera = (e) => { const r = R(e); return r.r > q.r + 0.5 || r.l < q.l - 0.5; };
    const pisa = (e) => { const b = R(e); if (b.h <= 0) return 'oculto';
      const el = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
      return el && (e === el || e.contains(el) || el.contains(e)) ? 'si' : 'no'; };
    const nombre = (e) => e.id || (e.classList.contains('speed-btn') ? 'vel ' + e.textContent.trim() : String(e.className));
    const controles = [...barra.querySelectorAll('button, input, .rb-chip, .rb-status')];
    const chips = [...barra.querySelectorAll('.speed-btn')];
    const slider = g('progressRange');
    const linea = ['pbIndex', 'pbStatus'].map((id) => ({ id, alto: Math.round(R(g(id)).h),
      cortado: cortado(g(id)), fuera: fuera(g(id)), pisa: pisa(g(id)) }));
    const botones = [...barra.querySelectorAll('.rb-buttons .rb-btn')].map((e) => ({ id: e.id, alto: Math.round(R(e).h), pisa: pisa(e) }));
    // Cola deslizable: cada chip tiene que ser pulsable EN ALGUNA posición del swipe.
    const deslizable = getComputedStyle(barra).overflowX === 'auto';
    const max = barra.scrollWidth - barra.clientWidth;
    const alcanzable = chips.map(() => false);
    for (let k = 0; k < chips.length; k++) if (pisa(chips[k]) === 'si') alcanzable[k] = true;
    if (deslizable && max > 0) {
      for (let p = 0.2; p <= 1.001; p += 0.2) {
        barra.scrollLeft = max * p; await esperar(80);
        chips.forEach((e, k) => { if (pisa(e) === 'si') alcanzable[k] = true; });
      }
    }
    barra.scrollLeft = 0;   // se deja como estaba: esta suite toma capturas justo después
    const inalcanzables = chips.filter((e, k) => !alcanzable[k]).map((e) => e.textContent.trim());
    // Función, no solo forma: ida y vuelta del deslizador contra el índice del replay.
    const escala = { min: +slider.min, max: +slider.max };
    let ida = null, vuelta = null;
    if (window.BR && app && app.candles && app.candles.length > 4) {
      const n = app.candles.length;
      BR.seek(Math.round(n * 0.7)); await esperar(220);
      ida = { idx: Math.round((BR.getIndex() + 1) / n * 100), valor: Math.round(+slider.value) };
      slider.value = '500'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      await esperar(220);
      vuelta = { idx: Math.round((BR.getIndex() + 1) / n * 100) };
      BR.seek(Math.round(n * 0.2)); await esperar(120);
    }
    // La perilla tiene que SEGUIR al replay aunque el deslizador tenga el foco (el guard
    // viejo era `document.activeElement !== slider`: enfocado, se congelaba ahí).
    let sigue = null;
    if (window.BR && app && app.candles && app.candles.length > 4) {
      slider.focus();
      App.stepForward(); App.stepForward();
      await esperar(260);
      sigue = { foco: document.activeElement && document.activeElement.id,
                valor: Math.round(+slider.value), pide: Math.round(BR.progressTotal() * 1000) };
      slider.blur();
    }
    return { alto: Math.round(q.h), caja: (() => { const r = slider.getBoundingClientRect();
             return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }; })(), sigue,
      sc: [barra.scrollWidth, barra.clientWidth], deslizable,
      altoSlider: Math.round(R(slider).h), pisaSlider: pisa(slider), linea, botones,
      vertical: controles.filter(cortado).map(nombre), fueraLinea: linea.filter((l) => l.fuera).length,
      inalcanzables, escala, ida, vuelta };
  });
  ok(RB.alto === 34 && RB.altoSlider >= 20 && RB.pisaSlider === 'si',
     `la barra del teléfono mide ${RB.alto} px y su deslizador de posición tiene ${RB.altoSlider} px de caja y se puede pulsar (antes: 38 px de barra, deslizador fuera en x 458 y caja de 4 px)`);
  ok(RB.vertical.length === 0,
     `ningún control sale cortado por los bordes horizontales de la barra${RB.vertical.length ? ' —' + RB.vertical.join(', ') + '—' : ''} (antes la línea de posición entera vivía bajo el borde inferior, sin scroll vertical donde buscarla)`);
  ok(RB.botones.length === 5 && RB.botones.every((b) => b.alto >= 24 && b.pisa === 'si'),
     `los 5 botones de transporte se ven y se pulsan sin deslizar nada (${RB.botones.map((b) => b.alto + 'px').join(' ')})`);
  ok(RB.linea.every((l) => l.alto > 0 && !l.cortado && !l.fuera && l.pisa === 'si') && RB.fueraLinea === 0,
     `y la línea de posición también: ${RB.linea.map((l) => l.id + ' ' + l.alto + 'px ' + l.pisa).join(' · ')} (contenedor de la barra en ${RB.sc[1]} px de caja)`);
  ok(RB.escala.min === 0 && RB.escala.max >= 1000,
     `el <input> de posición usa la escala del código (0..${RB.escala.max}): con el tope viejo de 100 el navegador clampaba el valor y la perilla se quedaba en el extremo desde la vela 1`);
  ok(!RB.ida || (RB.ida.valor >= 690 && RB.ida.valor <= 710 && RB.ida.idx >= 68 && RB.ida.idx <= 72),
     `poner el replay en la vela 70 % mueve la perilla a los ${RB.ida ? RB.ida.valor : '?'} puntos de 1000 (índice ${RB.ida ? RB.ida.idx : '?'} %)`);
  ok(!RB.vuelta || (RB.vuelta.idx >= 48 && RB.vuelta.idx <= 52),
     `y arrastrar la perilla al 50 % lleva el replay a la mitad del histórico (índice ${RB.vuelta ? RB.vuelta.idx : '?'} %) —antes 500 se leía 100 y el gesto no salía del 10 %`);
  ok(RB.sigue && RB.sigue.foco === 'progressRange' && Math.abs(RB.sigue.valor - RB.sigue.pide) <= 2,
     `la perilla sigue al replay con el deslizador enfocado (${RB.sigue ? RB.sigue.valor : '?'} puntos en el índice ${RB.sigue ? RB.sigue.pide : '?'} de 1000${RB.sigue && RB.sigue.foco ? ', foco puesto' : ''}) —con el guard por foco se quedaba congelada donde la dejaste`);
  /* Y el arrastre con puntero: mientras dura, el replay se para y nadie escribe el valor
     por encima del dedo; al soltar (o si el gesto se cancela, que en el teléfono pasa cada
     vez que el deslizamiento de la barra se queda con el gesto) se reanuda y se engancha. */
  const cajaSlider = { x: RB.caja.x + 8, y: RB.caja.y + RB.caja.h / 2 };
  const duranteArrastre = async () => page.evaluate(async () => {
    const r = document.getElementById('progressRange');
    const antes = Math.round(+r.value);
    App.stepForward(); App.stepForward();
    await new Promise((x) => setTimeout(x, 260));
    return { antes, despues: Math.round(+r.value), reproduciendo: BR.isPlaying(), arrastrando: !!UI._arrastrandoSlider };
  });
  await page.evaluate(() => { BR.play(); });
  await wait(160);
  await page.mouse.move(cajaSlider.x, cajaSlider.y);
  await page.mouse.down();
  const AD = await duranteArrastre();
  await page.mouse.up();
  await wait(200);
  const AL = await page.evaluate(() => ({ reproduciendo: BR.isPlaying(), arrastrando: !!UI._arrastrandoSlider,
    valor: Math.round(+document.getElementById('progressRange').value), pide: Math.round(BR.progressTotal() * 1000) }));
  // Segundo round: el gesto que la barra se come (pointercancel) no puede dejar el replay pillado.
  await page.mouse.move(cajaSlider.x, cajaSlider.y);
  await page.mouse.down();
  await page.evaluate(() => { document.getElementById('progressRange')
    .dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })); });
  await wait(200);
  const AC = await page.evaluate(() => ({ reproduciendo: BR.isPlaying(), arrastrando: !!UI._arrastrandoSlider }));
  await page.mouse.up();
  await page.evaluate(() => { BR.pause(); document.getElementById('replayBar').scrollLeft = 0; });
  ok(AD.reproduciendo === false && AD.arrastrando === true && AD.antes === AD.despues,
     `mientras arrastras la perilla el replay está parado y nadie le mueve el valor (${AD.antes} → ${AD.despues}, arrastrando ${AD.arrastrando ? 'sí' : 'no'})`);
  ok(AL.arrastrando === false && AL.reproduciendo === true && Math.abs(AL.valor - AL.pide) <= 3,
     `al soltar, el replay vuelve a sonar y la perilla se engancha a la posición real (${AL.valor} vs ${AL.pide} puntos de 1000)`);
  ok(AC.arrastrando === false && AC.reproduciendo === true,
     `y si el gesto se cancela —en el teléfono, cuando el deslizamiento de la barra se lo lleva— el replay no queda pillado en pausa (arrastrando ${AC.arrastrando}, reproduciendo ${AC.reproduciendo ? 'sí' : 'no'})`);
  ok(RB.inalcanzables.length === 0,
     RB.inalcanzables.length ? `detrás del swipe hay velocidades que no se alcanzan: ${RB.inalcanzables.join(' ')}`
       : `las velocidades que no caben (${RB.sc[0]} px de contenido en ${RB.sc[1]}) quedan a un gesto de la barra: todas se pulsan en algún punto del deslizamiento`);

  /* ═══════════ LA ESCALERA DE INDICADORES EN EL TELÉFONO ═══════════
     Medido antes de tocar (390×844, 414×896, 360×640): cada panel medía 44 px, la
     cabecera 24 y el eje de tiempo se pintaba DENTRO del panel de abajo, que se quedaba
     con 2 px de gráfico —el RSI y el MACD eran decorativos— (en escritorio tampoco se
     salvaba: 12 px a 1440×900 y 2 px a 1400×560 / 900×700). Dos cambios: el eje se pinta
     donde haya hueco (CM._reparteEje, umbral 48 px de contenedor) y los paneles pasan a
     58 px con la escalera topada a su fila de siempre, de modo que lo que sobre se
     desplaza en vez de comérselo el gráfico o la cabecera. Y la trampa que cazó el primer
     intento: `#paneArea` es `flex-direction:column`, así que con `max-height` los hijos
     ENCOGÍAN a 36 px (8 px de canvas) en lugar de desbordar —el arreglo fue
     `flex:0 0 auto`, el mismo que hizo falta en la barra de replay—. */
  console.log('\n▸ La escalera de indicadores en el teléfono (390×844)');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.evaluate(() => {
    App.indicators.rsi.on = true; App.indicators.macd.on = true;
    App.applyIndicators(App.indicators, true);
  });
  await wait(800);
  const ESC = await page.evaluate(async () => {
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const g = (id) => document.getElementById(id);
    const pa = g('paneArea');
    const R = (e) => { const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, t: r.top, b: r.bottom, l: r.left, r: r.right }; };
    const q = R(pa);
    const pisa = (e) => { const r = R(e); if (!r.h) return 'oculto';
      const el = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
      return el && (e === el || e.contains(el) || el.contains(e)) ? 'si' : 'no'; };
    const franja = (cont) => { const c = g(cont); if (!c) return -1;
      const cv = c.querySelector('canvas'); if (!cv) return -1;
      return Math.round(c.getBoundingClientRect().height - cv.getBoundingClientRect().height); };
    const paneles = [...pa.querySelectorAll('.indPane')].filter((e) => !e.classList.contains('hidden') && e.offsetHeight > 0)
      .map((e) => {
        const cont = e.querySelector('.pane-chart'), cv = e.querySelector('canvas'), x = e.querySelector('.pane-close');
        return { id: e.id, h: Math.round(R(e).h), inline: e.style.height || '—',
          head: Math.round(R(e.querySelector('.pane-head')).h),
          cont: cont ? Math.round(R(cont).h) : 0,
          canvas: cv ? Math.round(R(cv).h) : 0,
          recortado: R(e).b > q.b + 0.5, pisaCerrar: x ? pisa(x) : 'sin botón',
          // La cabecera: ¿una línea? ¿los valores enteros, sin ellipsis?
          headH: Math.round(R(e.querySelector('.pane-head')).h),
          headScroll: e.querySelector('.pane-head').scrollHeight,
          valCorte: (() => { const v = e.querySelector('.pane-val');
            return v ? v.scrollWidth - v.clientWidth : 0; })(),
          titleCorte: (() => { const v = e.querySelector('.pane-title');
            return v ? v.scrollWidth - v.clientWidth : 0; })() };
      });
    /* Cada botón ✕ tiene que ser pulsable en ALGÚN punto del deslizamiento —no en la foto
       de reposo, que es justo lo que el desplazamiento cambia: en reposo se ven el PnL y el
       RSI y el MACD queda debajo; al bajar, al revés—. Es el mismo contrato que se exigió a
       los chips de velocidad de la barra de replay, por el mismo motivo. */
    const max = pa.scrollHeight - pa.clientHeight;
    const visibles = [...pa.querySelectorAll('.indPane')].filter((e) => !e.classList.contains('hidden'));
    const alcanzable = visibles.map((e) => pisa(e.querySelector('.pane-close')) === 'si');
    for (let s = 0.25; s <= 1.001 && max > 0; s += 0.25) {
      pa.scrollTop = Math.round(max * s); await esperar(120);
      visibles.forEach((e, k) => { if (pisa(e.querySelector('.pane-close')) === 'si') alcanzable[k] = true; });
    }
    const alFinal = visibles.map((e) => pisa(e.querySelector('.pane-close')));
    const fueraAlFinal = visibles.filter((e) => { const r = R(e); return r.b > R(pa).b + 0.5 || r.t < R(pa).t - 0.5; }).map((e) => e.id);
    pa.scrollTop = 0; await esperar(120);
    const asa = g('pnlPaneResize'), wrap = g('chartWrap'), ca = g('chartArea');
    return { paneles, max, alto: Math.round(q.h), caja: pa.clientHeight, contenido: pa.scrollHeight,
      ov: getComputedStyle(pa).overflowY, scrollea: pa.scrollHeight > pa.clientHeight + 2,
      alFinal, fueraAlFinal, asa: asa ? Math.round(R(asa).h) : 0,
      chart: Math.round(R(wrap).h), fila: Math.round(parseFloat(getComputedStyle(ca).gridTemplateRows.split(' ')[1] || '0')),
      // OJO: el R() de arriba llama `t` y `b` a top y bottom —pedir `.top` daba NaN.
      area: Math.round(R(pa).h), areaBot: Math.round(R(pa).b), rpTop: Math.round(R(g('replayBar')).t),
      names: visibles.map((e) => e.id.replace('pane', '')), alcanzable,
      docH: document.documentElement.scrollHeight, vh: window.innerHeight,
      ovx: document.documentElement.scrollWidth - window.innerWidth,
      eje: { en: CM._ejeEn, hueco: CM._ejeHueco, principal: franja('chartWrap'), macd: franja('chartMacd'), rsi: franja('chartRsi') },
      debug: PC._debugComprime || null };
  });
  const ind = ESC.paneles.filter((p) => p.id !== 'panePnl');
  const pnl = ESC.paneles.find((p) => p.id === 'panePnl') || {};
  /* Los números de este bloque son LOS DEL CSS MEDIDO, y la banda del PnL es la misma que
     fija tests/pnl-chart.test.js (60-100): si alguien vuelve a tocar la escalera del
     teléfono, las dos suites se pisan y el reparto deja de ser arbitrario en una de ellas. */
  ok(ind.length === 2 && ind.every((p) => p.h >= 56 && p.canvas >= 30) && pnl.h >= 60 && pnl.h <= 100,
     `cada indicador del teléfono mide ${ind.map((p) => p.h + ' px de panel con ' + p.canvas + ' de gráfico').join(' y ')}, con el PnL a ${pnl.h} px —los dos caben en los 117 de la escalera sin recortar nada— (antes: 44 de panel y 2 px de velas, el indicador no se veía)`);
  ok(ind.every((p) => p.inline === '—') && ESC.debug && ESC.debug.apretados === 0,
     `y ese alto lo pone el CSS, no la compresión: sin \`style.height\` en los paneles y \`PC.comprimeEscalera\` informando ${ESC.debug ? ESC.debug.apretados : '?'} paneles apretados (en el teléfono la escalera se desplaza, no se aplasta)`);
  ok(ESC.chart === ESC.fila && ESC.chart >= 180 && ESC.alto <= 118 && ESC.rpTop >= ESC.areaBot - 1,
     `el gráfico no paga la escalera: ${ESC.chart} px de caja == fila ${ESC.fila}, la escalera topada a ${ESC.alto} px (termina en y ${ESC.areaBot}) y la barra de replay empieza justo debajo (y ${ESC.rpTop})`);
  ok(ESC.scrollea && ESC.ov === 'auto' && ESC.max > 0,
     `lo que no cabe de la escalera se desplaza por dentro: ${ESC.contenido} px de contenido en ${ESC.caja} de caja (desliza ${ESC.max} px), con overflow-y:auto`);
  ok(ESC.alcanzable.every((x) => x === true) && ESC.alFinal.concat(ESC.fueraAlFinal).length >= 0,
     `los ✕ de ${ESC.names.join(', ')} son pulsables en algún punto del deslizamiento (${ESC.alcanzable.map((x, k) => ESC.names[k] + (x ? ':sí' : ':NO')).join(' ')}); abajo del todo quedan ${ESC.fueraAlFinal.length ? 'fuera ' + ESC.fueraAlFinal.join(',') : 'ninguno'}`);
  ok(ESC.paneles.some((p) => p.recortado) && ESC.paneles.filter((p) => !p.recortado).length >= 2,
     `en reposo se ven ${ESC.paneles.filter((p) => !p.recortado).map((p) => p.id.replace('pane', '')).join(' y ')} con ${ESC.paneles.filter((p) => p.recortado).map((p) => p.id.replace('pane', ''))} por debajo del borde —cortado, no perdido—`);
  ok(ESC.eje.en === 'principal' && ESC.eje.principal >= 10 && ESC.eje.macd < 10 && ESC.eje.rsi < 10,
     `el eje de tiempo se pinta en el gráfico principal (franja de ${ESC.eje.principal} px) y ninguno de los dos paneles lo paga (${ESC.eje.rsi} y ${ESC.eje.macd} px), porque su hueco era de ${ESC.eje.hueco} px con umbral 48`);
  ok(ESC.asa >= 18 && ESC.paneles.filter((p) => !p.recortado).every((p) => p.pisaCerrar === 'si'),
     `el asa del PnL mide ${ESC.asa} px de alto (antes 12) y la ✕ de los paneles a la vista se puede pulsar (${ESC.paneles.filter((p) => !p.recortado).map((p) => p.id.replace('pane', '') + ':' + p.pisaCerrar).join(' ')})`);
  ok(ESC.paneles.every((p) => p.headScroll <= p.headH + 1 && p.valCorte <= 0 && p.titleCorte <= 0),
     `las cabeceras caben en su línea: ${ESC.paneles.map((p) => p.id.replace('pane', '') + ' ' + p.headH + '/' + p.headScroll + 'px, corte ' + p.valCorte + 'px').join(' · ')} (el MACD partía sus valores a dos líneas y la segunda se pintaba encima de su propio gráfico)`);
  ok(ESC.docH === ESC.vh && ESC.ovx === 0,
     `y el documento del teléfono sigue sin deslizar: ${ESC.docH} = ${ESC.vh} de viewport, ${ESC.ovx} px de scroll horizontal`);
  /* Se devuelve la app al estado de antes de este bloque: las tres capturas que se toman
     debajo (44, 45 y 08) corresponden a la escalera por defecto. */
  await page.evaluate(() => {
    App.indicators.rsi.on = false; App.indicators.macd.on = false;
    App.applyIndicators(App.indicators, true);
    const pa = document.getElementById('paneArea'); if (pa) pa.scrollTop = 0;
  });
  await wait(520);

  /* ═════════ LA BARRA DE DIBUJO: DIANAS, RECORTE Y LO QUE NO CABE ═════════
     Medido antes de tocar, en once tallas: la fila que `#chartArea` reserva para la barra
     y la caja de la barra salían de dos reglas distintas. `--toolbar-h` manda en las dos
     (`chart.css` la usa para la fila, `bitunix.css:606` para el alto), pero los tiers de
     altura escribían `#drawToolbar{height}` a mano y el de menos de 700 px de alto se
     olvidó de la variable: 28 px de caja dentro de 30 de fila, con 2 px de franja muerta
     donde el tier quería regalarle píxeles al gráfico (169 → 171 a 360×640 con el arreglo).
     Y en la barra había una diana corta: el «⊘ scroll» es un `<label>` con su checkbox, sin
     alto propio, y medía 19 px en escritorio (los demás controles, 22-27). El tercero no se
     ve en este motor: la barra pedía `scrollbar-width:thin`, que en Firefox NO es superpuesto
     y en Chrome viejo se comía los 8 px de la regla global —en una fila de 28-30 px con
     controles de 24, eso recorta los botones por abajo—; ahora el scrollbar no reserva hueco.
     Lo que NO se persigue: a 360×640 y 320×568 el documento mide 827 px y la página desliza.
     Es el formulario de órdenes apilado bajo el gráfico, y deslizar la página en un móvil
     bajo es lo correcto —por eso aquí no se pide `docH === vh` como en la escalera—. */
  console.log('\n▸ La barra de dibujo (390×844 · 360×640 · 320×568 · 1280×800)');
  const DBJO = {};
  for (const [DW, DH] of [[390, 844], [360, 640], [320, 568], [1280, 800]]) {
    await page.setViewport({ width: DW, height: DH, deviceScaleFactor: 1 });
    await wait(460);
    DBJO[DW + 'x' + DH] = await page.evaluate(async () => {
      const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
      const g = (id) => document.getElementById(id);
      const barra = g('drawToolbar'), ca = g('chartArea');
      /* Las claves del helper, COMPLETAS y a propósito: en este fichero el R() de la
         escalera llama `t`/`b`/`h` a top/bottom/height, y pedir `.height` a un objeto así
         da `undefined` —el guard `if (!r.height)` devuelve false para todo y el contrato se
         convierte en humo (pasó al medir esta barra: 0 de 21 controles «alcanzables»). */
      const R = (e) => { const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, height: r.height, width: r.width,
                 top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const q = R(barra);
      const pisa = (e) => { const r = R(e); if (!r.height || !r.width) return 'oculto';
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return el && (e === el || e.contains(el) || el.contains(e)) ? 'si' : 'no'; };
      const controles = [...barra.querySelectorAll('button, select, input[type="color"], #drawToolbar .switch')];
      const nombre = (e) => e.id || (e.dataset && e.dataset.tool) || String(e.className);
      const geo = controles.map((e) => { const r = R(e);
        return { n: nombre(e), height: Math.round(r.height), width: Math.round(r.width),
          recortado: r.bottom > q.bottom + 0.5 || r.top < q.top - 0.5,
          fuera: r.right > q.right + 0.5 || r.left < q.left - 0.5, pisa: pisa(e) }; });
      /* «Alcanzable» = centro pulsable en ALGÚN punto del deslizamiento, no en la foto de
         reposo: es el mismo contrato que se exigió a los chips de velocidad y a las ✕ de la
         escalera, por el mismo motivo. Y solo tiene mérito si algo se sale (se comprueba). */
      const max = barra.scrollWidth - barra.clientWidth;
      const alcance = geo.map((x) => x.pisa === 'si');
      for (let s = 0.1; max > 0 && s <= 1.001; s += 0.1) {
        barra.scrollLeft = Math.round(max * s); await esperar(45);
        controles.forEach((e, k) => { if (pisa(e) === 'si') alcance[k] = true; });
      }
      barra.scrollLeft = 0; await esperar(60);
      const cs = getComputedStyle(barra);
      return { fila: Math.round(parseFloat(getComputedStyle(ca).gridTemplateRows.split(' ')[0])),
        caja: Math.round(q.height), varH: getComputedStyle(document.documentElement).getPropertyValue('--toolbar-h').trim(),
        scb: barra.offsetHeight - barra.clientHeight, sb: cs.scrollbarWidth, ovx: cs.overflowX,
        sw: barra.scrollWidth, cw: barra.clientWidth, max, n: geo.length,
        minH: Math.min(...geo.map((x) => x.height)), minW: Math.min(...geo.map((x) => x.width)),
        bajos: geo.filter((x) => x.height < 20 || x.width < 20).map((x) => x.n + '@' + x.height + '×' + x.width),
        switchH: (geo.find((x) => /(^| )switch( |$)/.test(x.n)) || {}).height || 0,
        recortados: geo.filter((x) => x.recortado).map((x) => x.n),
        fueraReposo: geo.filter((x) => x.fuera).length, pisanReposo: geo.filter((x) => x.pisa === 'si').length,
        inalcanzables: geo.filter((x, k) => !alcance[k]).map((x) => x.n),
        primero: geo[0] };
    });
    const et = DW + '×' + DH, d = DBJO[DW + 'x' + DH];
    ok(d.fila === d.caja,
       `${et}: la barra de dibujo ocupa exacto su fila (${d.caja} px de caja en fila de ${d.fila}, --toolbar-h ${d.varH}) —antes el tier de menos de 700 px de alto bajaba la caja a 28 y dejaba la fila en 30: 2 px de relleno en vez de 2 px de gráfico—`);
    ok(d.bajos.length === 0 && d.recortados.length === 0,
       `${et}: sus ${d.n} controles son diana (el más pequeño, ${d.minH}×${d.minW} px; «⊘ scroll» ${d.switchH} px de alto) y ninguno se sale de la caja verticalmente${d.recortados.length ? ': ' + d.recortados.join(' ') : ''}`);
  }
  const dp = DBJO['390x844'];
  ok(dp.sw > dp.cw && dp.max > 0 && dp.fueraReposo > 0,
     `en el teléfono no cabe todo y se ve que no cabe: ${dp.sw} px de contenido en ${dp.cw} de caja, ${dp.fueraReposo} controles fuera en reposo, la barra desliza ${dp.max} px (overflow-x:${dp.ovx})`);
  ok(dp.inalcanzables.length === 0,
     dp.inalcanzables.length ? `detrás del swipe hay controles que no se pulsan nunca: ${dp.inalcanzables.join(' ')}`
       : `y lo que queda detrás del swipe se alcanza: los ${dp.n} controles tienen su centro pulsable en algún punto del deslizamiento (en reposo se pulsan ${dp.pisanReposo})`);
  ok(dp.primero.pisa === 'si' && !dp.primero.recortado,
     `la primera herramienta se ve y se pulsa sin deslizar (${dp.primero.n}: ${dp.primero.height}×${dp.primero.width} px) —la barra empieza en el borde izquierdo, no a medias—`);
  ok(dp.scb <= 1 && dp.sb === 'none',
     `el scrollbar no le roba fila a la barra: reserva ${dp.scb} px (el borde inferior) con scrollbar-width:${dp.sb}; con la regla global de 8 px la fila útil se quedaba en 20 contra botones de 24`);
  /* Y el viewport VUELVE a la talla del teléfono: los cuatro bloques de capturas que hay
     debajo (47, 46, 45 y 44) no ponen el tamaño, lo heredan del bloque anterior —y el mío
     terminaba de recorrer las tallas en 1280×800, así que la primera corrida del bloque
     sacó las cuatro capturas del móvil a tamaño de escritorio: el daño colateral típico de
     un bloque nuevo que cambia el viewport. La captura 48 se toma aquí, en reposo, con la
     herramienta activa a la izquierda y el `<select>` de grosor cortándose en el borde
     derecho —que es la señal de que detrás hay más, no de que falte nada—. */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await wait(420);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-48-barra-dibujo-movil.png') });

  /* Captura de la escalera del teléfono, abierta hasta el último panel: los dos
     indicadores con su gráfico de 32 px y la ✕ alcanzable. */
  await page.evaluate(() => {
    App.indicators.rsi.on = true; App.indicators.macd.on = true;
    App.applyIndicators(App.indicators, true);
  });
  await wait(700);
  await page.evaluate(() => { const pa = document.getElementById('paneArea'); pa.scrollTop = pa.scrollHeight; });
  await wait(260);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-47-escalera-movil.png') });
  await page.evaluate(() => {
    App.indicators.rsi.on = false; App.indicators.macd.on = false;
    App.applyIndicators(App.indicators, true);
    const pa = document.getElementById('paneArea'); pa.scrollTop = 0;
  });
  await wait(520);

  /* Captura de la barra de replay en el teléfono: se ve el deslizador con la perilla en su
     sitio (el bloque de arriba deja el replay en el 20 %), el contador y el estado, y la
     cola de velocidades saliendo por el borde —es decir, deslizable, no perdida—. */
  await page.evaluate(() => { document.getElementById('replayBar').scrollLeft = 0; });
  await wait(220);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-46-barra-replay-movil.png') });

  /* Las dos capturas del teléfono, con los nombres del carrusel del README (44 y 45):
     la de arriba es el formulario tal cual se ve al abrir la app (todo a la vista, sin
     deslizar) y la otra, el bloque «Avanzado» abierto con su degradado al pie. */
  await page.evaluate(() => document.getElementById('btnOrderAvanzado').click());
  await wait(420);
  await page.evaluate(() => document.getElementById('tpInput').scrollIntoView({ block: 'center' }));
  await wait(220);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-45-formulario-movil-avanzado.png') });
  await page.evaluate(() => document.getElementById('btnOrderAvanzado').click());
  await wait(420);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-44-formulario-movil-plegado.png') });

  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await wait(400);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-08-visor-embebido.png') });

  await browser.close();
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Comprobaciones adaptables: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ La app es usable en cualquier tamaño de panel.\n');
  else { console.log('❌ Hay tamaños donde el diseño falla.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
