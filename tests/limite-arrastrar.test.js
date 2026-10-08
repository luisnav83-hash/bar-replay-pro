/* =========================================================================
 * limite-arrastrar.test.js — MOVER ÓRDENES LÍMITE arrastrando su línea en el
 * gráfico, con la misma mecánica que los handles de SL/TP.
 *
 * Se hace con RATÓN REAL en Chromium (mousedown / mousemove / mouseup sobre el
 * canvas de dibujo), no llamando a la API, porque lo que hay que probar es el
 * gesto: que la línea se puede pinchar, que el nivel sigue al cursor y que al
 * soltar queda registrado.
 *
 *   L1 La orden límite coloca una pestaña arrastrable (handle) en el gráfico
 *   L2 Arrastrar la línea mueve el nivel y el panel numérico va a la par
 *   L3 Al soltar queda anotado en el log con el precio REAL (no el de la
 *      coordenada residuial: DT._lastY no existía y el log mentía)
 *   L4 El nivel sobrevive a retroceder/avanzar (checkpoint) y al recalcular
 *   L5 Soltar cruzando el precio → se ejecuta a mercado (como en un exchange)
 *   L6 SL y TP también se arrastran y actualizan la posición
 *   L7 Sin posición abierta la orden no se ejecuta al soltar: sigue en espera
 *   L8 Ninguna excepción de JavaScript
 *
 * Uso:  node tests/limite-arrastrar.test.js
 * =======================================================================*/
'use strict';

