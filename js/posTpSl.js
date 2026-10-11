/* TP/SL de la posición completa (pestaña «Posición» del diálogo de Bitunix).
 * Solo hace de puente entre el diálogo y el motor: los niveles se fijan con TE.setTP y TE.setSL,
 * que ya validan el lado y dejan el nivel en la carta. Retorno = % sobre el MARGEN:
 *   precio = entrada · (1 ± retorno / 100 / apalancamiento)   (+ en LONG, − en SHORT)
 * El PnL que se muestra es BRUTO (sin comisiones), y así se rotula. */
(function (global) {
  const PD = {};
  const $ = (id) => document.getElementById(id);
  const K = { tp: 'Tp', sl: 'Sl' };
  const RANGO = { tp: [0, 300], sl: [-100, 0] };      // retorno en % del margen que cubre el deslizador

  const dirOf = (p) => (p.side === 'long' ? 1 : -1);
  const levOf = (p) => (Number.isFinite(+p.leverage) && +p.leverage > 0 ? +p.leverage : 1);
  const precioDeRoi = (p, roi) => p.entryPrice * (1 + dirOf(p) * (roi / 100) / levOf(p));
  const roiDePrecio = (p, precio) => dirOf(p) * (precio / p.entryPrice - 1) * levOf(p) * 100;
  const numOrNull = (el) => { const v = el.value.trim(); if (v === '') return null; const n = +v; return Number.isFinite(n) ? n : NaN; };

  /* Rellena precio, retorno y deslizador de una fila a partir de uno de los tres. Origen: 'precio' | 'roi' | 'rango' | null */
  function sincroniza(k, origen) {
    const p = TE.state.position; if (!p) return;
    const L = K[k], [min, max] = RANGO[k];
    let precio = null, roi = null;
    if (origen === 'precio') {
      precio = numOrNull($('pd' + L + 'Precio'));
      if (precio !== null && Number.isFinite(precio) && precio > 0) roi = roiDePrecio(p, precio);
    } else if (origen === 'roi' || origen === 'rango') {
      roi = origen === 'rango' ? +$('pd' + L + 'Rango').value : numOrNull($('pd' + L + 'Roi'));
      if (roi !== null && Number.isFinite(roi)) precio = precioDeRoi(p, roi);
    }
    if (origen !== 'precio') $('pd' + L + 'Precio').value = precio !== null && Number.isFinite(precio) ? precio.toFixed(2) : '';
    if (origen !== 'roi') $('pd' + L + 'Roi').value = roi !== null && Number.isFinite(roi) ? roi.toFixed(2) : '';
    if (origen !== 'rango') {
      const r = roi !== null && Number.isFinite(roi) ? Math.min(max, Math.max(min, roi)) : 0;
      $('pd' + L + 'Rango').value = String(r);
    }
    const pnl = precio !== null && Number.isFinite(precio) && precio > 0 ? TE.pnlBrutoEn(precio, p) : null;
    $('pd' + L + 'Pnl').textContent = pnl === null ? '—' : U.fmtMoney(pnl, true);
    $('pd' + L + 'Cambio').textContent = precio === null || !Number.isFinite(precio) || precio <= 0 ? '—'
      : U.fmtPct(((precio - p.entryPrice) / p.entryPrice) * 100, 2, true);
  }

  function pintaFila(k, nivel) {
    const L = K[k];
    $('pd' + L + 'Precio').value = nivel ? (+nivel).toFixed(2) : '';
    sincroniza(k, nivel ? 'precio' : null);
    if (!nivel) { $('pd' + L + 'Roi').value = ''; $('pd' + L + 'Rango').value = '0'; $('pd' + L + 'Pnl').textContent = '—'; $('pd' + L + 'Cambio').textContent = '—'; }
  }

  PD.abrir = function () {
    PD._salirRevision();
    const p = TE.state.position;
    const sinPos = !p;
    $('pdInfo').textContent = sinPos ? 'No hay posición abierta: abre una para fijar su TP/SL.'
      : `${p.side === 'long' ? 'LONG' : 'SHORT'} · ${levOf(p)}X · entrada ${U.fmtPrice(p.entryPrice)} · ${U.num(p.qty, 6)} ${App.baseAsset()}`;
    ['pdTpPrecio', 'pdTpRoi', 'pdTpRango', 'pdSlPrecio', 'pdSlRoi', 'pdSlRango', 'pdConfirmar'].forEach((id) => { $(id).disabled = sinPos; });
    document.querySelectorAll('[data-quitar]').forEach((b) => { b.disabled = sinPos; });
    if (sinPos) { pintaFila('tp', null); pintaFila('sl', null); return; }
    pintaFila('tp', p.tp || null);
    pintaFila('sl', p.sl || null);
  };

  /* Revisión final (como el «Confirm» de Bitunix): primer pulsar «Confirmar» muestra el resumen de lo
     que va a cambiar; «Aplicar» lo fija en el motor. Cualquier edición vuelve al paso de edición. */
  PD._enRevision = false;
  PD._salirRevision = function () {
    PD._enRevision = false;
    const r = $('pdRevision'); if (r) { r.hidden = true; r.textContent = ''; }
    const c = $('pdConfirmar'); if (c) c.textContent = 'Confirmar';
    const v = $('pdVolver'); if (v) v.hidden = true;
  };

  PD._plan = function (p) {
    const items = [], errores = [];
    for (const k of ['tp', 'sl']) {
      const L = K[k], txt = $('pd' + L + 'Precio').value.trim(), actual = p[k] || null;
      if (txt === '') { if (actual !== null) items.push({ k, quitar: true }); continue; }
      const precio = +txt;
      if (!Number.isFinite(precio) || precio <= 0) { errores.push(`${k.toUpperCase()}: el precio no es válido`); continue; }
      if (actual !== null && Math.abs(precio - actual) < 1e-9) continue;
      items.push({ k, precio, pnl: TE.pnlBrutoEn(precio, p) });
    }
    return { items, errores };
  };

  PD.confirmar = function () {
    const p = TE.state.position; if (!p) return false;
    const plan = PD._plan(p);
    if (plan.errores.length) { plan.errores.forEach((e) => U.toast(e, 'warn')); return false; }
    if (!plan.items.length) { PD._salirRevision(); UI.closeModal('modalPosTpSl'); return true; }
    if (!PD._enRevision) {                               // paso 1: resumen
      const r = $('pdRevision');
      r.textContent = 'Se va a aplicar: ' + plan.items.map((it) => it.quitar
        ? `quitar el ${it.k.toUpperCase()}`
        : `${it.k.toUpperCase()} en ${U.fmtPrice(it.precio)} (PnL bruto ${U.fmtMoney(it.pnl, true)})`).join(' · ');
      r.hidden = false;
      $('pdConfirmar').textContent = 'Aplicar';
      $('pdVolver').hidden = false;
      PD._enRevision = true;
      return false;
    }
    // paso 2: aplicar. Cada cambio pasa por el motor, que valida el lado.
    const fallos = [];
    for (const it of plan.items) {
      const ok = it.quitar
        ? (it.k === 'tp' ? TE.setTP(null) : TE.setSL(null))
        : (it.k === 'tp' ? TE.setTP(it.precio) : TE.setSL(it.precio));
      if (!ok) fallos.push(it.k.toUpperCase());
    }
    if (fallos.length) { U.toast(`No se pudo fijar ${fallos.join(' ni ')}: revisa el precio`, 'warn'); PD._salirRevision(); return false; }
    PD._salirRevision();
    UI.closeModal('modalPosTpSl');
    U.toast('TP/SL actualizados', 'info');
    return true;
  };

  function enlaza() {
    const b = $('btnPosTpSl');
    if (b) b.addEventListener('click', () => { PD.abrir(); UI.openModal('modalPosTpSl'); });
    ['tp', 'sl'].forEach((k) => {
      const L = K[k];
      $('pd' + L + 'Precio').addEventListener('input', () => { PD._salirRevision(); sincroniza(k, 'precio'); });
      $('pd' + L + 'Roi').addEventListener('input', () => { PD._salirRevision(); sincroniza(k, 'roi'); });
      $('pd' + L + 'Rango').addEventListener('input', () => { PD._salirRevision(); sincroniza(k, 'rango'); });
    });
    document.querySelectorAll('[data-quitar]').forEach((btn) => btn.addEventListener('click', () => { PD._salirRevision(); pintaFila(btn.dataset.quitar, null); }));
    const v = $('pdVolver'); if (v) v.addEventListener('click', () => PD._salirRevision());
    const c = $('pdConfirmar'); if (c) c.addEventListener('click', () => PD.confirmar());
  }

  PD.enlaza = enlaza;
  global.PosTpSl = PD;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enlaza); else enlaza();
})(typeof window !== 'undefined' ? window : globalThis);
