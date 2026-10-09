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
      const panes = [...document.querySelectorAll('.indPane')].filter((e) => e.offsetHeight > 0).map((e) => e.getBoundingClientRect());
      const paneBottom = panes.length ? Math.max(...panes.map((x) => x.bottom)) : 0;
      const play = R('btnPlay');
      return {
        chart: Math.round(wrap.height), panes: panes.length,
        fila: Math.round(parseFloat(getComputedStyle(document.getElementById('chartArea')).gridTemplateRows.split(' ')[1] || '0')),
        sobrePaneles: Math.max(0, Math.round(wrap.bottom - (R('paneArea') || { bottom: wrap.bottom }).bottom)),
        solape: paneBottom > rp.top + 2 ? Math.round(paneBottom - rp.top) : 0,
        ovx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        recorteInterno: Math.round(Math.max(0, ca.bottom - ws.bottom)) + Math.round(Math.max(0, ws.bottom - R('bottomPanel').top)),
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
       tests/browser.capture.js, en 480×900 —204 px medidos, y 146 px honestos en el
       teléfono de 390×844, que es lo que cabe sin tocar nada alcanzable—. */
    const etiqueta = `${w}×${h}`;
    ok(m.chart >= 120 && m.chart === m.fila, `${etiqueta}: el gráfico conserva ${m.chart}px en el PEOR caso de escalera (fila ${m.fila}px, suelo 120px)`);
    ok(m.solape === 0, `${etiqueta}: los paneles de indicadores no tapan la barra de replay`);
    ok(m.sobrePaneles === 0, `${etiqueta}: y el gráfico no pinta encima de los paneles de indicadores (${m.sobrePaneles}px)`);
    ok(m.ovx === 0, `${etiqueta}: sin desbordamiento horizontal (${m.ovx}px)`);
    ok(m.recorteInterno === 0, `${etiqueta}: nada se recorta entre el gráfico y el panel inferior`);
    ok(m.playVisible, `${etiqueta}: el botón PLAY es visible sin desplazar`);
  }

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
