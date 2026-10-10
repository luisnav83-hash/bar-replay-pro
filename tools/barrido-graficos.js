/* =========================================================================
 * tools/barrido-graficos.js — barrido MEDIBLE de la zona de gráficos
 *
 * El encargo pendiente era «arreglar los errores en la parte de gráficos que
 * están bien y no cambiarlos si no arreglan nada». Para saber qué está bien
 * hace falta una lista, y la lista no llegó nunca. Este barrido se la fabrica:
 * mide, no opina. Cada comprobación devuelve un número y un sitio, y el
 * veredicto es uno de tres:
 *
 *   NO CUADRA  — medido y mal: hay defecto real.
 *   CUADRA     — medido y bien: NO se toca (es de lo que «está bien»).
 *   A DECIDIR  — medido, pero el criterio lo pone el usuario (gusto, o una
 *                regla de Bitunix que aquí no está replicada a propósito).
 *
 * Uso:  . /home/user/tools/entorno.sh && node tools/barrido-graficos.js
 *       node tools/barrido-graficos.js --json      (para mirar solo el JSON)
 * Salida: docs/barrido-graficos.md + resumen por consola.
 *
 * Todo corre sobre el archivo único (bar-replay-pro-unico.html) con la red
 * cortada: si algo dependiera de un fetch externo, saldría como error de
 * consola y se reportaría igual.
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const ARCHIVO = path.join(RAIZ, 'bar-replay-pro-unico.html');
const SALIDA = path.join(RAIZ, 'docs', 'barrido-graficos.md');
const SOLO_JSON = process.argv.includes('--json');

let puppeteer = null;
for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) { /* siguiente */ }
}
if (!puppeteer) {
  console.error('Falta puppeteer. Fuente /home/user/tools/entorno.sh antes de ejecutar esto.');
  process.exit(2);
}

const hallazgos = [];
/** Registra un hallazgo. `medida` SIEMPRE con números: sin ellos no es un medida. */
function notear(titulo, estado, medida, donde, nota) {
  hallazgos.push({ titulo, estado, medida, donde, nota: nota || '' });
}
const esp = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── helpers en la página ─────────────────────────── */

/** Se inyecta una vez: utilidades de medición dentro del documento. */
const PRELUDIO = `
  window.__med = {
    rect(sel) {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
               right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) };
    },
    visible(el) { return !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0; },
    rgb(c) {
      const m = /rgba?\\(([^)]+)\\)/.exec(c || '');
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      if (p.length >= 4 && p[3] === 0) return null;      // transparente: hay que seguir subiendo
      return { r: p[0], g: p[1], b: p[2] };
    },
    lum(c) {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    },
    fondo(el) {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const c = window.__med.rgb(getComputedStyle(n).backgroundColor);
        if (c) return c;
      }
      return window.__med.rgb(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 };
    },
    contraste(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const st = getComputedStyle(el);
      const fg = window.__med.rgb(st.color);
      if (!fg) return null;
      const bg = window.__med.fondo(el);
      const a = window.__med.lum(fg), b = window.__med.lum(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return { ratio: +ratio.toFixed(2), px: parseFloat(st.fontSize), peso: st.fontWeight };
    },
    recortes(rootSel, tope) {
      const raiz = document.querySelector(rootSel);
      if (!raiz) return null;
      const out = [];
      const nodos = [...raiz.querySelectorAll('*'), raiz];
      for (const el of nodos.slice(0, tope || 900)) {
        const st = getComputedStyle(el);
        const ox = st.overflowX, oy = st.overflowY;
        const oculto = (ox === 'hidden' || ox === 'clip') && (oy === 'hidden' || oy === 'clip');
        const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
        // Con text-overflow: ellipsis el recorte es DEL DISEÑO y avisa: no es un defecto contable.
        // (Y nada de acentos ni comas BACKTICK aquí dentro: esto vive dentro de una plantilla de
        //  string que se inyecta en la página, y un backtick cierra la plantilla del tool.)
        const conEipsis = st.textOverflow === 'ellipsis' && dx > 1 && dy <= 1;
        if ((dx > 1 || dy > 1) && !conEipsis && (oculto || st.textOverflow !== 'clip')) {
          const id = el.id ? '#' + el.id : (el.className && typeof el.className === 'string'
            ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
            : el.tagName.toLowerCase());
          out.push({ id, dx, dy, oculto, txt: (el.textContent || '').trim().slice(0, 34) });
        }
      }
      return out.sort((a, b) => Math.max(b.dx, b.dy) - Math.max(a.dx, a.dy));
    },
  };
  window.__mut = 0;
  new MutationObserver((rs) => { window.__mut += rs.length; })
    .observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
`;

/* ──────────────────────────── fase 1 · geometrías ─────────────────────────── */

const PASOS = [
  { nombre: 'escritorio 1360×900 (dpr 1)', w: 1360, h: 900, dpr: 1 },
  { nombre: 'retina 1360×900 (dpr 2)', w: 1360, h: 900, dpr: 2 },
  { nombre: 'portátil 1024×768 (dpr 1)', w: 1024, h: 768, dpr: 1 },
  { nombre: 'teléfono 390×844 (dpr 3)', w: 390, h: 844, dpr: 3 },
  { nombre: 'ventana mínima 320×240 (dpr 1)', w: 320, h: 240, dpr: 1 },
];

