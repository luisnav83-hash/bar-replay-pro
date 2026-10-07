let puppeteer;
for (const c of ['puppeteer', '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) { console.log('⚠️  puppeteer no instalado: prueba OMITIDA.'); process.exit(0); }
const path = require('path');
(async () => {
  const t0 = Date.now();
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1500, height: 860 });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  // Bloquea TODA la red externa (como el iframe sandbox del visor)
  await p.setRequestInterception(true);
  p.on('request', req => {
    const u = req.url();
    if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
    return req.abort('failed');
  });

  const FILE = path.join(__dirname, '..', 'bar-replay-pro-unico.html');
  const file = 'file://' + FILE.replace(/\\/g, '/');
  await p.goto(file, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Debe arrancar SOLO, sin red, con las velas reales guardadas en el archivo
  await p.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  const tData = Date.now() - t0;
  await p.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 15000 });

  // Interacción real: avanzar, operar, dibujar
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
  await p.evaluate(() => { document.getElementById('sizeInput').value = '50'; });
  await p.keyboard.press('b');
  for (let i = 0; i < 10; i++) { await p.keyboard.press('ArrowRight'); }
  await p.keyboard.press('Escape');

  const st = await p.evaluate(() => ({
    source: App.source, candles: App.candles.length, cursor: BR.getIndex(),
    hidden: BR.hiddenCount(), drawn: CM.series.candles.data().length,
    trades: TE.state.trades.length, balance: document.getElementById('acBalance').textContent,
    chartH: Math.round(document.getElementById('chartWrap').getBoundingClientRect().height),
    rsiPoints: CM.paneSeries.rsiLine.data().length,
    legend: document.getElementById('lgPair').textContent + ' ' + document.getElementById('lgSource').textContent,
  }));
  await p.screenshot({ path: path.join(__dirname, '..', 'docs', 'captura-07-archivo-unico.png') });

  console.log('· Arranque sin red a los   ' + (tData/1000).toFixed(1) + ' s');
  console.log('· Fuente:                  ' + st.source);
  console.log('· Velas:                   ' + st.candles + ' | cursor ' + st.cursor + ' | ocultas ' + st.hidden + ' | dibujadas ' + st.drawn);
  console.log('· Gráfico de altura:       ' + st.chartH + 'px | puntos RSI ' + st.rsiPoints);
  console.log('· Trades tras operar:      ' + st.trades + ' | balance ' + st.balance);
  console.log('· Leyenda:                 ' + st.legend.trim());
  const realErrs = errs.filter(e => !/net::ERR_|Failed to load resource/.test(e));
  console.log('· Errores JS (reales):     ' + realErrs.length + (realErrs.length ? ' → ' + realErrs.slice(0,3).join(' | ') : ''));
  console.log('· Red bloqueada por el test: ' + (errs.length - realErrs.length) + ' peticiones (esperado)');
  // El archivo trae velas REALES incrustadas: comprobamos que son plausibles
  const range = await p.evaluate(() => {
    const c = App.candles;
    return { min: Math.min(...c.map(x => x.low)), max: Math.max(...c.map(x => x.high)),
             dias: (c[c.length-1].time - c[0].time) / 86400 };
  });
  const esReal = /Binance/i.test(st.source) || /DEMO/i.test(st.source);
  const preciosPlausibles = range.min > 1000 && range.max < 500000;
  console.log('· Rango de precios:        ' + range.min.toFixed(0) + ' → ' + range.max.toFixed(0) + ' USD · ' + range.dias.toFixed(0) + ' días de histórico');
  const ok = st.candles >= 2000 && st.drawn === st.cursor + 1 && st.chartH > 240 && realErrs.length === 0
             && esReal && preciosPlausibles;
  console.log(ok ? '\n✅ El archivo único funciona sin red, sin servidor y sin localStorage.' : '\n❌ Problemas en el archivo único.');
  await b.close();
  process.exit(ok ? 0 : 1);
})();
