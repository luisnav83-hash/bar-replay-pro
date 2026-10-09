/* =========================================================================
 * pages-promediar.js — auditoría del PROMEDIADO y el TP ESCALONADO
 * sobre LA APP PUBLICADA en GitHub Pages, manejando solo la interfaz.
 *
 * Vive en tests/ (y no en un guion suelto de /tmp) porque la batería lo llama:
 *   node tests/pages-promediar.js                                       → lo publicado
 *   node tests/pages-promediar.js file:///…/bar-replay-pro-unico.html → build local
 * `npm run test:all` las deja fuera (dependen de la red y del despliegue): se piden
 * con `node tools/run-all.js --publicadas` o `npm run test:pages-promediar`.
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
  const DESTINO = process.argv[2] || 'https://luisnav83-hash.github.io/bar-replay-pro/bar-replay-pro-unico.html';
  let pasan = 0, fallan = 0;
  const ok = (c, m) => { if (c) { pasan++; console.log('  ✓ ' + m); } else { fallan++; console.log('  ✗ ' + m); } };
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));

  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  // (sin hasTouch: cambiar el viewport con touch activo obliga a recargar la página)
  const errs = [], fails = [];
  p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 90)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('consola: ' + m.text().slice(0, 70)); });
  p.on('requestfailed', (r) => fails.push(r.url().slice(0, 50)));

  console.log('\n▸ Abriendo ' + (DESTINO.startsWith('file') ? 'la build LOCAL' : 'LA APP PUBLICADA'));
  await p.goto(DESTINO, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction('window.App && window.App.candles && window.App.candles.length > 0', { timeout: 60000 });
  await p.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 30000 });
  await esp(700);
  // Serie determinista: velas guardadas, no las de mercado de este instante
  // Puerta de listo DE VERDAD: el loader se oculta antes de que el motor tenga
  // precio de referencia cuando la máquina va cargada; sin esto, los niveles
  // derivados del precio salían a medias y fallaba el test, no la app.
  await p.waitForFunction(() => Number.isFinite(App.currentPrice()) && App.currentPrice() > 0
    && Number.isFinite(TE.state.lastPrice) && TE.state.lastPrice > 0, { timeout: 30000, polling: 120 });
  await p.evaluate(() => { const bq = document.getElementById('btnQuick'); if (bq) bq.click(); });
  await p.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 25000 });
  await esp(900);

  const st = () => p.evaluate(() => {
    const s = TE.state, q = s.position;
    const cerr = s.trades.filter((t) => t.status === 'closed');
    const txt = (id) => { const e = document.getElementById(id); return e ? e.textContent.trim() : null; };
    return {
      lado: q && q.side, qty: q && q.qty, media: q && q.entryPrice, sl: q && q.sl, tp: q && q.tp,
      partes: q && (q.parts || []).length, add: q && q.additions,
      niveles: q ? (q.tpLevels || []).length : -1, be: q && TE.breakEvenPrice(q),
      precio: App.currentPrice(), balance: s.balance, capital: s.initialCapital,
      openFee: q && q.openFee, sumaPnl: cerr.reduce((a, t) => a + t.pnl, 0), cerradas: cerr.length,
      ultMotivo: cerr.length ? cerr[cerr.length - 1].reason : '',
      avg: txt('posAvg'), beTxt: txt('posBE'), entryTxt: txt('posEntry'), hint: txt('orderHint'),
      items: document.querySelectorAll('#tpLevelsList .tp-lvl').length,
      pend: s.pending.length,
      listaPend: document.querySelectorAll('#pendingList .pending-item').length,
      lineas: (CM._priceLines || []).map((l) => (l.options ? l.options().title : '')).join(' '),
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '),
      log: [...document.querySelectorAll('.log-line')].slice(-8).map((l) => l.textContent).join('\n'),
      idx: BR.getIndex(),
    };
  });

  /* ── 1) PROMEDIAR con los botones del panel ── */
  console.log('\n▸ 1) Promediar con COMPRAR (mismo lado)');
  await p.evaluate(() => {
    document.getElementById('sizeInput').value = '15';
    document.getElementById('slInput').value = '';
    document.getElementById('tpInput').value = '';
    document.getElementById('limitInput').value = '';
  });
  await p.click('#btnLong');
  await esp(650);
  const a1 = await st();
  ok(a1.lado === 'long' && a1.partes === 1 && a1.add === 0, `LONG abierta con 1 entrada (${a1.qty.toFixed(6)} uds a ${a1.media.toFixed(2)})`);
  await p.click('#btnLong');
  await esp(650);
  const a2 = await st();
  ok(a2.partes === 2 && a2.add === 1, `repetir COMPRAR con LONG abierta AÑADE (parts ${a1.partes}→${a2.partes})`);
  ok(a2.qty > a1.qty * 1.0001, `el tamaño se suma (${a1.qty.toFixed(6)} → ${a2.qty.toFixed(6)})`);
  ok(a2.cerradas === a1.cerradas, 'promediar no cierra ni registra operaciones');
  ok(/2 entradas/.test(a2.avg), `la tarjeta dice «${a2.avg}»`);
  ok(/PROMEDIA/i.test(a2.hint), 'la pista del panel avisa del modo promediado');
  ok(/Añadido/.test(a2.toasts), 'el aviso dice «Añadido», no «LONG abierto»');

  /* ── 2) Botón ➕ Añadir de la tarjeta + margen libre ── */
  console.log('\n▸ 2) Botón ➕ Añadir de la tarjeta');
  await p.evaluate(() => { document.getElementById('avgSize').value = '10'; });
  await p.click('#btnAverage');
  await esp(600);
  const b1 = await st();
  ok(b1.partes === 3 && b1.add === 2, `añadido desde la tarjeta (${b1.avg})`);
  const exceso = await p.evaluate(() => {
    const q = TE.state.position.qty, pt = TE.state.position.parts.length;
    document.getElementById('avgSize').value = '95';
    App.averagePosition(95, {});
    return { q, q2: TE.state.position.qty, pt, pt2: TE.state.position.parts.length,
             toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | ') };
  });
  ok(exceso.q === exceso.q2 && /Margen libre insuficiente/.test(exceso.toasts),
     'pedir más de lo que cabe: NO añade y explica el motivo');

  /* ── 3) SL/TP conservados, break-even y parciales ── */
  console.log('\n▸ 3) Niveles conservados, break-even y cierres parciales');
  const niveles0 = await p.evaluate((px) => {
    TE.setSL(+(px * 0.985).toFixed(2)); TE.setTP(+(px * 1.02).toFixed(2));
    const s = { sl: TE.state.position.sl, tp: TE.state.position.tp };
    App.averagePosition(5, {});
    return { s, sl2: TE.state.position.sl, tp2: TE.state.position.tp, partes: TE.state.position.parts.length };
  }, b1.precio);
  ok(niveles0.partes === 4, 'otra entrada promediada (4 en total)');
  ok(Math.abs(niveles0.s.sl - niveles0.sl2) < 1e-9 && Math.abs(niveles0.s.tp - niveles0.tp2) < 1e-9,
     `el SL y el TP de la posición SE CONSERVAN al promediar (${niveles0.sl2.toFixed(2)} / ${niveles0.tp2.toFixed(2)})`);
  const q0 = (await st()).qty;
  await p.click('#positionCard [data-partial="25"]');
  await esp(600);
  const c1 = await st();
  ok(Math.abs(c1.qty - q0 * 0.75) / q0 < 1e-6, `parcial del 25%: ${q0.toFixed(6)} → ${c1.qty.toFixed(6)}`);
  ok(c1.cerradas === 1 && /parcial/.test(c1.ultMotivo), `historial anota «${c1.ultMotivo}» (cerradas ${c1.cerradas})`);
  const cuerpoTabla = await p.evaluate(() => { const t = document.querySelector('#tradesTable tbody'); return t ? t.innerText.replace(/\s+/g, ' ') : ''; });
  ok(/cierre parcial/i.test(cuerpoTabla), 'la tabla del historial muestra el motivo «cierre parcial»');
  const be = await p.evaluate(() => {
    const q = TE.state.position, be = TE.breakEvenPrice(q);
    const fee = q.feePct / 100;
    const pnl = (be - q.entryPrice) * q.qty - be * q.qty * fee - q.openFee;
    return { be, entry: q.entryPrice, pnl, precio: App.currentPrice(), sl: q.sl };
  });
  ok(Number.isFinite(be.be) && be.be > be.entry, `break-even por ENCIMA del precio medio (${be.be.toFixed(2)} vs ${be.entry.toFixed(2)})`);
  ok(Math.abs(be.pnl) < Math.max(1e-6, be.entry * 1e-8), 'en el break-even el PnL neto es cero (comisiones incluidas)');
  if (be.precio < be.be) {
    await p.click('#btnSlBE');
    await esp(500);
    const c2 = await st();
    ok(Math.abs(c2.sl - be.sl) < 1e-9 && /pérdida|encima del precio/i.test(c2.toasts),
       'en pérdida, 🛡 BE se niega y lo explica (si no, sería un cierre inmediato)');
  } else {
    await p.click('#btnSlBE');
    await esp(500);
    const c2 = await st();
    ok(Math.abs(c2.sl - be.be) < 1e-6, `🛡 BE lleva el SL al break-even (${c2.sl && c2.sl.toFixed(2)})`);
  }
  ok(/BE /.test((await st()).lineas), 'el gráfico pinta la línea BE');
  const qc = (await st()).qty;
  await p.keyboard.press('c');
  await esp(600);
  const c3 = await st();
  ok(Math.abs(c3.qty - qc * 0.5) / qc < 1e-6, `tecla C: mitad de lo que quedaba (${qc.toFixed(6)} → ${c3.qty.toFixed(6)})`);

  /* ── 4) TP escalonado ejecutándose con el replay ── */
  console.log('\n▸ 4) TP escalonado (Partial TP/SL)');
  /* Primero: el replay en PAUSA. Si va solo, la vela que toca el nivel pasa de
     largo mientras se rellena el formulario del escalón y la ejecución pasa a
     depender del reloj de la máquina (así entró el falso rojo en una batería
     cargada: el nivel se añadía DESPUÉS de la única vela que lo tocaba). */
  if (await p.evaluate(() => !!(BR.state && BR.state.playing))) { await p.click('#btnPlay'); await esp(400); }
  ok((await p.evaluate(() => !!(BR.state && BR.state.playing))) === false,
     'replay en pausa antes de medir el escalón (si va solo, esta comprobación sería una carrera)');

  const calc = () => p.evaluate(() => {
    const q = TE.state.position, i = BR.getIndex();
    // El nivel se busca a partir de la vela 12: deja margen para escribir el
    // formulario sin que la vela del cruce quede ya atrás.
    const resto = App.candles.slice(i + 12, i + 172);
    const base = Math.max(q.entryPrice, App.currentPrice());
    const maxHigh = Math.max(...resto.map((c) => c.high));
    const t = +(base * 1.0015).toFixed(2);
    const j = resto.findIndex((c) => c.high >= t);
    return { t, j, maxHigh, vale: j >= 0 && t < maxHigh * 0.998, precio: App.currentPrice(), desde: i };
  });
  /* El escalón necesita un tramo que SUBA. La serie de práctica arranca donde
     arranca: si el azar cae en plena bajada no hay nivel alcanzable en 160 velas y
     la comprobación no mediría nada (así saltó el rojo en una de las corridas). El
     tramo se BUSCA avanzando de vela en vela con ⏭ —por la interfaz—, con tope, y
     se dice cuántas velas ha costado encontrarlo. */
  let plan = null, andadas = 0;
  for (let intento = 0; intento < 300 && !plan; intento++) {
    const cand = await calc();
    if (cand.vale) plan = cand;
    else { await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); andadas += 2; await esp(70); }
  }
  ok(plan !== null, plan ? `el paseo busca un tramo donde el nivel es alcanzable (${andadas} velas andadas)`
                         : 'NO hay ningún tramo con nivel alcanzable en 600 velas: el test lo dice, no pasa de largo');
  if (plan) {
    await p.evaluate((pv) => {
      document.getElementById('tpLvlPrice').value = String(pv.t);
      document.getElementById('tpLvlPct').value = '40';
      document.getElementById('btnTpLevel').click();
    }, plan);
    await esp(500);
    const d1 = await st();
    ok(d1.niveles === 1 && d1.items === 1, `nivel ${plan.t.toFixed(2)} (40%) añadido y listado en la tarjeta`);
    ok(/TP1/.test(d1.lineas), 'el gráfico lo dibuja como «TP1 40%»');
    const qd = d1.qty;
    // Y ahora SÍ, con el nivel ya puesto, se vuelve a medir por dónde pasa: el
    // objetivo es una posición del índice, no un número de pulsaciones (si alguna
    // tecla no llega, el paseo se sigue comparando contra el índice real).
    const plan2 = await p.evaluate((t) => {
      // Se piden AL MENOS 2 velas de holgura: si la única vela que toca el nivel es
      // la siguiente, la escritura del formulario ya la ha podido dejar atrás y la
      // comprobación volvería a ser una carrera contra el reloj de la máquina.
      const DESVIO = 2;
      const i = BR.getIndex(), resto = App.candles.slice(i + DESVIO, i + 200);
      const j = resto.findIndex((c) => c.high >= t);
      return { j, desvio: DESVIO, hasta: j >= 0 ? i + DESVIO + j : -1, desde: i, idx: i };
    }, plan.t);
    ok(plan2.j >= 0 && plan2.hasta >= plan2.desde + plan2.desvio,
       `con el nivel puesto la vela que lo toca sigue por delante (a ${plan2.hasta - plan2.desde} velas)`);
    let ejec = false, tras = null, k = 0;
    while (k < 420 && !ejec) {
      await p.keyboard.press('ArrowRight'); k++;
      const s = await st();
      if (s.niveles === 0) { ejec = true; tras = s; }
      if (s.idx >= plan2.hasta + 3) break;   // rebasado el cruce con holgura: no hay nada que esperar
    }
    ok(ejec, `el nivel se ejecuta SOLO al tocarlo (el resto de la posición sigue viva) · ${k} velas andadas, meta en la ${plan2.hasta}`);
    ok(ejec && Math.abs(tras.qty - qd * 0.6) / qd < 1e-6, `cerró su 40%: ${qd.toFixed(6)} → ${ejec ? tras.qty.toFixed(6) : '—'}`);
    ok(ejec && /parcial/.test(tras.ultMotivo) && tras.lado === 'long', `registrado como «${ejec ? tras.ultMotivo : '—'}» y la posición sigue LONG`);
    ok(ejec && Number.isFinite(tras.be), `el break-even se recalcula con lo que queda (${ejec ? tras.be.toFixed(2) : '—'})`);
  }

  /* ── 5) Órdenes límite con posición abierta ── */
  console.log('\n▸ 5) Límites: en espera, cruzado y lado contrario');
  const e0 = await p.evaluate(() => {
    document.querySelector('#segOrderType [data-otype="limite"]').click();
    document.getElementById('limitInput').value = String(+(App.currentPrice() * 0.994).toFixed(2));
    window.__antes = { qty: TE.state.position.qty, partes: TE.state.position.parts.length, pend: TE.state.pending.length };
    App.placeLimitOrder('long');
    return { antes: window.__antes, pend: TE.state.pending.length, qty: TE.state.position.qty,
             partes: TE.state.position.parts.length, lista: document.querySelectorAll('#pendingList .pending-item').length,
             log: [...document.querySelectorAll('.log-line')].slice(-4).map((l) => l.textContent).join('\n') };
  });
  ok(e0.pend === e0.antes.pend + 1 && e0.lista === e0.pend && e0.qty === e0.antes.qty,
     `límite del mismo lado SIN cruzar: en espera (${e0.pend}) y la posición intacta`);
  ok(/AÑADIRÁ tamaño/.test(e0.log), 'el log dice que añadirá a la posición (no que esperará)');
  const e1 = await p.evaluate(() => {
    const antes = { qty: TE.state.position.qty, partes: TE.state.position.parts.length, pend: TE.state.pending.length };
    document.getElementById('limitInput').value = String(+(App.currentPrice() * 1.004).toFixed(2));
    App.placeLimitOrder('long');
    return { antes, qty: TE.state.position.qty, partes: TE.state.position.parts.length, pend: TE.state.pending.length,
             toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '),
             log: [...document.querySelectorAll('.log-line')].slice(-4).map((l) => l.textContent).join('\n') };
  });
  ok(e1.pend === e1.antes.pend && e1.qty > e1.antes.qty && e1.partes === e1.antes.partes + 1,
     `límite CRUZADO del mismo lado: se ejecuta a mercado y AÑADE (${e1.antes.qty.toFixed(6)} → ${e1.qty.toFixed(6)})`);
  ok(/a mercado/.test(e1.toasts) && /Promediado/.test(e1.log), 'avisa del cruce a mercado y anota el promediado');
  const e2 = await p.evaluate(() => {
    const antes = TE.state.position.qty;
    document.getElementById('limitInput').value = String(+(App.currentPrice() * 1.03).toFixed(2));
    App.placeLimitOrder('short');
    return { antes, qty: TE.state.position.qty, log: [...document.querySelectorAll('.log-line')].slice(-3).map((l) => l.textContent).join('\n') };
  });
  ok(e2.qty === e2.antes && /esperará a que la cierres/.test(e2.log),
     'límite del lado CONTRARIO: espera a que se cierre la posición (y así se dice)');

  /* ── 6) Contabilidad y ajustes ── */
  console.log('\n▸ 6) Contabilidad, ajustes y persistencia');
  const f1 = await p.evaluate(() => {
    const s = TE.state;
    const cerr = s.trades.filter((t) => t.status === 'closed');
    const suma = cerr.reduce((a, t) => a + t.pnl, 0);
    return { suma, balance: s.balance, capital: s.initialCapital, openFee: s.position.openFee, realized: s.position.realizedParcial };
  });
  ok(Number.isFinite(f1.balance) && Math.abs(f1.balance - (f1.capital + f1.suma - f1.openFee)) < 0.02,
     `balance cuadra con lo cerrado: ${f1.balance.toFixed(2)} ≈ ${f1.capital} + ${f1.suma.toFixed(2)} − ${f1.openFee.toFixed(2)} (comisión viva)`);
  const f2 = await p.evaluate(() => {
    document.getElementById('btnSettings').click();
    const modal = document.getElementById('modalSettings');
    const caja = document.getElementById('setAveraging');
    const r = { abierto: modal.classList.contains('open'), alto: caja ? Math.round(caja.getBoundingClientRect().height) : 0, marcado: caja && caja.checked };
    if (caja) { caja.checked = false; document.getElementById('btnApplySettings').click(); }
    const antes = TE.state.position.qty;
    document.querySelector('#segOrderType [data-otype="market"]').click();
    App.placeOrder('long');
    return { ...r, avg: TE.state.averaging, antes, despues: TE.state.position ? TE.state.position.qty : null,
             toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | ') };
  });
  ok(f2.abierto, '⚙️ Ajustes ABRE el modal de la barra (antes solo rellenaba campos)');
  ok(f2.avg === false && f2.antes === f2.despues && /Ya hay una posición abierta/.test(f2.toasts),
     'apagado «Promediar entradas»: el mismo lado no añade y vuelve el aviso clásico');
  const f3 = await p.evaluate(() => {
    document.getElementById('btnSettings').click();
    const v = document.getElementById('setAveraging').checked;
    document.getElementById('setAveraging').checked = true;
    document.getElementById('btnApplySettings').click();
    return { prefill: v, avg: TE.state.averaging };
  });
  ok(f3.prefill === false && f3.avg === true, 'al reabrir, el interruptor reflejaba el estado REAL (no un valor viejo) y guardar lo reactiva');
  const f4 = await p.evaluate(() => {
    const i = BR.getIndex();
    App.checkpoints[i] = App.snapshot(i);
    const q = TE.state.position;
    const memo = { qty: q.qty, partes: q.parts.length, niveles: (q.tpLevels || []).length, realized: q.realizedParcial };
    TE.state.position = null; TE.state.trades.length = 0; TE.state.balance = 1;
    App.restoreTo(i);
    const p2 = TE.state.position || {};
    return { memo, qty: p2.qty, partes: (p2.parts || []).length, niveles: (p2.tpLevels || []).length,
             realized: p2.realizedParcial, bal: TE.state.balance, trades: TE.state.trades.length };
  });
  ok(Number.isFinite(f4.qty) && Math.abs(f4.qty - f4.memo.qty) < 1e-10 && f4.partes === f4.memo.partes
     && f4.niveles === f4.memo.niveles && Math.abs(f4.realized - f4.memo.realized) < 1e-8,
     `retroceder/reavanzar devuelve tamaño, entradas, niveles y lo realizado (${f4.qty && f4.qty.toFixed(6)}, ${f4.partes} entradas, ${f4.niveles} niveles)`);
  ok(f4.bal > 1 && Number.isFinite(f4.bal), `el balance vuelve a su valor de esa vela (${f4.bal.toFixed(2)})`);

  /* ── 7) Móvil ── */
  console.log('\n▸ 7) Ventana de móvil (390 × 844)');
  await p.setViewport({ width: 390, height: 844 });
  await esp(700);
  const g1 = await p.evaluate(() => {
    const btn = document.querySelector('#positionCard [data-partial="25"]');
    const r = btn ? btn.getBoundingClientRect() : null;
    const card = document.getElementById('positionCard');
    return {
      scrollX: document.documentElement.scrollWidth > window.innerWidth + 2,
      btnAlto: r ? Math.round(r.height) : 0,
      btnAncho: r ? Math.round(r.width) : 0,
      cardAncho: card ? card.scrollWidth : 0,
      cardCliente: card ? card.clientWidth : 0,
      qty: TE.state.position && TE.state.position.qty,
    };
  });
  ok(!g1.scrollX, 'a 390 px no hay scroll horizontal con el bloque de gestión');
  ok(g1.cardAncho <= g1.cardCliente + 2, `el bloque cabe en la tarjeta (${g1.cardAncho} ≤ ${g1.cardCliente})`);
  ok(g1.btnAlto >= 26 && g1.btnAncho >= 34, `los botones de parcial tienen tamaño táctil (${g1.btnAncho}×${g1.btnAlto} px)`);
  await p.evaluate(() => document.querySelector('#positionCard [data-partial="25"]').click());
  await esp(600);
  const g2 = await st();
  ok(Math.abs(g2.qty - g1.qty * 0.75) / g1.qty < 1e-6, `tocar «25 %» en estrecho cierra su parte (${g1.qty.toFixed(6)} → ${g2.qty.toFixed(6)})`);
  ok(g2.cerradas >= 1 && /entradas/.test(g2.avg) && Number.isFinite(g2.balance),
     `el historial y la cuenta siguen coherentes tras el borrón y vuelve (${g2.cerradas} filas cerradas, ${g2.avg})`);

  const fin = await st();
  ok(errs.length === 0, `sin errores de JavaScript (${errs.length})${errs.length ? ' → ' + errs.slice(0, 2).join(' ⧸ ') : ''}`);
  ok(fails.length === 0, `sin peticiones fallidas (${fails.length})${fails.length ? ' → ' + fails.slice(0, 2).join(' ⧸ ') : ''}`);

  console.log('\n' + '─'.repeat(60));
  console.log(`Promediar y TP en ${DESTINO.startsWith('file') ? 'build local' : 'PAGES'}: ${pasan} superadas, ${fallan} fallidas`);
  await b.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