async function medirGeometria(page, paso) {
  await page.setViewport({ width: paso.w, height: paso.h, deviceScaleFactor: paso.dpr });
  await esp(700);

  // 1 · nitidez: cada lienzo debe llevar width = CSS×dpr
  const lienzos = await page.evaluate(() => {
    const dpr = window.devicePixelRatio;
    const sels = ['#mainChart canvas', '#overlayCanvas', '#chartPnl canvas', '#chartRsi canvas',
      '#chartMacd canvas', '#chartAtr canvas'];
    const out = [];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        out.push({ sel: s, dpr, bx: el.width, bw: +r.width.toFixed(2), ratio: +(el.width / r.width).toFixed(2),
          alto: +(el.height / r.height).toFixed(2) });
      }
    }
    return { dpr, out };
  });
  const malos = lienzos.out.filter((l) => Math.abs(l.ratio - l.dpr) > 0.06 || Math.abs(l.alto - l.dpr) > 0.06);
  if (malos.length) {
    notear(`Lienzos sin escalar a devicePixelRatio ${paso.dpr} (${paso.nombre})`, 'NO CUADRA',
      malos.map((m) => `${m.sel} → ${m.ratio}× (debería ${m.dpr}×)`).join(' · '),
      'canvas del gráfico', 'un lienzo a 1× en una pantalla 2× se ve borroso: la línea sale con antialias doble');
  } else {
    notear(`Nitidez a devicePixelRatio ${paso.dpr} (${paso.nombre})`, 'CUADRA',
      lienzos.out.map((l) => `${l.sel} ${l.ratio}×`).join(' · ') || 'sin lienzos visibles',
      '#mainChart/#overlayCanvas/paneles', 'cada lienzo escala su buffer al dpr de la pantalla');
  }

  // Si el lienzo de dibujos venía con el dpr del arranque, forzar el resize suyo demuestra que el
  // código SÍ sabe escalar y que lo que falta es que alguien le avise cuando cambia la pantalla.
  if (lienzos.out.some((l) => Math.abs(l.ratio - l.dpr) > 0.06 && /overlay/.test(l.sel))) {
    const tras = await page.evaluate(async () => {
      if (window.DT && DT.resize) DT.resize();
      await new Promise((r) => setTimeout(r, 220));
      const el = document.querySelector('#overlayCanvas');
      return el ? +(el.width / el.getBoundingClientRect().width).toFixed(2) : null;
    });
    notear(`${paso.nombre}: por qué el lienzo de dibujos no escala`,
      tras && Math.abs(tras - paso.dpr) <= 0.06 ? 'A DECIDIR' : 'NO CUADRA',
      `forzando DT.resize() pasa a ${tras}× (el dpr es ${paso.dpr})`, 'js/drawingTools.js:139 · #overlayCanvas',
      tras && Math.abs(tras - paso.dpr) <= 0.06
        ? 'el código sabe escalar; falta que alguien llame al cambiar la pantalla (ventana movida a otro monitor, zoom del navegador): el bug es de cableado, no de fórmula'
        : 'ni siquiera DT.resize() lo pone al dpr de la pantalla');
  }

  // 2 · desborde horizontal de la página entera
  const scroll = await page.evaluate(() => ({
    dx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dy: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    cw: document.documentElement.clientWidth,
  }));
  // Que la tarjeta de órdenes quepa EN LA VENTANA: si los botones de entrada asoman por debajo
  // del pliegue, el usuario ve el formulario pero no puede operar (fue exactamente lo que pasó
  // al pasar la columna a 272 px con cuerpo de 14 px, y ningún otro test lo cazaba).
  const entrada = await page.evaluate(() => {
    const b = document.getElementById('btnLong');
    const card = document.getElementById('orderCard');
    if (!b || !card) return null;
    const r = b.getBoundingClientRect(), c = card.getBoundingClientRect();
    const col = document.getElementById('sidebar').getBoundingClientRect();
    // Oclusión de verdad: no basta con que el recto caiga dentro de la ventana. La tarjeta mide
    // 629 px y la fila del workspace, 495, así que el borde inferior del botón puede estar
    // DENTRO de la ventana pero TAPADO por el panel inferior (o fuera del scrollport de la
    // columna). `elementFromPoint` en el centro del botón dice quién se ve realmente.
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const quien = document.elementFromPoint(cx, cy);
    const tocable = !!quien && (quien === b || b.contains(quien) || b.closest('.order-actions') === quien || !!(quien.closest && quien.closest('#btnLong')));
    return { abajo: Math.round(r.bottom), altoVentana: innerHeight, alto: Math.round(r.height),
             visible: tocable && r.bottom <= innerHeight && r.top >= 0 && r.bottom <= col.bottom + 2,
             tocable, tapadoPor: quien ? (quien.id ? '#' + quien.id : quien.tagName.toLowerCase()) : 'nada',
             col: Math.round(col.bottom), x: cx, y: cy,
             tarjeta: Math.round(c.height), dentro: card.scrollHeight - card.clientHeight };
  });
  if (entrada) {
    notear(`Botones de entrada a la vista sin desplazar (${paso.nombre})`,
      entrada.visible ? 'CUADRA' : (entrada.altoVentana < 400 ? 'A DECIDIR' : 'NO CUADRA'),
      `#btnLong: ${entrada.alto} px de alto, su borde inferior en y=${entrada.abajo} con la ventana en ${entrada.altoVentana} y la columna en ${entrada.col} · se puede pinchar desde ese punto: ${entrada.tocable}` +
      (entrada.tocable ? '' : ` (lo que hay encima: ${entrada.tapadoPor})`) + ` · tarjeta ${entrada.tarjeta} px · ${entrada.dentro} px ocultos por su propio scroll`,
      '#orderCard · css/bitunix.css (bloque 11)',
      entrada.visible ? '' : (entrada.altoVentana < 400
        ? `ventana de prueba de ${entrada.altoVentana} px de alto: por debajo de ~400 px no cabe el formulario completo en ninguna pantalla de trading, así que se anota como criterio y no como defecto`
        : 'la tarjeta no cabe en la ventana: «Abrir Largo/Corto» quedan fuera y no se puede operar sin desplazar'));
  }
  notear(`Scroll horizontal de la página (${paso.nombre})`, scroll.dx > 0 ? 'NO CUADRA' : 'CUADRA',
    `Δx ${scroll.dx} px sobre ${scroll.cw} px · Δy ${scroll.dy} px`, 'documento',
    scroll.dx > 0 ? 'algo más ancho que la ventana: aparece una barra horizontal y el gráfico se desplaza solo al arrastrar' : '');

  // 3 · recortes dentro de las tarjetas de gráfico y libro
  for (const raiz of ['#chartArea', '#bookCard', '#panelsCard', '#bottomPanel', '#orderCard']) {
    let r = await page.evaluate((s) => window.__med.recortes(s, 900), raiz);
    if (r) r = r.filter((x) => !/^#book(Asks|Bids)$/.test(x.id));   // eso lo mide la aritmética de filas
    if (!r) { notear(`Contenedor ${raiz} ausente (${paso.nombre})`, 'NO CUADRA', 'querySelector → null', raiz, ''); continue; }
    const peores = r.slice(0, 3).filter((x) => Math.max(x.dx, x.dy) >= 4);
    if (peores.length) {
      notear(`Contenido recortado en ${raiz} (${paso.nombre})`, 'NO CUADRA',
        peores.map((x) => `${x.id} desborda ${x.dx}×${x.dy} px con overflow:hidden («${x.txt}»)`).join(' · '),
        raiz, 'texto cortado sin scrollbar ni elipsis: no hay forma de ver lo que falta');
    } else {
      notear(`Recortes en ${raiz} (${paso.nombre})`, 'CUADRA',
        r.length ? `peor desborde ${Math.max(...r.map((x) => Math.max(x.dx, x.dy)))} px` : 'ningún desbord > 1 px', raiz, '');
    }
  }

  // 4 · solapes y presencia de las piezas que el usuario ya señaló
  const geo = await page.evaluate(() => {
    const m = window.__med, r = (s) => m.rect(s);
    const solapa = (a, b) => (!a || !b) ? null : Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)) > 0
      ? +Math.max(Math.min(a.right, b.right) - Math.max(a.x, b.x), Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)).toFixed(1)
      : 0;
    const ch = r('#chartArea'), ln = r('#bookLast'), bc = r('#bookCard'), pnl = r('#chartPnl'), main = r('#mainChart');
    const ovl = r('#overlayCanvas');
    return {
      main, pnl, ovl, ch, bc,
      leyendaSolapaEje: solapa(r('#ohlcLegend'), r('#bfIndex')),
      escaleraVisible: !!document.querySelector('#chartPnl') && m.visible(document.querySelector('#chartPnl')),
      libroVisible: m.visible(document.querySelector('#bookCard')),
      pcAlto: (window.PC && PC.alto) ? +PC.alto().toFixed(1) : null,
      paneAlto: (() => { const e = document.getElementById('panePnl'); return e ? +e.getBoundingClientRect().height.toFixed(1) : null; })(),
      pnlCliente: (() => { const e = document.getElementById('chartPnl'); return e ? e.clientHeight : null; })(),
      pnlScroll: (() => { const e = document.getElementById('chartPnl'); return e ? e.scrollHeight : null; })(),
      get pnlClip() { return Math.max(0, (this.pnlScroll || 0) - (this.pnlCliente || 0)); },
      pcMin: (window.PC && PC.ALTO_MIN) || null,
      areaAlto: ch ? ch.h : null,
      mainAlto: main ? main.h : null,
      overlayCuadra: (ovl && main) ? { dx: +(ovl.x - main.x).toFixed(1), dy: +(ovl.y - main.y).toFixed(1), dw: +(ovl.w - main.w).toFixed(1), dh: +(ovl.h - main.h).toFixed(1) } : null,
    };
  });

  if (geo.overlayCuadra) {
    const mal = Math.abs(geo.overlayCuadra.dx) > 1 || Math.abs(geo.overlayCuadra.dy) > 1
      || Math.abs(geo.overlayCuadra.dw) > 1 || Math.abs(geo.overlayCuadra.dh) > 1;
    notear(`Alineación del lienzo de dibujos con el gráfico (${paso.nombre})`, mal ? 'NO CUADRA' : 'CUADRA',
      `Δx ${geo.overlayCuadra.dx} · Δy ${geo.overlayCuadra.dy} · Δancho ${geo.overlayCuadra.dw} · Δalto ${geo.overlayCuadra.dh} px`,
      '#overlayCanvas vs #mainChart', mal ? 'si los dos lienzo no miden lo mismo, las flechas y líneas dibujadas caen desplazadas sobre las velas' : '');
  }
  // `PC.alto()` mide el PANE y `#chartPnl` es el lienzo dentro del pane: comparar los dos era mi
  // error de bulto (26 px de cabecera no son un recorte). Lo que sí importa es que el pane mida lo
  // que el módulo dice, y que el lienzo no tenga contenido por encima de su caja.
  notear(`Escalera: el pane mide lo que el módulo dice y el lienzo no se recorta (${paso.nombre})`,
    (geo.escaleraVisible && Math.abs((geo.paneAlto || 0) - (geo.pcAlto || 0)) <= 2 && geo.pnlClip <= 1) ? 'CUADRA' : 'NO CUADRA',
    `#panePnl ${geo.paneAlto} px vs PC.alto() ${geo.pcAlto} (mín ${geo.pcMin}) · #chartPnl cliente ${geo.pnlCliente} / contenido ${geo.pnlScroll} (recorte ${geo.pnlClip} px) · #mainChart ${geo.mainAlto} · #chartArea ${geo.areaAlto}`,
    'js/pnlChart.js · #panePnl', geo.escaleraVisible ? '' : 'el panel no está visible en este tamaño');
  notear(`Solape leyenda ↔ eje del gráfico (${paso.nombre})`, geo.leyendaSolapaEje > 0 ? 'NO CUADRA' : 'CUADRA',
    `intersección ${geo.leyendaSolapaEje || 0} px`, '#ohlcLegend · #bfIndex', '');
}

