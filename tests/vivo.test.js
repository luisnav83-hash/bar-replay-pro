/* Modo EN VIVO (js/liveFeed.js): pruebas con las respuestas de Binance SIMULADAS (no depende de la red).
   Se ejecuta contra el BUILD (bar-replay-pro-unico.html): `node tools/build-single.js` antes. */
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

  // Binance simulado: 1000 velas de 1h que acaban en la hora actual; la última puede moverse
  // (modo `estado.cambio`) o abrirse una nueva (`estado.nueva`).
  await p.evaluateOnNewDocument(() => {
    const H = 3600e3;
    const base = Math.floor(Date.now() / H) * H;
    const estado = { cambio: 0, nueva: false };
    window.__estado = estado;
    const fila = (t, k) => {
      const o = 60000 + (k % 17) * 3;
      const c = o + 5 + estado.cambio * 0.5;
      return [t, String(o), String(o + 40), String(o - 30), String(c), '12.5', 0, '900000', 77, '0', '0', '0'];
    };
    window.fetch = async (url) => {
      const u = String(url);
      if (!u.includes('/api/v3/klines')) return new Response('{}', { status: 404 });
      const limit = +(new URL(u).searchParams.get('limit') || 1000);
      const filas = [];
      const n = 1000;
      for (let i = n - 1; i >= 0; i--) filas.push(fila(base - i * H, n - 1 - i));
      if (estado.nueva) filas.push(fila(base + H, 0));
      const dev = filas.slice(-limit);
      return new Response(JSON.stringify(dev), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });

  await p.goto(FILE, { waitUntil: 'load' });
  await ESP(3000);

  console.log('Modo en vivo (Binance simulado)');

  await p.click('#btnVivo');
  await ESP(1500);
  const arranque = await p.evaluate(() => ({
    on: LF.on, n: App.candles.length, idx: BR.state.index, ultimo: App.candles.length - 1,
    precio: App.currentPrice(), cierre: App.candles[App.candles.length - 1].close,
    fuente: App.source, boton: document.getElementById('btnVivo').textContent.trim(),
    pulsado: document.getElementById('btnVivo').getAttribute('aria-pressed'),
    reproduciendo: BR.isPlaying(),
  }));
  ok(arranque.on && arranque.n === 1000, `al pulsar «En vivo» se cargan 1000 velas de Binance (n=${arranque.n})`);
  ok(arranque.idx === arranque.ultimo, `el cursor queda en la vela ACTUAL (índice ${arranque.idx} = última ${arranque.ultimo}), no en la penúltima`);
  ok(arranque.precio === arranque.cierre, `el precio del simulador es el cierre de la vela en curso (${arranque.precio})`);
  ok(arranque.fuente === 'Binance en vivo', `la fuente se rotula «${arranque.fuente}»`);
  ok(arranque.boton === '● En vivo' && arranque.pulsado === 'true', `el botón enseña el estado («${arranque.boton}», aria-pressed=${arranque.pulsado})`);
  ok(!arranque.reproduciendo, 'el replay no se pone a reproducir por sí solo');

  // Movimiento de precio dentro de la vela en curso
  await p.evaluate(() => { window.__estado.cambio = 4; });
  await p.evaluate(() => LF.tick());
  const tras = await p.evaluate(() => ({ n: App.candles.length, idx: BR.state.index, cierre: App.candles[App.candles.length - 1].close, precio: App.currentPrice() }));
  ok(tras.n === 1000 && tras.idx === 999, `un tick con la vela en curso movida no añade velas (n=${tras.n}, cursor ${tras.idx})`);
  ok(Math.abs(tras.cierre - tras.precio) < 1e-9 && tras.cierre > arranque.cierre, `la vela en curso se actualiza en sitio y el precio la sigue (${arranque.cierre} → ${tras.cierre})`);

  // Se abre una vela nueva
  await p.evaluate(() => { window.__estado.nueva = true; });
  await p.evaluate(() => LF.tick());
  await ESP(400);
  const nueva = await p.evaluate(() => ({ n: App.candles.length, idx: BR.state.index, ultimo: App.candles.length - 1, on: LF.on }));
  ok(nueva.n === 1001 && nueva.idx === nueva.ultimo && nueva.on, `al abrirse una vela nueva la serie crece a ${nueva.n} y el cursor la sigue (${nueva.idx})`);

  // Parar
  await p.click('#btnVivo');
  await ESP(300);
  const parado = await p.evaluate(() => ({ on: LF.on, boton: document.getElementById('btnVivo').textContent.trim(), t: LF.timer }));
  ok(!parado.on && parado.t === null && parado.boton === 'En vivo', `pulsar otra vez para el modo y el temporizador (${parado.boton})`);

  // «Cargar datos» durante el modo en vivo lo detiene (no se pisa la carga histórica)
  await p.click('#btnVivo');
  await ESP(1200);
  await p.click('#btnLoad');
  await ESP(300);
  const cargado = await p.evaluate(() => ({ on: LF.on, fuente: App.source }));
  ok(!cargado.on, `«Cargar datos» detiene el modo en vivo (fuente ahora: «${cargado.fuente}»)`);

  ok(errores.length === 0, `sin errores de JavaScript (${errores.length}${errores.length ? ': ' + errores[0] : ''})`);

  console.log(`\nModo en vivo: ${pass} superadas, ${fail} fallidas`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
