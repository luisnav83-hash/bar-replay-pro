/* tools/medir-movil-bitunix.js · Sonda del MÓVIL de Bitunix (ítem §5.6 del registro
   `docs/brecha-visual-bitunix.md`).
 *
 * Por qué existe: la regla de esta piel es medir el sitio real antes de tocar. Las pasadas 1-5
 * se midieron a 1600x900 de escritorio, y pedir «el móvil como el de Bitunix» con esos números
 * sería inventárselo. Este tool abre la página con emulación de teléfono (390x844, dpr 3, tacto)
 * y saca:
 *    · la lista de regiones visibles (caja, tipografia, color, fondo, radio) en orden de pantalla;
 *    · los tres estados del gesto de operar: reposo, tras pulsar el boton de operar, y el panel de
 *      orden desplegado (pestanas del libro / posiciones, si existen);
 *    · capturas PNG para el registro, en docs/movil-*.png.
 *
 * Uso:  . /home/user/tools/entorno.sh && node tools/medir-movil-bitunix.js [--url=...] [--alto=900]
 * Salida: /tmp/movil-bitunix.json + docs/movil-*.png
 *
 * Sin sesion: lo que no se pueda alcanzar se anota como no medido, no se rellena a ojo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH, path.join(process.env.HOME || '', '.cache/pptr/node_modules/puppeteer'),
                 '/home/user/.cache/tools/pptr/node_modules/puppeteer', '/home/user/.cache/pptr/node_modules/puppeteer']) {
  if (!c) continue;
  try { puppeteer = require(c); break; } catch (e) { /* sigue */ }
}
if (!puppeteer) { console.error('Falta puppeteer (usa tools/entorno.sh)'); process.exit(2); }

const URL = (process.argv.find((a) => a.startsWith('--url=')) || '').split('=')[1]
  || process.env.BITUNIX_URL || 'https://www.bitunix.com/es-es/contract-trade/BTCUSDT';
const ANCHO = +((process.argv.find((a) => a.startsWith('--ancho=')) || '').split('=')[1] || 390);
const ALTO = +((process.argv.find((a) => a.startsWith('--alto=')) || '').split('=')[1] || 844);
const ESP = (ms) => new Promise((r) => setTimeout(r, ms));
const UA_MOVIL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const OUT = process.env.MOVIL_JSON || '/tmp/movil-bitunix.json';
const DOC = path.join(__dirname, '..', 'docs');

const CERRAR = `() => {
  const matar = /aceptar todo|accept all|i agree|de acuerdo|permitir todo|allow all|got it|entendido|rechazar|reject|más tarde|maybe later|quizá más tarde|skip|saltar|continuar en el navegador|no thanks/i;
  const hechas = [];
  for (const b of [...document.querySelectorAll('button, a, [role=button]')]) {
    const t = (b.innerText || '').trim().slice(0, 60);
    if (!t || t.length > 44 || !matar.test(t)) continue;
    const r = b.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    try { b.click(); hechas.push(t); } catch (e) {}
    if (hechas.length >= 6) break;
  }
  return hechas;
}`;

/* Un barrido «plano»: todos los elementos con texto propio o relevancia de caja, en orden de
   pantalla, con la tipografia y los colores que de verdad se pintan. Se limita para no reventar
   el JSON; el orden (y) es lo que responde a «que hay arriba, que abajo y que flota». */
const BARRIDO = `(limite) => {
  const hex = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return c || '';
    const p = m[1].split(',').map(parseFloat);
    if (p.length === 4 && p[3] === 0) return 'transparent';
    return '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  };
  const R = (e) => { const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const visible = (e) => { const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false;
    const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const piezas = [];
  for (const e of document.querySelectorAll('body *')) {
    if (piezas.length >= limite) break;
    if (!visible(e)) continue;
    const caja = R(e);
    if (caja.w < 10 || caja.h < 6) continue;
    if (caja.y > scrollY + innerHeight * 2.2) continue;         // no hace falta el infinito del documento
    const cs = getComputedStyle(e);
    const txt = (e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 46);
    const solo = [...e.children].some((c) => visible(c)) ? '' : txt;   // texto PROPIO (no heredado del hijo)
    if (!solo && e.children.length > 3 && cs.position !== 'fixed') continue;
    piezas.push({ t: (e.tagName || '').toLowerCase() + (e.id ? '#' + e.id : '')
        + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''),
      caja, txt: solo, f: hex(cs.backgroundColor), l: hex(cs.color), px: parseFloat(cs.fontSize), peso: cs.fontWeight,
      radio: cs.borderTopLeftRadius, borde: hex(cs.borderTopColor) + ' ' + cs.borderTopWidth, pad: cs.padding,
      disp: cs.display, pos: cs.position, fixo: cs.position === 'fixed' ? 1 : 0 });
  }
  return { scrollY: Math.round(scrollY), innerHeight, innerWidth, dpr: devicePixelRatio,
    doc: Math.round(document.documentElement.scrollHeight), piezas };
}`;

