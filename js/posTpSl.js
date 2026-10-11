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

  PD.confirmar = function () {
    const p = TE.state.position; if (!p) return false;
    const pedidos = [['tp', TE.setTP], ['sl', TE.setSL]];
    let algunoFallo = false, cambios = 0;
    for (const [k, fn] of pedidos) {
      const L = K[k];
      const txt = $('pd' + L + 'Precio').value.trim();
      const actual = p[k] || null;
      if (txt === '') {                                   // vacío = quitar el nivel (si lo había)
        if (actual !== null) { fn.call(TE, null); cambios++; }
        continue;
      }
      const precio = +txt;
      if (!Number.isFinite(precio) || precio <= 0) { U.toast(`${k.toUpperCase()}: el precio no es válido`, 'warn'); algunoFallo = true; continue; }
      if (actual !== null && Math.abs(precio - actual) < 1e-9) continue;   // sin cambios: no se toca
      if (fn.call(TE, precio)) cambios++; else algunoFallo = true;
    }
    if (!algunoFallo) { UI.closeModal('modalPosTpSl'); if (cambios) U.toast('TP/SL actualizados', 'info'); }
    return !algunoFallo;
  };

  function enlaza() {
    const b = $('btnPosTpSl');
    if (b) b.addEventListener('click', () => { PD.abrir(); UI.openModal('modalPosTpSl'); });
    ['tp', 'sl'].forEach((k) => {
      const L = K[k];
      $('pd' + L + 'Precio').addEventListener('input', () => sincroniza(k, 'precio'));
      $('pd' + L + 'Roi').addEventListener('input', () => sincroniza(k, 'roi'));
      $('pd' + L + 'Rango').addEventListener('input', () => sincroniza(k, 'rango'));
    });
    document.querySelectorAll('[data-quitar]').forEach((btn) => btn.addEventListener('click', () => pintaFila(btn.dataset.quitar, null)));
    const c = $('pdConfirmar'); if (c) c.addEventListener('click', () => PD.confirmar());
  }

  PD.enlaza = enlaza;
  global.PosTpSl = PD;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enlaza); else enlaza();
})(typeof window !== 'undefined' ? window : globalThis);
