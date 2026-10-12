/* Regresión: la etiqueta de la herramienta «medir» salía «NaN velas» porque leía precio y tiempo de los
   píxeles, no de los puntos del dibujo. Contra el BUILD: `node tools/build-single.js` antes. */
const path = require('path');
const puppeteer = require(process.env.PPTR_PATH || 'puppeteer');
const FILE = 'file://' + path.resolve(__dirname, '..', 'bar-replay-pro-unico.html');
const ESP = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(FILE, { waitUntil: 'load' });
  await ESP(3000);
  console.log('Herramienta medir: etiqueta con valores reales');
  const textos = await p.evaluate(() => {
    BR.goToEnd(); const cs = App.candles, n = BR.state.index;
    CM.main.timeScale().setVisibleLogicalRange({ from: n - 110, to: n + 6 });
    DT.drawings = [];
    DT._addDrawing({ type: 'measure', style: { color: '#00e5ff', width: 2, style: 'solid' }, points: [
      { dtime: cs[n - 80].time, price: cs[n - 80].high }, { dtime: cs[n - 70].time, price: cs[n - 70].low }] });
    const out = []; const orig = DT._label;
    DT._label = function (ctx, t) { out.push(t); return orig.apply(this, arguments); };
    DT.render(); DT._label = orig;
    return out;
  });
  const medir = textos.find((t) => /velas/.test(t)) || '';
  ok(medir !== '', 'la medición dibuja su etiqueta con «velas»');
  ok(!/NaN|undefined/.test(medir), `la etiqueta no contiene NaN ni undefined («${medir}»)`);
  ok(/10 velas/.test(medir), 'el número de velas sale de los puntos (10 velas)');
  console.log(`\nHerramienta medir: ${pass} superadas, ${fail} fallidas`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('💥', e); process.exit(1); });