/* ─────────────────────── fase 2 · controles e interacción ────────────────── */

async function barridoControles(page) {
  await page.setViewport({ width: 1360, height: 900, deviceScaleFactor: 1 });
  await esp(600);

  const errores = [];
  page.on('pageerror', (e) => errores.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errores.push('CONSOLE: ' + m.text()); });

  // Todos los controles clicables de la zona de gráficos, sondados DENTRO de la página: una sola
  // pasada con el observer de mutaciones, porque reconstruir selectores desde fuera pierde todo lo
  // que no tenga `id` —que es justamente la mitad de los conmutadores—.
  const sonda = await page.evaluate(async () => {
    const grupo = '#chartArea button, #chartArea [data-ind], #panelsCard button, #bottomPanel button, #bottomPanel [data-tab], #bookCard button, #bookCard [data-book], #btnIndicators, #btnPanelsConfig';
    const vistos = new Set();
    const blancos = [];
    for (const el of document.querySelectorAll(grupo)) {
      if (!el.offsetParent) continue;
      const firma = (el.id || '') + '|' + (el.dataset.ind || el.dataset.book || el.dataset.tab || '') + '|' + el.className;
      if (vistos.has(firma)) continue;
      vistos.add(firma);
      blancos.push(el);
    }
    const muertos = [], rotos = [];
    for (let i = 0; i < blancos.length; i++) {
      const el = blancos[i];
      const nombre = el.id || el.dataset.ind || el.dataset.book || el.dataset.tab || (el.textContent || '').trim().slice(0, 16) || el.tagName;
      window.__mut = 0;
      try { el.click(); } catch (e) { rotos.push(nombre + ' → ' + e.message.slice(0, 60)); continue; }
      await new Promise((r) => setTimeout(r, 200));
      const mut = window.__mut;
      // Si es un conmutador, se vuelve a pulsar para dejarlo como estaba.
      if (el.getAttribute('aria-pressed') !== null || /active/.test(el.className)) { try { el.click(); } catch (e) {} }
      if (!mut && !el.disabled) muertos.push(String(nombre) + ' (0 mutaciones)');
    }
    return { n: blancos.length, muertos, rotos };
  });
  notear('Controles de la zona de gráficos que no hacen nada', sonda.muertos.length ? 'NO CUADRA' : 'CUADRA',
    `sondados ${sonda.n} controles · mudos: ${sonda.muertos.length ? sonda.muertos.join(' · ') : 'ninguno'}`,
    '#chartArea · #panelsCard · #bottomPanel · #bookCard',
    'un botón que no muta el DOM ni cambia de estado es un control muerto (o una trampa para el dedo)');
  notear('Controles que lanzan una excepción al pulsarlos', sonda.rotos.length ? 'NO CUADRA' : 'CUADRA',
    sonda.rotos.length ? sonda.rotos.join(' · ') : `ninguno de los ${sonda.n} sondados`, 'click() sobre cada control', '');

  // Temporalidades: con cada una, la leyenda no puede decir NaN ni quedarse vacía
  const intervals = await page.evaluate(() => [...document.querySelectorAll('[data-interval], #chartArea [data-tf]')].map((x) => x.dataset.interval || x.dataset.tf).filter(Boolean));
  const tf = await page.evaluate(async () => {
    const bot = [...document.querySelectorAll('[data-interval]')];
    const malos = [];
    for (const b of bot) {
      b.click();
      await new Promise((r) => setTimeout(r, 420));
      const txt = (document.getElementById('ohlcLegend') || {}).textContent || '';
      if (/NaN|undefined|Infinity/.test(txt)) malos.push(`${b.dataset.interval}: «${txt.trim().slice(0, 40)}»`);
      if (!App.candles.length) malos.push(`${b.dataset.interval}: 0 velas`);
    }
    return { n: bot.length, malos };
  });
  notear('Leyenda OHLC al cambiar de temporalidad', tf.malos.length ? 'NO CUADRA' : 'CUADRA',
    `${tf.n} temporalidades probadas · con NaN/undefined: ${tf.malos.length ? tf.malos.join(' · ') : 'ninguna'}`,
    'js/barReplay.js · #ohlcLegend', '');

  // Atajos que roban la escritura en un campo (clásico: pulsas «b» en un input y se coloca una orden)
  const robo = await page.evaluate(async () => {
    const antes = { pend: TE.state.pending.length, pos: !!TE.state.position, play: BR.isPlaying() };
    const id = 'sizeInput';
    const inp = document.getElementById(id);
    inp.focus();
    for (const k of ['b', 's', 't', 'f', 'x']) inp.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await new Promise((r) => setTimeout(r, 260));
    return {
      conFoco: document.activeElement === inp,
      pend: TE.state.pending.length - antes.pend, pos: !!TE.state.position,
      playCambio: BR.isPlaying() !== antes.play,
    };
  });
  notear('Atajos de tecla con el foco dentro de un campo', (robo.pend > 0 || robo.playCambio) ? 'NO CUADRA' : 'CUADRA',
    `foco en #sizeInput · teclas b/s/t/f/x y espacio · órdenes nuevas ${robo.pend} · play alternado ${robo.playCambio}`,
    'js/uiController.js (guarda `typing`)', 'si el atajo se come la tecla, el usuario escribe y opera a la vez');

  // El espacio sobre un botón enfocado SÍ debe actuar (aquí no se está escribiendo: el guard
  // `typing` solo cubre input|select|textarea). Dos cosas se miden y en este orden, porque la
  // primera vez las medí revueltas y el resultado era un artefacto mío:
  //   · que la tecla ALTERNE la reproducción (accesibilidad por foco), y
  //   · que la haga UNA sola vez: el atajo global y el click nativo del botón apuntan a la misma
  //     App.togglePlay, así que hay que contar invocaciones, no solo el estado final.
  // Se vuelve al principio ANTES de mirar la tecla: `BR.play()` se niega con «Replay finalizado»
  // cuando el índice ya está en la última vela, y el barrido de controles de arriba deja el replay
  // justamente ahí. Medirlo sin volver atrás daba un «la tecla no hace nada» que era del instrumento,
  // no de la app (y de eso ya tuve una lección esta misma sesión).
  await page.evaluate(() => { const b = document.getElementById('btnReset'); if (b) b.click(); });
  await esp(600);
  await page.evaluate(() => {
    window.__l = { togglePlay: 0 };
    if (typeof App.togglePlay === 'function') {
      const f = App.togglePlay;
      App.togglePlay = function () { window.__l.togglePlay++; return f.apply(this, arguments); };
    }
  });
  const espAntes = await page.evaluate(() => {
    const b = document.getElementById('btnPlay');
    if (b) b.focus();
    return { play: BR.isPlaying(), foco: (document.activeElement || {}).id || '—' };
  });
  await page.keyboard.press('Space');
  await esp(280);
  const espDesp = await page.evaluate(() => ({
    play: BR.isPlaying(),
    foco: (document.activeElement || {}).id || document.activeElement.tagName,
    llamadas: window.__l.togglePlay,
  }));
  if (espDesp.play) { await page.evaluate(() => { const b = document.getElementById('btnPlay'); if (b) b.click(); }); await esp(160); }

  // Y la pregunta de accesibilidad, con un botón que NO tenga atajo: con #btnStepFwd salía un
  // número sin sentido porque la propia barra espaciadora arranca la reproducción desde cualquier
  // foco, y el replay avanzaba solo mientras esperaba. Aquí se mide lo que de verdad interesa: si el
  // preventDefault del atajo global apaga la activación nativa de un botón cualquiera.
  const nativo = await page.evaluate(() => {
    const b = document.getElementById('btnIndicators') || document.getElementById('btnPanelsConfig');
    if (!b) return { ausente: true };
    b.focus();
    return { id: b.id, abiertoAntes: !!(document.querySelector('.popover, #indPopover, #panelsConfig') || {}).offsetParent };
  });
  if (!nativo.ausente) {
    await page.keyboard.press('Space');
    await esp(240);
    nativo.abiertoDespues = await page.evaluate(() => {
      const pop = document.querySelector('.popover, #indPopover, #panelsConfig');
      return { visible: !!(pop && pop.offsetParent), play: BR.isPlaying(), idx: BR.getIndex() };
    });
    // Se cierra lo que la tecla haya abierto y se pausa lo que haya arrancado.
    await page.evaluate(() => { if (BR.isPlaying()) BR.pause(); const e = document.getElementById('btnIndicators'); if (e) e.click(); });
    await esp(180);
  }
  const disparos = { togglePlay: espDesp.llamadas };
  const objetivo0 = { clicks: 0 };
  // Qué hace cada tecla con un botón enfocado, medido SIN depender de qué abre cada botón: se
  // cuenta el evento `click` que la tecla produce. Un <button> enfocado debe emitir click con
  // Espacio y con Enter; si el atajo global hace preventDefault, la tecla no llega al botón.
  const objetivo = await page.evaluate(() => {
    const b = document.getElementById('btnIndicators');
    if (!b) return { ausente: true };
    window.__c = 0;
    b.addEventListener('click', () => { window.__c++; });
    b.focus();
    return { ausente: false, id: b.id, foco: (document.activeElement || {}).id };
  });
  await esp(150);
  await page.keyboard.press('Space');
  await esp(220);
  const conBarra = await page.evaluate(() => ({ clicks: window.__c, play: BR.isPlaying(), idx: BR.getIndex() }));
  await page.evaluate(() => { if (BR.isPlaying()) BR.pause(); });
  await esp(150);
  await page.keyboard.press('Enter');
  await esp(220);
  const conEnter = await page.evaluate(() => ({ clicks: window.__c, play: BR.isPlaying() }));
  if (!objetivo.ausente) {
    notear('Teclado sobre un botón enfocado (#btnIndicators)',
      (conBarra.clicks > objetivo0.clicks && conEnter.clicks > conBarra.clicks) ? 'CUADRA' : 'NO CUADRA',
      `clicks contados en el botón: tras la barra ${conBarra.clicks - objetivo0.clicks} · tras Enter ${conEnter.clicks - conBarra.clicks} `
      + `(el botón abre lo que abre; lo que se comprueba es que la tecla leproduzca un click) · con la barra además arrancó la reproducción (play=${conBarra.play}, índice ${conBarra.idx})`,
      "js/uiController.js · case ' ' / case 'Enter' y el click nativo del <button>",
      conBarra.clicks === objetivo0.clicks
        ? 'la barra espaciadora hace preventDefault a nivel de documento y el botón enfocado no recibe su click: un botón de la barra de replay no se puede activar con la tecla que le corresponde'
        : '');
  }

  // Hover por el gráfico: la leyenda sigue el cursor y al salir no se queda clavada
  const hover = await page.evaluate(() => {
    const r = document.getElementById('chartArea').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, txt: (document.getElementById('ohlcLegend') || {}).textContent.replace(/\s+/g, ' ').trim().slice(0, 60) };
  });
  await page.mouse.move(hover.x + hover.w * 0.35, hover.y + hover.h * 0.5);
  await esp(160);
  const dentro = await page.evaluate(() => (document.getElementById('ohlcLegend') || {}).textContent.replace(/\s+/g, ' ').trim().slice(0, 60));
  await page.mouse.move(hover.x + hover.w * 0.9, hover.y - 60);
  await esp(260);
  const fuera = await page.evaluate(() => ({
    txt: (document.getElementById('ohlcLegend') || {}).textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
    ultima: (() => { const c = App.candles[BR.getIndex()] || App.candles[App.candles.length - 1]; return c ? c.close.toFixed(2) : '—'; })(),
  }));
  notear('Leyenda OHLC al sacar el cursor del gráfico', /NaN|undefined/.test(fuera.txt) ? 'NO CUADRA' : 'CUADRA',
    `sigue el cursor: ${dentro !== hover.txt} · al salir: «${fuera.txt}» · cierre de la vela actual ${fuera.ultima}`,
    '#ohlcLegend', dentro === hover.txt ? 'la leyenda no cambió al pasar por encima: puede que el hover no esté cableado' : '');

  // Resizes a plazos: ni lienzos duplicados ni vaivén de alturas (el ResizeObserver de la escalera)
  const vaiven = await page.evaluate(async () => {
    const cuenta = () => document.querySelectorAll('#mainChart canvas, #chartPnl canvas, #overlayCanvas').length;
    const c0 = cuenta();
    const alto = () => (window.PC && PC.alto) ? +PC.alto().toFixed(1) : null;
    const a0 = alto();
    return { c0, a0, c1: cuenta(), a1: alto() };
  });
  for (const [w, h] of [[1200, 800], [980, 700], [1300, 860], [1024, 640], [1360, 900], [1100, 760]]) {
    await page.setViewport({ width: w, height: h });
    await esp(220);
  }
  await esp(500);
  const despues = await page.evaluate(async () => {
    const cuenta = () => document.querySelectorAll('#mainChart canvas, #chartPnl canvas, #overlayCanvas').length;
    const alto = () => (window.PC && PC.alto) ? +PC.alto().toFixed(1) : null;
    const muestras = [];
    for (let i = 0; i < 5; i++) { muestras.push(alto()); await new Promise((r) => setTimeout(r, 180)); }
    return { c: cuenta(), a: alto(), muestras, estable: new Set(muestras).size === 1 };
  });
  notear('Lienzos duplicados tras seis cambios de tamaño', despues.c !== vaiven.c0 ? 'NO CUADRA' : 'CUADRA',
    `${vaiven.c0} lienzos antes · ${despues.c} después de 6 resize`, '#mainChart/#chartPnl/#overlayCanvas',
    despues.c > vaiven.c0 ? 'lienzos viejos sin retirar: memoria y capas fantasma pintando encima' : '');
  notear('Vaivén de la altura de la escalera (ResizeObserver)', despues.estable ? 'CUADRA' : 'NO CUADRA',
    `alturas medidas tras estabilizar: ${despues.muestras.join(' · ')} px (establecida ${vaiven.a0} → ${despues.a})`,
    'js/pnlChart.js · #paneArea', 'el vigía de la escalera vuelve a llamar al reparto: si no converge, la altura bombea cada fotograma');

  // Estado vacío: tras reiniciar, ni NaN ni errores
  const vacio = await page.evaluate(async () => {
    document.getElementById('btnReset').click();
    await new Promise((r) => setTimeout(r, 500));
    for (const sel of ['#btnIndicators', '#btnPlay', '#btnStepFwd', '#btnStepBack']) {
      const e = document.querySelector(sel);
      if (e) e.click();
      await new Promise((r) => setTimeout(r, 140));
    }
    await new Promise((r) => setTimeout(r, 400));
    const anfitriones = [];
    const yaMedidos = new Set(['bookAsks', 'bookBids']);   // los mide su propia comprobación, abajo
    for (const el of [...document.querySelectorAll('body *')].slice(0, 4000)) {
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)) continue;   // texto que no se pinta
      if (yaMedidos.has(el.id)) continue;
      // Solo hojas: el innerText de un contenedor repetiría el de todos sus hijos y contaríamos
      // cada NaN tres veces. (Y nada de mirar `childElementCount === 0` sobre un <canvas>: ese no
      // tiene texto.)
      if (el.childElementCount > 0) continue;
      const propio = el.textContent || '';
      if (/NaN|undefined/.test(propio)) {
        anfitriones.push({ id: el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\s+/)[0],
          txt: propio.trim().slice(0, 30) });
      }
      if (anfitriones.length > 5) break;
    }
    return {
      velas: App.candles.length, idx: BR.getIndex(),
      nan: /NaN|undefined/.test((document.getElementById('ohlcLegend') || {}).textContent || ''),
      total: (document.body.innerText.match(/NaN/g) || []).length, anfitriones,
    };
  });
  notear('Zona de gráficos con la máquina recién reiniciada', (vacio.nan || vacio.total > 0) ? 'NO CUADRA' : 'CUADRA',
    `velas ${vacio.velas} · índice ${vacio.idx} · NaN en la leyenda ${vacio.nan} · «NaN» escrito en ${vacio.total} sitios`
    + (vacio.anfitriones.length ? ` (los primeros: ${vacio.anfitriones.map((a) => a.id + ' «' + a.txt + '»').join(' · ')})` : ''),
    'estado inicial', 'tras reiniciar no hay estadísticas que mostrar: «—» es la respuesta, «NaN» es un crash silencioso');

  // El libro: el CSS derivaba su alto de `--cuerpo` para que «nada se recorte a ojo»; si el número
  // de filas pintadas supera lo que cabe, la última fila se corta por la mitad y eso es exactamente el
  // tipo de queja que hay que poder enseñar con un número.
  const cajas = await page.evaluate(() => {
    const out = {};
    for (const id of ['bookAsks', 'bookBids']) {
      const el = document.getElementById(id);
      if (!el) { out[id] = null; continue; }
      const hijos = [...el.children];
      const alturas = hijos.map((x) => x.getBoundingClientRect().height);
      out[id] = { n: hijos.length, fila: alturas.length ? +alturas[0].toFixed(1) : 0,
        cliente: el.clientHeight, contenido: el.scrollHeight,
        max: getComputedStyle(el).maxHeight, desborde: el.scrollHeight - el.clientHeight };
    }
    return out;
  });
  for (const [id, c] of Object.entries(cajas)) {
    if (!c) continue;
    const caben = c.fila ? Math.floor(c.cliente / c.fila) : 0;
    notear(`Libro: ${c.n} filas pintadas en una caja de ${c.cliente} px (${id})`,
      c.desborde > 1 ? 'NO CUADRA' : 'CUADRA',
      `${c.n} filas × ${c.fila} px = ${c.contenido} px en ${c.cliente} px de caja (max-height ${c.max}) · caben ${caben} · desborde ${c.desborde} px`,
      `#${id} · js/orderBook.js · css/bitunix.css (.bf-asks)`,
      c.desborde > 1 ? `se pintan ${c.n - caben} fila(s) más de las que caben: la última sale cortada a la mitad y sin scrollbar · la cantidad de filas la fija OB.ROWS (js/orderBook.js:34, «ROWS = 10 · el original muestra 10-15») y el alto de la caja sale del CSS (--cuerpo), así que las dos mitades no se han visto nunca: 10 × 17 = 170 px en 102 px` : '');
  }

  // Coherencia del libro: filas, barras, porcentajes y precio último
  const libro = await page.evaluate(() => {
    const filas = (sel) => [...document.querySelectorAll(sel + ' > *')].length;
    const pct = (id) => parseFloat(((document.getElementById(id) || {}).textContent || '').replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0;
    const ancho = (id) => { const e = document.getElementById(id); if (!e) return null; const w = parseFloat(getComputedStyle(e).width); const p = parseFloat(getComputedStyle(e.parentElement).width); return { w: +w.toFixed(1), pct: +(w / Math.max(1, p) * 100).toFixed(1) }; };
    return {
      asks: filas('#bookAsks'), bids: filas('#bookBids'),
      bidPct: pct('bookBidPct'), askPct: pct('bookAskPct'),
      barBid: ancho('bookBidBar'), barAsk: ancho('bookAskBar'),
      last: ((document.getElementById('bookLast') || {}).textContent || '').trim(),
      precio: App.currentPrice(),
      src: ((document.getElementById('bookSrc') || {}).textContent || '').trim().slice(0, 26),
    };
  });
  const sumaPct = libro.bidPct + libro.askPct;
  notear('Libro: las dos mitades del desbalance cuadran', (sumaPct > 96 && sumaPct < 104) ? 'CUADRA' : 'NO CUADRA',
    `bid ${libro.bidPct} + ask ${libro.askPct} = ${sumaPct.toFixed(1)} % · filas ${libro.asks}/${libro.bids} · barras ${libro.barBid ? libro.barBid.pct : '—'} % / ${libro.barAsk ? libro.barAsk.pct : '—'} % · origen «${libro.src}»`,
    'js/orderBook.js · #bookCard', '');
  notear('Libro: el precio último es el del gráfico', libro.last && Math.abs(parseFloat(libro.last.replace(/[^0-9.]/g, '')) - libro.precio) / libro.precio < 0.02 ? 'CUADRA' : 'A DECIDIR',
    `#bookLast «${libro.last}» · cierre actual ${libro.precio ? libro.precio.toFixed(2) : '—'}`, '#bookLast',
    'si el libro es sintético, divergir es esperado; lo que no puede es mostrar otro precio sin decir de dónde sale');

  // Contraste de los rótulos pequeños de la zona de gráficos
  const contrastes = await page.evaluate(() => {
    const out = [];
    for (const s of ['#ohlcLegend', '#lgInd', '#bfIndex', '.lev-lados.dif', '#bookBidPct', '#bookAskPct', '#tagPrice', '#trigHint', '#limitHint', '#riesgoHint', '#posPnlSparkNote', '.pi-eta']) {
      const c = window.__med.contraste(s);
      if (c) out.push({ s, ...c });
    }
    return out;
  });
  const flojos = contrastes.filter((c) => c.ratio < 4.5 && c.px < 14);
  notear('Contraste de los rótulos pequeños de la zona de gráficos', flojos.length ? 'NO CUADRA' : 'CUADRA',
    `medidos ${contrastes.length} · ${contrastes.map((c) => `${c.s} ${c.ratio}:1/${c.px}px`).join(' · ')}`,
    'css/bitunix.css', flojos.length
      ? flojos.map((f) => `${f.s} (${f.ratio}:1 a ${f.px}px)`).join(' · ') + ' —por debajo de 4,5:1 con letra pequeña (WCAG AA); ojo: `.hint` se mide sobre el primer elemento de la clase, no es un promedio'
      : 'ninguno por debajo de 4,5:1');

  await page.evaluate(() => { document.getElementById('btnStepFwd').click(); });
  await esp(200);
  // Los `net::ERR_FAILED` los produce el propio arnés, que corta la red a propósito: no son de la
  // app. Se cuentan aparte para que el informe no los venda como fallos ni los esconda tampoco.
  const ruidoArn = errores.filter((e) => /Failed to load resource|ERR_FAILED|ERR_BLOCKED/.test(e));
  const reales = errores.filter((e) => !/Failed to load resource|ERR_FAILED|ERR_BLOCKED/.test(e));
  notear('Errores de consola y excepciones durante todo el barrido', reales.length ? 'NO CUADRA' : 'CUADRA',
    `${reales.length} de la app${reales.length ? ' → ' + reales.slice(0, 3).join(' ⧸ ') : ''} · ${ruidoArn.length} abortos de red del arnés (esperados aquí, con la red cortada)`,
    'consola del navegador', '');
  return errores;
}

