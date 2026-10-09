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
  ok(errs.length === 0, `ningún error de JavaScript en el marcaje${errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''}`);
  ok(rotos.every((u) => !/pnl|chart/i.test(u)), 'ninguna petición de recursos del gráfico caída' + (rotos.length ? ` (${rotos.length} fallidas, ajenas al marcaje)` : ''));

  console.log('\n' + '─'.repeat(64));
  console.log(`${LOCAL ? 'Build local' : 'PAGES'} · PnL en el gráfico: ${pasan} superadas, ${fallan} fallidas · ${omiten} omitidas · errores JS ${errs.length}`);
  if (errs.length) console.log(errs.slice(0, 4).map((e) => '   ! ' + e).join('\n'));
  await b.close();
  process.exit(fallan || errs.length ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
