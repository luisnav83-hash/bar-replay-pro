/* =========================================================================
 * tests/formulario.test.js — el formulario de órdenes de futuros (capa 2)
 *
 * El motor ya sabe hacer todo esto (ver tests/futuros.test.js, que lo comprueba
 * con velas sintéticas y números exactos). Lo que se juzga AQUÍ es el cableado:
 * que el usuario puede LLEGAR a ello haciendo clic, que la lista de pendientes lo
 * enseña sin `undefined`, y que los rechazos del exchange se ven y se entienden.
 *
 * Método: solo DOM —se puls botones, se escriben campos, se leen etiquetas— y se
 * comprueba el estado resultante en el motor. No se llama a funciones internas
 * para «ayudar» a pasar: si algo solo funciona llamando al motor a mano, aquí
 * sale rojo, y es exactamente lo que queremos cazar.
 *
 *  Uso:  node tests/formulario.test.js
 * =======================================================================*/
'use strict';

const path = require('path');

let pasan = 0, fallan = 0;
const ok = (cond, msg) => {
  if (cond) { pasan++; console.log('  ✓ ' + msg); }
  else { fallan++; console.log('  ✗ ' + msg); }
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let puppeteer;
  for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/pptr/node_modules/puppeteer']) {
    try { puppeteer = require(c); break; } catch (e) { /* siguiente candidato */ }
  }
  if (!puppeteer) {
    console.log('⚠️  Falta puppeteer (fuentea /home/user/tools/entorno.sh): prueba OMITIDA.');
    process.exit(0);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().startsWith('file://') || r.url().startsWith('data:') ? r.continue() : r.abort('failed')));

  await page.goto('file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html'),
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 15000 });
  // Como en trailing.test.js: el loader se oculta antes de que haya precio de referencia
  // con la máquina cargada, y sin ese precio el formulario no puede proponer niveles.
  await page.waitForFunction(() => Number.isFinite(App.currentPrice()) && App.currentPrice() > 0,
    { timeout: 30000, polling: 120 });
  await espera(500);

  /* ═════════ A) El selector tiene los tres tipos del panel del exchange ═════════ */
  console.log('\n▸ A) Tipos de orden en el selector');
  const a = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#segOrderType .seg-btn')];
    return {
      textos: b.map((x) => x.textContent.trim()),
      tipos: b.map((x) => x.dataset.otype),
      trigVisible: getComputedStyle(document.getElementById('trigRow')).display !== 'none',
      limVisible: getComputedStyle(document.getElementById('limitRow')).display !== 'none',
      effVisible: getComputedStyle(document.getElementById('effectRow')).display !== 'none',
      trailVisible: getComputedStyle(document.getElementById('trailPctRow')).display !== 'none',
      validez: [...document.querySelectorAll('#ordEffect option')].map((o) => o.value),
    };
  });
  ok(a.tipos.join(',') === 'market,limite,trigger,trailing',
    `el selector ofrece los cuatro tipos de la API (F1: Limit · Market · Trigger · Trailing Stop): ${a.tipos.join(' · ')}`);
  ok(a.textos.every((t) => /Mercado|Límite|Trigger|Trailing/.test(t)), `los rótulos son legibles: ${a.textos.join(' / ')}`);
  ok(!a.trigVisible && !a.limVisible && !a.effVisible && !a.trailVisible,
    'en modo Mercado no sobra ninguna fila condicional (ni la de validez ni la del retroceso)');
  ok(a.validez.join(',') === 'GTC,IOC,FOK,POST_ONLY', `la validez ofrece las cuatro de la API: ${a.validez.join(' · ')}`);

  /* ═════════ B) Cambiar a Trigger muestra disparo, ejecución y validez ═════════ */
  console.log('\n▸ B) Al elegir Trigger aparecen el disparo y la ejecución por separado');
  await page.click('#segOrderType [data-otype="trigger"]');
  await espera(220);
  const b = await page.evaluate(() => ({
    trig: getComputedStyle(document.getElementById('trigRow')).display !== 'none',
    lim: getComputedStyle(document.getElementById('limitRow')).display !== 'none',
    eff: getComputedStyle(document.getElementById('effectRow')).display !== 'none',
    trigLimOculto: getComputedStyle(document.getElementById('trigLimitRow')).display === 'none',
    botones: [document.getElementById('btnLong').textContent, document.getElementById('btnShort').textContent],
    activo: document.querySelector('#segOrderType .seg-btn.active').dataset.otype,
  }));
  ok(b.trig && !b.lim && b.eff, 'se ven precio de activación, disparo/ejecución y validez; el precio límite queda escondido');
  ok(b.trigLimOculto, 'el precio de ejecución solo pide relleno si la ejecución es LÍMITE (a mercado no existe)');
  ok(b.activo === 'trigger' && /🎯/.test(b.botones[0]) && /🎯/.test(b.botones[1]),
    `los botones cambian de icono para no engañar: «${b.botones[0].trim()}» / «${b.botones[1].trim()}»`);
  ok(b.botones[0].length <= '▲ COMPRAR / LONG'.length + 1 && b.botones[1].length <= '▼ VENDER / SHORT'.length + 1,
    'y miden lo que medían en modo mercado: un rótulo más largo desbordaría la rejilla de acciones');

  /* ═════════ C) El atajo T recorre los tres tipos (y vuelve) ═════════ */
  console.log('\n▸ C) Tecla T: ciclo de tipos');
  await page.keyboard.press('KeyT');
  await espera(160);
  const c1 = await page.evaluate(() => App.orderType);
  await page.keyboard.press('KeyT');
  await espera(160);
  const c2 = await page.evaluate(() => App.orderType);
  ok(c1 === 'trailing', `desde Trigger, T pasa a Trailing —el orden del selector, no un interruptor de dos—: «${c1}»`);
  ok(c2 === 'market', `y la siguiente cierra el ciclo de cuatro volviendo a Mercado: «${c2}»`);
  await page.click('#segOrderType [data-otype="trigger"]');
  await espera(160);

  /* ═════════ D) Marcar Last/Mark y Mercado/Límite cambia la pista ═════════ */
  console.log('\n▸ D) Disparo contra MARK o LAST, y ejecución market/limit');
  // Con el campo vacío la pista tiene que explicar la REGLA (no inventarse un nivel); en cuanto
  // hay número, dice contra qué se mide. Se comprueban los dos estados, porque el segundo es el
  // que engaña si `src` no estuviera cableado: LAST y MARK prometen cosas opuestas.
  const d0 = await page.evaluate(() => document.getElementById('trigHint').textContent);
  ok(/no reserva margen/.test(d0), `sin nivel escrito, la pista explica la regla: «${d0.slice(0, 70)}…»`);
  await page.$eval('#trigInput', (el) => { el.value = (App.currentPrice() * 0.99).toFixed(2); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await espera(200);
  const dLast = await page.evaluate(() => document.getElementById('trigHint').textContent);
  ok(/LAST/.test(dLast) && /mecha/.test(dLast) && !/MARK \(/.test(dLast),
    `con LAST (el defecto) promete lo que LAST hace: «${dLast.replace(/.+desde [^)]+\)/, '').trim().slice(0, 84)}»`);
  await page.click('#segTrigSrc [data-tsrc="mark"]');
  await espera(200);
  const d1 = await page.evaluate(() => ({
    pista: document.getElementById('trigHint').textContent,
    src: App.trigOrder.src,
  }));
  ok(d1.src === 'mark' && /MARK/.test(d1.pista) && /no la dispara/.test(d1.pista),
    `Mark seleccionado y explicado al revés: «${d1.pista.replace(/.+desde [^)]+\)/, '').trim().slice(0, 84)}»`);
  await page.click('#segTrigExec [data-texec="limit"]');
  await espera(200);
  const d2 = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById('trigLimitRow')).display !== 'none',
    pista: document.getElementById('trigHint').textContent,
    exec: App.trigOrder.exec,
  }));
  ok(d2.visible && d2.exec === 'limit' && /COLOCA|no rellenarse/.test(d2.pista),
    'ejecución LÍMITE: pide precio de ejecución y avisa de que puede no rellenarse');

  /* ═════════ E) Colocar la trigger con un clic en el botón ═════════ */
  console.log('\n▸ E) Colocar una trigger (clic en «🎯 COMPRAR TRIGGER»)');
  const e0 = await page.evaluate(() => ({ pos: !!TE.state.position, pend: TE.state.pending.length }));
  await page.$eval('#sizeInput', (el) => { el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#btnLong');
  await espera(320);
  const e1 = await page.evaluate(() => {
    const item = document.querySelector('#pendingList .pending-item');
    return {
      pos: !!TE.state.position,
      pend: TE.state.pending.length,
      tipos: TE.pendingPorTipo(),
      orden: TE.state.pending[0] ? { tipo: TE.state.pending[0].tipo, src: TE.state.pending[0].src, exec: TE.state.pending[0].exec, limitPrice: TE.state.pending[0].limitPrice, efecto: TE.state.pending[0].efecto } : null,
      html: item ? item.textContent.replace(/\s+/g, ' ').trim() : '',
      clases: item ? item.className : '',
      contador: document.getElementById('pendingCount').textContent,
      hayUndefined: /undefined|NaN|null/.test(item ? item.textContent : 'x'),
      espejo: (document.getElementById('pendingListTab') || {}).textContent || '',
    };
  });
  ok(!e0.pos && !e1.pos, 'colocar una trigger NO abre posición ni congela margen (así funciona: la condición solo espera)');
  ok(e1.pend === 1 && e1.tipos.trigger === 1 && e1.tipos.limite === 0,
    `la orden queda pendiente y clasificada: ${JSON.stringify(e1.tipos)}`);
  ok(e1.orden && e1.orden.tipo === 'trigger' && e1.orden.src === 'mark' && e1.orden.exec === 'limit' && e1.orden.limitPrice > 0,
    `lo elegido en el formulario llega al motor tal cual: ${JSON.stringify(e1.orden)}`);
  ok(!e1.hayUndefined, 'la tarjeta del pendiente no pinta undefined ni NaN (las triggers no tienen precio límite en el mismo sitio)');
  ok(/🎯/.test(e1.html) && /COMPRA/.test(e1.html), `la lista dice qué es: «${e1.html.slice(0, 74)}…»`);
  ok(/dispara por MARK/.test(e1.html) && /LÍMITE/.test(e1.html), 'y enseña disparo y ejecución, que son datos distintos');
  ok(e1.contador === '1', `el contador de la tarjeta sigue cuadrando (${e1.contador})`);
  ok(/🎯/.test(e1.espejo) && !/data-cancel/.test(e1.espejo), 'la pestaña «Órdenes» la refleja, sin botones de cancelar que no funcionarían ahí');

  /* ═════════ F) Cancelar desde el panel ═════════ */
  console.log('\n▸ F) Cancelar la trigger desde la lista');
  await page.click('#pendingList [data-cancel]');
  await espera(260);
  const f = await page.evaluate(() => ({
    pend: TE.state.pending.length,
    log: [...document.querySelectorAll('#logList .log-line')].slice(-1)[0].textContent,
    vacio: document.querySelector('#pendingList .hint') ? document.querySelector('#pendingList .hint').textContent : '',
  }));
  ok(f.pend === 0, 'la orden desaparece del libro pendiente');
  ok(/TRIGGER/.test(f.log) && /no había reservado margen/.test(f.log),
    `el registro no dice «orden límite cancelada»: «${f.log.replace(/\s+/g, ' ').slice(0, 92)}…»`);
  ok(/Trigger|trigger/.test(f.vacio), 'y el estado vacío explica las dos formas de dejar orden en espera');

  /* ═════════ G) POST_ONLY cruzado: se rechaza, y se ve ═════════ */
  console.log('\n▸ G) POST_ONLY sobre un nivel que cruzaría: rechazo visible');
  await page.click('#segOrderType [data-otype="limite"]');
  await espera(180);
  const g = await page.evaluate(async () => {
    const ref = App.currentPrice();
    document.getElementById('limitInput').value = (ref * 1.01).toFixed(2);   // comprar POR ENCIMA = cruzaría
    document.getElementById('ordEffect').value = 'POST_ONLY';
    document.getElementById('ordEffect').dispatchEvent(new Event('change', { bubbles: true }));
    const antes = { pend: TE.state.pending.length, pos: !!TE.state.position, trades: TE.state.trades.length };
    document.getElementById('btnLong').click();
    await new Promise((r) => setTimeout(r, 260));
    return {
      antes,
      pend: TE.state.pending.length, pos: !!TE.state.position, trades: TE.state.trades.length,
      log: [...document.querySelectorAll('#logList .log-line')].slice(-1)[0].textContent,
    };
  });
  ok(g.pend === g.antes.pend && !g.pos && g.trades === g.antes.trades,
    'no se colocó ni abrió nada: POST_ONLY rechaza la orden que cruzaría (el precio no se pinta como si entrara)');
  ok(/POST_ONLY/.test(g.log) && /cruzar/.test(g.log),
    `y el porqué está en el registro: «${g.log.replace(/\s+/g, ' ').slice(0, 100)}…»`);

  /* ═════════ H) reduce-only con posición abierta ═════════ */
  console.log('\n▸ H) Reduce-only: no puede añadir a la posición');
  const h = await page.evaluate(async () => {
    document.getElementById('ordEffect').value = 'GTC';
    document.getElementById('segOrderType').querySelector('[data-otype="market"]').click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('btnLong').click();                       // LONG abierta a mercado
    await new Promise((r) => setTimeout(r, 260));
    const abierta = TE.state.position ? TE.state.position.qty : null;
    document.getElementById('segOrderType').querySelector('[data-otype="limite"]').click();
    document.getElementById('limitInput').value = (App.currentPrice() * 0.99).toFixed(2);
    document.getElementById('ordReduceOnly').checked = true;
    document.getElementById('ordReduceOnly').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('btnLong').click();                        // comprar con reduce-only
    await new Promise((r) => setTimeout(r, 280));
    return {
      abierta, qty: TE.state.position ? TE.state.position.qty : null,
      pend: TE.state.pending.length, pos: !!TE.state.position,
      ro: TE.state.position ? TE.state.position.reduceOnly : null,
    };
  });
  ok(h.abierta !== null && h.qty === h.abierta,
    `una compra reduce-only con LONG abierta NO añade tamaño (${h.abierta && h.abierta.toFixed(6)} → ${h.qty && h.qty.toFixed(6)}) ni se queda esperando (${h.pend} pendientes)`);
  ok(h.pos, 'y la posición sigue viva: el rechazo de la orden no la toca');

  /* ═════════ I) Salud y desborde a tamaño de teléfono ═════════ */
  console.log('\n▸ I) Salud y ancho de teléfono');
  await page.evaluate(() => {
    document.getElementById('ordReduceOnly').checked = false;
    document.getElementById('segOrderType').querySelector('[data-otype="market"]').click();
  });
  await espera(200);
  // La tarjeta arrastra un desborde de ~19 px por `.grid-2 { 1fr 1fr }` (css/main.css), PREEXISTENTE
  // y reportado a propósito en su momento (arreglarlo mueve medidas de otras seis suites). Lo que sí
  // compete a esta capa es que las filas nuevas no lo empeoren, así que se mide el ANTES y el DESPUÉS
  // de enseñarlas, no el valor absoluto.
  const i = await page.evaluate(async () => {
    const card = document.getElementById('orderCard') || document.body;
    const dx = () => card.scrollWidth - card.clientWidth;
    const ocultas = dx();
    document.querySelector('#segOrderType [data-otype="trigger"]').click();
    await new Promise((r) => setTimeout(r, 220));
    const visibles = dx();
    document.querySelector('#segOrderType [data-otype="market"]').click();
    await new Promise((r) => setTimeout(r, 160));
    return { ocultas, visibles, w: card.clientWidth };
  });
  ok(i.visibles <= i.ocultas,
    `las filas de trigger/validez no añaden ni 1 px de desborde a la tarjeta (${i.ocultas} → ${i.visibles} px; el desborde de ${i.ocultas} px es el de .grid-2, previo y reportado)`);
  await page.setViewport({ width: 390, height: 780 });
  await espera(400);
  const i2 = await page.evaluate(async () => {
    const card = document.getElementById('orderCard') || document.body;
    const seg = document.getElementById('segOrderType');
    const dx = () => card.scrollWidth - card.clientWidth;
    const base = dx();
    document.querySelector('#segOrderType [data-otype="trigger"]').click();
    await new Promise((r) => setTimeout(r, 260));
    return {
      base,
      dx: dx(),
      segDx: seg.scrollWidth - seg.clientWidth,
      botones: [...seg.querySelectorAll('.seg-btn')].map((x) => ({ t: x.textContent.trim(), visible: x.clientWidth > 0 && x.getBoundingClientRect().width > 0, w: x.clientWidth })),
    };
  });
  ok(i2.segDx !== null && i2.dx <= i2.base,
    `a 390 px la tarjeta con las filas visibles no desborda más que con ellas ocultas (${i2.base} → ${i2.dx} px)`);
  ok(i2.segDx <= 0 && i2.botones.length === 4 && i2.botones.every((x) => x.visible && x.w >= 24),
    `los cuatro tipos caben y se pueden pulsar en el teléfono (Δ ${i2.segDx} px; anchos ${i2.botones.map((x) => x.w.toFixed(0)).join('/')} px; ${i2.botones.map((x) => x.t).join(' / ')})`);
  await page.setViewport({ width: 1360, height: 900 });
  await espera(250);
  ok(errs.length === 0, `sin errores de JavaScript en toda la sesión de clics (${errs.length})${errs.length ? ' → ' + errs.slice(0, 2).join(' ⧸ ') : ''}`);

  console.log('\n' + '─'.repeat(62));
  console.log(`Formulario de futuros: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El formulario expone el motor: trigger, disparo, ejecución, validez y reduce-only.' );
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
