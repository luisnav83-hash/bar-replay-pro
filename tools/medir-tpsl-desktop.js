/* Herramienta del registro §5.5b (11-oct): cómo pinta Bitunix el bloque TP/SL de su panel de
   órdenes -desmarcado y marcado- y a qué alturas deja los botones de operar. Corre contra la
   página real y no toca este repo; los números que salieron están en `docs/brecha-visual-bitunix.md`
   (§5.5b) y anclados en `tests/bitunix.test.js`.

   Dos trucos que costaron y que hay que conservar:
   · la casilla es de su librería (Arco): no alterna con `.click()` en el `div`; hay que dispatchar
     `mousedown`/`mouseup`/`click` sobre el `svg`;
   · la fila se localiza por el `span` con el texto exacto `TP/SL` y su
     `closest('[class*=profit-group]')`: buscarla por `innerText === 'TP/SL'` deja de funcionar en
     cuanto la fila lleva el resumen pegado.

   Uso:   . /home/user/tools/entorno.sh && node tools/medir-tpsl-desktop.js
   Salida: /tmp/tpsl-desktop.json y dos PNG recortados a la carta, en /tmp.
   */
'use strict';
let puppeteer;
for (const c of ['puppeteer', process.env.PPTR_PATH, '/home/user/.cache/pptr/node_modules/puppeteer']) {
  try { puppeteer = require(c); break; } catch (e) { /* sigue */ }
}
if (!puppeteer) { console.error('sin puppeteer'); process.exit(2); }
const URL = process.env.BITUNIX_URL || 'https://www.bitunix.com/es-es/contract-trade/BTCUSDT';
const ESP = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CERRAR = `() => {
  const matar = /aceptar todo|accept all|i agree|de acuerdo|permitir todo|allow all|got it|entendido|más tarde|maybe later|cerrar|skip|saltar|continuar en el navegador|no thanks|rechazar|reject/i;
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

const MED = `() => {
  const hex = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return c || '';
    const p = m[1].split(',').map(parseFloat);
    return '#' + p.slice(0,3).map(v => Math.round(v).toString(16).padStart(2,'0')).join(''); };
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cs = (e) => e ? getComputedStyle(e) : null;
  const marca = [...document.querySelectorAll('span')].find(x => (x.innerText || '').trim() === 'TP/SL');
  const bloque = marca && marca.closest && marca.closest('[class*=profit-group]');
  const icono = marca ? marca.parentElement.querySelector('svg') : null;
  const cajas = bloque ? [...bloque.querySelectorAll('span[class*=input-wrapper]')] : [];
  const botones = [...document.querySelectorAll('div,button,span')].filter(e => {
    const t = (e.innerText || '').trim(); const r = e.getBoundingClientRect();
    return /^(Abrir (Largo|Corto)|Comprar|Vender|Long|Short)$/.test(t) && r.width > 60 && r.height > 20 && e.children.length <= 2;
  }).map(e => ({ t: (e.innerText || '').trim().slice(0, 18), caja: R(e), px: parseFloat(cs(e).fontSize), peso: cs(e).fontWeight,
      f: hex(cs(e).backgroundColor), l: hex(cs(e).color), radio: cs(e).borderTopLeftRadius }));
  return {
    icono: icono ? { caja: R(icono), fill: hex(cs(icono).color), cls: String(icono.getAttribute('class') || '').slice(0, 40) } : null,
    grupo: marca ? { cls: String(marca.parentElement.className).slice(0, 50), caja: R(marca.parentElement) } : null,
    fila: bloque ? R(bloque.firstElementChild) : null,
    bloque: R(bloque),
    cajas: cajas.map((e) => {
      const inp = e.querySelector('input');
      const suf = e.querySelector('[class*=suffix]');
      const pre = e.querySelector('[class*=prefix]');
      const lab = e.parentElement;
      return {
        wrapper: R(e), f: hex(cs(e).backgroundColor), r: cs(e).borderTopLeftRadius, pad: cs(e).padding,
        placeholder: inp ? inp.placeholder : null, aria: inp ? (inp.getAttribute('aria-label') || null) : null,
        type: inp ? inp.type : null, input: R(inp), inputL: inp ? hex(cs(inp).color) : null, inputPx: inp ? parseFloat(cs(inp).fontSize) : null,
        prefijo: pre ? { caja: R(pre), txt: (pre.innerText || '').trim().slice(0, 20) } : null,
        sufijo: suf ? { caja: R(suf), txt: (suf.innerText || '').trim().slice(0, 20), l: hex(cs(suf).color), px: parseFloat(cs(suf).fontSize) } : null,
        filaPadre: R(lab), txtPadre: (lab.innerText || '').trim().slice(0, 30),
      };
    }),
    botones: botones.slice(0, 6),
    carta: R(document.querySelector('[class*=order-form], [class*=trade-form]')) ,
  };
}`;

(async () => {
  const br = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=es-ES', '--font-render-hinting=none'] });
  const page = await br.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await ESP(9000);
  for (let i = 0; i < 4; i++) { await page.evaluate(eval('(' + CERRAR + ')')).catch(() => []); await ESP(900); }
  await ESP(2000);

  const sinMarcar = await page.evaluate(eval('(' + MED + ')'));
  console.log('══ DESMARCADO ══');
  console.log(JSON.stringify(sinMarcar, null, 1).slice(0, 1800));
  await page.screenshot({ path: '/tmp/tpsl-desmarcado.png', clip: { x: 1295, y: 300, width: 305, height: 560 } });

  await page.evaluate(() => {
    const marca = [...document.querySelectorAll('span')].find(x => (x.innerText || '').trim() === 'TP/SL');
    const bloque = marca && marca.closest && marca.closest('[class*=profit-group]');
    const fila = bloque ? bloque.firstElementChild : null;
    if (!fila) return;
    for (const sel of ['svg', 'span[class*=check-icon]']) {
      const e = fila.querySelector(sel);
      if (e) ['mousedown', 'mouseup', 'click'].forEach((t) => e.dispatchEvent(new MouseEvent(t, { bubbles: true })));
    }
  });
  await ESP(2500);
  const marcado = await page.evaluate(eval('(' + MED + ')'));
  console.log('\n══ MARCADO ══');
  console.log(JSON.stringify(marcado, null, 1).slice(0, 2600));
  await page.screenshot({ path: '/tmp/tpsl-marcado.png', clip: { x: 1295, y: 300, width: 305, height: 560 } });
  require('fs').writeFileSync('/tmp/tpsl-desktop.json', JSON.stringify({ sinMarcar, marcado }, null, 1));
  console.log('\n· PNGs: /tmp/tpsl-desmarcado.png · /tmp/tpsl-marcado.png · JSON /tmp/tpsl-desktop.json');
  await br.close();
  process.exit(0);
})().catch((e) => { console.error('sonda falló:', String(e).slice(0, 400)); process.exit(1); });