/* ───────────────────────────────── informe ───────────────────────────────── */

function escribirInforme(duracion) {
  const mal = hallazgos.filter((h) => h.estado === 'NO CUADRA');
  const decidir = hallazgos.filter((h) => h.estado === 'A DECIDIR');
  const bien = hallazgos.filter((h) => h.estado === 'CUADRA');
  const l = [];
  l.push('# Barrido medible de la zona de gráficos');
  l.push('');
  l.push(`Generado por \`tools/barrido-graficos.js\` sobre \`${path.basename(ARCHIVO)}\` con la red cortada, `
    + `${hallazgos.length} comprobaciones en ${duracion}s: **${mal.length} no cuadran**, ${bien.length} cuadran, ${decidir.length} a decidir.`);
  l.push('');
  l.push('Esto no es la lista de las doce quejas: es una lista **fabricada midiendo**, para poder cruzarla con ellas. '
    + 'Cada línea lleva el número, el sitio y el criterio. Lo que sale en «cuadra» no se toca, que fue la instrucción '
    + 'recibida («arreglar los errores que están bien y no cambiarlos si no arreglan nada» se entiende al revés: lo que '
    + 'está bien se deja).');
  l.push('');
  l.push('## 1 · Lo que no cuadra (medido y mal)');
  l.push('');
  if (!mal.length) l.push('_Nada: el barrido no encontró defectos medibles._');
  mal.forEach((h, i) => {
    l.push(`**G${i + 1} · ${h.titulo}**  `);
    l.push(`- medido: ${h.medida}`);
    l.push(`- dónde: \`${h.donde}\``);
    if (h.nota) l.push(`- por qué importa: ${h.nota}`);
    l.push('');
  });
  l.push('## 2 · Lo que hay que decidir tú (medido, pero el criterio no es mío)');
  l.push('');
  if (!decidir.length) l.push('_Nada en este apartado._');
  decidir.forEach((h, i) => {
    l.push(`**D${i + 1} · ${h.titulo}**  `);
    l.push(`- medido: ${h.medida}`);
    l.push(`- dónde: \`${h.donde}\``);
    if (h.nota) l.push(`- nota: ${h.nota}`);
    l.push('');
  });
  l.push('## 3 · Lo que está bien y NO se toca');
  l.push('');
  l.push('| comprobación | medido | dónde |');
  l.push('|---|---|---|');
  for (const h of bien) l.push(`| ${h.titulo} | ${h.medida} | \`${h.donde}\` |`);
  l.push('');
  l.push('---');
  l.push('');
  l.push('_Cómo releer esto: un «NO CUADRA» con un número al lado es un defecto que se puede arreglar y verificar; '
    + 'las quejas sin número (me lo imagino yo o las invento) no entran en la lista. Si alguna de tus doce no aparece '
    + 'aquí, dímela y la mido: el barrido se amplía en un minuto, no hace falta que recuerdes las otras once._');
  l.push('');
  fs.writeFileSync(SALIDA, l.join('\n'), 'utf8');

  console.log(`\nBarrido: ${hallazgos.length} comprobaciones · ${mal.length} NO CUADRA · ${decidir.length} a decidir · ${bien.length} cuadra`);
  for (const h of mal) console.log('  ✗ ' + h.titulo + '\n      ' + h.medida);
  for (const h of decidir) console.log('  ? ' + h.titulo + '\n      ' + h.medida);
  console.log('\nInforme: ' + path.relative(RAIZ, SALIDA));
}