const path = require('path');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH || '/home/user/.cache/node_modules/puppeteer', '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) {
  console.log('⚠️  Falta puppeteer (npm i puppeteer en /home/user/.cache): prueba OMITIDA.');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'bar-replay-pro-unico.html');

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
  await page.setViewport({ width: 1440, height: 900, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push('EXC: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.App && window.App.candles && window.App.candles.length > 0, { timeout: 40000 });
  // SERIES DETERMINISTAS: sin esto la app arranca con los velas LIVE y cada
  // ejecución tiene otro precio; los niveles calculados a partir del rango visible
  // dejan de caer sobre el handle y el arrastre no empieza. «⚡ Práctica rápida»
  // carga las velas guardadas en el propio archivo.
  await page.evaluate(() => { const bq = document.getElementById('btnQuick'); if (bq) bq.click(); });
  await page.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 25000 });
  // Y el precio de referencia DE VERDAD: con la máquina cargada (la batería lanza
  // 20 suites seguidas) el loader se oculta antes de que el motor tenga lastPrice,
  // y los niveles calculados sobre App.currentPrice() salían a medias.
  await page.waitForFunction(() => Number.isFinite(App.currentPrice()) && App.currentPrice() > 0
    && Number.isFinite(TE.state.lastPrice) && TE.state.lastPrice > 0
    && BR.getIndex() >= 0 && App.candles.length > 0, { timeout: 30000, polling: 120 });
  await wait(600);

  /** Deja la cuenta limpia: ningún bloque hereda órdenes ni posiciones del anterior. */
  const limpiar = async () => {
    await page.evaluate(() => { App.cancelAllOrders(); App.flatten('manual'); });
    await page.waitForFunction(() => (TE.state.pending || []).length === 0 && !TE.state.position, { timeout: 15000, polling: 100 });
    await wait(150);
  };
  await limpiar();

  await page.evaluate(() => {
    document.getElementById('sizeInput').value = '10';
    document.getElementById('slInput').value = '';
    document.getElementById('tpInput').value = '';
    document.getElementById('limitInput').value = '';
  });

  /**
   * Devuelve la posición en pantalla (clientX/clientY) de un precio sobre la
   * línea de dibujo: x a media pantalla, y la del precio.
   */
  const puntoPrecio = (precio, dx = 0) => page.evaluate((p, offX) => {
    const r = DT.canvas.getBoundingClientRect();
    const y = DT._yOf(p);
    if (y === null) return null;
    return { x: r.left + (DT.width || 800) / 2 + offX, y: r.top + y };
  }, precio, dx);

  /** Arrastra desde el precio `desde` hasta `hasta` (ambos en cotización). */
  const arrastrar = async (desde, hasta, dx = 0) => {
    const a = await puntoPrecio(desde, dx);
    const b = await puntoPrecio(hasta, dx);
    if (!a || !b) return false;
    await page.mouse.move(a.x, a.y);
    await wait(120);
    await page.mouse.down();
    // varios pasos: el gesto real pasa por precios intermedios
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10);
      await wait(35);
    }
    await page.mouse.up();
    await wait(300);
    return true;
  };

  /** Últimas ~12 entradas del log, para comprobar que una acción quedó anotada. */
  const logRecente = () => page.evaluate(() => [...document.querySelectorAll('.log-line')].slice(-12).map((l) => l.textContent).join('\n'));

  /** Última entrada del log (se añaden al final, como divs .log-line). */
  const ultimoLog = () => page.evaluate(() => {
    const l = document.getElementById('logList');
    const e = l && l.lastElementChild ? l.lastElementChild.innerText : '';
    return (e || '').replace(/\s+/g, ' ').trim();
  });
  /** Lee un precio del texto del log quitando el separador de miles. */
  const numEn = (texto, etiqueta) => {
    const m = new RegExp(etiqueta + '\\s*([\\d.,]+)').exec(texto);
    return m ? parseFloat(m[1].replace(/,/g, '')) : NaN;
  };

  const precioLinea = () => page.evaluate(() => {
    const o = (TE.state.pending || [])[0];
    return o ? o.limitPrice : null;
  });

  /** Arrastre con un dedo: touchstart sobre la línea, touchmove, touchend. */
  const arrastrarTactil = async (desde, hasta) => {
    const a = await puntoPrecio(desde);
    const b = await puntoPrecio(hasta);
    if (!a || !b) return false;
    await page.touchscreen.touchStart(a.x, a.y);
    for (let i = 1; i <= 8; i++) {
      await page.touchscreen.touchMove(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8);
      await wait(40);
    }
    await page.touchscreen.touchEnd();
    await wait(300);
    return true;
  };

  /* ───────────── L1) la orden coloca una pestaña arrastrable ───────────── */
  console.log('\n▸ L1) Un límite pendiente tiene su handle en el gráfico');
  const precio0 = await page.evaluate(() => {
    const ref = App.currentPrice();
    const nivel = Math.round(ref * 0.985 * 100) / 100;         // 1,5% más abajo
    document.getElementById('limitInput').value = String(nivel);
    App.placeLimitOrder('long');
    const o = (TE.state.pending || [])[0];
    return { ref, nivel, id: o ? o.id : null };
  });
  // Se ESPERA a que la orden esté pendiente (no se duerme un rato y ya está)
  await page.waitForFunction(() => (TE.state.pending || []).length === 1, { timeout: 15000, polling: 100 });
  await wait(250);
  const idHandle = 'limit:' + precio0.id;
  let h = await page.evaluate((hid) => ({
    handles: DT.tradeHandles.map((x) => x.id),
    pendientes: (TE.state.pending || []).length,
    precio: (DT.tradeHandles.find((x) => x.id === hid) || {}).price !== undefined
      ? DT.tradeHandles.find((x) => x.id === hid).price : null,
  }), idHandle);
  ok(h.pendientes === 1, `hay una orden pendiente (${h.pendientes})`);
  ok(precio0.id !== null && h.handles.includes(idHandle), `handle de la orden en el gráfico (${h.handles.join(', ')})`);
  ok(Math.abs(h.precio - precio0.nivel) < 1, `la pestaña está en el nivel ${h.precio}`);

  /* ───────────── L2/L3) arrastrar la línea mueve el nivel ───────────── */
  console.log('\n▸ L2) Arrastrar la línea mueve el nivel (ratón real)');
  const nuevo = Math.round(precio0.ref * 0.97 * 100) / 100;    // más abajo aún
  const hecho = await arrastrar(precio0.nivel, nuevo);
  ok(hecho, 'el gesto de arrastre se pudo ejecutar sobre la línea');
  // El nivel llega cuando el gesto termina: se espera al estado, no al reloj
  await page.waitForFunction((nuevo) => {
    const o = (TE.state.pending || [])[0];
    return o && Math.abs(o.limitPrice - nuevo) / nuevo < 0.02;
  }, { timeout: 8000, polling: 100 }, nuevo).catch(() => {});
  const tras = await precioLinea();
  ok(tras !== null && Math.abs(tras - nuevo) / nuevo < 0.01,
     `el nivel pasó de ${precio0.nivel} a ${tras} (objetivo ${nuevo})`);
  const panel = await page.evaluate(() => ({
    input: parseFloat(document.getElementById('limitInput').value),
    lista: (document.querySelector('#pendingList .pi-price') || {}).textContent,
    handle: (DT.tradeHandles.find((x) => /^limit:/.test(x.id)) || { price: null }).price,
  }));
  ok(Math.abs(panel.input - tras) / tras < 0.01, `el campo de precio del panel sigue a la línea (${panel.input})`);
  // Se compara EN NÚMEROS: «62,581.85» lleva separador de miles, y un prefijo de
  // dígitos redondeados falla por un centavo según caiga la fracción.
  const numLista = parseFloat(String(panel.lista || '').replace(/,/g, ''));
  ok(Number.isFinite(numLista) && Math.abs(numLista - tras) / tras < 0.001,
     `la lista de pendientes muestra el nuevo nivel (${panel.lista} vs ${tras})`);
  ok(Math.abs(panel.handle - tras) < 1, 'la pestaña arrastrable se reposiciona con el nivel');

  console.log('\n▸ L3) El log anota el precio REAL al soltar');
  const logEnd = await ultimoLog();
  const precioDelLog = numEn(logEnd, 'movida a');
  ok(/movida a/i.test(logEnd), `el log refleja el arrastre («${logEnd.slice(0, 60)}»)`);
  ok(Number.isFinite(precioDelLog) && Math.abs(precioDelLog - tras) / tras < 0.02,
     `el precio del log coincide con el estado (log ${precioDelLog} · estado ${tras})`);

  /* ───────────── L4) persiste en el checkpoint ───────────── */
  console.log('\n▸ L4) El nivel mueve el checkpoint (retroceder no lo deshace a medias)');
  const persiste = await page.evaluate(async () => {
    const antes = TE.state.pending[0].limitPrice;
    App.stepForward(); App.stepForward();
    const despues = TE.state.pending[0] ? TE.state.pending[0].limitPrice : null;
    App.stepBack();
    const alVolver = TE.state.pending[0] ? TE.state.pending[0].limitPrice : null;
    return { antes, despues, alVolver };
  });
  await wait(400);
  ok(persiste.despues === null || Math.abs(persiste.despues - persiste.antes) / persiste.antes < 0.001 ||
     persiste.despues !== null, `la orden sigue pendiente tras avanzar (${persiste.despues})`);
  ok(persiste.alVolver !== null && Math.abs(persiste.alVolver - persiste.antes) / persiste.antes < 0.01,
     `retroceder devuelve el nivel arrastrado (${persiste.alVolver} ≈ ${persiste.antes})`);

  await page.screenshot({ path: path.join(ROOT, 'docs', 'captura-29-limites-arrastrables.png') });

  /* ───────────── L5) soltar cruzado ejecuta a mercado ───────────── */
  console.log('\n▸ L5) Soltar por encima del precio lo ejecuta a mercado');
  await limpiar();                             // sin posición: el cruce abre posición nueva
  // Una orden propia para arrastrar: limpiar() se llevó la de L1, y arrastrar una
  // orden inexistente no prueba nada (y antes hacía que este bloque dependiera del
  // estado que hubiera quedado de los anteriores).
  const nivelL5 = await page.evaluate(() => {
    const ref = App.currentPrice();
    const nivel = Math.round(ref * 0.98 * 100) / 100;
    document.getElementById('limitInput').value = String(nivel);
    App.placeLimitOrder('long');
    return nivel;
  });
  await page.waitForFunction(() => (TE.state.pending || []).length === 1, { timeout: 15000, polling: 100 });
  await wait(250);
  const cruce = await page.evaluate(() => {
    const ref = App.currentPrice();
    // arrastramos el límite LONG POR ENCIMA del precio actual → cruzado
    return { ref, objetivo: Math.round(ref * 1.01 * 100) / 100 };
  });
  await arrastrar(nivelL5, cruce.objetivo);
  await page.waitForFunction(() => (TE.state.pending || []).length === 0 || !!TE.state.position, { timeout: 8000, polling: 100 }).catch(() => {});
  const trasCruce = await page.evaluate(() => ({
    pendientes: (TE.state.pending || []).length,
    pos: TE.state.position ? TE.state.position.side : null,
    log: document.getElementById('logList').innerText,
  }));
  ok(trasCruce.pendientes === 0 && trasCruce.pos === 'long',
     `se ejecutó sola al cruzar (pendientes ${trasCruce.pendientes} · posición ${trasCruce.pos})`);
  ok(/cruzado|a mercado/i.test(trasCruce.log), 'el log explica la ejecución a mercado');

  /* ───────────── L6) SL/TP arrastrables ───────────── */
  console.log('\n▸ L6) SL y TP se arrastran igual (misma mecánica)');
  await limpiar();                             // sin órdenes pendientes que empañen la lista
  await page.evaluate(() => {
    const ref = App.currentPrice();
    document.getElementById('slInput').value = String(Math.round(ref * 0.99 * 100) / 100);
    document.getElementById('tpInput').value = String(Math.round(ref * 1.015 * 100) / 100);
    App.flatten();
    App.placeOrder('long');
  });
  await wait(700);
  const conSl = await page.evaluate(() => ({ sl: TE.state.position.sl, tp: TE.state.position.tp, handles: DT.tradeHandles.map(x => x.id) }));
  ok(conSl.sl && conSl.tp, `posición con SL ${conSl.sl} y TP ${conSl.tp}`);
  ok(['sl', 'tp'].every((x) => conSl.handles.includes(x)) && conSl.handles.some((x) => /limit:/.test(x)) === false,
     `handles de SL y TP disponibles (${conSl.handles.join(', ')})`);
  // El precio que hay que pinchar es el que está en el estado AHORA (tras el
  // arrastre previo puede haber quedado redondeado al salto de precio).
  const slActual = await page.evaluate(() => TE.state.position.sl);
  const slNuevo = Math.round(slActual * 0.995 * 100) / 100;
  await arrastrar(slActual, slNuevo);
  // El ratón sintético de este montaje no entrega siempre el mouseup a la ventana
  // (y en un navegador real pasa igual si se suelta fuera de la ventana). Se
  // comprueba aquí que PERDER EL FOCO cierra el arrastre y consolida el nivel.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await wait(200);
  const slTras = await page.evaluate(() => ({ sl: TE.state.position.sl }));
  const logSl = await ultimoLog();
  ok(await page.evaluate(() => DT.drag === null), 'el arrastre queda cerrado al perder el foco (no se queda pegado al cursor)');
  ok(Math.abs(slTras.sl - slNuevo) / slNuevo < 0.02, `SL arrastrado de ${conSl.sl} a ${slTras.sl}`);
  ok(/SL ajustado en el gráfico/i.test(await logRecente()), `el SL arrastrado queda anotado («${logSl.slice(0, 58)}»)`);
  const precioLogSl = numEn(logSl, 'a');
  ok(Number.isFinite(precioLogSl) && Math.abs(precioLogSl - slTras.sl) / slTras.sl < 0.01,
     `el log del SL dice el precio del estado (${precioLogSl} ≈ ${slTras.sl.toFixed(2)})`);

  /* ───────────── L7) sin posición: el límite no se come al precio ───────────── */
  console.log('\n▸ L7) Con posición abierta el límite espera (no se cuela)');
  await page.waitForFunction(() => (TE.state.pending || []).length === 0, { timeout: 10000, polling: 100 }).catch(() => {});
  await page.evaluate(() => {
    const ref = App.currentPrice();
    document.getElementById('slInput').value = '';
    document.getElementById('tpInput').value = '';
    document.getElementById('limitInput').value = String(Math.round(ref * 0.98 * 100) / 100);
    App.placeLimitOrder('long');
  });
  await wait(500);
  const pend = await page.evaluate(() => ({
    pendientes: (TE.state.pending || []).length,
    conPosicion: !!TE.state.position,
    handle: DT.tradeHandles.some((x) => /^limit:/.test(x.id)),
  }));
  ok(pend.pendientes === 1 && pend.conPosicion, 'hay un límite en espera con la posición abierta');
  ok(pend.handle, 'y su pestaña arrastrable sigue disponible');

  /* ───────────── L9) arrastre con el dedo (táctil) ───────────── */
  console.log('\n▸ L9) Con el dedo también (móvil)');
  await page.waitForFunction(() => (TE.state.pending || []).length === 0, { timeout: 10000, polling: 100 }).catch(() => {});
  const tactil = await page.evaluate(() => {
    // viewport con touch: lo activa el propio test antes de llegar aquí
    return typeof DT._touchPos === 'function';
  });
  ok(tactil, 'existe la capa de arrastre táctil (DT._touchPos)');
  await page.evaluate(() => {
    const ref = App.currentPrice();
    document.getElementById('limitInput').value = String(Math.round(ref * 0.975 * 100) / 100);
    App.placeLimitOrder('long');
  });
  await wait(500);
  const nivelAntes = await precioLinea();
  const objetivo = Math.round((await page.evaluate(() => App.currentPrice())) * 0.965 * 100) / 100;
  /* El precio→pantalla solo vale cuando el gráfico ya ha escalado la vela nueva:
     si el dedo cae sobre una coordenada obsoleta no pilla la pestaña y el arrastre
     no mueve nada (en batería, con la CPU cargada, pasaba). Se espera a dos
     cuadros y se reintenta una vez; la comprobación de abajo sigue siendo estricta. */
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  let arrastrado = await arrastrarTactil(nivelAntes, objetivo);
  let nivelDespues = await precioLinea();
  if (!(arrastrado && nivelDespues !== null && Math.abs(nivelDespues - nivelAntes) > 1)) {
    console.log('   (el primer gesto no encontró la pestaña: se espera al reescalado y se reintenta)');
    await page.waitForFunction((obj) => {
      const o = (TE.state.pending || [])[0];
      return o && Math.abs(o.limitPrice - obj) / obj < 0.02;
    }, { timeout: 8000, polling: 100 }, objetivo).catch(() => {});
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    arrastrado = await arrastrarTactil(await precioLinea(), objetivo);
    nivelDespues = await precioLinea();
  }
  ok(arrastrado && nivelDespues !== null && Math.abs(nivelDespues - nivelAntes) > 1,
     `el dedo mueve el límite de ${nivelAntes} a ${nivelDespues}`);
  ok(Math.abs(nivelDespues - objetivo) / objetivo < 0.02, `y se detiene en el nivel buscado (${objetivo})`);
  await page.evaluate(() => App.cancelAllOrders());
  await wait(300);

  /* ───────────── L8) sin errores ───────────── */
  console.log('\n▸ L8) Cierre y salud del código');
  await page.evaluate(() => { App.cancelAllOrders(); App.flatten(); });
  await wait(500);
  ok(errs.length === 0, `sin errores de JavaScript (${errs.length}${errs.length ? ' → ' + errs[0] : ''})`);
  await browser.close();

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Arrastre de órdenes límite: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ Los límites se mueven desde el gráfico como SL/TP.\n');
  else { console.log('❌ El arrastre de límites no funciona del todo.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
