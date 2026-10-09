/* =========================================================================
 * pages-pnl.js — auditoría del MARCAJE DE PnL EN EL GRÁFICO sobre LO PUBLICADO.
 *
 * tests/pnl-chart.test.js abre el archivo único SIN RED y comprueba el contrato
 * completo (6 bloques, 82 comprobaciones). Esta suite hace lo que esas no pueden:
 * abrir la URL que ve un visitante (GitHub Pages, con red y con datos reales) y
 * comprobar que la marca se pinta, sigue a la vela y cuadra con el motor AHÍ.
 *
 * Reglas (las mismas que en las otras suites «pages», aprendidas a golpes):
 *   · Se maneja SOLO la interfaz: clics en los botones de verdad (Abrir largo,
 *     ⏭ paso, 📈 PnL, Cerrar todo). El motor se lee para VERIFICAR, nunca para
 *     accionar — si algo solo funciona llamando a PC.build() a mano, aquí salta.
 *   · Ningún precio se escribe a mano: la entrada, el tamaño y el PnL esperado se
 *     DERIVAN del estado en el momento de medir (TE.state / App.currentPrice()).
 *     La serie de práctica es aleatoria y el precio cambia entre cargas.
 *   · Las cifras en pantalla llevan separadores españoles («+$1.234,56»): se
 *     extraen con una regex y se les quitan los puntos de millar.
 *   · La geometría se mide con getBoundingClientRect relativo al lienzo; los
 *     píxeles no se comparan con valores fijos (dependen del ancho real).
 *   · En https sí se puede recargar la página (en file:// con intercepción de
 *     peticiones, no: se cuelga). Aquí se recarga para probar la preferencia.
 *
 * Uso: node tests/pages-pnl.js                                     → lo publicado
 *      node tests/pages-pnl.js file:///…/bar-replay-pro-unico.html → build local
 * =======================================================================*/
'use strict';

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {} }
if (!puppeteer) { console.log('⚠️  Falta puppeteer (npm i puppeteer): prueba OMITIDA.'); process.exit(0); }

/* «+$1.234,56» / «−$28,34» → número en float español. */
const numEn = (s) => {
  const m = String(s).replace(/−/g, '-').match(/-?\d[\d.]*,?\d*/);
  if (!m) return NaN;
  return parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
};

