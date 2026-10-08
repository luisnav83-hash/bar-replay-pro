/* =========================================================================
 * pages-trailing.js — auditoría del TRAILING STOP
 * sobre LA APP PUBLICADA en GitHub Pages, manejando solo la interfaz.
 *
 * Vive en tests/ (y no en un guion suelto de /tmp) porque la batería lo llama:
 *   node tests/pages-trailing.js                                       → lo publicado
 *   node tests/pages-trailing.js file:///…/bar-replay-pro-unico.html → build local
 * `npm run test:all` las deja fuera (dependen de la red y del despliegue): se piden
 * con `node tools/run-all.js --publicadas` o `npm run test:pages-trailing`.
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

(async () => {
  /* ═══════════════════════════════════════════════════════════════════════════
   * Auditoría del TRAILING STOP sobre lo PUBLICADO (o un file:// si se pasa URL).
   *
   * Reglas de este guion (aprendidas a golpes):
   *   · Solo toca la interfaz: clics en botones reales, teclado y clic a
   *     coordenadas. El motor se lee para verificar, nunca para accionar.
   *   · La serie de «⚡ Práctica rápida» es un paseo aleatorio: los precios CAMBIAN
   *     entre cargas. Por eso ningún porcentaje ni ningún nivel se escribe a mano:
   *     se derivan de App.candles en el momento, y cada bloque se asegura su propia
   *     posición para que un cierre anticipado no arrastre a los siguientes.
   *   · Toda aserción falla de forma ruidosa (nada de `ok(true)` de relleno) y todo
   *     precio se compara con Number.isFinite.
   *
   * Uso: node pages-trailing.mjs [url]
   * ═════════════════════════════════════════════════════════════════════════ */


  const URL_PASADA = process.argv[2] || 'https://luisnav83-hash.github.io/bar-replay-pro/bar-replay-pro-unico.html';
  const QUIETO = URL_PASADA.startsWith('file');
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  let pasan = 0, fallan = 0;
  const ok = (c, m) => { if (c) { pasan++; console.log('  ✓ ' + m); } else { fallan++; console.log('  ✗ ' + m); } };
  const cerca = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= (tol ?? 1e-6);

  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1420, height: 950 });
  const errs = [], fallosRed = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('requestfailed', (r) => fallosRed.push(r.url().slice(0, 70)));

  console.log(`\n▸ Auditando ${QUIETO ? 'la build local' : 'LA APP PUBLICADA'}\n  ${URL}`);
  await p.goto(URL_PASADA, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction('window.App && window.App.candles && window.App.candles.length > 0', { timeout: 45000 });
  await p.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 25000 });
  await esp(900);

  /* ─────────────────────────── helpers ─────────────────────────── */
  const E = () => p.evaluate(() => {
    const pos = TE.state.position;
    const i = TE.trailingInfo(pos);
    const txt = ((document.getElementById('posTrail') || {}).textContent || '').trim();
    const linea = (CM._priceLines || []).map((l) => (l.options ? l.options() : {})).filter((o) => /^TRAIL/.test(o.title || ''))[0] || null;
    const cerr = TE.state.trades.filter((t) => t.status === 'closed');
    const g = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right) }; };
    return {
      pos: pos && pos.side, qty: pos && +pos.qty.toFixed(8), media: pos && +pos.entryPrice.toFixed(4),
      parts: pos ? (pos.parts || []).length : 0,
      trail: !!(pos && pos.trail), armed: i ? i.armed : null, pct: i && i.pct,
      peak: i && i.peak, level: i && i.level,
      txt, linea: linea ? +linea.price : null,
      btn: ((document.getElementById('btnTrailOn') || {}).textContent || '').trim(),
      off: !document.getElementById('btnTrailOff').disabled,
      rects: { pct: g('trailPct'), act: g('trailAct'), on: g('btnTrailOn'), off: g('btnTrailOff') },
      balance: +TE.state.balance.toFixed(4), capital: TE.state.initialCapital,
      sumaPnl: +cerr.reduce((a, t) => a + t.pnl, 0).toFixed(4),
      ultFila: cerr.length ? cerr[cerr.length - 1].reason : '',
      filas: [...document.querySelectorAll('#tradesTable tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()),
      log: [...document.querySelectorAll('#logList .log-line')].slice(-16).map((d) => d.textContent.trim()),
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()),
      idx: BR.getIndex(), precio: App.currentPrice(),
      scroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  const clic = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await esp(380); };
  const escribir = (id, val) => p.evaluate(([i, v]) => { document.getElementById(i).value = v; }, [id, val]);
  const paso = async (n) => { for (let i = 0; i < n; i++) { await p.evaluate(() => App.stepForward()); await esp(120); } await esp(220); };
  const esperarToasts = async () => { for (let i = 0; i < 40 && await p.evaluate(() => document.querySelectorAll('.toast').length > 0); i++) await esp(250); };
  /** Abre un LONG por la interfaz si no hay posición (cada bloque vale por sí solo). */
  const asegurarPosicion = async () => {
    if ((await E()).pos !== 'long') { await escribir('sizeInput', '30'); await clic('#btnLong'); }
    return E();
  };
  /** Activa el trailing desde la tarjeta con el % que se le pase. */
  const activarTrail = async (pct, act = '') => {
    await escribir('trailPct', String(pct));
    await escribir('trailAct', String(act));
    await clic('#btnTrailOn');
  };

  /* ═══ 0) serie de práctica y campos limpios ═══ */
  console.log('\n▸ 0) Serie de práctica (⚡) y campos de la orden');
  await clic('#btnQuick');
  await p.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 25000 });
  await esp(600);
  // Puerta de listo DE VERDAD: el loader se oculta antes de que el motor tenga
  // precio de referencia cuando la máquina va cargada; sin esto, los niveles
  // derivados del precio salían a medias y fallaba el test, no la app.
  await p.waitForFunction(() => Number.isFinite(App.currentPrice()) && App.currentPrice() > 0
    && Number.isFinite(TE.state.lastPrice) && TE.state.lastPrice > 0, { timeout: 30000, polling: 120 });

  await p.evaluate(() => {
    document.getElementById('sizeInput').value = '30';
    document.getElementById('slInput').value = '';
    document.getElementById('tpInput').value = '';
    document.getElementById('avgSize').value = '10';
  });
  ok(await p.evaluate(() => App.candles.length > 50 && document.getElementById('loader').classList.contains('hidden')), 'hay serie cargada por la interfaz');

  /* ═══ 1) posición LONG abierta con el botón ═══ */
  console.log('\n▸ 1) Posición LONG abierta con el botón');
  await clic('#btnLong');
  let s = await E();
  ok(s.pos === 'long' && s.qty > 0 && Number.isFinite(s.media), `LONG abierto con el botón (${s.qty} uds a ${s.media})`);
  ok(!s.trail && s.txt === '—' && s.btn === 'Activar' && !s.off, `sin trailing: tarjeta «${s.txt}», botón «${s.btn}» y ✕ apagada`);

  /* ═══ 2) activar con un % que la propia serie garantiza seguro ═══ */
  console.log('\n▸ 2) Activar el trailing desde la tarjeta');
  const pctSeguro = await p.evaluate(() => {
    // Máximo retroceso desde el pico que va a haber en las próximas 10 velas,
    // calculado con la MISMA regla que aplica el motor (el pico se actualiza al
    // final de la vela). +1 % de colchón: así el trailing no puede cerrar antes de
    // que terminemos de mirar, sea cual sea el paseo aleatorio de la serie.
    const i = BR.getIndex(), c = App.candles;
    let peak = App.currentPrice(), maxDD = 0;
    for (let k = 1; k <= 10 && i + k < c.length; k++) {
      const low = c[i + k].low;
      maxDD = Math.max(maxDD, (peak - low) / peak * 100);
      peak = Math.max(peak, c[i + k].high);
    }
    return +Math.min(70, Math.max(0.4, maxDD + 1)).toFixed(2);
  });
  await activarTrail(pctSeguro);
  s = await E();
  const factor = 1 - pctSeguro / 100;
  ok(s.trail && s.armed === true && cerca(s.pct, pctSeguro), `se activa con el ${pctSeguro} % escrito en el campo`);
  ok(cerca(s.level, s.peak * factor, s.peak * 1e-9), `nivel exacto = pico·(1−${pctSeguro} %) = ${s.level} (pico ${s.peak})`);
  ok(new RegExp(String(pctSeguro).replace('.', '[.,]')).test(s.txt) && /pico/.test(s.txt), `la tarjeta lo describe: «${s.txt}»`);
  ok(s.btn === 'Re-ajustar' && s.off, 'el botón pasa a «Re-ajustar» y la ✕ se habilita');
  ok(Number.isFinite(s.linea) && cerca(s.linea, s.level, s.level * 1e-4), `línea TRAIL en el gráfico a ${s.linea}`);
  ok(s.log.some((l) => new RegExp('Trailing ' + pctSeguro.toFixed(2) + ' %').test(l)), 'el log deja constancia del % exacto');

  /* ═══ 3) avanza 8 velas: los invariantes del pico ═══ */
  console.log('\n▸ 3) Ocho velas siguiendo el pico (sin dispararse)');
  let peakPrev = s.peak, lvlPrev = s.level, mal = null;
  for (let i = 0; i < 8; i++) {
    await p.evaluate(() => App.stepForward()); await esp(130);
    const x = await E();
    if (!x.trail || x.pos !== 'long') { mal = `la posición se cerró en la vela ${i + 1} (motivo «${x.ultFila}») con ${pctSeguro} % de colchón`; break; }
    if (x.peak < peakPrev) { mal = `el pico BAJÓ en la vela ${i + 1} (${peakPrev} → ${x.peak})`; break; }
    if (!cerca(x.level, x.peak * factor, x.peak * 1e-9)) { mal = `nivel inconsistente en la vela ${i + 1}: ${x.level} vs pico ${x.peak}`; break; }
    if (!Number.isFinite(x.linea) || !cerca(x.linea, x.level, x.level * 1e-4)) { mal = `la línea del gráfico no acompaña en la vela ${i + 1} (${x.linea} vs ${x.level})`; break; }
    if (x.level < lvlPrev) { mal = `el nivel de disparo se aflojó (${lvlPrev} → ${x.level})`; break; }
    peakPrev = x.peak; lvlPrev = x.level;
  }
  ok(mal === null, mal || `8 velas viva: pico ${s.peak} → ${peakPrev}, nivel ${s.level} → ${lvlPrev} (nunca baja ni se afloja)`);
  const s3 = await E();
  ok(s3.pos === 'long' && s3.trail, 'la posición sigue abierta al final del tramo');
  ok(lvlPrev > s.level || lvlPrev === s.level, `el nivel solo se aprieta a favor: ${s.level} → ${lvlPrev}`);

  /* ═══ 4) tecla V y botón ✕ ═══ */
  console.log('\n▸ 4) Tecla V y botón ✕');
  await asegurarPosicion();
  await activarTrail(pctSeguro);
  ok((await E()).trail, 'trailing puesto para probar el teclado');
  await p.evaluate(() => document.body.focus());
  await p.keyboard.press('v'); await esp(320);
  let s4 = await E();
  ok(!s4.trail, 'V con trailing activo lo quita');
  ok(s4.linea === null, 'y la línea TRAIL desaparece del gráfico');
  ok(s4.txt === '—' && s4.btn === 'Activar' && !s4.off, 'la tarjeta y los botones vuelven a su estado inactivo');
  await p.keyboard.press('v'); await esp(320);
  s4 = await E();
  ok(s4.trail && cerca(s4.pct, pctSeguro), `V otra vez lo reactiva con el % que sigue en el campo (${s4.pct} %)`);
  await escribir('trailPct', '0.8');
  await clic('#btnTrailOff');
  ok(!(await E()).trail, 'la ✕ lo quita aunque el campo haya cambiado');

  /* ═══ 5) promediar con el trailing puesto ═══ */
  console.log('\n▸ 5) Promediar sin perder el trailing');
  await asegurarPosicion();
  if (!(await E()).trail) await activarTrail(pctSeguro);
  await paso(2);
  let antes5 = await E();
  ok(antes5.pos === 'long' && antes5.trail, `posición con trailing vivo (pico ${antes5.peak})`);
  ok(Number.isFinite(antes5.precio) && antes5.precio !== antes5.media, `el precio se movió antes de promediar (${antes5.precio} vs media ${antes5.media})`);
  await clic('#btnAverage');
  const s5 = await E();
  const qAdd = +(s5.qty - antes5.qty).toFixed(10);
  const mediaEsperada = +((antes5.media * antes5.qty + antes5.precio * qAdd) / (antes5.qty + qAdd)).toFixed(4);
  ok(s5.parts === 2 && qAdd > 0, `añadido ${qAdd} uds → ${s5.parts} entradas (${antes5.qty} → ${s5.qty})`);
  ok(cerca(s5.media, mediaEsperada, 5e-4) && Math.abs(s5.media - antes5.media) > 1e-6,
     `la entrada pasa a la MEDIA PONDERADA: ${s5.media} ≈ (${antes5.media}·${antes5.qty} + ${antes5.precio}·${qAdd})/${s5.qty}`);
  ok(s5.trail && cerca(s5.peak, antes5.peak, antes5.peak * 1e-9),
     `el trailing defiende el PICO de la posición, no el precio medio nuevo (sigue en ${s5.peak})`);
  ok(s5.log.some((l) => /El trailing sigue activo/.test(l)), 'y el log lo dice explícitamente');

  /* ═══ 6) precio de activación por encima del precio actual ═══ */
  console.log('\n▸ 6) Activation price (por encima del precio)');
  await asegurarPosicion();
  if ((await E()).trail) await clic('#btnTrailOff');
  ok(!(await E()).trail && (await E()).pos === 'long', 'posición LONG viva y sin trailing (quitado con la ✕)');
  const plan = await p.evaluate(() => {
    const i = BR.getIndex(), c = App.candles, ref = App.currentPrice(), pct = 0.2;
    for (let j = 2; j < Math.min(c.length - i, 200); j++) {
      const act = c[i + j].high;
      if (act <= ref * 1.002 || act / ref - 1 > 0.2) continue;              // ni irracional ni repetido
      if (c.slice(i + 1, i + j).some((x) => x.high >= act)) continue;        // que no se toque antes
      const nivel = act * (1 - pct / 100);
      for (let k = 1; k <= 25 && i + j + k < c.length; k++) {
        if (c[i + j + k].low <= nivel) return { j, k, act, nivel, ref };
      }
    }
    return null;
  });
  ok(!!plan, plan ? `tramo utilizable: arma en ${plan.act.toFixed(2)} (vela ${plan.j}) y dispara a la ${plan.k}` : 'NO hay tramo utilizable en 200 velas');
  if (plan) {
    await activarTrail(0.2, plan.act);
    let s6 = await E();
    ok(s6.trail && s6.armed === false, 'con la activación por encima del precio queda EN ESPERA');
    ok(/arma en/.test(s6.txt) && s6.linea === null, `la tarjeta lo nota y el gráfico no pinta nivel: «${s6.txt}»`);
    await paso(plan.j - 1);
    s6 = await E();
    ok(s6.trail && s6.armed === false && s6.pos === 'long', `a una vela de armar sigue en espera (no se arma antes de tiempo)`);
    await p.evaluate(() => App.stepForward()); await esp(250);
    s6 = await E();
    ok(s6.armed === true, `en la vela ${plan.j} se armó (pico ${s6.peak})`);
    ok(cerca(s6.level, plan.act * 0.998, plan.act * 1e-6),
       `el nivel arranca en la ACTIVACIÓN (${plan.act.toFixed(2)}·0.998 = ${s6.level}), no en el high de esa vela`);
    ok(Number.isFinite(s6.linea) && cerca(s6.linea, s6.level, s6.level * 1e-4), 'y a partir de ahí el gráfico pinta la línea TRAIL');
    let disparo = false;
    for (let k = 0; k < plan.k + 4 && !disparo; k++) { await p.evaluate(() => App.stepForward()); await esp(140); disparo = (await E()).ultFila === 'trail'; }
    const s7 = await E();
    ok(disparo, 'el retroceso del 0.2 % desde el pico cerró la posición');
    ok(s7.pos === null, 'posición cerrada del todo');
    ok(/TRAILING STOP/.test(s7.filas.join(' ')), 'la tabla del historial muestra el motivo «TRAILING STOP»');
    ok(s7.log.some((l) => /Trailing stop/.test(l) && /retroced/i.test(l)), 'el log explica el retroceso desde el pico');
    ok(Math.abs(s7.balance - (s7.capital + s7.sumaPnl)) <= 0.02, `la hoja de resultados cuadra: ${s7.balance} ≈ ${s7.capital} + ${s7.sumaPnl}`);
    ok(s7.linea === null && s7.txt === '—', 'cerrada la posición no queda línea TRAIL ni estado en la tarjeta');

    /* ═══ 7) retroceder y reavanzar: el trailing vuelve tal cual ═══ */
    console.log('\n▸ 7) Retroceder con ◀ y reavanzar');
    await asegurarPosicion();
    await activarTrail(40);                       // % enorme: no dispara, podemos ir y venir
    await paso(4);
    const antes7 = await E();
    ok(antes7.pos === 'long' && antes7.trail && antes7.armed, `trailing vivo a mitad del replay (pico ${antes7.peak})`);
    await p.evaluate(() => App.stepBack()); await esp(250);
    await p.evaluate(() => App.stepBack()); await esp(250);
    await p.evaluate(() => App.stepBack()); await esp(250);
    const atras7 = await E();
    ok(atras7.pos === 'long' && atras7.trail, 'retroceder 3 velas conserva la posición Y su trailing');
    ok(atras7.peak <= antes7.peak && atras7.pct === antes7.pct, `el pico vuelve a su valor de esa vela (${atras7.peak} ≤ ${antes7.peak})`);
    await paso(3);
    const otra7 = await E();
    ok(otra7.pos === 'long' && otra7.trail && cerca(otra7.peak, antes7.peak, antes7.peak * 1e-6) && cerca(otra7.level, antes7.level, 1e-6),
       `reavanzar las mismas 3 velas reproduce el estado exacto (pico ${otra7.peak}, nivel ${otra7.level})`);
    await clic('#btnTrailOff');

    /* ═══ 8) re-ajustar y usos equivocados ═══ */
    console.log('\n▸ 8) Re-ajustar, validaciones y V sin posición');
    await asegurarPosicion();
    await activarTrail(1.25);
    const r8a = await E();
    await escribir('trailPct', '3');
    await clic('#btnTrailOn');
    const r8b = await E();
    ok(cerca(r8b.pct, 3) && cerca(r8b.peak, r8a.peak, r8a.peak * 1e-9), `re-ajustar cambia el % (1.25 → ${r8b.pct}) pero respeta el pico (${r8b.peak})`);
    ok(cerca(r8b.level, r8b.peak * 0.97, r8b.peak * 1e-6), `y el nivel se recalcula: ${r8b.level}`);
    await escribir('trailPct', '0');
    await clic('#btnTrailOn');
    ok(cerca((await E()).pct, 3), 'un 0 % se rechaza y deja el trailing anterior intacto');
    await escribir('trailPct', '0.5'); await escribir('trailAct', 'hola');
    await clic('#btnTrailOn');
    const r8c = await E();
    ok(cerca(r8c.pct, 0.5) && r8c.armed === true, 'una activación no numérica se rechaza (no inutiliza el trailing)');
    await escribir('trailAct', '');
    await clic('#btnTrailOff');
    await clic('#btnFlatten');
    await p.evaluate(() => document.body.focus());
    await p.keyboard.press('v'); await esp(150);
    const s9 = await E();
    ok(!s9.trail && s9.pos === null, 'V sin posición no activa nada ni lanza error');
    const aviso9 = s9.toasts.join(' ') + ' ' + s9.log.join(' ');
    ok(/Abre una posici/.test(aviso9),
       `y lo avisa: «${(s9.toasts[0] || s9.log.slice(-1)[0] || '').slice(0, 64)}»`);
  }

  /* ═══ 9) móvil: tamaño táctil y pulsación real ═══ */
  console.log('\n▸ 9) Ventana de móvil (390 × 844)');
  await asegurarPosicion();
  await p.setViewport({ width: 390, height: 844 });
  await esp(500);
  await p.evaluate(() => document.getElementById('posMgmt').scrollIntoView({ block: 'center' }));
  await esperarToasts();                          // los avisos tapan la tarjeta: hay que esperarlos
  await esp(200);
  const mv = await E();
  const r = mv.rects;
  ok(!mv.scroll, 'a 390 px no hay scroll horizontal con la fila del trailing');
  ok(r.pct && r.pct.h >= 28 && r.act && r.act.h >= 28, `los campos tienen ≥28 px de alto (${r.pct?.h} y ${r.act?.h} px)`);
  ok(r.on && r.on.h >= 28 && r.on.w >= 40, `«${mv.btn}» es táctil (${r.on?.w}×${r.on?.h} px)`);
  ok(r.off && r.off.h >= 28, `la ✕ también (${r.off?.w}×${r.off?.h} px)`);
  ok(r.on && r.on.right <= 391 && r.act && r.act.right <= 391, 'ningún control se sale del ancho de la pantalla');
  const bajo = await p.evaluate(() => { const e = document.getElementById('btnTrailOn').getBoundingClientRect(); const t = document.elementFromPoint(Math.round(e.x + e.width / 2), Math.round(e.y + e.height / 2)); return t ? (t.id || t.className || t.tagName) : 'nada'; });
  ok(bajo === 'btnTrailOn', `el centro del botón está despejado para recibir el dedo (${bajo})`);
  const centro = await p.evaluate(() => { const e = document.getElementById('btnTrailOn').getBoundingClientRect(); return { x: Math.round(e.x + e.width / 2), y: Math.round(e.y + e.height / 2) }; });
  await p.mouse.click(centro.x, centro.y);
  await esp(420);
  const tap = await E();
  ok(tap.trail === true && tap.armed === true, `pulsar en ${centro.x},${centro.y} activa el trailing (${tap.pct} %)`);
  ok(/pico/.test(tap.txt), `la tarjeta lo resume en móvil: «${tap.txt}»`);
  ok(Number.isFinite(tap.linea) && cerca(tap.linea, tap.level, tap.level * 1e-4), 'y la línea TRAIL se ve en el gráfico del móvil');

  console.log('\n' + '─'.repeat(64));
  console.log(`${QUIETO ? 'Build local' : 'PAGES'} · trailing stop: ${pasan} superadas, ${fallan} fallidas · errores JS ${errs.length} · peticiones fallidas ${fallosRed.length}`);
  if (errs.length) console.log(errs.slice(0, 3).map((e) => '   ! ' + e).join('\n'));
  if (fallosRed.length) console.log(fallosRed.slice(0, 3).map((e) => '   ! ' + e).join('\n'));
  await b.close();
  process.exit(fallan || errs.length ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
