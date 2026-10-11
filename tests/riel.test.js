/* Riel de dibujo: candado (bloquear dibujos) y ojo (ocultar todos). Contra el BUILD:
   `node tools/build-single.js` antes. */
const path = require('path');
const puppeteer = require(process.env.PPTR_PATH || 'puppeteer');
const FILE = 'file://' + path.resolve(__dirname, '..', 'bar-replay-pro-unico.html');
const ESP = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e).slice(0, 160)));
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(FILE, { waitUntil: 'load' });
  await ESP(3000);

  console.log('Riel de dibujo: candado y ojo');

  const inicio = await p.evaluate(() => ({
    candado: !!document.getElementById('btnLockDrawings'),
    ojo: !!document.getElementById('btnHideDrawings'),
    pulsado: document.getElementById('btnLockDrawings').getAttribute('aria-pressed'),
    icono: document.getElementById('btnLockDrawings').textContent.trim(),
  }));
  ok(inicio.candado && inicio.ojo, 'el riel tiene el candado y el ojo');
  ok(inicio.pulsado === 'false' && inicio.icono === '🔓', `el candado empieza abierto (aria-pressed=${inicio.pulsado}, icono ${inicio.icono})`);

  // Un dibujo de soporte en el centro del gráfico
  await p.evaluate(() => {
    const c = App.candles[Math.floor(App.candles.length / 2)];
    DT._addDrawing({ type: 'hline', points: [{ t: c.time, price: c.close }] });
  });
  const sitio = await p.evaluate(() => {
    const d = DT.drawings[DT.drawings.length - 1];
    const x = DT._xOf(d.points[0].t), y = DT._yOf(d.points[0].price);
    return { n: DT.drawings.length, x, y, hit: !!DT._hitTest(x, y + 0) };
  });
  ok(sitio.n >= 1 && sitio.hit, `sin candado, el dibujo se puede seleccionar (cruce en x=${Math.round(sitio.x)}, y=${Math.round(sitio.y)})`);

  // Candado: bloquear
  await p.click('#btnLockDrawings');
  await ESP(200);
  const cerrado = await p.evaluate((y) => {
    const d = DT.drawings[DT.drawings.length - 1];
    return { locked: DT.locked, pulsado: document.getElementById('btnLockDrawings').getAttribute('aria-pressed'),
      icono: document.getElementById('btnLockDrawings').textContent.trim(),
      hit: !!DT._hitTest(DT._xOf(d.points[0].t), DT._yOf(d.points[0].price)),
      n: DT.drawings.length, seleccionado: DT.selected };
  });
  ok(cerrado.locked && cerrado.pulsado === 'true' && cerrado.icono === '🔒', `el candado queda cerrado (aria-pressed=${cerrado.pulsado}, icono ${cerrado.icono})`);
  ok(!cerrado.hit, 'con el candado puesto el dibujo NO se puede seleccionar');

  // Borrar con el candado: no se borra
  await p.evaluate(() => { DT.selected = DT.drawings[DT.drawings.length - 1]; DT.deleteSelected(); });
  const trasBorrar = await p.evaluate(() => DT.drawings.length);
  ok(trasBorrar === sitio.n, `con el candado puesto no se puede borrar un dibujo (quedan ${trasBorrar})`);

  // Candado: abrir otra vez
  await p.click('#btnLockDrawings');
  await ESP(200);
  const abierto = await p.evaluate(() => {
    const d = DT.drawings[DT.drawings.length - 1];
    return { locked: DT.locked, hit: !!DT._hitTest(DT._xOf(d.points[0].t), DT._yOf(d.points[0].price)) };
  });
  ok(!abierto.locked && abierto.hit, 'al abrir el candado el dibujo vuelve a seleccionarse');

  // Ojo: ocultar todos y volver a mostrarlos
  await p.click('#btnHideDrawings');
  await ESP(200);
  const ocultos = await p.evaluate(() => DT.drawings.every((d) => d.hidden));
  ok(ocultos, 'el ojo oculta todos los dibujos (siguen guardados)');
  const guardados = await p.evaluate(() => DT.drawings.length);
  ok(guardados === sitio.n, `ocultar no borra nada (${guardados} guardados)`);
  await p.click('#btnHideDrawings');
  await ESP(200);
  const visibles = await p.evaluate(() => DT.drawings.every((d) => !d.hidden));
  ok(visibles, 'el ojo vuelve a mostrar los dibujos');

  ok(errores.length === 0, `sin errores de JavaScript (${errores.length}${errores.length ? ': ' + errores[0] : ''})`);

  console.log(`\nRiel de dibujo: ${pass} superadas, ${fail} fallidas`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
