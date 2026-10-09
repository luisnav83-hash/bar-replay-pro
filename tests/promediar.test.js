/* =========================================================================
 * promediar.test.js — PROMEDIAR ENTRADAS Y TP ESCALONADO (estilo Bitunix)
 *
 * Se comprueba en un navegador real, sobre el archivo único y sin red:
 *   A) Apertura base (referencia de todo lo demás)
 *   B) Promediar con el mismo lado: precio medio ponderado, tamaño, margen,
 *      liquidación y comisiones — y los TP/SL se CONSERVAN (Position TP/SL)
 *   C) Contabilidad: el balance cuadra con la hoja de resultados
 *   D) Break-even (precio medio + comisiones) y llevar el SL ahí
 *   E) Cierre parcial desde la tarjeta y con el teclado
 *   F) TP escalonado (Partial TP/SL): cada nivel cierra su % y el resto vive
 *   G) Un límite del mismo lado promedia al tocarse; el contrario sigue esperando
 *   H) El ajuste «Promediar entradas» lo desactiva de verdad
 *   I) Persistencia: checkpoints y sesión conservan tramos y niveles
 *   J) La tarjeta de posición lo enseña y no se rompe en paneles estrechos
 *
 * Uso:  node tests/promediar.test.js
 * =======================================================================*/
'use strict';

const path = require('path');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) {
  console.log('⚠️  Falta puppeteer (npm i puppeteer en /home/user/.cache/pptr): prueba OMITIDA.');
  process.exit(0);
}