(async () => {
  const t0 = Date.now();
  if (!fs.existsSync(ARCHIVO)) { console.error('No existe ' + ARCHIVO + ' — ejecuta node tools/build-single.js'); process.exit(2); }
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  await page.evaluateOnNewDocument(PRELUDIO);
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().startsWith('file://') || r.url().startsWith('data:') ? r.continue() : r.abort('failed')));
  await page.goto('file://' + ARCHIVO, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  } catch (e) {
    notear('La aplicación no carga en el barrido', 'NO CUADRA', String(e.message).slice(0, 90), 'arranque', '');
  }
  await page.evaluate(PRELUDIO).catch(() => {});
  await esp(600);
  for (const paso of PASOS) {
    try { await medirGeometria(page, paso); } catch (e) { notear('Fallo del propio barrido en ' + paso.nombre, 'NO CUADRA', e.message.slice(0, 120), 'tools/barrido-graficos.js', 'esto es un defecto de la herramienta, no de la app'); }
  }
  let errs = [];
  try { errs = await barridoControles(page); } catch (e) { notear('Fallo del propio barrido en la fase de interacción', 'NO CUADRA', e.message.slice(0, 140), 'tools/barrido-graficos.js', ''); }
  const dur = ((Date.now() - t0) / 1000).toFixed(0);
  if (SOLO_JSON) console.log(JSON.stringify(hallazgos, null, 1));
  else escribirInforme(dur);
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
