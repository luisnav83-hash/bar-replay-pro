/* =========================================================================
 * tests/iframe.test.js — Prueba en IFRAME SANDBOXEADO (el entorno exacto del
 * visor del workspace): sandbox="allow-scripts" + red bloqueada.
 *
 *  Verifica que la app embebida:
 *    · arranca sin red (velas reales guardadas) y renderiza el gráfico
 *    · responde a teclado y ratón reales (avanzar, operar, dibujar)
 *    · no lanza excepciones cuando localStorage y las descargas están bloqueados
 *    · permite captura de pantalla (canvas.toDataURL) sin contaminar el canvas
 *
 *  Requiere:  npm install puppeteer && node server.js  (para servir el harness)
 *  Ejecutar:  node tests/iframe.test.js
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
let BASE = process.env.BASE_URL || null;
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  BASE = BASE || await detectBase();
  if (!BASE) {
    console.log('⚠️  No hay servidor escuchando (arranca `node server.js`): prueba OMITIDA.');
    process.exit(0);
  }
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1480, height: 860, deviceScaleFactor: 1 });

  const errors = [];

  // Bloquea TODO salvo los documentos: el iframe sandboxeado se queda sin red,
  // exactamente como en el visor del workspace.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.resourceType() === 'document') return req.continue();
    return req.abort('failed');
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(m.text())) {
      errors.push('console: ' + m.text());
    }
  });

  console.log(`\n▸ Abriendo el harness con la app en un iframe sandbox="allow-scripts" (${BASE})`);
  await page.goto(`${BASE}/tests/harness-embed.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Localiza el frame de la aplicación (origen opaco: se accede por CDP)
  let frame = null;
  for (let i = 0; i < 60 && !frame; i++) {
    frame = page.frames().find((f) => f !== page.mainFrame() && /unico\.html/.test(f.url()));
    if (!frame) await wait(250);
  }
  ok(!!frame, 'el iframe con la aplicación existe');
  if (!frame) { await browser.close(); process.exit(1); }

  const sandboxAttr = await page.evaluate(() => document.getElementById('app').getAttribute('sandbox'));
  ok(sandboxAttr === 'allow-scripts', `el iframe usa el mismo sandbox que el visor (${sandboxAttr})`);

  /* ------------------------- Arranque dentro del iframe ------------------------- */
  console.log('\n▸ Arranque dentro del iframe (sin red)');
  const t0 = Date.now();
  await frame.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  const bootS = ((Date.now() - t0) / 1000).toFixed(1);

  const st = await frame.evaluate(() => {
    const wrap = document.getElementById('chartWrap').getBoundingClientRect();
    const canvas = document.querySelector('#mainChart canvas');
    return {
      source: App.source, candles: App.candles.length, cursor: BR.getIndex(),
      hidden: BR.hiddenCount(), drawn: CM.series.candles.data().length,
      chartW: Math.round(wrap.width), chartH: Math.round(wrap.height),
      canvasH: canvas ? canvas.height : 0,
      storageBlocked: (() => { try { localStorage.getItem('x'); return false; } catch (e) { return true; } })(),
      legend: document.getElementById('lgPair').textContent + ' ' + document.getElementById('lgSource').textContent,
    };
  });
  console.log('  ', JSON.stringify(st));

  ok(/Binance|DEMO/i.test(st.source), `arranca sin red con datos utilizables (${st.source})`);
  ok(Number(bootS) < 15, `arranca rápido dentro del iframe (${bootS} s)`);
  ok(st.candles >= 2000, `hay velas cargadas (${st.candles})`);
  ok(st.drawn === st.cursor + 1, `solo se dibujan las velas reveladas (${st.drawn} = ${st.cursor} + 1)`);
  ok(st.chartW > 500 && st.chartH > 240, `el gráfico se renderiza dentro del iframe (${st.chartW}x${st.chartH})`);
  ok(st.canvasH >= 240, `el canvas tiene altura real (${st.canvasH}px)`);
  ok(st.storageBlocked, 'el localStorage está realmente bloqueado en este iframe (igual que en el visor)');
  ok(/Binance|DEMO/i.test(st.legend), `la leyenda indica la fuente de datos (${st.legend.trim()})`);

  /* ---------------------- Interacción real: ratón y teclado ---------------------- */
  console.log('\n▸ Interacción con ratón y teclado dentro del iframe');
  await page.mouse.click(700, 420);        // clic dentro del iframe → le da el foco
  await wait(200);

  const before = await frame.evaluate(() => BR.getIndex());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await wait(250);
  const afterKeys = await frame.evaluate(() => BR.getIndex());
  ok(afterKeys === before + 2, `las flechas avanzan velas dentro del iframe (${before} → ${afterKeys})`);

  await page.keyboard.press('b');          // abrir LONG
  await wait(400);
  const pos = await frame.evaluate(() => ({
    side: TE.state.position && TE.state.position.side,
    lines: CM._priceLines.length,
    tag: document.getElementById('posSide').textContent,
  }));
  ok(pos.side === 'long', 'la tecla B abre una posición LONG dentro del iframe');
  ok(pos.lines >= 1, 'las líneas de entrada/SL/TP se dibujan');

  for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowRight'); await wait(80); }
  await page.keyboard.press('Escape');     // cerrar posición
  await wait(400);
  const closed = await frame.evaluate(() => ({
    open: !!TE.state.position,
    trades: TE.state.trades.filter((t) => t.status === 'closed').length,
    rows: document.querySelectorAll('#tradesBody tr').length,
  }));
  ok(!closed.open, 'la tecla Escape cierra la posición');
  ok(closed.trades >= 1, `el trade queda registrado (${closed.trades})`);

  /* ------------------------- Dibujar con el ratón ------------------------- */
  await frame.evaluate(() => DT.setTool('hline'));
  await wait(150);
  const box = await frame.evaluate(() => {
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.6);
  await wait(300);
  const drawings = await frame.evaluate(() => DT.drawings.length);
  ok(drawings === 1, 'se puede dibujar con el ratón dentro del iframe');

  /* ------------------- Persistencia y captura degradan bien ------------------- */
  console.log('\n▸ Funciones que el sandbox bloquea (deben degradar sin romper)');
  const sessionKey = await frame.evaluate(() => {
    try { return App.saveSession('prueba iframe'); }
    catch (e) { return 'EXCEPCIÓN: ' + e.message; }
  });
  ok(sessionKey === null, 'guardar sesión devuelve null sin lanzar excepción (no hay localStorage)');
  const toastTxt = await frame.evaluate(() => document.getElementById('toasts').textContent);
  ok(/visor|almacenamiento/i.test(toastTxt), 'se avisa al usuario de que el visor no permite guardar');

  const shot = await frame.evaluate(() => {
    try {
      const cv = UI.composeScreenshot();
      const url = cv.toDataURL('image/png');
      return { ok: url.startsWith('data:image/png'), len: url.length };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  ok(shot.ok && shot.len > 1000, `la captura de pantalla se genera (${(shot.len / 1024).toFixed(0)} KB de data URI)`);

  const exportRes = await frame.evaluate(() => {
    try { App.exportTrades(); return 'sin excepción'; }
    catch (e) { return 'EXCEPCIÓN: ' + e.message; }
  });
  ok(exportRes === 'sin excepción', 'exportar CSV no rompe aunque la descarga esté bloqueada');

  const statsOk = await frame.evaluate(() => {
    const t = TE.state.trades.filter((x) => x.status === 'closed').length;
    return { panel: document.getElementById('stTrades').textContent, tabla: document.querySelectorAll('#tradesBody tr').length, t };
  });
  ok(Number(statsOk.panel) === statsOk.t && statsOk.tabla === statsOk.t,
     `las estadísticas cuadran dentro del iframe (${statsOk.panel} trades)`);

  /* ------------------------------ Errores ------------------------------ */
  console.log('\n▸ Errores');
  if (errors.length) errors.slice(0, 8).forEach((e) => console.log('  ! ' + e));
  ok(errors.length === 0, `sin excepciones de JavaScript en el iframe (${errors.length})`);

  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-08-visor-embebido.png') });
  console.log('  📸 docs/captura-08-visor-embebido.png');
  await browser.close();

  console.log('\n' + '─'.repeat(60));
  console.log(`Pruebas en iframe sandboxeado: ${passed} superadas, ${failed} fallidas`);
  console.log(failed ? '❌ Hay problemas al ejecutar la app embebida.' : '✅ La app es totalmente usable dentro del visor (iframe sandboxeado).');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Error inesperado:', e.message); process.exit(1); });
