/* =========================================================================
 * tests/boot.test.js — Prueba del ARRANQUE EN ENTORNOS SIN RED.
 *
 *  Simula el peor caso de una vista previa embebida: `fetch` que nunca
 *  responde (ni éxito ni error) y `localStorage` bloqueado. La aplicación
 *  debe seguir siendo usable: en pocos segundos tiene que arrancar en modo
 *  DEMO sin quedarse atrapada en el spinner y sin errores en consola.
 *
 *  Ejecutar:  node tests/boot.test.js
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
for (const c of ['jsdom', process.env.JSDOM_PATH, '/home/user/.cache/node_modules/jsdom']) {
  if (!c) continue;
  try { ({ JSDOM } = require(c)); break; } catch (e) {}
}
if (!JSDOM) {
  console.log('⚠️  jsdom no está instalado: se omite la prueba de arranque.');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** Detecta en qué puerto está escuchando el servidor de desarrollo. */
async function detectBase() {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  for (const port of [3000, 8080, 8000, 5000, 5173]) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1200) });
      if (r.ok) return `http://127.0.0.1:${port}`;
    } catch (e) {}
  }
  return null;
}

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (p === 'createLinearGradient' || p === 'createPattern') return () => ({ addColorStop: noop });
      if (p === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * Math.max(1, w * h)) });
      return noop;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

const consoleErrors = [];

/** Crea el DOM simulado apuntando al servidor real (base). */
function createDom(base) {
  return new JSDOM(html, {
  url: base + '/index.html',      // origen http real: los scripts cargan del servidor local
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  beforeParse(w) {
    Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return 900; }, configurable: true });
    Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get() { return 420; }, configurable: true });
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 420, width: 900, height: 420 });
    w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(this); };
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA';
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    // localStorage bloqueado, como en un iframe con sandbox="allow-scripts"
    Object.defineProperty(w, 'localStorage', {
      configurable: true,
      get() { throw new w.DOMException('The operation is insecure.', 'SecurityError'); },
    });
    // ⚠️ fetch que NUNCA responde: simula red bloqueada que no falla rápido
    w.fetch = () => new Promise(() => {});
    w.console.error = (...a) => consoleErrors.push('console.error: ' + a.join(' '));
    w.console.warn = () => {};
    w.addEventListener('error', (e) => consoleErrors.push('onerror: ' + (e.message || e.error)));
  },
  });
}

(async () => {
  const base = await detectBase();
  if (!base) {
    console.log('⚠️  No hay servidor escuchando (arranca `node server.js`): prueba OMITIDA.');
    process.exit(0);
  }
  console.log(`\n▸ Arranque con red colgada (fetch que nunca responde) — servidor en ${base}`);

  const dom = createDom(base);
  const window = dom.window;
  const document = window.document;
  const t0 = Date.now();

  // Debe resolverse solo: en ~9 s + margen la app tiene que estar operativa
  const DEADLINE = 20000;
  while (Date.now() - t0 < DEADLINE && !(window.App && window.App.candles.length)) await wait(250);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  ok(!!window.App, 'la aplicación se inicializa');
  ok(window.App && window.App.candles.length > 0, `hay datos cargados pese a la red colgada (${elapsed} s)`);
  ok(/DEMO/i.test(window.App ? window.App.source : ''), `los datos son de modo DEMO (${window.App && window.App.source})`);
  ok(Number(elapsed) < 15, `el arranque no se queda colgado (${elapsed} s < 15 s)`);

  // El spinner debe haberse ocultado
  ok(document.getElementById('loader').classList.contains('hidden'), 'el indicador de carga se oculta');

  // La app sigue siendo usable: replay, indicadores, órdenes
  const { App, BR, TE, CM } = window;
  ok(BR.total() > 2000, `el replay tiene velas (${BR.total()})`);
  const i0 = BR.getIndex();
  App.stepForward();
  ok(BR.getIndex() === i0 + 1, 'se puede avanzar el replay');
  ok(CM.series.candles.data().length === BR.getIndex() + 1, 'el gráfico dibuja solo las velas reveladas');

  document.getElementById('sizeInput').value = '50';
  App.placeOrder('long');
  ok(!!TE.state.position, 'se puede abrir una posición');
  App.flatten();
  ok(!TE.state.position, 'se puede cerrar la posición');

  // Guardar sesión no debe romper con localStorage bloqueado
  const key = App.saveSession('prueba sin almacenamiento');
  ok(key === null || typeof key === 'string', 'guardar sesión no lanza excepciones con localStorage bloqueado');

  // Mensajes al usuario
  const toasts = document.getElementById('toasts').textContent;
  ok(/DEMO|red/i.test(toasts) || /DEMO|red/i.test(document.getElementById('logList').textContent),
     'se avisa al usuario de que se ha arrancado en modo DEMO');

  const realErrors = consoleErrors.filter((e) => !/ResizeObserver|not implemented/i.test(e));
  if (realErrors.length) realErrors.slice(0, 6).forEach((e) => console.log('  ! ' + e));
  ok(realErrors.length === 0, `sin errores de JavaScript (${realErrors.length})`);

  console.log('\n' + '─'.repeat(60));
  console.log(`Pruebas de arranque: ${passed} superadas, ${failed} fallidas`);
  console.log(failed ? '❌ El arranque no es robusto.' : '✅ El arranque es robusto ante redes bloqueadas.');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('Error inesperado:', e.stack);
  process.exit(1);
});