(async () => {
  const URL_PASADA = process.argv[2] || 'https://luisnav83-hash.github.io/bar-replay-pro/bar-replay-pro-unico.html';
  const LOCAL = URL_PASADA.startsWith('file');
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  let pasan = 0, fallan = 0, omiten = 0;
  const ok = (c, m) => { if (c) { pasan++; console.log('  ✓ ' + m); } else { fallan++; console.log('  ✗ ' + m); } };
  const skip = (m) => { omiten++; console.log('  · omitida: ' + m); };
  const cerca = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errs = [], rotos = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('requestfailed', (r) => rotos.push(r.url().slice(0, 80)));

  console.log(`\n▸ PnL en el gráfico sobre ${LOCAL ? 'la build local' : 'LA APP PUBLICADA'}\n  ${URL_PASADA}`);
  await p.goto(URL_PASADA, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForFunction('window.App && window.App.candles && window.App.candles.length > 0', { timeout: 60000 });
  await p.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 40000 });
  await esp(1200);

  /* Lectura común, dentro de la página: motor + textos + geometría medida. */
  const E = (q) => (q || p).evaluate(() => {
    const g = (id) => document.getElementById(id);
    const txt = (id) => { const e = g(id); return e ? (e.textContent || '').trim() : ''; };
    const vis = (id) => { const e = g(id); return !!e && e.offsetParent !== null; };
    const R = (e) => { const x = e.getBoundingClientRect(); return { x: x.x, y: x.y, w: x.width, h: x.height, right: x.right, bottom: x.bottom }; };
    const lienzo = g('mainChart') ? R(g('mainChart')) : null;
    const rec = (id) => { const e = g(id); if (!e || !lienzo) return null; const r = R(e);
      return { dx: Math.round(r.x - lienzo.x), dy: Math.round(r.y - lienzo.y), w: Math.round(r.w), h: Math.round(r.h),
               dentro: r.right <= lienzo.right + 1 && r.bottom <= lienzo.bottom + 1 && r.x >= lienzo.x - 1 }; };
    // «+$1.234,56» / «−$28,34» → número (los separadores son los españoles).
    const num = (t) => { const m = String(t).replace(/\u2212/g, '-').match(/-?\d[\d.]*,?\d*/); return m ? parseFloat(m[0].replace(/\./g, '').replace(',', '.')) : NaN; };
    const s = TE.state.position;
    const cls = (id) => { const e = g(id); return e ? [...e.classList].filter((c) => c === 'pos' || c === 'neg' || c === 'ganando' || c === 'perdiendo').join('+') : ''; };
    let xEntrada = null;
    try { if (s) xEntrada = CM.timeToX(s.entryTime); } catch (e) {}
    const capa = g('pnlLayer');
    return {
      velas: App.candles.length, idx: BR.getIndex(), precio: App.currentPrice(),
      preferencia: ST.get('pnlGrafico'), botonActivo: g('btnPnl') ? g('btnPnl').classList.contains('active') : null,
      aria: g('btnPnl') ? g('btnPnl').getAttribute('aria-pressed') : null,
      vivo: !!s, lado: s ? s.side : 'ninguna', entrada: s ? s.entryPrice : NaN,
      esperado: s ? TE.unrealized(App.currentPrice()) : NaN,
      etiqueta: txt('pnlBadge'), valor: num(txt('pnlBadgeVal')), pct: txt('pnlBadgePct'),
      nota: txt('pnlPaneNote'), panelVal: num(txt('pnlPaneVal')), panelAbierto: vis('panePnl'),
      capaVisible: vis('pnlLayer'), pointer: capa ? getComputedStyle(capa).pointerEvents : '',
      panelTxt: (g('panePnl') ? (g('panePnl').textContent || '') : '').replace(/\s+/g, ' ').trim().slice(0, 90),
      banda: rec('pnlBand'), badge: rec('pnlBadge'), tick: rec('pnlEntryTick'), lienzo,
      clsBanda: cls('pnlBand'), clsBadge: cls('pnlBadge'), xEntrada,
      d: (window.PC && PC.debug) ? PC.debug() : null,
    };
  });

  /* ─────────────── A) Punto de partida limpio ─────────────── */
  console.log('\n▸ A) Al cargar, sin posición, no hay nada pintado');
  const A = await E();
  ok(A.d !== null, 'el módulo de marcaje está cargado en lo publicado (window.PC)');
  // En una visita nueva la clave aún no está escrita (null) y AUN ASÍ el marcaje
  // viene encendido por defecto: lo que se comprueba es el estado efectivo.
  ok(A.preferencia !== false && A.botonActivo === true, `marcaje encendido por defecto en visita nueva (preferencia ${JSON.stringify(A.preferencia)}, botón activo)`);
  ok(!A.vivo && A.capaVisible === false, 'sin posición no hay nada pintado sobre el gráfico (la capa está oculta)');
  ok(A.panelAbierto === false || /sin posici/i.test(A.nota + A.panelTxt), `el panel de PnL, si se ve, se presenta como «sin posición» (${A.panelAbierto ? 'abierto' : 'cerrado'})`);
  ok(A.d && A.d.velas === 0 && A.d.marcas === 0, `sin traza ni marcadores (velas ${A.d && A.d.velas}, marcas ${A.d && A.d.marcas})`);

  /* ─────────────── B) Abrir desde los botones ─────────────── */
  console.log('\n▸ B) Un LONG desde «Comprar / Largo» queda marcado');
  // Se escribe en el campo de tamaño como lo haría una persona (con su evento
  // `input`), no se toca el motor por detrás.
  await p.$eval('#sizeInput', (el) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('#btnLong');
  await esp(700);
  const B = await E();
  ok(B.vivo && B.lado === 'long', 'la posición existe en el motor tras el clic');
  ok(B.capaVisible && B.panelAbierto, 'la capa sobre el gráfico y el panel de PnL aparecen solos');
  ok(B.banda && B.banda.w > 0 && B.banda.h >= 2, `la banda entrada→precio mide ${B.banda && B.banda.w}×${B.banda && B.banda.h} px`);
  ok(B.banda && B.banda.dentro, 'la banda está dentro del lienzo');
  ok(cerca(B.banda.dx, Math.max(0, B.xEntrada), 2), `la banda arranca en la vela de entrada (x ${B.banda.dx} ≈ ${B.xEntrada})`);
  ok(B.tick && Math.abs(B.tick.dx - Math.max(0, B.xEntrada)) <= 2, `el tick vertical señala esa vela (x ${B.tick && B.tick.dx})`);
  ok(B.badge && B.badge.dentro, `la etiqueta no se sale del lienzo (${B.badge && B.badge.w}×${B.badge && B.badge.h})`);
  ok(cerca(B.valor, B.esperado, 0.02), `el número de la etiqueta ES el del motor (${B.valor} ≈ ${B.esperado.toFixed(4)})`);
  ok(cerca(B.panelVal, B.esperado, 0.02), `el panel repite el mismo número (${B.panelVal})`);
  // El LONG se abre al precio actual: el PnL de partida es 0 exacto, así que no
  // hay signo que prometer. Se exige el importe con su símbolo y el porcentaje.
  ok(/\$[\d.]+,\d{2}/.test(B.etiqueta) && /%/.test(B.pct), `etiqueta con $ y % («${B.etiqueta.replace(/\s+/g, ' ').trim()}»)`);
  ok(/velas? desde la entrada/.test(B.nota), `la nota del panel cuenta el recorrido («${B.nota}»)`);
  ok(B.pointer === 'none', 'la capa no captura el puntero: se puede seguir dibujando y operando');
  ok(B.d && B.d.serie === B.d.velas && B.d.velas >= 1, `la curva del panel tiene ${B.d && B.d.velas} punto(s) (igual que la traza)`);

  /* ─────────────── C) Avanzar velas: la marca sigue a la vela ─────────────── */
  console.log('\n▸ C) ⏭ vela a vela: la banda se estira y el número cambia');
  const antes = { idx: B.idx, banda: B.banda.w, valor: B.valor };
  for (let i = 0; i < 12; i++) { await p.click('#btnStepFwd'); await esp(90); }
  await esp(400);
  const C = await E();
  ok(C.idx === antes.idx + 12, `12 clics en ⏭ = 12 velas (${antes.idx} → ${C.idx})`);
  ok(C.d && C.d.velas === B.d.velas + 12, `la curva crece con el replay (${B.d.velas} → ${C.d.velas} puntos)`);
  ok(C.banda.w > antes.banda, `la banda se ha estirado con las velas (${antes.banda} → ${C.banda.w} px)`);
  ok(cerca(C.valor, C.esperado, 0.02), 'el número sigue siendo el PnL del motor tras el paseo');
  ok(C.clsBanda === (C.esperado > 0 ? 'pos' : C.esperado < 0 ? 'neg' : C.clsBanda),
     `banda en el color del signo (${C.clsBanda} con PnL ${C.esperado.toFixed(2)})`);
  ok(C.d && C.d.max >= C.d.ultimo && C.d.min <= C.d.ultimo, `máx ${C.d.max.toFixed(2)} · último ${C.d.ultimo.toFixed(2)} · mín ${C.d.min.toFixed(2)}`);
  ok(C.banda.dentro && C.badge.dentro, 'tras el paseo, banda y etiqueta siguen dentro del lienzo');

  /* ─────────────── D) Cerrar: resumen que no desaparece ─────────────── */
  console.log('\n▸ D) «Cerrar todo» deja el resumen encima de la operación');
  await p.click('#btnFlatten');
  await esp(700);
  const D = await E();
  ok(!D.vivo, 'la posición se ha cerrado');
  ok(D.d && D.d.recap === true, 'el RESUMEN se queda pintado (no desaparece al cerrar)');
  ok(/cerrado/i.test(D.etiqueta), `la etiqueta avisa del cierre («${D.etiqueta.replace(/\s+/g, ' ').trim()}»)`);
  const ultimo = D.d ? D.d.ultimo : NaN;
  ok(Number.isFinite(ultimo), `la curva muere en el punto de salida (${ultimo.toFixed(2)})`);
  const velasCierre = D.d ? D.d.velas : 0;
  await p.click('#btnStepFwd'); await esp(250); await p.click('#btnStepFwd'); await esp(350);
  const D2 = await E();
  ok(D2.d.velas === velasCierre, `siguiendo el replay la curva del trade cerrado NO crece (${D2.d.velas})`);

  // ── El recorrido del trade cerrado, en la tabla del historial (lo publicado). ──
  // Se comprueba AQUÍ, sobre la URL que ve un visitante, porque el fallo temido no es
  // de lógica sino de armazón: una columna nueva mal colocada desalinea toda la tabla
  // (13 celdas contra 12 cabeceras) y el «Motivo» se sale de la columna 11 que
  // fijan otras suites. Eso solo se ve midiendo la fila publicada.
  const D3 = await p.evaluate(() => {
    const th = [...document.querySelectorAll('#tradesTable thead th')].map((x) => x.textContent.trim());
    const tr = document.querySelector('#tradesBody tr:not(.open)');
    // El title se compara REGENERADO con el formateador de la app, no parseándolo:
    // «94,41» y «94.41» son el mismo número según el locale, y un parser propio se
    // equivoca justo ahí (le pasó a esta suite con el signo − tipográfico U+2212).
    if (!tr) return { th, sinFila: true };
    const celda = tr.querySelector('.tr-spark-c');
    const cv = tr.querySelector('canvas.tr-spark');
    let tinta = 0;
    if (cv) { const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data;
              for (let i = 3; i < d.length; i += 4) if (d[i] > 0) tinta++; }
    const cerrados = TE.state.trades.filter((t) => t.status === 'closed');
    const t = cerrados[cerrados.length - 1] || {};
    const esperado = 'máx ' + U.fmtMoney(t.pnlMax, true) + ' · mín ' + U.fmtMoney(t.pnlMin, true);
    return { th, celdas: tr.children.length, ultima: th[th.length - 1], motivo: tr.children[10].textContent.trim(),
             hayCanvas: !!cv, tinta, pts: cv ? String(cv.dataset.v || '').split(',').filter(Boolean).length : 0,
             title: (celda && celda.title) || '', esperado,
             selladoPts: (t.pnlPath || []).length,
             texto: tr.textContent.replace(/\s+/g, ' ').trim() };
  });
  ok(!D3.sinFila && D3.ultima === 'Recorrido' && D3.th.length === 13,
     `la cabecera publicada cierra con «${D3.ultima}» (${D3.th.length} columnas)`);
  ok(D3.celdas === D3.th.length,
     `la fila cerrada tiene tantas celdas como cabeceras (${D3.celdas}/${D3.th.length}): nada desalineado`);
  ok(/cierre|manual|parcial|SL|TP/i.test(D3.motivo), `el «Motivo» sigue en la columna 11 («${D3.motivo}»)`);
  ok(D3.hayCanvas && D3.tinta > 40, `la mini-curva del recorrido está pintada en lo publicado (${D3.tinta} px de tinta, ${D3.pts} puntos)`);
  ok(D3.pts >= 2 && D3.pts <= 64 && D3.selladoPts === D3.pts,
     `y viaja sellada en el trade (${D3.pts} puntos, el tope de 64 respetado)`);
  ok(D3.title === D3.esperado,
     `el title de la celda dice el máximo y el mínimo REALES del trade («${D3.title}»)`);

  /* ─────────────── E) Interruptor y preferencia guardada ─────────────── */
  console.log('\n▸ E) 📈 PnL apaga y enciende el marcaje, y se recuerda');
  await p.click('#btnPnl'); await esp(400);
  const E1 = await E();
  ok(E1.capaVisible === false && E1.panelAbierto === false, 'apagado: capa y panel desaparecen');
  ok(E1.botonActivo === false && E1.aria === 'false', 'el botón deja de estar activo y la accesibilidad lo dice');
  ok(E1.preferencia === false, 'la preferencia queda escrita en el almacenamiento local');
  if (!LOCAL) {
    // No se puede recargar la pestaña: la app PIDE CONFIRMACIÓN al salir si hay
    // operaciones (js/app.js, `beforeunload`), y en headless ese diálogo deja la
    // navegación colgada para siempre. Se abre OTRA pestaña del mismo navegador:
    // arranque de documento nuevo, mismo origen y por tanto el mismo localStorage,
    // que es exactamente lo que hay que comprobar.
    const p2 = await b.newPage();
    await p2.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await p2.goto(URL_PASADA, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p2.waitForFunction('window.App && window.App.candles && window.App.candles.length > 0', { timeout: 60000 });
    await p2.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 40000 });
    await esp(1200);
    const E2 = await E(p2);
    ok(E2.preferencia === false, 'en el arranque nuevo la preferencia apagada es la que manda (leída del almacenamiento)');
    ok(E2.botonActivo === false && E2.capaVisible === false, 'y el arranque nuevo efectivamente no pinta el marcaje');
    await p2.evaluate(() => { const s = TE.state.position; if (!s) document.getElementById('btnLong').click(); });
    await esp(700);
    await p2.click('#btnPnl'); await esp(500);
    const E3 = await E(p2);
    ok(E3.preferencia === true, 'y al volver a encenderlo con el botón se guarda de nuevo');
    await p2.close();
  } else {
    skip('en build local no se abre una segunda pestaña: la preferencia cruzada se comprueba en tests/pnl-chart.test.js');
    skip('arranque nuevo con la preferencia apagada');
  }

  /* ─────────────── F) Móvil: que quepa ─────────────── */
  console.log('\n▸ F) En 390 px el marcaje no desborda el gráfico');
  // En E se ha dejado el marcaje APAGADO (así se ha probado la preferencia); para
  // medir el móvil hay que volver a encenderlo — y se enciende con el botón, como
  // lo haría cualquier visitante.
  if (!(await E()).botonActivo) { await p.click('#btnPnl'); await esp(600); }
  ok((await E()).botonActivo === true, 'marcaje vuelto a encender con el botón antes de medir el móvil');
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await esp(800);
  const F = await E();
  ok(F.lienzo && F.lienzo.w > 320 && F.lienzo.w <= 391, `el lienzo mide ${F.lienzo && F.lienzo.w} px (no se queda ancho y recortado)`);
  ok(F.badge && F.badge.dentro, `la etiqueta cabe dentro del lienzo (${F.badge && F.badge.w}×${F.badge && F.badge.h})`);
  const solapa = await p.evaluate(() => {
    const L = document.getElementById('ohlcLegend'), b = document.getElementById('pnlBadge');
    if (!L || !b || b.offsetParent === null) return null;
    const R = (e) => e.getBoundingClientRect(), A = R(L), C = R(b);
    return !(C.right <= A.left || A.right <= C.left || C.bottom <= A.top || A.bottom <= C.top);
  });
  ok(solapa === false, 'la etiqueta no tapa la leyenda OHLC');
  ok(F.banda && F.banda.h >= 2 && F.banda.w >= 2, `la banda sigue viéndose (${F.banda && F.banda.w}×${F.banda && F.banda.h})`);
  // Las dos piezas nuevas del incremento, medidas en LO PUBLICADO: el asa del alto y
  // el mini-PnL de la tarjeta. Se arrastra de verdad, con el ratón del navegador.
  const asas = await p.evaluate(() => {
    const a = document.getElementById('pnlPaneResize'), m = document.getElementById('posPnlSpark');
    if (!a || !m) return null;
    const r = a.getBoundingClientRect(), cs = getComputedStyle(a);
    const x = m.getContext('2d').getImageData(0, 0, m.width, m.height).data;
    let tinta = 0; for (let i = 3; i < x.length; i += 4) if (x[i] > 0) tinta++;
    return { alto: PC.alto(), asaH: Math.round(r.height), asaAncho: Math.round(r.width),
             tacto: cs.touchAction, enPanel: !!a.closest('#panePnl'),
             miniTinta: tinta, miniAncho: Math.round(m.getBoundingClientRect().width),
             lienzoAncho: m.width, dpr: Math.min(3, window.devicePixelRatio || 1),
             nota: (document.getElementById('posPnlSparkNote') || {}).textContent || '' };
  });
  ok(asas !== null && asas.enPanel && asas.asaH >= 11 && asas.tacto === 'none',
     asas ? `el asa del alto está en el panel y es agarrable a dedo (${asas.asaAncho}×${asas.asaH}, ${asas.tacto})` : 'FALTA el asa del alto');
  ok(asas && asas.miniAncho > 40 && asas.miniTinta > 0,
     `el mini de la tarjeta está pintado en lo publicado (${asas && asas.miniAncho} px CSS, ${asas && asas.miniTinta} px de tinta, nota «${asas && asas.nota}»)`);
  ok(asas && asas.lienzoAncho >= asas.miniAncho * asas.dpr - 4,
     `y a la resolución del dispositivo (${asas && asas.lienzoAncho} de lienzo para ${asas && asas.miniAncho} px CSS a ${asas && asas.dpr}x)`);
  if (asas) {
    const cajaAsa = await p.evaluate(() => { const r = document.getElementById('pnlPaneResize').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
    await p.mouse.move(cajaAsa.x, cajaAsa.y); await p.mouse.down();
    for (let i = 1; i <= 4; i++) { await p.mouse.move(cajaAsa.x, cajaAsa.y - i * 14); await esp(60); }
    await p.mouse.up(); await esp(500);
    // El tope NO es un número escrito aquí: es el que calcula la propia app
    // (PC.techoAlto = hueco real del área menos barra de dibujo, replay, lo que la
    // escalera tiene pagado fuera del PnL y el suelo de CSS del gráfico). Y lo que de
    // verdad se comprueba es la invariante que este arreglo trajo: la CAJA del gráfico
    // coincide con su FILA de grid, o sea que ninguna vela se pinta encima de la
    // escalera (en lo publicado hasta ayer eran 157 px de solape en un 390×844).
    const tras = await p.evaluate(() => {
      const area = document.getElementById('chartArea'), wrap = document.getElementById('chartWrap'), pa = document.getElementById('paneArea');
      const q = wrap.getBoundingClientRect(), r = pa.getBoundingClientRect();
      const fila = Math.round(parseFloat(getComputedStyle(area).gridTemplateRows.split(' ')[1]));
      return { alto: PC.alto(), g: ST.get('pnlPaneAlto', null), techo: PC.techoAlto(),
               lienzo: Math.round(q.height), fila, suelo: Math.round(parseFloat(getComputedStyle(wrap).minHeight) || 0),
               solape: Math.max(0, Math.round(q.bottom - r.top)), plegada: pa.classList.contains('pnl-solo'),
               rsi: getComputedStyle(document.getElementById('paneRsi')).display };
    });
    const esperado = Math.min(asas.alto + 56, tras.techo);
    ok(tras.alto === esperado && tras.g === tras.alto,
       `arrastrar el asa estira el panel y lo guarda (${asas.alto} → ${tras.alto}, preferencia ${tras.g}; esperado ${esperado} = hueco real)`);
    ok(tras.alto <= tras.techo, `y no pasa del hueco real del teléfono (techo ${tras.techo} px, medido por la propia app)`);
    ok(tras.solape === 0 && tras.lienzo >= tras.suelo && tras.fila >= tras.suelo - 2,
       `el gráfico conserva su suelo SIN pintar sobre la escalera (caja ${tras.lienzo} / fila ${tras.fila} / suelo ${tras.suelo}, solape ${tras.solape} px)`);
    ok(!tras.plegada || tras.rsi === 'none',
     `y en estrecho el resto de la escalera se aparta si hace falta (RSI ${tras.rsi}, plegada ${String(tras.plegada)})`);
    // Se devuelve el panel a su alto de CSS para dejar la app como estaba (y para que
    // la captura del README no dependa del arrastre).
    await p.evaluate(() => document.getElementById('pnlPaneResize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await esp(350);
    const deVuelta = await p.evaluate(() => ({ alto: PC.alto(), g: ST.get('pnlPaneAlto', 'sin-clave') }));
    ok(deVuelta.alto < tras.alto && deVuelta.g === null, `doble clic: el panel vuelve al suyo (${deVuelta.alto} px) y la preferencia se borra`);
  }
  /* ─────────── G) Móvil: el recorrido EN VIVO y el asa con el dedo ─────────── */
  console.log('\n▸ G) En 390 px: mini-en-vivo en la fila abierta y arrastre a dedo');
  // Se abre posición con los botones de verdad, para que la fila ABIERTA del historial
  // tenga su mini-curva viva (la pinta PC en cada vela del replay).
  await p.evaluate(() => { if (!TE.state.position) document.getElementById('btnLong').click(); });
  await esp(700);
  await p.click('#btnStepFwd'); await esp(300); await p.click('#btnStepFwd'); await esp(400);
  // La pestaña de historial hay que ABRIRLA (con un clic de verdad): mientras está
  // cerrada su contenedor mide 0 y toda medición de la fila saldría «recortada».
  await p.evaluate(() => { const t = document.querySelector('.tab[data-tab="trades"]'); if (t) t.click(); });
  await esp(400);
  const G = await p.evaluate(() => {
    const tr = document.querySelector('#tradesBody tr.open');
    const cv = tr && tr.querySelector('canvas.tr-spark[data-live]');
    let tinta = 0;
    if (cv) { const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data;
              for (let i = 3; i < d.length; i += 4) if (d[i] > 0) tinta++; }
    const th = document.querySelectorAll('#tradesTable thead th').length;
    // En 390 px caben ~9 de las 13 columnas: la nueva es la última, así que hay que
    // DESLIZAR la tabla para verla. Se hace con el scroll del propio contenedor (es lo
    // que hace el dedo) y se comprueba que la celda llega a estar entera a la vista.
    const cuerpo = document.getElementById('tradesBody').closest('.tab-body') || document.getElementById('tradesBody').parentElement;
    const antes = { w: Math.round(cuerpo.scrollWidth), x: Math.round(cuerpo.scrollLeft) };
    cuerpo.scrollLeft = cuerpo.scrollWidth;
    const b = cv ? cv.getBoundingClientRect() : null;
    return { celdas: tr ? tr.children.length : 0, th, hayCanvas: !!cv, tinta, trazo: PC.trace.length,
             desliza: cuerpo.scrollLeft > 0, antes,
             visible: !!b && b.width > 20 && b.height > 8 && b.left >= 0 && b.right <= innerWidth + 1 };
  });
  ok(G.celdas === G.th && G.th === 13, `la fila ABIERTA publicada también cierra con su celda (${G.celdas}/${G.th})`);
  ok(G.hayCanvas && G.tinta > 30, `y su mini-en-vivo se pinta en el móvil (${G.tinta} px de tinta con ${G.trazo} velas)`);
  ok(G.visible && (G.desliza || G.antes.x > 0),
     `y la celda llega a la vista deslizando la tabla (${G.antes.w} px de tabla en ${G.antes.x} → ${G.desliza ? 'deslizada' : 'sin deslizar'}, ${G.visible ? 'entera a la vista' : 'recortada'})`);
  if (!LOCAL) await p.screenshot({ path: '/tmp/paginas-pnl-movil.png' });
  // Arrastre CON EL DEDO por CDP (setViewport con hasTouch recarga la página y con
  // intercepción de peticiones se cuelga: lo aprendido en las suites locales).
  // La medición se instala EN LA PÁGINA (no en Node): `page.evaluate` serializa la
  // función y ejecutarla aquí dentro sería un ReferenceError — g1 y g2 tienen que medir
  // exactamente lo mismo, así que comparten el helper.
  await p.evaluate(() => {
    window.__geoG = () => {
      const area = document.getElementById('chartArea'), wrap = document.getElementById('chartWrap');
      const pa = document.getElementById('paneArea'), asa = document.getElementById('pnlPaneResize');
      const r = asa.getBoundingClientRect(), q = wrap.getBoundingClientRect(), s2 = pa.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
               alto: PC.alto(), sy: window.scrollY, pie: Math.round(s2.bottom),
               techo: PC.techoAlto(), solape: Math.max(0, Math.round(q.bottom - s2.top)),
               lienzo: Math.round(q.height), suelo: Math.round(parseFloat(getComputedStyle(wrap).minHeight) || 0),
               area: Math.round(area.getBoundingClientRect().height),
               fuera: Math.max(0, Math.round(s2.bottom - area.getBoundingClientRect().bottom)) };
    };
  });
  const g1 = await p.evaluate(() => window.__geoG());
  const cdp = await p.target().createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g1.x, y: g1.y }] });
  for (let i = 1; i <= 4; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g1.x, y: g1.y - i * 14 }] }); await esp(60); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await esp(500);
  const g2 = await p.evaluate(() => Object.assign(window.__geoG(), { g: ST.get('pnlPaneAlto', null) }));
  ok(g2.alto > g1.alto && g2.alto === Math.min(g1.alto + 56, g2.techo),
     `arrastrar con el dedo estira el panel publicado y se para en el hueco real (${g1.alto} → ${g2.alto}, techo ${g2.techo})`);
  ok(g2.sy === g1.sy, `el gesto táctil no se convierte en scroll de la página (${g1.sy} → ${g2.sy})`);
  ok(g2.pie === g1.pie && g2.fuera === 0,
     `la escalera sigue anclada al pie del área y no se sale de él (pie ${g1.pie} → ${g2.pie}, fuera ${g2.fuera} px)`);
  ok(g2.solape === 0, `con el dedo pasa lo mismo que con ratón: 0 px de gráfico pintados sobre la escalera (${g2.solape})`);
  ok(g2.g === g2.alto && g2.lienzo >= g2.suelo,
     `se guarda la preferencia (${g2.g}) y el lienzo respeta su suelo de CSS (${g2.lienzo} ≥ ${g2.suelo})`);
  await p.evaluate(() => document.getElementById('pnlPaneResize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await esp(350);
  await p.evaluate(() => { if (TE.state.position) document.getElementById('btnFlatten').click(); });
  await esp(400);

  ok(errs.length === 0, `ningún error de JavaScript en el marcaje${errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''}`);
  ok(rotos.every((u) => !/pnl|chart/i.test(u)), 'ninguna petición de recursos del gráfico caída' + (rotos.length ? ` (${rotos.length} fallidas, ajenas al marcaje)` : ''));

  console.log('\n' + '─'.repeat(64));
  console.log(`${LOCAL ? 'Build local' : 'PAGES'} · PnL en el gráfico: ${pasan} superadas, ${fallan} fallidas · ${omiten} omitidas · errores JS ${errs.length}`);
  if (errs.length) console.log(errs.slice(0, 4).map((e) => '   ! ' + e).join('\n'));
  await b.close();
  process.exit(fallan || errs.length ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
