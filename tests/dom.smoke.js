/* =========================================================================
 * tests/dom.smoke.js — Prueba de humo en un DOM simulado (jsdom).
 *
 *  Carga index.html con todos los scripts, simula el flujo completo (carga de
 *  datos en modo demo, avance del replay, apertura y cierre de posiciones,
 *  dibujos, indicadores, guardado de sesión) y verifica que no haya errores.
 *
 *  Requiere jsdom:   npm install jsdom      (o ruta externa con JSDOM_PATH)
 *  Ejecutar:         node tests/dom.smoke.js
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
const candidates = [
  'jsdom',
  process.env.JSDOM_PATH,
  '/home/user/br-test/node_modules/jsdom',
].filter(Boolean);
for (const c of candidates) {
  try { ({ JSDOM } = require(c)); break; } catch (e) {}
}
if (!JSDOM) {
  console.log('⚠️  jsdom no está instalado: se omite la prueba de DOM.');
  console.log('   Instálalo con:  npm install jsdom');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const errors = [];
const logs = [];

/* --------------------------- Stubs de navegador --------------------------- */

function fakeContext(canvas) {
  const noop = () => {};
  const store = { canvas };
  return new Proxy(store, {
    get(t, prop) {
      if (prop in t) return t[prop];
      switch (prop) {
        case 'measureText': return (s) => ({ width: String(s).length * 6 });
        case 'createLinearGradient':
        case 'createRadialGradient':
        case 'createPattern': return () => ({ addColorStop: noop });
        case 'getImageData': return (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * Math.max(1, w * h)), width: w, height: h });
        case 'save': case 'restore': case 'beginPath': case 'closePath':
        case 'moveTo': case 'lineTo': case 'rect': case 'arc': case 'fill': case 'stroke':
        case 'fillRect': case 'strokeRect': case 'clearRect': case 'fillText': case 'strokeText':
        case 'setLineDash': case 'translate': case 'scale': case 'rotate': case 'setTransform':
        case 'clip': case 'putImageData': case 'drawImage': case 'roundRect': return noop;
        default: return noop;
      }
    },
    set(t, prop, value) { t[prop] = value; return true; },
  });
}

const dom = new JSDOM(html, {
  url: `file://${ROOT}/index.html`,
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  beforeParse(window) {
    // Tamaños: jsdom no calcula layout, así que damos dimensiones plausibles
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 900; }, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return 420; }, configurable: true });
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      return { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 420, width: 900, height: 420 };
    };
    window.HTMLCanvasElement.prototype.getContext = function () { return fakeContext(this); };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAA';
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    // localStorage en memoria (con origen file:// jsdom no permite el real)
    const store = new Map();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: (i) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
      },
    });
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    window.URL.createObjectURL = () => 'blob:stub';
    window.URL.revokeObjectURL = () => {};
    window.scrollTo = () => {};
    // Sin red: la app debe caer al modo DEMO automáticamente
    window.fetch = () => Promise.reject(new Error('fetch deshabilitado en la prueba'));
    window.confirm = () => true;
    window.open = () => null;
    window.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.message || e.error)));
    const origError = window.console.error;
    window.console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); };
    window.console.warn = () => {};
    window.console.log = (...a) => logs.push(a.join(' '));
  },
});

const { window } = dom;
const document = window.document;   // jsdom: el DOM vive en la ventana simulada

