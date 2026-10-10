/* =========================================================================
 * tools/captura-bitunix.js — mirar el sitio de verdad, no recordarlo
 *
 *  Abre https://www.bitunix.com/contract-trade/BTCUSDT en Chromium headless con la
 *  idioms del usuario (es-ES) y captura DOS cosas:
 *    1) lo que se ve (PNG de la página entera, del panel de órdenes y de la esquina
 *       de posiciones), y
 *    2) lo que hay detrás (tokens reales: colores, radios, tipografía, tamaños,
 *       etiquetas visibles y el árbol del panel de órdenes).
 *  Después abre la NUESTRA en el mismo viewport para que la comparación sea
 *  lado a lado y no de memoria.
 *
 *  No inventa nada: si el DOM no carga (bloqueo, walls de consent, SPA lenta) lo
 *  dice tal cual en el JSON.
 *
 *  Uso:  . /home/user/tools/entorno.sh && node tools/captura-bitunix.js [--solo-nuestra]
 *  Salida: docs/bitunix/*.png y docs/bitunix/medida.json
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/node_modules/puppeteer',
                  '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) {}
}
if (!puppeteer) { console.error('puppeteer no disponible (exporta PPTR_PATH con entorno.sh)'); process.exit(2); }

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'docs', 'bitunix');
fs.mkdirSync(SALIDA, { recursive: true });

const URL_ELLOS = process.env.BITUNIX_URL || 'https://www.bitunix.com/contract-trade/BTCUSDT';
const URL_NUESTRA = 'file://' + path.join(RAIZ, 'bar-replay-pro-unico.html');
const ESP = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const VP = { width: 1600, height: 900, deviceScaleFactor: 1 };

/** Lo que se pincha para que la página se deje ver (cookies, banners, "quizá más tarde"). */
const CERRAR = `
  () => {
    const matar = /aceptar todo|accept all|i agree|de acuerdo|permitir todo|allow all|aceito|got it|entendido|quizá más tarde|maybe later|más tarde|cerrar|skip|saltar|continuar en el navegador|no thanks|rechazar|reject/i;
    const hechas = [];
    for (const b of [...document.querySelectorAll('button, a, [role=button]')]) {
      const t = (b.innerText || '').trim().slice(0, 60);
      if (!t || t.length > 40) continue;
      if (matar.test(t)) {
        const r = b.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        try { b.click(); hechas.push(t); } catch (e) {}
        if (hechas.length >= 6) break;
      }
    }
    return hechas;
  }`;

/**
 * Tokens medidos del sitio. Se recogen de tres maneras porque una sola engaña:
 *  · las variables `--x` que la propia hoja declara en :root (si son legibles);
 *  · el estilo calculado de los nodos que de verdad se ven (botón de comprar,
 *    pestaña activa, campo de precio…);
 *  · la caja de cada uno, para saber cómo de ANCHO es el panel y dónde acaba.
 */
