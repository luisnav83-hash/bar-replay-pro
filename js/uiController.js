/* =========================================================================
 * uiController.js — Todo el cableado de la interfaz:
 *   · Eventos de la barra superior, paneles, modales y atajos de teclado
 *   · Refresco de la barra lateral (cuenta, posición, estadísticas)
 *   · Tabla de trades, log, lista de dibujos, sesiones y exportaciones
 *   · Captura de pantalla compuesta y modales
 * Las acciones que implican lógica de negocio se delegan en `App`.
 * =======================================================================*/
(function (global) {
  'use strict';

  const UI = {};

  /* ------------------------- Utilidades de formulario ------------------------- */

  const val = (id) => { const e = document.getElementById(id); return e ? e.value : null; };
  const numv = (id, d = 0) => { const v = parseFloat(val(id)); return Number.isFinite(v) ? v : d; };
  const setText = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  const setPnl = (id, value) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.textContent = typeof value === 'string' ? value : U.fmtMoney(value, true);
    e.classList.toggle('up', typeof value === 'number' ? value > 0 : false);
    e.classList.toggle('down', typeof value === 'number' ? value < 0 : false);
  };

  /* ================================= INICIO ================================= */

  /* El LIBRO cambia de contenedor con el ancho, como en el sitio. Medido en su DOM a 1600 px:
     el libro es una columna propia de ~300 px (x≈1004) y el panel de órdenes va a su derecha
     (x=1311, 272 px); por debajo de ese ancho el nuestro no puede permitirse los 300 px —le
     roba el alto al gráfico y la escalera desborda sus propios paneles (secciones J de
     tests/pnl-chart.test.js y los tiers de tests/responsive.test.js)—, así que el libro vuelve
     a lo alto de #sidebar, donde el tier de la franja ya sabe desplazarse en horizontal.
     Se MUEVE el nodo, no se duplica: los ids tienen que seguir siendo únicos (lo comprueba
     tests/bitunix.test.js) y js/orderBook.js pinta por id, así que no le importa en qué columna
     está. La primera versión de esto era solo CSS (`#bookCol { display:none }` debajo del corte)
     y el resultado era que en tablet y teléfono el libro DESAPARECÍA; lo cazó la suite. */
  UI.ubicarLibro = function () {
    const bk = document.getElementById('bookCard');
    const col = document.getElementById('bookCol');
    const sb = document.getElementById('sidebar');
    if (!bk || !col || !sb) return;
    const ancho = window.matchMedia('(min-width: 1360px)');
    const enColumna = col.contains(bk);
    if (ancho.matches && !enColumna) col.appendChild(bk);
    else if (!ancho.matches && enColumna) sb.insertBefore(bk, sb.firstElementChild);
  };
  try {
    window.matchMedia('(min-width: 1360px)').addEventListener('change', () => UI.ubicarLibro());
  } catch (e) { /* MediaQueryList sin addEventListener: basta con la llamada del arranque */ }

  UI.init = function () {
    UI.ubicarLibro();
    UI._wireTopbar();
    UI._wireToolbar();
    UI._wireReplay();
    UI._wireSidebar();
    UI._wireBottom();
    UI._wireModals();
    UI._wireKeyboard();
    UI._wireEvents();

    // Estado inicial de los paneles y modales
    UI.syncIndicatorModalFromConfig(App.indicators);
    UI.setPlaying(false);
    UI._closedCount = 0;
    UI._histSig = null;   // forma del historial: cerrados + filas + entradas de la abierta + liquidaciones
    UI.refreshAll();
    UI.refreshStats(true);
    UI.renderSessions();
    DT.renderList(document.getElementById('drawList'));
  };

  /* -------------------------------- Barra superior -------------------------------- */

  UI._wireTopbar = function () {
    document.getElementById('btnLoad').addEventListener('click', () => App.loadDataFromForm());
    document.getElementById('btnQuick').addEventListener('click', () => App.quickPractice());
    document.getElementById('btnDemo').addEventListener('click', () => { UI.hideLoader(); App.loadDemo(); });
    document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileCsv').click());
    document.getElementById('fileCsv').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => App.importCSV(r.result, f.name);
      r.readAsText(f);
      e.target.value = '';
    });
    document.getElementById('btnIndicators').addEventListener('click', () => UI.openModal('modalIndicators'));
    document.getElementById('btnPanelsConfig').addEventListener('click', () => UI.openModal('modalIndicators'));
    document.getElementById('btnSessions').addEventListener('click', () => { UI.renderSessions(); UI.openModal('modalSessions'); });
    document.getElementById('btnExport').addEventListener('click', () => UI.openModal('modalExport'));
    document.getElementById('btnShot').addEventListener('click', () => App.screenshot());
    // Solo rellenaba los campos: el ⚙️ de la barra NO abría el modal, así que
    // «Ajustes» parecía no hacer nada (salió al probar la app publicada, no la suite).
    // Es openModal el que abre y además rellena, no al revés: al revés hay recursión.
    document.getElementById('btnSettings').addEventListener('click', () => UI.openModal('modalSettings'));
    document.getElementById('btnHelp').addEventListener('click', () => UI.openModal('modalHelp'));

    // Cambiar de par o temporalidad no recarga solo: avisa al usuario
    // El par se cambia con el buscador o con el desplegable, y en ambos casos
    // la carga es inmediata.
    document.getElementById('pairSelect').addEventListener('change', (e) => {
      UI.pickSymbol(e.target.value);
    });
    // Cambiar la temporalidad en el desplegable recarga los datos al instante
    // (igual que los botones rápidos): así nunca queda el select diciendo una
    // temporalidad y el gráfico mostrando otra.
    document.getElementById('tfSelect').addEventListener('change', (e) => {
      UI.setTimeframe(e.target.value, { force: true });
    });
  };

  /* ------------------------------- Dibujo ------------------------------- */

  UI._wireToolbar = function () {
    U.$$('#drawToolbar .tool[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => { DT.setTool(btn.dataset.tool); U.playSound('click'); });
    });
    document.getElementById('drawColor').addEventListener('input', (e) => DT.setStyle({ color: e.target.value }));
    document.getElementById('drawWidth').addEventListener('change', (e) => DT.setStyle({ width: +e.target.value }));
    document.getElementById('drawStyle').addEventListener('change', (e) => DT.setStyle({ style: e.target.value }));
    document.getElementById('btnDeleteDrawing').addEventListener('click', () => DT.deleteSelected());
    document.getElementById('btnClearDrawings').addEventListener('click', () => DT.clearAll());
    document.getElementById('btnSnap').addEventListener('click', () => DT.toggleSnap());
    /* Candado y ojo del riel: el estado se enseña en el propio botón (aria-pressed y el icono). */
    document.getElementById('btnLockDrawings').addEventListener('click', (e) => {
      const on = DT.toggleLock();
      e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false');
      e.currentTarget.textContent = on ? '🔒' : '🔓';
    });
    document.getElementById('btnHideDrawings').addEventListener('click', () => DT.toggleAllHidden());

    document.getElementById('btnAutoScale').addEventListener('click', (e) => {
      const on = !UI._autoScale;
      UI._autoScale = CM.setAutoScale(on);
      e.currentTarget.classList.toggle('active', !UI._autoScale);
      U.toast(UI._autoScale ? '📐 Escala de precios automática' : '📐 Escala de precios MANUAL: arrastra el eje derecho para ajustar', 'info', 2200);
    });
    UI._autoScale = true;

    document.getElementById('btnLogScale').addEventListener('click', (e) => {
      UI._logScale = !UI._logScale;
      CM.setLogScale(UI._logScale);
      e.currentTarget.classList.toggle('active', UI._logScale);
      U.toast(UI._logScale ? 'Escala logarítmica activada' : 'Escala lineal activada', 'info', 1600);
    });
    UI._logScale = false;

    document.getElementById('chkLockScroll').addEventListener('change', (e) => {
      const lock = e.target.checked;
      CM.main.applyOptions({
        handleScroll: { mouseWheel: !lock, pressedMouseMove: !lock, horzTouchDrag: !lock, vertTouchDrag: false },
        handleScale: !lock,
      });
      U.toast(lock ? '🔒 Scroll/zoom del gráfico bloqueado' : 'Scroll/zoom desbloqueado', 'info', 1600);
    });

    // Cerrar paneles de indicadores desde su botón ✕
    U.$$('[data-close-pane]').forEach((b) => b.addEventListener('click', () => {
      const p = b.dataset.closePane;
      App.indicators[p].on = false;
      document.getElementById('ind' + p.charAt(0).toUpperCase() + p.slice(1)).checked = false;
      App.applyIndicators(App.indicators);
      U.log(`👁 Panel ${p.toUpperCase()} ocultado`, 'sys');
    }));
  };

  /* -------------------------------- Replay -------------------------------- */

  UI._wireReplay = function () {
    document.getElementById('btnPlay').addEventListener('click', () => App.togglePlay());
    document.getElementById('btnStepFwd').addEventListener('click', () => App.stepForward());
    document.getElementById('btnStepBack').addEventListener('click', () => App.stepBack());
    document.getElementById('btnReset').addEventListener('click', () => App.resetReplay());
    document.getElementById('btnJumpEnd').addEventListener('click', () => App.goToEnd());

    U.$$('.speed-btn').forEach((b) => b.addEventListener('click', () => {
      const s = b.dataset.speed === 'max' ? 'max' : +b.dataset.speed;
      App.setSpeed(s);
    }));

    const slider = document.getElementById('progressRange');
    slider.addEventListener('input', () => App.seekFromSlider(+slider.value / 1000));
    /* Arrastrar la perilla tiene que hacer dos cosas y deshacerlas SIEMPRE: parar el replay
       (para no competir con la mano) y avisar de que el repintado no le escriba el valor por
       encima. El aviso vive en `_arrastrandoSlider`, no en el foco: con el guard viejo
       (`document.activeElement !== slider`) la perilla se congelaba en cuanto el deslizador
       se quedaba enfocado —medido: soltarlo con el replay sonando dejaba «vela 850 / 2000»
       con la perilla todavía en el 20 %—, y en el teléfono el gesto se convierte en scroll
       de la barra (que ahora desliza) y no llega a `pointerup`: sin `pointercancel` el replay
       se quedaba pausado y la perilla pillada hasta recargar. `pointerup` se escucha en
       `window` porque al soltar fuera del `<input>` el evento no vuelve al deslizador. */
    const acabarDrag = () => {
      if (!UI._arrastrandoSlider) return;
      UI._arrastrandoSlider = false;
      if (UI._wasPlaying) { UI._wasPlaying = false; BR.play(); }
      /* Y se refresca YA: sin esto la perilla se quedaba en el punto donde la soltaste
         hasta la siguiente vela (a 1×, un segundo entero; medido: valor 24 con el replay
         en el 42,6 %). El repintado no espera al arrastre, así que hay que pedirlo a mano. */
      UI.refreshReplayBar();
    };
    slider.addEventListener('pointerdown', () => {
      UI._arrastrandoSlider = true;
      UI._wasPlaying = BR.isPlaying();
      BR.pause();
      window.addEventListener('pointerup', acabarDrag, { once: true });
      window.addEventListener('pointercancel', acabarDrag, { once: true });
    });
    window.addEventListener('blur', acabarDrag);   // ventana que pierde el foco a media arrastre
  };

  /* ------------------------------- Barra lateral ------------------------------- */

  UI._wireSidebar = function () {
    // Modo de tamaño
    U.$$('#segSize .seg-btn').forEach((b) => b.addEventListener('click', () => {
      U.$$('#segSize .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      App.sizeMode = b.dataset.mode;
      const labels = UI.SIZE_LABELS;
      setText('sizeLabel', labels[App.sizeMode][0]);
      setText('sizeSuffix', labels[App.sizeMode][1]);
      if (App.sizeMode === 'qty') document.getElementById('sizeInput').value = 1;
      /* Entrar en Riesgo ESCRIBE el tamaño deducido en `#sizeInput` (es su salida). Al salir hay que
         devolver el número anterior: si no, los 2 500 USD deducidos se releerían como «2 500 % del
         equity» y la orden siguiente se rechazaría por margen sin ninguna explicación —ese fallo lo
         encontró la suite de riesgo, no este comentario: estaba aquí desde el primer día—. */
      {
        const si = document.getElementById('sizeInput');
        if (App.sizeMode === 'riesgo') { if (App._sizeAntesRiesgo === undefined) App._sizeAntesRiesgo = si.value; }
        else if (App._sizeAntesRiesgo !== undefined) { si.value = App._sizeAntesRiesgo; App._sizeAntesRiesgo = undefined; }
      }
      UI.syncRiesgo();
      UI.updateOrderHint();
    }));

    document.getElementById('sizeInput').addEventListener('input', UI.updateOrderHint);
    /* Riesgo fijo: cualquier cambio recalcula el tamaño deducido y los niveles adjuntos. El SL del
       formulario y el del bloque de riesgo son el MISMO número visto desde dos sitios, así que se
       sincronizan en los dos sentidos (escribir por programa no dispara 'input', no hay bucle). */
    ['riesgoSlInput', 'riesgoMaxInput'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => App.riesgoAplica());
    });
    {
      const seg = document.getElementById('segRiesgoRr');
      if (seg) seg.addEventListener('click', (e) => {
        const b = e.target.closest ? e.target.closest('[data-rr]') : null;
        if (!b) return;
        seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        App.riesgoAplica();
      });
      const sl = document.getElementById('slInput');
      if (sl) sl.addEventListener('input', () => {
        if (App.sizeMode !== 'riesgo') return;
        const v = document.getElementById('riesgoSlInput');
        if (v) { v.value = sl.value; App.riesgoAplica(); }
      });
    }
    // Deslizador de fracción 0 / 25 / 50 / 75 / 100 (como el panel de órdenes
    // de Bitunix): fija el tamaño sobre la unidad activa (% | USD | Qty).
    U.$$('#quickSize [data-pct]').forEach((c) => c.addEventListener('click', () => {
      U.$$('#quickSize [data-pct]').forEach((x) => x.classList.toggle('active', x === c));
      const pct = +c.dataset.pct;
      const inp = document.getElementById('sizeInput');
      if (App.sizeMode === 'notional') inp.value = U.round(TE.state.equity * (pct / 100), 2);
      else if (App.sizeMode === 'qty') inp.value = U.round(TE.state.equity * (pct / 100) / Math.max(1e-9, App.currentPrice() || 1) / Math.max(1, TE.state.leverage), 6);
      else inp.value = pct;
      UI.updateOrderHint();
    }));

    // MODO DE MARGEN (Cruzado / Aislado) y apalancamiento con deslizador.
    UI.initTerminal();

    document.getElementById('leverageSelect').addEventListener('change', (e) => {
      TE.configure({ leverage: +e.target.value });
      setText('tagLeverage', e.target.value + 'X');
      UI.syncLeverage(+e.target.value);
      UI.updateOrderHint();
      UI.refreshAccount();
    });
    document.getElementById('feeInput').addEventListener('change', (e) => {
      TE.configure({ feePct: +e.target.value });
      U.log(`💱 Comisión configurada: ${e.target.value}% por lado`, 'sys');
    });

    document.getElementById('slInput').addEventListener('input', UI.vigilaTpSl);
    document.getElementById('tpInput').addEventListener('input', UI.vigilaTpSl);
    document.getElementById('slInput').addEventListener('input', UI.updateOrderHint);
    document.getElementById('tpInput').addEventListener('input', UI.updateOrderHint);
    // La casilla de TP/SL (ítem 5b de la piel): desplegada por defecto y recordada.
    {
      const chk = document.getElementById('chkTpSl');
      if (chk) {
        /* El reposo es DESMARCADO, que es como viene en el sitio (medido: su `☐ TP/SL` llega sin
           marcar y por eso su panel no pasa nunca de 347 px). No es un capricho de parecido: con
           la casilla marcada por defecto el bloque mide 315 px, la columna del panel derecho tiene
           556 y `autoAprieta` -que vigila que los botones no queden bajo el borde- pliega
           «Avanzado» solo a 1440x900, que es el viewport de once suites. */
        try { chk.checked = !!(window.ST && ST.get('tpslOn', false)); } catch (e) {}
        chk.addEventListener('change', () => {
          try { if (window.ST && ST.set) ST.set('tpslOn', !!chk.checked); } catch (e) {}
          /* Marcando, el bloque crece ~115 px y a 1440x900 (y a 1600x900, medido) `autoAprieta`
             lo PLEGABA: la casilla tapaba justo las dos cajas que acaba de pedir, que es el peor
             modo de perder una interaccion. Desde aqui manda la intencion de la persona -la misma
             via que deja el clic en el boton de «Avanzado»— y el automatico se aparta; si ya no
             cabe, la columna desliza y el pie avisa del recorte (`marcaDesborde`), que es lo que
             hace el sitio con su panel de 347 px dentro de una columna mas alta. */
          if (chk.checked) { const bt = document.getElementById('btnOrderAvanzado'); if (bt) bt.dataset.explicit = '1'; }
          UI.syncTpSl(); UI.updateOrderHint();
          if (!chk.checked && (document.getElementById('slInput').value || document.getElementById('tpInput').value)) {
            // Se apaga con niveles escritos: se guardan, no se envian, y se dice. La razon por la que
            // esto es un aviso y no un bloqueo es la misma de arriba -la persona mando—, por eso el
            // aviso va primero y `UI.vigilaTpSl` no lo desanda.

            U.toast('TP/SL apagados: los precios siguen escritos y volverán al marcar la casilla', 'info');
          }
        });
        UI.syncTpSl();
      }
    }
    U.$$('#quickSlTp .chip').forEach((c) => c.addEventListener('click', () => {
      const price = App.currentPrice();
      if (!price) { U.toast('No hay datos cargados', 'warn'); return; }
      if (c.dataset.slpct) document.getElementById('slInput').value = U.round(price * (1 - +c.dataset.slpct / 100), 6);
      if (c.dataset.slpct || c.dataset.tppct) { UI.vigilaTpSl(); UI.syncTpSl(); }   // el resumen de la fila va detras
      if (c.dataset.tppct) document.getElementById('tpInput').value = U.round(price * (1 + +c.dataset.tppct / 100), 6);
      UI.updateOrderHint();
    }));

    document.getElementById('btnLong').addEventListener('click', () => App.placeOrder('long'));
    document.getElementById('btnShort').addEventListener('click', () => App.placeOrder('short'));

    /* ---- Tipo de orden: ⚡ Mercado / ⏳ Límite / 🎯 Trigger ---- */
    document.querySelectorAll('#segOrderType .seg-btn').forEach((b) => {
      b.addEventListener('click', () => UI.setOrderType(b.dataset.otype));
    });
    /* Disparo (mark|last) y ejecución (market|limit) de la trigger: son los dos selectores que la
       API separa en `tpStopType` y `tpOrderType`; aquí se guardan en App.trigOrder porque el
       formulario los necesita también al calcular el coste y al pintar la pista. */
    [['#segTrigSrc', 'tsrc', 'src'], ['#segTrigExec', 'texec', 'exec']].forEach(([sel, attr, clave]) => {
      const cont = document.querySelector(sel);
      if (!cont) return;
      cont.addEventListener('click', (e) => {
        const b = e.target.closest ? e.target.closest(`[data-${attr}]`) : null;
        if (!b) return;
        cont.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        if (!App.trigOrder) App.trigOrder = { src: 'last', exec: 'market' };
        App.trigOrder[clave] = b.dataset[attr] === 'mark' ? 'mark' : (clave === 'exec' ? (b.dataset[attr] === 'limit' ? 'limit' : 'market') : 'last');
        const lim = document.getElementById('trigLimitRow');
        if (lim) lim.style.display = App.trigOrder.exec === 'limit' ? '' : 'none';
        UI.updateTriggerHint();
      });
    });
    // La pista se recalcula al escribir el nivel, como la del límite.
    {
      const ti = document.getElementById('trigInput');
      if (ti) ti.addEventListener('input', () => UI.updateTriggerHint());
      const tp = document.getElementById('trailPctInput');
      if (tp) tp.addEventListener('input', () => UI.updateTriggerHint());
    }
    // Atajos rápidos de precio límite (% respecto al precio actual)
    document.querySelectorAll('#quickLimit .chip').forEach((c) => {
      c.addEventListener('click', () => {
        const ref = App.currentPrice();
        if (!ref) { U.toast('Carga datos antes de fijar el precio límite', 'warn'); return; }
        const v = c.dataset.limpct;
        const precio = v === 'actual' ? ref : ref * (1 + parseFloat(v) / 100);
        document.getElementById('limitInput').value = precio.toFixed(2);
        UI.updateLimitHint();
      });
    });
    ['limitInput', 'slInput', 'tpInput'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', UI.updateLimitHint);
    });
    document.getElementById('btnCancelOrders').addEventListener('click', () => App.cancelAllOrders());
    document.getElementById('btnFlatten').addEventListener('click', () => App.flatten());
    document.getElementById('btnResetStats').addEventListener('click', () => UI.confirmReset());
    UI.initOrdenAvanzado();
    UI.initOrdenRapida();
    UI.initOrdenCondicional();
  };

  /* ── «Avanzado» del panel de órdenes (solo para la pantalla del teléfono) ─────────
     Por qué existe: medido en 390×844, el cuerpo del formulario pedía 510 px dentro de
     una caja de 214 —once controles (los % rápidos del tamaño, el apalancamiento, el
     precio de SL y TP, los seis atajos y el «Cerrar todo») vivían fuera del recorte y se
     alcanzaban a scroll dentro de una caja sin ninguna señal de que hubiera más abajo—.
     Bitunix hace lo mismo en el teléfono: deja precio, tamaño, % rápidos y los botones
     de Long/Short, y esconde el resto tras un desplegable.

     Cómo está montado, para que no se vuelva a colar un bug de los de antes:
       · El estado vive en el `aria-expanded` del botón; la clase `adv-cerrado` en
         `#orderCard` (la que oculta) y `ord-av-abierto` en `document.body` (la que deja
         crecer la franja y poner el documento en modo desplazamiento) se derivan SIEMPRE
         de ahí en `pinta()`. Un `hidden` puesto a mano en el div, o un `style` en la
         franja, serían dos fuentes de verdad y la segunda tarde o temprano manda una.
       · El CSS solo oculta dentro de `@media (max-width:640px)`: en escritorio estas tres
         filas se ven siempre, así que plegar o desplegar aquí es inofensivo y el botón ni
         se pinta. Ninguna suite de escritorio (entradas, límites, promediado, trailing)
         cambia de comportamiento.
       · Al cambiar el alto de la franja hay que volver a repartir la escalera
         (`PC.ajustaEscalera`) y sincronizar los lienzos (`CM._syncPanes`); si no, el
         gráfico se queda pintado con la altura del estado anterior. */
  UI.initOrdenAvanzado = function () {
    const btn = document.getElementById('btnOrderAvanzado');
    const adv = document.getElementById('orderAvanzado');
    const card = document.getElementById('orderCard');
    if (!btn || !adv || !card || btn.dataset.pcAdv) return false;
    btn.dataset.pcAdv = '1';
    const abierto = () => btn.getAttribute('aria-expanded') === 'true';
    const cuerpo = card.querySelector('.card-body');
    /* El cuerpo de la tarjeta tiene su propio deslizador (css/bitunix.css, ≤640:
       `overflow-y:auto` + `min-height:0`), así que abrir «Avanzado» o pasar a modo
       «Límite» (su fila de precio más los siete atajos) NUNCA le roba altura al gráfico
       ni deja controles fuera del mundo: lo que no cabe se alcanza deslizando la
       tarjeta. Lo único que hay que mantener aquí es la SEÑAL de que desliza —sin ella,
       un pie cortado a media fila parece un dibujo roto—. */
    const marcaDesborde = () => {
      if (!cuerpo) return;
      card.classList.toggle('desborda', cuerpo.scrollHeight - cuerpo.clientHeight > 1);
    };

    /* Alto real del bloque «Avanzado» (124 px con la fila de comisión y la de SL/TP). Se
       guarda porque al plegarlo `display:none` lo deja sin caja y ya no se puede medir, y hay
       que saber cuánto ocupaba para decidir si cabe abrirlo otra vez. */
    const guardaAlto = () => {
      if (!card.classList.contains('adv-cerrado')) {
        btn.dataset.altoAdv = String(Math.round(adv.getBoundingClientRect().height + 8));
      }
    };
    const altoBloque = () => {
      if (btn.dataset.altoAdv) return parseFloat(btn.dataset.altoAdv);
      const previa = adv.style.display;            // medir en frío: se saca de `display:none`
      adv.style.display = 'block';                 // un instante (solo al arrancar, sin caché)
      const x = Math.round(adv.getBoundingClientRect().height + 8);
      adv.style.display = previa;
      return x;
    };
    /* LO QUE NO PUEDE PASAR: que los botones de compra/venta queden por debajo del borde de la
       columna. Medido a 1440x900 el 10-oct-2026, con la banda ya en una franja: la tarjeta de
       órdenes mide 695 px en una fila de 556, así que los botones caen ~140 px más abajo del
       borde y hay que deslizar la columna para pulsarlos. Bitunix no pasa nunca de ahí porque
       su `☐ TP/SL` viene plegado. En el teléfono esto ya se resolvía así (bloque ≤640); en
       escritorio la clase no pintaba nada porque la regla vivía dentro de ese medio.
       Se pliega, pues, MIDIENDO y solo cuando hace falta: si con el bloque abierto los botones
       se salen de la columna, se pliega y el botón se queda a la vista avisando del porqué; si
       el hueco vuelve, se deshace. En cuanto la persona toca el botón manda su criterio. */
    const autoAprieta = () => {
      if (window.innerWidth <= 640 || btn.dataset.explicit === '1') return;
      /* El cajón que recorta es el primer antepasado que DESLIZA (medido: `#sidebar` con
         `overflow-y:auto` en las tres columnas y también en la franja de 1024); si no hay
         ninguno, la ventana. */
      let port = card.parentElement;
      while (port) { const o = getComputedStyle(port).overflowY; if (o === 'auto' || o === 'scroll') break; port = port.parentElement; }
      const lg = document.getElementById('btnLong');
      const sh = document.getElementById('btnShort');
      if (!port || !lg || !sh) return;
      const abiertoAhora = !card.classList.contains('adv-cerrado');
      const inferior = Math.max(lg.getBoundingClientRect().bottom, sh.getBoundingClientRect().bottom);
      const ancho = altoBloque();
      /* El borde que cuenta es el del scrollport VISIBLE: medido a 1024x768, `#sidebar` tiene
         436 px de caja y 637 px de contenido, así que su `bottom` coincide con el de la ventana
         pero la caja del grid (`#workspace`) llega hasta 436; en ventanas donde el cajón no
         recorta (crece sin `overflow`), su `bottom` cae fuera de la pantalla y daría clip 0 con
         los botones larguísimos por debajo del pliegue. `Math.min` con la ventana es lo que el
         usuario ve de verdad. */
      const visible = Math.min(port.getBoundingClientRect().bottom, window.innerHeight) - 6;
      /* SE MIDE EL AIRE QUE SOBRA, no el recorte: `margen` es lo que hay entre el borde
         inferior de los botones y el fondo del cajón. Con el bloque abierto basta con que ese
         aire sea negativo para plegar; con él cerrado hay que comparar el aire con lo que
         ocuparía abrirlo (`ancho`, 312 px medidos: modo de posición + comisión + SL/TP +
         plantillas). La primera versión sumaba `ancho` al recorte, y eso se desmentía solo:
         a 1440x900 el pliegue no se deshacía al devolver el hueco porque 0 + 312 > 0.
         La banda 0 ≤ margen < ancho deja los DOS estados válidos, que es lo que evita el
         parpadeo: si plegar y abrir dieran el mismo número, el ResizeObserver se respondería
         a sí mismo en bucle. */
      const margen = Math.round(visible - inferior);
      const clipSiAbre = abiertoAhora ? Math.max(0, -margen) : Math.max(0, ancho - margen);
      if (abiertoAhora && clipSiAbre > 0) {
        card.classList.add('adv-cerrado');
        card.dataset.autoApretado = '1';
        btn.dataset.motivo = 'espacio';
        // El `aria-expanded` tiene que decir lo que hay en pantalla, no lo que la persona
        // pidió: si no, un lector de anuncia «expandido» sobre campos `display:none`, y
        // `tests/responsive.test.js` (que lee aria y offsetParent juntos) se contradice.
        btn.setAttribute('aria-expanded', 'false');
        if (window.PC && PC.ajustaEscalera) PC.ajustaEscalera();
      } else if (!abiertoAhora && clipSiAbre === 0 && card.dataset.autoApretado === '1') {
        card.classList.remove('adv-cerrado');
        delete card.dataset.autoApretado;
        delete btn.dataset.motivo;
        btn.setAttribute('aria-expanded', 'true');
        if (window.PC && PC.ajustaEscalera) PC.ajustaEscalera();
      }
      guardaAlto();
      marcaDesborde();
    };
    const pinta = () => {
      card.classList.toggle('adv-cerrado', !abierto());
      /* Si el bloque acaba abierto, el aviso de «plegado por espacio» tiene que irse: el
         `aria-expanded` manda sobre la clase y `autoAprieta` ya no decide nada cuando la
         persona tocó el botón, así que sin esto el punto del botón se queda mentiendo. */
      if (abierto()) { delete card.dataset.autoApretado; delete btn.dataset.motivo; }
      const ar = btn.querySelector('.ar');
      if (ar) ar.textContent = abierto() ? '⌃' : '⌄';
      guardaAlto();
      marcaDesborde();
    };
    btn.addEventListener('click', () => {
      btn.dataset.explicit = '1';            // desde aquí manda la persona, no el hueco
      delete card.dataset.autoApretado;
      delete btn.dataset.motivo;
      btn.setAttribute('aria-expanded', abierto() ? 'false' : 'true');
      if (window.ST && ST.set) ST.set('ordenAvanzado', abierto());
      pinta();
      // El hueco del gráfico se reparte otra vez (PC) y las escalas se resincronizan:
      // al cambiar el alto de la franja, el panel del PnL y los indicadores cambian de
      // tamaño y Lightweight Charts no se entera solo.
      if (window.PC && PC.ajustaEscalera) PC.ajustaEscalera();
      if (window.CM && CM.main && CM._syncPanes) {
        try { CM._syncPanes(CM.main.timeScale().getVisibleLogicalRange()); } catch (e) { /* aún sin gráfico */ }
      }
    });
    // Se recuerda la preferencia (abierta o cerrada) porque el teléfono se usa a ratos:
    // si la persona trabaja con SL/TP, no debería tener que abrir el panel cada vez.
    if (window.ST && ST.get) {
      const g = ST.get('ordenAvanzado', null);
      if (g === true || g === false) btn.setAttribute('aria-expanded', g ? 'true' : 'false');
    }
    /* EL DEFECTO QUE ESTO ARREGLA (medido el 10-oct-2026): poner `aria-expanded` a `true` una
       sola vez al arrancar -que era como estaba escrito- se colaba en el teléfono al girar el
       tablet o al redimensionar la ventana de pruebas: a 390 px el bloque quedaba abierto, el
       cuerpo de la tarjeta pasaba de 221/220 a 221/434 y el reposo del teléfono dejaba de
       entrar entero (rompía `tests/plantillas.test.js` y el contrato del ≤640). El estado por
       defecto es función del ANCHO y se re-evalúa en cada resize: sin elección guardada, abierto
       en escritorio (las filas se ven, como pide `tests/plantillas.test.js`) y plegado en el
       teléfono. En cuanto hay elección (`ST`), manda ella en cualquier ancho. */
    const sincroniza = () => {
      const g = (window.ST && ST.get) ? ST.get('ordenAvanzado', null) : null;
      const quiere = (g === true || g === false) ? g : window.innerWidth > 640;
      if ((btn.getAttribute('aria-expanded') === 'true') !== quiere) btn.setAttribute('aria-expanded', String(quiere));
    };
    UI._sincronizaOrden = sincroniza;
    sincroniza();
    UI.vistasMoviles();
    pinta();
    autoAprieta();
    // `#limitRow` lo muestra y lo oculta OTRO módulo (escribe `style.display` y no avisa):
    // el `ResizeObserver` sobre el cuerpo de la tarjeta es la forma de enterarse sin tocar
    // ese código. Como el alto casi siempre cambia con la fila, basta con él; se enganchan
    // también los botones de tipo de orden por si el cambio de alto queda en 0 px.
    /* El observer dispara la decisión, pero NO en su propia notificación: plegar cambia el
       alto del cuerpo, el cuerpo observa su propio alto y Chrome corta el bucle con
       «ResizeObserver loop completed with undelivered notifications» (error de consola que
       cuenta como fallo en tests/bitunix.test.js). Se difiere un frame y, si en ese frame la
       decisión no cambia nada, no se toca el DOM. */
    if ('ResizeObserver' in window) {
      let pend = 0;
      new ResizeObserver(() => {
        if (pend) return;
        pend = requestAnimationFrame(() => { pend = 0; autoAprieta(); });
      }).observe(cuerpo);
    }
    [...document.querySelectorAll('#segOrderType .seg-btn')].forEach((b) => b.addEventListener('click', () => {
      requestAnimationFrame(marcaDesborde);
    }));
    window.addEventListener('resize', () => requestAnimationFrame(() => {
      // `pinta()` en medio: `sincroniza` mueve `aria-expanded` y `autoAprieta` la clase; sin la
      // pintura intermedia la clase se queda atrasada (medido: a 390 tras redimensionar desde
      // 1440 el aria decía `false` y el bloque seguía visible -un plegado fantasma-).
      sincroniza();
      pinta();
      autoAprieta();
      if (window.PC && PC.ajustaEscalera) PC.ajustaEscalera();   // el hueco cambia con el pliegue
    }));
    return true;
  };

  /* ------------------------------ Panel inferior ------------------------------ */

  UI._wireBottom = function () {
    U.$$('.tab').forEach((t) => t.addEventListener('click', () => {
      U.$$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      U.$$('.tab-body').forEach((b) => b.classList.toggle('active', b.id === 'tab-' + t.dataset.tab));
      // Al hacerse visible hay que repintar lo que depende del ancho disponible
      // (la curva de capital se dibujaría con 0 px si estaba oculta) y lo que
      // depende del estado (posición y órdenes en espera).
      const _t = t.dataset.tab;
      if (_t === 'stats') UI.refreshStats();
      else if (_t === 'positions') { UI.refreshPosition(); UI.renderPending(); }
      else if (_t === 'account') UI.refreshAccount();
      if (t.dataset.tab === 'drawings') DT.renderList(document.getElementById('drawList'));
    }));

    const solo = document.getElementById('chkSoloActual');
    if (solo) {
      try { solo.checked = !!(window.ST && ST.get && ST.get('soloActual', false) === true); } catch (e) {}
      solo.addEventListener('change', () => {
        if (window.ST && ST.set) ST.set('soloActual', !!solo.checked);
        UI.renderTrades();
        U.log(solo.checked ? '🔎 Panel inferior: solo el par cargado' : '🔎 Panel inferior: todos los pares de la sesión', 'sys');
      });
    }
    const pill = document.getElementById('btnFlattenTab');
    if (pill) pill.addEventListener('click', () => App.flatten());

    document.getElementById('btnClearLog').addEventListener('click', () => {
      document.getElementById('logList').innerHTML = '';
      U.log('🖥️ Log vaciado', 'sys');
    });

    document.getElementById('btnBottomToggle').addEventListener('click', (e) => {
      document.body.classList.toggle('compact-bottom');
      e.currentTarget.textContent = document.body.classList.contains('compact-bottom') ? '⌃' : '⌄';
      setTimeout(() => { DT.resize(); DT.render(); CM.refresh(); }, 300);
    });

    // Gestor de dibujos: seleccionar · 👁 ocultar · ✕ eliminar · borrar todo
    document.getElementById('drawList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        const d = DT.drawings.find((x) => x.id === del.dataset.del);
        if (d) DT.deleteDrawing(d);
        return;
      }
      const ojo = e.target.closest('[data-eye]');
      if (ojo) {
        const d = DT.drawings.find((x) => x.id === ojo.dataset.eye);
        if (d) DT.setHidden(d.id, !d.hidden);
        return;
      }
      if (e.target.closest('[data-eye-all]')) { DT.toggleAllHidden(); return; }
      if (e.target.closest('[data-clear]')) {
        if (!DT.drawings.length) { U.toast('No hay dibujos que borrar', 'info', 1500); return; }
        if (confirm('¿Borrar TODOS los dibujos del gráfico?')) {
          DT.clearAll(); U.toast('🗑️ Todos los dibujos borrados', 'info', 1800);
        }
        return;
      }
      const item = e.target.closest('.draw-item');
      if (item) {
        DT.selected = DT.drawings.find((x) => x.id === item.dataset.id) || null;
        DT.render(); DT.renderList(document.getElementById('drawList'));
      }
    });

    // Doble clic sobre el nombre → renombrar el dibujo en línea
    document.getElementById('drawList').addEventListener('dblclick', (e) => {
      const nom = e.target.closest('[data-nombre]');
      if (!nom || nom.querySelector('input')) return;
      const d = DT.drawings.find((x) => x.id === nom.dataset.nombre);
      if (!d) return;
      const previo = d.label || '';
      nom.innerHTML = '<input class="draw-edit" type="text" maxlength="40" value="' + U.esc(previo) + '">';
      const inp = nom.querySelector('input');
      inp.focus(); inp.select();
      const guardar = () => { DT.rename(d.id, inp.value); };
      inp.addEventListener('keydown', (ev) => {
        ev.stopPropagation();                     // que no actúen los atajos globales
        if (ev.key === 'Enter') { guardar(); }
        else if (ev.key === 'Escape') { DT.renderList(document.getElementById('drawList')); }
      });
      inp.addEventListener('blur', guardar);
    });
  };

  /* --------------------------------- Modales --------------------------------- */

  UI._wireModals = function () {
    // Cierre genérico
    U.$$('.modal').forEach((m) => {
      m.addEventListener('mousedown', (e) => { if (e.target === m) UI.closeModal(m.id); });
      U.$$('[data-close]', m).forEach((b) => b.addEventListener('click', () => UI.closeModal(m.id)));
    });

    /* --- Indicadores --- */
    U.$$('#modalIndicators .ind-row input[type=checkbox]').forEach((c) => {
      c.addEventListener('change', () => c.closest('.ind-row').classList.toggle('on', c.checked));
    });
    document.getElementById('btnApplyInd').addEventListener('click', () => {
      App.applyIndicators(UI.readIndicatorConfig());
      UI.closeModal('modalIndicators');
    });

    /* --- Ajustes --- */
    /* ---- Buscador de símbolos ---- */
    document.getElementById('btnSymbols').addEventListener('click', () => UI.openSymbols());
    document.getElementById('symQuery').addEventListener('input', () => UI.renderSymbols());
    document.getElementById('symQuery').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const primera = document.querySelector('#symList .sym-row');
        if (primera) UI.pickSymbol(primera.dataset.sym);
      }
    });
    U.$$('#symCats .sym-cat').forEach((b) => {
      b.addEventListener('click', () => {
        UI.symCat = b.dataset.cat;
        U.$$('#symCats .sym-cat').forEach((x) => x.classList.toggle('active', x === b));
        UI.renderSymbols();
      });
    });

    /* ---- Temporalidades rápidas (1m · 5m · 15m · 1h · 4h · 1d · 1w) ---- */
    U.$$('#tfQuick .tf-btn').forEach((b) => {
      b.addEventListener('click', () => UI.setTimeframe(b.dataset.tf));
    });
    document.getElementById('tfSelect').addEventListener('change', () => UI.syncTfButtons());

    // Interruptor del gesto (se aplica al instante)
    const chkGesture = document.getElementById('setGesture');
    if (chkGesture) {
      chkGesture.addEventListener('change', () => {
        DT.gesture.on = chkGesture.checked;
        ST.setSettings({ gestureDraw: chkGesture.checked });
        U.toast(chkGesture.checked
          ? '✍️ Gesto activado: mantén pulsado ⅓ s y traza'
          : 'Gesto desactivado', 'info', 2600);
      });
    }
    document.getElementById('btnApplySettings').addEventListener('click', () => App.applySettings());
    document.getElementById('btnHardReset').addEventListener('click', () => UI.confirmHardReset());

    /* --- Sesiones --- */
    document.getElementById('btnSaveSession').addEventListener('click', () => {
      const name = (val('sessionName') || '').trim() || ('Sesión ' + U.fmtDate(Math.floor(Date.now() / 1000)));
      App.saveSession(name);
      UI.renderSessions();
    });
    document.getElementById('sessionList').addEventListener('click', (e) => {
      const load = e.target.closest('[data-load]');
      const del = e.target.closest('[data-delete]');
      if (load) App.loadSession(load.dataset.load);
      if (del) { ST.deleteSession(del.dataset.delete); UI.renderSessions(); }
    });

    /* --- Exportación --- */
    document.getElementById('expTradesCsv').addEventListener('click', () => App.exportTrades());
    document.getElementById('expEquityCsv').addEventListener('click', () => App.exportEquity());
    document.getElementById('expJson').addEventListener('click', () => App.exportJSON());
    document.getElementById('expReport').addEventListener('click', () => App.exportReport());
    document.getElementById('expCandlesCsv').addEventListener('click', () => App.exportCandles());
    document.getElementById('expPng').addEventListener('click', () => App.screenshot());
  };

  UI.openModal = function (id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('open');
    if (id === 'modalSettings') UI.openSettings();
  };

  UI.closeModal = function (id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('open');
  };

  UI.closeAllModals = function () { U.$$('.modal').forEach((m) => m.classList.remove('open')); };

  /* ------------------------------ Configuración ------------------------------ */

  /** Lee la configuración de indicadores del modal. */
  UI.readIndicatorConfig = function () {
    const on = (id) => document.getElementById(id).checked;
    return {
      vol:   { on: on('indVol'),   color: val('volColor') },
      sma:   { on: on('indSma'),   p: numv('smaP', 50),      color: val('smaColor') },
      ema:   { on: on('indEma'),   p: numv('emaP', 21),      color: val('emaColor') },
      ema2:  { on: on('indEma2'),  p: numv('ema2P', 200),    color: val('ema2Color') },
      bb:    { on: on('indBb'),    p: numv('bbP', 20), k: numv('bbK', 2), color: val('bbColor') },
      rsi:   { on: on('indRsi'),   p: numv('rsiP', 14),      color: val('rsiColor') },
      macd:  { on: on('indMacd'),  f: numv('macdF', 12), s: numv('macdS', 26), sig: numv('macdSig', 9), color: val('macdColor'), signalColor: '#ffab40' },
      atr:   { on: on('indAtr'),   p: numv('atrP', 14),      color: val('atrColor') },
    };
  };

  /** Vuelca la configuración guardada en los campos del modal. */
  UI.syncIndicatorModalFromConfig = function (cfg) {
    const set = (id, v) => { const e = document.getElementById(id); if (e && v !== undefined) e.value = v; };
    const chk = (id, v) => { const e = document.getElementById(id); if (e) { e.checked = !!v; e.closest('.ind-row').classList.toggle('on', !!v); } };
    chk('indVol', cfg.vol && cfg.vol.on);      set('volColor', cfg.vol && cfg.vol.color);
    chk('indSma', cfg.sma && cfg.sma.on);      set('smaP', cfg.sma && cfg.sma.p);   set('smaColor', cfg.sma && cfg.sma.color);
    chk('indEma', cfg.ema && cfg.ema.on);      set('emaP', cfg.ema && cfg.ema.p);   set('emaColor', cfg.ema && cfg.ema.color);
    chk('indEma2', cfg.ema2 && cfg.ema2.on);   set('ema2P', cfg.ema2 && cfg.ema2.p); set('ema2Color', cfg.ema2 && cfg.ema2.color);
    chk('indBb', cfg.bb && cfg.bb.on);         set('bbP', cfg.bb && cfg.bb.p);      set('bbK', cfg.bb && cfg.bb.k); set('bbColor', cfg.bb && cfg.bb.color);
    chk('indRsi', cfg.rsi && cfg.rsi.on);      set('rsiP', cfg.rsi && cfg.rsi.p);   set('rsiColor', cfg.rsi && cfg.rsi.color);
    chk('indMacd', cfg.macd && cfg.macd.on);   set('macdF', cfg.macd && cfg.macd.f); set('macdS', cfg.macd && cfg.macd.s); set('macdSig', cfg.macd && cfg.macd.sig);
    chk('indAtr', cfg.atr && cfg.atr.on);      set('atrP', cfg.atr && cfg.atr.p);   set('atrColor', cfg.atr && cfg.atr.color);
    // Etiquetas de parámetros en los paneles
    setText('rsiParams', cfg.rsi ? cfg.rsi.p : 14);
    setText('macdParams', cfg.macd ? `${cfg.macd.f} ${cfg.macd.s} ${cfg.macd.sig}` : '');
    setText('atrParams', cfg.atr ? cfg.atr.p : 14);
  };

  UI.openSettings = function () {
    document.getElementById('setCapital').value = TE.state.initialCapital;
    document.getElementById('setFee').value = TE.state.feePct;
    document.getElementById('setLeverage').value = TE.state.leverage;
    document.getElementById('setWarmup').value = App.warmup;
    document.getElementById('setFunding').value = TE.state.fundingPct;
    document.getElementById('setSlFirst').value = TE.state.slFirst;
    document.getElementById('setSound').checked = !!U.sound.enabled;
    document.getElementById('setAutoReveal').checked = !!App.autoReveal;
    const cg = document.getElementById('setGesture');
    if (cg) cg.checked = DT.gesture.on !== false;
    const ca = document.getElementById('setAveraging');
    if (ca) ca.checked = TE.state.averaging !== false;
  };

  /* --------------------------------- Sesiones --------------------------------- */

  UI.renderSessions = function () {
    const list = document.getElementById('sessionList');
    if (!list) return;
    const sessions = ST.listSessions();
    if (!sessions.length) {
      list.innerHTML = '<div class="empty">No hay sesiones guardadas todavía.</div>';
      return;
    }
    list.innerHTML = sessions.map((s) => {
      const m = s.meta || {};
      return `<div class="session-item">
        <span class="draw-swatch" style="background:#2979ff"></span>
        <span class="s-name">${U.esc(s.name)}</span>
        <span class="s-meta">${m.pair || ''} ${m.interval || ''} · ${m.trades || 0} trades · ${U.fmtDateEs(Math.floor(s.savedAt / 1000))}</span>
        <button class="btn" data-load="${s.key}" title="Cargar esta sesión">Cargar</button>
        <button class="mini-btn" data-delete="${s.key}" title="Eliminar">✕</button>
      </div>`;
    }).join('');
  };

  /* ================== PANELES DE INDICADORES (valores vivos) ================== */

  /**
   * Lista de indicadores con su VALOR ACTUAL, al estilo de OpenMarket: cada fila
   * muestra el nombre, un botón 👁 para mostrar/ocultar la serie y el último
   * valor calculado en la vela visible del replay.
   *
   * Se refresca en cada vela (UI.refreshAll), así que los números van cambiando
   * a medida que avanza el replay, igual que en un panel de trading real.
   */
  UI.renderPanels = function () {
    const cont = document.getElementById('panelsList');
    if (!cont || !CM || !CM.indData) return;
    const cfg = App.indicators || {};
    const i = CM._lastIndex;
    const d = CM.indData;
    const val = (arr) => (i >= 0 && arr && arr[i] != null && Number.isFinite(arr[i])) ? arr[i] : null;
    const ultima = App.candles && App.candles[CM._lastIndex];
    const filas = [];

    const push = (clave, nombre, valores, color, extras) => {
      const c = cfg[clave] || {};
      const on = !!c.on;
      // Solo mostramos los que están activos o los que el usuario tenga puestos
      filas.push({ clave, nombre, on, color: c.color || color, valores: on ? valores : [], extras });
    };

    // Volumen (siempre del gráfico principal)
    push('vol', 'Vol', ultima ? [U.fmtVol(ultima.volume)] : [], '#5c6bc0');
    push('sma', `SMA ${cfg.sma ? cfg.sma.p : 50}`, fmt1(val(d.sma)), '#ffd54f');
    push('ema', `EMA ${cfg.ema ? cfg.ema.p : 21}`, fmt1(val(d.ema)), '#00e5ff');
    push('ema2', `EMA ${cfg.ema2 ? cfg.ema2.p : 200}`, fmt1(val(d.ema2)), '#e040fb');
    push('bb', `BB ${cfg.bb ? cfg.bb.p : 20}`, fmt1(val(d.bb && d.bb.middle)), '#7c4dff');
    push('rsi', `RSI ${cfg.rsi ? cfg.rsi.p : 14}`, fmtNum(val(d.rsi), 1), '#b388ff');
    push('macd', `MACD ${cfg.macd ? cfg.macd.f : 12} ${cfg.macd ? cfg.macd.s : 26} ${cfg.macd ? cfg.macd.sig : 9}`,
      [['hist', fmtNum(val(d.macd && d.macd.hist), 2)],
       ['macd', fmtNum(val(d.macd && d.macd.macd), 2)],
       ['señal', fmtNum(val(d.macd && d.macd.signal), 2)]],
      '#40c4ff', true);
    push('atr', `ATR ${cfg.atr ? cfg.atr.p : 14}`, fmtNum(val(d.atr), 2), '#ffab40');

    const activos = filas.filter((f) => f.on).length;
    const tag = document.getElementById('panelsCount');
    if (tag) tag.textContent = activos + (activos === 1 ? ' indicador' : ' indicadores');

    cont.innerHTML = filas.map((f) => {
      const ojo = `<button class="pl-eye" data-eye="${f.clave}" title="${f.on ? 'Ocultar del gráfico' : 'Mostrar en el gráfico'}">${f.on ? '👁' : '🚫'}</button>`;
      let vals;
      if (f.extras) {
        vals = f.valores.map(([etq, v]) => `<span class="pl-kv"><i>${etq}</i>${v}</span>`).join('');
      } else {
        vals = f.valores.map((v) => `<b class="pl-val">${v}</b>`).join('');
      }
      return `<div class="pl-item ${f.on ? 'on' : 'off'}${f.extras ? ' pl-multi' : ''}" data-key="${f.clave}" title="Clic para configurar ${f.nombre}">` +
        `<span class="pl-dot" style="background:${f.on ? f.color : '#3a3f5c'}"></span>` +
        `<span class="pl-name">${f.nombre}</span>` +
        `<span class="pl-vals">${vals || '<span class="pl-off">—</span>'}</span>` +
        ojo +
      `</div>`;
    }).join('') +
      '<div class="hint hint-tiny">⇕ Arrastra la línea ámbar en el gráfico para mover el nivel, igual que SL/TP.</div>';

    // 👁 mostrar/ocultar sin abrir el modal
    cont.querySelectorAll('[data-eye]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = b.dataset.eye;
        if (!App.indicators[k]) App.indicators[k] = { on: false };
        App.indicators[k].on = !App.indicators[k].on;
        App.applyIndicators(App.indicators);
        U.toast((App.indicators[k].on ? 'Mostrando ' : 'Ocultando ') + k.toUpperCase(), 'info', 1500);
      });
    });
    // Clic en la fila → modal de configuración
    cont.querySelectorAll('.pl-item').forEach((el) => {
      el.addEventListener('click', () => UI.openModal('modalIndicators'));
    });

    function fmt1(v) { return v == null ? [] : [U.fmtPrice(v)]; }
    function fmtNum(v, dec) { return v == null ? [] : [U.num(v, dec)]; }
  };

  /* ============================ ÓRDENES LÍMITE ============================ */

  /** Cambia entre orden a mercado (⚡) y orden límite (⏳). */
  UI.setOrderType = function (tipo) {
    App.orderType = (tipo === 'limite' || tipo === 'trigger' || tipo === 'trailing') ? tipo : 'market';
    document.querySelectorAll('#segOrderType .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.otype === App.orderType);
    });
    /* El desplegable `Activador ▾` (BLOQUE 18 de la piel) dice en su propio rótulo lo que hay
       dentro: con `trailing` activo la fila entera pasa a decir «Trailing», que es lo que hace el
       sitio, y al elegir una de las dos opciones el panel se cierra solo. Se marca y se cierra
       AQUI, y no en el listener del botón, para que `setOrderType` siga siendo el único camino
       (las plantillas, las órdenes rápidas y `test:formulario` lo llaman directo). */
    const mas = document.getElementById('otypeMore');
    if (mas) {
      const cond = App.orderType === 'trigger' || App.orderType === 'trailing';
      mas.classList.toggle('active', cond);
      const lbl = document.getElementById('otypeMoreTxt');
      if (lbl) lbl.textContent = App.orderType === 'trailing' ? 'Trailing' : 'Activador';
      if (cond) mas.open = false;
    }
    const esLimite = App.orderType === 'limite';
    const esTrigger = App.orderType === 'trigger';
    const esTrail = App.orderType === 'trailing';
    document.getElementById('limitRow').style.display = esLimite ? '' : 'none';
    // Las dos filas nuevas viven del tipo de orden: la de disparo/ejecución solo tiene sentido en
    // trigger, y la validez aplica a todo lo que puede QUEDAR en espera (límite y trigger-límite).
    const trigRow = document.getElementById('trigRow');
    // La fila de disparo sirve a los dos tipos condicionales: el trailing también mide su
    // activación contra LAST o MARK. Lo que no comparte es la ejecución (un stop es a mercado).
    if (trigRow) trigRow.style.display = (esTrigger || esTrail) ? '' : 'none';
    const campoExec = document.getElementById('segTrigExec') && document.getElementById('segTrigExec').closest('.field');
    if (campoExec) campoExec.style.display = esTrail ? 'none' : '';
    const pctRow = document.getElementById('trailPctRow');
    if (pctRow) pctRow.style.display = esTrail ? '' : 'none';
    const lbAct = document.getElementById('lbTrigAct');
    if (lbAct) lbAct.textContent = esTrail ? 'Precio de activación (opcional)' : 'Precio de activación';
    const inpAct = document.getElementById('trigInput');
    if (inpAct) inpAct.placeholder = esTrail ? 'opcional · ej. 64000' : 'ej. 64000';
    const effRow = document.getElementById('effectRow');
    if (effRow) effRow.style.display = (esLimite || esTrigger || esTrail) ? '' : 'none';
    /* El trailing se coloca en GTC y no admite IOC/FOK/post-only: el conmutador de validez se
       DESACTIVA en vez de desaparecer, porque en su misma fila vive «Solo reducir», que para un
       stop de cierre sí aplica. */
    const selEf = document.getElementById('ordEffect');
    if (selEf) {
      selEf.disabled = esTrail;
      if (esTrail) selEf.value = 'GTC';
      selEf.title = esTrail ? 'Un stop se coloca en GTC: no admite IOC, FOK ni POST ONLY.' : '';
    }
    /* Los rótulos miden lo mismo en los tres modos a propósito: `.order-actions` es una rejilla
       `1fr 1fr`, y `1fr` = `minmax(AUTO,1fr)` → un texto más largo ensancha el min-content del
       botón y tira la tarjeta fuera de su propio borde (14 px de desborde medidos así). Lo que
       cambia es el icono, que es lo que se ve de reojo; el tipo elegido ya está en el segmentado. */
    /* Y LOS RÓTULOS DICEN LO MISMO EN LOS CUATRO MODOS. `tests/bitunix.test.js` los vigila
       (ítem 2 del registro: el sitio los llama «Abrir Largo» / «Abrir Corto»), pero esta función
       los reescribía con el vocabulario viejo en cuanto tocaban el segmentado -el ⚡ de la orden
       rápida lo hace-: el botón volvía a «▲ COMPRAR / LONG» y la piel se caía a media sesión. Se
       queda el nombre del sitio y solo cambia el icono, que es lo que se ve de reojo; la cadena
       sigue midiendo 13 caracteres, por debajo del tope de 18 que fija tests/formulario.test.js
       para que la rejilla `1fr 1fr` no ensanche la tarjeta. */
    document.getElementById('btnLong').textContent = (esLimite ? '⏳ ' : esTrigger ? '🎯 ' : esTrail ? '🌀 ' : '▲ ') + 'Abrir Largo';
    document.getElementById('btnShort').textContent = (esLimite ? '⏳ ' : esTrigger ? '🎯 ' : esTrail ? '🌀 ' : '▼ ') + 'Abrir Corto';
    if (esLimite) {
      const el = document.getElementById('limitInput');
      if (el && !parseFloat(el.value)) {
        const ref = App.currentPrice();
        if (ref) el.value = (ref * 0.995).toFixed(2);
      }
      UI.updateLimitHint();
    }
    if (esTrigger || esTrail) UI.updateTriggerHint();
  };

  /** Explica qué hará la trigger: contra qué se mide y qué pasa al disparar. */
  UI.updateTriggerHint = function () {
    const inp = document.getElementById('trigInput');
    const hint = document.getElementById('trigHint');
    if (!inp || !hint) return;
    const ref = App.currentPrice();
    const t = App.trigOrder || { src: 'last', exec: 'market' };
    /* El cuarto tipo comparte la fila de activación pero significa otra cosa: su nivel NO es fijo,
       lo mueve el pico. Se enseña el nivel DE AHORA, que es lo que hace falta para saber si está
       cerca, y como el formulario aún no sabe qué botón vas a pulsar se dicen los dos. */
    if (App.orderType === 'trailing') {
      const pct = parseFloat((document.getElementById('trailPctInput') || {}).value);
      if (!Number.isFinite(pct) || pct <= 0) {
        hint.textContent = 'El retroceso (%) es lo que define este tipo de orden: sin él no hay distancia que seguir.';
        hint.className = 'hint';
        return;
      }
      const bruto = parseFloat(inp.value);
      const act = Number.isFinite(bruto) && bruto > 0 ? bruto : null;
      const pico = act !== null ? act : ref;
      if (!Number.isFinite(pico) || pico <= 0) {
        hint.textContent = 'Carga la máquina para poder calcular el nivel del trailing.';
        hint.className = 'hint';
        return;
      }
      const abajo = pico * (1 - pct / 100), arriba = pico * (1 + pct / 100);
      hint.textContent = `🌀 Pico ${U.fmtPrice(pico)} · retroceso ${U.num(pct, 2)} %: una COMPRA dispara en `
        + `${U.fmtPrice(abajo)} (el nivel sube con el pico) y una VENTA en ${U.fmtPrice(arriba)} (baja con él)`
        + (act !== null ? ` · se arma al tocar la activación ${U.fmtPrice(act)} (contra ${t.src === 'mark' ? 'MARK' : 'LAST'})`
                        : ' · sin activación: sigue el precio desde ya')
        + ' · ejecuta a MERCADO y no reserva margen.';
      hint.className = 'hint';
      return;
    }
    const v = parseFloat(inp.value);
    if (!ref || !Number.isFinite(v) || v <= 0) {
      hint.textContent = 'La orden no reserva margen mientras espera: si al dispararse no cabe el tamaño, se rechaza.';
      hint.className = 'hint';
      return;
    }
    // (`t` ya está declarado arriba, antes de la rama de trailing: dos `const` con el mismo nombre
    // en la misma función rompen el script entero, y eso fue lo que tardó en aparecer aquí.)
    const pct = ((v - ref) / ref) * 100;
    hint.textContent = `${v > ref ? 'Se dispara al SUBIR' : 'Se dispara al BAJAR'} a ${U.fmtPrice(v)} ` +
      `(${U.num(pct, 2)} % desde ${U.fmtPrice(ref)}) · mide el ${t.src === 'mark' ? 'MARK (el cuerpo de la vela: una mecha no la dispara)' : 'LAST (basta con que la mecha toque)'} · ` +
      (t.exec === 'limit' ? 'al disparar COLOCA un límite, que puede no rellenarse' : 'al disparar entra a MERCADO, sí o sí');
    hint.className = 'hint';
  };

  /** Explica si el nivel elegido es de compra, de venta o se cruzaría. */
  UI.updateLimitHint = function () {
    const el = document.getElementById('limitInput');
    const hint = document.getElementById('limitHint');
    if (!el || !hint) return;
    const ref = App.currentPrice();
    const v = parseFloat(el.value);
    if (!ref || !Number.isFinite(v) || v <= 0) {
      hint.textContent = 'Elige un nivel por debajo del precio para comprar, o por encima para vender.';
      hint.className = 'hint';
      return;
    }
    const pct = ((v - ref) / ref) * 100;
    if (v < ref) {
      hint.textContent = `Nivel ${U.num(Math.abs(pct), 2)}% por debajo del precio (${U.fmtPrice(ref)}): orden de COMPRA (LONG) en un retroceso.`;
      hint.className = 'hint ok';
    } else if (v > ref) {
      hint.textContent = `Nivel ${U.num(pct, 2)}% por encima del precio (${U.fmtPrice(ref)}): orden de VENTA (SHORT) en un rebote.`;
      hint.className = 'hint ok';
    } else {
      hint.textContent = 'El nivel coincide con el precio actual: se ejecutará al instante a mercado.';
      hint.className = 'hint warn';
    }
  };

  /** Pinta la lista de órdenes límite pendientes (con botón de cancelar). */
  UI.renderPending = function () {
    const cont = document.getElementById('pendingList');
    const tag = document.getElementById('pendingCount');
    if (!cont) return;
    const ordenes = (TE.state.pending || []);
    if (tag) tag.textContent = String(ordenes.length);
    setText('tabPendCount', String(ordenes.length));   // contador de la pestaña
    const card = document.getElementById('pendingCard');
    if (card) card.classList.toggle('has-orders', ordenes.length > 0);

    if (!ordenes.length) {
      cont.innerHTML = '<div class="hint">No hay órdenes en espera. Con «⏳ Límite» dejas un ' +
        'precio colocado y se ejecuta al tocarlo; con «🎯 Trigger» dejas una condición que, al ' +
        'dispararse, entra a mercado o coloca un límite; con «🌀 Trailing» el nivel te sigue '
        + '(retrocede un % desde el pico). Las tres dejan de reservar margen mientras esperan.</div>';
      return;
    }

    const ref = App.currentPrice();
    cont.innerHTML = ordenes.map((o) => {
      // Dos clases de orden descanso en la lista: la LÍMITE (su nivel ES el precio de ejecución) y
      // la TRIGGER (su nivel es solo el DISPARO; la ejecución va aparte y puede ser a mercado).
      // Mezclarlas pintaría `undefined` en el precio o diría «faltan X%» desde el sitio equivocado.
      const esTrig = o.tipo === 'trigger';
      const esTrail = o.tipo === 'trailing';
      // En el trailing el nivel ENSEÑADO es el de disparo de AHORA (se mueve con el pico), no un
      // precio fijo: pintar `triggerPrice` daría una cifra que ya no es la que manda.
      const nivel = esTrail ? o.nivel : esTrig ? o.triggerPrice : o.limitPrice;
      const dist = (ref && nivel) ? ((nivel - ref) / ref) * 100 : null;
      let eta;
      if (esTrail) {
        eta = o.armado
          ? `pico ${U.fmtPrice(o.pico)} · retrocede ${U.num(o.callbackPct, 2)} % y se ejecuta`
          : `espera la activación en ${U.fmtPrice(o.triggerPrice)}`;
      } else if (dist === null) eta = '';
      else if (esTrig) {
        eta = Math.abs(dist) < 0.0001 ? 'está tocando el nivel ahora mismo'
          : `faltan ${U.num(Math.abs(dist), 2)} % para activarse (${U.fmtPrice(Math.abs(nivel - ref))} USD)`;
      } else eta = (o.side === 'long'
          ? (dist < 0 ? `faltan ${U.num(Math.abs(dist), 2)}% a la baja (${U.fmtPrice(ref - o.limitPrice)} USD)` : 'se ejecutará en la próxima vela')
          : (dist > 0 ? `faltan ${U.num(dist, 2)}% al alza (${U.fmtPrice(o.limitPrice - ref)} USD)` : 'se ejecutará en la próxima vela'));
      const sub = `tamaño ${o.size}${o.mode === 'pct' ? '%' : o.mode === 'qty' ? ' uds' : ' USD'}` +
        `${o.sl ? ' · SL ' + U.fmtPrice(o.sl) : ''}${o.tp ? ' · TP ' + U.fmtPrice(o.tp) : ''}`;
      const meta = esTrail
        ? `retroceso ${U.num(o.callbackPct, 2)} % · ` +
          (o.triggerPrice > 0 ? `activación por ${o.src === 'mark' ? 'MARK' : 'LAST'} en ${U.fmtPrice(o.triggerPrice)}` : 'sin activación') +
          ` · ejecuta a MERCADO${o.reduceOnly ? ' · reduce-only' : ''}`
        : esTrig
        ? `${o.src === 'mark' ? 'dispara por MARK' : 'dispara por LAST'} · ` +
          (o.exec === 'limit' ? `ejecuta como LÍMITE a ${U.fmtPrice(o.limitPrice)} (puede no rellenarse)` : 'ejecuta a MERCADO (entra sí o sí)') +
          `${o.reduceOnly ? ' · reduce-only' : ''}${o.efecto && o.efecto !== 'GTC' ? ' · ' + o.efecto : ''}`
        : `${o.efecto && o.efecto !== 'GTC' ? 'validez ' + o.efecto + ' · ' : ''}${o.reduceOnly ? 'reduce-only · ' : ''}nivel de ejecución`;
      return `<div class="pending-item ${o.side}${esTrig || esTrail ? ' trig' : ''}">` +
        `<div class="pi-head">` +
          `<span class="pi-side">${esTrail ? '🌀 ' : esTrig ? '🎯 ' : ''}${o.side === 'long' ? '▲ COMPRA' : '▼ VENTA'}</span>` +
          `<b class="pi-price">${U.fmtPrice(nivel)}</b>` +
          `<button class="pi-cancel" data-cancel="${o.id}" title="Cancelar esta orden">✖</button>` +
        `</div>` +
        `<div class="pi-sub">${sub}</div>` +
        `<div class="pi-sub">${meta}</div>` +
        `<div class="pi-eta">${eta}</div>` +
      `</div>`;
    }).join('');

    cont.querySelectorAll('[data-cancel]').forEach((b) => {
      b.addEventListener('click', () => App.cancelOrder(+b.dataset.cancel));
    });

    // Espejo de solo lectura en la pestaña «Órdenes» (ver index.html): se clona la
    // lista y se le quitan los botones de cancelar, que solo funcionan en el
    // original porque ahí es donde están puestos los listeners.
    const espejo = document.getElementById('pendingListTab');
    if (espejo) {
      if (!ordenes.length) {
        espejo.innerHTML = '<div class="hint">Nada en espera: las órdenes límite que colocques ' +
          'aparecerán aquí y en la pestaña Posiciones.</div>';
      } else {
        const c = cont.cloneNode(true);
        c.removeAttribute('id');
        c.querySelectorAll('[data-cancel]').forEach((b) => b.remove());
        espejo.innerHTML = c.innerHTML;
      }
    }
  };

  /* ======================= BUSCADOR DE SÍMBOLOS ======================= */

  UI.symCat = 'favoritos';
  UI.symAll = [];          // lista completa (la real del exchange si hay red)
  UI.symLoaded = false;

  /** Abre el buscador y carga la lista (sin bloquear la interfaz). */
  UI.openSymbols = function () {
    UI.openModal('modalSymbols');
    const q = document.getElementById('symQuery');
    if (q) { q.value = ''; setTimeout(() => q.focus(), 60); }
    // Primer uso (o sin favoritos guardados): abrir en «Principales» para no
    // recibir al usuario con una lista vacía. En cuanto marque una ⭐, la
    // categoría «Favoritos» pasa a ser la de arranque.
    if (UI.symCat === 'favoritos' && !UI.getFavs().length) {
      UI.symCat = 'principales';
      U.$$('#symCats .sym-cat').forEach((x) => x.classList.toggle('active', x.dataset.cat === 'principales'));
      const nota = document.getElementById('symNote');
      if (nota) nota.textContent = 'Marca con ⭐ tus pares favoritos: aparecerán aquí la próxima vez.';
    }
    UI.renderSymbols();                       // pinta ya con la lista local
    if (!UI.symLoaded) {
      DS.fetchSymbols().then((list) => {
        UI.symAll = list;
        UI.symLoaded = true;
        UI.renderSymbols();
        const n = document.getElementById('symNote');
        if (n) n.textContent = list.length + ' pares disponibles en Binance (spot). Marca con ⭐ los que más uses.';
      }).catch(() => {});
    }
  };

  /** Datos auxiliares guardados por el usuario. */
  UI.getFavs = function () { return ST.get('favs', []) || []; };
  UI.getRecents = function () { return ST.get('recents', []) || []; };
  UI.toggleFav = function (symbol) {
    const favs = UI.getFavs();
    const i = favs.indexOf(symbol);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(symbol);
    ST.set('favs', favs.slice(0, 60));
    U.toast(i >= 0 ? '⭐ Quitado de favoritos' : '⭐ Añadido a favoritos', 'info', 1400);
    UI.renderSymbols();
  };

  /** Color identificativo de la moneda base (mismo color siempre para cada una). */
  UI.symColor = function (base) {
    const PALETA = ['#f7931a', '#627eea', '#14f195', '#f0b90b', '#e8e8e8', '#00c853',
      '#ff1744', '#00e5ff', '#b388ff', '#ffab40', '#7c4dff', '#26c6da'];
    let h = 0;
    for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) % 997;
    return PALETA[h % PALETA.length];
  };

  /**
   * Pinta la lista según categoría y búsqueda.
   * Categorías: favoritos · recientes · principales · por divisa (USDT, USDC,
   * BTC, ETH) · todos. Todo sale de la lista real del exchange cuando hay red.
   */
  UI.renderSymbols = function () {
    const cont = document.getElementById('symList');
    if (!cont) return;
    const q = (document.getElementById('symQuery').value || '').trim().toUpperCase();
    const base = UI.symAll.length ? UI.symAll : DS.localSymbols();
    const favs = UI.getFavs();
    const recents = UI.getRecents();
    const cat = UI.symCat;

    // 1) Filtro por categoría
    let lista = base;
    if (cat === 'favoritos') lista = favs.map((s) => base.find((x) => x.symbol === s) || { symbol: s, base: DS.baseOf(s), quote: DS.quoteOf(s), label: DS.label(s) });
    else if (cat === 'recientes') lista = recents.map((s) => base.find((x) => x.symbol === s) || { symbol: s, base: DS.baseOf(s), quote: DS.quoteOf(s), label: DS.label(s) });
    else if (cat === 'principales') lista = base.filter((x) => x.main);
    else if (cat !== 'todos') lista = base.filter((x) => x.quote === cat);

    // 2) Filtro por texto (símbolo o nombre)
    if (q) {
      lista = lista.filter((x) => x.symbol.toUpperCase().indexOf(q) >= 0 || x.label.toUpperCase().indexOf(q) >= 0);
      if (!lista.length && q.length >= 2) {
        // Quizá están buscando fuera de la categoría: buscamos en toda la lista
        const alt = base.filter((x) => x.symbol.toUpperCase().indexOf(q) >= 0);
        if (alt.length) { lista = alt; }
      }
    }

    const max = 300;
    const total = lista.length;
    lista = lista.slice(0, max);

    const cnt = document.getElementById('symCount');
    if (cnt) cnt.textContent = total
      ? total + (total === 1 ? ' par' : ' pares') + (total > max ? ' · mostrando ' + max : '')
      : 'sin resultados';

    if (!lista.length) {
      cont.innerHTML = '<div class="hint">' + (cat === 'favoritos'
        ? 'Todavía no tienes favoritos: busca un par y pulsa la ⭐ de su fila.'
        : 'No hay resultados para «' + U.esc(q) + '».') + '</div>';
      return;
    }

    cont.innerHTML = lista.map((x) => {
      const activo = x.symbol === document.getElementById('pairSelect').value;
      const esFav = favs.indexOf(x.symbol) >= 0;
      const color = UI.symColor(x.base);
      return `<div class="sym-row ${activo ? 'active' : ''}" data-sym="${x.symbol}">` +
        `<span class="sym-ico" style="background:${color}22;color:${color};border-color:${color}66">${U.esc(x.base.slice(0, 3))}</span>` +
        `<span class="sym-name"><b>${U.esc(x.label)}</b><i>${U.esc(x.symbol)}${x.main ? ' · principal' : ''}</i></span>` +
        `<span class="sym-actions">` +
          `<button class="sym-fav ${esFav ? 'on' : ''}" data-fav="${x.symbol}" title="${esFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">${esFav ? '★' : '☆'}</button>` +
        `</span>` +
      `</div>`;
    }).join('');

    // Filas: elegir el símbolo
    cont.querySelectorAll('.sym-row').forEach((el) => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.sym-fav')) return;
        UI.pickSymbol(el.dataset.sym);
      });
    });
    // Estrellas: favoritos
    cont.querySelectorAll('[data-fav]').forEach((b) => {
      b.addEventListener('click', (ev) => { ev.stopPropagation(); UI.toggleFav(b.dataset.fav); });
    });
  };

  /** Cambia el par activo, lo apunta en «recientes» y recarga los datos. */
  UI.pickSymbol = function (symbol) {
    const sel = document.getElementById('pairSelect');
    if (!sel.querySelector('option[value="' + symbol + '"]')) {
      const o = document.createElement('option');
      o.value = symbol; o.textContent = DS.label(symbol);
      sel.appendChild(o);
    }
    sel.value = symbol;

    const recents = UI.getRecents().filter((s) => s !== symbol);
    recents.unshift(symbol);
    ST.set('recents', recents.slice(0, 12));

    UI.updateSymbolButton();
    UI.closeModal('modalSymbols');

    // Cerrar lo que pertenecía a la serie anterior (misma razón que al cambiar TF)
    App.guardSeriesChange('cambiar de par');

    U.toast('🔎 ' + DS.label(symbol) + ' seleccionado: cargando velas…', 'info', 2400);
    const seguia = BR.isPlaying();                            // si estaba reproduciendo, que siga
    App.loadDataFromForm({ silent: true, keepFocus: true })   // recarga automática, como en un terminal
      .catch(() => {})
      .then(() => { UI.refreshStats(true); UI.renderSymbols(); if (seguia) App.togglePlay(); });
  };

  /** Refresca el botón grande de símbolo que hay en la barra superior. */
  UI.updateSymbolButton = function () {
    const sel = document.getElementById('pairSelect');
    if (!sel) return;
    const sym = sel.value;
    const pares = DS.label(sym).split('/');
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('sbPair', DS.label(sym));
    set('sbQuote', (pares[1] || '') + ' · Binance');
    set('sbIco', (pares[0] || '?').slice(0, 3));
    const ico = document.getElementById('sbIco');
    if (ico) {
      const c = UI.symColor(pares[0] || 'X');
      ico.style.color = c;
      ico.style.background = c + '22';
      ico.style.borderColor = c + '66';
    }
  };

  /**
   * Cambia la temporalidad y recarga los datos (como al elegir par).
   * @param {string} tf
   * @param {{force?: boolean}} [opts] force = viene del desplegable, que ya
   *        cambió su valor: hay que recargar aunque coincida con la activa.
   */
  UI.setTimeframe = function (tf, opts = {}) {
    if (!DS.TIMEFRAMES[tf]) { U.toast('Temporalidad no válida', 'err'); return; }
    const sel = document.getElementById('tfSelect');
    if (!opts.force && sel.value === tf && App.interval === tf) { UI.syncTfButtons(); return; }
    sel.value = tf;
    UI.syncTfButtons();

    // La posición abierta y las órdenes pendientes pertenecen a la serie
    // anterior: se cierran/cancelan antes de traer las velas nuevas.
    App.guardSeriesChange('cambiar de temporalidad');

    U.toast('⏱️ Temporalidad ' + DS.TIMEFRAMES[tf].label + ': cargando velas…', 'info', 2200);
    // keepFocus: el replay se queda en la misma fecha, no vuelve al inicio.
    const seguia = BR.isPlaying();          // si estaba reproduciendo, que siga
    return App.loadDataFromForm({ silent: true, keepFocus: true })
      .catch(() => {})
      .then(() => { UI.refreshStats(true); if (seguia) App.togglePlay(); });
  };

  /** Marca como activa la temporalidad pulsada en los botones rápidos. */
  UI.syncTfButtons = function () {
    const actual = document.getElementById('tfSelect').value;
    U.$$('#tfQuick .tf-btn').forEach((b) => b.classList.toggle('active', b.dataset.tf === actual));
  };

  /* --------------------------------- Atajos --------------------------------- */

  UI._wireKeyboard = function () {
    document.addEventListener('keydown', (e) => {
      // Ctrl/⌘+K: buscar símbolo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); UI.openSymbols(); return;
      }
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'select' || tag === 'textarea';

      // Ctrl+S: guardar sesión (funciona incluso escribiendo)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        document.getElementById('btnSessions').click();
        return;
      }
      if (e.key === 'Escape') {
        if (U.$$('.modal.open').length) { UI.closeAllModals(); e.preventDefault(); return; }
        if (DT.tool !== 'cursor') { DT.setTool('cursor'); return; }
        if (DT.draft) { DT.cancelDraft(); return; }
        if (!typing) App.flatten();
        return;
      }
      if (typing) return;

      switch (e.key) {
        case ' ': {
          /* La barra SOLO reproduce/pausa si lo enfocado no es un control que ya la
             use. Antes se hacía `preventDefault()` sin mirar: un botón de la barra de
             replay enfocado (por ejemplo «Indicadores») no recibía su click nativo y
             la tecla no hacía lo que uno espera del teclado -lo medía
             tools/barrido-graficos.js como «Teclado sobre un botón enfocado», con
             0 clicks tras la barra y 1 tras Enter—. Sin `preventDefault`, el navegador
             dispara el click del botón enfocado y la reproducción no se toca; si no hay
             nada enfocado (o es el propio cuerpo), la tecla es nuestra. */
          const t = document.activeElement;
          const control = t && t !== document.body && t.tabIndex >= 0
            && /^(BUTTON|A|SUMMARY|SELECT)$/.test(t.tagName);
          if (control) break;
          e.preventDefault(); App.togglePlay(); break;
        }
        case 'ArrowRight':
          e.preventDefault(); App.stepForward(); break;
        case 'ArrowLeft':
          e.preventDefault(); App.stepBack(); break;
        // B / S → según el tipo elegido (mercado o límite)
        case 'b': case 's': App.placeOrder(e.key === 'b' ? 'long' : 'short'); break;
        // Mayús+B / Mayús+S → SIEMPRE orden límite, aunque estés en modo mercado
        // (la función real es placeLimitOrder: antes se llamaba a una que no
        // existía y el atajo lanzaba un TypeError sin hacer nada)
        case 'B': App.placeLimitOrder('long'); break;
        case 'S': App.placeLimitOrder('short'); break;
        case 't': case 'T': {
          // Los cuatro tipos del selector (F1), en el mismo orden que en el panel del exchange.
          const orden = ['market', 'limite', 'trigger', 'trailing'];
          UI.setOrderType(orden[(orden.indexOf(App.orderType) + 1) % orden.length]);
          break;
        }
        case '/': e.preventDefault(); UI.openSymbols(); break;
        case 'a': case 'A': DT.setTool('arrow'); break;
        case 'p': case 'P': DT.setTool('path'); break;
        case 'Enter': if (DT.draft) { e.preventDefault(); DT.finishDraft(); } break;
        case 'r': case 'R': App.resetReplay(); break;
        // Cierre parcial de la posición (50%) y SL al break-even
        case 'c': case 'C': App.partialClose(50); break;
        case 'e': case 'E': App.slToBreakEven(); break;
        // V → trailing stop on/off (t con minúscula ya cambia el tipo de orden)
        case 'v': case 'V': App.toggleTrailing(); break;
        case 'Delete': case 'Backspace': DT.deleteSelected(); break;
        case '+': case '=': case 'PageUp': App.bumpSpeed(1); break;
        case '-': case '_': case 'PageDown': App.bumpSpeed(-1); break;
        case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9': {
          const tools = ['cursor', 'trend', 'ray', 'hline', 'vline', 'rect', 'channel', 'fib', 'measure', 'arrow', 'path'];
          DT.setTool(tools[+e.key - 1] || 'cursor');
          break;
        }
      }
    });
  };

  /* =============================== REFRESCO UI =============================== */

  UI._wireEvents = function () {
    // El motor de trading avisa de cambios → refrescar barra lateral
    global.addEventListener('te:update', () => UI.refreshAccount());
    // Cambios en los dibujos → refrescar lista y contador
    DT.onChange = () => {
      DT.renderList(document.getElementById('drawList'));
      const el = document.getElementById('tabDrawCount');
      if (el) el.textContent = DT.drawings.length;
    };
    // Arrastre de los handles del gráfico: SL/TP de la posición y niveles de las
    // órdenes límite (estas últimas se delegan en App.moveLimitOrder, que además
    // ejecuta el límite si al soltarlo queda cruzado con el precio).
    UI.initPositionManagement();
    DT.onTradeHandle = (id, price, phase) => {
      if (typeof id === 'string' && id.indexOf('limit:') === 0) {
        const oid = +id.slice(6);
        if (price !== null) App.moveLimitOrder(oid, price, phase === 'end' ? 'end' : 'move');
        return;
      }
      if (phase === 'move' && price !== null) {
        // En silencio: el arrastre produce decenas de eventos, solo el último
        // debe dejar rastro en el registro.
        if (id === 'sl') TE.setSL(price, { silent: true }); else TE.setTP(price, { silent: true });
        UI.refreshPosition();
      }
      if (phase === 'end') {
        // Al soltar se CONSOLIDA el nivel con la validación normal: si el último
        // movimiento quedó invalidado (p. ej. un SL sobre la entrada), aquí se
        // rechaza con su aviso y el log refleja el valor FINAL, no el del gesto.
        const pos = TE.state.position;
        if (pos && price !== null) {
          const actual = id === 'sl' ? pos.sl : pos.tp;
          if (actual === null || Math.abs(actual - price) > 1e-9) {
            if (id === 'sl') TE.setSL(price); else TE.setTP(price);
          } else {
            U.log(`🛠 ${id.toUpperCase()} ajustado a ${U.fmtPrice(price)} arrastrando`, 'warn');
          }
        }
        if (price !== null) U.log(`🖱️ ${id.toUpperCase()} ajustado en el gráfico a ${U.fmtPrice(price)}`, 'warn');
        U.playSound('click');
      }
    };
    /* La × de la etiqueta dibujada sobre la carta QUITA el nivel, como en su modo concentrado. Se
       limpia con el setter del motor a null (el único camino que avisa si el modo de riesgo exige SL),
       se refleja en los campos del formulario -si no, la carta diría una cosa y la caja otra- y se
       cuenta en el registro. */
    /* ── EL BILLETE DE ORDEN VISUAL (§5.8) ─────────────────────────────────────────────
       El vídeo de Bitunix coloca la orden arrastrando sobre la carta: el billete flota en el punto,
       trae importe, tipo, lado y el riel de %, y un ✓. Aquí el billete no tiene aritmética propia:
       escribe en #sizeInput / #limitInput, presta el rótulo del campo de SIZE_LABELS (la misma fuente
       que el formulario), deja que el riel de % dispare los botones `#quickSize [data-pct]` que ya
       hacen la cuenta contra el saldo, y para colocar PULSA el botón de lado del panel -así que las
       validaciones, el modo de riesgo, los TP/SL y el registro siguen siendo un único camino-. */
    const BIL = document.getElementById('bfBillete');
    if (BIL) {
      const B = {
        abierto: false, ladoActivo: 'long', tipoActivo: 'limite', precio: null, editar: null,
        el: (id) => document.getElementById(id),
        abre(d) {
          const env = document.getElementById('chartWrap'), r = env.getBoundingClientRect();
          B.precio = Number.isFinite(d.price) ? d.price : (App.currentPrice() || null);
          B.abierto = true;
          BIL.hidden = false;
          const ancho = Math.min(298, r.width - 16);
          /* `xDerecha` es para el menu de la linea: el panel tiene que TERMINAR a la izquierda del
             disco (que es lo que hace su menú, pegado al eje de precio), mientras que en la colocacion
             arranca 14 px a la derecha del punto del golpe. Con el ancho fijo de 298, anclarlo al punto
             del clic dejaba el panel 2 px encima de su propio +, y ahi ya no se puede volver a abrir. */
          const x = Number.isFinite(d.xDerecha)
            ? Math.max(8, Math.min(Math.round(d.xDerecha - ancho - 8), r.width - ancho - 8))
            : Math.max(8, Math.min(d.x + 14, r.width - ancho - 8));
          BIL.style.left = x + 'px'; BIL.style.top = Math.max(8, d.y - 40) + 'px'; BIL.style.right = 'auto';
          const pre = B.el('bfBilletePrecio');
          pre.value = B.precio === null ? '' : U.round(B.precio, CM.decimales || 2);
          pre.readOnly = B.tipoActivo === 'market';
          const modo = (App.sizeMode === 'riesgo' ? 'notional' : App.sizeMode);
          if (UI.SIZE_LABELS && UI.SIZE_LABELS[modo]) B.el('bfBilleteQtyLab').textContent = UI.SIZE_LABELS[modo][0];
          B.el('bfBilleteQty').value = B.el('sizeInput').value || '';
          document.body.dataset.billeteLado = B.ladoActivo;
          B.cuesta();
          /* Reclocado AL FINAL, con el billete ya completo: medir la altura justo despues de quitar el
             `hidden` da 269 por 279 reales (la cabecera y el rotulo del tamano crecen despues) y el
             billete se salia 2 px por debajo del area de carta. Si aun asi no cabe, se sube y el
             `max-height` de la hoja le mete barra de desplazamiento en vez de desbordar la carta. */
          /* El panel vuelve a su forma de colocacion en cada apertura. Dos cosas: la fila de chispas
             es del menu de edicion, no del billete de la herramienta (dejarla siempre visible le anadia
             40 px al panel que §5.8 midio y anclo); y el tipo recordado hay que repintarlo, porque si no
             el `readOnly` del precio y el boton activo vienen del billete anterior y el ✓ coloca lo que
             la persona no esta viendo. */
          B.el('bfBilleteChips').hidden = !B.editar;
          B.el('bfBilleteCancela').hidden = !B.editar;
          document.querySelector('.bf-billete-riel').hidden = false;
          [...document.querySelectorAll('#bfBillete .bf-billete-campo')][1].hidden = false;
          B.el('bfBilleteTipo').hidden = false;
          B.marcaTipo(B.tipoActivo);
          /* Y las chispas se encienden con lo que ya lleva el formulario: abrir el menu de una linea y
             no ver cual de los cinco botones esta puesto es media respuesta. */
          if (B.sincChips) B.sincChips();
          const real = BIL.getBoundingClientRect();
          if (real.y - r.y + real.height > r.height - 8) {
            BIL.style.top = Math.max(8, Math.round(r.height - real.height - 8)) + 'px';
          }
          DT.ensenaTicket({ x: d.x, y: DT._yOf(B.precio), price: B.precio, color: B.ladoActivo === 'long' ? '#24c18d' : '#f14b3f' });
          B.el('bfBilleteQty').focus();
        },
        cierra() {
          B.abierto = false; BIL.hidden = true; B.editar = null;
          const cancela = B.el('bfBilleteCancela'); if (cancela) cancela.hidden = true;
          [...document.querySelectorAll('#bfBillete .bf-billete-campo')][1].hidden = false;
          B.el('bfBilleteChips').hidden = true;
          B.el('bfBilleteTipo').hidden = false;
          document.querySelector('.bf-billete-riel').hidden = false;
          DT.ensenaTicket(null);
        },
        /* La linea de arriba del panel suyo es el SALDO («Available 3,946.1 USDT ⇄», fotograma 18,6 s
           del clip), no un rótulo: aqui repetia el rotulo y el numero del campo de abajo, que ya estan
           escritos en su propia fila -la captura del §5.8 lo dejo ver-. El importe se lee de `#bfAvail`,
           el numero que la barra de la cabecera calcula y refresca el propio `refreshAll`, asi que el
           billete no puede separarse de el, y la etiqueta es la suya misma («Balance libre»). El porcentaje
           del saldo solo se calcula cuando el numero es dinero (en modo `pct` el numero YA es un
           porcentaje); el rotulo de la unidad (SIZE_LABELS) ya no se presta, porque el saldo no la lleva. */
        cuesta() {
          const modo = App.sizeMode;
          const lab = (UI.SIZE_LABELS && UI.SIZE_LABELS[modo]) || ['Importe (USDT)', ''];
          const v = parseFloat(B.el('bfBilleteQty').value) || 0;
          const av = B.el('acFree') || B.el('bfAvail');
          const saldo = av ? String(av.textContent || '').trim() : '';
          let txt = 'Balance libre ' + (saldo || '—');
          if (modo === 'notional') {
            const eq = TE.state.equity || 0;
            if (eq > 0) txt += ' · ' + U.num((v / eq) * 100, 2) + ' % del saldo';
          }
          B.el('bfBilleteCoste').textContent = txt;
        },
        escribeCampo() {
          const t = B.el('bfBilleteQty'), s = B.el('sizeInput');
          if (s && t.value !== s.value) { s.value = t.value; s.dispatchEvent(new Event('input', { bubbles: true })); }
          if (B.tipoActivo === 'limite') {
            const p = B.el('bfBilletePrecio'), l = B.el('limitInput');
            const v = parseFloat(p.value);
            if (l && Number.isFinite(v) && String(l.value) !== String(v)) { l.value = v; l.dispatchEvent(new Event('input', { bubbles: true })); }
          }
          B.cuesta();
        },
        /* Se coloca POR el boton del formulario, no a traves de una ruta propia: asi las validaciones,
           el modo de riesgo, los TP/SL marcados y el registro son exactamente los mismos. Y se cierra
           solo si la cuenta cambio de verdad -si el formulario la rechaza, el billete se queda abierto
           con su motivo encima-, por eso se compara antes y despues en vez de fiarse del click. */
        coloca() {
          const e = B.editar;
          if (e && (e.tipo === 'sl' || e.tipo === 'tp')) {
            /* Un nivel NO lleva tamano: lo pone la posicion. El ✓ escribe el precio en el motor, que es
               quien valida (SL por debajo de la entrada, TP por encima) y quien avisa si el modo de
               riesgo no deja quitarlo. */
            const v = parseFloat(B.el('bfBilletePrecio').value);
            if (!Number.isFinite(v)) { U.toast('Falta el precio del nivel', 'warn'); return; }
            if (e.tipo === 'sl') TE.setSL(v); else TE.setTP(v);
            UI.refreshPosition();
            if (UI.syncTpSl) UI.syncTpSl();
            U.log(`🖱️ ${e.tipo.toUpperCase()} editado desde la etiqueta de la carta a ${U.fmtPrice(v)}`, 'warn');
            B.cierra();
            return;
          }
          B.escribeCampo();
          if (UI.setOrderType) UI.setOrderType(e ? 'limite' : B.tipoActivo);
          const cuenta = () => (TE.state.position ? 1 : 0) + (TE.state.pending || []).length;
          const antes = cuenta();
          if (e && e.tipo === 'limit') App.cancelOrder(e.id);   // editar = retirar la pendiente y volver a colocarla, como su menu
          const boton = B.el(B.ladoActivo === 'long' ? 'btnLong' : 'btnShort');
          if (boton) boton.click();
          const despues = cuenta();
          if (e && e.tipo === 'limit') {
            /* Editar no suma: retira una pendiente y coloca otra, asi que el total tiene que salir el
               mismo. Cerrar con `cuenta() > antes` nunca cerraba el billete (y el aviso de rechazo se
               disparaba al reves), y dejar el billete abierto sobre la linea tapando su propio disco es
               la peor manera de terminar una edicion. */
            if (despues >= antes) B.cierra();
            else U.toast('La orden nueva fue rechazada: la antigua queda retirada - revisa el aviso del formulario', 'err', 5200);
          } else if (despues > antes) B.cierra();
        },
        /* El disco con + de una linea abre el billete SOBRE esa linea, con su contenido dentro. Es el
           equivalente a su menu de orden visual (add alert / set order / trigger / cancel / to price),
           del que SOLO se copian las filas que aqui tienen detras una accion real: no hay sistema de
           alertas en este terminal, asi que esa fila no se inventa. */
        desdeLinea(id, donde) {
          const h = (DT.tradeHandles || []).find((x) => x.id === id);
          if (!h) return;
          B.editar = null;
          const lim = /^limit:(\d+)$/.exec(id);
          if (lim) {
            const o = (TE.state.pending || []).find((x) => String(x.id) === lim[1]);
            if (!o) return;
            B.editar = { tipo: 'limit', id: o.id };
            B.ladoActivo = o.side === 'short' ? 'short' : 'long';
            B.tipoActivo = 'limite';
          } else if (id === 'sl' || id === 'tp') {
            B.editar = { tipo: id };
            B.ladoActivo = (TE.state.position && TE.state.position.side === 'short') ? 'short' : 'long';
          }
          /* El billete se sienta a la IZQUIERDA del disco, no encima: si lo anclasemos al punto del
             golpe, el panel taparia la linea que esta editando (y su propio + para volver a abrirlo). */
          B.abre({ x: (donde.x || 0) - 306, y: donde.y, xDerecha: donde.x, price: h.price });
          const cancela = B.el('bfBilleteCancela');
          if (cancela) {
            cancela.hidden = !B.editar;
            cancela.textContent = B.editar ? (B.editar.tipo === 'limit' ? 'Cancelar orden'
              : (B.editar.tipo === 'sl' ? 'Quitar SL' : 'Quitar TP')) : 'Cancelar orden';
          }
          /* En modo nivel el tamano no pinta: se esconde su campo, sus chispas y su riel, en vez de
             dejarlos alli mudos. */
          const sinTamano = !!(B.editar && (B.editar.tipo === 'sl' || B.editar.tipo === 'tp'));
          [...document.querySelectorAll('#bfBillete .bf-billete-campo')][1].hidden = sinTamano;
          /* El tipo, fuera en modo edicion: una pendiente es por definicion limite, y ofrecer
             `Mercado` aqui significaria prometer una orden que no puede quedar colgada. Su menu si
             trae un segmentado (Limit | Fixed Risk), pero ese segundo boton es el modo de riesgo del
             margen, que aqui vive en otro sitio: preferimos no copiar la fila a copiarla mintiendo. */
          B.el('bfBilleteTipo').hidden = !!B.editar;
          B.el('bfBilleteChips').hidden = sinTamano || !B.editar;
          document.querySelector('.bf-billete-riel').hidden = sinTamano || !B.editar;
        },
        quita() {
          const e = B.editar;
          if (!e) return;
          if (e.tipo === 'limit') App.cancelOrder(e.id);
          else if (e.tipo === 'sl') { TE.setSL(null); const c = B.el('slInput'); if (c) c.value = ''; }
          else { TE.setTP(null); const c = B.el('tpInput'); if (c) c.value = ''; }
          if (UI.syncTpSl) UI.syncTpSl();
          UI.refreshPosition();
          B.cierra();
        },
        marcaLado(v) {
          B.ladoActivo = v;
          document.querySelectorAll('#bfBilleteLado .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.blado === v));
          document.body.dataset.billeteLado = v;
          DT.ensenaTicket(B.abierto ? { x: (DT._ticketPreview && DT._ticketPreview.x) || 0, y: DT._yOf(B.precio), price: B.precio, color: v === 'long' ? '#24c18d' : '#f14b3f' } : null);
        },
        marcaTipo(v) {
          B.tipoActivo = v;
          document.querySelectorAll('#bfBilleteTipo .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.btipo === v));
          B.el('bfBilletePrecio').readOnly = v === 'market';
          B.el('bfBilletePrecio').title = v === 'market' ? 'A mercado no hay precio: se ejecuta con la vela actual' : '';
        },
      };
      UI.billete = B;
      DT.onTicket = (d) => B.abre(d);
      BIL.addEventListener('mousedown', (e) => e.stopPropagation());   // que el billete no mueva la carta
      BIL.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      B.el('bfBilleteX').addEventListener('click', () => B.cierra());
      B.el('bfBilleteOk').addEventListener('click', () => B.coloca());
      B.el('bfBilleteQty').addEventListener('input', () => B.escribeCampo());
      B.el('bfBilletePrecio').addEventListener('input', () => {
        const v = parseFloat(B.el('bfBilletePrecio').value);
        if (Number.isFinite(v)) { B.precio = v; DT.ensenaTicket({ x: (DT._ticketPreview && DT._ticketPreview.x) || 0, y: DT._yOf(v), price: v, color: B.ladoActivo === 'long' ? '#24c18d' : '#f14b3f' }); }
      });
      document.querySelectorAll('#bfBilleteLado .seg-btn').forEach((b) => b.addEventListener('click', () => B.marcaLado(b.dataset.blado)));
      /* El tipo del billete es el del formulario: cambiarlo aqui cambia `#segOrderType` (y su activado),
         no hay dos estados que se separan. */
      document.querySelectorAll('#bfBilleteTipo .seg-btn').forEach((b) => b.addEventListener('click', () => { B.marcaTipo(b.dataset.btipo); if (UI.setOrderType) UI.setOrderType(b.dataset.btipo); }));
      /* El riel no calcula nada: dispara el boton de porcentaje del formulario, que es donde vive la
         cuenta contra el saldo (y si el tramo no esta, se pone 0). */
      B.el('bfBilletePct').addEventListener('input', (e) => {
        const p = +e.target.value;
        const boton = document.querySelector('#quickSize [data-pct="' + p + '"]');
        if (boton) boton.click(); else { const s = B.el('sizeInput'); s.value = p ? s.value : '0'; s.dispatchEvent(new Event('input', { bubbles: true })); }
        B.el('bfBilleteQty').value = B.el('sizeInput').value || '';
        B.cuesta();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && B.abierto) { B.cierra(); e.stopPropagation(); }
      });
      DT.onTradePlus = (id, donde) => B.desdeLinea(id, donde);
      B.el('bfBilleteCancela').addEventListener('click', () => B.quita());
      /* Las chispas de tamano se clonan de #quickSize: mismo texto, mismo numero y MISIMO boton, que es
         el que hace la cuenta contra el saldo. No hay lista de porcentajes propia que se pueda separar. */
      const origen = [...document.querySelectorAll('#quickSize [data-pct]')];
      if (origen.length) {
        const caja = B.el('bfBilleteChips');
        caja.innerHTML = '';
        origen.forEach((b) => {
          const c = document.createElement('button');
          c.type = 'button'; c.className = 'bf-chip'; c.dataset.pct = b.dataset.pct;
          c.textContent = b.dataset.pct + ' %';   // la cifra viene del boton clonado; el signo, del riel
          c.title = 'Igual que el acceso rápido del formulario: ' + c.textContent;
          c.addEventListener('click', () => {
            b.click();
            B.el('bfBilleteQty').value = B.el('sizeInput').value || '';
            B.cuesta(); B.sincChips();
          });
          caja.appendChild(c);
        });
        B.sincChips = () => {
          const activo = document.querySelector('#quickSize [data-pct].active');
          [...caja.children].forEach((c) => c.classList.toggle('active', !!activo && c.dataset.pct === activo.dataset.pct));
        };
      }
      B.marcaTipo('limite');
    }

    /* La × de la etiqueta dibujada sobre la carta QUITA el nivel, como en su modo concentrado. Se
       limpia con el setter del motor a null (el unico camino que avisa si el modo de riesgo exige SL),
       se refleja en los campos del formulario -si no, la carta diria una cosa y la caja otra- y se
       cuenta en el registro. */
    DT.onTradeClear = (id) => {
      /* La x del final de la pastilla. Para una pendiente es `cancelar la orden` (que es lo que significa
         ese compartimento en su cartel), no «quitar un nivel»: se comprueba antes de mirar a la posicion,
         porque una orden puede estar colgada sin ninguna posicion abierta. */
      const lim = /^limit:(\d+)$/.exec(String(id));
      if (lim) {
        App.cancelOrder(+lim[1]);
        return;
      }
      const pos = TE.state.position;
      if (!pos) return;
      if (id !== 'sl' && id !== 'tp') return;
      const nombre = id.toUpperCase();
      if (id === 'sl') TE.setSL(null); else TE.setTP(null);
      const campo = document.getElementById(id === 'sl' ? 'slInput' : 'tpInput');
      if (campo) campo.value = '';
      if (UI.syncTpSl) UI.syncTpSl();
      UI.refreshPosition();
      if (UI.refreshAll) UI.refreshAll();
      U.log(`✖ ${nombre} quitado desde la etiqueta de la carta`, 'warn');
      U.toast(`${nombre} quitado desde la carta`, 'info', 1800);
    };
    // Al cambiar el tamaño de la ventana, redibujar dibujos
    global.addEventListener('resize', () => { DT.resize(); DT.render(); });
  };

  /**
   * Mientras se arrastra una orden límite, actualiza SOLO los textos que cambian
   * (el campo de precio y la fila de la lista). Un render completo en cada
   * mousemove mataría el hover del panel.
   */
  UI.syncLimitDrag = function (o) {
    const inp = document.getElementById('limitInput');
    if (inp && document.activeElement !== inp) inp.value = o.limitPrice.toFixed(2);
    const items = document.querySelectorAll('#pendingList .pending-item');
    const i = (TE.state.pending || []).findIndex((x) => x.id === o.id);
    const it = i >= 0 ? items[i] : null;
    if (it) {
      const b = it.querySelector('.pi-price');
      if (b) b.textContent = U.fmtPrice(o.limitPrice);
    }
  };

  /**
   * Controles de gestión de la posición (promediar / cerrar parcial / TP
   * escalonado), en la propia tarjeta «📈 Posición abierta».
   */
  UI.initPositionManagement = function () {
    const $ = (id) => document.getElementById(id);

    const btnAvg = $('btnAverage');
    if (btnAvg) btnAvg.addEventListener('click', () => {
      const size = parseFloat(($('avgSize') || {}).value);
      if (!Number.isFinite(size) || size <= 0) { U.toast('Indica un tamaño mayor que 0 para promediar', 'err'); return; }
      const chk = $('avgReaim');
      App.averagePosition(size, { reaim: !!(chk && chk.checked) });
    });

  /** Pinta el conmutador de modo y el de papel de la orden según el estado real de la cuenta. */
  UI.syncPosModo = function () {
    const modo = TE.state.modoPosicion || 'ONE_WAY';
    const seg = document.getElementById('segPosMode');
    if (seg) [...seg.querySelectorAll('.seg-btn')].forEach((b) => b.classList.toggle('active', b.dataset.pmode === modo));
    const lado = document.getElementById('segTradeSide');
    if (lado) {
      // «Cerrar» no significa nada en ONE-WAY (allí la orden contraria ya reduce), así que solo
      // se ofrece en hedge: un control que no cambia nada es ruido en un formulario de órdenes.
      lado.style.display = modo === 'HEDGE' ? '' : 'none';
      [...lado.querySelectorAll('.seg-btn')].forEach((b) => b.classList.toggle('active', b.dataset.tside === (App.tradeSide || 'open')));
    }
    // El apalancamiento por lado solo existe en hedge; en one-way la fila se oculta (no se deja un
    // control que no cambia nada).
    UI.syncLevLados();
  };

  (function () {
    const seg = document.getElementById('segPosMode');
    if (seg) seg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pmode]');
      if (!b) return;
      App.setPosicionModo(b.dataset.pmode);
      UI.refreshAll();
    });
    const ts = document.getElementById('segTradeSide');
    if (ts) ts.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tside]');
      if (!b) return;
      App.tradeSide = b.dataset.tside === 'close' ? 'close' : 'open';
      UI.syncPosModo();
      U.toast(App.tradeSide === 'close'
        ? 'Este formulario CERRARÁ la posición del lado contrario (no puede abrir en contra)'
        : 'Este formulario ABRIRÁ posición en su propio lado', 'info', 3000);
    });
    const lado = document.getElementById('segPosLado');
    if (lado) lado.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lado]');
      if (!b) return;
      App.posLado = b.dataset.lado;
      UI.refreshPosition();
      // La tarjeta cambia de lado, pero las líneas del gráfico son de las DOS: esconder los
      // niveles de la posición no mostrada invitaría a creer que no tiene SL.
      UI.syncPositionGraphics(App.posicionActiva());
      if (global.CM && CM.setPositionLines) CM.setPositionLines(TE.posiciones());
    });
  })();

    const card = $('positionCard');
    if (card) card.addEventListener('click', (e) => {
      const partial = e.target.closest('[data-partial]');
      if (partial) { App.partialClose(parseFloat(partial.dataset.partial)); return; }
      const rm = e.target.closest('[data-rm-level]');
      if (rm) { App.removeTpLevel(rm.dataset.rmLevel); return; }
    });

    const btnBE = $('btnSlBE');
    if (btnBE) btnBE.addEventListener('click', () => App.slToBreakEven());

    // 🌀 Trailing stop: activar / re-ajustar / quitar
    const btnTrail = $('btnTrailOn');
    if (btnTrail) btnTrail.addEventListener('click', () => {
      const pct = parseFloat(($('trailPct') || {}).value);
      const raw = (($('trailAct') || {}).value || '').trim();
      if (!Number.isFinite(pct) || pct <= 0) { U.toast('Indica un retracement (%) mayor que 0', 'err'); return; }
      App.setTrailing(pct, raw === '' ? null : parseFloat(raw));
    });
    const btnTrailOff = $('btnTrailOff');
    if (btnTrailOff) btnTrailOff.addEventListener('click', () => App.trailingOff());
    const inpTrailPct = $('trailPct');
    if (inpTrailPct) inpTrailPct.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const b = $('btnTrailOn'); if (b) b.click(); }
    });

    const btnLvl = $('btnTpLevel');
    if (btnLvl) btnLvl.addEventListener('click', () => App.addTpLevelFromForm());
    const inpLvl = $('tpLvlPrice');
    if (inpLvl) inpLvl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); App.addTpLevelFromForm(); }
    });
  };

  /** Lista de niveles de TP escalonado de la posición abierta. */
  UI.renderTpLevels = function (p) {
    const cont = document.getElementById('tpLevelsList');
    if (!cont) return;
    const lvs = (p && p.tpLevels) || [];
    if (!lvs.length) {
      cont.innerHTML = '<div class="hint hint-tiny">Sin niveles. Añade uno para tomar ganancias por partes: cada nivel cierra su % y el resto sigue vivo con su SL.</div>';
      return;
    }
    const dir = p.side === 'long' ? 1 : -1;
    cont.innerHTML = lvs.map((l, i) => {
      const pctPrecio = ((l.price - p.entryPrice) / p.entryPrice) * 100 * dir;
      return `<div class="tp-lvl"><span class="tp-dot">${i + 1}</span>` +
             `<b>${U.fmtPrice(l.price)}</b><span class="tp-meta">${U.num(l.pct * 100, 0)}% · ${U.fmtPct(pctPrecio, 2, true)}</span>` +
             `<button class="mini-btn" data-rm-level="${i}" title="Quitar este nivel">✖</button></div>`;
    }).join('');
  };

  /** Refresco completo. */
  UI.refreshAll = function () {
    UI.refreshAccount();
    UI.refreshStats();
    UI.refreshReplayBar();
    UI.updateOrderHint();
    UI.updateHiddenNotice();
    UI.refreshPriceTag();
    // La leyenda del gráfico refleja SIEMPRE el par y la temporalidad activos
    // (evita desajustes si una recarga termina después de cambiar de par o TF)
    setText('lgPair', DS.label ? DS.label(App.pair) : App.pair);
    setText('lgTf', App.interval);
    UI.renderPending();     // órdenes límite en espera
    UI.renderPanels();      // lista de indicadores con su valor actual
    // Libro de órdenes y fila de estadísticas del terminal (css/bitunix.css):
    // se refrescan con la misma cadencia que el resto de paneles.
    if (global.OB && OB.onTick) OB.onTick();
    UI.updateLimitHint && UI.updateLimitHint();
    // Marcaje de posición + banda/etiqueta/curva de PnL (js/pnlChart.js): misma
    // cadencia que el resto de paneles, y barato cuando no hay posición.
    if (global.PC && PC.refresh) PC.refresh();
  };

  UI.refreshPriceTag = function () {
    const p = App.currentPrice();
    setText('tagPrice', p ? U.fmtPrice(p) : '—');
  };

  UI.refreshAccount = function () {
    const m = TE.getMetrics();
    setText('acBalance', U.fmtMoney(m.balance));
    setText('acEquity', U.fmtMoney(m.equity));
    setPnl('acTotalPnl', m.pnlTotal);
    setPnl('acOpenPnl', m.openPnl);
    setText('acMargin', U.fmtMoney(m.margin));
    setText('acFree', U.fmtMoney(m.free));
    setText('acExposure', 'Exposición ' + U.fmtPct(m.exposure, 1) + (TE.state.leverage > 1 ? ` · ${TE.state.leverage}x` : ''));
    setText('acFees', 'Comisiones ' + U.fmtMoney(m.fees));
    const meter = document.getElementById('marginMeter');
    if (meter) meter.style.width = U.clamp(m.exposure, 0, 100) + '%';
    setText('tagLeverage', TE.state.leverage + 'X');
    setText('eqValue', U.fmtMoney(m.equity));
    UI.refreshPosition();
  };

  /** Redibuja las líneas de posición solo cuando cambian los niveles. */
  UI.syncPositionGraphics = function (p) {
    // El TRAILING entra en la firma: su nivel de disparo cambia con cada pico, así
    // que si no se compara, activarlo (o que la vela haga un nuevo máximo) no
    // repinta nada y la línea TRAIL aparece un paso por detrás o directamente no
    // aparece hasta que otra cosa mueve la posición.
    const trail = !p || !p.trail ? 'off'
      : (p.trail.armed ? 'a' + p.trail.peak : 'e' + p.trail.activation);
    const sig = p
      ? `${p.id}|${p.side}|${p.entryPrice}|${p.qty}|${p.sl}|${p.tp}|${p.leverage}|` +
        `${(p.tpLevels || []).map((l) => l.price + ':' + l.pct).join(',')}|${(p.parts || []).length}|${trail}`
      : null;
    if (sig === UI._posSig) return;
    UI._posSig = sig;
    CM.setPositionLines(p);
    DT.setTradeHandles(p);
  };

  /** Refleja el umbral de cuenta en la tarjeta: estado en una línea y campos rellenos. */
  UI.syncAcctTpsl = function () {
    const c = TE.state.tpslCuenta;
    const info = TE.tpslCuentaInfo(App.currentPrice());
    const est = document.getElementById('acctTpEstado');
    if (est) {
      est.textContent = !c.activo ? 'apagado'
        : `activado · ${c.ganancia !== null ? '+' + c.ganancia + (c.modo === 'usdt' ? ' USDT' : ' %') : '—'}`
        + ` / ${c.perdida !== null ? '−' + c.perdida + (c.modo === 'usdt' ? ' USDT' : ' %') : '—'}`
        + ` · ${c.ambito === 'ambos' ? 'toda la cuenta' : c.ambito === 'cross' ? 'cruzado' : 'aislado'}`;
      est.style.color = info.activo && info.vivas && (info.umbralG !== null && info.pnl >= info.umbralG
        || info.umbralP !== null && info.pnl <= -info.umbralP) ? 'var(--down)' : '';
    }
    const chip = document.getElementById('btnAcctOn');
    if (chip) chip.classList.toggle('active', !!c.activo);
    const hint = document.getElementById('acctTpHint');
    if (hint) hint.textContent = info.texto;
  };

  (function () {
    const edit = document.getElementById('btnAcctEdit'), cfg = document.getElementById('acctTpCfg');
    const CAMPOS = { modo: 'acctModo', base: 'acctBase', ambito: 'acctAmbito', ganancia: 'acctGanancia', perdida: 'acctPerdida' };
    if (edit && cfg) edit.addEventListener('click', () => {
      const abierto = cfg.style.display !== 'none';
      if (!abierto) {   // al abrir, los campos se rellenan con lo que hay: un formulario vacío
        const c = TE.state.tpslCuenta;                // que parece decir «sin umbral» cuando sí lo hay
        Object.keys(CAMPOS).forEach((k) => {
          const el = document.getElementById(CAMPOS[k]);
          if (el) el.value = c[k] === null || c[k] === undefined ? '' : c[k];
        });
      }
      cfg.style.display = abierto ? 'none' : '';
      UI.syncAcctTpsl();
    });
    Object.keys(CAMPOS).forEach((k) => {
      const el = document.getElementById(CAMPOS[k]);
      if (el) el.addEventListener('input', UI.syncAcctTpsl);
    });
    const on = document.getElementById('btnAcctOn');
    if (on) on.addEventListener('click', () => {
      const val = (id) => (document.getElementById(id) || {}).value;
      const r = TE.setTpslCuenta({ modo: val('acctModo'), base: val('acctBase'), ambito: val('acctAmbito'),
        ganancia: val('acctGanancia'), perdida: val('acctPerdida') });
      if (!r.ok) { U.toast(r.msg, 'warn', 4600); return; }
      UI.refreshAll();
      U.toast('TP/SL de cuenta activado: cerrará TODAS las posiciones del ámbito al tocar el umbral', 'info', 4200);
    });
    const off = document.getElementById('btnAcctOff');
    if (off) off.addEventListener('click', () => {
      if (!TE.offTpslCuenta()) { U.toast('El TP/SL de cuenta ya estaba apagado', 'info', 2200); return; }
      UI.refreshAll();
    });
  })();

  UI.refreshPosition = function () {
    const vivas = TE.posiciones();
    // En HEDGE puede haber dos direcciones vivas y la tarjeta enseña una. Si la elegada ya no
    // existe (se cerró mientras estaba seleccionada) se vuelve a la principal: dejar el panel
    // pintando una posición muerta es de los errores que cuestan dinero de verdad.
    if (App.posLado && !TE.posicionDe(App.posLado)) App.posLado = null;
    const p = (App.posLado && TE.posicionDe(App.posLado)) || TE.state.position;
    const price = App.currentPrice();
    const tag = document.getElementById('posSide');
    if (global.PC && PC.place) PC.place();   // la etiqueta va pegada al precio actual
    setText('tabPosCount', String(vivas.length));   // aviso en la pestaña «Posiciones»: 0, 1 o 2
    UI.syncPosModo();
    UI.syncAcctTpsl();
    const segLado = document.getElementById('segPosLado');
    if (segLado) {
      segLado.style.display = vivas.length > 1 ? '' : 'none';
      [...segLado.querySelectorAll('.seg-btn')].forEach((b) => b.classList.toggle('active', !!p && b.dataset.lado === p.side));
    }
    // La dirección NO mostrada se resume en una línea: con el modo hedge activo no puede quedar
    // ninguna posición invisible, aunque el panel sea de una sola.
    const otra = vivas.length > 1 ? (vivas[0] === p ? vivas[1] : vivas[0]) : null;
    const otraLinea = document.getElementById('posOtroLado');
    if (otraLinea) {
      if (otra) {
        const dir = otra.side === 'long' ? 1 : -1;
        const u = Number.isFinite(price) ? (price - otra.entryPrice) * otra.qty * dir : 0;
        otraLinea.style.display = '';
        otraLinea.innerHTML = `<span>La otra dirección (${otra.side === 'long' ? 'LONG' : 'SHORT'} no mostrada)</span>`
          + `<b class="pnl ${u >= 0 ? 'up' : 'down'}">`
          + `${U.fmtPrice(otra.entryPrice)} · ${U.num(otra.qty, 6)} u · ${U.fmtMoney(u, true)}</b>`;
      } else otraLinea.style.display = 'none';
    }
    UI.syncPositionGraphics(p);
    if (!p) {
      tag.textContent = 'FLAT';
      tag.className = 'tag flat';
      setText('posPnl', '$0.00'); setPnl('posPnl', 0);
      ['posEntry', 'posSize', 'posNotional', 'posMark', 'posSlDist', 'posTpDist', 'posLiq', 'posRR',
       'posAvg', 'posBE', 'posTrail', 'posDuration', 'posBars']
        .forEach((id) => setText(id, '—'));
      // Sin posición: el ✕ del trailing se apaga y el botón vuelve a «Activar».
      const offBtn = document.getElementById('btnTrailOff');
      if (offBtn) offBtn.disabled = true;
      const onBtn = document.getElementById('btnTrailOn');
      if (onBtn) onBtn.textContent = 'Activar';
      UI.renderTpLevels(null);
      const mgmt = document.getElementById('posMgmt');
      if (mgmt) mgmt.classList.remove('activo');
      return;
    }
    const nPartes = (p.parts || []).length;
    setText('posAvg', `${nPartes} entrada${nPartes === 1 ? '' : 's'}` + (p.additions ? ` (+${p.additions})` : ''));
    const be = TE.breakEvenPrice(p);
    setText('posBE', be !== null
      ? `${U.fmtPrice(be)} (${U.fmtPct(((be - p.entryPrice) / p.entryPrice) * 100, 2, true)})`
      : '—');
    // Estado del trailing en la tarjeta: nivel de disparo si ya sigue el pico, o
    // cuánto le falta al precio para armarlo si está en espera de activación.
    const tl = typeof TE.trailingInfo === 'function' ? TE.trailingInfo(p) : null;
    setText('posTrail', !tl ? '—' : (tl.armed
      ? `${U.num(tl.pct, 2)} % · pico ${U.fmtPrice(tl.peak)} → ${U.fmtPrice(tl.level)} (${U.fmtPct(tl.distPct, 2, true)})`
      : `${U.num(tl.pct, 2)} % · arma en ${U.fmtPrice(tl.activation)}`));
    const offT = document.getElementById('btnTrailOff');
    if (offT) offT.disabled = !p.trail;
    const onT = document.getElementById('btnTrailOn');
    if (onT) onT.textContent = p.trail ? 'Re-ajustar' : 'Activar';
    if (onT && p.trail) onT.title = 'Redefinir el % y el pico desde el precio actual';
    UI.renderTpLevels(p);
    const mgmtOn = document.getElementById('posMgmt');
    if (mgmtOn) mgmtOn.classList.add('activo');
    const pnl = TE.unrealized(price);
    tag.textContent = p.side === 'long' ? 'LONG' : 'SHORT';
    tag.className = 'tag ' + p.side;
    const el = document.getElementById('posPnl');
    el.textContent = U.fmtMoney(pnl, true) + (p.entryPrice ? `  (${U.fmtPct((pnl / p.entryBalance) * 100, 2, true)})` : '');
    el.className = 'pnl ' + (pnl >= 0 ? 'up' : 'down');

    setText('posEntry', U.fmtPrice(p.entryPrice));
    setText('posSize', U.num(p.qty, 6) + ' ' + App.baseAsset());
    setText('posNotional', U.fmtMoney(p.notional) + ' · ' + p.leverage + 'X');   // la X suya, no una segunda caja
    setText('posMark', U.fmtPrice(price));
    setText('posSlDist', p.sl ? `${U.fmtPrice(p.sl)} (${U.fmtPct(((p.sl - p.entryPrice) / p.entryPrice) * 100, 2, true)})` : 'sin SL');
    setText('posTpDist', p.tp ? `${U.fmtPrice(p.tp)} (${U.fmtPct(((p.tp - p.entryPrice) / p.entryPrice) * 100, 2, true)})` : 'sin TP');
    // F6/F8: se pinta el precio CON el tramo que lo genera, y cuando el cálculo dice que no hay
    // nivel (el `liqPrice ≤ 0` de la API, «riesgo bajo») se escribe «sin nivel»: un 0 en la carta
    // se lee como «ya estás liquidado» y no es lo que significa.
    const liq = TE.liqInfo(p);
    const mr = TE.marginRate(p);
    setText('posLiq', liq.sinNivel ? 'sin nivel'
      : U.fmtPrice(liq.precio) + (liq.nivel ? ' · N' + liq.nivel : ''));
    {
      const el = document.getElementById('posLiq');
      if (el) el.title = liq.sinNivel
        ? 'Sin precio de liquidación a este apalancamiento: el margen libre de la cuenta cubre de ' +
          'sobra (en la API de Bitunix esto es un liqPrice ≤ 0).'
        : `Tramo N${liq.nivel || '—'} · máximo ${liq.apalancamientoMax || '—'}× · mantenimiento ` +
          `${U.fmtMoney(liq.mantenimiento)} (MMR ${(liq.mmr * 100).toFixed(2)} % sobre el precio de ENTRADA)` +
          ` · disponible ${U.fmtMoney(mr.disponible)} · «Margin Rate» ${(mr.ratio * 100).toFixed(3)} %` +
          (mr.enRiesgo ? ' · EN RIESGO (disponible < mantenimiento)' : '') +
          (liq.fueraDeTabla ? ' · por encima de lo medido: se usa la última tasa conocida' : '');
    }
    setText('posRR', (p.sl && p.tp)
      ? U.num(Math.abs(p.tp - p.entryPrice) / Math.abs(p.entryPrice - p.sl), 2) + ' : 1'
      : '—');
    setText('posDuration', 'Abierta ' + U.fmtDuration(p.entryTime, App.currentTime()));
    setText('posBars', p.bars + ' velas');
  };

  /** Estadísticas y curva de capital. */
  UI.refreshStats = function (force) {
    const metrics = TE.getMetrics();
    const trades = TE.state.trades;
    const closedCount = trades.filter((t) => t.status === 'closed').length;
    // LA FORMA DEL HISTORIAL, no solo cuántos están cerrados. Costó de encontrar (11-oct,
    // al montar «Historial de operación» y «de financiación»): comparando solo `closedCount`,
    // promediar una entrada no repintaba nada (añade una EJECUCIÓN sin cerrar nada) y el
    // libro se quedaba atrasado hasta el siguiente cierre. El cierre parcial sí cambiaba el
    // conteo, y de ahí que el defecto pareciera limitado a una pestaña.
    const hist = closedCount + '/' + trades.length
      + '/' + (TE.state.position ? (TE.state.position.parts || []).length : 0)
      + '/' + ((TE.state.fundingLog || []).length);

    // La curva de capital y el cómputo de métricas se hace como mucho cada 250 ms,
    // salvo que se fuerce o que haya cambiado el número de trades cerrados.
    const now = performance.now();
    const tradeClosed = closedCount !== UI._closedCount || hist !== UI._histSig;
    const shouldHeavy = force || tradeClosed || !UI._statsAt || (now - UI._statsAt > 250);

    // La fila de la posición abierta es barata de refrescar (unos pocos textos),
    // así que se actualiza SIEMPRE, incluso cuando el cómputo pesado de
    // estadísticas se salta por el tope de 250 ms: si no, avanzando rápido la
    // fila mostraba barras y PnL atrasados.
    UI.updateOpenTradeRow();

    if (!shouldHeavy) return;
    UI._statsAt = now;

    const s = STATS.compute(trades, TE.state.equitySeries, TE.state.initialCapital);
    UI.lastStats = s;

    setText('stTrades', s.total);
    setText('stWinRate', s.total ? U.fmtPct(s.winRate, 1) : '—');
    setText('stPf', s.total ? (s.profitFactor === Infinity ? '∞' : U.num(s.profitFactor, 2)) : '—');
    setText('stDd', s.total ? U.fmtMoney(-s.maxDD) + ' (' + U.fmtPct(s.maxDDPct * 100, 1) + ')' : '—');
    setText('stRr', s.avgR === null ? '—' : U.num(s.avgR, 2) + 'R');
    setText('stWl', `${s.wins} / ${s.losses}`);
    setText('stBest', s.total ? U.fmtMoney(s.best, true) : '—');
    setText('stWorst', s.total ? U.fmtMoney(s.worst, true) : '—');
    setText('stExp', s.total ? U.fmtMoney(s.expectancy, true) : '—');
    setText('stStreak', s.total ? `${s.currentStreak} ${s.streakType === 'W' ? 'ganadores' : 'perdedores'}` : '—');
    const best = document.getElementById('stBest'), worst = document.getElementById('stWorst'), exp = document.getElementById('stExp');
    if (best) best.className = 'pnl ' + (s.best > 0 ? 'up' : 'down');
    if (worst) worst.className = 'pnl ' + (s.worst < 0 ? 'down' : 'up');
    if (exp) exp.className = 'pnl ' + (s.expectancy >= 0 ? 'up' : 'down');
    setText('eqValue', U.fmtMoney(metrics.equity));

    CM.drawEquity(TE.state.equitySeries, TE.state.initialCapital);
    if (tradeClosed) {
      UI.renderTrades();
      UI.refreshPosition();
    } else {
      // Sin cambios en los cerrados: basta con refrescar el PnL de la abierta
      UI.updateOpenTradeRow();
      UI.refreshPosition();
    }
    UI._closedCount = closedCount;
    UI._histSig = hist;
  };

  /** Tabla de historial de trades. */
  /**
   * Fila de la POSICIÓN ABIERTA: la entrada se ve desde el primer momento, con
   * su PnL flotante actualizándose vela a vela (antes sólo aparecía el trade
   * cuando se cerraba, así que una entrada parecía «no registrada»).
   */
  UI._openTradeRow = function (p) {
    const precio = App.currentPrice() || p.entryPrice;
    const pnl = TE.unrealized(precio);
    const pct = p.entryBalance ? (pnl / p.entryBalance) * 100 : 0;
    const r = p.riskUsd ? U.num(pnl / p.riskUsd, 2) : '—';
    return `<tr id="tradeOpenRow" class="open ${p.side}">
      <td>·</td>
      <td class="dir-${p.side}">${p.side === 'long' ? 'LONG' : 'SHORT'}</td>
      <td>${U.fmtDate(p.entryTime)}</td>
      <td class="open-tag">ABIERTA</td>
      <td class="num">${U.fmtPrice(p.entryPrice)}</td>
      <td class="num" id="openExit">${U.fmtPrice(precio)}</td>
      <td class="num">${U.num(p.qty, 5)}</td>
      <td class="num pnl ${pnl >= 0 ? 'up' : 'down'}" id="openPnl">${U.fmtMoney(pnl, true)}</td>
      <td class="num pnl ${pct >= 0 ? 'up' : 'down'}" id="openPct">${U.fmtPct(pct, 2, true)}</td>
      <td class="num" id="openR">${r}</td>
      <td>${(TE.state.pending || []).length ? 'EN VIVO · pendientes: ' + TE.state.pending.length : 'EN VIVO'}</td>
      <td id="openBars">${p.bars || 0} (${U.fmtDuration(p.entryTime, TE.state.lastTime || p.entryTime)})</td>
      ${UI._liveSparkCell()}
    </tr>`;
  };

  /** Refresca sólo la fila abierta (PnL flotante, barras y motivo), sin rehacer la tabla. */
  UI.updateOpenTradeRow = function () {
    const p = TE.state.position;
    const row = document.getElementById('tradeOpenRow');
    if (!p) { if (row) UI.renderTrades(); return; }
    if (!row) { UI.renderTrades(); return; }

    const precio = App.currentPrice() || p.entryPrice;
    const pnl = TE.unrealized(precio);
    const pct = p.entryBalance ? (pnl / p.entryBalance) * 100 : 0;
    const set = (id, txt, cls) => { const el = document.getElementById(id); if (!el) return; el.textContent = txt; if (cls) el.className = cls; };
    set('openExit', U.fmtPrice(precio));
    set('openPnl', U.fmtMoney(pnl, true), 'num pnl ' + (pnl >= 0 ? 'up' : 'down'));
    set('openPct', U.fmtPct(pct, 2, true), 'num pnl ' + (pct >= 0 ? 'up' : 'down'));
    set('openR', p.riskUsd ? U.num(pnl / p.riskUsd, 2) : '—');
    set('openBars', `${p.bars || 0} (${U.fmtDuration(p.entryTime, TE.state.lastTime || p.entryTime)})`);
    const pend = row.querySelector('td:nth-child(11)');
    if (pend) pend.textContent = (TE.state.pending || []).length ? 'EN VIVO · pendientes: ' + TE.state.pending.length : 'EN VIVO';
  };

  /**
   * Celda del mini-recorrido de un trade cerrado. Se pinta a mano en un <canvas> de
   * 46×16 y el camino viaja en `data-v` (los números ya sellados por PC en el trade),
   * así que renderTrades() no depende de que la posición siga existiendo.
   * SIN `pnlPath` (trade de antes de esta versión) la celda queda vacía: `title` lo
   * dice y el texto de la fila no cambia, que es lo que miran otras pruebas.
   */
  /** Celda de la fila ABIERTA: un canvas que pinta PC con la traza de este instante. */
  UI._liveSparkCell = function () {
    return '<td class="tr-spark-c" title="recorrido en vivo del PnL de esta posición">'
      + '<canvas class="tr-spark" data-live="1" width="46" height="16" aria-hidden="true"></canvas></td>';
  };

  UI._sparkCell = function (t) {
    const v = Array.isArray(t.pnlPath) ? t.pnlPath.filter(Number.isFinite) : [];
    if (v.length < 2) {
      return '<td class="tr-spark-c" title="sin recorrido guardado: este trade se cerró antes de la mini-curva"></td>';
    }
    const mx = Number.isFinite(t.pnlMax) ? t.pnlMax : Math.max(...v);
    const mn = Number.isFinite(t.pnlMin) ? t.pnlMin : Math.min(...v);
    return `<td class="tr-spark-c" title="máx ${U.fmtMoney(mx, true)} · mín ${U.fmtMoney(mn, true)}">`
      + `<canvas class="tr-spark" data-v="${v.map((x) => x.toFixed(2)).join(',')}" width="46" height="16" aria-hidden="true"></canvas></td>`;
  };

  /**
   * Pinta una mini-curva del recorrido en un <canvas> de 46×16. Se comparte entre la
   * tabla (recorrido SELLADO en el trade cerrado) y la fila de la posición abierta
   * (recorrido VIVO, que pinta PC en cada vela), para que las dos se vean igual.
   */
  UI._paintSpark = function (c, vals, dpr) {
    const x = c.getContext && c.getContext('2d');
    if (!x || !vals || vals.length < 2) return;
    const W = 46, H = 16, f = dpr || 1;
    c.width = Math.round(W * f); c.height = Math.round(H * f);
    x.setTransform(f, 0, 0, f, 0, 0);
    x.clearRect(0, 0, W, H);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max === min) { max += 1; min -= 1; }
    const px = (i) => (i / (vals.length - 1)) * (W - 2) + 1;
    const py = (v) => H - 1.5 - ((v - min) / (max - min)) * (H - 3);
    const ult = vals[vals.length - 1];
    const col = ult > 0 ? '#25ca93' : ult < 0 ? '#f65b55' : '#8b8e96';
    const agua = min < 0 && max > 0 ? py(0) : null;
    if (agua !== null) {
      x.strokeStyle = 'rgba(139,142,150,.45)'; x.setLineDash([1.5, 1.5]); x.lineWidth = 1;
      x.beginPath(); x.moveTo(0, agua); x.lineTo(W, agua); x.stroke(); x.setLineDash([]);
    }
    // Relleno desde el agua (o desde el borde si el trade nunca la cruzó): en 46 px lo
    // que se lee es la FORMA, así que el relleno importa más que el grosor de la línea.
    const base = agua !== null ? agua : H - 1;
    x.beginPath(); x.moveTo(px(0), base);
    for (let i = 0; i < vals.length; i++) x.lineTo(px(i), py(vals[i]));
    x.lineTo(px(vals.length - 1), base); x.closePath();
    x.fillStyle = ult >= 0 ? 'rgba(37,202,147,.20)' : 'rgba(246,91,85,.20)';
    x.fill();
    x.beginPath();
    for (let i = 0; i < vals.length; i++) { const ax = px(i), ay = py(vals[i]); if (i) x.lineTo(ax, ay); else x.moveTo(ax, ay); }
    x.strokeStyle = col; x.lineWidth = 1.2; x.stroke();
    x.fillStyle = col; x.beginPath(); x.arc(px(vals.length - 1), py(ult), 1.6, 0, Math.PI * 2); x.fill();
  };

  /** Pinta las mini-curvas selladas de los trades cerrados (tras rehacer la tabla). */
  UI._paintTradeSparks = function () {
    const dpr = Math.min(3, global.devicePixelRatio || 1);
    document.querySelectorAll('#tradesBody canvas.tr-spark').forEach((c) => {
      if (c.hasAttribute('data-live')) return;   // la viva la pinta PC en cada vela
      const v = String(c.dataset.v || '').split(',').map(Number).filter(Number.isFinite);
      UI._paintSpark(c, v, dpr);
    });
  };

  /**
   * Mini-en-vivo de la fila de la posición ABIERTA. Se llama desde PC.paintMini (que
   * ya corre en cada vela del replay), así que la fila no va a otra ni desalinea con
   * la cabecera: 13 celdas también.
   */
  UI.paintLiveSparks = function (vals) {
    const dpr = Math.min(3, global.devicePixelRatio || 1);
    const v = (Array.isArray(vals) ? vals : []).filter(Number.isFinite);
    document.querySelectorAll('#tradesBody canvas.tr-spark[data-live]').forEach((c) => {
      UI._paintSpark(c, v, dpr);
    });
  };

  /** El filtro «Sólo actual»: con un solo par cargado no se nota; al cambiar de símbolo, el
     historial guarda lo del anterior (el motor NO se reinicia al cambiar de par), así que la
     casilla tiene qué filtrar de verdad. */
  UI.soloActual = function () {
    const c = document.getElementById('chkSoloActual');
    return !!(c && c.checked);
  };
  UI.historialVisible = function () {
    const arr = TE.state.trades || [];
    if (!UI.soloActual()) return arr;
    return arr.filter((t) => (t.pair || TE.state.pair) === TE.state.pair);
  };

  /* «HISTORIAL DE OPERACIÓN»: una fila por ejecución. */
  UI.renderFills = function () {
    const body = document.getElementById('fillsBody');
    if (!body) return;
    const vac = document.getElementById('fillsEmpty');
    const relleno = [];
    for (const t of UI.historialVisible()) {
      // Fuente única de las ENTRADAS: `parts` de la posición, que es la misma lista de la que
      // cuelgan las marcas de entrada en el gráfico (js/chart.js:556) y los contadores de
      // «Promediar» (l.1738). La fila de un cierre parcial NO repite las entradas -si las
      // pintáramos también desde ahí, cada tramo saldría dos veces en el libro—: lo que aporta
      // esa fila es SU ejecución de cierre, que se añade más abajo.
      const partes = Array.isArray(t.parts) ? t.parts : [];
      partes.forEach((x, i) => relleno.push({ t: x.time, dir: t.side, p: x.entryPrice, q: x.qty, o: x.origin,
                                              kind: i === 0 ? 'entrada' : 'promedio ' + i, id: t.id }));
      if (t.status === 'closed' && t.exitPrice != null) {
        // El motivo SOLO se escribe cuando dice algo que la palabra «cierre» no dice: con
        // `manual` salía «cierre · mercado · cierre manual», tres veces lo mismo.
        const mot = TE.reasonLabel ? TE.reasonLabel(t.reason) : '';
        relleno.push({ t: t.exitTime, dir: t.side, p: t.exitPrice, q: t.qty, kind: t.parcial ? 'cierre parcial' : 'cierre',
                       o: 'mercado', id: t.id, rank: 1,
                       motivo: (/^cierre manual$|^manual$/i.test(mot) || !mot) ? '' : mot });
      }
    }
    // Descendente por hora, y a igualdad de hora la entrada ANTES que el cierre: en el replay
    // las dos ejecuciones de un abrir-y-cerrar dentro de la misma vela comparten `time`, y el
    // orden natural del libro es abrir → cerrar (sin esto, el asiento nº 1 era el cierre).
    relleno.sort((x, y) => ((y.t || 0) - (x.t || 0)) || ((y.rank || 0) - (x.rank || 0)));
    setText('tabFillCount', relleno.length);
    if (!relleno.length) { body.innerHTML = ''; if (vac) vac.classList.remove('hidden'); return; }
    if (vac) vac.classList.add('hidden');
    body.innerHTML = relleno.map((x, i) => {
      const cierra = /^cierre/.test(x.kind);
      const vendedora = cierra ? (x.dir === 'long') : (x.dir !== 'long');
      // El origen llega del motor en inglés ('market' | 'limit' | 'limite'): aquí se traduce,
      // que es la tabla que lee la persona.
      const origen = /^(limite|limit|market)$/i.test(x.o || '')
        ? (/^limi/i.test(x.o) ? 'límite' : 'mercado') : (x.o || 'mercado');
      return `<tr class="${vendedora ? 'loss' : 'win'}"><td>${relleno.length - i}</td>`
        + `<td class="dir-${x.dir}">${x.dir === 'long' ? 'LONG' : 'SHORT'}</td>`
        + `<td>${U.fmtDate(x.t)}</td><td class="num">${U.fmtPrice(x.p)}</td><td class="num">${U.num(x.q, 6)}</td>`
        + `<td class="num">${U.fmtMoney(x.p * x.q, false)}</td>`
        + `<td>${x.kind} · ${origen}${x.motivo ? ' · ' + x.motivo : ''}</td></tr>`;
    }).join('');
  };

  /* «HISTORIAL DE FINANCIACIÓN»: cada liquidación, con su hora y su importe firmado. */
  UI.renderFunding = function () {
    const body = document.getElementById('fundingBody');
    if (!body) return;
    const vac = document.getElementById('fundingEmpty');
    let arr = (TE.state.fundingLog || []).slice().reverse();
    if (UI.soloActual()) arr = arr.filter((f) => (f.pair || TE.state.pair) === TE.state.pair);
    setText('tabFundCount', arr.length);
    if (!arr.length) { body.innerHTML = ''; if (vac) vac.classList.remove('hidden'); return; }
    if (vac) vac.classList.add('hidden');
    body.innerHTML = arr.map((f, i) => `<tr><td>${arr.length - i}</td><td>${U.fmtDate(f.t)}</td>`
      + `<td class="dir-${f.side}">${f.side === 'long' ? 'LONG' : 'SHORT'}</td>`
      + `<td class="num">${U.num(f.rate, 4)} %</td><td class="num">${U.num(f.notional, 2)}</td>`
      + `<td class="num ${f.amount < 0 ? 'loss' : 'win'}">${U.fmtMoney(f.amount, true)}</td></tr>`).join('');
  };

  UI.renderTrades = function () {
    const body = document.getElementById('tradesBody');
    const empty = document.getElementById('tradesEmpty');
    const trades = UI.historialVisible().filter((t) => t.status === 'closed').slice().reverse();
    const abierta = TE.state.position;
    setText('tabTradeCount', UI.historialVisible().filter((t) => t.status === 'closed').length);
    if (!trades.length && !abierta) {
      body.innerHTML = '';
      empty.classList.remove('hidden');
      UI.renderFills(); UI.renderFunding();
      return;
    }
    empty.classList.add('hidden');
    body.innerHTML = (abierta ? UI._openTradeRow(abierta) : '') + trades.map((t, i) => {
      const n = TE.state.trades.indexOf(t) + 1;
      const dur = U.fmtDuration(t.entryTime, t.exitTime);
      return `<tr class="${t.pnl > 0 ? 'win' : 'loss'}" data-trade="${n}">
        <td>${n}</td>
        <td class="dir-${t.side}">${t.side === 'long' ? 'LONG' : 'SHORT'}</td>
        <td>${U.fmtDate(t.entryTime)}</td>
        <td>${U.fmtDate(t.exitTime)}</td>
        <td class="num">${U.fmtPrice(t.entryPrice)}</td>
        <td class="num">${U.fmtPrice(t.exitPrice)}</td>
        <td class="num">${U.num(t.qty, 5)}</td>
        <td class="num">${U.fmtMoney(t.pnl, true)}</td>
        <td class="num">${U.fmtPct(t.pnlPct, 2, true)}</td>
        <td class="num">${t.rMultiple !== null ? U.num(t.rMultiple, 2) : '—'}</td>
        <td>${TE.reasonLabel(t.reason)}</td>
        <td>${t.bars || 0} (${dur})</td>
        ${UI._sparkCell(t)}
      </tr>`;
    }).join('');
    UI._paintTradeSparks();   // los canvas solo se pueden pintar cuando ya están en el DOM
    // Las dos pestañas hermanas salen del MISMO historial: si no se repintaran aquí,
    // «Historial de operación» se quedaría vacía en cuanto hay una sola operación (su
    // rama vacía sí llamaba, la otra no - medido con la prueba de §5.4, 0 filas contra 2).
    UI.renderFills(); UI.renderFunding();
  };

  /* ------------------------------- Barra replay ------------------------------- */

  UI.setPlaying = function (playing) {
    const btn = document.getElementById('btnPlay');
    if (btn) {
      btn.textContent = playing ? '❚❚' : '▶';
      btn.title = playing ? 'Pausa (Espacio)' : 'Play (Espacio)';
      btn.classList.toggle('playing', playing);
    }
    const st = document.getElementById('pbStatus');
    if (st) {
      st.textContent = playing ? 'EN REPLAY' : 'PAUSA';
      st.className = 'rb-status ' + (playing ? 'playing' : 'paused');
    }
  };

  UI.refreshReplayBar = function () {
    const total = BR.total();
    const idx = BR.getIndex();
    const c = BR.currentCandle();
    setText('pbTime', c ? U.fmtDate(c.time) + ' UTC' : '—');
    setText('pbIndex', `vela ${idx + 1} / ${total}`);
    setText('pbPct', U.fmtPct(BR.progressTotal() * 100, 1));
    setText('pbSpeed', BR.speedLabel());
    setText('rbClock', c ? U.fmtDateSec(c.time) : '—');
    const slider = document.getElementById('progressRange');
    // Solo se respeta al usuario mientras ARRASTRA (ver `_arrastrandoSlider` en el cableado).
    if (slider && !UI._arrastrandoSlider) slider.value = Math.round(BR.progressTotal() * 1000);
    U.$$('.speed-btn').forEach((b) => {
      const v = b.dataset.speed === 'max' ? 'max' : +b.dataset.speed;
      b.classList.toggle('active', v === BR.state.speed);
    });
    UI.updateHiddenNotice();
    UI.refreshPriceTag();
  };

  UI.updateHiddenNotice = function () {
    const hidden = BR.hiddenCount();
    const el = document.getElementById('hiddenNotice');
    if (!el) return;
    setText('hiddenCount', `${hidden.toLocaleString('es-ES')} velas ocultas`);
    el.classList.toggle('hidden', hidden === 0);
  };

  /* ------------------------------- Orden / hint ------------------------------- */

  /** Texto de ayuda bajo los botones de orden: SL/TP y riesgo estimado. */
  UI.updateOrderHint = function () {
    const price = App.currentPrice();
    const hint = document.getElementById('orderHint');
    if (!hint) return;
    if (!price) { hint.textContent = 'Carga datos para operar.'; return; }
    const tsl = App.tpSlLee();
    const parts = [];
    if (tsl.sl !== null) parts.push(`SL a ${U.fmtPct(((price - tsl.sl) / price) * 100, 2)} del precio`);
    if (tsl.tp !== null) parts.push(`TP a ${U.fmtPct(((tsl.tp - price) / price) * 100, 2)}`);
    /* Con la casilla apagada el aviso lo dice, no se calla: callar equivaldría a que los campos
       escritos no existen, y existen -lo que no viajan es a la orden—. */
    if (!tsl.on && (val('slInput') || val('tpInput'))) parts.push('TP/SL apagados (guardados, sin enviar)');
    // Riesgo estimado
    const { notional } = App.estimateSize(price);
    if (tsl.sl !== null && notional > 0) {
      const risk = Math.abs(price - tsl.sl) / price * notional;
      const eq = TE.state.balance;
      parts.push(`riesgo ≈ ${U.fmtMoney(risk)} (${U.fmtPct(risk / eq * 100, 2)} del capital)`);
    }
    UI.renderOrderCost();
    const pAb = TE.state.position;
    if (pAb) {
      parts.push(TE.state.averaging
        ? `${pAb.side === 'long' ? 'LONG' : 'SHORT'} abierta a ${U.fmtPrice(pAb.entryPrice)}: el mismo lado PROMEDIA, el contrario invierte`
        : 'posición abierta: cierra antes de abrir otra (activa «Promediar entradas» en Ajustes)');
    }
    hint.textContent = parts.length ? parts.join(' · ') : 'Sin SL/TP definidos (puedes añadirlos por precio o con los atajos rápidos).';
  };

  /* ============================ TERMINAL (piel Bitunix) ============================ */

  /** Sincroniza chip + deslizador + <select> del apalancamiento. */
  UI.syncLeverage = function (v) {
    const lev = Math.max(1, Math.min(100, Math.round(+v || 1)));
    /* En HEDGE con el lado elegido, el deslizador NO es el apalancamiento de la cuenta: escribe en
       ese lado (la API lo hace con `holdSide`). Se salta la sincronización del <select> heredado a
       propósito —ese control llama a `TE.configure` y reescribiría el valor de cuenta con el de un
       lado—, pero el chip y la lectura de los dos lados sí se pintan, que es lo que el usuario
       necesita ver para saber a dónde está arrastrando. */
    if (TE.state.modoPosicion === 'HEDGE' && App.levLado && App.levLado !== 'reset') {
      const res = TE.setLeverageLado(App.levLado, lev);
      UI.syncLevLados();
      if (res.ok) {
        const r = document.getElementById('levRange');
        const leido = TE.leverageDe(App.levLado);
        if (r && +r.value !== leido) r.value = String(leido);
      } else {
        const r = document.getElementById('levRange');
        if (r) r.value = String(TE.leverageDe(App.levLado));   // el deslizador vuelve a la realidad
      }
      UI.refreshPosition();
      UI.refreshAccount();
      return;
    }
    const sel = document.getElementById('leverageSelect');
    if (sel) {
      if (!Array.prototype.some.call(sel.options, (o) => +o.value === lev)) {
        const o = document.createElement('option');
        o.value = String(lev); o.textContent = lev + 'x';
        sel.appendChild(o);
      }
      if (+sel.value !== lev) { sel.value = String(lev); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    setText('bfLevVal', lev + 'X');   // la X mayúscula es la de su barra med (`10X`)
    const r = document.getElementById('levRange');
    if (r && +r.value !== lev) r.value = String(lev);
    UI.syncLevLados();
  };

  /* LOS DOS `10X` DE LA BARRA DE MODO, medidos en su página (11-oct): `10X` verde (largo) y
     `10X` rojo (corto), 12 px / peso 500, 23×16 cada uno, dentro de la píldora de 28 px.
     No son decoración: leen `TE.leverageLadoInfo()`, así que en ONE-WAY los dos dicen el de la
     cuenta -por eso salen iguales, igual que en la suya- y en HEDGE cada uno dice el suyo. */
  UI.syncLevChips = function () {
    const info = (TE.leverageLadoInfo && TE.leverageLadoInfo()) || null;
    if (!info) return;
    const uno = info.modo !== 'HEDGE';
    const largo = document.getElementById('btnLevLong'), corto = document.getElementById('btnLevShort');
    const ed = document.getElementById('bfLevEditor');
    const l = uno ? info.cuenta : info.long, s = uno ? info.cuenta : info.short;
    const titulo = (uno ? 'Uno y otro lado a ' + l + 'X (apalancamiento de la cuenta)'
                        : 'Largo ▲ ' + l + 'X · corto ▼ ' + s + 'X')
      + ' — clic para editar el deslizador';
    if (largo) { largo.textContent = l + 'X'; largo.title = titulo; }
    if (corto) { corto.textContent = s + 'X'; corto.title = titulo; }
    const lado = (!uno && App.levLado && App.levLado !== 'reset') ? App.levLado : null;
    if (largo) largo.classList.toggle('sel', lado === 'long');
    if (corto) corto.classList.toggle('sel', lado === 'short');
    const caret = document.getElementById('btnLevEdit');
    if (caret) {
      const abierto = !!(ed && !ed.hidden);
      caret.setAttribute('aria-expanded', String(abierto));
      caret.classList.toggle('abierto', abierto);
    }
  };

  /* LA CASILLA TP/SL (ítem 5b). No es un adorno del encabezado: apagarla saca las dos cajas y los
     atajos de %, deja un resumen con lo escrito (para que lo apagado no se confunda con lo vacío)
     e invalida la caché del alto de «Avanzado», que es justo lo que decide el plegado automático.
     Nace MARCADA y se recuerda: `test:layout` exige que SL/TP estén visibles y escribibles con
     «Avanzado» abierto, y el sitio también los muestra marcados al abrir la página. */
  UI.syncTpSl = function () {
    const c = document.getElementById('chkTpSl');
    if (!c) return;
    const on = !!c.checked;
    const cajas = document.getElementById('bfTpSlCajas');
    if (cajas) cajas.hidden = !on;
    const sum = document.getElementById('bfTpSlSum');
    if (sum) {
      const trozos = [];
      const lee = (id, nombre) => {
        const e = document.getElementById(id);
        const n = e ? parseFloat(e.value) : NaN;
        if (Number.isFinite(n) && n > 0) trozos.push(nombre + ' ' + U.fmtPrice(n));
      };
      lee('slInput', 'SL'); lee('tpInput', 'TP');
      sum.textContent = trozos.length ? trozos.join(' · ') : 'sin niveles';
      sum.hidden = on;
    }
    { const ab = document.getElementById('btnOrderAvanzado'); if (ab) delete ab.dataset.altoAdv; }
  };

  /* REGLA: escribir un nivel ENCINEDE la casilla. La casilla contesta a «¿van estos niveles en la
     orden?», así que un SL/TP puesto -por Riesgo fijo, por una plantilla, por los atajos de % o por
     lo que sea que sepa mandar el evento `input`- y dejado apagado es un dato en el limbo: escrito,
     visible en el campo, y no enviado. Lo que NO hace esta regla es contradecir a la persona: apagar
     la casilla a mano no dispara `input` en los campos, asi que no se reenciende sola; lo escrito se
     queda donde esta y el resumen de la fila lo nombra (item 5b del registro). */
  /* Dos vistas en el telefono, porque en 844 px de alto no caben la carta Y el formulario con el
     libro al lado; su movil hace exactamente lo mismo con su `pill-tabs` (§5.6 del registro). Se
     recuerda en `ST` y se propaga como `#app[data-vista]`, que es lo que lee la piel: el comportamiento
     esta aqui y la anatomia, en el CSS. ARRANQUE: en `carta`, no en `operar` como el -el de ellos es
     una pantalla para operar y la nuestra es una para replay, y abrir sin datos en el formulario
     seria abrir en vacio—. Quien cambie una vez, se queda con su eleccion. */
  UI.vistasMoviles = function () {
    /* La marca va en `body`, no en un `#app`: este documento NO tiene un contenedor con ese id
       (fallo medido: `getElementById('app')` da null y la piel entera se quedaba sin aplicar). */
    const raiz = document.body;
    if (!raiz) return;
    const botones = [...document.querySelectorAll('#bfVistas .bf-vista')];
    const pon = (v) => {
      if (!v) return;
      raiz.dataset.vista = v;
      for (const b of botones) b.classList.toggle('active', b.dataset.vista === v);
      if (window.ST && ST.set) ST.set('vistaMovil', v);
      /* La escalera mide su contenedor: al volver a Carta, el lienzo cambia de alto y hay que
         avisar al repartidor (no lo hace nadie mas, porque el cambio no pasa por el). */
      if (window.PC && PC.ajustaEscalera) requestAnimationFrame(() => { try { PC.ajustaEscalera(); } catch (e) {} });
    };
    for (const b of botones) b.addEventListener('click', () => pon(b.dataset.vista));
    const guardado = (window.ST && ST.get) ? ST.get('vistaMovil', 'carta') : 'carta';
    pon(guardado === 'operar' ? 'operar' : 'carta');
  };

  UI.vigilaTpSl = function () {
    const c = document.getElementById('chkTpSl');
    if (!c || c.checked) return;
    if ((document.getElementById('slInput') || {}).value || (document.getElementById('tpInput') || {}).value) {
      App.enciendeTpSl('un nivel escrito en el formulario');
    }
  };

  /** Abre / cierra el editor del deslizador (lo que en el sitio es el popover del `▾`). */
  UI.muestraLevEditor = function (abierto) {
    const ed = document.getElementById('bfLevEditor');
    if (!ed) return;
    ed.hidden = !abierto;
    try { if (window.ST && ST.set) ST.set('levEditor', !!abierto); } catch (e) {}
    if (abierto) {
      const r = document.getElementById('levRange');
      if (r) { try { r.focus({ preventScroll: true }); } catch (e) { if (r.focus) r.focus(); } }
    }
    UI.syncLevChips();
  };

  /** Lectura de los dos lados en la propia fila del deslizador (solo en hedge). */
  UI.syncLevLados = function () {
    const el = document.getElementById('levLados');
    const row = document.getElementById('segLevLado');
    const info = TE.leverageLadoInfo();
    const esHedge = info.modo === 'HEDGE';
    if (el) {
      el.hidden = !esHedge;
      if (esHedge) {
        el.textContent = `▲ ${info.long}× · ▼ ${info.short}×` + (info.separado ? '' : ' · (unificados)');
        el.className = 'lev-lados' + (info.long !== info.short ? ' dif' : '');
        el.title = info.separado
          ? `Los lados van separados (cuenta ${info.cuenta}×): ▲ ${info.long}× y ▼ ${info.short}×. «⤺ Ambos» los unifica.`
          : `Los dos lados siguen el apalancamiento de la cuenta (${info.cuenta}×). Elige un lado y el deslizador lo separará.`;
      }
    }
    if (row) row.style.display = esHedge ? '' : 'none';
    /* El alto de «Avanzado» se cachea (`btn.dataset.altoAdv`) porque plegado no se puede medir, y
       EN ESTE BLOQUE vive justo lo que cambia de tamaño con el modo de posición (`#segLevLado`,
       ~54 px). Sin invalidar, la cifra cacheada con HEDGE puesto (366 px medidos, por 312 en
       ONE-WAY) seguía mandando después de volver a ONE-WAY y el umbral de deshacer («tiene que
       sobrar tanto hueco como lo que ocupa el bloque») quedaba inflado: el pliegue se quedaba
       pegado «por espacio» con aire de sobra. Se borra la caché y la próxima pasada del
       ResizeObserver mide en frío, que es la vía que sí sabe medir con el bloque oculto. */
    { const ab = document.getElementById('btnOrderAvanzado'); if (ab) delete ab.dataset.altoAdv; }
    UI.syncLevChips();
    const seg = document.getElementById('segLevLado');
    if (seg) [...seg.querySelectorAll('.seg-btn')].forEach((b) => b.classList.toggle('active', b.dataset.levlado === (App.levLado || 'long')));
  };

  /** Controles nuevos de la fila superior del panel de órdenes. */
  UI.initTerminal = function () {
    const seg = document.getElementById('segMarginMode');
    if (seg) seg.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-mm]') : null;
      if (!b) return;
      U.$$('#segMarginMode [data-mm]').forEach((x) => x.classList.toggle('active', x === b));
      const m = TE.setMarginMode(b.dataset.mm);
      const p = TE.state.position;
      U.log(`🧮 Modo de margen: ${m === 'cross' ? 'CRUZADO (toda la cuenta respalda)' : 'AISLADO (solo el margen de la posición)'}` +
        (p ? ` · liq. ${U.fmtPrice(TE.liquidationPrice(p))}` : ''), 'sys');
      UI.refreshPosition();
      App.refreshOrderLines();
      UI.refreshAccount();
    });
    const r = document.getElementById('levRange');
    if (r) r.addEventListener('input', () => UI.syncLeverage(+r.value));
    // La píldora de la barra de modo: `▾` abre el editor y cada `10X` lo abre además eligiendo
    // el lado al que escribe el deslizador. Se reutiliza el botón de `#segLevLado` en vez de
    // duplicar la lógica: es el que sabe unificar con «⤺ Ambos» y el que avisa por toast.
    {
      const ed = document.getElementById('bfLevEditor');
      const caret = document.getElementById('btnLevEdit');
      if (ed && caret) {
        try { ed.hidden = !(window.ST && ST.get && ST.get('levEditor', false) === true); } catch (e) {}
        caret.addEventListener('click', () => UI.muestraLevEditor(ed.hidden));
        [['btnLevLong', 'long'], ['btnLevShort', 'short']].forEach(([id, lado]) => {
          const ch = document.getElementById(id);
          if (!ch) return;
          ch.addEventListener('click', () => {
            if (TE.state.modoPosicion === 'HEDGE') {
              const b = document.querySelector('#segLevLado [data-levlado="' + lado + '"]');
              if (b) b.click();
            }
            UI.muestraLevEditor(true);
          });
        });
      }
      UI.syncLevChips();
    }
    /* Qué lado edita el deslizador. «⤺ Ambos» no es un lado: deshace la separación (un control que
       quitara el override desapareciendo sería invisible, y aquí lo que hace falta es poder VOLVER). */
    const segLado = document.getElementById('segLevLado');
    if (segLado) segLado.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-levlado]') : null;
      if (!b) return;
      if (b.dataset.levlado === 'reset') {
        TE.offLeverageLado();
        App.levLado = 'long';
      } else App.levLado = b.dataset.levlado;
      UI.syncLeverage(TE.leverageDe(App.levLado));
      UI.syncLevLados();
      App.refreshOrderLines();
      UI.refreshAccount();
      U.toast(App.levLado === 'long' ? 'El deslizador fija ahora el apalancamiento LARGO ▲'
                                     : 'El deslizador fija ahora el apalancamiento CORTO ▼', 'sys', 2600);
    });
    const sel = document.getElementById('leverageSelect');
    if (sel) UI.syncLeverage(+sel.value);     // estado inicial coherente

    /* Plantillas de orden (js/orderTemplates.js). Va aquí y no en `App.init` porque es un
       control MÁS del panel de órdenes, y `OT.init` ya se apaga solo si el bloque no existe
       (el archivo único de otro contexto podría no tenerlo). */
    if (global.OT && OT.init) OT.init();
  };

  /** Coste / margen de la orden y bloqueo si el tamaño es 0 (Bitunix lo deshabilita). */
  UI.renderOrderCost = function () {
    const price = App.currentPrice();
    const est = price ? (App.estimateSize(price) || {}) : {};
    const notional = +est.notional || 0;
    // La línea de coste es lo que costará EL BOTÓN QUE TOQUES: en hedge con los lados separados eso
    // es el apalancamiento del lado que manda el deslizador, no el de la cuenta.
    const lev = Math.max(1, TE.state.modoPosicion === 'HEDGE' ? TE.leverageDe(App.levLado || 'long') : TE.state.leverage);
    setText('bfCostVal', notional > 0 ? U.fmtMoney(notional) : '—');
    setText('bfMarginVal', notional > 0 ? U.fmtMoney(notional / lev) + ` (${lev}X)` : '—');
    const cero = notional <= 0;
    ['btnLong', 'btnShort'].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.disabled = cero;
    });
  };

  /* -------------------------------- Confirmaciones -------------------------------- */

  UI.confirmReset = function () {
    if (!confirm('¿Reiniciar las estadísticas y borrar el historial de trades? El replay no se moverá.')) return;
    App.resetStats();
  };

  UI.confirmHardReset = function () {
    if (!confirm('Esto reinicia la sesión completa: cuenta, trades, dibujos, indicadores y replay. ¿Continuar?')) return;
    App.hardReset();
    UI.closeModal('modalSettings');
  };

  /* ------------------------------- Loader ------------------------------- */

  UI.showLoader = function (text) {
    const l = document.getElementById('loader');
    l.classList.remove('hidden');
    UI._loaderBase = text || 'Cargando…';
    UI._loaderT0 = performance.now();
    setText('loaderText', UI._loaderBase);
    if (UI._loaderTimer) clearInterval(UI._loaderTimer);
    UI._loaderTimer = setInterval(UI._tickLoader, 500);
  };

  UI._tickLoader = function () {
    if (!UI._loaderT0) return;
    const s = Math.round((performance.now() - UI._loaderT0) / 1000);
    let extra = ` (${s} s)`;
    if (s >= 6) extra += ' · la red va lenta… si no responde, arrancaré en modo DEMO';
    setText('loaderText', UI._loaderBase + extra);
  };

  UI.hideLoader = function () {
    document.getElementById('loader').classList.add('hidden');
    if (UI._loaderTimer) { clearInterval(UI._loaderTimer); UI._loaderTimer = null; }
    UI._loaderT0 = 0;
  };

  UI.setLoaderText = function (t) {
    UI._loaderBase = t;
    setText('loaderText', t + (UI._loaderT0 ? ` (${Math.round((performance.now() - UI._loaderT0) / 1000)} s)` : ''));
  };

  /* ------------------------------- Leyenda / pares ------------------------------- */

  UI.setPairLabels = function (pair, interval) {
    const label = DS.label ? DS.label(pair) : (DS.PAIRS[pair] || pair);
    UI.updateSymbolButton && UI.updateSymbolButton();
    setText('lgPair', label);
    setText('lgTf', interval);
    // Fuente de datos visible en la leyenda: Binance (real), DEMO (sintético)…
    const src = App.source && App.source !== '—' ? App.source : '';
    const el = document.getElementById('lgSource');
    if (el) {
      el.textContent = src ? '· ' + src : '';
      el.title = src ? 'Fuente de datos: ' + src : '';
      el.style.color = /DEMO|sintétic/i.test(src) ? 'var(--warn)' : 'var(--tx-4)';
    }
  };

  /* ------------------------------ Captura de pantalla ------------------------------ */

  /** Compone las velas + dibujos + paneles en una sola imagen PNG. */
  UI.composeScreenshot = function () {
    const area = document.getElementById('chartArea');
    const wrap = document.getElementById('chartWrap');
    const areaRect = area.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const dpr = global.devicePixelRatio || 1;

    const cv = document.createElement('canvas');
    cv.width = Math.round(areaRect.width * dpr);
    cv.height = Math.round(areaRect.height * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(0, 0, areaRect.width, areaRect.height);

    // Todas las velas/paneles renderizados por canvas dentro del área del gráfico
    U.$$('#chartArea canvas').forEach((c) => {
      if (!c.width || !c.height) return;
      const r = c.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      try { ctx.drawImage(c, r.left - areaRect.left, r.top - areaRect.top, r.width, r.height); } catch (e) {}
    });

    // Dibujos (canvas superpuesto)
    ctx.save();
    ctx.translate(0, wrapRect.top - areaRect.top);
    DT.renderTo(ctx, wrapRect.width, wrapRect.height);
    ctx.restore();

    // Cabecera informativa
    const c = BR.currentCandle();
    ctx.fillStyle = 'rgba(11,12,22,.85)';
    ctx.fillRect(0, 0, areaRect.width, 22);
    ctx.fillStyle = '#e8eaf6';
    ctx.font = 'bold 12px ui-monospace, monospace';
    const pair = (DS.label ? DS.label(App.pair) : (DS.PAIRS[App.pair] || App.pair));
    ctx.fillText(`BAR REPLAY PRO · ${pair} · ${App.interval} · ${c ? U.fmtDate(c.time) + ' UTC' : ''} · ` +
                 `Balance ${U.fmtMoney(TE.state.balance)} · Equity ${U.fmtMoney(TE.state.equity)}`, 10, 15);
    return cv;
  };

  /* ------------------------------ Cura de inputs ------------------------------ */

  /* Cuatro unidades para el tamaño: % del equity, USD, Qty y RIESGO. La cuarta no es una unidad
     de entrada sino de cálculo —el tamaño se deduce del stop y de la pérdida máxima (223/225)—,
     así que lleva fila propia y convierte el campo de tamaño en salida. La tabla vive en UI para
     que el clic, el atajo y las plantillas pinten exactamente los mismos rótulos. */
  UI.SIZE_LABELS = {
    pct: ['Tamaño (% del equity)', '%'],
    notional: ['Tamaño en USD (exposición)', 'USD'],
    qty: ['Cantidad de monedas', ''],
    riesgo: ['Tamaño deducido (USD)', 'USD'],
  };

  UI.setSizeMode = function (mode) {
    U.$$('#segSize .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
    const labels = UI.SIZE_LABELS;
    if (labels[mode]) {
      const lb = document.getElementById('sizeLabel'), sf = document.getElementById('sizeSuffix');
      if (lb) lb.textContent = labels[mode][0];
      if (sf) sf.textContent = labels[mode][1];
    }
    UI.syncRiesgo();
  };

  /* Hay tres caminos para llegar al modo Riesgo (clic en el segmentado, `setSizeMode` desde una
     plantilla o desde el estado guardado), así que la visibilidad de su fila y el bloqueo del
     campo de tamaño se aplican en un solo sitio. */
  UI.syncRiesgo = function () {
    const esRiesgo = App.sizeMode === 'riesgo';
    const row = document.getElementById('riesgoRow');
    if (row) row.style.display = esRiesgo ? '' : 'none';
    const si = document.getElementById('sizeInput');
    if (si) si.disabled = esRiesgo;
    if (esRiesgo) App.riesgoAplica();
  };

  UI.setSpeedButtons = function () {
    U.$$('.speed-btn').forEach((b) => {
      const v = b.dataset.speed === 'max' ? 'max' : +b.dataset.speed;
      b.classList.toggle('active', v === BR.state.speed);
    });
  };

  global.UI = UI;
})(window);

  /* ORDEN RÁPIDA SOBRE EL LIENZO (ítem 3 del registro, 11-oct-2026). Lo que hace el sitio: una
     caja flotante con `Comprar · precio`, el selector de unidad y `Vender · precio`. Lo que hace
     esta: lo mismo, y coloca de verdad. Para eso escribe en el formulario -tipo de orden, unidad
     del tamaño, importe y, si hay precio, el límite- y llama a `App.placeOrder(side)`, que es la
     puerta por la que ya pasan el ratón y los atajos B/S: mantener DOS caminos de colocación
     significa que uno se oxide en silencio. El widget no guarda margen ni apalancamiento propios;
     los toma del estado del formulario, igual que ellos.

     Dos detalles que no son decorativos:
       · El precio se pre-rellena con el de la vela actual y se deja de tocar en cuanto alguien
         escribe (la marca `data-editado`): si no, cada apertura pisaría lo escrito.
       · «Sin precio» significa A MERCADO, no «0»: se quita el valor del medio y se elige `market`,
         que es la semántica del sitio (su campo admite dejarlo vacío y dispara a B/S). */
  UI.initOrdenRapida = function () {
    const card = document.getElementById('qrCard');
    const btn = document.getElementById('btnQuickOrder');
    if (!card || !btn || btn.dataset.qrMontado) return false;
    btn.dataset.qrMontado = '1';
    const g = (id) => document.getElementById(id);
    const pulsa = (sel) => { const e = document.querySelector(sel); if (e) e.click(); };
    const num = (e) => { const v = parseFloat(e && e.value); return Number.isFinite(v) ? v : null; };
    const precioActual = () => { const p = App.currentPrice(); return p ? +p.toFixed(p > 1000 ? 2 : 6) : ''; };
    const rellena = () => { for (const id of ['qrBuyPrice', 'qrSellPrice']) { const e = g(id); if (e && !e.dataset.editado) e.value = String(precioActual()); } };
    const abierta = () => !card.hidden;
    const muestra = (si) => {
      card.hidden = !si;
      btn.classList.toggle('qr-abierto', !!si);
      btn.setAttribute('aria-pressed', si ? 'true' : 'false');
      if (window.ST && ST.set) ST.set('ordenRapida', !!si);
      if (si) rellena();
    };
    btn.addEventListener('click', () => muestra(!abierta()));
    g('qrCerrar').addEventListener('click', () => muestra(false));
    for (const id of ['qrBuyPrice', 'qrSellPrice']) {
      const e = g(id);
      if (e) e.addEventListener('input', () => { e.dataset.editado = '1'; });
    }
    const colocar = (side) => {
      const inp = g(side === 'long' ? 'qrBuyPrice' : 'qrSellPrice');
      const p = num(inp);
      const cur = App.currentPrice();
      const usaLimite = p !== null && p > 0 && !(cur && Math.abs(p - cur) / cur < 1e-6);
      pulsa('#segOrderType [data-otype="' + (usaLimite ? 'limite' : 'market') + '"]');
      const modo = (g('qrMode') || {}).value || 'costo';
      pulsa('#segSize [data-mode="' + (modo === 'costo' ? 'notional' : modo === 'cantidad' ? 'qty' : 'pct') + '"]');
      const imp = num(g('qrAmount'));
      const si = g('sizeInput');
      if (si && imp !== null && imp > 0) { si.value = String(imp); si.dispatchEvent(new Event('input', { bubbles: true })); }
      const li = g('limitInput');
      if (usaLimite && li) { li.value = String(p); li.dispatchEvent(new Event('input', { bubbles: true })); }
      const antes = { pos: TE.state.position ? TE.state.position.side : null, pend: (TE.state.pending || []).length };
      App.placeOrder(side);
      const despues = { pos: TE.state.position ? TE.state.position.side : null, pend: (TE.state.pending || []).length };
      const q = usaLimite ? ' LÍMITE a ' + U.fmtPrice(p) : ' a mercado';
      if (despues.pos !== antes.pos) U.log(`⚡ Orden rápida${q}: posición ${despues.pos ? despues.pos.toUpperCase() : 'cerrada'} · importe ${g('qrAmount').value} (${modo})`, 'trade');
      else if (despues.pend > antes.pend) U.log(`⚡ Orden rápida${q} en espera · importe ${g('qrAmount').value} (${modo})`, 'trade');
      else U.log('⚡ Orden rápida rechazada: mira el aviso (margen, tamaño o precio)', 'warn');
      rellena();
    };
    g('qrBuy').addEventListener('click', () => colocar('long'));
    g('qrSell').addEventListener('click', () => colocar('short'));
    if (window.ST && ST.get && ST.get('ordenRapida', false) === true) muestra(true);
    return true;
  };

  /* DESPLEGABLE DE CONDICIONALES (BLOQUE 18). `<details>` ya abre, cierra y gestiona el foco con
     el teclado; lo que hace esto es lo que el elemento nativo no hace solo: cerrar al pulsar fuera
     (si no, el panel se queda colgando sobre el `#limitRow` mientras operas) y devolver el foco al
     resumen con Escape. Se engancha con `pointerdown` en fase de captura porque el `click` de la
     pestaña de dentro ya habría burbujeado. */
  UI.initOrdenCondicional = function () {
    const mas = document.getElementById('otypeMore');
    const res = document.getElementById('otypeMoreBtn');
    if (!mas || !res || mas.dataset.montado) return false;
    mas.dataset.montado = '1';
    const fuera = (e) => { if (mas.open && e.target && !mas.contains(e.target)) mas.open = false; };
    document.addEventListener('pointerdown', fuera, true);
    res.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mas.open) { mas.open = false; res.focus(); }
    });
    return true;
  };
