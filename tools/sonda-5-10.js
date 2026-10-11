/* Sonda funcional del §5.10: la pastilla `Límite | precio | ×` de las órdenes pendientes.
   Three things to see before anchoring: (a) the pill is painted where their frame puts it (over the line,
   starting at the order's bar) with its own compartments; (b) a click without movement opens the §5.9
   editor on it, and (c) its `×` cancels the ORDER (not a level). Plus the drag still works.
   Uso: node tools/sonda-5-10.js   (necesita el build: node tools/build-single.js) */
const puppeteer = require(process.env.PPTR_PATH);
const ESP = (ms) => new Promise((r) => setTimeout(r, ms));
const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };

(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 140)); });
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto('file://' + process.cwd() + '/bar-replay-pro-unico.html', { waitUntil: 'load' });
  await ESP(2800);
  const out = {};

  const coloca = async (precio) => {
    await p.click('[data-tool="orden"]');
    const c = await p.evaluate(() => { const r = document.getElementById('overlayCanvas').getBoundingClientRect();
      return { x: Math.round(r.x + r.width * 0.5), y: Math.round(r.y + r.height * 0.45) }; });
    await p.mouse.click(c.x, c.y); await ESP(400);
    await p.evaluate((pp) => { const e = document.getElementById('bfBilletePrecio'); e.value = String(pp);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('bfBilleteOk').click(); }, precio);
    await ESP(700);
    await p.click('[data-tool="cursor"]'); await ESP(300);
  };

  await coloca(71000);
  out.pendiente = await p.evaluate(() => (TE.state.pending || []).map((o) => o.id + ':' + o.limitPrice + ':' + o.tipo));
  out.pastilla = await p.evaluate(() => {
    const h = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id));
    const cv = document.getElementById('overlayCanvas'), ctx = cv.getContext('2d');
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const g = h && h._grupo;
    const muestra = (x, y) => { const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      return '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join(''); };
    return {
      grupo: g ? { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h) } : null,
      colorDeLinea: h && h.color,
      cruz: (DT._cajasCruz || []).map((k) => k.id + ' ' + Math.round(k.x) + 'x' + Math.round(k.y) + ' ' + k.w + '×' + k.h),
      fondo: g ? muestra(g.x + 3, g.y + 3) : null,
      pelo: g ? '#@' + [ctx.getImageData(Math.round((g.x + 40) * dpr), Math.round((g.y) * dpr), 1, 1).data].map((d) => '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join(''))[0] : null,
      discos: (DT._cajasPlus || []).map((k) => k.id),
      xDeLaBarra: h ? Math.round(DT._xOf(h.t)) : null,
    };
  });

  // (b) clic sin arrastre en el compartimento del precio => el billete en modo edicion
  const precioPt = await p.evaluate(() => {
    const h = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id)); const g = h._grupo;
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    const xx = g.x + g.w - 26 - 30;                      // dentro del compartimento del numero
    return { x: Math.round(r.x + xx), y: Math.round(r.y + g.y + g.h / 2) };
  });
  await p.mouse.click(precioPt.x, precioPt.y); await ESP(400);
  out.clic = await p.evaluate(() => ({ abierto: !document.getElementById('bfBillete').hidden,
    editar: JSON.parse(JSON.stringify(UI.billete.editar || {})), precio: document.getElementById('bfBilletePrecio').value,
    panel: (() => { const e = document.getElementById('bfBillete').getBoundingClientRect();
      const g = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id))._grupo;
      const r = document.getElementById('overlayCanvas').getBoundingClientRect();
      return { derecha: Math.round(e.right), grupoX: Math.round(r.x + g.x), noTapa: e.right <= Math.round(r.x + g.x) }; })() }));
  await p.keyboard.press('Escape'); await ESP(250);

  // (c) la x de la pastilla cancela la ORDEN
  const cruzPt = await p.evaluate(() => {
    const k = (DT._cajasCruz || []).find((z) => /^limit:/.test(z.id));
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: Math.round(r.x + k.x + k.w / 2), y: Math.round(r.y + k.y + k.h / 2), id: k.id };
  });
  await p.mouse.click(cruzPt.x, cruzPt.y); await ESP(500);
  out.cruz = await p.evaluate(() => ({ pendientes: (TE.state.pending || []).length,
    pastillas: (DT.tradeHandles || []).filter((h) => /^limit:/.test(h.id)).length,
    aviso: (document.querySelector('#logList') || document.body).textContent.slice(-160) }));

  // (d) arrastrar la pastilla sigue moviendo la orden, y el numero pinta el precio en vivo
  await coloca(71000);
  const arr = await p.evaluate(() => {
    const h = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id)); const g = h._grupo;
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x0: Math.round(r.x + g.x + 10), y0: Math.round(r.y + g.y + g.h / 2), precio: h.price };
  });
  await p.mouse.move(arr.x0, arr.y0); await ESP(80);
  await p.mouse.down(); await ESP(60);
  await p.mouse.move(arr.x0, arr.y0 + 26, { steps: 6 }); await ESP(120);
  out.enVivo = await p.evaluate(() => ({ arrastrando: !!(DT.drag && DT.drag.tradeHandle),
    ultimoPrecio: DT.drag && DT.drag.lastPrice, pendientes: (TE.state.pending || []).length }));
  await p.mouse.up(); await ESP(500);
  out.arrastre = await p.evaluate((a) => ({ antes: a.precio, ahora: (TE.state.pending[0] || {}).limitPrice,
    pendientes: (TE.state.pending || []).length, posiciónDelNumero: (() => {
      const h = (DT.tradeHandles || []).find((z) => /^limit:/.test(z.id));
      return h && h._grupo ? Math.round(h._grupo.y) : null; })() }), arr);
  out.errores = errs;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