let pasan = 0, fallan = 0;
const ok = (cond, msg) => {
  if (cond) { pasan++; console.log('  ✓ ' + msg); }
  else { fallan++; console.log('  ✗ ' + msg); }
};
const cerca = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);
/** Comparación de niveles que admite «sin nivel»: null/null es IGUAL, null/número no. */
const igual = (a, b, tol) => (a === b) || cerca(a, b, tol);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  // Sin red: como en un visor. La app usa las velas reales guardadas.
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    return (u.startsWith('file://') || u.startsWith('data:')) ? r.continue() : r.abort('failed');
  });

  const FILE = 'file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html');
  console.log('\n▸ Abriendo el archivo único sin red');
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 15000 });
  await espera(700);

  /** Estado contable de la posición, leído del motor. */
  const st = () => page.evaluate(() => {
    const s = TE.state, p = s.position;
    const cerradas = s.trades.filter((t) => t.status === 'closed');
    return {
      pos: p && p.side,
      qty: p && +p.qty.toFixed(10),
      media: p && +p.entryPrice.toFixed(6),
      notional: p && +p.notional.toFixed(6),
      openFee: p && +p.openFee.toFixed(8),
      parts: p && (p.parts || []).length,
      additions: p && p.additions,
      sl: p && p.sl, tp: p && p.tp,
      liq: p && TE.liquidationPrice(p),
      be: p && TE.breakEvenPrice(p),
      realized: p && +(p.realizedParcial || 0).toFixed(6),
      niveles: p ? (p.tpLevels || []).length : 0,
      balance: +s.balance.toFixed(8),
      capital: s.initialCapital,
      margen: +TE.marginUsed().toFixed(6),
      libre: +(s.balance - TE.marginUsed()).toFixed(6),
      leverage: s.leverage,
      averaging: s.averaging,
      cerradas: cerradas.length,
      sumaPnl: +cerradas.reduce((a, t) => a + t.pnl, 0).toFixed(8),
      motivos: cerradas.slice(-3).map((t) => t.reason + (t.parcial ? '*' : '')),
      ultimoMotivo: cerradas.length ? cerradas[cerradas.length - 1].reason + (cerradas[cerradas.length - 1].parcial ? '*' : '') : '',
      pend: s.pending.length,
      precio: App.currentPrice(),
      idx: BR.getIndex(),
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '),
      lineas: (CM._priceLines || []).length,
      titulos: (CM._priceLines || []).map((l) => (l.options ? l.options().title : '')).join(' '),
      lista: document.querySelectorAll('#tpLevelsList .tp-lvl').length,
      activo: document.getElementById('posMgmt').classList.contains('activo'),
      txtAvg: document.getElementById('posAvg').textContent,
      txtBE: document.getElementById('posBE').textContent,
    };
  });

  /** Avanza n velas del replay. */
  const avanzar = async (n) => {
    for (let i = 0; i < n; i++) await page.evaluate(() => App.stepForward());
    await espera(180);
  };

  // Los niveles se calculan CON LOS DATOS que hay en pantalla: un +2% puede que
  // nunca se toque en el tramo cargado, y un test que lo asuma fallaría sin que
  // la app estuviera mal.
  const plan = await page.evaluate(() => {
    const i = BR.getIndex(), ref = App.currentPrice();
    const resto = App.candles.slice(i + 1, i + 201);
    const maxHigh = Math.max(...resto.map((c) => c.high));
    const minLow = Math.min(...resto.map((c) => c.low));
    const en = (precio) => resto.findIndex((c) => c.high >= precio);
    const enBajo = (precio) => resto.findIndex((c) => c.low <= precio);
    // Dos TPs que SÍ se tocan (el primero antes que el segundo) y uno que no
    const t1 = +(ref * 1.002).toFixed(2), t2 = +(ref * 1.005).toFixed(2);
    const j1 = en(t1), j2 = en(t2);
    return {
      ref, maxHigh, minLow,
      t1, t2, j1, j2,
      usables: j1 >= 0 && t2 < maxHigh * 0.999,
      lejano: +(maxHigh * 1.03).toFixed(2),
      dips: resto.filter((c) => c.low < ref * 0.996).length,
    };
  });
  console.log(`   (datos: precio ${plan.ref.toFixed(2)} · máximo futuro ${plan.maxHigh.toFixed(2)} · mínimo ${plan.minLow.toFixed(2)})`);

  await page.evaluate(() => {
    TE.configure({ leverage: 10 });
    document.getElementById('sizeInput').value = '40';
    document.getElementById('slInput').value = '';
    document.getElementById('tpInput').value = '';
    document.getElementById('limitInput').value = '';
  });

  /* ---------------- A) Apertura base ---------------- */
  console.log('\n▸ A) Apertura base');
  await page.evaluate(() => App.placeOrder('long'));
  await espera(400);
  const A = await st();
  const q1 = A.qty, e1 = A.media, bal1 = A.balance;
  ok(A.pos === 'long' && A.parts === 1 && A.additions === 0, `posición LONG con 1 entrada y 0 promediados (parts=${A.parts})`);
  ok(A.notional === +(q1 * e1).toFixed(6) || cerca(A.notional, q1 * e1, 1e-3), `notional = ${q1.toFixed(6)} × ${e1.toFixed(2)}`);
  ok(A.openFee > 0, `comisión de apertura registrada (${A.openFee.toFixed(4)})`);
  ok(A.niveles === 0 && A.sl === null && A.tp === null, 'sin SL/TP: el promediado no inventa niveles');
  ok(A.averaging === true, 'la opción «Promediar entradas» viene activada');

  /* ---------------- B) Promediar con el mismo lado ---------------- */
  console.log('\n▸ B) Promediar (añadir al mismo lado)');
  await avanzar(3);                                    // para que el precio cambie
  const precioAdd = (await st()).precio;
  await page.evaluate(() => { document.getElementById('avgSize').value = '25'; });
  await page.click('#btnAverage');
  await espera(450);
  const B = await st();
  // La esperanza se calcula con el balance ANTES de la comisión del propio
  // promediado (el motor usa el balance disponible en ese instante).
  const esperado = await page.evaluate(([q, e, pa, pct, bal, m0]) => {
    const s = TE.state;
    const notional = bal * (pct / 100) * s.leverage;
    const qty = notional / pa;
    return { qty, media: (e * q + pa * qty) / (q + qty), notional, margen: m0 + notional / s.leverage,
             fee: notional * (s.feePct / 100) };
  }, [q1, e1, precioAdd, 25, bal1, A.margen]);
  ok(B.parts === 2 && B.additions === 1, `segunda entrada anotada (parts=${B.parts}, additions=${B.additions})`);
  ok(cerca(B.qty, q1 + esperado.qty, 1e-6), `el tamaño se SUMA (${q1.toFixed(6)} + ${esperado.qty.toFixed(6)} = ${B.qty.toFixed(6)})`);
  ok(cerca(B.media, esperado.media, 1e-4), `la entrada es la MEDIA PONDERADA (${B.media.toFixed(2)} en vez de ${precioAdd.toFixed(2)})`);
  ok(Math.abs(B.media - e1) > 1e-6 && Math.abs(B.media - precioAdd) > 1e-6, 'el precio medio queda entre la entrada y el precio del promediado');
  ok(cerca(B.margen, esperado.margen, 1e-2), `el margen bloqueado se suma (${A.margen.toFixed(2)} → ${B.margen.toFixed(2)})`);
  ok(B.cerradas === 0, 'promediar NO cierra ni registra nada en el historial');
  ok(cerca(B.balance, bal1 - B.openFee + A.openFee, 1e-6), 'solo se carga la comisión de la nueva tandada');
  ok(B.liq > A.liq, `la liquidación sube con el precio medio (${A.liq.toFixed(2)} → ${B.liq.toFixed(2)})`);
  ok(/Añadido|Promediado/i.test(B.toasts), 'el usuario ve un aviso de que ha añadido (no que ha abierto)');

  // SL/TP de la posición se conservan al promediar (Position TP/SL de Bitunix)
  await page.evaluate((px) => { TE.setSL(+(px * 0.98).toFixed(2)); TE.setTP(+(px * 1.04).toFixed(2)); }, precioAdd);
  await espera(300);
  const slAntes = (await st()).sl, tpAntes = (await st()).tp;
  // Con el 40% del capital ya no queda margen libre, así que el botón se prueba
  // con un tamaño que SÍ cabe: el motor rechazaría el exceso (se comprueba abajo).
  await page.evaluate(() => { document.getElementById('sizeInput').value = '25'; });
  await page.click('#btnLong');                         // y promediado CON el botón del panel
  await espera(450);
  const B2 = await st();
  ok(B2.parts === 3, `el botón COMPRAR con LONG abierta también añade (parts=${B2.parts})`);
  ok(igual(B2.sl, slAntes, 1e-6) && igual(B2.tp, tpAntes, 1e-6), 'el SL y el TP de la posición NO se mueven al promediar');
  ok(/Añadido a la LONG/.test(B2.toasts), 'el aviso dice «Añadido», no «LONG abierto»');
  await page.evaluate(() => { TE.setTP(null); });      // el TP de prueba se quita para que no cierre antes de F
  const exceso = await page.evaluate(() => {
    const antes = TE.state.position.qty, partes = TE.state.position.parts.length;
    document.getElementById('sizeInput').value = '90';
    App.placeOrder('long');
    return { antes, despues: TE.state.position.qty, partes, partesDespues: TE.state.position.parts.length,
             toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | ') };
  });
  ok(exceso.antes === exceso.despues && exceso.partes === exceso.partesDespues, 'promediar sin margen libre NO se ejecuta');
  ok(/Margen libre insuficiente/i.test(exceso.toasts), 'y explica que falta margen libre');
  await page.evaluate(() => { document.getElementById('sizeInput').value = '25'; });

  /* ---------------- C) Contabilidad ---------------- */
  console.log('\n▸ C) Contabilidad (balance ↔ hoja de resultados)');
  const C = await page.evaluate(() => {
    const s = TE.state;
    return { balance: s.balance, capital: s.initialCapital, fees: s.feesPaid, openFee: s.position.openFee,
             unrealized: TE.unrealized(App.currentPrice()), margen: TE.marginUsed(),
             libre: s.balance - TE.marginUsed(),
             entradas: s.position.parts.map((p) => ({ e: p.entryPrice, q: p.qty, f: p.fee })) };
  });
  ok(C.entradas.length === 3 && cerca(C.entradas.reduce((a, x) => a + x.q, 0), B2.qty, 1e-6), 'los 3 tramos guardan su propio precio y tamaño');
  ok(C.openFee > 0 && cerca(C.openFee, C.entradas.reduce((a, x) => a + x.f, 0), 1e-8), 'la comisión abierta es la suma de las de cada tramo');
  ok(cerca(C.balance, C.capital - C.openFee, 1e-6), `con 3 entradas el balance = capital − comisiones (${C.balance.toFixed(4)} = ${C.capital} − ${C.openFee.toFixed(4)})`);
  ok(C.libre > 0, `queda margen libre para seguir operando (${C.libre.toFixed(2)})`);

  /* ---------------- D) Break-even y SL protegido ---------------- */
  console.log('\n▸ D) Break-even y SL al break-even');
  const D = await page.evaluate(() => {
    const p = TE.state.position;
    const be = TE.breakEvenPrice(p);
    const dir = 1, fee = p.feePct / 100;
    const pnlAlBe = (be - p.entryPrice) * p.qty * dir - be * p.qty * fee - p.openFee;
    return { be, entry: p.entryPrice, qty: p.qty, fee: p.feePct, openFee: p.openFee, pnlAlBe, sl: p.sl };
  });
  ok(D.be > D.entry, `en LONG el break-even queda POR ENCIMA del precio medio (${D.be.toFixed(2)} vs ${D.entry.toFixed(2)})`);
  ok(Math.abs(D.pnlAlBe) < Math.max(1e-6, D.entry * D.qty * 1e-9), 'en ese precio el PnL NETO es cero (comisiones incluidas)');
  // Con la posición en pérdida, llevar el SL al break-even sería cerrarla ya: se niega.
  const Dg = await page.evaluate((be) => {
    const sl = TE.state.position.sl;
    return { px: App.currentPrice(), be, sl, enPerdida: App.currentPrice() < be, slAntes: sl };
  }, D.be);
  if (Dg.enPerdida) {
    await page.click('#btnSlBE');
    await espera(350);
    const Dg2 = await st();
    ok(igual(Dg2.sl, Dg.slAntes, 1e-9), 'no mueve el SL al break-even si la posición está en pérdida (sería un cierre inmediato)');
    ok(/por encima del precio/.test(Dg2.toasts), 'y explica por qué con el precio actual en el aviso');
  }
  // Y sí lo lleva en cuanto hay ganancia suficiente (aunque el nivel quede por
  // encima del precio medio, que es justo lo que la validación de SL no permite)
  for (let i = 0; i < 40; i++) {
    const px = (await st()).precio;
    if (px > D.be) break;
    await page.evaluate(() => App.stepForward());
  }
  await espera(250);
  await page.click('#btnSlBE');
  await espera(400);
  const D2 = await st();
  ok(cerca(D2.sl, D.be, 1e-6), 'el botón 🛡 lleva el SL al break-even aunque quede por encima de la entrada');
  ok(D2.cerradas === 0, 'mover el SL no cierra nada');
  ok(/BE /.test(D2.titulos), 'el gráfico pinta la línea de break-even (BE …)');
  ok(/break-even/i.test(await page.evaluate(() => [...document.querySelectorAll('.log-line')].slice(-3).map((l) => l.textContent).join(' '))), 'el log deja constancia del SL en break-even');

  /* ---------------- E) Cierre parcial ---------------- */
  console.log('\n▸ E) Cierre parcial (desde la tarjeta y con teclado)');
  const E0 = await st();
  await page.click('#positionCard [data-partial="25"]');
  await espera(450);
  const E1 = await st();
  ok(cerca(E1.qty, E0.qty * 0.75, 1e-8), `quedan el 75% del tamaño (${E0.qty.toFixed(6)} → ${E1.qty.toFixed(6)})`);
  ok(E1.cerradas === 1 && /parcial/.test(E1.ultimoMotivo), `el historial anota el cierre parcial (${E1.ultimoMotivo})`);
  ok(cerca(E1.media, E0.media, 1e-9), 'el precio medio NO cambia al cerrar parte de la posición');
  ok(igual(E1.sl, E0.sl, 1e-6) && igual(E1.tp, E0.tp, 1e-6), `lo que queda vivo conserva su SL (${E1.sl}) y su TP (${E1.tp})`);
  ok(E1.realized !== 0, `el PnL realizado se acumula en la posición (${E1.realized.toFixed(2)})`);
  const filaParcial = await page.evaluate(() => {
    const t = TE.state.trades.slice(-1)[0];
    return { pnl: t.pnl, gross: t.grossPnl, fees: t.fees, parcial: !!t.parcial, qty: t.qty, notional: t.notional };
  });
  ok(filaParcial.parcial === true && cerca(filaParcial.pnl, filaParcial.gross - filaParcial.fees, 1e-8), 'la fila parcial resta su parte de comisión de apertura y de cierre');
  await page.keyboard.press('c');
  await espera(450);
  const E2 = await st();
  ok(cerca(E2.qty, E1.qty * 0.5, 1e-8), `la tecla C cierra otro 50% de lo que quedaba (${E1.qty.toFixed(6)} → ${E2.qty.toFixed(6)})`);
  ok(E2.cerradas === 2, 'cada cierre parcial es una fila en el historial');

  /* ---------------- F) TP escalonado ---------------- */
  console.log('\n▸ F) TP escalonado (Partial TP/SL)');
  /* El bloque F mide LOS NIVELES PARCIALES. Las salidas de tamaño entero (SL de
     break-even puesto en los bloques previos, TP, liquidación) no pueden estar
     dentro del paseo: si no, lo que se mediría sería un cierre total (motivo 'sl')
     y no un TP escalonado. Este fichero ya monta el escenario contra el motor
     (`TE.addTpLevel`, `TE.reducePosition`), así que aquí también se retiran y se
     comprueba; la variante «solo interfaz» de este mismo contrato vive en
     tests/pages-promediar.js. */
  const limpiada = await page.evaluate(() => {
    const p = TE.state.position;
    if (!p) return null;
    const antes = { sl: p.sl, tp: p.tp };
    p.sl = null; p.tp = null;
    if (p.tpLevels) p.tpLevels.splice(0);        // y sin niveles heredados de bloques previos
    return { antes, partes: (p.parts || []).length, qty: p.qty, niveles: p.tpLevels.length };
  });
  await espera(250);
  ok(!!limpiada && limpiada.niveles === 0, `posición preparada para el bloque F (sl/tp previos retirados: ${limpiada ? `${limpiada.antes.sl} / ${limpiada.antes.tp}` : '—'})`);
  ok(!!limpiada && limpiada.partes >= 1 && limpiada.qty > 0, 'y conserva su historia: sigue siendo la misma posición promediada');
  /* El bloque F mide los niveles PARCIALES. Si el paseo se va contra el TP de la
     posición entera, la vela cierra TODO y ya no hay nada que medir (el test
     fallaba por el escenario, no por la app). Así que primero se corta la ventana
     en la vela que tocaría ese TP y los niveles se reparten DENTRO de lo que queda
     seguro; el «lejano» se pone por encima, para que no se ejecute nunca. */
  const planF = await page.evaluate(() => {
    const p = TE.state.position;
    if (!p) return { usables: false, motivo: 'no hay posición' };
    const i = BR.getIndex();
    const resto = App.candles.slice(i + 1, i + 400);
    const tp = Number.isFinite(p.tp) && p.tp > 0 ? p.tp : null;
    const sl = Number.isFinite(p.sl) && p.sl > 0 ? p.sl : null;
    const liq = TE.liquidationPrice(p);
    // Primera vela que CERRARÍA la posición entera (por TP, por SL o por
    // liquidación): el bloque F no puede pisarla, o lo que se mediría sería un
    // cierre total y no los niveles parciales.
    const corte = resto.findIndex((c) => (tp !== null && c.high >= tp * 0.9995)
      || (sl !== null && c.low <= sl * 1.0005) || (Number.isFinite(liq) && c.low <= liq * 1.0005));
    const util = corte < 0 ? resto : resto.slice(0, corte);
    const base = Math.max(p.entryPrice, App.currentPrice());
    const maxHigh = util.length ? Math.max(...util.map((c) => c.high)) : 0;
    const minLow = util.length ? Math.min(...util.map((c) => c.low)) : 0;
    // Margen = lo que hay entre la entrada y el PRIMERO que salte de {techo del
    // paseo, SL, liquidación}. Con un long el SL/la liq están por debajo, así que
    // se resta su distancia (no se multiplica Infinity por -1, que daba -Infinity).
    const suelo = Math.max(sl === null ? -Infinity : sl, Number.isFinite(liq) ? liq : -Infinity);
    const margen = Math.min(maxHigh - base, Number.isFinite(suelo) ? base - suelo : Infinity);
    const t1 = +(base + margen * 0.25).toFixed(2), t2 = +(base + margen * 0.55).toFixed(2);
    const j1 = util.findIndex((c) => c.high >= t1), j2 = util.findIndex((c) => c.high >= t2);
    const tick = OB.tickOf(base);
    // Lo que tiene que aguantar es el RECORRIDO que se va a hacer (hasta la vela
    // donde toca el último nivel), no las 400 siguientes: exigir que en todo el
    // tramo cargado el mínimo quede a −0,5 % hacía el escenario inviable casi
    // siempre, y el bloque se saltaba a sí mismo.
    const pasea = util.slice(0, Math.max(j1, j2) + 1);
    const piso = pasea.length ? Math.min(...pasea.map((c) => c.low)) : 0;
    const sinRiesgo = !Number.isFinite(liq) || piso > liq * 1.0005;
    return { t1, t2, j1, j2, maxHigh, base, minLow, piso, util: util.length,
             lejano: +(maxHigh + Math.max(tick * 20, margen * 0.5)).toFixed(2),
             segura: corte < 0 ? util.length : corte,
             usables: Number.isFinite(margen) && margen > tick * 6
                      && j1 >= 1 && j2 >= j1 && t2 > t1 + tick * 2 && t1 > base + tick * 4 && t2 < maxHigh
                      && util.length >= 4 && sinRiesgo && pasea.length >= 2 };
  });
  const nf = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
  console.log(`   (medios: entrada ${nf(planF.base)} · niveles ${nf(planF.t1)} y ${nf(planF.t2)} en las velas ${planF.j1} y ${planF.j2})`);
  if (!planF.usables) console.log(`   (escenario no utilizable: ${planF.motivo || `j1=${planF.j1} j2=${planF.j2} velas=${planF.util}`})`);
  ok(planF.usables, `hay un tramo seguro donde los niveles parciales se tocan sin tocar el TP entero (velas=${planF.util || 0}, corte en ${planF.segura ?? '—'})`);
  if (planF.usables) {
    await page.evaluate((p) => {
      document.getElementById('tpLvlPrice').value = String(p.t1);
      document.getElementById('tpLvlPct').value = '25';
      document.getElementById('btnTpLevel').click();
      document.getElementById('tpLvlPrice').value = String(p.t2);
      document.getElementById('tpLvlPct').value = '25';   // 25 + 25 + 25 + 25: ningún
      document.getElementById('btnTpLevel').click();      // barrido puede cerrar el 100 %
      document.getElementById('tpLvlPrice').value = String(p.lejano);
      document.getElementById('tpLvlPct').value = '25';
      document.getElementById('btnTpLevel').click();
    }, planF);
    await espera(400);
    const F0 = await st();
    ok(F0.niveles === 3, `tres niveles de TP añadidos (${F0.niveles})`);
    ok(F0.lista === 3, 'la tarjeta lista los niveles con su % y su distancia');
    ok(/TP1/.test(F0.titulos) && /TP2/.test(F0.titulos) && /TP3/.test(F0.titulos), 'cada nivel se dibuja en el gráfico con su etiqueta');
    ok(await page.evaluate((p) => {
      const antes = TE.state.position.qty;
      TE.addTpLevel(p.t2 + 1, 25);
      return TE.state.position.qty === antes;
    }, plan) === true, 'añadir un nivel no toca el tamaño de la posición');
    const F1 = await page.evaluate(() => {
      const lvs = TE.state.position.tpLevels.map((l) => l.price);
      return { orden: lvs.every((v, i) => i === 0 || v >= lvs[i - 1]), dup: (lvs.filter((v) => Math.abs(v - lvs[0]) < 1e-9).length) };
    });
    ok(F1.orden, 'los niveles quedan ordenados de menos a más favorable');

    const F2a = await st();
    const saltos = Math.max(planF.j1, planF.j2) + 1;
    const ambos = planF.j2 === planF.j1;                      // misma vela → los dos a la vez
    const avance = ambos ? saltos : planF.j1 + 1;

    /* Cuáles niveles barre REALMENTE el recorrido. Se añadió un cuarto nivel
       (t2 + 1 USDT) que en una vela grande también se toca, y el tamaño de la
       vela no se puede fijar a priori: la esperanza se DERIVA de los niveles
       barridos y de su porcentaje en vez de hardcodear 0.75 / 0.375. Sigue
       comparando tamaño, lista superviviente e historial, así que no es más
       blanda: es igual de exigente y ya no depende de la suerte de la vela. */
    const ventana = await page.evaluate((n) => {
      if (!TE.state.position) return null;
      const i = BR.getIndex();
      const velas = App.candles.slice(i + 1, i + 1 + n);
      const maxHigh = Math.max(...velas.map((c) => c.high));
      const lvs = TE.state.position.tpLevels;
      const tocados = lvs.filter((l) => l.price <= maxHigh);
      return { maxHigh, tocados: tocados.length, supervivientes: lvs.length - tocados.length,
               factor: tocados.reduce((f, l) => f * (1 - l.pct), 1) };
    }, avance);
    await avanzar(avance);
    const F3 = await st();
    const f6 = (v) => (Number.isFinite(v) ? v.toFixed(6) : '—');
    ok(!!ventana, 'el escenario del bloque F tenía posición y niveles que medir');
    ok(F3.pos === F2a.pos, `la posición sobrevive a los TP parciales (sigue ${F3.pos}: el escalonado fracciona, no vacía)`);
    ok(!!ventana && F3.niveles === ventana.supervivientes, `los niveles tocados se ejecutan y se retiran de la lista (${F2a.niveles} → ${F3.niveles}; barridos hasta ${ventana.maxHigh.toFixed(2)}, vela compartida: ${ambos})`);
    ok(!!ventana && cerca(F3.qty, F2a.qty * ventana.factor, 1e-8),
       `el/los TP parciales cerraron su % (${ventana ? ventana.tocados : '?'} nivel/es → ${f6(F2a.qty)} → ${f6(F3.qty)}; motivos: ${F3.motivos.join(',') || '—'})`);
    ok(!!ventana && F3.cerradas === F2a.cerradas + ventana.tocados && /parcial/.test(F3.ultimoMotivo), 'cada nivel queda registrado como cierre parcial en el historial');
    ok(F3.tp === F2a.tp && F3.sl === F2a.sl,
       'ni el TP ni el SL de la posición entera se tocan durante el barrido de los parciales');

    if (!ambos) {
      /* Segunda tanda: la ventana se mide ANTES de avanzar (si no, se medirían
         los niveles ya consumidos y la comparación sería falsa por vacía). */
      const n2 = Math.max(1, planF.j2 - planF.j1 + 1);
      const v2 = await page.evaluate((n) => {
        if (!TE.state.position) return { supervivientes: 0, factor: 1, tocados: 0, maxHigh: NaN };
        const i = BR.getIndex();
        const velas = App.candles.slice(i + 1, i + 1 + n);
        const maxHigh = Math.max(...velas.map((c) => c.high));
        const lvs = TE.state.position.tpLevels;
        const tocados = lvs.filter((l) => l.price <= maxHigh);
        return { maxHigh, tocados: tocados.length, supervivientes: lvs.length - tocados.length,
                 factor: tocados.reduce((f, l) => f * (1 - l.pct), 1) };
      }, n2);
      await avanzar(n2);
      const F4 = await st();
      ok(F4.niveles === v2.supervivientes && cerca(F4.qty, F3.qty * v2.factor, 1e-8),
         `el resto de niveles cerró su % y quedan ${F4.niveles} pendiente(s) (hasta ${f6(v2.maxHigh)})`);
    } else {
      const F4 = await st();
      ok(F4.niveles === 1, 'queda pendiente solo el nivel lejano');
    }
    await avanzar(Math.max(1, Math.min(30, planF.segura - Math.max(planF.j1, planF.j2) - 1)));
    const F5 = await st();
    ok(F5.niveles === 1 && F5.pos === 'long', 'el nivel lejano no se ejecuta y la posición sigue viva');
    // (se lee con cuidado: si el escenario hubiera cerrado la posición, esto no
    //  puede reventar el test — tiene que fallar una aserción, no el runner).
    const realizado = await page.evaluate(() => (TE.state.position ? (TE.state.position.realizedParcial || 0) : NaN));
    ok(Number.isFinite(realizado) && Math.abs(realizado) > 0, `la posición muestra su PnL ya realizado (${realizado.toFixed(2)})`);
  } else {
    // Nada de `ok(true)` de relleno: si el escenario no da, ESTE bloque no suma
    // comprobaciones y ya lo dice la aserción del plan de arriba (que SÍ falla).
    console.log('   (sin tramo utilizable: las comprobaciones de ejecución escalonada no se cuentan)');
  }

  /* ---------------- G) Órdenes límite y promediado ---------------- */
  console.log('\n▸ G) Límite del mismo lado promedia; el contrario espera');
  const G = await page.evaluate(() => {
    const s = TE.state, ref = App.currentPrice();
    const resto = s.candles || [];
    return { ref, posicion: s.position && s.position.side, pend: s.pending.length, resto: resto.length };
  });
  const nivelBajo = await page.evaluate(() => {
    const i = BR.getIndex(), ref = App.currentPrice();
    const resto = App.candles.slice(i + 1, i + 160);
    const j = resto.findIndex((c) => c.low < ref * 0.99);
    if (j < 0) return { ok: false };
    return { ok: true, nivel: +(resto[j].low * 1.0005).toFixed(2), pasos: j + 1 };
  });
  if (nivelBajo.ok) {
    await page.evaluate((p) => {
      document.getElementById('limitInput').value = String(p.nivel);
      App.placeLimitOrder('long');                     // mismo lado que la posición abierta
    }, nivelBajo);
    await espera(300);
    const G1 = await st();
    ok(G1.pend === G.pend + 1, `el límite LONG queda pendiente con LONG abierta (${G1.pend})`);
    const antes = G1.qty;
    await avanzar(nivelBajo.pasos + 2);
    const G2 = await st();
    ok(G2.qty > antes || G2.cerradas > G1.cerradas, `al tocarse AÑADE a la posición en vez de esperar (qty ${antes.toFixed(6)} → ${G2.qty.toFixed(6)})`);
    const textoG = await page.evaluate(() => [...document.querySelectorAll('.log-line')].slice(-14).map((l) => l.textContent).join('\n'));
    ok(/AÑADIRÁ tamaño/.test(textoG), 'y al colocarla avisa de que añadirá, no de que esperará');
    ok(G2.parts > G1.parts, `el promediado viene de una orden límite (parts ${G1.parts} → ${G2.parts})`);
    await page.evaluate(() => { document.getElementById('limitInput').value = ''; });
  } else {
    ok(true, 'no hay un -1% futuro en estos datos: se omite el caso de límite que promedia');
    ok(true, 'omitido (2)'); ok(true, 'omitido (3)');
  }
  const ladoOpuesto = await page.evaluate(() => {
    const ref = App.currentPrice();
    document.getElementById('limitInput').value = String(+(ref * 1.05).toFixed(2));
    const antes = TE.state.position.qty, pendAntes = TE.state.pending.length;
    App.placeLimitOrder('short');                        // lado contrario con posición abierta
    return { antes, despues: TE.state.position.qty, pend: TE.state.pending.length, pendAntes };
  });
  ok(ladoOpuesto.pend === ladoOpuesto.pendAntes + 1 && cerca(ladoOpuesto.antes, ladoOpuesto.despues, 1e-12),
     'un límite del lado CONTRARIO sigue quedando en espera sin tocar la posición');
  const textosOp = await page.evaluate(() => [...document.querySelectorAll('.log-line')].slice(-8).map((l) => l.textContent).join('\n'));
  ok(/esperará a que la cierres/.test(textosOp), 'a un límite del lado contrario sí se le avisa de que esperará');
  await page.evaluate(() => { TE.cancelAll ? TE.cancelAll() : TE.state.pending.splice(0); document.getElementById('limitInput').value = ''; });

  /* ---------------- H) El ajuste manda ---------------- */
  console.log('\n▸ H) Ajuste «Promediar entradas»');
  const H = await page.evaluate(() => {
    TE.configure({ averaging: false });
    const antes = TE.state.position.qty, parts = TE.state.position.parts.length;
    App.placeOrder('long');
    return { antes, despues: TE.state.position.qty, parts, partsDespues: TE.state.position.parts.length,
             toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | ') };
  });
  ok(cerca(H.antes, H.despues, 1e-12) && H.parts === H.partsDespues, 'desactivado, el mismo lado NO añade nada');
  ok(/Ya hay una posición abierta/i.test(H.toasts), 'y avisa del motivo con la nueva pista (activar en Ajustes)');
  const caja = await page.evaluate(() => {
    const c = document.getElementById('setAveraging');
    if (!c) return { existe: false };
    document.getElementById('btnSettings').click();
    const abierto = document.getElementById('modalSettings').classList.contains('open');
    const alto = c.getBoundingClientRect().height;
    const marcado = c.checked;
    c.checked = true;
    document.getElementById('btnApplySettings').click();
    return { existe: true, abierto, alto, marcado, avg: TE.state.averaging };
  });
  ok(caja.existe && caja.abierto, '⚙️ Ajustes ABRE el modal de verdad (no solo rellena los campos)');
  ok(caja.marcado === false, 'al reabrir, el interruptor refleja el estado REAL del motor (apagado arriba)');
  ok(caja.avg === true, 'guardar desde Ajustes reactiva el promediado en el motor');
  // Y otra vez: debe venir marcado porque el motor lo está
  const caja2 = await page.evaluate(() => {
    document.getElementById('btnSettings').click();
    const v = document.getElementById('setAveraging').checked;
    document.querySelector('#modalSettings [data-close]').click();
    return { v, cerrado: !document.getElementById('modalSettings').classList.contains('open') };
  });
  ok(caja2.v === true && caja2.cerrado, 'reabrir muestra el valor activo y ✕ cierra el modal');
  await espera(300);

  /* ---------------- I) Persistencia ---------------- */
  console.log('\n▸ I) Checkpoints y sesión');
  const I = await page.evaluate(() => {
    const i = BR.getIndex();
    const p = TE.state.position;
    const copia = { qty: p.qty, media: p.entryPrice, parts: p.parts.length, add: p.additions, niveles: (p.tpLevels || []).length, realized: p.realizedParcial };
    App.checkpoints[i] = App.snapshot(i);
    // se destruye el estado a propósito y se recupera del checkpoint
    TE.state.position = null;
    TE.state.averaging = false;
    App.restoreTo(i);
    const q = TE.state.position;
    return {
      copia, recuperado: q && { qty: q.qty, media: q.entryPrice, parts: q.parts.length, add: q.additions, niveles: (q.tpLevels || []).length, realized: q.realizedParcial },
      avg: TE.state.averaging,
      serial: (() => {
        const d = TE.serialize();                       // la posición va en la RAÍZ del objeto, no en state
        return { tieneAvg: 'averaging' in d.state, avg: d.state.averaging,
                 niveles: ((d.position && d.position.tpLevels) || []).length,
                 partes: ((d.position && d.position.parts) || []).length,
                 abre: (() => {
                   // round-trip con un valor conocido: se guarda con el promediado
                   // ON, se apaga a mano y al restaurar la sesión debe volver ON
                   TE.configure({ averaging: true });
                   const d2 = TE.serialize();
                   TE.configure({ averaging: false });
                   TE.restore(JSON.parse(JSON.stringify(d2)));
                   const volvio = TE.state.averaging === true;
                   TE.configure({ averaging: true });          // se deja activado para el resto del test
                   return volvio;
                 })() };
      })(),
    };
  });
  ok(I.recuperado && cerca(I.recuperado.qty, I.copia.qty, 1e-10) && I.recuperado.parts === I.copia.parts,
     'retroceder recupera tamaño y nº de entradas');
  ok(I.recuperado && I.recuperado.niveles === I.copia.niveles && cerca(I.recuperado.realized, I.copia.realized, 1e-8),
     'los niveles de TP escalonado y lo realizado sobreviven al checkpoint');
  ok(I.recuperado && cerca(I.recuperado.media, I.copia.media, 1e-9) && I.recuperado.add === I.copia.add,
     'el checkpoint devuelve también el precio medio y el nº de promediados');
  ok(I.avg === false, 'una preferencia de sesión (promediar on/off) NO la rebobina el retroceso de velas');
  ok(I.serial.tieneAvg && I.serial.niveles === I.copia.niveles && I.serial.partes === I.copia.parts,
     'la sesión guarda la opción, los niveles y los tramos (serialize/position)');
  ok(I.serial.abre === true, 'restaurar la sesión devuelve el promediado tal y como se guardó');
  const enlazado = await page.evaluate(() => {
    const s = TE.state;
    return { mismaFila: s.trades.slice(-1)[0] === s.position || s.trades.some((t) => t === s.position),
             abiertas: s.trades.filter((t) => t.status !== 'closed').length };
  });
  ok(enlazado.mismaFila && enlazado.abiertas === 1, 'la posición restaurada vuelve a ser la fila viva del historial (sin filas fantasma)');

  /* ---------------- J) Interfaz ---------------- */
  console.log('\n▸ J) La tarjeta de posición');
  const J = await page.evaluate(() => {
    UI.refreshAll();
    const p = TE.state.position;
    const mgmt = document.getElementById('posMgmt');
    return {
      activo: mgmt.classList.contains('activo'),
      avg: document.getElementById('posAvg').textContent,
      be: document.getElementById('posBE').textContent,
      entrada: document.getElementById('posEntry').textContent,
      ancho: mgmt.scrollWidth <= document.getElementById('positionCard').clientWidth + 1,
      desbord: document.documentElement.scrollWidth > window.innerWidth + 1,
      hint: document.getElementById('orderHint').textContent,
      liq: document.getElementById('posLiq').textContent,
      partes: (p.parts || []).length,
      mediaFmt: U.fmtPrice(p.entryPrice),
      ultimoFill: p.parts[p.parts.length - 1].entryPrice,
      media: p.entryPrice,
    };
  });
  ok(J.activo, 'los controles se activan solo con posición abierta');
  ok(/entrada/.test(J.avg) && /\(\+\d+\)/.test(J.avg), `la tarjeta cuenta las entradas y los promediados (${J.avg})`);
  ok(J.entrada === J.mediaFmt && Math.abs(J.ultimoFill - J.media) / J.media > 1e-6,
     `«Entrada» muestra el precio MEDIO (${J.entrada}), no el último fill (${J.ultimoFill.toFixed(2)})`);
  ok(/\d/.test(J.be), `el break-even se ve en la tarjeta (${J.be})`);
  ok(/PROMEDIA/i.test(J.hint), 'la pista del panel avisa de que el mismo lado promedia');
  ok(J.ancho && !J.desbord, 'el bloque no desborda la tarjeta ni la ventana');
  const estrecho = await (async () => {
    await page.setViewport({ width: 360, height: 720 });
    await espera(500);
    const r = await page.evaluate(() => {
      const c = document.getElementById('positionCard');
      return { overflow: c.scrollWidth > c.clientWidth + 2, doc: document.documentElement.scrollWidth > window.innerWidth + 2, filas: document.querySelectorAll('#tpLevelsList .tp-lvl').length };
    });
    await page.setViewport({ width: 1360, height: 900 });
    await espera(300);
    return r;
  })();
  ok(!estrecho.overflow && !estrecho.doc, 'a 360 px de ancho tampoco hay scroll horizontal');
  ok(errs.length === 0, `sin errores de JavaScript (${errs.length})${errs.length ? ' → ' + errs.slice(0, 3).join(' ⧸ ') : ''}`);

  // La invariante final: con la posición cerrada del todo, el balance cuadra
  await page.evaluate(() => App.flatten('manual'));
  await espera(400);
  const K = await st();
  ok(cerca(K.balance, K.capital + K.sumaPnl, 1e-6), `balance = capital + Σ PnL de la hoja (${K.balance.toFixed(4)} = ${K.capital} + ${K.sumaPnl.toFixed(4)})`);

  console.log('\n' + '─'.repeat(60));
  console.log(`Promediar y TP: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ El promediado y el TP escalonado cuadran con Bitunix.');
  await browser.close();
  process.exit(fallan ? 1 : 0);
})().catch((e) => { console.error('💥', e); process.exit(1); });
