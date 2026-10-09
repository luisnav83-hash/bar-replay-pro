/* =========================================================================
 * tests/preview-live.test.js — Prueba del PREVIEW EN VIVO dentro de la sandbox.
 *
 *  Escenario exacto de la vista previa de la plataforma:
 *    · La app se sirve por HTTP desde este backend.
 *    · Se embebe en un iframe con sandbox="allow-scripts" (origen opaco).
 *    · Internet EXTERNO bloqueado (no se alcanza Binance directamente).
 *    · Se permiten solo las peticiones al mismo origen: el proxy /api/v3/klines
 *      del propio servidor, que es lo que hace la plataforma.
 *
 *  Lo que se verifica: que dentro de la sandbox la app carga DATOS REALES de
 *  Binance (no DEMO) a través del proxy, y que todo funciona igualmente.
 *
 *  Requiere:  node server.js  (el puerto se detecta solo o con BASE_URL)
 *  Ejecutar:  node tests/preview-live.test.js
 * =======================================================================*/
'use strict';

const path = require('path');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/node_modules/puppeteer',
                  '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) {
  console.log('⚠️  puppeteer no instalado: prueba OMITIDA.');
  process.exit(0);
}

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Detecta en qué puerto está escuchando el servidor. */
async function detectBase() {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  for (const port of [3000, 8080, 8000, 5000, 5173]) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return `http://127.0.0.1:${port}`;
    } catch (e) {}
  }
  return null;
}

