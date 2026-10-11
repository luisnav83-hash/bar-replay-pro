/* Herramienta del registro §5.8 (11-oct): busco en el SITIO REAL el modo «focused trading» que
   aparece en su vídeo de órdenes visuales (bitunix-assets/chart-trading/focused-trading/
   visual-orders.mp4) y, si está accesible sin sesión, mido el billete que sale al arrastrar sobre la
   carta: campos, riel de %, botón de confirmar, radios y colores por getComputedStyle.

   Por qué hace falta: el .mp4 es un MOCK promocional con tipografía sobredimensionada (sus rótulos
   miden 26-30 px CSS con la calibración /3), así que su estructura es fiable y sus números NO. Las
   cifras de la piel tienen que salir del DOM, como en todo este proyecto (regla de oro del doc).

   Uso:   . /home/user/tools/entorno.sh && node tools/medir-concentrado-bitunix.js
   Salida:/tmp/concentrado.json y /tmp/concentrado.png (recorte de la carta con el billete abierto).
   No toca este repo más que este fichero; si el modo exige sesión, el JSON lo dice y se anota.
   */
'use strict';
let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) { /* sigue */ }
}
if (!puppeteer) { console.error('sin puppeteer: . /home/user/tools/entorno.sh'); process.exit(2); }

const URL = process.env.BITUNIX_URL || 'https://www.bitunix.com/es-es/contract-trade/BTCUSDT';
const OUT = process.env.OUT || '/tmp/concentrado.json';
const PNG = process.env.PNG || '/tmp/concentrado.png';
const ESP = (ms) => new Promise((r) => setTimeout(r, ms));
/* ENSEÑANZA DE ESTA SONDA: `page.evaluate('(a,b) => ...')` con la funcion en CAENA no falla en esta
   version de Puppeteer, devuelve `{}` en silencio (la cadena se evalua como expresion y el objeto
   funcion no serializa). Toda sonda que se escriba en cadena hay que lanzarla asi:
   `run(page, FUENTE)`, que la compila en la pagina con eval. Si no, el informe sale en blanco y
   parece que el sitio no tiene la UI, cuando lo que no tiene es la prueba. */
const run = (page, fuente) => page.evaluate((src) => (eval('(' + src + ')'))(), fuente);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CERRAR = `() => {
  const matar = /aceptar todo|accept all|i agree|de acuerdo|permitir todo|allow all|got it|entendido|más tarde|maybe later|continuar en el navegador|no thanks|rechazar|reject/i;
  const hechas = [];
  for (const b of [...document.querySelectorAll('button, a, [role=button]')]) {
    const t = (b.innerText || '').trim().slice(0, 60);
    if (!t || t.length > 40 || !matar.test(t)) continue;
    const r = b.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    try { b.click(); hechas.push(t); } catch (e) {}
    if (hechas.length >= 6) break;
  }
  return hechas;
}`;

/* Los iconos de la cabecera de la carta: título, aria-label, class y posición. Ahí tiene que estar el
   que abre el modo concentrado (en el vídeo es el ultimo de la fila, un «expandir» con dos flechas). */
const ICONOS = `() => {
  const R = (e) => { const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = [];
  for (const e of document.querySelectorAll('[class*=chart] [role=button], [class*=chart] button, [class*=toolbar] *, [class*=header] [class*=icon], [class*=tool] [class*=icon]')) {
    const r = e.getBoundingClientRect();
    if (r.width < 8 || r.width > 60 || r.height < 8 || r.height > 60) continue;
    const etiqueta = e.getAttribute('title') || e.getAttribute('aria-label') || (e.innerText || '').trim() ||
      (e.querySelector('svg') && (e.querySelector('svg').getAttribute('aria-label') || '')) || '';
    out.push({ tag: e.tagName.toLowerCase(), clase: (e.className.baseVal !== undefined ? e.className.baseVal : e.className || '').toString().slice(0, 70),
      etiqueta: etiqueta.slice(0, 40), ...R(e) });
  }
  return out.slice(0, 90);
}`;

/* Todos los title/aria-label del tercio superior derecho: ahi esta la fila de iconos de la carta
   y, si el modo concentrado tiene boton, tendra nombre. */
