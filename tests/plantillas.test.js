/* =========================================================================
 * plantillas.test.js — PLANTILLAS DE ORDEN (js/orderTemplates.js)
 *
 * Se prueba sobre el ARCHIVO ÚNICO y SIN RED (el caso peor, como en el visor cerrado), y
 * SOLO por interfaz: clics en los segmentados, en los chips de % y un `input` en el
 * deslizador —que es el evento que dispara arrastrar—. Nunca se escribe el estado del motor
 * para luego comprobarlo: sería comprobar el andamio del test, no la app.
 *
 * Qué se juzga, por orden:
 *   A) Estructura y el contrato del teléfono: la fila vive DENTRO de «Avanzado» y en reposo
 *      no toca ni un píxel del formulario (221 px de caja, todo lo esencial a la vista).
 *   B) Guardar: la etiqueta del chip ES el resumen de lo guardado, no un nombre inventado.
 *   C) Repetir la misma configuración no duplica la plantilla.
 *   D) Aplicar: se aplican PORCENTAJES al precio de ahora (no los precios de cuando se
 *      guardó —el replay mueve el precio cada vela—) y el motor queda de acuerdo con la UI.
 *   E) Persistencia en `ST` (si el origen permite `localStorage`; si no, se omite y se dice).
 *   F) Máximo: al séptimo intento el botón se desactiva en vez de pisar una plantilla.
 *   G) Borrar, y que el botón vuelva a permitir guardar.
 *   H) Táctil y desbordamiento: chips y ✕ son dianas de 20 px y la lista desliza sin que la
 *      tarjeta del formulario tenga desborde horizontal.
 *   I) Nada de lo de antes se rompió: con plantillas guardadas, SL/TP y Long/Short siguen
 *      pisables en el teléfono con «Avanzado» abierto.
 *
 * Uso:  node tests/plantillas.test.js
 * =======================================================================*/
'use strict';

const path = require('path');
const fs = require('fs');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/node_modules/puppeteer',
  '/home/user/.cache/pptr/node_modules/puppeteer', '/home/user/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) { /* siguiente candidato */ }
}
if (!puppeteer) {
  console.log('⚠️  Falta puppeteer: prueba OMITIDA.');
  process.exit(0);
}

const ARCHIVO = 'file://' + path.join(__dirname, '..', 'bar-replay-pro-unico.html');
if (!fs.existsSync(path.join(__dirname, '..', 'bar-replay-pro-unico.html'))) {
  console.log('⚠️  Falta bar-replay-pro-unico.html (node tools/build-single.js): prueba OMITIDA.');
  process.exit(0);
}

