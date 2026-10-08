/* =========================================================================
 * tests/browser.capture.js — Verificación en NAVEGADOR REAL (Chromium headless)
 *
 *  Abre la aplicación servida por server.js, comprueba que se renderiza de
 *  verdad (gráfico con tamaño, velas reales de Binance, indicadores), simula
 *  la interacción del usuario (avanzar velas, abrir LONG, dibujar) y guarda
 *  capturas PNG en docs/.
 *
 *  Requiere puppeteer:  npm install puppeteer
 *  Ejecutar:            node tests/browser.capture.js [url]
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/node_modules/puppeteer',
                  '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) {
  console.log('⚠️  puppeteer no está instalado: se omite la verificación en navegador real.');
  process.exit(0);
}

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const OUT = path.join(__dirname, '..', 'docs');
fs.mkdirSync(OUT, { recursive: true });

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 });

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => consoleErrors.push(`petición fallida: ${r.url()} (${r.failure() && r.failure().errorText})`));

  console.log(`\n▸ Abriendo ${URL} en Chromium ${await browser.version()}`);
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });

  // Esperar a que la app tenga datos
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 90000 });
  await wait(1200);

  /* ------------------------- Estado tras la carga ------------------------- */
  const st = await page.evaluate(() => {
    const canvas = document.querySelector('#mainChart canvas');
    const wrap = document.getElementById('chartWrap').getBoundingClientRect();
    const closeBtn = document.getElementById('hiddenCount');
    return {
      source: App.source,
      pair: App.pair, interval: App.interval,
      candles: App.candles.length,
      firstTime: App.candles[0].time, lastTime: App.candles[App.candles.length - 1].time,
      lastClose: App.candles[App.candles.length - 1].close,
      cursor: BR.getIndex(),
      hidden: BR.hiddenCount(),
      drawn: CM.series.candles.data().length,
      indData: Object.keys(CM.indData),
      chartW: wrap.width, chartH: wrap.height,
      canvasW: canvas ? canvas.width : 0, canvasH: canvas ? canvas.height : 0,
      hiddenNotice: closeBtn ? closeBtn.textContent : '',
      legendPair: document.getElementById('lgPair').textContent,
      legendSrc: document.getElementById('lgSource').textContent,
      balance: document.getElementById('acBalance').textContent,
      equityPts: TE.state.equitySeries.length,
      hasChart: typeof LightweightCharts !== 'undefined',
    };
  });

  console.log('\n  Estado:', JSON.stringify({
    fuente: st.source, par: st.pair, tf: st.interval, velas: st.candles,
    cursor: st.cursor, ocultas: st.hidden, dibujadas: st.drawn,
    chart: `${Math.round(st.chartW)}x${Math.round(st.chartH)}`,
    canvas: `${st.canvasW}x${st.canvasH}`,
  }, null, 0));

  ok(st.hasChart, 'la librería Lightweight Charts está cargada');
  ok(st.chartW > 600 && st.chartH > 250, `el área del gráfico tiene tamaño real (${Math.round(st.chartW)}x${Math.round(st.chartH)})`);
  ok(st.canvasW > 600 && st.canvasH > 250, `el canvas del gráfico se renderiza (${st.canvasW}x${st.canvasH})`);
  ok(st.candles > 500, `se cargaron velas (${st.candles}) desde "${st.source}"`);
  ok(st.drawn === st.cursor + 1, `solo se dibujan las velas reveladas (${st.drawn} de ${st.candles}) → futuro oculto`);
  ok(st.hidden > 100, `hay velas futuras ocultas (${st.hidden})`);
  ok(/velas ocultas/.test(st.hiddenNotice), 'el aviso de velas ocultas es visible');
  ok(st.indData.length >= 3, `indicadores calculados: ${st.indData.join(', ')}`);
  ok(st.legendPair.includes('/'), `la leyenda muestra el par (${st.legendPair.trim()} ${st.legendSrc})`);
  ok(st.balance.includes('$'), `el balance se muestra (${st.balance})`);

  const s1 = path.join(OUT, 'captura-01-inicio.png');
  await page.screenshot({ path: s1 });
  console.log('  📸 ' + path.relative(path.join(__dirname, '..'), s1));

  /* --------------------- Interacción: dibujar y operar --------------------- */
  console.log('\n▸ Simulando la interacción del usuario');

  // 1) Dibujar una línea horizontal de soporte (tecla 4 + clic en el gráfico)
  await page.keyboard.press('4');
  const box = await page.evaluate(() => {
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w * 0.45, box.y + box.h * 0.72);
  await wait(200);
  // 2) Dibujar una línea de tendencia (tecla 2 + dos clics)
  await page.keyboard.press('2');
  await page.mouse.click(box.x + box.w * 0.25, box.y + box.h * 0.45);
  await page.mouse.click(box.x + box.w * 0.72, box.y + box.h * 0.25);
  await wait(200);
  const drawings = await page.evaluate(() => DT.drawings.length);
  ok(drawings === 2, `se crean dibujos con clics reales (${drawings})`);

  // 3) Retroceder y avanzar para comprobar el replay
  const before = await page.evaluate(() => BR.getIndex());
  await page.keyboard.press('ArrowRight');
  await wait(150);
  const afterFwd = await page.evaluate(() => BR.getIndex());
  await page.keyboard.press('ArrowLeft');
  await wait(150);
  const afterBack = await page.evaluate(() => BR.getIndex());
  ok(afterFwd === before + 1, 'la flecha → avanza una vela');
  ok(afterBack === before, 'la flecha ← retrocede una vela');

  // 4) Abrir una posición LONG con SL/TP y avanzar 12 velas
  await page.evaluate(() => {
    const p = App.currentPrice();
    document.getElementById('sizeInput').value = '60';
    document.getElementById('slInput').value = String(+(p * 0.97).toFixed(2));
    document.getElementById('tpInput').value = String(+(p * 1.06).toFixed(2));
  });
  await page.keyboard.press('b');
  await wait(350);
  const posInfo = await page.evaluate(() => ({
    side: TE.state.position && TE.state.position.side,
    qty: TE.state.position && TE.state.position.qty,
    lines: CM._priceLines.length,
    tag: document.getElementById('posSide').textContent,
    pnl: document.getElementById('posPnl').textContent,
  }));
  ok(posInfo.side === 'long', 'la tecla B abre una posición LONG');
  ok(posInfo.lines >= 3, `se dibujan entrada, SL y TP en el gráfico (${posInfo.lines} líneas)`);
  ok(posInfo.tag === 'LONG', 'el panel de posición muestra LONG');
  ok(posInfo.pnl.includes('$'), `el PnL no realizado se muestra (${posInfo.pnl.trim()})`);

  for (let i = 0; i < 12; i++) { await page.keyboard.press('ArrowRight'); await wait(60); }
  await wait(400);

  const s2 = path.join(OUT, 'captura-02-replay-operando.png');
  await page.screenshot({ path: s2 });
  console.log('  📸 ' + path.relative(path.join(__dirname, '..'), s2));

  /* ----------------------------- PLAY real ----------------------------- */
  console.log('\n▸ Reproducción automática (PLAY)');
  const idxPlay = await page.evaluate(() => BR.getIndex());
  await page.evaluate(() => { App.setSpeed(10); });
  await page.keyboard.press(' ');
  await wait(2200);
  const playing = await page.evaluate(() => BR.isPlaying());
  const idxAfterPlay = await page.evaluate(() => BR.getIndex());
  await page.keyboard.press(' ');
  await wait(200);
  ok(playing, 'el botón PLAY deja el replay en marcha');
  ok(idxAfterPlay > idxPlay, `el replay avanza solo: ${idxPlay} → ${idxAfterPlay} velas`);

  // ¿Se cerró la posición por SL/TP durante el replay?
  const tradesState = await page.evaluate(() => ({
    closed: TE.state.trades.filter((t) => t.status === 'closed').length,
    open: !!TE.state.position,
    balance: TE.state.balance,
    equity: TE.state.equity,
    rows: document.querySelectorAll('#tradesBody tr').length,
    statsTrades: document.getElementById('stTrades').textContent,
    eqPoints: TE.state.equitySeries.length,
  }));
  console.log('  Estado del trading:', JSON.stringify(tradesState));
  ok(tradesState.closed + (tradesState.open ? 1 : 0) >= 1, 'hay al menos un trade registrado');
  if (tradesState.closed) ok(tradesState.rows === tradesState.closed, `la tabla de historial muestra los ${tradesState.rows} trades cerrados`);
  ok(Number.isFinite(tradesState.balance) && Number.isFinite(tradesState.equity), 'balance y equity son números válidos');

  // Cerrar la posición que quede abierta para la captura final
  await page.keyboard.press('Escape');
  await wait(400);

  /* ------------------- Paneles de indicadores y modales ------------------- */
  console.log('\n▸ Paneles y modales');
  await page.evaluate(() => {
    App.applyIndicators(Object.assign({}, App.indicators, {
      macd: { on: true, f: 12, s: 26, sig: 9, color: '#40c4ff', signalColor: '#ffab40' },
      atr: { on: true, p: 14, color: '#ffab40' },
      bb: { on: true, p: 20, k: 2, color: '#7c4dff' },
    }));
  });

  await wait(600);
  const panes = await page.evaluate(() => {
    const vr = CM.main.timeScale().getVisibleLogicalRange();
    return {
      rsi: !document.getElementById('paneRsi').classList.contains('hidden'),
      macd: !document.getElementById('paneMacd').classList.contains('hidden'),
      atr: !document.getElementById('paneAtr').classList.contains('hidden'),
      rsiH: document.getElementById('paneRsi').getBoundingClientRect().height,
      macdCanvas: !!document.querySelector('#chartMacd canvas'),
      // Tras cambiar indicadores, el gráfico debe seguir mostrando EXACTAMENTE
      // las velas reveladas (regresión del bug de refresco al índice 0)
      drawn: CM.series.candles.data().length,
      cursor: BR.getIndex(),
      rsiLen: CM.paneSeries.rsiLine.data().length,
      macdLen: CM.paneSeries.macdLine.data().length,
      atrLen: CM.paneSeries.atrLine.data().length,
      inView: vr ? (vr.from <= CM._index && vr.to >= CM._index) : false,
      bbSeries: !!CM.series.bbU,
    };
  });
  ok(panes.rsi && panes.macd && panes.atr, 'los paneles RSI, MACD y ATR están visibles');
  ok(panes.rsiH > 60 && panes.macdCanvas, 'los paneles tienen altura y canvas propios');
  ok(panes.drawn === panes.cursor + 1,
     `tras cambiar indicadores el gráfico conserva las velas reveladas (${panes.drawn} = cursor ${panes.cursor} + 1)`);
  ok(panes.rsiLen > 0 && panes.macdLen > 0 && panes.atrLen > 0,
     `los paneles reciben datos (RSI ${panes.rsiLen}, MACD ${panes.macdLen}, ATR ${panes.atrLen} puntos)`);
  ok(panes.inView, 'la vela actual del replay sigue dentro de la vista tras el refresco');
  ok(panes.bbSeries, 'las series de Bollinger se crean al activarlo');

  const s3 = path.join(OUT, 'captura-03-indicadores.png');
  await page.screenshot({ path: s3 });
  console.log('  📸 ' + path.relative(path.join(__dirname, '..'), s3));

  // Desactivar todos los indicadores y volver a activarlos (ida y vuelta)
  await page.evaluate(() => {
    const off = JSON.parse(JSON.stringify(App.indicators));
    Object.keys(off).forEach((k) => { off[k].on = false; });
    App.applyIndicators(off);
  });
  await wait(400);
  const afterOff = await page.evaluate(() => ({ drawn: CM.series.candles.data().length, cursor: BR.getIndex() }));
  ok(afterOff.drawn === afterOff.cursor + 1, 'al desactivar los indicadores el gráfico mantiene las velas');
  await page.evaluate(() => {
    App.applyIndicators(Object.assign({}, App.indicators, {
      vol: { on: true, color: '#5c6bc0' }, sma: { on: true, p: 50, color: '#ffd54f' },
      ema: { on: true, p: 21, color: '#00e5ff' }, rsi: { on: true, p: 14, color: '#b388ff' },
    }));
  });
  await wait(400);
  const backOn = await page.evaluate(() => ({
    drawn: CM.series.candles.data().length, cursor: BR.getIndex(), smaLen: CM.series.sma.data().length,
  }));
  ok(backOn.drawn === backOn.cursor + 1, 'al reactivar indicadores el gráfico sigue completo');
  ok(backOn.smaLen > 0, `la SMA vuelve a tener datos (${backOn.smaLen} puntos)`);

  // Modal de indicadores y de ayuda
  await page.click('#btnIndicators');
  await wait(300);
  ok(await page.evaluate(() => document.getElementById('modalIndicators').classList.contains('open')), 'el modal de indicadores se abre');
  await page.keyboard.press('Escape');
  await wait(200);
  await page.click('#btnHelp');
  await wait(300);
  const helpOpen = await page.evaluate(() => document.getElementById('modalHelp').classList.contains('open'));
  ok(helpOpen, 'el modal de ayuda se abre');
  await page.screenshot({ path: path.join(OUT, 'captura-04-ayuda.png') });
  await page.keyboard.press('Escape');

  // Guardar sesión y exportaciones (sin descargar: solo se comprueba que no fallan)
  const sessionOk = await page.evaluate(() => {
    const k = App.saveSession('captura automática');
    return !!k && ST.listSessions().length > 0;
  });
  ok(sessionOk, 'la sesión se guarda en localStorage del navegador real');

  const csvOk = await page.evaluate(() => {
    const t = TE.state.trades.filter((x) => x.status === 'closed');
    return t.length ? STATS.tradesToCSV(t, App.pair, App.interval).split('\n').length > 1 : true;
  });
  ok(csvOk, 'la exportación a CSV de trades se genera');

  /* ---------------------- Captura final de estadísticas ---------------------- */
  await page.evaluate(() => {
    // Forzamos varios trades rápidos para que las estadísticas tengan contenido
    for (let i = 0; i < 6; i++) {
      const p = App.currentPrice();
      if (!p) break;
      TE.openPosition(i % 2 ? 'short' : 'long', {
        mode: 'pct', size: 40, entryPrice: p,
        sl: p * (i % 2 ? 1.01 : 0.99), tp: p * (i % 2 ? 0.985 : 1.015),
        leverage: 2, feePct: TE.state.feePct, time: App.currentTime(),
      });
      for (let k = 0; k < 8; k++) { App.stepForward(); }
      if (TE.state.position) App.flatten();
    }
    UI.refreshStats(true);
  });
  await wait(800);
  const finalStats = await page.evaluate(() => ({
    trades: document.getElementById('stTrades').textContent,
    winRate: document.getElementById('stWinRate').textContent,
    pf: document.getElementById('stPf').textContent,
    dd: document.getElementById('stDd').textContent,
    rows: document.querySelectorAll('#tradesBody tr').length,
  }));
  console.log('  Estadísticas:', JSON.stringify(finalStats));
  ok(Number(finalStats.trades) >= 2, `el panel de estadísticas cuenta los trades (${finalStats.trades})`);
  ok(finalStats.winRate.includes('%'), `se calcula el win rate (${finalStats.winRate})`);
  ok(finalStats.pf !== '—', `se calcula el profit factor (${finalStats.pf})`);
  ok(finalStats.rows === Number(finalStats.trades), 'la tabla de historial coincide con el contador');

  await page.click('.tab[data-tab="trades"]');
  await wait(300);
  const s4 = path.join(OUT, 'captura-05-estadisticas.png');
  await page.screenshot({ path: s4 });
  console.log('  📸 ' + path.relative(path.join(__dirname, '..'), s4));

  // Vista general (portada): indicadores en el gráfico, dibujo y estadísticas
  await page.evaluate(() => {
    CM.scrollToLast(150);
    UI.refreshAll();
  });
  await wait(700);
  const s0 = path.join(OUT, 'captura-00-portada.png');
  await page.screenshot({ path: s0 });
  console.log('  📸 ' + path.relative(path.join(__dirname, '..'), s0));

  /* ------------- Resistencia en ventanas pequeñas / preview embebido ------------- */
  console.log('\n▸ Ventana pequeña (vista previa embebida: 1280x700)');
  await page.setViewport({ width: 1280, height: 700, deviceScaleFactor: 1 });
  await wait(700);
  const small = await page.evaluate(() => {
    const wrap = document.getElementById('chartWrap').getBoundingClientRect();
    const canvas = document.querySelector('#mainChart canvas');
    return {
      w: wrap.width, h: wrap.height,
      canvasH: canvas ? canvas.height : 0,
      scrollable: document.body.scrollHeight > window.innerHeight + 4,
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      drawn: CM.series.candles.data().length, cursor: BR.getIndex(),
    };
  });
  console.log('  ', JSON.stringify(small));
  ok(small.h >= 240, `el gráfico conserva altura suficiente en ventana baja (${Math.round(small.h)}px)`);
  ok(small.canvasH >= 240, `el canvas se renderiza a tamaño real (${small.canvasH}px)`);
  ok(small.drawn === small.cursor + 1, 'sigue mostrando solo las velas reveladas');
  ok(small.overflowX === 0, `sin desbordamiento horizontal (${small.overflowX}px)`);
  const sSmall = path.join(OUT, 'captura-06-ventana-pequena.png');
  await page.screenshot({ path: sSmall });
  console.log('  📸 ' + path.relative(path.join(__dirname, '..'), sSmall));

  // Vista móvil / panel muy estrecho: el gráfico debe seguir siendo usable
  console.log('\n▸ Panel móvil (480x900)');
  await page.setViewport({ width: 480, height: 900, deviceScaleFactor: 1 });
  await wait(800);
  const mobile = await page.evaluate(() => {
    const wrap = document.getElementById('chartWrap').getBoundingClientRect();
    const play = document.getElementById('btnPlay').getBoundingClientRect();
    const buy = document.getElementById('btnLong').getBoundingClientRect();
    return {
      w: Math.round(wrap.width), h: Math.round(wrap.height),
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      playVisible: play.width > 0 && play.top < window.innerHeight,
      buyVisible: buy.width > 0,
      drawn: CM.series.candles.data().length, cursor: BR.getIndex(),
    };
  });
  console.log('  ', JSON.stringify(mobile));
  ok(mobile.h >= 200, `el gráfico conserva altura usable en móvil (${mobile.h}px)`);
  ok(mobile.overflowX === 0, `sin desbordamiento horizontal en móvil (${mobile.overflowX}px)`);
  ok(mobile.playVisible && mobile.buyVisible, 'los controles de replay y de compra son accesibles');
  ok(mobile.drawn === mobile.cursor + 1, 'sigue mostrando solo las velas reveladas');
  const sMobile = path.join(OUT, 'captura-10-movil.png');
  await page.screenshot({ path: sMobile });
  console.log('  📸 ' + path.relative(path.join(__dirname, '..'), sMobile));

  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 });
  await wait(400);

  /* ------------------------------- Errores ------------------------------- */
  console.log('\n▸ Errores de consola en el navegador real');
  const realErrors = consoleErrors.filter((e) => !/favicon|net::ERR_/.test(e));
  if (realErrors.length) realErrors.slice(0, 8).forEach((e) => console.log('  ! ' + e));
  ok(realErrors.length === 0, `sin errores de JavaScript (${realErrors.length})`);

  await browser.close();

  console.log('\n' + '─'.repeat(60));
  console.log(`Comprobaciones en navegador real: ${passed} superadas, ${failed} fallidas`);
  console.log(failed ? '❌ Hay problemas en el navegador real.' : '✅ La aplicación funciona correctamente en un navegador real (Chromium).');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('Error en la verificación:', e.message);
  process.exit(1);
});
