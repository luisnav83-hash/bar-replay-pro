/* =========================================================================
 * orderTemplates.js — PLANTILLAS DE ORDEN (zona 4 del terminal Bitunix)
 *
 * El guía del exchange (`chart-trading-custom-trading-templates`) describe una fila de
 * plantillas dentro del panel de órdenes: guardan la configuración que uno repite
 * (apalancamiento, modo de margen, tamaño y las distancias de SL/TP) y se aplican de un toque.
 *
 * CUATRO DECISIONES que no son capricho:
 *
 *  1. SE GUARDAN PORCENTAJES, NO PRECIOS. El replay cambia el precio cada vela: una plantilla
 *     con «SL 63 400» deja de significar nada en la vela 900. Lo que sobrevive es «SL 1 %», que
 *     es lo que guarda el exchange. `slPct`/`tpPct` se DERIVAN del precio actual al guardar y se
 *     reconvierten a precio al aplicar con la MISMA fórmula de los atajos `#quickSlTp`
 *     (js/uiController.js): `precio · (1 ∓ pct/100)` redondeado a 6. No hay segunda versión.
 *
 *  2. SE APLICA PULSANDO CONTROLES, NO ESCRIBIENDO ESTADO. `TE.setMarginMode`, `App.sizeMode` o
 *     `TE.configure` son la verdad del motor, pero el formulario tiene listeners que sincronizan
 *     la clase activa, el deslizador heredado, la etiqueta del tamaño, el coste y las líneas del
 *     gráfico. Saltárselos deja una UI mintiendo —el defecto clásico de «guardar/estado»—.
 *     Aplicar = `click()` en los segmentados y en el chip de fracción, `input` en el deslizador
 *     y en los campos. Es el mismo camino que prueban `tests/bitunix.test.js` y la nueva
 *     `tests/plantillas.test.js` a base de ratón.
 *
 *  3. NINGÚN MÓDULO GLOBAL SE CAPTURA EN LA CARGA. `js/app.js` va DESPUÉS de este script, así
 *     que `const App = global.App` se llevaba `undefined` y el fallo era SILENCIOSO Y PEOR que un
 *     error: `currentPrice()` no existía, el precio salía 0, `pctDe` devolvía `null` y la
 *     plantilla se guardaba sin SL/TP con un nombre mentiroso («1x · 100 %» en vez de
 *     «20x · 50 % · SL 1 % · TP 2 %»). Cero rojos, cero avisos: lo cazó el test comparando la
 *     ETIQUETA del chip. Por eso todo se resuelve al llamar: `App()`, `U()`, `ST()`, `UI()`.
 *
 *  4. LA FILA VIVE DENTRO DE «AVANZADO». El contrato del teléfono es que en REPOSO entre todo lo
 *     esencial sin deslizar (221 px de caja medidos, y `test:layout` lo defiende): una fila de
 *     26 px aquí lo rompería. En escritorio «Avanzado» está siempre visible, así que no se esconde
 *     de nadie con sitio.
 *
 * Persistencia: `ST` (js/storage.js, prefijo `brp_`), clave `plantillas`. Máximo `MAX`: la fila
 * desliza, pero seis es lo que se lee de un vistazo en un móvil; al séptimo intento se avisa y el
 * botón se desactiva, en vez de pisar una plantilla de alguien.
 * =======================================================================*/