const ROTULOS = `() => {
  const out = [];
  for (const e of document.querySelectorAll('[title], [aria-label]')) {
    const r = e.getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || r.y > 300 || r.y < 60) continue;
    out.push({ t: (e.getAttribute('title') || e.getAttribute('aria-label') || '').trim().slice(0, 46),
      tag: e.tagName.toLowerCase(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out.slice(0, 60);
}`;

/* Estado del chasis antes/después de pulsar: si la carta se queda a sangre y agua (sin panel lateral y
   sin panel inferior) es que el modo concentrado existe y está activado. */
const CHASIS = `() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
      visible: r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none', fondo: c.backgroundColor }; };
  const lienzo = document.querySelector('canvas');
  const r = lienzo ? lienzo.getBoundingClientRect() : null;
  return {
    documento: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    lienzo: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    cuerpo: getComputedStyle(document.body).backgroundColor,
    candidatos: ['[class*=order-panel]', '[class*=trade-form]', '[class*=side-bar]', '[class*=sidebar]',
      '[class*=bottom]', '[class*=orderBook]', '[class*=depth]'].map((s) => [s, R(s)]),
  };
}`;

/* Un arrastre sobre el lienzo: si el modo concentrado permite colocar ordenes a mano, aqui tiene que
   aparecer el billete. Lo busco por input con placeholder de cantidad y por el riel de %. */
const BILLETE = `() => {
  const hex = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return c || '';
    const p = m[1].split(',').map(parseFloat);
    return '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') + (p.length > 3 ? ' a' + p[3] : ''); };
  const R = (e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      radio: c.borderRadius, fondo: hex(c.backgroundColor), borde: hex(c.borderColor) + ' ' + c.borderWidth,
      color: hex(c.color), fuente: c.fontSize + '/' + c.fontWeight + ' ' + (c.fontFamily || '').split(',')[0].replace(/"/g, ''),
      padding: c.padding }; };
  const nuevos = [];
  for (const e of document.querySelectorAll('input')) {
    const f = (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.name || '');
    if (/cantidad|quantity|size|tama/i.test(f)) nuevos.push({ qué: 'input', texto: f.slice(0, 40), ...R(e) });
  }
  const rieles = [];
  for (const e of document.querySelectorAll('[class*=slider], [class*=slide], [role=slider]')) {
    const r = e.getBoundingClientRect(); if (r.width < 40 || r.height < 2 || r.height > 40) continue;
    rieles.push({ clase: (e.className || '').toString().slice(0, 60), ...R(e) });
  }
  const rótulos = [];
  for (const e of document.querySelectorAll('span, div')) {
    const t = (e.innerText || '').trim();
    if (/^(0|25|50|75|100)\\s?%$/.test(t) && e.children.length === 0) { const r = e.getBoundingClientRect();
      if (r.width > 0) rótulos.push({ t, x: Math.round(r.x), y: Math.round(r.y), ...R(e) }); }
  }
  const botones = [];
  for (const e of document.querySelectorAll('button, [role=button]')) {
    const t = (e.innerText || '').trim();
    if (!/mercado|market|comprar|vender|long|short|largo|corto|confirmar/i.test(t) || t.length > 28) continue;
    const r = e.getBoundingClientRect(); if (r.width < 12 || r.height < 12) continue;
    if (r.y > window.innerHeight - 90) continue;   // el pie flotante ya esta medido en el §5.1
    botones.push({ texto: t, ...R(e) });
  }
  const capas = [];
  for (const e of document.querySelectorAll('div')) {
    const c = getComputedStyle(e);
    if (c.position !== 'absolute' && c.position !== 'fixed') continue;
    const r = e.getBoundingClientRect();
    if (r.width < 160 || r.width > 720 || r.height < 60 || r.height > 420) continue;
    if (!e.closest('[class*=chart], [class*=Chart]') && r.y < 120) continue;
    const z = +c.zIndex || 0; if (z < 1) continue;
    capas.push({ clase: (e.className || '').toString().slice(0, 54), z, ...R(e),
      texto: (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 90) });
  }
  return { inputs: nuevos.slice(0, 8), rieles: rieles.slice(0, 6), porcentajes: rótulos.slice(0, 12),
    botones: botones.slice(0, 10), capas: capas.sort((a, b) => b.z - a.z).slice(0, 8),
    url: location.pathname };
}`;