(async () => {
  const BASE = await detectBase();
  if (!BASE) {
    console.log('⚠️  No hay servidor escuchando (arranca `node server.js`): prueba OMITIDA.');
    process.exit(0);
  }
  console.log(`\n▸ Preview en vivo dentro de la sandbox — servidor en ${BASE}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 880, deviceScaleFactor: 1 });

  const errors = [];
  const blocked = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(t)) errors.push('console: ' + t);
  });

  // Solo puede salir a internet lo que va al MISMO ORIGEN (como el preview real)
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
    if (u.startsWith(BASE) || u.startsWith('file://')) return req.continue();   // mismo origen (proxy incluido)
    if (req.resourceType() === 'document') return req.continue();               // el documento del harness
    blocked.push(u.slice(0, 70));
    return req.abort('failed');                                                 // internet externo: bloqueado
  });

  await page.goto(`${BASE}/tests/harness-live.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Localiza el iframe de la app
  let frame = null;
  for (let i = 0; i < 60 && !frame; i++) {
    frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(BASE));
    if (!frame) await wait(250);
  }
  ok(!!frame, 'la app se carga dentro del iframe de la sandbox');
  if (!frame) { await browser.close(); process.exit(1); }

  /* --------------------------- Arranque con datos reales --------------------------- */
  const t0 = Date.now();
  await frame.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 45000 });
  const bootS = ((Date.now() - t0) / 1000).toFixed(1);

  const st = await frame.evaluate(() => {
    const wrap = document.getElementById('chartWrap').getBoundingClientRect();
    const canvas = document.querySelector('#mainChart canvas');
    return {
      source: App.source,
      candles: App.candles.length,
      cursor: BR.getIndex(),
      hidden: BR.hiddenCount(),
      drawn: CM.series.candles.data().length,
      chartH: Math.round(wrap.height),
      canvasH: canvas ? canvas.height : 0,
      lastClose: App.candles[App.candles.length - 1].close,
      lastTime: App.candles[App.candles.length - 1].time,
      firstTime: App.candles[0].time,
      legend: document.getElementById('lgPair').textContent + ' ' + document.getElementById('lgSource').textContent,
      storageBlocked: (() => { try { localStorage.getItem('x'); return false; } catch (e) { return true; } })(),
    };
  });

  console.log('  ', JSON.stringify({
    fuente: st.source, velas: st.candles, precio: st.lastClose,
    rango: new Date(st.firstTime * 1000).toISOString().slice(0, 16) + ' → ' + new Date(st.lastTime * 1000).toISOString().slice(0, 16),
    chart: st.chartH + 'px', leyenda: st.legend.trim(),
  }));

  ok(Number(bootS) < 15, `arranca rápido dentro de la sandbox (${bootS} s)`);
  ok(/Binance/i.test(st.source), `¡DATOS REALES dentro de la sandbox! (fuente: ${st.source})`);
  ok(st.candles > 500, `velas reales cargadas por el proxy del mismo origen (${st.candles})`);
  ok(st.lastClose > 1000, `precio real de BTC recibido (${st.lastClose} USDT)`);
  ok(st.drawn === st.cursor + 1, `el futuro sigue oculto (${st.drawn} velas dibujadas = cursor ${st.cursor} + 1)`);
  ok(st.chartH > 240 && st.canvasH >= 240, `el gráfico se renderiza dentro del iframe (${st.chartH}px)`);
  ok(/Binance/i.test(st.legend), `la leyenda confirma la fuente real (${st.legend.trim()})`);
  ok(blocked.length === 0,
     blocked.length === 0
       ? 'la app NO necesita internet externo: todo pasa por el proxy del mismo origen'
       : `hubo ${blocked.length} intentos externos (bloqueados), pero el proxy resolvió la carga`);

  /* ----------------------------- Uso normal dentro ----------------------------- */
  console.log('\n▸ Uso normal dentro de la sandbox');
  await page.mouse.click(700, 430);
  await wait(200);

  const before = await frame.evaluate(() => BR.getIndex());
  await page.keyboard.press('ArrowRight');
  await wait(200);
  ok(await frame.evaluate(() => BR.getIndex()) === before + 1, 'las flechas avanzan el replay');

  await page.keyboard.press('b');
  await wait(400);
  const pos = await frame.evaluate(() => ({ side: TE.state.position && TE.state.position.side, lines: CM._priceLines.length }));
  ok(pos.side === 'long' && pos.lines >= 1, 'se abre un LONG con su línea de entrada/SL/TP');

  await frame.evaluate(() => { document.getElementById('sizeInput').value = '50'; });
  await page.keyboard.press('Escape');
  await wait(300);
  ok(await frame.evaluate(() => !TE.state.position), 'Escape cierra la posición');

  const trades = await frame.evaluate(() => ({
    n: TE.state.trades.filter((t) => t.status === 'closed').length,
    rows: document.querySelectorAll('#tradesBody tr').length,
    bal: document.getElementById('acBalance').textContent,
  }));
  ok(trades.n >= 1 && trades.rows === trades.n, `el trade queda en el historial (${trades.rows}) · balance ${trades.bal}`);

  // Indicadores y paneles dentro de la sandbox
  await frame.evaluate(() => App.applyIndicators(Object.assign({}, App.indicators, {
    macd: { on: true, f: 12, s: 26, sig: 9, color: '#40c4ff', signalColor: '#ffab40' },
    atr: { on: true, p: 14, color: '#ffab40' },
  })));
  await wait(700);
  const panes = await frame.evaluate(() => ({
    macd: !document.getElementById('paneMacd').classList.contains('hidden'),
    atr: !document.getElementById('paneAtr').classList.contains('hidden'),
    macdPts: CM.paneSeries.macdLine.data().length,
    drawn: CM.series.candles.data().length,
    cursor: BR.getIndex(),
  }));
  ok(panes.macd && panes.atr && panes.macdPts > 0, `paneles MACD/ATR con datos dentro de la sandbox (${panes.macdPts} puntos)`);
  ok(panes.drawn === panes.cursor + 1, 'el gráfico sigue completo tras cambiar indicadores');

  /* --------------------------- Exportaciones y captura --------------------------- */
  const shot = await frame.evaluate(() => {
    try { return UI.composeScreenshot().toDataURL('image/png').length; } catch (e) { return -1; }
  });
  ok(shot > 1000, `la captura de pantalla funciona dentro de la sandbox (${(shot / 1024).toFixed(0)} KB)`);

  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-09-preview-sandbox.png') });
  console.log('  📸 docs/captura-09-preview-sandbox.png');

  console.log('\n▸ Errores');
  if (errors.length) errors.slice(0, 8).forEach((e) => console.log('  ! ' + e));
  ok(errors.length === 0, `sin excepciones de JavaScript (${errors.length})`);

  await browser.close();
  console.log('\n' + '─'.repeat(60));
  console.log(`Preview en vivo: ${passed} superadas, ${failed} fallidas`);
  console.log(failed ? '❌ Problemas en la sandbox.' : '✅ La app funciona EN LA SANDBOX con datos reales de Binance.');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Error inesperado:', e.message); process.exit(1); });
