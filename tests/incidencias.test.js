/* =========================================================================
 * incidencias.test.js — La app NUNCA se queda muda ante un fallo:
 *   1) Si el entorno bloquea JavaScript → cartel de emergencia visible
 *   2) Si algo falla al arrancar → informe rojo con el error + diagnóstico
 *   3) El diagnóstico dice lo que importa (módulos, almacenamiento, canvas…)
 *   4) Incrustada con srcdoc (otra forma de embeber) también arranca
 *
 * Necesita el servidor:  node server.js
 * Uso:  node tests/incidencias.test.js      (o BASE_URL=http://host:puerto)
 * =======================================================================*/
'use strict';

const path = require('path');
const puppeteer = require((process.env.PPTR_PATH || '/home/user/.cache/pptr/node_modules/puppeteer'));

let pasan = 0, fallan = 0;
const ok = (cond, msg) => {
  if (cond) { pasan++; console.log('  ✓ ' + msg); }
  else { fallan++; console.log('  ✗ ' + msg); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Detecta el puerto del servidor de desarrollo. */
async function detectBase() {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  for (const port of [8080, 3000, 8000, 5000, 5173]) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1200) });
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
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  /* ─── 1) Scripts bloqueados: debe verse el cartel de emergencia ─── */
  console.log('\n▸ 1) Entorno que bloquea JavaScript (sandbox sin allow-scripts)');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 700 });
    await page.goto(`${BASE}/tests/harness-noscripts.html`, { waitUntil: 'load', timeout: 60000 });
    await wait(2500);
    const r = await page.evaluate(() => {
      const doc = document.getElementById('marco').contentDocument;
      const aviso = doc && doc.getElementById('brpNoJS');
      const caja = aviso ? aviso.getBoundingClientRect() : null;
      const texto = aviso ? aviso.textContent.replace(/\s+/g, ' ').trim() : '';
      return {
        existe: !!aviso, visible: !!(caja && caja.height > 100 && caja.width > 100),
        menciona: /no ejecuta JavaScript|necesita JavaScript/i.test(texto),
        explica: /doble clic|descarga el archivo|pestaña completa/i.test(texto),
      };
    });
    ok(r.existe && r.visible, 'aparece un cartel visible en lugar de una pantalla en blanco');
    ok(r.menciona, 'el cartel explica que el visor no ejecuta JavaScript');
    ok(r.explica, 'el cartel indica qué hacer (descargar y abrir en el navegador)');
    await page.close();
  }

  /* ─── 2) y 3) Informe de error + diagnóstico ─── */
  console.log('\n▸ 2) Informe de error con diagnóstico (lo que se ve si algo falla)');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 800 });
    await page.goto(`${BASE}/tests/harness-live.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // ⚠ La app vive DENTRO del iframe: hay que evaluar en su contexto, no en la página padre
    let frame = null;
    for (let i = 0; i < 50 && !frame; i++) {
      frame = page.frames().find((f) => f !== page.mainFrame()) || null;
      if (!frame) await wait(200);
    }
    await frame.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
    await frame.evaluate(() => {
      App.showFatal('Error al iniciar la aplicación', new Error('Fallo de prueba'));
    });
    await wait(300);
    const r = await frame.evaluate(() => {
      const box = document.getElementById('brpFatal');
      const filas = box ? [...box.querySelectorAll('tr')].map((t) => t.textContent) : [];
      return {
        visible: !!box && box.getBoundingClientRect().height > 60,
        titulo: box ? box.textContent.includes('Error al iniciar la aplicación') : false,
        detalle: box ? box.textContent.includes('Fallo de prueba') : false,
        campos: filas.length,
        modulos: filas.some((f) => /Módulos JS/.test(f) && /los 11 cargados/.test(f)),
        almacen: filas.some((f) => /Almacenamiento/.test(f)),
        canvas: filas.some((f) => /Canvas 2D/.test(f) && /sí/.test(f)),
        iframe: filas.some((f) => /Dentro de iframe/.test(f) && /sí/.test(f)),
        botonCopiar: !!document.getElementById('brpFatalCopy'),
        diag: (window.App.diagnostics && Object.keys(App.diagnostics()).length) || 0,
      };
    });
    ok(r.visible, 'el informe de error se muestra en pantalla');
    ok(r.titulo && r.detalle, 'incluye el título y el mensaje exacto del error');
    ok(r.campos >= 8, `el diagnóstico trae los datos del entorno (${r.campos} campos)`);
    ok(r.modulos, 'confirma que los 11 módulos JS están cargados');
    ok(r.almacen && r.canvas && r.iframe, 'informa de almacenamiento, canvas y si está dentro de un iframe');
    ok(r.botonCopiar, 'hay un botón «Copiar informe» para pegarlo en el chat');
    ok(r.diag >= 8, `App.diagnostics() devuelve el entorno (${r.diag} claves)`);
    await page.close();
  }

  /* ─── 4) Incrustada con srcdoc ─── */
  console.log('\n▸ 3) Incrustada con srcdoc (otra forma habitual de embeber)');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 800 });
    const html = require('fs').readFileSync(path.join(__dirname, '..', 'bar-replay-pro-unico.html'), 'utf8');
    await page.setContent('<html><body style="margin:0"><iframe id="f" sandbox="allow-scripts" style="border:0;width:100vw;height:100vh"></iframe></body></html>');
    await page.evaluate((h) => { document.getElementById('f').srcdoc = h; }, html);
    const frame = await (async () => {
      for (let i = 0; i < 40; i++) {
        const f = page.frames().find((x) => x !== page.mainFrame());
        if (f) return f;
        await wait(200);
      }
      return null;
    })();
    ok(!!frame, 'el iframe con srcdoc se crea');
    if (frame) {
      await frame.waitForFunction('window.App && window.App.candles.length > 0', { timeout: 40000 });
      const st = await frame.evaluate(() => ({
        source: App.source, candles: App.candles.length, drawn: CM.series.candles.data().length,
        cursor: BR.getIndex(), aviso: !!document.getElementById('brpNoJS'),
      }));
      ok(st.candles >= 1000 && /Binance|DEMO/i.test(st.source), `arranca con velas (${st.candles} · ${st.source})`);
      ok(st.drawn === st.cursor + 1, 'solo dibuja las velas reveladas');
      ok(!st.aviso, 'el cartel de emergencia desaparece al arrancar bien');
    }
    await page.close();
  }

  await browser.close();
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Incidencias y diagnóstico: ${pasan} superadas, ${fallan} fallidas`);
  if (fallan === 0) console.log('✅ La app informa siempre de lo que ocurre, nunca se queda muda.\n');
  else { console.log('❌ Hay rutas de error sin cubrir.\n'); process.exit(1); }
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