/* ------------------------------- Utilidades ------------------------------- */
let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) passed++; else { failed++; fails.push(msg); console.error('  ✗ ' + msg); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Esperar a que carguen los scripts y se ejecute App.init()
  for (let i = 0; i < 60 && !window.App; i++) await wait(50);
  ok(!!window.App, 'la aplicación se inicializa (window.App existe)');
  if (!window.App) return finish();

  const { App, BR, CM, TE, DT, U, IND, STATS } = window;

  /* --- Fallback sin red → datos demo automáticos --- */
  for (let i = 0; i < 60 && !App.candles.length; i++) await wait(50);
  ok(App.candles.length > 0, 'sin conexión, se cargan datos DEMO automáticamente');

  console.log('\n▸ Estado inicial');
  ok(BR.total() === App.candles.length, 'el replay conoce todas las velas cargadas');
  ok(BR.getIndex() >= 0 && BR.getIndex() < BR.total(), 'el cursor del replay está dentro del histórico');
  ok(BR.hiddenCount() > 0, 'hay velas futuras ocultas (' + BR.hiddenCount() + ')');
  ok(!!CM.main, 'el gráfico principal está creado');
  ok(!!CM.series.candles, 'la serie de velas está creada');
  const dataAtCursor = CM.series.candles.data().length;
  ok(dataAtCursor === BR.getIndex() + 1, `solo se dibujan las velas reveladas (${dataAtCursor} = ${BR.getIndex() + 1})`);

  /* --- Indicadores --- */
  // A partir de aquí usamos datos sintéticos con semilla fija → prueba determinista
  const sim = window.DS.synth({ n: 900, interval: App.interval, startPrice: 30000, seed: 2024, startTs: 1700000000 });
  App.useCandles(sim, { startIndex: 200, source: 'test determinista' });
  ok(App.candles.length === 900 && BR.getIndex() === 200, 'se pueden cargar velas externas (useCandles) y fijar el cursor');

  console.log('\n▸ Indicadores');
  ok(!!CM.indData.sma && !!CM.indData.ema && !!CM.indData.rsi, 'SMA, EMA y RSI calculados');
  App.applyIndicators(Object.assign({}, App.indicators, {
    macd: { on: true, f: 12, s: 26, sig: 9, color: '#40c4ff', signalColor: '#ffab40' },
    atr: { on: true, p: 14, color: '#ffab40' },
    bb: { on: true, p: 20, k: 2, color: '#7c4dff' },
  }));
  ok(!!CM.indData.macd && !!CM.indData.atr && !!CM.indData.bb, 'MACD, ATR y Bollinger calculados');
  ok(!document.getElementById('paneRsi').classList.contains('hidden'), 'el panel del RSI se muestra');

  /* --- Replay: paso a paso y retroceso --- */
  console.log('\n▸ Bar Replay');
  const idx0 = BR.getIndex();
  App.stepForward();
  ok(BR.getIndex() === idx0 + 1, 'el botón avanzar revela una vela');
  ok(CM.series.candles.data().length === idx0 + 2, 'el gráfico dibuja exactamente una vela más');
  App.stepBack();
  ok(BR.getIndex() === idx0, 'el botón retroceder vuelve una vela atrás');
  App.setSpeed(50);
  ok(BR.state.speed === 50, 'la velocidad se configura a 50x');
  App.resetReplay();
  ok(BR.getIndex() === BR.getStartIndex(), 'el reset vuelve al inicio del replay');

  /* --- Trading: apertura, SL/TP y cierre --- */
  console.log('\n▸ Trading simulado');
  const price = App.currentPrice();
  document.getElementById('sizeInput').value = '50';
  // SL muy cercano (0,3%) y TP lejano (5%): garantiza que salte el stop en pocas velas
  document.getElementById('slInput').value = String(price * 0.997);
  document.getElementById('tpInput').value = String(price * 1.05);
  App.placeOrder('long');
  ok(!!TE.state.position, 'se abre una posición LONG con los datos del formulario');
  ok(TE.state.position && TE.state.position.qty > 0, 'la cantidad calculada es positiva');
  ok(CM._priceLines.length >= 3, 'se dibujan líneas de entrada, SL y TP en el gráfico');

  for (let i = 0; i < 300 && TE.state.position; i++) App.stepForward();
  let closed = TE.state.trades.filter((t) => t.status === 'closed');
  ok(closed.length >= 1, 'la posición se cierra al alcanzar SL/TP durante el replay');
  if (closed.length) {
    ok(closed[0].exitPrice > 0 && Number.isFinite(closed[0].pnl), 'el trade cerrado tiene precio de salida y PnL');
    ok(['sl', 'tp', 'liq'].includes(closed[0].reason), 'el motivo de cierre es SL, TP o liquidación (' + closed[0].reason + ')');
    ok(TE.state.balance === TE.state.initialCapital + closed.reduce((a, t) => a + t.pnl, 0), 'el balance cuadra con la suma de PnL');
    ok(document.querySelectorAll('#tradesBody tr').length === closed.length, 'el historial de la tabla muestra los trades cerrados');
  }
  ok(!TE.state.position, 'la posición queda cerrada tras el replay');

  // Cierre manual de una nueva posición (sin SL/TP para que no se cierre solo)
  document.getElementById('slInput').value = '';
  document.getElementById('tpInput').value = '';
  App.placeOrder('short');
  ok(TE.state.position && TE.state.position.side === 'short', 'se abre una posición SHORT');
  App.stepForward();
  App.flatten();
  ok(!TE.state.position, 'el cierre manual deja la posición en FLAT');
  ok(TE.state.trades.some((t) => t.reason === 'manual'), 'el trade manual queda registrado');

  // Modificación de SL/TP tras abrir (equivalente al arrastre en el gráfico)
  App.placeOrder('long');
  const entry = TE.state.position.entryPrice;
  window.TE.setSL(entry * 0.98);
  window.TE.setTP(entry * 1.02);
  const pos = TE.state.position;
  ok(Math.abs(pos.sl - entry * 0.98) < 1e-6 && Math.abs(pos.tp - entry * 1.02) < 1e-6,
     'el SL y el TP se pueden modificar con la posición abierta');
  ok(Math.abs(TE.liquidationPrice(pos) - entry) < 1e-9 || pos.leverage === 1, 'con 1x no hay riesgo de liquidación');
  App.flatten();

  /* --- Retroceso con reconstrucción de estado --- */
  console.log('\n▸ Retroceso de estado (checkpoints)');
  const idxBefore = BR.getIndex();
  const balanceBefore = TE.state.balance;
  const tradesBefore = TE.state.trades.length;
  for (let i = 0; i < 10; i++) App.stepForward();
  App.seekTo(idxBefore);
  ok(BR.getIndex() === idxBefore, 'seek hacia atrás sitúa el cursor donde estaba');
  ok(TE.state.trades.length === tradesBefore, 'el historial se recorta al retroceder');
  ok(Math.abs(TE.state.balance - balanceBefore) < 1e-6, 'el balance se restaura al estado del checkpoint');
  ok(CM.series.candles.data().length === idxBefore + 1, 'el gráfico vuelve a ocultar las velas futuras');

  /* --- Herramientas de dibujo --- */
  console.log('\n▸ Dibujos');
  DT.setTool('hline');
  DT.canvas.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 400, clientY: 200, button: 0, bubbles: true }));
  ok(DT.drawings.length === 1, 'se crea una línea horizontal con un clic');
  DT.setTool('trend');
  DT.canvas.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 200, clientY: 150, button: 0, bubbles: true }));
  DT.canvas.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 600, clientY: 300, button: 0, bubbles: true }));
  ok(DT.drawings.length === 2, 'se crea una línea de tendencia con dos clics');
  const ser = DT.serialize();
  ok(ser.length === 2 && ser[0].points[0].price > 0, 'los dibujos se serializan con coordenadas de datos');
  DT.clearAll(true);
  ok(DT.drawings.length === 0, 'se pueden borrar todos los dibujos');

  /* --- Estadísticas y sesiones --- */
  console.log('\n▸ Estadísticas, sesiones y exportaciones');
  const st = STATS.compute(TE.state.trades, TE.state.equitySeries, TE.state.initialCapital);
  const closedNow = TE.state.trades.filter((t) => t.status === 'closed').length;
  ok(st.total === closedNow, `las estadísticas cuentan todos los trades cerrados (${st.total} = ${closedNow})`);
  ok(st.winRate >= 0 && st.winRate <= 100, 'win rate en rango válido');
  ok(document.getElementById('stTrades').textContent === String(st.total), 'el panel muestra el nº de trades');
  const key = App.saveSession('Prueba automática');
  ok(!!key && window.ST.listSessions().length >= 1, 'la sesión se guarda en localStorage');
  const json = App.sessionJSON();
  ok(json.includes('"pair"') && JSON.parse(json).drawings !== undefined, 'la sesión se serializa a JSON');
  ok(typeof U.fmtMoney(1) === 'string', 'utilidades de formato operativas');
  ok(document.getElementById('toasts').childElementCount >= 0, 'el sistema de notificaciones no falla');

  /* --- Reproducción automática (bucle de animación) --- */
  console.log('\n▸ Reproducción automática');
  const idxPlay = BR.getIndex();
  BR.setSpeed('max');
  App.togglePlay();
  ok(BR.isPlaying(), 'PLAY activa la reproducción');
  await wait(300);
  App.togglePlay();
  ok(!BR.isPlaying(), 'PAUSA detiene la reproducción');
  ok(BR.getIndex() > idxPlay, 'durante el PLAY se revelaron velas nuevas (' + (BR.getIndex() - idxPlay) + ')');
  ok(document.getElementById('pbStatus').textContent === 'PAUSA', 'la barra de replay vuelve al estado PAUSA');
  ok(document.getElementById('pbIndex').textContent.includes('vela'), 'la barra de progreso muestra el contador de velas');

  finish();
})().catch((e) => { errors.push('Excepción en la prueba: ' + e.stack); finish(); });

function finish() {
  console.log('\n' + '─'.repeat(60));
  if (errors.length) {
    console.log('Errores capturados durante la ejecución:');
    errors.slice(0, 12).forEach((e) => console.log('  ! ' + e));
  }
  console.log(`Pruebas de DOM superadas: ${passed}   Fallidas: ${failed}`);
  if (failed) {
    console.log('\nFallos:');
    fails.forEach((f) => console.log('  · ' + f));
  }
  const bad = failed || errors.length;
  console.log(bad ? '❌ La prueba de DOM encontró problemas.' : '✅ Prueba de DOM correcta.');
  process.exit(bad ? 1 : 0);
}