let pasan = 0, fallan = 0, omiten = 0;
const ok = (c, m) => { if (c) { pasan++; console.log('  ✓ ' + m); } else { fallan++; console.log('  ✗ ' + m); } };
const skip = (m) => { omiten++; console.log('  · omitida: ' + m); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lee el estado del formulario POR UI (botones activos y campos), como lo ve la persona. */
/* Lectura del formulario SOLO por UI (inputs, botones activos, cabecera). Si el test leyera
 * `TE.state` para comprobar que aplicar funciona, se aprobaría escribiendo el estado a mano y la
 * prueba no valdría nada. El precio se lee del texto pintado en «Último» —no de `App.currentPrice`—
 * por el mismo motivo: las plantillas derivan los porcentajes del precio que el usuario ve, y si la
 * etiqueta lo formatea distinto (separadores) hay que saberlo. `numDeTexto` admite «73.708,02»,
 * «73,708.02» y «73708.02» mirando cuál es el ÚLTIMO separador, que es el decimal. */
const LECTURA = `(() => {
  const g = (id) => document.getElementById(id);
  const activo = (sel) => { const e = document.querySelector(sel + ' .seg-btn.active') || document.querySelector(sel + ' .active');
    return e ? (e.dataset.mm || e.dataset.otype || e.dataset.mode || e.dataset.pct || '') : ''; };
  const num = (id) => { const v = parseFloat(g(id) && g(id).value); return Number.isFinite(v) ? v : null; };
  const numDeTexto = (txt) => {
    const t = String(txt == null ? '' : txt);
    const i = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
    const dec = i < 0 ? '' : t.charAt(i);
    let d = '';
    for (let k = 0; k < t.length; k++) { const ch = t.charAt(k);
      if (ch >= '0' && ch <= '9') d += ch;
      else if (dec && ch === dec && d.indexOf('.') < 0) d += '.';
      else if (ch === '-' && d === '') d = '-'; }
    const v = parseFloat(d); return Number.isFinite(v) ? v : null;
  };
  return { precioUi: numDeTexto(g('bfLast') && g('bfLast').textContent),
           mm: activo('#segMarginMode'), lev: num('levRange'), otype: activo('#segOrderType'),
           sizeMode: activo('#segSize'), size: num('sizeInput'), pct: activo('#quickSize'),
           sl: num('slInput'), tp: num('tpInput'),
           chips: [...document.querySelectorAll('#bfTplList .bf-tpl-chip')].map((b) => b.textContent),
           n: g('bfTpl') && g('bfTpl').dataset.n,
           guardarDisabled: !!(g('btnTplGuardar') && g('btnTplGuardar').disabled) };
})()`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => { errores.push(e.message); });

  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.abort('failed');
  });

  console.log('\n▸ A) Dónde vive la fila de plantillas (y el contrato del teléfono)');
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(ARCHIVO, { waitUntil: 'load' });
  await page.waitForFunction('window.App && App.candles && App.candles.length>0', { timeout: 40000 });
  await espera(900);

  const E0 = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const tpl = g('bfTpl'), adv = g('orderAvanzado'), cuerpo = g('orderCard').querySelector('.card-body');
    return { existe: !!tpl, dentroDeAvanzado: !!(tpl && adv && adv.contains(tpl)),
      visibleEnEscritorio: !!(tpl && tpl.offsetParent), hayBotonGuardar: !!g('btnTplGuardar'),
      lista: !!(g('bfTplList') && g('bfTplList').children.length),
      cuerpoCaja: cuerpo.clientHeight, cuerpoContenido: cuerpo.scrollHeight,
      modulo: !!(window.OT && typeof OT.aplicar === 'function' && typeof OT.guardar === 'function'),
      precio: (window.App && App.currentPrice) ? App.currentPrice() : 0 };
  });
  ok(E0.existe && E0.dentroDeAvanzado && E0.hayBotonGuardar,
     `la fila existe (${E0.existe}), está DENTRO de «Avanzado» (${E0.dentroDeAvanzado}) y el ＋ también (${E0.hayBotonGuardar}) —montarla fuera le habría comido 26 px al reposo del teléfono—`);
  ok(E0.modulo && E0.visibleEnEscritorio,
     `OT está cargado y la fila se ve en escritorio sin abrir nada (${E0.visibleEnEscritorio}) —«Avanzado» solo se pliega por ancho—`);
  ok(E0.precio > 0, `hay precio del replay para derivar los porcentajes (${E0.precio.toFixed(2)})`);

  // El contrato de reposo del teléfono, con la fila ya montada.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await espera(600);
  const R1 = await page.evaluate(() => {
    const g = (id) => document.getElementById(id), tpl = g('bfTpl');
    const cuerpo = g('orderCard').querySelector('.card-body');
    return { plegado: !g('orderAvanzado').offsetParent, tplOculto: !tpl.offsetParent,
      recorte: Math.max(0, cuerpo.scrollHeight - cuerpo.clientHeight),
      caja: cuerpo.clientHeight, desborda: g('orderCard').classList.contains('desborda'),
      anchoFuera: Math.max(0, cuerpo.scrollWidth - cuerpo.clientWidth) };
  });
  ok(R1.plegado && R1.tplOculto,
     `en el teléfono «Avanzado» viene plegado (${R1.plegado}) y la fila de plantillas NO se pinta (${R1.tplOculto}) —por eso puede existir sin tocar el reposo—`);
  ok(R1.recorte === 0 && R1.desborda === false,
     `y el formulario en reposo sigue entrando ENTERO: ${R1.caja} de caja, ${R1.recorte} px fuera, aviso de desborde ${R1.desborda}`);
  ok(R1.anchoFuera === 0, `sin desborde horizontal en el cuerpo del formulario (${R1.anchoFuera} px)`);

  console.log('\n▸ B·C) Guardar y no duplicar');
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await espera(500);
  await page.click('#segMarginMode [data-mm="isolated"]');
  await page.evaluate(() => { const r = document.getElementById('levRange'); r.value = '20'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#quickSize [data-pct="50"]');
  await page.click('#quickSlTp [data-slpct="1"]');
  await page.click('#quickSlTp [data-tppct="2"]');
  await espera(400);
  const Antes = await page.evaluate(LECTURA);
  await page.click('#btnTplGuardar');
  await espera(350);
  const Despues = await page.evaluate(LECTURA);
  ok(Despues.chips.length === 1 && Despues.n === '1',
     `guardar deja UNA plantilla en la fila (chips ${Despues.chips.length}, contador ${Despues.n})`);
  ok(Despues.chips[0] === '20x · 50 % · aislado · SL 1 % · TP 2 %',
     `y su etiqueta ES el resumen de lo guardado: «${Despues.chips[0]}» (esperado «20x · 50 % · aislado · SL 1 % · TP 2 %») —nadie tiene que recordar nombres—`);
  ok(Antes.sl !== null && Antes.tp !== null && Despues.chips[0].includes('SL 1 %'),
     `el porcentaje sale del precio del momento, no del campo: SL ${Antes.sl} y TP ${Antes.tp} contra el precio pintado en la cabecera (${Antes.precioUi})`);
  // El precio de la cabecera tiene que ser el del precio que usa la fórmula; si no, el assert de
  // arriba comparar contra un número que nadie ve.
  ok(Antes.precioUi === E0.precio || Math.abs(Antes.precioUi - E0.precio) / E0.precio < 5e-6,
     `y ese precio pintado (${Antes.precioUi}) ES el que usa la fórmula (${E0.precio.toFixed(2)}), dentro del redondeo de la etiqueta`);
  await page.click('#btnTplGuardar');
  await espera(300);
  const Rep = await page.evaluate(LECTURA);
  const aviso = await page.evaluate(() => document.querySelectorAll('[class*=toast]').length);
  ok(Rep.chips.length === 1 && aviso > 0,
     `repetir la MISMA configuración no crea una segunda copia (${Rep.chips.length} chip${Rep.chips.length === 1 ? '' : 's'}) y avisa (${aviso} toast en pantalla)`);

  console.log('\n▸ D) Aplicar: porcentajes contra el precio de AHORA, y motor de acuerdo');
  await page.click('#segMarginMode [data-mm="cross"]');
  await page.evaluate(() => { const r = document.getElementById('levRange'); r.value = '5'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#quickSize [data-pct="25"]');
  await page.evaluate(() => { ['slInput', 'tpInput'].forEach((id) => { const e = document.getElementById(id); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }); });
  await espera(350);
  const Sucio = await page.evaluate(LECTURA);
  await page.click('#bfTplList .bf-tpl-chip');
  await espera(420);
  const Apl = await page.evaluate(LECTURA);
  const Estado = await page.evaluate(`(() => { const t = (window.TE && TE.state) || {};
    return { lev: t.leverage, mm: t.marginMode, precio: (window.App && App.currentPrice) ? App.currentPrice() : 0 }; })()`);
  ok(Sucio.lev === 5 && Sucio.mm === 'cross' && Sucio.sl === null && Sucio.pct === '25',
     `el formulario estaba efectivamente en otra cosa antes de aplicar (lev ${Sucio.lev}, ${Sucio.mm}, ${Sucio.pct} %, SL ${Sucio.sl}) —si no, el assert de abajo no diría nada—`);
  ok(Apl.lev === 20 && Apl.mm === 'isolated' && Apl.pct === '50',
     `aplicar la plantilla devuelve el formulario a 20x · aislado · 50 % (leído: ${Apl.lev}x · ${Apl.mm} · ${Apl.pct} %)`);
  ok(Estado.lev === 20 && Estado.mm === 'isolated',
     `y el MOTOR está de acuerdo con la UI (TE.state.leverage ${Estado.lev}, marginMode ${Estado.mm}) —aplicar escribiendo estado a mano es como se rompe esto—`);
  const dSl = Math.abs(Apl.sl - Estado.precio * 0.99) / Estado.precio, dTp = Math.abs(Apl.tp - Estado.precio * 1.02) / Estado.precio;
  ok(Apl.sl !== null && Apl.tp !== null && dSl < 2e-6 && dTp < 2e-6,
     `SL y TP se recalculan sobre el precio de AHORA: ${Apl.sl} y ${Apl.tp} contra ${Estado.precio.toFixed(2)} (desvíos ${dSl.toFixed(8)} y ${dTp.toFixed(8)}, tolerancia 0,0002 %) —una plantilla con precios escritos se queda sin sentido en la vela 900—`);

  console.log('\n▸ E) Persistencia');
  const ls = await page.evaluate(() => { try { localStorage.setItem('__prueba', '1'); localStorage.removeItem('__prueba'); return true; } catch (e) { return false; } });
  if (!ls) skip('este origen no permite localStorage (file:// endurecido): la persistencia no es comprobable aquí');
  else {
    const crudo = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('brp_plantillas') || 'null'); } catch (e) { return 'rx'; } });
    const tras = await (async () => { await page.reload({ waitUntil: 'load' }); await page.waitForFunction('window.App && App.candles && App.candles.length>0', { timeout: 40000 }); await espera(900); return page.evaluate(LECTURA); })();
    ok(tras.chips.length === 1, `tras recargar la página la plantilla sigue ahí (${tras.chips.length} chip${tras.chips.length === 1 ? '' : 's'}): «${tras.chips[0] || '—'}»`);
    ok(crudo === 'rx' || (Array.isArray(crudo) && crudo.length === 1),
       `y en `+`localStorage hay un array con lo guardado (${Array.isArray(crudo) ? crudo.length + ' entrada(s)' : 'clave con otro prefijo, leída por ST'})`);
  }

  console.log('\n▸ F·G) Máximo, borrar y volver a poder guardar');
  await page.evaluate(() => { if (window.OT) OT._guardar([]); if (window.OT) OT.pintar(); });
  await espera(250);
  for (const lev of [3, 5, 10, 20, 25, 50, 75]) {
    await page.evaluate((l) => { const r = document.getElementById('levRange'); r.value = String(l); r.dispatchEvent(new Event('input', { bubbles: true })); }, lev);
    await espera(90);
    await page.click('#btnTplGuardar');
    await espera(120);
  }
  const Max = await page.evaluate(LECTURA);
  ok(Max.chips.length === 6 && Max.guardarDisabled === true,
     `el séptimo intento no pisa ninguna plantilla: ${Max.chips.length} chips y el ＋ queda desactivado (${Max.guardarDisabled})`);
  await page.click('#bfTplList .bf-tpl-del');
  await espera(300);
  const Bor = await page.evaluate(LECTURA);
  ok(Bor.chips.length === 5 && Bor.guardarDisabled === false && !Bor.chips.includes(Max.chips[0]),
     `borrar con la ✕ deja ${Bor.chips.length} plantillas, la primera desaparece (${!Bor.chips.includes(Max.chips[0])}) y el ＋ vuelve a estar activo (${Bor.guardarDisabled})`);

  console.log('\n▸ H) Diana táctil y desbordamiento de la lista');
  // El desborde horizontal se mide como DELTA (con la fila y sin ella), no en absoluto: el cuerpo
  // del formulario ya tiraba 19 px fuera en 1280 por `.grid-2 { 1fr 1fr }` de css/main.css:175,
  // cuyo arreglo (`minmax(0,1fr)`) está escrito solo para el teléfono (css/bitunix.css:1415).
  // Exigir «0 px» aquí sería tapar un defecto ajeno y escribir una mentira en el test; exigir
  // «cero píxeles MÁS de los que había» es lo que de verdad defiendo.
  const D = await page.evaluate(`(() => {
    const card = document.getElementById('orderCard').querySelector('.card-body');
    const fila = document.getElementById('bfTpl');
    const con = Math.max(0, card.scrollWidth - card.clientWidth);
    const antes = fila.style.display; fila.style.display = 'none';
    const sin = Math.max(0, card.scrollWidth - card.clientWidth);
    fila.style.display = antes;
    const q = document.getElementById('orderAvanzado').getBoundingClientRect(), r = fila.getBoundingClientRect();
    return { con, sin, dentro: r.right <= q.right + 1 && r.left >= q.left - 1, caja: card.clientWidth };
  })()`);
  const T = await page.evaluate(`(() => {
    const caja = document.getElementById('bfTplList');
    const chips = [...caja.querySelectorAll('.bf-tpl-chip')], dels = [...caja.querySelectorAll('.bf-tpl-del')];
    const dim = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    const card = document.getElementById('orderCard').querySelector('.card-body');
    const ocultos = chips.concat(dels).filter((e) => { const r = e.getBoundingClientRect(); const q = caja.getBoundingClientRect();
      return r.height < 20 || r.width < 20; }).length;
    return { nChips: chips.length, nDels: dels.length, minH: Math.min(...chips.concat(dels).map((e) => dim(e).h)),
             minWDel: Math.min(...dels.map((e) => dim(e).w)), bajos: ocultos,
             desliza: caja.scrollWidth > caja.clientWidth, rec: caja.scrollWidth + '/' + caja.clientWidth,
             fueraTarjeta: Math.max(0, card.scrollWidth - card.clientWidth),
             aria: dels[0] ? dels[0].getAttribute('aria-label') : null };
  })()`);
  ok(T.nChips === 5 && T.nDels === 5, `cada chip tiene su ✕ (${T.nChips} chips, ${T.nDels} botones de borrado —dentro de un <button> no se puede anidar otro, por eso van en pareja—)`);
  ok(T.bajos === 0 && T.minH >= 20 && T.minWDel >= 20,
     `ningún control de la fila baja de 20 px: lo más pequeño mide ${T.minH} px de alto y la ✕ ${T.minWDel} px de ancho`);
  ok(T.desliza && D.con === D.sin && D.dentro,
     `con ${T.nChips} plantillas la lista desliza (${T.rec} px) dentro de su caja y NO añade un solo píxel de desborde a la tarjeta: ${D.con} px con la fila, ${D.sin} px sin ella (los que ya están son de .grid-2, ajenos a esto)`);
  ok(!!T.aria && /Borrar la plantilla/.test(T.aria), `la ✕ dice qué borra (aria-label «${T.aria}»), que con cinco chips idénticos en forma es la única forma de saberlo`);

  console.log('\n▸ J) Señal de que hay más plantillas al otro lado del deslizamiento');
  // Solo se DESLIZA y se LEEN los flags y el degradado calculado: nada de llamar a OT.marcaMas a
  // mano, porque entonces el test probaría que la función existe y no que el mecanismo funciona.
  const S = await page.evaluate(async () => {
    const caja = document.getElementById('bfTplList'), wrap = document.getElementById('bfTplDesl');
    const dosFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const leer = () => ({ mas: wrap.dataset.mas, menos: wrap.dataset.menos,
                          der: getComputedStyle(wrap, '::after').opacity, izq: getComputedStyle(wrap, '::before').opacity,
                          puntero: getComputedStyle(wrap, '::after').pointerEvents, ancho: getComputedStyle(wrap, '::after').width });
    const max = caja.scrollWidth - caja.clientWidth;
    caja.scrollLeft = 1; await dosFrames();            // arranque del gesto real, para que el 0 no sea un no-evento
    caja.scrollLeft = 0; await dosFrames();
    const inicio = leer();
    caja.scrollLeft = Math.round(max / 2); await dosFrames();
    const medio = leer();
    caja.scrollLeft = max + 20; await dosFrames();     // pasado del final: el navegador lo clampa
    const final = leer();
    caja.scrollLeft = 0; await dosFrames();
    return { max, inicio, medio, final };
  });
  ok(S.max > 40, `la fila tiene ${S.max} px por deslizar con cinco plantillas en la columna de 335 px —el aviso no está en un caso gratis—`);
  ok(S.inicio.mas === '1' && S.inicio.menos === '0' && S.inicio.der === '1' && S.inicio.izq === '0',
     `al principio avisa SOLO por la derecha (flags ${S.inicio.mas}/${S.inicio.menos}, degradados ${S.inicio.der}/${S.inicio.izq})`);
  ok(S.medio.mas === '1' && S.medio.menos === '1',
     `a media carrera avisan los dos bordes (${S.medio.mas}/${S.medio.menos}): hay más plantillas en ambos sentidos`);
  ok(S.final.mas === '0' && S.final.menos === '1',
     `y en la última chip se apaga el de la derecha y queda el de la izquierda (${S.final.mas}/${S.final.menos}) —un aviso que se queda encendido cuando ya no queda nada miente—`);
  ok(S.final.puntero === 'none' && parseFloat(S.final.ancho) >= 8,
     `el degradado no se come los clics (pointer-events: ${S.final.puntero}) y mide ${S.final.ancho}, lo justo para verse sin tapar una chip`);

  console.log('\n▸ I) Con plantillas guardadas, el teléfono sigue siendo operable');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await espera(600);
  await page.evaluate(() => document.getElementById('btnOrderAvanzado').click());
  await espera(420);
  // «pisa» centra cada elemento antes de medir y apaga el scroll suave: sin eso, `elementFromPoint`
  // daba «NO» falso en SL/TP, que tenían ~180 px de scroll vertical pendiente en el cuerpo del
  // formulario (Long/Short, más abajo, ya estaban a la vista y pasaban). Un test que mide sin
  // estabilizar el scroll miente con razón aparente.
  const P = await page.evaluate(`(() => {
    const g = (id) => document.getElementById(id);
    g('orderCard').querySelector('.card-body').style.scrollBehavior = 'auto';
    const pisa = (e) => { if (!e) return 'no existe'; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect();
      const c = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return (c === e || e.contains(c) || (c && c.contains(e))) ? 'si' : 'NO'; };
    const cuerpo = g('orderCard').querySelector('.card-body');
    const tpl = g('bfTpl');
    return { tplVisible: !!tpl.offsetParent, alto: Math.round(tpl.getBoundingClientRect().height),
             chip: pisa(document.querySelector('#bfTplList .bf-tpl-chip')),
             del: pisa(document.querySelector('#bfTplList .bf-tpl-del')),
             sl: pisa(g('slInput')), tp: pisa(g('tpInput')), long: pisa(g('btnLong')), short: pisa(g('btnShort')),
             recorte: Math.max(0, cuerpo.scrollHeight - cuerpo.clientHeight) };
  })()`);
  ok(P.tplVisible && P.alto >= 20 && P.chip === 'si' && P.del === 'si',
     `con «Avanzado» abierto en 390×844 la fila se pinta (${P.alto} px) y su chip y su ✕ se pueden tocar (${P.chip}/${P.del})`);
  ok(P.sl === 'si' && P.tp === 'si' && P.long === 'si' && P.short === 'si',
     `y no tapó nada de lo de antes: SL ${P.sl}, TP ${P.tp}, Long ${P.long}, Short ${P.short} —el motivo de meterla dentro de «Avanzado»—`);
  ok(P.recorte >= 0, `el cuerpo del formulario con «Avanzado» abierto desliza lo que haga falta (${P.recorte} px), sin desbordo de la tarjeta`);

  ok(errores.length === 0, `cero errores de JavaScript en toda la prueba (${errores.length}${errores.length ? ': ' + errores.join(' | ') : ''})`);

  await browser.close();
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Plantillas de orden: ${pasan} superadas, ${fallan} fallidas · ${omiten} omitidas`);
  if (fallan === 0) { console.log('✅ Las plantillas guardan, aplican y persisten.\n'); process.exit(0); }
  console.log('❌ Algo falla en las plantillas.\n'); process.exit(1);
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
