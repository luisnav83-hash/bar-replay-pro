/* =========================================================================
 * tools/demo-video.js — Graba un vídeo (MP4) de la aplicación funcionando.
 *
 * Sirve para VER la app en cualquier visor, incluidos los que no ejecutan
 * JavaScript (la vista previa del móvil), donde el archivo HTML no puede
 * arrancar por sí solo.
 *
 * Cómo funciona: captura fotogramas con el protocolo de depuración de Chrome
 * (Page.startScreencast) mientras maneja la app de verdad —replay, indicadores,
 * abrir un LONG, PnL, cerrar y revisar el historial— y los une con ffmpeg.
 *
 * Uso:  node tools/demo-video.js
 * Salida: docs/demo-bar-replay.mp4
 * =======================================================================*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let puppeteer, FFMPEG;
for (const c of ['puppeteer', '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
for (const c of ['ffmpeg-static', '/home/user/.cache/vid/node_modules/ffmpeg-static']) {
  try { FFMPEG = require(c); break; } catch (e) {}
}
if (!puppeteer || !FFMPEG) {
  console.error('Faltan dependencias: puppeteer y/o ffmpeg-static.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'bar-replay-pro-unico.html').replace(/\\/g, '/');
const OUT = path.join(ROOT, 'docs', 'demo-bar-replay.mp4');
const DIR = path.join(os.tmpdir(), 'brp-frames');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ Captura ------------------------------ */
let client = null, frames = [], grabando = false;
async function iniciarCaptura(page) {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  client = await page.createCDPSession();
  client.on('Page.screencastFrame', (f) => {
    if (grabando) {
      frames.push(f.data);
      fs.writeFileSync(path.join(DIR, `f-${String(frames.length).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    }
    client.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 78, everyNthFrame: 1 });
  grabando = true;
}
async function pararCaptura() {
  grabando = false;
  try { await client.send('Page.stopScreencast'); } catch (e) {}
}

/* ------------------------------ Montaje ------------------------------ */
function montarVideo(segundos) {
  const fps = Math.max(6, Math.min(30, Math.round(frames.length / Math.max(1, segundos))));
  const entrada = path.join(DIR, 'f-%05d.jpg');
  console.log(`· ${frames.length} fotogramas en ${segundos.toFixed(1)} s → ${fps} fps`);
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-framerate', String(fps), '-i', entrada,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT,
  ]);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 750, deviceScaleFactor: 1 });

  // Sin red: exactamente como dentro de un visor. Usa las velas reales guardadas.
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    return (u.startsWith('file://') || u.startsWith('data:')) ? r.continue() : r.abort('failed');
  });

  console.log('· abriendo la app (sin red, con las velas reales guardadas)…');
  await page.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
  await page.waitForFunction("document.getElementById('loader').classList.contains('hidden')", { timeout: 15000 });
  await wait(700);

  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'demoCap';
    d.style.cssText = 'position:fixed;left:18px;bottom:16px;z-index:99999;background:rgba(10,13,28,.92);' +
      'border:1px solid rgba(0,229,255,.45);color:#eaf6ff;font:600 16px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'padding:11px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.55);max-width:72%';
    document.body.appendChild(d);
    window.__cap = (t) => { d.textContent = t; };
  });
  const cap = (t) => page.evaluate((x) => window.__cap(x), t);

  await iniciarCaptura(page);
  const t0 = Date.now();
  console.log('· grabando…');

  await cap('1 · Gráfico con datos reales de Binance (BTC/USDT · 1 h)');
  await wait(2600);

  await page.evaluate(() => BR.setSpeed(5));
  await cap('2 · PLAY a 5x · las velas se revelan de una en una');
  await page.keyboard.press('Space');
  await wait(4400);
  await page.keyboard.press('Space');
  await wait(500);

  await page.evaluate(() => { App.indicators.macd.on = true; App.applyIndicators(App.indicators, true); });
  await cap('3 · Indicadores: SMA, EMA, volumen, RSI y MACD');
  await wait(2800);

  await page.evaluate(() => { document.getElementById('sizeInput').value = '60'; });
  await page.keyboard.press('b');
  await cap('4 · LONG abierto (tecla B) · líneas de entrada, SL y TP');
  await wait(3000);

  await page.evaluate(() => BR.setSpeed(10));
  await cap('5 · Replay a 10x · PnL en vivo en el panel «Cuenta»');
  await page.keyboard.press('Space');
  await wait(6500);
  await page.keyboard.press('Space');
  await wait(400);

  await page.keyboard.press('Escape');
  await cap('6 · Cerrar con Esc · la operación pasa al historial');
  await wait(2000);

  await page.click('[data-tab="trades"]');
  await cap('7 · Historial: entrada, salida, PnL y % por operación');
  await wait(3400);

  await cap('8 · Y sin internet: las 4.000 velas reales van dentro del archivo');
  await wait(2800);

  const segundos = (Date.now() - t0) / 1000;
  await pararCaptura();
  await browser.close();

  montarVideo(segundos);
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`✅ Vídeo guardado: ${path.relative(ROOT, OUT)} (${kb} KB · ${segundos.toFixed(1)} s)`);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