/* Los botones de operar: en movil Bitunix no pinta el formulario entero, flota una barra con
   `Comprar | Vender` (y el precio en el medio). Se busca por texto, en todo el documento. */
const BOTONES = `() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const hex = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return c || ''; const p = m[1].split(',').map(parseFloat);
    return '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); };
  const busca = /comprar|vender|long|short|abrir|cerrar|operar|orden|mercado|limite|límite/i;
  const sal = [];
  for (const e of document.querySelectorAll('button, a, div[role=button], span')) {
    const t = (e.innerText || '').trim();
    if (!t || t.length > 26 || !busca.test(t)) continue;
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 24 || r.height < 14 || r.width * r.height > 400 * 200) continue;
    sal.push({ t: t.replace(/\\s+/g, ' '), caja: R(e), px: parseFloat(getComputedStyle(e).fontSize),
      peso: getComputedStyle(e).fontWeight, f: hex(getComputedStyle(e).backgroundColor), l: hex(getComputedStyle(e).color),
      radio: getComputedStyle(e).borderTopLeftRadius });
  }
  function visible(e) { const c = getComputedStyle(e); return !(c.display === 'none' || c.visibility === 'hidden') && e.getBoundingClientRect().width > 1; }
  return sal.slice(0, 40);
}`;

const PESTAÑAS = `() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const hex = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return c || ''; const p = m[1].split(',').map(parseFloat);
    return '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); };
  const out = [];
  for (const e of document.querySelectorAll('[class*=tab], [role=tab], [class*=segment] , [class*=switch]')) {
    const t = (e.innerText || '').trim().replace(/\\s+/g, ' ');
    if (!t || t.length > 90 || !e.getBoundingClientRect().height) continue;
    out.push({ t: t.slice(0, 88), caja: R(e), f: hex(getComputedStyle(e).backgroundColor), l: hex(getComputedStyle(e).color),
      px: parseFloat(getComputedStyle(e).fontSize), radio: getComputedStyle(e).borderTopLeftRadius, cls: String(e.className).slice(0, 40) });
  }
  return out.slice(0, 26);
}`;

