/* Sonda funcional del §5.9: recorre el menu de la linea (disco + -> billete en modo edicion -> ✓ que
   recoloca, fila roja que cancela, y el mismo gesto sobre el nivel SL). Queda commiteada porque es la
   manera de ver el flujo entero sin leer las 17 anclas de tests/bitunix.test.js (bloque K) y porque
   revela las trampas de montaje: el disco vive en el lienzo (pointer-events), hay que apartar la
   herramienta de dibujo y el formulario tiene que estar en el tipo que se quiere colocar.
   Uso: node tools/sonda-5-9.js   (necesita el build: node tools/build-single.js) */
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

  // 1) colocar una pendiente con el billete (herramienta «orden» + arrastre)
  await p.click('[data-tool="orden"]');
  const c = await p.evaluate(() => { const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: Math.round(r.x + r.width * 0.5), y: Math.round(r.y + r.height * 0.45) }; });
  await p.mouse.click(c.x, c.y); await ESP(350);
  out.billete1 = await p.evaluate(() => ({ abierto: !document.getElementById('bfBillete').hidden,
    precio: document.getElementById('bfBilletePrecio').value }));
  await p.evaluate(() => { document.getElementById('bfBilleteOk').click(); }); await ESP(600);
  out.pendiente = await p.evaluate(() => (TE.state.pending || []).map((o) => ({ id: o.id, side: o.side, limitPrice: o.limitPrice })));

  // 2) el disco + de la linea de la pendiente (con la herramienta de dibujo apartada, como la ×)
  await p.click('[data-tool="cursor"]'); await ESP(200);
  out.discos = await p.evaluate(() => (DT._cajasPlus || []).map((k) => ({ id: k.id, w: k.w, h: k.h, x: k.x })));
  out.lienzo = await p.evaluate(() => Math.round(document.getElementById('overlayCanvas').getBoundingClientRect().width));
  console.log('PARCIAL', JSON.stringify(out, null, 1).slice(0, 900));
  const clicDisco = await p.evaluate(() => {
    const k = (DT._cajasPlus || []).find((x) => /^limit:/.test(x.id)); if (!k) return null;
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: Math.round(r.x + k.x + k.w / 2), y: Math.round(r.y + k.y + k.h / 2) };
  });
  if (!clicDisco) { console.log('SIN DISCO', JSON.stringify(await p.evaluate(() => ({ plus: (DT._cajasPlus||[]).map(k=>k.id), pend: (TE.state.pending||[]).map(o=>o.id), handles: (DT.tradeHandles||[]).map(h=>h.id) })))); process.exit(2); }
  await p.mouse.click(clicDisco.x, clicDisco.y); await ESP(350);
  out.edicion = await p.evaluate(() => ({
    abierto: !document.getElementById('bfBillete').hidden,
    editar: JSON.parse(JSON.stringify(UI.billete.editar || null)),
    precio: document.getElementById('bfBilletePrecio').value,
    qty: document.getElementById('bfBilleteQty').value,
    cancela: (() => { const e = document.getElementById('bfBilleteCancela');
      return { oculto: e.hidden, texto: e.textContent, caja: (r => ({ w: Math.round(r.width), h: Math.round(r.height) }))(e.getBoundingClientRect()),
        color: getComputedStyle(e).color } })(),
    chips: [...document.querySelectorAll('#bfBilleteChips .bf-chip')].map((c) => c.textContent.trim()),
    rielOculto: document.querySelector('.bf-billete-riel').hidden,
    panel: (() => { const e = document.getElementById('bfBillete'); const c = getComputedStyle(e);
      return { ancho: Math.round(e.getBoundingClientRect().width), fondo: c.backgroundColor }; })(),
  }));

  // 3) editar el precio: el ✓ retira la antigua y coloca la nueva, el numero no cambia
  await p.evaluate(() => { document.getElementById('bfBilletePrecio').value = '71500';
    document.getElementById('bfBilletePrecio').dispatchEvent(new Event('input', { bubbles: true })); });
  await p.evaluate(() => { document.getElementById("bfBilleteOk").click(); }); await ESP(700);
  out.trasEditar = await p.evaluate(() => ({ pendientes: (TE.state.pending || []).map((o) => o.limitPrice),
    cerrado: document.getElementById('bfBillete').hidden }));

  // 4) posición con SL/TP: el disco del SL abre el billete en modo nivel (sin tamano)
  await p.keyboard.press('Escape'); await ESP(150);
  await p.evaluate(() => {
    UI.setOrderType('market');
    document.getElementById('limitInput').value = '';
    const chk = document.getElementById('chkTpSl'); if (!chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
    document.getElementById('sizeInput').value = 100;
    document.getElementById('sizeInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-slpct="1"]').click();
    document.querySelector('[data-tppct="2"]').click();
    document.getElementById('btnLong').click();
  });
  await ESP(500);
  out.pos = await p.evaluate(() => (TE.state.position ? { sl: TE.state.position.sl, tp: TE.state.position.tp } : null));
  out.discos2 = await p.evaluate(() => (DT._cajasPlus || []).map((k) => k.id).join(','));
  const clicSL = await p.evaluate(() => {
    const k = (DT._cajasPlus || []).find((x) => x.id === 'sl'); if (!k) return null;
    const r = document.getElementById('overlayCanvas').getBoundingClientRect();
    return { x: Math.round(r.x + k.x + k.w / 2), y: Math.round(r.y + k.y + k.h / 2) };
  });
  if (!clicSL) { console.log('SIN DISCO SL', JSON.stringify(await p.evaluate(() => ({ plus: (DT._cajasPlus||[]).map(k=>k.id), pos: !!TE.state.position, sl: TE.state.position&&TE.state.position.sl, handles: (DT.tradeHandles||[]).map(h=>h.id) })))); process.exit(3); }
  await p.mouse.click(clicSL.x, clicSL.y); await ESP(350);
  out.nivel = await p.evaluate(() => ({
    editar: (UI.billete.editar || {}).tipo,
    cancela: document.getElementById('bfBilleteCancela').textContent,
    campoTapHidden: [...document.querySelectorAll('#bfBillete .bf-billete-campo')][1].hidden,
    chipsHidden: document.getElementById('bfBilleteChips').hidden,
    precio: document.getElementById('bfBilletePrecio').value,
  }));
  await p.evaluate(() => { const e = document.getElementById('bfBilletePrecio'); e.value = String(Math.round(TE.state.position.entryPrice * 0.985 * 100) / 100);
    e.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('bfBilleteOk').click(); });
  await ESP(300);
  out.slMovido = await p.evaluate(() => ({ sl: TE.state.position && TE.state.position.sl,
    entrada: TE.state.position && TE.state.position.entryPrice, cerrado: document.getElementById('bfBillete').hidden }));
  out.errores = errs;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch((e) => { console.log('ERR', String(e).slice(0, 300)); process.exit(1); });
