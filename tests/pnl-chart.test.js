/* =========================================================================
 * pnl-chart.test.js — MARCAR la posición en el gráfico y VER el PnL subir/bajar
 * (js/pnlChart.js + #btnPnl + #pnlLayer + #panePnl).
 *
 * Se comprueba sobre el ARCHIVO ÚNICO y SIN RED (el caso peor: snapshot embebido,
 * sin proxy). Los caminos que tienen botón propio se usan de verdad (abrir Long,
 * paso de vela a vela, «Cerrar todo», el interruptor y la ✕ del panel); lo que es
 * montaje del escenario —promediar, cerrar un trozo, forzar un signo— usa el motor,
 * igual que en tests/promediar.test.js, porque aquí se comprueba el DIBUJO.
 *
 * Bloques:
 *   A) Piezas en su sitio y estado «sin posición»
 *   B) Al abrir un LONG: marcador, banda, etiqueta y panel
 *   C) El PnL sube y baja: la curva crece, la flecha y los colores siguen el signo
 *   D) Cierre (resumen), SHORT, promediado y cierres parciales
 *   E) Interruptor 📈 PnL y preferencia guardada
 *   F) Móvil, scroll del gráfico, resize y salud
 *
 * Uso:  node tests/pnl-chart.test.js
 * =======================================================================*/
'use strict';