(async () => {
  const navegador = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled',
      `--user-agent=${UA}`, '--lang=es-ES', '--window-size=1600,900'],
  });
  const informe = { url: URL, cuando: new Date().toISOString(), pasos: [] };
  try {
    const page = await navegador.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await page.setUserAgent(UA);
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    for (let i = 0; i < 5; i++) { await ESP(2500); await run(page, CERRAR).catch(() => []); }
    await ESP(3500);
    informe.pasos.push({ paso: 'reposo', chasis: await run(page, CHASIS).catch((e) => String(e)) });
    informe.iconos = await run(page, ICONOS).catch((e) => String(e));
    informe.rotulos = await run(page, ROTULOS).catch((e) => String(e));

    // arrastre sobre la carta SIN modo concentrado: hay que saber si el billete sale igual
    const caja = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect();
      return { x: Math.round(r.x + r.width * 0.45), y: Math.round(r.y + r.height * 0.45) }; });
    const arrastra = async (etiqueta) => {
      await page.mouse.move(caja.x, caja.y); await ESP(250);
      await page.mouse.down(); await ESP(200);
      for (let i = 1; i <= 8; i++) { await page.mouse.move(caja.x + i * 9, caja.y - i * 6); await ESP(70); }
      await page.screenshot({ path: PNG.replace('.png', '-durante-' + etiqueta + '.png') }).catch(() => {});
      await ESP(300);
      const b = await run(page, BILLETE).catch((e) => ({ err: String(e) }));
      await page.mouse.up(); await ESP(500);
      return { durante: b, despues: await run(page, BILLETE).catch((e) => ({ err: String(e) })) };
    };
    informe.pasos.push({ paso: 'arrastre sin modo', ...(await arrastra('normal')) });

    // intento de entrar en el modo concentrado: cualquier icono que huela a expandir/pantalla completa
    const pulsados = await page.evaluate(() => {
      const matar = /expand|fullscreen|pantalla|concentrad|maximiz|focus|inmersi/i;
      const hechas = [];
      for (const e of document.querySelectorAll('[title], [aria-label]')) {
        const t = ((e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || '')).toString();
        if (!matar.test(t)) continue;
        const r = e.getBoundingClientRect(); if (r.width < 6 || r.height < 6) continue;
        for (const tipo of ['mousedown', 'mouseup', 'click']) {
          e.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window }));
        }
        hechas.push({ texto: t.slice(0, 70), x: Math.round(r.x), y: Math.round(r.y) });
        if (hechas.length >= 4) break;
      }
      return hechas;
    }).catch((e) => [{ err: String(e) }]);
    informe.pasos.push({ paso: 'botones pulsados', pulsados });
    await ESP(3000);
    informe.pasos.push({ paso: 'despues de pulsar', chasis: await run(page, CHASIS).catch((e) => String(e)),
      ...(await arrastra('concentrado')) });
    informe.pasos.push({ paso: 'fin', url: page.url(), titulos: await page.evaluate(() => document.title) });
    await page.screenshot({ path: PNG, clip: { x: 0, y: 0, width: 1600, height: 900 } }).catch(() => {});
    informe.veredicto = {
      billeteVisto: informe.pasos.some((p) => (p.durante && p.durante.inputs && p.durante.inputs.length) ||
        (p.despues && p.despues.inputs && p.despues.inputs.length)),
      capasNuevas: [].concat(...informe.pasos.map((p) => (p.durante && p.durante.capas) || []),
        ...informe.pasos.map((p) => (p.despues && p.despues.capas) || [])).slice(0, 6),
    };
  } catch (e) {
    informe.error = String(e && e.stack || e);
  } finally {
    require('fs').writeFileSync(OUT, JSON.stringify(informe, null, 1));
    console.log('escrito', OUT);
    console.log(JSON.stringify(informe.veredicto || { error: informe.error && informe.error.slice(0, 200) }, null, 1).slice(0, 900));
    await navegador.close();
  }
})();