(async () => {
  const br = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=es-ES', '--touch-events=enabled', '--font-render-hinting=none'] });
  const page = await br.newPage();
  await page.setViewport({ width: ANCHO, height: ALTO, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.setUserAgent(UA_MOVIL);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });
  const err = [];
  page.on('pageerror', (e) => err.push(String(e).slice(0, 140)));
  console.log(`· abriendo ${URL} en ${ANCHO}x${ALTO} @3x (movil)`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await ESP(9000);
  for (let i = 0; i < 4; i++) { await page.evaluate(eval('(' + CERRAR + ')')).catch(() => []); await ESP(900); }
  await ESP(3000);

  const pasos = {};
  pasos.reposo = await page.evaluate(eval(BARRIDO), 240);
  pasos.botones = await page.evaluate(eval('(' + BOTONES + ')'));
  pasos.pestanas = await page.evaluate(eval('(' + PESTAÑAS + ')'));
  await page.screenshot({ path: path.join(DOC, 'movil-00-reposo.png') });

  /* 1) EL UNICO gesto que se puede medir sin cuenta: el boton redondo `⇄` de la cabecera, que en
     su movil alterna la carta con el formulario. Pulsar «Abrir Largo» sin sesion NO vale: la pagina
     REDIRIGE a /login (comprobado el 11-oct a 390x844 -las pasadas 2 y 3 de esta sonda salieron
     llenas de su formulario de acceso—), asi que lo que hay debajo del pliegue del panel de orden
     se lee del DOM, no del toque. */
  /* Su m6vil tiene DOS vistas y se cambia con un grupo `pill-tabs` de la cabecera: los items son de
     44x32 con radio 999 sobre #1a1b1c (medido: caja del grupo x=285..373, y=137..169). Se pulsa el
     PRIMERO que este SIN `--active` -pulser el activo no hace nada, y fue el error de la primera
     version de esta sonda, que barria por geometria y caia justo en el activo—. */
  const cambio = await page.evaluate(() => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const items = [...document.querySelectorAll('[class*=pill-tabs__item]')];
    const inactivo = items.find((e) => !/--active/.test(String(e.className)));
    const info = { total: items.length, items: items.slice(0, 4).map((e) => ({ t: (e.innerText || '').trim().slice(0, 12), caja: R(e), activo: /--active/.test(String(e.className)) })) };
    if (inactivo) inactivo.click();
    return info;
  });
  await ESP(2600);
  pasos.carta = { grupo: cambio, despues: await page.evaluate(eval(BARRIDO), 900),
    canvas: await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => {
      const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }).slice(0, 4)),
    tipos: await page.evaluate(() => {
      const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
      const sal = [];
      for (const e of document.querySelectorAll('body *')) {
        const r = e.getBoundingClientRect(); const y = r.y + scrollY;
        if (y < 120 || y > 800 || r.width < 12 || r.height < 9) continue;
        const t = (e.innerText || '').trim().replace(/\s+/g, ' ');
        if (!t || t.length > 40 || e.children.length > 1) continue;
        const cs = getComputedStyle(e);
        sal.push({ t: t.slice(0, 34), caja: R(e), px: parseFloat(cs.fontSize), peso: cs.fontWeight, l: cs.color.slice(0, 18),
          f: cs.backgroundColor.slice(0, 18), radio: cs.borderTopLeftRadius, up: cs.textTransform, ls: cs.letterSpacing });
      }
      return sal.slice(0, 46);
    }) };
  await page.screenshot({ path: path.join(DOC, 'movil-02-vista-carta.png') });

  /* 2) lo que hay bajo el pliegue, LEIDO DEL DOM (sin desplazar la pagina: su documento mide
      exactamente la ventana -390x844- y desliza por dentro). */
  pasos.bajoPliegue = await page.evaluate(() => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
    const sal = [];
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect();
      if (r.y + scrollY < 800 || r.y + scrollY > 1300 || r.width < 16 || r.height < 10) continue;
      const t = (e.innerText || '').trim().replace(/\s+/g, ' ');
      if (!t || t.length > 60 || e.children.length > 2) continue;
      const cs = getComputedStyle(e);
      sal.push({ t: t.slice(0, 54), caja: R(e), px: parseFloat(cs.fontSize), l: cs.color.slice(0, 18), f: cs.backgroundColor.slice(0, 18), radio: cs.borderTopLeftRadius });
    }
    return { documento: document.documentElement.scrollHeight, ventana: innerHeight, piezas: sal.slice(0, 40) };
  });

  /* 3) un campo: la altura que reserva y su tipo (el movil suyo abre el teclado numerico del sistema) */
  const campo = await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find((e) => {
      const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
      return r.width > 40 && r.height > 14 && c.display !== 'none' && e.type !== 'range';
    });
    if (!i) return null;
    const r = i.getBoundingClientRect();
    return { type: i.type, ph: i.placeholder || '', caja: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  });
  pasos.campo = campo || 'sin input visible tras el swap';

  const esc = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, doc: document.documentElement.scrollHeight }));
  const out = { url: URL, viewport: { ANCHO, ALTO, ...esc }, err, pasos };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`· JSON: ${OUT}  (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
  for (const k of ['reposo', 'carta', 'bajoPliegue']) {
    const p = k === 'carta' ? pasos.carta.despues : pasos[k];
    console.log(`  ${k}: ${(p.piezas || []).length} piezas, documento ${p.doc || p.documento || '-'} px, scrollY ${p.scrollY || 0}`);
  }
  console.log(`  grupo de vistas: ${JSON.stringify(pasos.carta.grupo).slice(0, 240)}`);
  console.log(`  canvas tras el cambio: ${JSON.stringify(pasos.carta.canvas).slice(0, 220)}`);
  console.log(`  tipografias de la vista de carta: ${pasos.carta.tipos.length} piezas (en el JSON)`);
  console.log(`  campo: ${JSON.stringify(pasos.campo)}`);
  console.log(`  errores de pagina: ${err.length ? err.join(' | ') : '0'}`);
  console.log(`· PNGs en ${DOC}/movil-*.png`);
  await br.close();
})().catch((e) => { console.error('sonda falló:', String(e).slice(0, 500)); process.exit(1); });