const path = require('path');

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
const cerca = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= (tol === undefined ? 1e-4 : tol);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let recursos = 0;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource|net::ERR_/.test(m.text())) { recursos++; return; }
    errs.push('consola: ' + m.text().slice(0, 160));
  });

  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    return (u.startsWith('file://') || u.startsWith('data:')) ? r.continue() : r.abort('failed');
  });

  const FILE = 'file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html');
  console.log('\n▸ Abriendo el archivo único sin red (posición marcada y PnL a la vista)');
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 15000 });
  await page.waitForFunction('window.PC && typeof PC.refresh === "function"', { timeout: 15000 });
  await espera(700);

  const paso = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) App.stepForward(); }, n);
  const debug = () => page.evaluate(() => PC.debug());
  /** Lee un número de la interfaz («+$1.234,56» → 1234.56), dentro de la página. */
  const numUI = (id) => page.evaluate((i) => {
    const t = (document.getElementById(i) || {}).textContent || '';
    const neg = /−|-/.test(t);
    const v = parseFloat(t.replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(v) ? (neg ? -Math.abs(v) : v) : NaN;
  }, id);

  /* ═════════════ A) PIEZAS EN SU SITIO, ESTADO «SIN POSICIÓN» ═════════════ */
  console.log('\n▸ A) Piezas del marcaje y arranque limpio');
  const A = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const dentro = (p, id) => !!(g(id) && g(p) && g(id).closest('#' + p) === g(p));
    const cs = (id, prop) => (g(id) ? getComputedStyle(g(id))[prop] : '');
    return {
      btn: !!g('btnPnl'), titulo: g('btnPnl') ? g('btnPnl').title : '', activo: g('btnPnl') ? g('btnPnl').classList.contains('active') : false,
      aria: g('btnPnl') ? g('btnPnl').getAttribute('aria-pressed') : null,
      capaEnChart: dentro('chartWrap', 'pnlLayer'), bandaDentro: dentro('pnlLayer', 'pnlBand'),
      tickDentro: dentro('pnlLayer', 'pnlEntryTick'), badgeDentro: dentro('pnlLayer', 'pnlBadge'),
      partes: ['pnlBadgeQty', 'pnlBadgeVal', 'pnlBadgePct', 'pnlBadgeDelta'].every((id) => !!g(id)),
      panel: !!g('panePnl'), lienzo: !!g('chartPnl'), val: !!g('pnlPaneVal'),
      nota: g('pnlPaneNote') ? g('pnlPaneNote').textContent : '', cerrar: !!g('pnlPaneClose'),
      puntero: cs('pnlLayer', 'pointerEvents'), z: Number(cs('pnlLayer', 'zIndex')), zLeyenda: Number(cs('ohlcLegend', 'zIndex')),
      enabled: PC.enabled, fuente: PC.source(), d: PC.debug(),
    };
  });
  ok(A.btn && /PnL/.test(A.titulo), 'hay un botón «📈 PnL» con su título en español');
  ok(A.activo && A.aria === 'true', 'el interruptor arranca ACTIVADO y lo dice a la accesibilidad');
  ok(A.capaEnChart && A.bandaDentro && A.tickDentro && A.badgeDentro, 'la capa (banda + tick de entrada + etiqueta) vive dentro de #chartWrap');
  ok(A.partes, 'la etiqueta tiene las cuatro cifras: lado/tamaño, PnL, % y delta de la última vela');
  ok(A.panel && A.lienzo && A.val && A.cerrar, 'el panel de PnL existe con su lienzo, su valor y su ✕');
  ok(A.puntero === 'none', `la capa no captura el puntero (${A.puntero}): se puede operar y dibujar igual`);
  ok(A.z > 0 && A.z < A.zLeyenda, `la capa va por debajo de la leyenda OHLC (z ${A.z} < ${A.zLeyenda}): no la tapa`);
  ok(A.enabled === true && A.fuente === null, 'sin posición no hay fuente que pintar (PC.source() === null)');
  ok(A.d.bandaOculta === true && A.d.velas === 0 && A.d.marcas === 0, 'y la capa está oculta, sin banda, sin curva y sin marcadores');
  ok(/sin posición/.test(A.nota), `el panel se presenta como «${A.nota}»`);

  /* ═══════════════════════ B) AL ABRIR UN LONG ═══════════════════════ */
  console.log('\n▸ B) Se abre un LONG y queda marcado en el gráfico');
  await page.evaluate(() => { document.getElementById('sizeInput').value = '30'; document.getElementById('btnLong').click(); });
  await espera(450);
  await paso(4);
  const B = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const p = TE.state.position;
    const d = PC.debug();
    const x0 = CM.timeToX(p.entryTime), yEnt = CM.priceToY(p.entryPrice), yAct = CM.priceToY(App.currentPrice());
    const rl = g('mainChart').getBoundingClientRect();
    const rb = g('pnlBand').getBoundingClientRect(), rbad = g('pnlBadge').getBoundingClientRect();
    return {
      d, lado: p.side, actual: TE.unrealized(App.currentPrice()), precio: App.currentPrice(),
      etiqueta: g('pnlBadgeVal').textContent, pct: g('pnlBadgePct').textContent, delta: g('pnlBadgeDelta').textContent,
      qtyTxt: g('pnlBadgeQty').textContent, panelVal: g('pnlPaneVal').textContent, nota: g('pnlPaneNote').textContent,
      fmtEntrada: U.fmtPrice(p.entryPrice), fmtCifras: p.qty.toLocaleString('es-ES', { maximumFractionDigits: 6 }),
      velasTraza: PC.trace.length,
      geom: { x0, yEnt, yAct,
              banda: { x: Math.round(rb.x - rl.x), y: Math.round(rb.y - rl.y), w: Math.round(rb.width), h: Math.round(rb.height) },
              badge: { x: Math.round(rbad.x - rl.x), y: Math.round(rbad.y - rl.y), w: Math.round(rbad.width), h: Math.round(rbad.height) },
              rect: { w: Math.round(rl.width), h: Math.round(rl.height) },
              tick: Math.round(g('pnlEntryTick').getBoundingClientRect().x - rl.x) },
    };
  });
  ok(B.d.vivo === true && B.lado === 'long', 'con la posición abierta PC la toma como fuente (vivo, long)');
  ok(B.d.marcas >= 1 && B.d.velas >= 2, `hay ${B.d.marcas} marcador(es) y una curva de ${B.d.velas} velas desde la entrada`);
  ok(/LONG/.test(B.qtyTxt) && B.qtyTxt.includes(B.fmtEntrada), `la etiqueta dice el lado, el tamaño y la entrada: «${B.qtyTxt}»`);
  ok(B.qtyTxt.includes(B.fmtCifras), 'y el tamaño, con separadores españoles');
  // Que la recién abierta vaya en VERDE depende del tramo que haya tocado; lo que se
  // comprueba aquí es el FORMATO: dólares, con su signo y con decimales.
  ok(/^[+\u2212-]\$[\d.,]+$/.test(B.etiqueta), `el PnL de la etiqueta va en dólares, con signo y decimales (${B.etiqueta})`);
  ok(/%\s*$/.test(B.pct), `y el porcentaje con su símbolo (${B.pct})`);
  ok(/[▲▼=]/.test(B.delta), `la etiqueta muestra cómo se ha movido la última vela (${B.delta})`);
  // Y el color se exige CONTRA EL SIGNO del motor (el paseo puede empezar ganando o
  // perdiendo según el tramo de la serie de práctica: la semana pasada tocó perder).
  const esperadoB = B.actual > 0 ? ['pos', 'ganando'] : B.actual < 0 ? ['neg', 'perdiendo'] : [B.d.colores.banda, B.d.colores.badge];
  ok(B.d.colores.banda === esperadoB[0] && B.d.colores.badge === esperadoB[1],
     `banda y etiqueta van en el color que marca el motor (PnL ${B.actual.toFixed(2)} → ${B.d.colores.banda}/${B.d.colores.badge})`);
  ok(B.d.marcasTxt.some((t) => /LONG/.test(t)), `el marcador de entrada está sobre la vela («${B.d.marcasTxt[0] || ''}»)`);
  ok(B.d.serie === B.velasTraza, `la serie del panel tiene los mismos puntos que la traza (${B.d.serie})`);
  ok(B.geom.banda.w > 0 && B.geom.banda.h >= 2, `la banda mide ${B.geom.banda.w}×${B.geom.banda.h} px entre la entrada y el precio actual`);
  ok(cerca(B.geom.banda.y, Math.min(B.geom.yEnt, B.geom.yAct), 2) && cerca(B.geom.banda.x, Math.max(0, B.geom.x0), 2),
     'la banda empieza en la vela de entrada y en el precio más alto de los dos (geometría medida, no intuición)');
  ok(cerca(B.geom.tick, Math.max(0, B.geom.x0), 2), `el tick vertical marca la vela de entrada (x ${B.geom.tick})`);
  ok(B.geom.badge.x >= -1 && B.geom.badge.x + B.geom.badge.w <= B.geom.rect.w + 1 && B.geom.badge.y + B.geom.badge.h <= B.geom.rect.h + 1,
     'la etiqueta está DENTRO del lienzo (no se sale por la derecha ni por abajo)');
  // Con la posición abierta a 3 velas, el precio actual cae arriba del todo: la
  // etiqueta tendría que sentarse encima de la leyenda OHLC. Se baja por debajo.
  const solape = await page.evaluate(() => {
    const L = document.getElementById('ohlcLegend'), b = document.getElementById('pnlBadge');
    if (!L || !b || b.offsetParent === null) return null;
    const R = (el) => { const x = el.getBoundingClientRect(); return { x: x.x, y: x.y, w: x.width, h: x.height }; };
    const A = R(L), C = R(b);
    return !(C.x + C.w <= A.x || A.x + A.w <= C.x || C.y + C.h <= A.y || A.y + A.h <= C.y);
  });
  ok(solape === false, 'la etiqueta no tapa la leyenda OHLC (se coloca por debajo)');
  ok(/velas desde la entrada/.test(B.nota), `la nota del panel cuenta el recorrido («${B.nota}»)`);
  const numB = await numUI('pnlBadgeVal');
  ok(cerca(numB, B.actual, 0.02), `la etiqueta dice el PnL del motor (${numB} ≈ ${B.actual.toFixed(4)})`);
  const numPanel = await numUI('pnlPaneVal');
  ok(cerca(numPanel, B.actual, 0.02), `y el panel repite el mismo número (${numPanel})`);
  ok(B.d.agua === 'transparent', `el panel no pinta la marca de agua de la librería (${B.d.agua})`);

  /* ═════════════ C) SUBE Y BAJA: CURVA, FLECHA Y COLORES ═════════════ */
  console.log('\n▸ C) El PnL sube y baja, y se ve');
  /* Para comprobar que la curva cruza el agua hace falta un tramo que la cruce. La
     serie de práctica no garantiza que el trozo que toca baje nunca del precio de
     entrada (con un LONG en plena subida el PnL mínimo es 0, y el marcaje no tiene
     culpa), así que el escenario se BUSCA: si por delante no hay vela que vea los
     dos lados, se cierra, se busca la entrada con futuro en ambos sentidos y se
     vuelve a abrir por la interfaz. */
  const reubicada = await page.evaluate(() => {
    // «¿Por delante de esta vela va a haber PnL en los dos sentidos?» se mide contra
    // el PRECIO DE ENTRADA (no contra el cierre de la vela del cursor: la entrada a
    // mercado se paga otro precio y ahí estaba el desacuerdo) y con una holgura del
    // 0,2 %, para que el cruce sea real y no un píxel del alto/bajo.
    const MARGEN = 1.002;
    const futuroEnLosDosLados = (desde, entrada, dir) => {
      const c = App.candles, fin = Math.min(desde + 118, c.length - 1);
      let arriba = false, abajo = false;
      for (let j = desde + 1; j <= fin; j++) {
        if (dir > 0 ? c[j].high > entrada * MARGEN : c[j].low < entrada / MARGEN) arriba = true;
        if (dir > 0 ? c[j].low < entrada / MARGEN : c[j].high > entrada * MARGEN) abajo = true;
        if (arriba && abajo) return true;
      }
      return false;
    };
    const i0 = BR.getIndex();
    const pos = TE.state.position;
    if (pos && futuroEnLosDosLados(i0, pos.entryPrice, pos.side === 'long' ? 1 : -1)) {
      return { hizo: false, desde: i0, entrada: pos.entryPrice };
    }
    const c = App.candles;
    for (let i = i0 + 1; i + 120 < c.length && i < i0 + 2500; i++) {
      if (futuroEnLosDosLados(i, c[i].close, 1)) {
        document.getElementById('btnFlatten').click();
        BR.seek(i);
        document.getElementById('sizeInput').value = '30';
        document.getElementById('btnLong').click();
        return { hizo: true, desde: i0, hasta: i, entrada: c[i].close, precio: App.currentPrice() };
      }
    }
    return { hizo: false, sinOpcion: true, desde: i0 };
  });
  ok(reubicada.sinOpcion !== true, 'el histórico ofrece un tramo con recorrido en los dos lados'
     + (reubicada.sinOpcion ? ' (y si no lo hubiera, este test lo diría con una ✗ en vez de pasar de largo)' : ''));
  if (reubicada.hizo) {
    await espera(400);
    console.log(`  · escenario buscado: la posición se reabre en la vela ${reubicada.hasta} (antes ${reubicada.desde}), entrada ${reubicada.entrada.toFixed(2)} — por delante hay velas por encima y por debajo`);
  }
  // Una sola comprobación, con mensaje distinto según el camino: lo que se exige SIEMPRE
  // es que el paseo mida una posición abierta en una vela con futuro en los dos sentidos.
  ok(reubicada.hizo ? (reubicada.hasta > reubicada.desde && Math.abs(reubicada.precio - reubicada.entrada) < 0.01)
                    : reubicada.entrada > 0,
     reubicada.hizo ? `y la posición nueva se abre al precio de esa vela (${reubicada.precio.toFixed(2)})`
                    : `el tramo que ya tocaba ya vale: la entrada (${reubicada.entrada.toFixed(2)}) tiene PnL en los dos sentidos por delante`);
  const C = await page.evaluate(() => {
    const antes = PC.trace.length;
    App.stepForward();
    const tras = PC.trace.length;
    const v = { verde: 0, rojo: 0, arriba: 0, abajo: 0, errores: [] };
    /* El paseo se alarga hasta que la curva ha pasado por los DOS lados del agua,
       con 26 velas como muestra mínima y 120 como tope. Antes se paseaban 26 velas
       fijas y se exigía el cruce: si el tramo de práctica que toca no baja del
       precio de entrada, el número nunca es negativo y la comprobación fallaba sin
       que el marcaje tuviera nada que ver (la serie de práctica no es fija del todo).
       Ahora el escenario se busca, no se espera. */
    const MAX = 120;
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      n++;
      App.stepForward();
      const t0 = PC.trace;
      const ult0 = t0[t0.length - 1].pnl;
      const mn0 = Math.min(...t0.map((x) => x.pnl)), mx0 = Math.max(...t0.map((x) => x.pnl));
      const t = PC.trace, ult = t[t.length - 1].pnl, prev = t.length > 1 ? t[t.length - 2].pnl : ult;
      const d = PC.debug();
      const banda = ult > 0 ? 'pos' : ult < 0 ? 'neg' : d.colores.banda;
      if (d.colores.banda !== banda) v.errores.push(`vela ${i}: banda «${d.colores.banda}» ≠ ${banda} (pnl ${ult.toFixed(2)})`);
      const badge = ult > 0 ? 'ganando' : ult < 0 ? 'perdiendo' : d.colores.badge;
      if (d.colores.badge !== badge) v.errores.push(`vela ${i}: etiqueta «${d.colores.badge}» ≠ pnl ${ult.toFixed(2)}`);
      const flecha = document.getElementById('pnlBadgeDelta').textContent.trim()[0];
      if (ult > prev) { v.arriba++; if (flecha !== '▲') v.errores.push(`vela ${i}: sube (${ult.toFixed(2)} vs ${prev.toFixed(2)}) y la flecha es «${flecha}»`); }
      if (ult < prev) { v.abajo++; if (flecha !== '▼') v.errores.push(`vela ${i}: baja y la flecha es «${flecha}»`); }
      if (ult > 0) v.verde++; else if (ult < 0) v.rojo++;
      if (n >= 26 && mn0 < 0 && mx0 > 0) break;   // cruce visto y muestra suficiente
    }
    const t = PC.trace, d = PC.debug();
    return { antes, tras, n, v, d, ultimo: t[t.length - 1].pnl,
             max: Math.max(...t.map((x) => x.pnl)), min: Math.min(...t.map((x) => x.pnl)) };
  });
  ok(C.tras === C.antes + 1, `cada vela añade UN punto a la curva (${C.antes} → ${C.tras})`);
  ok(C.v.errores.length === 0, `en ${C.n} velas el color y la flecha nunca mienten${C.v.errores.length ? ' → ' + C.v.errores.slice(0, 2).join(' ; ') : ''}`);
  ok(C.min < 0 && C.max > 0, `en ${C.n} velas la posición ha pasado por los dos lados del agua: ${C.min.toFixed(2)} de mínimo, ${C.max.toFixed(2)} de máximo`);
  ok(C.v.verde + C.v.rojo === C.n, `los colores se han decidido vela a vela (${C.n} velas: verde ${C.v.verde}, rojo ${C.v.rojo})`);
  ok(C.n < 120, `el paseo encontró el cruce por debajo de la entrada sin agotar las 120 velas (fueron ${C.n})`);
  ok(C.v.arriba > 0 && C.v.abajo > 0, `la flecha ha subido ${C.v.arriba} veces y bajado ${C.v.abajo}`);
  ok(C.d.max >= C.d.ultimo && C.d.min <= C.d.ultimo, `máx ${C.d.max.toFixed(2)} · último ${C.d.ultimo.toFixed(2)} · mín ${C.d.min.toFixed(2)}, en ese orden`);
  ok(C.d.colores.banda === (C.ultimo > 0 ? 'pos' : 'neg'), `acabado el paseo, la banda está en el color del signo (${C.d.colores.banda})`);

  /* ═════════════ D) CIERRE (RESUMEN), SHORT, PROMEDIADO Y PARCIALES ═════════════ */
  console.log('\n▸ D) Resumen al cerrar, SHORT, promediado y cierres parciales');
  await page.evaluate(() => document.getElementById('btnFlatten').click());
  await espera(400);
  const D0 = await page.evaluate(() => ({ d: PC.debug(), vivo: !!TE.state.position }));
  ok(!D0.vivo, '«Cerrar todo» deja la posición fuera (punto de partida limpio)');
  ok(D0.d.recap === true, 'el RESUMEN de la operación queda en pantalla (no desaparece al cerrar)');
  ok(D0.d.marcas >= 2 && D0.d.marcasTxt.some((t) => /CERRADO/.test(t)), `la salida se marca con su resultado («${(D0.d.marcasTxt.find((t) => /CERRADO/.test(t)) || '').trim()}»)`);
  ok(/cerrado/i.test(D0.d.etiqueta), `la etiqueta avisa del cierre y enseña el PnL NETO (con comisiones) («${D0.d.etiqueta}»)`);
  ok(D0.d.velas >= 2, `la curva del trade cerrado se queda en sus ${D0.d.velas} velas y muere en la salida`);
  const bruto = await page.evaluate(() => {
    const r = PC.recap;   // { entryPrice, exitPrice, qty, side }
    const dir = r.side === 'long' ? 1 : -1;
    return (r.exitPrice - r.entryPrice) * r.qty * dir;
  });
  ok(cerca(D0.d.ultimo, bruto, 0.02), `el último punto de la curva es el PnL BRUTO de la vela de salida (${D0.d.ultimo.toFixed(2)} ≈ ${bruto.toFixed(2)})`);
  const numCierre = await numUI('pnlBadgeVal');
  ok(Number.isFinite(numCierre) && cerca(numCierre, D0.d.actual, 0.05),
     `el PnL del resumen es el final realizado (${numCierre} ≈ ${D0.d.actual.toFixed(4)})`);
  await paso(6);
  const D1 = await debug();
  ok(D1.velas === D0.d.velas, 'al seguir avanzando velas la curva del trade cerrado NO crece (no hay posición que medir)');
  ok(D1.colores.banda === D0.d.colores.banda, 'ni cambia de color por arte del paseo');

  await page.evaluate(() => { document.getElementById('sizeInput').value = '20'; document.getElementById('btnShort').click(); });
  await espera(450);
  const S = await page.evaluate(() => {
    const p = TE.state.position;
    const t = App.candles[BR.getIndex()];
    // Promediado y nivel de TP montados con el motor (aquí se comprueba el dibujo).
    TE.addToPosition('short', { entryPrice: t.close, size: +(p.qty * 0.4).toFixed(8), time: t.time });
    TE.addTpLevel(+(t.close * 0.99).toFixed(2), 25);
    PC._sig = ''; PC.refresh(true);
    const d = PC.debug();
    return { d, lado: d.etiqueta, entry: TE.state.position.entryPrice, qty: TE.state.position.qty, partes: TE.state.position.parts.length };
  });
  ok(/SHORT/.test(S.lado), `una posición en corto se marca como SHORT (${S.lado})`);
  ok(S.partes === 2 && S.d.marcas >= 2 && S.d.marcasTxt.some((t) => /#2/.test(t)), `el promediado deja su punto «#2 …» (${S.d.marcasTxt.join(' | ')})`);
  ok(S.d.velas >= 1 && cerca(S.d.ultimo, 0, 0.02), 'añadir al precio actual deja el PnL en cero: la curva arranca plana desde la media nueva');
  const par = await page.evaluate(() => {
    const t = App.candles[BR.getIndex()];
    TE.reducePosition(0.25, t.close, t.time, 'parcial');
    PC._sig = ''; PC.refresh(true);
    const d = PC.debug();
    return { d, vivo: !!TE.state.position, qty: TE.state.position ? TE.state.position.qty : null,
             realizado: document.getElementById('pnlBadgeReal').textContent, oculto: document.getElementById('pnlBadgeReal').classList.contains('hidden') };
  });
  ok(par.vivo && par.qty !== null, 'el cierre parcial no mata la posición ni la curva');
  ok(par.d.marcasTxt.some((t) => /parcial/.test(t)), `y deja su marcador en la vela («${(par.d.marcasTxt.find((t) => /parcial/.test(t)) || '').trim()}»)`);
  ok(/realizado/.test(par.realizado) && !par.oculto, `la etiqueta enseña además lo ya realizado (${par.realizado})`);
  const neg = await page.evaluate(() => {
    const p = TE.state.position;
    p.entryPrice = App.currentPrice() * 0.995;            // el short pasa a perder
    PC._sig = ''; PC.refresh(true);
    const d = PC.debug();
    return { d, pnl: TE.unrealized(App.currentPrice()), etiqueta: document.getElementById('pnlBadgeVal').textContent,
             panel: document.getElementById('pnlPaneVal').textContent };
  });
  ok(neg.d.colores.banda === 'neg' && neg.d.colores.badge === 'perdiendo', `con el PnL en contra, banda y etiqueta se ponen rojas (${neg.d.colores.banda}/${neg.d.colores.badge})`);
  const numNeg = await numUI('pnlBadgeVal');
  ok(numNeg < 0 && cerca(numNeg, neg.pnl, 0.02), `y el número es el negativo del motor (${numNeg} ≈ ${neg.pnl.toFixed(4)})`);
  ok(neg.panel.startsWith('−'), `el panel también lo pinta en negativo (${neg.panel})`);

  /* ═════════ G) ASA DEL ALTO DEL PANEL: ARRASTRE, TOPE, TECLADO, PERSISTENCIA ═════════ */
  console.log('\n▸ G) El panel de PnL se estira arrastrando su asa');
  const Rs0 = await page.evaluate(() => {
    const a = document.getElementById('pnlPaneResize'), p = document.getElementById('panePnl');
    const r = a.getBoundingClientRect(), cs = getComputedStyle(a);
    return {
      alto: PC.alto(), guardado: ST.get('pnlPaneAlto', null),
      asa: { w: Math.round(r.width), h: Math.round(r.height), role: a.getAttribute('role'),
             tab: a.getAttribute('tabindex'), label: a.getAttribute('aria-label') || '',
             curso: cs.cursor, tacto: cs.touchAction },
      lienzo: Math.round(document.getElementById('mainChart').getBoundingClientRect().height),
      dentro: !!(p && p.contains(a)),
    };
  });
  ok(Rs0.asa.role === 'separator' && Rs0.asa.tab === '0' && /pnL|PnL/.test(Rs0.asa.label),
     `el asa es un separador accesible (role ${Rs0.asa.role}, tabindex ${Rs0.asa.tab}, «${Rs0.asa.label}»)`);
  ok(Rs0.asa.curso === 'ns-resize' && Rs0.asa.tacto === 'none',
     `el asa anuncia ns-resize y corta el scroll del dedo (${Rs0.asa.curso} / ${Rs0.asa.tacto})`);
  ok(Rs0.dentro && Rs0.asa.h >= 6 && Rs0.asa.w > 200, `asa medible DENTRO del panel: ${Rs0.asa.w}×${Rs0.asa.h} px`);
  ok(Rs0.guardado === null, 'sin tocar nada no hay alto guardado: manda lo que dice el CSS');

  // Arrastre real con el ratón, desde el centro del asa, 8 pasos de 12 px hacia arriba.
  const caja = await page.evaluate(() => {
    const r = document.getElementById('pnlPaneResize').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(caja.x, caja.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(caja.x, caja.y - i * 12); await espera(25); }
  await page.mouse.up();
  await espera(400);
  const Rs1 = await page.evaluate(() => ({
    d: PC.debug(),
    lienzo: Math.round(document.getElementById('mainChart').getBoundingClientRect().height),
  }));
  ok(Rs1.d.alto === Rs0.alto + 96, `arrastrar 96 px hacia arriba estira el panel 96 px (${Rs0.alto} → ${Rs1.d.alto})`);
  ok(Rs1.lienzo < Rs0.lienzo, `y el gráfico cede el sitio exacto (lienzo ${Rs0.lienzo} → ${Rs1.lienzo})`);
  ok(Rs1.d.asa.val === String(Rs1.d.alto), `el separador dice su alto (aria-valuenow ${Rs1.d.asa.val})`);
  ok(Rs1.d.altoGuardado === Rs1.d.alto, 'el alto se guarda AL SOLTAR, no en cada fotograma del arrastre');

  // Tope: se tira con todo (900 px) y el panel no puede comerse el gráfico.
  // El ASA se ha movido con el panel (el panel crece hacia arriba), así que su
  // posición se vuelve a medir AQUÍ: reutilizar la de antes dejaba el ratón sobre
  // el gráfico y el arrastre no hacía nada (ese era el ✗, no un tope roto).
  const cajaTope = await page.evaluate(() => {
    const r = document.getElementById('pnlPaneResize').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(cajaTope.x, cajaTope.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(cajaTope.x, cajaTope.y - i * 150); await espera(25); }
  await page.mouse.up();
  await espera(400);
  const Rs2 = await page.evaluate(() => ({
    d: PC.debug(),
    area: Math.round(document.getElementById('chartArea').getBoundingClientRect().height),
    lienzo: Math.round(document.getElementById('mainChart').getBoundingClientRect().height),
  }));
  const tope = Math.min(Rs2.d.altoMax, Math.max(Rs2.d.altoMin + 40, Math.round(Rs2.area * 0.45)));
  ok(Rs2.d.alto === tope, `el asa se topa con lo que cabe: alto ${Rs2.d.alto} (tope ${tope} = 45 % del área de ${Rs2.area})`);
  ok(Rs2.lienzo >= 150, `y el gráfico conserva sus 150 px de contrato (${Rs2.lienzo} px)`);

  // Teclado: el asa es focusable y las flechas ajustan (Mayús = paso grande).
  await page.evaluate(() => document.getElementById('pnlPaneResize').focus());
  // Se baja 5 pasos primero: si no, el paso grande de Mayús choca contra el tope
  // y el número deja de decir nada de la tecla (eso era el ✗, no un keyboard roto).
  for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowDown'); await espera(90); }
  await espera(200);
  const Rs3 = await page.evaluate(() => PC.debug());
  ok(Rs3.alto === Rs2.d.alto - 60, `las flechas ajustan de 12 en 12 (${Rs2.d.alto} → ${Rs3.alto}, cinco pulsaciones)`);
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Shift');
  await espera(300);
  const Rs4 = await page.evaluate(() => PC.debug());
  ok(Rs4.alto === Rs3.alto + 40, `con Mayús el paso es de 40 (${Rs3.alto} → ${Rs4.alto})`);

  // Persistencia de verdad: OTRA pestaña, mismo origen, arranque nuevo.
  const pAlta = await browser.newPage();
  await pAlta.setViewport({ width: 1440, height: 900 });
  await pAlta.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pAlta.waitForFunction('window.App && App.candles.length > 0', { timeout: 40000 });
  await pAlta.waitForFunction('window.PC && typeof PC.refresh === "function"', { timeout: 15000 });
  await espera(700);
  const Rs5 = await pAlta.evaluate(() => ({ alto: PC.alto(), g: ST.get('pnlPaneAlto', null) }));
  ok(Rs5.alto === Rs4.alto && Rs5.g === Rs4.alto,
     `otro arranque arranca con el alto guardado (${Rs5.alto} px, preferencia ${Rs5.g})`);
  await pAlta.close();

  // Doble clic: se devuelve el alto al CSS y se borra la preferencia (que el móvil
  // y el resto de bloques midan siempre el estado por defecto).
  await page.evaluate(() => {
    document.getElementById('pnlPaneResize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await espera(350);
  const Rs6 = await page.evaluate(() => ({
    d: PC.debug(),
    inline: document.getElementById('panePnl').style.height,
    g: ST.get('pnlPaneAlto', null),
  }));
  ok(Rs6.inline === '' && Rs6.g === null, 'doble clic: fuera el alto a mano y fuera la preferencia');
  ok(Rs6.d.alto === Rs0.alto, `el panel vuelve a su alto de CSS (${Rs0.alto} px)`);
  const Rs7 = await page.evaluate(() => {
    const d = PC.debug(), c = d.geometria.chart, b = d.geometria.banda, e = d.geometria.etiqueta;
    const dentro = (x) => x && x.x >= c.x - 1 && x.x + x.w <= c.x + c.w + 1 && x.y >= c.y - 1 && x.y + x.h <= c.y + c.h + 1;
    return { banda: dentro(b), etiqueta: dentro(e), d };
  });
  ok(Rs7.banda && Rs7.etiqueta, 'tras todo el meneo, banda y etiqueta siguen dentro del lienzo');

  /* ═══════════════════ H) MINI-PnL EN LA TARJETA DE LA POSICIÓN ═══════════════════ */
  console.log('\n▸ H) El mini-PnL de la tarjeta pinta el mismo recorrido');
  // Se mide píxel a píxel el canvas: verde/rojo son los colores del tema, así que
  // contar pigmento es comprobar el color SIN fiarse de ninguna clase.
  const miniMedido = () => page.evaluate(() => {
    const d = PC.debug(), c = document.getElementById('posPnlSpark'), x = c.getContext('2d');
    const dat = x.getImageData(0, 0, c.width, c.height).data;
    let verde = 0, rojo = 0, tinta = 0;
    for (let i = 0; i < dat.length; i += 4) {
      if (dat[i + 3] > 0) tinta++;
      if (dat[i + 3] > 60 && dat[i + 1] > 140 && dat[i] < 120) verde++;
      if (dat[i + 3] > 60 && dat[i] > 180 && dat[i + 1] < 130) rojo++;
    }
    // «máx +$4,17 · mín −$20,76»: el menos del DOM es tipográfico (U+2212), así que
    // se normaliza ANTES de parsear (si no, el mínimo sale positivo y la comparación
    // miente).
    const txt = ((d.mini || {}).nota || '').replace(/\u2212/g, '-');
    const nums = (txt.match(/-?\$[\d.]+,\d{2}/g) || [])
      .map((t) => parseFloat(t.replace(/[$.]/g, '').replace(',', '.')));
    return { d, tinta, verde, rojo, nums, nota: d.mini.nota, vacio: d.mini.vacio,
             actual: TE.state.position ? TE.unrealized(App.currentPrice()) : NaN,
             cw: d.mini.cw, bw: d.mini.w };
  });
  const Sp0 = await miniMedido();
  ok(Sp0.d.mini && Sp0.cw > 60 && Sp0.d.mini.h >= 20,
     `el mini existe en la tarjeta (${Sp0.cw}×${Sp0.d.mini.h} px CSS, lienzo ${Sp0.bw} px)`);
  await page.evaluate(() => { document.getElementById('sizeInput').value = '30'; document.getElementById('btnLong').click(); });
  await espera(400);
  await paso(18);
  await espera(450);
  const Sp1 = await miniMedido();
  ok(Sp1.vacio === false && Sp1.tinta > 200, `con posición el mini se pinta (${Sp1.tinta} px con tinta, nota «${Sp1.nota}»)`);
  ok(Sp1.nums.length === 2 && cerca(Sp1.nums[0], Sp1.d.max, 0.02) && cerca(Sp1.nums[1], Sp1.d.min, 0.02),
     `su «máx/mín» ES el de la traza (${Sp1.nums.join(' / ')} vs ${Sp1.d.max.toFixed(2)} / ${Sp1.d.min.toFixed(2)})`);
  // El color del mini tiene que seguir el signo del último punto —no un deseo del
  // test: con la serie de práctica el paseo de 18 velas puede acabar en verde o en
  // rojo, y en los dos casos el mini debe decirlo.
  ok(Sp1.d.ultimo > 0 ? Sp1.verde > Sp1.rojo : Sp1.rojo > Sp1.verde,
     `el trazo va en el color del signo (último ${Sp1.d.ultimo.toFixed(2)} → ${Sp1.verde} px verdes / ${Sp1.rojo} rojos)`);
  ok(cerca(Sp1.actual, Sp1.d.ultimo, 0.02), `el punto final del mini es el PnL del motor (${Sp1.actual.toFixed(2)})`);
  // En contra: se pone rojo. Se fuerza la entrada para que el corto nazca perdiendo.
  await page.evaluate(() => { document.getElementById('btnFlatten').click(); });
  await espera(300);
  await page.evaluate(() => { document.getElementById('sizeInput').value = '20'; document.getElementById('btnShort').click(); });
  await espera(300);
  // En un CORTO, para nacer perdiendo hay que bajarle la entrada (el PnL del corto es
  // entrada − precio; al subirla se ganaría). Se fuerza un 4 %: más de lo que se
  // mueve BTC en 10 velas de 1h, así que el caso «en contra» está garantizado y el
  // test lo comprueba ANTES de mirar el color (si el escenario no diera, diría ✗).
  await page.evaluate(() => { const p = TE.state.position; if (p) p.entryPrice *= 0.96; });
  await paso(10);
  await espera(450);
  const Sp2 = await miniMedido();
  ok(Sp2.d.ultimo < 0, `el corto forzado va en contra de verdad (${Sp2.d.ultimo.toFixed(2)})`);
  ok(Sp2.rojo > Sp2.verde, `y el mini se pinta de rojo (${Sp2.verde} verdes vs ${Sp2.rojo} rojos)`);
  // Sin traza: vacío Y dicho (no se queda con el dibujo anterior pegado).
  await page.evaluate(() => { document.getElementById('btnFlatten').click(); PC.forgetSeries(); });
  await espera(350);
  const Sp3 = await miniMedido();
  ok(Sp3.vacio === true && Sp3.tinta === 0, `sin traza el mini se queda vacío y lo dice («${Sp3.nota}»)`);
  // Decisión de diseño probada: el interruptor 📈 apaga el marcaje SOBRE EL GRÁFICO;
  // el mini vive en la tarjeta de la posición, así que sigue contando mientras haya
  // posición abierta.
  await page.evaluate(() => { document.getElementById('sizeInput').value = '25'; document.getElementById('btnLong').click(); });
  await espera(450);
  await paso(6);
  await espera(350);
  const Sp4a = await miniMedido();
  await page.evaluate(() => PC.setEnabled(false, true));
  await espera(350);
  const Sp4 = await miniMedido();
  ok(Sp4.d.panel === false && Sp4.d.bandaOculta === true, 'apagado el marcaje, el panel del gráfico desaparece y la banda se oculta');
  ok(Sp4a.tinta > 200 && Sp4.tinta > 200,
     `mientras tanto el mini de la tarjeta sigue ahí y sin cambiar (${Sp4a.tinta} → ${Sp4.tinta} px de tinta)`);
  await page.evaluate(() => PC.setEnabled(true, true));
  await espera(350);

  // Captura del incremento: el panel estirado y el mini de la tarjeta, recortada a
  // la zona donde viven las dos piezas (así se ven los detalles sin buscarlos).
  await page.evaluate(() => PC.setAlto(184, false));
  await espera(500);
  const cajaCaptura = await page.evaluate(() => {
    const p = document.getElementById('panePnl').getBoundingClientRect();
    const c = document.getElementById('positionCard').getBoundingClientRect();
    // Se sube 34 px sobre el panel para que la captura incluya su ENCABEZADO
    // («PNL · N velas desde la entrada» y el valor), que es parte de lo que se muestra.
    const x = Math.max(0, Math.min(p.left, c.left) - 8), y = Math.max(0, Math.min(p.top, c.top) - 34);
    const r = Math.max(p.right, c.right) + 8, bo = Math.max(p.bottom, c.bottom) + 8;
    return { x: Math.round(x), y: Math.round(y), width: Math.round(r - x), height: Math.round(bo - y) };
  });
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-41-alto-panel-y-mini.png'), clip: cajaCaptura });
  ok(cajaCaptura.width > 400 && cajaCaptura.height > 120,
     `captura del incremento escrita (docs/captura-41-alto-panel-y-mini.png, ${cajaCaptura.width}×${cajaCaptura.height} px)`);
  await page.evaluate(() => {
    document.getElementById('pnlPaneResize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await espera(250);

  /* ═════════════ E) INTERRUPTOR Y PREFERENCIA GUARDADA ═════════════ */
  console.log('\n▸ E) Interruptor 📈 PnL y preferencia guardada');
  const E1 = await page.evaluate(async () => {
    document.getElementById('btnPnl').click();
    await new Promise((r) => setTimeout(r, 150));
    const g = (id) => document.getElementById(id);
    return { d: PC.debug(), activo: g('btnPnl').classList.contains('active'), aria: g('btnPnl').getAttribute('aria-pressed'),
             panelOculto: g('panePnl').classList.contains('hidden'), guardado: ST.get('pnlGrafico', 'nada'),
             capaOculta: g('pnlLayer').classList.contains('hidden') };
  });
  ok(E1.activo === false && E1.aria === 'false', 'al desactivar, el botón pierde el activo y lo dice a la accesibilidad');
  ok(E1.capaOculta && E1.panelOculto, 'la capa desaparece y el panel de PnL se oculta');
  ok(E1.d.serie === 0 && E1.d.marcas === 0, 'no quedan puntos de serie ni marcadores dibujados (nada a medias)');
  ok(E1.guardado === false, `la preferencia queda guardada (ST «pnlGrafico» = ${E1.guardado})`);

  await espera(200);
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1440, height: 900 });
  await page2.setRequestInterception(true);
  page2.on('request', (r) => (r.url().startsWith('file://') || r.url().startsWith('data:')) ? r.continue() : r.abort('failed'));
  await page2.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page2.waitForFunction('window.App && window.App.candles && window.App.candles.length > 0', { timeout: 60000 });
  await page2.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 30000 });
  await espera(700);
  const E2 = await page2.evaluate(() => ({ d: PC.debug(), activo: document.getElementById('btnPnl').classList.contains('active'),
                                           guardado: ST.get('pnlGrafico', 'nada'), panelOculto: document.getElementById('panePnl').classList.contains('hidden') }));
  ok(E2.guardado === false && E2.d.enabled === false && E2.activo === false,
     'en un arranque NUEVO del mismo archivo la preferencia apagada se respeta (botón sin marcar)');
  ok(E2.d.velas === 0 && E2.d.marcas === 0 && E2.panelOculto, 'y en ese arranque no se pinta nada: ni curva, ni marcadores, ni panel');
  await page2.close();
  const E3 = await page.evaluate(async () => {
    document.getElementById('btnPnl').click();
    await new Promise((r) => setTimeout(r, 250));
    return { d: PC.debug(), activo: document.getElementById('btnPnl').classList.contains('active'), guardado: ST.get('pnlGrafico', 'nada') };
  });
  ok(E3.activo && E3.guardado === true, 'reactivado, el botón y la preferencia vuelven a estar en su sitio');
  ok(E3.d.marcas >= 1 || !E3.d.vivo, `y el marcaje reaparece con la posición (${E3.d.marcas} marcas, vivo: ${E3.d.vivo})`);
  const E4 = await page.evaluate(async () => {
    document.getElementById('pnlPaneClose').click();
    await new Promise((r) => setTimeout(r, 200));
    return { activo: document.getElementById('btnPnl').classList.contains('active'),
             oculto: document.getElementById('panePnl').classList.contains('hidden'), guardado: ST.get('pnlGrafico', 'nada') };
  });
  ok(E4.activo === false && E4.oculto && E4.guardado === false, 'la ✕ del panel es el MISMO interruptor (no un botón decorativo)');
  await page.evaluate(() => document.getElementById('btnPnl').click());
  await espera(250);

  /* ═════════════ F) MÓVIL, SCROLL, RESIZE Y SALUD ═════════════ */
  console.log('\n▸ F) Móvil, scroll del gráfico, resize y salud');
  if (await page.evaluate(() => !TE.state.position)) {
    await page.evaluate(() => { document.getElementById('sizeInput').value = '25'; document.getElementById('btnLong').click(); });
    await espera(450);
  }
  await paso(3);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });   // sin isMobile: cambiar el flag recarga
  await espera(800);
  const F = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const rl = r(g('mainChart')), rb = r(g('pnlBadge')), rbda = r(g('pnlBand'));
    const cx = Number.isFinite(rbda.x) && rbda.w > 0 ? Math.round(rbda.x + rbda.w / 2) : 0;
    const cy = Number.isFinite(rbda.y) && rbda.h > 0 ? Math.round(rbda.y + rbda.h / 2) : 0;
    const centro = document.elementFromPoint(cx, cy);
    return {
      d: PC.debug(), chart: rl, badge: rb, banda: rbda, panelAlto: r(g('panePnl')).h,
      inner: [window.innerWidth, document.documentElement.clientWidth, Math.round(g('chartWrap').getBoundingClientRect().width)],
      badgeDentro: rb.x >= rl.x - 1 && rb.x + rb.w <= rl.x + rl.w + 1 && rb.y >= rl.y - 1 && rb.y + rb.h <= rl.y + rl.h + 1,
      capaAncha: Math.abs(r(g('pnlLayer')).w - rl.w) <= 2,
      tocaGrafico: !!(centro && (centro.tagName === 'CANVAS' || (g('chartWrap').contains(centro) && !['pnlBand', 'pnlLayer'].includes(centro.id)
                       && getComputedStyle(centro).pointerEvents === 'none'))),
      aQuien: centro ? String(centro.id || centro.tagName) : 'nada',
      bandaViva: !g('pnlBand').classList.contains('hidden') && rbda.w > 0 && rbda.h >= 2,
      bandaColor: g('pnlBand').classList.contains('pos') ? 'pos' : g('pnlBand').classList.contains('neg') ? 'neg' : '',
      ox: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  ok(F.badgeDentro, `en 390×844 la etiqueta cabe dentro del gráfico (${F.badge.x},${F.badge.y} ${F.badge.w}×${F.badge.h} en un lienzo de ${F.chart.w}×${F.chart.h})`);
  ok(F.bandaViva && F.bandaColor !== '', `la banda se ve en el móvil (${F.banda.w}×${F.banda.h}, color ${F.bandaColor})`);
  ok(F.capaAncha, 'la capa cubre exactamente el ancho del lienzo (no se desalinea con el eje de precio)');
  ok(F.tocaGrafico, `el centro de la banda recibe el puntero sobre el gráfico (cae en «${F.aQuien}»: la capa no se come el gesto)`);
  ok(F.inner[0] === F.inner[1] && F.inner[2] <= F.inner[0] + 2, `el layout del móvil es de verdad de 390 (${F.inner.join(' / ')})`);
  ok(F.ox === 0, `sin scroll horizontal en el móvil (${F.ox} px)`);
  ok(F.panelAlto <= 100 && F.panelAlto >= 60, `el panel de PnL en móvil mide ${F.panelAlto} px (no se come el terminal)`);
  // En móvil el asa tiene que seguir siendo agarrable y el mini tiene que dibujarse
  // a la resolución real del dispositivo (deviceScaleFactor 2 en esta corrida).
  const Mo = await page.evaluate(() => {
    const m = document.getElementById('posPnlSpark'), a = document.getElementById('pnlPaneResize');
    const r = m.getBoundingClientRect(), ra = a.getBoundingClientRect(), cs = getComputedStyle(a);
    return { cw: Math.round(r.width), dpr: Math.min(3, window.devicePixelRatio || 1),
             bw: m.width, bh: m.height, asaW: Math.round(ra.width), asaH: Math.round(ra.height),
             tacto: cs.touchAction, enTarjeta: !!m.closest('#positionCard'),
             enFila: !!m.closest('.kv'), nota: (document.getElementById('posPnlSparkNote') || {}).textContent || '' };
  });
  ok(Mo.bw >= Mo.cw * Mo.dpr - 4 && Mo.bh >= 20 * Mo.dpr - 4,
     `el mini se dibuja a ${Mo.dpr}x en el móvil (lienzo ${Mo.bw}×${Mo.bh} para ${Mo.cw} px CSS)`);
  ok(Mo.asaH >= 11 && Mo.asaW > 60 && Mo.tacto === 'none',
     `el asa sigue siendo agarrable a dedo (${Mo.asaW}×${Mo.asaH} px, touch-action ${Mo.tacto})`);
  ok(Mo.enTarjeta && Mo.enFila, `el mini vive en la fila de la tarjeta de la posición (nota «${Mo.nota}»)`);
  ok(F.d.velas >= 2 && F.d.marcas >= 1, `y sigue pintando ${F.d.velas} velas de curva con ${F.d.marcas} marcador(es)`);

  const G = await page.evaluate(async () => {
    const g = (id) => document.getElementById(id);
    const rl = g('mainChart').getBoundingClientRect();
    const lr = CM.main.timeScale().getVisibleLogicalRange();
    const barra = lr && lr.to > lr.from ? Math.abs(rl.width / (lr.to - lr.from)) : 20;   // px por vela
    const antes = Math.round(g('pnlBand').getBoundingClientRect().x);
    CM.main.timeScale().scrollToPosition(-60, false);
    await new Promise((r) => setTimeout(r, 400));
    const movida = g('pnlBand').classList.contains('hidden') ? 'oculta' : Math.round(g('pnlBand').getBoundingClientRect().x);
    CM.main.timeScale().scrollToRealTime();
    await new Promise((r) => setTimeout(r, 400));
    // La referencia honesta no es el píxel de antes (scrollToRealTime puede dejar
    // otro margen a la derecha), sino la X ACTUAL de la vela de entrada: la banda
    // tiene que volver a empezar exactamente ahí.
    const p = TE.state.position;
    const xEntrada = p ? CM.timeToX(p.entryTime) : null;
    return { antes, movida, vuelta: Math.round(g('pnlBand').getBoundingClientRect().x),
             xEntrada: xEntrada === null ? null : Math.round(Math.max(0, xEntrada)),
             oculta: g('pnlBand').classList.contains('hidden'), barra: Math.round(barra) };
  });
  ok(typeof G.movida === 'string' ? G.movida === 'oculta' : Math.abs(G.movida - G.antes) > 4,
     `la banda sigue el scroll del gráfico (${G.antes} → ${G.movida})`);
  ok(!G.oculta && G.xEntrada !== null && Math.abs(G.vuelta - G.xEntrada) <= 3,
     `y al volver al final la banda arranca otra vez en la vela de entrada (banda x ${G.vuelta} · entrada x ${G.xEntrada})`);

  await page.setViewport({ width: 1440, height: 900 });
  await espera(600);
  const H = await page.evaluate(async () => {
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const g = (id) => document.getElementById(id);
    const rl = g('mainChart').getBoundingClientRect(), rb = g('pnlBadge').getBoundingClientRect();
    return { dentro: rb.right <= rl.right + 1 && rb.bottom <= rl.bottom + 1 && rb.width > 0 && rb.height > 0, d: PC.debug(),
             sinScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  ok(H.dentro, 'tras el resize la etiqueta sigue dentro del lienzo y visible (se recoloca en cada cuadro)');
  ok(H.d.velas >= 2 && H.d.marcas >= 1, `la curva sobrevive al resize (${H.d.velas} velas, ${H.d.marcas} marcas)`);
  ok(H.sinScroll === 0, `ningún scroll horizontal tras el resize (${H.sinScroll} px)`);
  ok(errs.length === 0, `sin errores de JavaScript en toda la suite (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);
  ok(recursos >= 1, `los únicos avisos de red son los bloqueados a propósito (${recursos} recursos abortados)`);

  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-39-pnl-en-el-grafico.png') });
  ok(true, 'captura escrita en docs/captura-39-pnl-en-el-grafico.png');

  await browser.close();
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`PnL en el gráfico: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ La posición queda marcada y su PnL se ve subir y bajar.\n');
  else { console.log('❌ El marcaje de posición/PnL falla.\n'); process.exit(1); }
})().catch((e) => { console.error('💥 Error', e); process.exit(1); });