const MEDIR = `(() => {
  const hex = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || '');
    if (!m) return c || '';
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    if (p.length >= 4 && p[3] === 0) return 'transparent';
    return '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  };
  const caja = (e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const estilo = (e) => {
    const s = getComputedStyle(e);
    return {
      caja: caja(e),
      tag: e.tagName.toLowerCase(),
      fondo: hex(s.backgroundColor),
      letra: hex(s.color),
      borde: hex(s.borderColor),
      radio: s.borderTopLeftRadius,
      px: parseFloat(s.fontSize),
      peso: s.fontWeight,
      familia: s.fontFamily.split(',')[0].replace(/[\"']/g, ''),
      padding: s.padding,
      texto: (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 34),
    };
  };
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 6 && r.height > 6; };

  const vars = {};
  for (const hoja of [...document.styleSheets]) {
    let reglas; try { reglas = hoja.cssRules; } catch (e) { continue; }
    for (const r of [...reglas]) {
      if (!r.style || !r.selectorText || !/:root|^html$/.test(r.selectorText)) continue;
      for (const pr of [...r.style]) {
        if (!pr.startsWith('--')) continue;
        const v = r.style.getPropertyValue(pr).trim();
        if (v && v.length < 40 && !vars[pr]) vars[pr] = v;
      }
    }
  }

  // Etiquetas visibles del panel de órdenes: es lo que dice el sitio en cada hueco.
  const etiquetas = [];
  for (const e of [...document.querySelectorAll('button, [role=tab], label, span, div')]) {
    if (!visible(e)) continue;
    const t = (e.innerText || '').replace(/\\s+/g, ' ').trim();
    if (!t || t.length > 28) continue;
    const c = e.getBoundingClientRect();
    if (c.y < 40 || c.width < 8) continue;
    etiquetas.push({ t, x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height),
      fondo: hex(getComputedStyle(e).backgroundColor), letra: hex(getComputedStyle(e).color) });
  }
  const porTexto = new Map();
  for (const e of etiquetas) if (!porTexto.has(e.t + '@' + e.x + ',' + e.y)) porTexto.set(e.t + '@' + e.x + ',' + e.y, e);
  // Los botones de lado (LONG/SHORT, Comprar/Vender) son los que mandan la estética.
  const clave = /long|short|buy|sell|comprar|vender|largo|corto|limit|market|límite|mercado|trigger|leverage|apalancamiento|margin|pattern|margen/i;
  const botones = [...document.querySelectorAll('button, [role=button], [role=tab]')]
    .filter((e) => visible(e))
    .map(estilo)
    .filter((b) => b.texto && (clave.test(b.texto) || b.px >= 12))
    .slice(0, 60);

  // El panel de órdenes se localiza por lo que tiene dentro, no por su clase (oscura y con hash).
  const campos = [...document.querySelectorAll('input')].filter(visible);
  let panel = null;
  for (const inp of campos) {
    let a = inp;
    for (let i = 0; i < 8 && a; i++, a = a.parentElement) {
      if (!a) continue;
      const r = a.getBoundingClientRect();
      if (r.width >= 220 && r.width <= 520 && r.height >= 300) { panel = a; break; }
    }
    if (panel) break;
  }
  const arbol = [];
  if (panel) {
    (function andar(n, prof) {
      if (prof > 7 || arbol.length > 320) return;
      for (const h of [...n.children]) {
        const r = h.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const txt = [...h.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent.trim()).join(' ').slice(0, 40);
        arbol.push('  '.repeat(prof) + h.tagName.toLowerCase()
          + (h.id ? '#' + h.id : '')
          + (h.className && typeof h.className === 'string' ? '.' + h.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')
          + ' [' + Math.round(r.width) + '×' + Math.round(r.height) + '@' + Math.round(r.x) + ',' + Math.round(r.y) + ']'
          + (txt ? ' «' + txt + '»' : ''));
        andar(h, prof + 1);
      }
    })(panel, 0);
  }

  const cuerpo = estilo(document.body);
  return {
    url: location.href,
    titulo: document.title.slice(0, 80),
    fuente: { familia: getComputedStyle(document.body).fontFamily, tam: cuerpo.px },
    cuerpo: { fondo: cuerpo.fondo, letra: cuerpo.letra },
    vars: Object.keys(vars).length,
    varsMuestra: Object.fromEntries(Object.entries(vars).slice(0, 60)),
    nInputs: campos.length,
    panel: panel ? { caja: caja(panel), ...estilo(panel) } : null,
    botones,
    etiquetas: [...porTexto.values()].slice(0, 260),
    arbol,
    lienzos: [...document.querySelectorAll('canvas, svg')].filter(visible)
      .map((e) => ({ tag: e.tagName.toLowerCase(), ...caja(e),
        buf: e.width ? e.width + '×' + e.height : null, dpr: devicePixelRatio })),
  };
})()`;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=es-ES',
      '--font-render-hinting=none'],
  });
  const out = { generado: new Date().toISOString(), viewport: VP, ellos: null, nuestra: null };

  try {
    const page = await browser.newPage();
    await page.setViewport(VP);
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' });
    const redes = [];
    page.on('response', (r) => { if (r.status() >= 400) redes.push(r.status() + ' ' + r.url().slice(0, 110)); });
    const err = [];
    page.on('pageerror', (e) => err.push(String(e).slice(0, 160)));
    console.log('· abriendo el sitio real:', URL_ELLOS);
    await page.goto(URL_ELLOS, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ESP(7000);
    for (let i = 0; i < 4; i++) {
      const cerrados = await page.evaluate(eval('(' + CERRAR + ')')).catch(() => []);
      if (!cerrados.length) break;
      console.log('  · cerrados:', cerrados.join(' | '));
      await ESP(2500);
    }
    await ESP(4000);
    out.ellos = await page.evaluate(MEDIR);
    out.ellos._erroresPagina = err;
    out.ellos._respuestasMalas = redes.slice(0, 12);
    await page.screenshot({ path: path.join(SALIDA, 'el-entero.png') });
    const p = out.ellos.panel && out.ellos.panel.caja;
    if (p) {
      await page.screenshot({ path: path.join(SALIDA, 'el-panel-ordenes.png'),
        clip: { x: Math.max(0, p.x - 8), y: Math.max(0, p.y - 8), width: Math.min(p.w + 16, VP.width), height: Math.min(p.h + 16, VP.height - Math.max(0, p.y - 8)) } });
    }
    await page.screenshot({ path: path.join(SALIDA, 'el-abajo.png'),
      clip: { x: 0, y: Math.round(VP.height * 0.52), width: Math.round(VP.width * 0.74), height: Math.round(VP.height * 0.48) } });
    console.log('  · título:', out.ellos.titulo);
    console.log('  · fondo', out.ellos.cuerpo.fondo, '· letra', out.ellos.cuerpo.letra, '·', out.ellos.fuente.familia.slice(0, 40));
    console.log('  · panel de órdenes:', p ? `${p.w}×${p.h} en x=${p.x}` : 'NO ENCONTRADO');
    console.log('  · inputs visibles:', out.ellos.nInputs, '· lienzos:', out.ellos.lienzos.length, '· etiquetas:', out.ellos.etiquetas.length);
  } catch (e) {
    out.ellos = { fallo: String(e).slice(0, 300) };
    console.error('  ✗ no se pudo capturar el sitio:', String(e).slice(0, 200));
  }

  if (!process.argv.includes('--solo-ellos')) {
    try {
      const page = await browser.newPage();
      await page.setViewport(VP);
      console.log('· abriendo la nuestra:', URL_NUESTRA);
      await page.goto(URL_NUESTRA, { waitUntil: 'load', timeout: 40000 });
      await ESP(4000);
      await page.evaluate(() => {
        if (window.BR && BR.loadDemo) { try { BR.loadDemo(); } catch (e) {} }
        if (window.App && App.loadDemo) { try { App.loadDemo(); } catch (e) {} }
      });
      await ESP(3000);
      out.nuestra = await page.evaluate(MEDIR);
      await page.screenshot({ path: path.join(SALIDA, 'nuestra-entero.png') });
      if (out.nuestra.panel) {
        const q = out.nuestra.panel.caja;
        await page.screenshot({ path: path.join(SALIDA, 'nuestra-panel-ordenes.png'),
          clip: { x: Math.max(0, q.x - 8), y: 0, width: Math.min(q.w + 16, VP.width), height: VP.height } });
      }
      await page.screenshot({ path: path.join(SALIDA, 'nuestra-abajo.png'),
        clip: { x: 0, y: Math.round(VP.height * 0.52), width: Math.round(VP.width * 0.74), height: Math.round(VP.height * 0.48) } });
    } catch (e) {
      out.nuestra = { fallo: String(e).slice(0, 300) };
      console.error('  ✗ la nuestra no capturó:', String(e).slice(0, 160));
    }
  }

  fs.writeFileSync(path.join(SALIDA, 'medida.json'), JSON.stringify(out, null, 1));
  console.log('· JSON:', path.join(SALIDA, 'medida.json'));
  await browser.close();
})().catch((e) => { console.error('FALLO GENERAL', e); process.exit(1); });