(function (global) {
  'use strict';

  const OT = {};
  const LS = 'plantillas';
  const MAX = 6;
  OT.MAX = MAX;

  // (Decisión 3) accesores, no capturas: los módulos de al lado pueden cargar antes o después.
  const U = () => global.U;
  const ST = () => global.ST;
  const App = () => global.App;
  const UI = () => global.UI;

  const $ = (id) => document.getElementById(id);
  const activo = (sel) => document.querySelector(sel + ' .seg-btn.active') || document.querySelector(sel + ' .active');
  const num = (id) => { const e = $(id); const v = e ? parseFloat(e.value) : NaN; return Number.isFinite(v) ? v : null; };
  const precioActual = () => { const a = App(); return (a && a.currentPrice) ? a.currentPrice() : 0; };

  OT.lista = function () {
    const st = ST();
    const l = st && st.get ? st.get(LS, []) : [];
    return Array.isArray(l) ? l : [];
  };
  OT._guardar = function (l) { const st = ST(); if (st && st.set) st.set(LS, l); };

  /** Estado del formulario, leído de la UI (decisión 2). */
  OT.estado = function () {
    const precio = precioActual();
    // `U.round(x, 4)`: cuatro decimales de porcentaje —a 2, SL 0,5 % y SL 0,54 % serían la misma
    // plantilla, y la comparación de duplicados de abajo trabaja con el nombre.
    const pctDe = (valor) => (precio && valor ? U().round(Math.abs(valor - precio) / precio * 100, 4) : null);
    const chip = document.querySelector('#quickSize .active');
    return {
      mm: (activo('#segMarginMode') || { dataset: {} }).dataset.mm || 'cross',
      lev: num('levRange') || 1,
      otype: (activo('#segOrderType') || { dataset: {} }).dataset.otype || 'market',
      sizeMode: (activo('#segSize') || { dataset: {} }).dataset.mode || 'pct',
      sizeVal: num('sizeInput'),
      sizePct: chip ? +chip.dataset.pct : null,
      slPct: pctDe(num('slInput')),
      tpPct: pctDe(num('tpInput')),
    };
  };

  /** Nombre legible en el chip: lo que uno lee antes de tocar. */
  OT.nombre = function (t) {
    const unidad = t.sizeMode === 'notional' ? 'USD' : t.sizeMode === 'qty' ? 'qty' : '%';
    const partes = [t.lev + 'x', (t.sizeVal === null || t.sizeVal === undefined ? '—' : t.sizeVal + ' ' + unidad)];
    if (t.mm === 'isolated') partes.push('aislado');
    if (t.slPct) partes.push('SL ' + t.slPct + ' %');
    if (t.tpPct) partes.push('TP ' + t.tpPct + ' %');
    if (t.otype === 'limite') partes.push('límite');
    return partes.join(' · ');
  };

  /** Aplica una plantilla pulsando lo que haya que pulsar. */
  OT.aplicar = function (t) {
    if (!t) return false;
    const escribir = (id, valor) => {
      const e = $(id); if (!e) return;
      e.value = (valor === null || valor === undefined) ? '' : String(valor);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // 1 · modo de margen y tipo de orden, por su botón
    const mm = document.querySelector('#segMarginMode [data-mm="' + (t.mm || 'cross') + '"]');
    if (mm && !mm.classList.contains('active')) mm.click();
    const ot = document.querySelector('#segOrderType [data-otype="' + (t.otype || 'market') + '"]');
    if (ot && !ot.classList.contains('active')) ot.click();
    // 2 · apalancamiento: el deslizador es la fuente (UI.syncLeverage actualiza select y motor)
    const r = $('levRange');
    if (r && +r.value !== t.lev) { r.value = String(t.lev); r.dispatchEvent(new Event('input', { bubbles: true })); }
    // 3 · unidad del tamaño y tamaño
    const sm = document.querySelector('#segSize [data-mode="' + (t.sizeMode || 'pct') + '"]');
    if (sm && !sm.classList.contains('active')) sm.click();
    const chip = (t.sizePct === null || t.sizePct === undefined)
      ? null : document.querySelector('#quickSize [data-pct="' + t.sizePct + '"]');
    if (chip) chip.click();            // el chip recalcula el campo según el modo activo
    else escribir('sizeInput', t.sizeVal);
    // 4 · SL/TP: del porcentaje al precio de AHORA (decisión 1)
    const precio = precioActual();
    if (!precio && (t.slPct || t.tpPct)) {
      U().toast('Sin precio todavía: se ha aplicado el tamaño y el apalancamiento; pulsa de nuevo la plantilla cuando carguen los datos', 'warn');
    }
    escribir('slInput', t.slPct && precio ? U().round(precio * (1 - t.slPct / 100), 6) : null);
    escribir('tpInput', t.tpPct && precio ? U().round(precio * (1 + t.tpPct / 100), 6) : null);
    const ui = UI();
    if (ui && ui.updateOrderHint) ui.updateOrderHint();
    U().log('📋 Plantilla aplicada: ' + OT.nombre(t), 'sys');
    return true;
  };

  OT.guardar = function () {
    const l = OT.lista();
    const t = OT.estado();
    const nombre = OT.nombre(t);
    if (l.some((x) => x.nombre === nombre)) {
      U().toast('Esa configuración ya está guardada («' + nombre + '»)');
      OT.pintar();
      return false;
    }
    if (l.length >= MAX) {
      U().toast('Máximo ' + MAX + ' plantillas: borra una para guardar otra', 'warn');
      return false;
    }
    // La nueva va PRIMERA: es la que uno acaba de crear y la que quiere tocar.
    l.unshift(Object.assign({ id: Date.now().toString(36), nombre: nombre }, t));
    OT._guardar(l);
    OT.pintar();
    U().toast('Plantilla guardada: ' + nombre, 'ok');
    return true;
  };

  OT.borrar = function (id) {
    const l = OT.lista();
    const t = l.find((x) => x.id === id);
    OT._guardar(l.filter((x) => x.id !== id));
    OT.pintar();
    if (t) U().log('🗑 Plantilla borrada: ' + t.nombre, 'sys');
  };

  /** Enciende los degradados de los bordes según dónde esté el deslizamiento. */
  OT.marcaMas = function () {
    const caja = $('bfTplList'), wrap = $('bfTplDesl');
    if (!caja || !wrap) return;
    const max = caja.scrollWidth - caja.clientWidth;      // px que quedan por deslizar
    const mas = max > 2 && caja.scrollLeft < max - 2;     // ¿asoma algo por la derecha?
    wrap.dataset.mas = mas ? '1' : '0';
    wrap.dataset.menos = (caja.scrollLeft > 2 && max > 2) ? '1' : '0';
  };

  /** Pinta la fila. Se llama al iniciar y tras cada guardar/borrar. */
  OT.pintar = function () {
    const caja = $('bfTplList'); if (!caja) return;
    const l = OT.lista();
    caja.textContent = '';
    if (!l.length) {
      const s = document.createElement('span');
      s.className = 'bf-tpl-vacio';
      s.textContent = 'Sin plantillas: pulsa ＋ para guardar apalancamiento, tamaño y SL/TP';
      caja.appendChild(s);
    }
    l.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bf-tpl-chip';
      b.dataset.id = t.id;
      b.textContent = t.nombre || OT.nombre(t);
      b.title = 'Aplicar: ' + (t.nombre || OT.nombre(t));
      caja.appendChild(b);
      // La ✕ va HERMANA al chip, no dentro: un <button> no puede anidar otro <button> y el
      // navegador lo arregla sacándolo de sitio, con lo que el clic se iba a aplicar.
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'bf-tpl-del';
      x.dataset.id = t.id;
      x.textContent = '✕';
      x.setAttribute('aria-label', 'Borrar la plantilla ' + (t.nombre || OT.nombre(t)));
      x.title = 'Borrar plantilla';
      caja.appendChild(x);
    });
    const guardar = $('btnTplGuardar');
    if (guardar) {
      guardar.disabled = l.length >= MAX;
      guardar.title = l.length >= MAX
        ? 'Máximo ' + MAX + ' plantillas: borra una primero'
        : 'Guardar la configuración actual como plantilla';
    }
    const raiz = $('bfTpl');
    if (raiz) raiz.dataset.n = String(l.length);
    // Tras pintar, el navegador aún no ha medido: se marca en el siguiente frame o el
    // `scrollWidth` sería el de la fila vacía y el degradado no aparecería hasta el primer gesto.
    if (global.requestAnimationFrame) global.requestAnimationFrame(OT.marcaMas); else OT.marcaMas();
  };

  OT.init = function () {
    if (!document.getElementById('bfTpl')) return false;
    OT.pintar();
    const g = $('btnTplGuardar');
    if (g) g.addEventListener('click', OT.guardar);
    // Delegación: los chips se crean y se borran, así que el listener vive en la lista.
    const caja = $('bfTplList');
    caja.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-id]') : null;
      if (!b) return;
      if (b.classList.contains('bf-tpl-del')) OT.borrar(b.dataset.id);
      else OT.aplicar(OT.lista().find((x) => x.id === b.dataset.id));
    });
    caja.addEventListener('scroll', OT.marcaMas, { passive: true });
    global.addEventListener('resize', OT.marcaMas);
    return true;
  };

  global.OT = OT;
})(typeof window !== 'undefined' ? window : globalThis);
