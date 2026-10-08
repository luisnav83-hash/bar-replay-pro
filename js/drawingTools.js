/* =========================================================================
 * drawingTools.js — Herramientas de dibujo sobre un canvas superpuesto.
 *
 *  Tipos soportados:
 *    trend   línea de tendencia (segmento)
 *    ray     línea extendida (rayo) a partir de 2 puntos
 *    hline   línea horizontal de soporte/resistencia (1 clic)
 *    vline   línea vertical / marca temporal (1 clic)
 *    rect    rectángulo / zona (2 puntos, relleno translúcido)
 *    channel canal paralelo (3 clics: base + separación)
 *    fib     retroceso de Fibonacci (2 puntos)
 *    measure medición de distancia (2 puntos: Δprecio, Δ%, velas, tiempo)
 *
 *  Los dibujos se guardan en coordenadas de DATOS (tiempo UNIX + precio),
 *  por lo que permanecen anclados al gráfico al hacer zoom, scroll o al
 *  avanzar el replay.
 *
 *  Además gestiona los "handles" de la posición abierta (SL / TP), que se
 *  pueden arrastrar en el gráfico para modificar los niveles.
 * =======================================================================*/
(function (global) {
  'use strict';

  const DT = {};

  const FIB_LEVELS = [
    { r: 0, color: '#8d93b5' }, { r: 0.236, color: '#40c4ff' }, { r: 0.382, color: '#00e5ff' },
    { r: 0.5, color: '#ffd54f' }, { r: 0.618, color: '#ffab40' }, { r: 0.786, color: '#ff7043' },
    { r: 1, color: '#8d93b5' },
  ];

  const TYPE_NAMES = {
    trend: 'Línea de tendencia', ray: 'Línea extendida', hline: 'Soporte/Resistencia',
    vline: 'Línea vertical', rect: 'Rectángulo / zona', channel: 'Canal paralelo',
    fib: 'Retroceso Fibonacci', measure: 'Medición', ellipse: 'Elipse',
    arrow: 'Flecha', path: 'Camino (polilínea)',
  };

  DT.drawings = [];
  DT.tool = 'cursor';
  DT.selected = null;
  DT.snap = false;
  DT.canvas = null;
  DT.ctx = null;
  DT.dpr = 1;
  DT.draft = null;          // dibujo en curso {type, points:[...], style}
  DT.drag = null;           // {drawing, handle, startPoint...}
  DT.tradeHandles = [];     // handles arrastrables visibles (posición + límites)
  DT._posHandles = [];      // handles de SL/TP de la posición abierta
  DT._pendingHandles = [];  // handles de las órdenes límite pendientes

  /* -------- Dibujar manteniendo pulsado (gesto) --------
   * Mantén pulsado ⅓ s sobre el gráfico y dibuja un trazo: al soltar, el gesto
   * se reconoce solo y se convierte en la herramienta que parece (recta →
   * tendencia, horizontal → soporte, bucle → elipse, zigzag → Fibonacci…).
   * Un garabato encima de un dibujo lo borra. */
  DT.gesture = {
    on: true,          // se puede desactivar en Ajustes
    holdMs: 330,       // tiempo que hay que mantener pulsado
    stroke: null,      // puntos del trazo en curso (coordenadas del lienzo)
    timer: null,
    start: null,       // punto inicial
    armed: false,      // true mientras se dibuja el trazo
    lastScreen: null,
  };
  DT.onTradeHandle = null;  // callback(id, price, phase) → lo conecta app.js
  DT.onChange = null;       // callback al cambiar la lista de dibujos

  /* ============================== INICIALIZACIÓN ============================== */

  DT.init = function (canvas) {
    DT.canvas = canvas;
    DT.ctx = canvas.getContext('2d');

    // Redibuja al hacer resize del contenedor
    const ro = new ResizeObserver(() => { DT.resize(); DT.render(); });
    ro.observe(document.getElementById('chartWrap'));

    // El gráfico cambia de rango (zoom/scroll) → redibujar
    CM.main.timeScale().subscribeVisibleLogicalRangeChange(() => DT.render());

    // Eventos de ratón
    DT._initGesture();          // dibujar manteniendo pulsado
    canvas.addEventListener('mousedown', DT._onDown);
    canvas.addEventListener('dblclick', DT._onDblClick);
    window.addEventListener('mousemove', DT._onMove);
    window.addEventListener('mouseup', DT._onUp);
    // Si el botón se suelta FUERA de la ventana (o se pierde el foco en mitad del
    // arrastre), el navegador no siempre entrega el mouseup: sin esto la pestaña
    // de SL/TP o de la orden límite se queda pegada al cursor y el siguiente
    // movimiento sigue moviendo el nivel. Al perder el foco se cierra el gesto.
    window.addEventListener('blur', () => { if (DT.drag) DT._onUp(); });
    window.addEventListener('pointercancel', () => { if (DT.drag) DT._onUp(); });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); DT.cancelDraft(); });

    /* --- TÁCTIL: arrastrar las pestañas (SL / TP / órdenes límite) con el dedo.
           Solo se captura el gesto si el dedo cae sobre un handle; si no, la
           orden llega intacta al chart para que siga haciendo scroll y zoom. --- */
    canvas.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches.length) return;
      const tp = DT._touchPos(e.touches[0]);
      const th = DT._hitTradeHandle(tp.x, tp.y);
      if (!th) return;
      DT._touchDrag = true;
      DT.drag = { tradeHandle: th, id: th.id, lastPrice: th.price };
      if (DT.onTradeHandle) DT.onTradeHandle(th.id, null, 'start');
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (!DT._touchDrag || !DT.drag || !e.touches || !e.touches.length) return;
      const tp = DT._touchPos(e.touches[0]);
      const price = DT._snapPrice(CM.yToPrice(tp.y));
      if (price !== null) {
        DT.drag.lastPrice = price;
        if (DT.onTradeHandle) DT.onTradeHandle(DT.drag.id, price, 'move');
      }
      e.preventDefault();
    }, { passive: false });

    const finTactil = () => {
      if (!DT._touchDrag) return;
      DT._touchDrag = false;
      if (DT.drag && DT.drag.tradeHandle && DT.onTradeHandle) DT.onTradeHandle(DT.drag.id, DT.drag.lastPrice, 'end');
      DT.drag = null;
      DT.render();
    };
    window.addEventListener('touchend', finTactil);
    window.addEventListener('touchcancel', finTactil);
    // En modo cursor, el canvas solo captura el ratón cuando hay algo bajo él
    canvas.addEventListener('mouseleave', () => { if (DT.tool === 'cursor' && !DT.drag) DT.canvas.style.pointerEvents = 'none'; });
    // Detección de hover en modo cursor (el evento llega desde el canvas del chart)
    document.getElementById('chartWrap').addEventListener('mousemove', DT._onWrapMove, true);

    DT.resize();
  };

  /** Ajusta el canvas al tamaño real del contenedor (con devicePixelRatio). */
  DT.resize = function () {
    const wrap = document.getElementById('chartWrap');
    if (!wrap || !DT.canvas) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    DT.dpr = global.devicePixelRatio || 1;
    DT.canvas.width = Math.max(1, Math.round(w * DT.dpr));
    DT.canvas.height = Math.max(1, Math.round(h * DT.dpr));
    DT.canvas.style.width = w + 'px';
    DT.canvas.style.height = h + 'px';
    DT.ctx.setTransform(DT.dpr, 0, 0, DT.dpr, 0, 0);
    DT.width = w; DT.height = h;
  };

  /* ================================ TOOLBAR ================================ */

  DT.setTool = function (tool) {
    DT.tool = tool;
    DT.cancelDraft();
    DT.selected = null;
    U.$$('#drawToolbar .tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    DT.canvas.classList.toggle('mode-cursor', tool === 'cursor');
    DT.canvas.style.pointerEvents = tool === 'cursor' ? 'none' : 'auto';
    DT.render();
    DT._emitChange();
  };

  DT.setStyle = function (patch) {
    // Aplica estilo por defecto a los nuevos dibujos y, si hay uno seleccionado, a éste
    DT.defaultStyle = Object.assign({ color: '#00e5ff', width: 2, style: 'solid' }, DT.defaultStyle, patch);
    if (DT.selected) {
      Object.assign(DT.selected, patch);
      // Normalizar color RGB→hex si viene de input type=color (ya viene hex)
      DT.render(); DT._emitChange();
    }
  };

  DT.toggleSnap = function () {
    DT.snap = !DT.snap;
    const b = document.getElementById('btnSnap');
    if (b) b.classList.toggle('active', DT.snap);
    U.toast(DT.snap ? '🧲 Imán activado: los puntos se ajustan a OHLC de la vela' : 'Imán desactivado', 'info', 1600);
    return DT.snap;
  };

  /* ============================== CONVERSIONES ============================== */

  /**
   * Convierte tiempo (segundos) a x en píxeles. Si el tiempo no pertenece a
   * la serie cargada, extrapola linealmente con el espaciado de barras.
   */
  DT._xOf = function (dtime) {
    if (dtime === null || dtime === undefined) return null;
    const x = CM.timeToX(dtime);
    if (x !== null) return x;

    // Ancla: vela más cercana con coordenada válida
    const candles = CM.candles;
    if (!candles.length) return null;
    let lo = 0, hi = candles.length - 1, idx = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (candles[m].time <= dtime) { idx = m; lo = m + 1; } else hi = m - 1; }
    const anchor = candles[idx];
    const ax = CM.timeToX(anchor.time);
    const spacing = (CM.main.timeScale().options() || {}).barSpacing || 7;
    const tf = (CM.candles[1] ? CM.candles[1].time - CM.candles[0].time : 3600) || 3600;
    if (ax === null) return null;                        // el ancla tampoco es visible
    return ax + ((dtime - anchor.time) / tf) * spacing;
  };

  /** Convierte precio a y en píxeles. */
  DT._yOf = function (price) {
    const y = CM.priceToY(price);
    if (y !== null) return y;
    return null;
  };

  /** Convierte x en píxeles a tiempo (segundos), o null. */
  DT._timeFromX = function (x) {
    const t = CM.xToTime(x);
    if (t === null) return null;
    return typeof t === 'number' ? t : Math.floor(new Date(t.year, t.month - 1, t.day).getTime() / 1000);
  };

  /* ================================ SNAPPING ================================ */

  /** Ajusta un punto al OHLC de la vela más cercana si el imán está activo. */
  DT._snapPoint = function (pt) {
    if (!DT.snap) return pt;
    const candles = CM.candles;
    const idx = DT._nearestCandleIndex(pt.dtime);
    if (idx < 0) return pt;
    const c = candles[idx];
    const cx = DT._xOf(c.time);
    const px = DT._xOf(pt.dtime);
    if (cx === null || px === null || Math.abs(cx - px) > 10) return { dtime: c.time, price: pt.price };
    // Snap de precio al OHLC más próximo
    const cands = [c.open, c.high, c.low, c.close];
    let best = cands[0];
    cands.forEach((v) => { if (Math.abs(v - pt.price) < Math.abs(best - pt.price)) best = v; });
    return { dtime: c.time, price: best };
  };

  DT._nearestCandleIndex = function (t) {
    const candles = CM.candles;
    if (!candles.length || t === null) return -1;
    let lo = 0, hi = candles.length - 1, best = 0, bd = Infinity;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const d = Math.abs(candles[m].time - t);
      if (d < bd) { bd = d; best = m; }
      if (candles[m].time < t) lo = m + 1; else if (candles[m].time > t) hi = m - 1; else return m;
    }
    return best;
  };

  /* =============================== EVENTOS =============================== */

  /** Posición de un touch relativa al canvas de dibujo. */
  DT._touchPos = function (t) {
    const r = DT.canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };

  /** Última posición del ratón sobre el canvas (para el mouseup fuera del área). */
  let _lastMouse = { x: 0, y: 0 };
  const p0 = () => _lastMouse;

  DT._localPos = function (e) {
    const r = DT.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Hover en modo cursor: activa el canvas si hay un dibujo o una pestaña debajo. */
  DT._onWrapMove = function (e) {
    if (DT.tool !== 'cursor' || DT.drag) return;
    const p = DT._localPos(e);
    const hit = DT._hitTest(p.x, p.y);
    // Las pestañas de SL/TP y de órdenes límite también capturan: sin esto el
    // canvas quedaba con pointerEvents:none sobre ellas y no se podía empezar
    // el arrastre (falla el mousedown antes de llegar a _onDown).
    const th = DT._hitTradeHandle(p.x, p.y);
    DT.canvas.style.pointerEvents = (hit || th) ? 'auto' : 'none';
    DT.canvas.style.cursor = th ? 'grab'
      : (hit ? (hit.handle && hit.handle !== 'body' ? 'grab' : 'move') : 'default');
  };

  DT._onDown = function (e) {
    if (e.button !== 0) return;
    const p = DT._localPos(e);

    /* --- 1) Handles de la posición (SL/TP) siempre tienen prioridad --- */
    const th = DT._hitTradeHandle(p.x, p.y);
    if (th) {
      // lastPrice: el último precio visto durante el arrastre. Al soltar no se
      // puede recalcular desde una coordenada guardada a medias (DT._lastY no
      // existía y devolvía el precio de arriba del todo: el log mentía).
      DT.drag = { tradeHandle: th, id: th.id, lastPrice: th.price };
      DT.canvas.style.cursor = 'grabbing';
      if (DT.onTradeHandle) DT.onTradeHandle(th.id, null, 'start');
      return;
    }

    /* --- 2) Modo selección: arrastrar o seleccionar dibujos existentes --- */
    if (DT.tool === 'cursor') {
      const hit = DT._hitTest(p.x, p.y);
      if (hit) {
        DT.selected = hit.drawing;
        DT.drag = {
          drawing: hit.drawing, handle: hit.handle,
          startPoints: hit.drawing.points.map((q) => ({ dtime: q.dtime, price: q.price })),
          start: DT._dataPoint(p.x, p.y),
          anchor: DT._anchorOf(hit.drawing, hit.handle),
        };
        DT.canvas.style.cursor = 'grabbing';
        DT.render(); DT._emitChange();
      } else {
        DT.selected = null; DT.render(); DT._emitChange();
      }
      return;
    }

    /* --- 3) Creación de un dibujo nuevo --- */
    const pt = DT._snapPoint(DT._dataPoint(p.x, p.y));
    if (!pt) return;

    if (DT.tool === 'hline' || DT.tool === 'vline') {
      DT._addDrawing({ type: DT.tool, points: [pt] });
      return;
    }

    // El CAMINO (polilínea) se construye clic a clic y no se cierra solo: se
    // termina con doble clic, con Enter o pulsando Esc para cancelar. El
    // último punto es «elástico» (sigue al cursor) y se descarta al cerrar.
    if (DT.tool === 'path') {
      if (!DT.draft) {
        DT.draft = { type: 'path', points: [pt, { dtime: pt.dtime, price: pt.price }],
                     style: Object.assign({}, DT.defaultStyle) };
      } else {
        const ult = DT.draft.points[DT.draft.points.length - 1];
        DT.draft.points.push({ dtime: ult.dtime, price: ult.price });
      }
      U.toast(`Camino: ${DT.draft.points.length - 1} puntos · doble clic o Enter para terminar`, 'info', 1400);
      DT.render();
      return;
    }

    if (!DT.draft) {
      DT.draft = { type: DT.tool, points: [pt], style: Object.assign({}, DT.defaultStyle) };
    } else {
      DT.draft.points.push(pt);
      // nº de puntos necesarios según la herramienta
      const need = DT.tool === 'channel' ? 3 : 2;
      if (DT.draft.points.length >= need) {
        DT._addDrawing(DT.draft);
        DT.draft = null;
        DT.setTool('cursor');
      }
    }
    DT.render();
  };

  DT._onMove = function (e) {
    const p = DT._localPos(e);
    _lastMouse = p;

    /* --- Arrastrando un handle de SL/TP --- */
    if (DT.drag && DT.drag.tradeHandle) {
      const price = DT._snapPrice(CM.yToPrice(p.y));
      if (price !== null) {
        DT.drag.lastPrice = price;
        if (DT.onTradeHandle) DT.onTradeHandle(DT.drag.id, price, 'move');
      }
      return;
    }

    /* --- Arrastrando un dibujo --- */
    if (DT.drag && DT.drag.drawing) {
      const cur = DT._dataPoint(p.x, p.y);
      if (!cur) return;
      const d = DT.drag.drawing;
      if (DT.drag.handle === 'body') {
        const dq = { dtime: cur.dtime - DT.drag.start.dtime, price: cur.price - DT.drag.start.price };
        d.points.forEach((q, i) => {
          q.dtime = DT.drag.startPoints[i].dtime + dq.dtime;
          q.price = DT.drag.startPoints[i].price + dq.price;
        });
      } else {
        const i = DT.drag.handle;
        const sp = DT._snapPoint(cur);
        d.points[i] = sp;
      }
      DT.render();
      return;
    }

    /* --- Previsualización del dibujo en curso --- */
    if (DT.draft) {
      const pt = DT._snapPoint(DT._dataPoint(p.x, p.y));
      if (!pt) return;
      if (DT.draft.points.length === 1) DT.draft.points[1] = pt;
      else if (DT.draft.type === 'channel') DT.draft.points[2] = pt;
      else if (DT.draft.type === 'path') DT.draft.points[DT.draft.points.length - 1] = pt;
      DT.render();
    }
  };

  DT._onUp = function () {
    if (DT.drag && DT.drag.tradeHandle && DT.onTradeHandle) {
      const endPrice = DT.drag.lastPrice !== undefined ? DT.drag.lastPrice : DT._snapPrice(CM.yToPrice(p0().y));
      DT.onTradeHandle(DT.drag.id, endPrice, 'end');
    }
    if (DT.drag && DT.drag.drawing) DT._emitChange();
    DT.drag = null;
    DT.canvas.style.cursor = DT.tool === 'cursor' ? 'default' : 'crosshair';
    DT.render();
  };

  DT._onDblClick = function () {
    // Si hay un dibujo a medias (camino), el doble clic lo TERMINA
    if (DT.draft) { DT.finishDraft(); return; }
    // Doble clic sobre un dibujo lo elimina (atajo rápido)
    const p = DT._lastPos || { x: -99, y: -99 };
    const hit = DT._hitTest(p.x, p.y);
    if (hit) DT.deleteDrawing(hit.drawing);
  };

  /** Ajusta el precio al paso mínimo del activo. */
  DT._snapPrice = function (price) {
    if (price === null) return null;
    if (!DT.snap) return price;
    const step = U.priceStep(price);
    return Math.round(price / step) * step;
  };

  /** Convierte píxeles a punto de datos {dtime, price}. */
  DT._dataPoint = function (x, y) {
    const dtime = DT._timeFromX(x);
    const price = CM.yToPrice(y);
    if (dtime === null || price === null) return null;
    return { dtime, price };
  };

  /** Punto de anclaje opuesto al handle arrastrado (para el "anchor" del body). */
  DT._anchorOf = function () { return null; };
  DT._ellipseHandles = function (d) { return d && d.type === 'ellipse'; };

  /* ============================== DIBUJOS ============================== */

  DT._addDrawing = function (d) {
    const drawing = {
      id: U.uid('dw'),
      type: d.type,
      points: d.points.map((p) => ({ dtime: p.dtime, price: p.price })),
      color: (d.style && d.style.color) || DT.defaultStyle.color,
      width: (d.style && d.style.width) || DT.defaultStyle.width,
      style: (d.style && d.style.style) || DT.defaultStyle.style,
    };
    DT.drawings.push(drawing);
    DT.selected = drawing;
    U.log(`✏️ ${TYPE_NAMES[drawing.type]} añadido` +
          (drawing.points[0] && drawing.points[0].price ? ` @ ${U.fmtPrice(drawing.points[0].price)}` : ''), 'info');
    U.playSound('click');
    DT.render();
    DT._emitChange();
    return drawing;
  };

  DT.deleteDrawing = function (drawing) {
    const i = DT.drawings.indexOf(drawing);
    if (i < 0) return;
    DT.drawings.splice(i, 1);
    if (DT.selected === drawing) DT.selected = null;
    DT.render();
    DT._emitChange();
    U.log(`🗑️ Dibujo eliminado (${TYPE_NAMES[drawing.type]})`, 'info');
  };

  DT.deleteSelected = function () {
    if (!DT.selected) { U.toast('No hay ningún dibujo seleccionado', 'warn', 1600); return false; }
    DT.deleteDrawing(DT.selected);
    return true;
  };

  DT.clearAll = function (silent) {
    if (!DT.drawings.length) { if (!silent) U.toast('No hay dibujos que borrar', 'info', 1500); return; }
    DT.drawings = [];
    DT.selected = null;
    DT.draft = null;
    DT.render(); DT._emitChange();
    if (!silent) { U.log('🗑️ Todos los dibujos eliminados', 'warn'); U.toast('Todos los dibujos eliminados', 'info'); }
  };

  DT.cancelDraft = function () { DT.draft = null; DT.render(); };

  /**
   * Cierra el dibujo en curso (lo usa el camino: doble clic o Enter).
   * @returns {boolean} true si se ha creado el dibujo.
   */
  DT.finishDraft = function () {
    const d = DT.draft;
    if (!d) return false;
    let pts = d.points.map((p) => ({ dtime: p.dtime, price: p.price }));
    // El camino arrastra un punto «elástico» al final: si al cerrar está en el
    // mismo sitio que el anterior, no cuenta como vértice.
    if (d.type === 'path' && pts.length > 1) {
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      if (a.dtime === b.dtime && a.price === b.price) pts = pts.slice(0, -1);
    }
    const min = d.type === 'channel' ? 3 : 2;
    DT.draft = null;
    if (pts.length < min) {
      DT.render();
      U.toast('Trazo demasiado corto: no se ha creado ningún dibujo', 'warn', 2200);
      return false;
    }
    DT._addDrawing({ type: d.type, points: pts, style: d.style });
    DT.setTool('cursor');
    return true;
  };

  /* ------------------- Gestor de dibujos (ocultar / renombrar) ------------------- */

  /** Muestra u oculta un dibujo en el gráfico (sin borrarlo). */
  DT.setHidden = function (id, on) {
    const d = DT.drawings.find((x) => x.id === id);
    if (!d) return;
    d.hidden = !!on;
    if (d.hidden && DT.selected === d) DT.selected = null;
    DT.render(); DT._emitChange();
  };

  /** Muestra u oculta TODOS los dibujos de golpe. */
  DT.toggleAllHidden = function () {
    if (!DT.drawings.length) return false;
    const todosOcultos = DT.drawings.every((d) => d.hidden);
    DT.drawings.forEach((d) => { d.hidden = !todosOcultos; });
    if (!todosOcultos) DT.selected = null;
    DT.render(); DT._emitChange();
    U.toast(todosOcultos ? '👁 Dibujos visibles otra vez' : '🚫 Dibujos ocultos (siguen guardados)', 'info', 1800);
    return todosOcultos;
  };

  /** Renombra un dibujo (etiqueta propia del usuario). */
  DT.rename = function (id, txt) {
    const d = DT.drawings.find((x) => x.id === id);
    if (!d) return;
    const limpio = String(txt || '').trim().slice(0, 40);
    if (limpio) d.label = limpio; else delete d.label;
    DT.render(); DT._emitChange();
    if (limpio) U.toast(`✏️ Dibujo renombrado: «${limpio}»`, 'ok', 1800);
  };

  /* ============================== HANDLES SL/TP ============================== */

  /**
   * Define los handles arrastrables de la posición abierta (SL / TP).
   * Acepta null para limpiarlos (posición cerrada).
   */
  DT.setTradeHandles = function (pos) {
    DT._posHandles = pos && (pos.sl !== null || pos.tp !== null)
      ? [
          ...(pos.sl !== null ? [{ id: 'sl', price: pos.sl, color: '#ff1744', label: 'SL' }] : []),
          ...(pos.tp !== null ? [{ id: 'tp', price: pos.tp, color: '#00e5ff', label: 'TP' }] : []),
        ]
      : [];
    DT._rebuildHandles();
  };

  /**
   * Define los handles de las ÓRDENES LÍMITE pendientes: la misma mecánica de
   * arrastre que SL/TP, con id 'limit:<id de la orden>' para que el callback
   * sepa a qué aplicar el precio.
   */
  DT.setPendingHandles = function (ordenes) {
    DT._pendingHandles = (ordenes || []).map((o) => ({
      id: 'limit:' + o.id,
      price: o.limitPrice,
      color: '#ffab00',
      label: '⏳' + (o.side === 'long' ? '▲' : '▼'),
    }));
    DT._rebuildHandles();
  };

  /** Los dos tipos de handles se dibujan y golpean como una sola lista. */
  DT._rebuildHandles = function () {
    DT.tradeHandles = DT._posHandles.concat(DT._pendingHandles);
    DT.render();
  };

  /**
   * ¿El punto (x,y) cae sobre un handle arrastrable?
   * - Siempre vale la pestaña del borde derecho (en cualquier herramienta).
   * - En modo cursor vale además toda la línea horizontal, para poder pincharla
   *   en cualquier punto del gráfico como en un terminal de trading.
   */
  DT._hitTradeHandle = function (x, y) {
    const w = DT.width || 800;
    const hx = w - 92;
    for (const h of DT.tradeHandles) {
      const hy = DT._yOf(h.price);
      if (hy === null) continue;
      if (Math.abs(y - hy) < 9 && x > hx - 26 && x < hx + 60) return h;
      if (DT.tool === 'cursor' && Math.abs(y - hy) <= 6 && x >= 0 && x <= hx - 26) return h;
    }
    return null;
  };

  /* ============================== HIT TESTING ============================== */

  DT._hitTest = function (x, y) {
    const tol = 7;
    for (let i = DT.drawings.length - 1; i >= 0; i--) {
      const d = DT.drawings[i];
      if (d.hidden) continue;                     // oculto = no seleccionable
      const h = DT._hitHandle(d, x, y, tol);
      if (h !== null) return { drawing: d, handle: h };
      if (DT._hitBody(d, x, y, tol)) return { drawing: d, handle: 'body' };
    }
    return null;
  };

  DT._hitHandle = function (d, x, y, tol) {
    for (let i = 0; i < d.points.length; i++) {
      const p = DT._screenPoint(d.points[i]);
      if (!p) continue;
      if (Math.abs(p.x - x) <= tol + 2 && Math.abs(p.y - y) <= tol + 2) return i;
    }
    return null;
  };

  DT._screenPoint = function (pt) {
    const x = DT._xOf(pt.dtime), y = DT._yOf(pt.price);
    if (x === null || y === null) return null;
    return { x, y };
  };

  DT._hitBody = function (d, x, y, tol) {
    const pts = d.points.map((p) => DT._screenPoint(p));
    switch (d.type) {
      case 'hline': {
        const y0 = DT._yOf(d.points[0].price);
        return y0 !== null && Math.abs(y - y0) <= tol;
      }
      case 'vline': {
        const x0 = DT._xOf(d.points[0].dtime);
        return x0 !== null && Math.abs(x - x0) <= tol;
      }
      case 'trend':
      case 'ray':
      case 'measure': {
        const [a, b] = pts;
        if (!a || !b) return false;
        let p1 = a, p2 = b;
        if (d.type === 'ray') p2 = { x: a.x + (b.x - a.x) * 40, y: a.y + (b.y - a.y) * 40 };
        return DT._distToSegment(x, y, p1, p2) <= tol;
      }
      // (El pintado de la elipse vive en DT._draw; aquí solo se detecta el clic.)
      case 'ellipse': {
        const [a, b] = pts;
        if (!a || !b) return false;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const rx = Math.max(1, Math.abs(b.x - a.x) / 2), ry = Math.max(1, Math.abs(b.y - a.y) / 2);
        const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
        return Math.abs(k - 1) <= tol / Math.min(rx, ry) + 0.12;
      }
      case 'arrow': {
        const [a, b] = pts;
        if (!a || !b) return false;
        return DT._distToSegment(x, y, a, b) <= tol + 2;   // tolerancia algo mayor: es un trazo fino
      }
      case 'path': {
        // Se toca si el clic está cerca de CUALQUIERA de sus tramos
        for (let i = 1; i < pts.length; i++) {
          if (!pts[i - 1] || !pts[i]) continue;
          if (DT._distToSegment(x, y, pts[i - 1], pts[i]) <= tol) return true;
        }
        return false;
      }
      case 'rect': {
        const [a, b] = pts;
        if (!a || !b) return false;
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
        if (x >= x1 - tol && x <= x2 + tol && y >= y1 - tol && y <= y2 + tol) {
          // borde o interior
          return true;
        }
        return false;
      }
      case 'channel': {
        const [a, b, c] = pts;
        if (!a || !b || !c) return false;
        const dy = c.y - a.y;
        return DT._distToSegment(x, y, a, b) <= tol ||
               DT._distToSegment(x, y, { x: a.x, y: a.y + dy }, { x: b.x, y: b.y + dy }) <= tol;
      }
      case 'fib': {
        const [a, b] = pts;
        if (!a || !b) return false;
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        if (x < x1 - tol || x > x2 + tol) return false;
        return FIB_LEVELS.some((l) => Math.abs(y - (a.y + (b.y - a.y) * l.r)) <= tol);
      }
    }
    return false;
  };

  DT._distToSegment = function (px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = U.clamp(t, 0, 1);
    const cx = a.x + t * dx, cy = a.y + t * dy;
    return Math.hypot(px - cx, py - cy);
  };

  /* ===================== DIBUJAR MANTENIENDO PULSADO ===================== */

  /** Conecta los eventos del gesto. Se llama desde DT.init(). */
  DT._initGesture = function () {
    const wrap = document.getElementById('chartWrap');
    if (!wrap || wrap._brpGesture) return;
    wrap._brpGesture = true;

    const usaPointer = typeof global.PointerEvent !== 'undefined';
    const EV_DOWN = usaPointer ? 'pointerdown' : 'mousedown';
    const EV_MOVE = usaPointer ? 'pointermove' : 'mousemove';
    const EV_UP = usaPointer ? 'pointerup' : 'mouseup';

    // El «down» se escucha en fase de captura: así nos enteramos antes de que
    // la librería del gráfico empiece a arrastrar.
    wrap.addEventListener(EV_DOWN, DT._gestureDown, true);
    global.addEventListener(EV_MOVE, DT._gestureMove, true);
    global.addEventListener(EV_UP, DT._gestureUp, true);
  };

  /** ¿Se puede empezar un gesto con este evento? */
  DT._gesturePickable = function (e) {
    if (!DT.gesture.on || DT.tool !== 'cursor') return false;   // solo en modo cursor
    if (e.button !== undefined && e.button !== 0) return false; // solo botón izquierdo
    if (e.target && e.target.closest && e.target.closest('#replayBar, #drawToolbar, .card, button, input, select')) return false;
    return true;
  };

  DT._gestureDown = function (e) {
    if (!DT._gesturePickable(e)) return;
    const p = DT._localPos(e);
    if (!DT._insideChart(p)) return;
    const g = DT.gesture;
    g.start = p;
    g.stroke = null;
    g.armed = false;
    // Si el usuario mueve el ratón antes de tiempo, es un arrastre: se cancela.
    g.timer = setTimeout(() => DT._gestureArm(p), g.holdMs);
  };

  /** Se cumple el tiempo de pulsación: empieza el trazo. */
  DT._gestureArm = function (p) {
    const g = DT.gesture;
    if (!g.start || g.armed) return;
    g.armed = true;
    g.stroke = [{ x: p.x, y: p.y }];
    g.lastScreen = p;
    CM.setPanEnabled(false);              // que el trazo no arrastre el gráfico
    DT._lightHint('✍️ Dibuja… (un garabato borra)');
    DT.render();
    if (U.playSound) U.playSound('open');
  };

  DT._gestureMove = function (e) {
    const g = DT.gesture;

    // Fase 1: esperando a que se cumpla el tiempo de pulsación
    if (g.timer && !g.armed) {
      const p = DT._localPos(e);
      const d = Math.hypot(p.x - g.start.x, p.y - g.start.y);
      if (d > 6) { clearTimeout(g.timer); g.timer = null; g.start = null; }   // es un arrastre
      return;
    }

    // Fase 2: dibujando el trazo
    if (!g.armed || !g.stroke) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    const p = DT._localPos(e);
    const last = g.stroke[g.stroke.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 2.5) return;   // 2,5 px: suficiente detalle
    g.stroke.push({ x: p.x, y: p.y });
    g.lastScreen = p;
    DT.render();
  };

  DT._gestureUp = function (e) {
    const g = DT.gesture;
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }
    g.start = null;
    if (!g.armed || !g.stroke) { DT.gesture.stroke = null; return; }
    if (e) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }

    const trazo = g.stroke;
    g.armed = false;
    g.stroke = null;
    CM.setPanEnabled(true);                 // devuelve el arrastre al gráfico
    DT._finishGesture(trazo);
    DT.render();
  };

  /** Aviso breve en el lienzo (se borra al siguiente render con trazo vacío). */
  DT._lightHint = function (txt) { DT._gestureHint = { txt, t: Date.now() }; };

  /**
   * Convierte el trazo en un dibujo (o borra lo que haya debajo si es un garabato).
   * Todo el reconocimiento es geométrico y funciona con coordenadas de pantalla.
   */
  DT._finishGesture = function (trazo) {
    if (!trazo || trazo.length < 2) return;
    const r = DT.classifyStroke(trazo);

    // --- Garabato: borra los dibujos que cruza ---
    if (r.tipo === 'borrar') {
      let n = 0;
      DT.drawings.slice().forEach((d) => {
        const cruza = trazo.some((p) => DT._hitBody(d, p.x, p.y, 10));
        if (cruza) { DT.deleteDrawing(d); n++; }
      });
      U.toast(n ? `🧽 ${n} dibujo(s) borrado(s) con el garabato` : '🧽 Garabato: no había nada que borrar',
        n ? 'ok' : 'info', 2200);
      return;
    }
    if (!r.tipo) { U.toast('No se reconoció el trazo (prueba una recta o un rectángulo)', 'info', 2400); return; }

    // --- Trazo → puntos de datos ---
    const a = DT._dataPoint(trazo[0].x, trazo[0].y);
    const b = DT._dataPoint(trazo[trazo.length - 1].x, trazo[trazo.length - 1].y);
    if (!a || !b) { U.toast('El trazo se sale del gráfico', 'warn', 2000); return; }

    const bbox = DT._strokeBBox(trazo);
    let points;
    if (r.tipo === 'hline') {
      const centro = DT._dataPoint(bbox.cx, bbox.cy);
      points = [centro];
    } else if (r.tipo === 'vline') {
      const centro = DT._dataPoint(bbox.cx, bbox.cy);
      points = [centro];
    } else if (r.tipo === 'rect' || r.tipo === 'ellipse') {
      const p1 = DT._dataPoint(bbox.x1, bbox.y1);
      const p2 = DT._dataPoint(bbox.x2, bbox.y2);
      points = [p1, p2];
    } else {
      points = [a, b];                       // tendencia, rayo y Fibonacci
    }
    if (points.some((p) => !p)) return;

    DT._addDrawing({ type: r.tipo, points, style: Object.assign({}, DT.defaultStyle) });
    DT.setTool('cursor');
    U.toast(`${r.icono} ${TYPE_NAMES[r.tipo]} creado con el gesto`, 'ok', 2400);
  };

  /** Caja que encierra el trazo (en coordenadas de pantalla). */
  DT._strokeBBox = function (t) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    t.forEach((p) => {
      x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x);
      y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y);
    });
    // 12 px de margen para que el rectángulo no quede pegado al trazo
    return { x1: x1 - 12, y1: y1 - 12, x2: x2 + 12, y2: y2 + 12, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  };

  /** ¿El punto está dentro del lienzo del gráfico? */
  DT._insideChart = function (p) {
    return p.x >= 0 && p.y >= 0 && p.x <= (DT.width || 800) && p.y <= (DT.height || 400);
  };

  /**
   * RECONOCEDOR DE TRAZOS
   * Devuelve { tipo, icono } a partir de la forma dibujada:
   *   línea recta horizontal  → soporte/resistencia (hline)
   *   línea recta vertical    → línea de tiempo (vline)
   *   línea recta cualquiera  → línea de tendencia (trend)
   *   cuatro lados que cierran→ rectángulo/zona (rect)
   *   bucle redondo           → elipse (ellipse)
   *   zigzag de 3 lados       → retroceso de Fibonacci (fib)
   *   garabato con muchos giros → borrar
   * Es un clasificador geométrico simple (sin librerías): mide cuánto se
   * desvía el trazo de la recta, cuántos giros hace y si vuelve al inicio.
   */
  DT.classifyStroke = function (t) {
    if (!t || t.length < 4) return { tipo: null };

    /* ---------- 1) Métricas del trazo ---------- */
    const first = t[0], last = t[t.length - 1];
    let pathLen = 0;
    for (let i = 1; i < t.length; i++) pathLen += Math.hypot(t[i].x - t[i - 1].x, t[i].y - t[i - 1].y);
    if (pathLen < 18) return { tipo: null };                 // fue un clic, no un trazo

    const bb = DT._strokeBBox(t);
    const w = bb.x2 - bb.x1 - 24, h = bb.y2 - bb.y1 - 24;     // sin el margen añadido
    const diag = Math.max(1, Math.hypot(w, h));
    const directa = Math.hypot(last.x - first.x, last.y - first.y);
    const rectitud = pathLen / Math.max(1, directa);          // 1 = recta perfecta
    const cierre = directa / diag;                            // 0 = vuelve al inicio

    /* ---------- 2) Giro acumulado ----------
     * Sumar los ángulos (con signo) es mucho más fiable que contar «giros»:
     *   · recta      → ≈ 0
     *   · bucle/rect → ≈ ±2π (una vuelta completa)
     *   · zigzag     → se compensa (ida y vuelta ≈ 0) pero suma mucho en valor
     *     absoluto                                                        */
    const simple = DT._simplifyStroke(t, 5);
    let neto = 0, total = 0, maxGiro = 0;
    for (let i = 2; i < simple.length; i++) {
      const a1 = Math.atan2(simple[i - 1].y - simple[i - 2].y, simple[i - 1].x - simple[i - 2].x);
      const a2 = Math.atan2(simple[i].y - simple[i - 1].y, simple[i].x - simple[i - 1].x);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      neto += d;
      total += Math.abs(d);
      maxGiro = Math.max(maxGiro, Math.abs(d));
    }
    const vuelta = Math.abs(neto);          // ≈ 2π si el trazo da una vuelta
    const esquinas = DT._countSharp(simple, 1.1);   // giros de más de 63°

    /* ---------- 3) Clasificación ---------- */

    // a) Línea recta (cualquier orientación)
    if (rectitud < 1.22 && total < 0.9) {
      const dx = Math.abs(last.x - first.x), dy = Math.abs(last.y - first.y);
      if (dx > 34 && dy < Math.max(7, dx * 0.22)) return { tipo: 'hline', icono: '➖' };
      if (dy > 34 && dx < Math.max(7, dy * 0.22)) return { tipo: 'vline', icono: '｜' };
      return { tipo: 'trend', icono: '📐' };
    }

    // b) Trazo que da una vuelta completa → figura cerrada
    if (vuelta > 4.6 && cierre < 0.62) {
      // Con esquinas marcadas es un rectángulo; si gira suave, un óvalo
      if (esquinas >= 3 && maxGiro > 1.1) return { tipo: 'rect', icono: '▭' };
      return { tipo: 'ellipse', icono: '◯' };
    }

    // c) Garabato: va y viene sin parar → borra
    if (total > 7.5 || (total > 5.2 && rectitud > 2.4)) return { tipo: 'borrar', icono: '🧽' };

    // d) Zigzag (tres tramos) → retroceso de Fibonacci
    if (total > 2.4 && cierre > 0.42 && rectitud > 1.2) return { tipo: 'fib', icono: '🌀' };

    // e) Rectángulo imperfecto: recto y con esquinas
    if (esquinas >= 3 && cierre < 0.6 && rectitud > 1.5 && w > 26 && h > 20) return { tipo: 'rect', icono: '▭' };

    // f) Trazo curvo amplio (arco) → tendencia
    if (rectitud < 2.6) return { tipo: 'trend', icono: '📐' };

    return { tipo: null };
  };

  /** Cuenta los giros fuertes (más de `umbral` radianes) del trazo. */
  DT._countSharp = function (simple, umbral) {
    let n = 0;
    for (let i = 2; i < simple.length; i++) {
      const a1 = Math.atan2(simple[i - 1].y - simple[i - 2].y, simple[i - 1].x - simple[i - 2].x);
      const a2 = Math.atan2(simple[i].y - simple[i - 1].y, simple[i].x - simple[i - 1].x);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > umbral) n++;
    }
    return n;
  };

  /** Reduce el trazo a sus vértices (distancia mínima entre puntos). */
  DT._simplifyStroke = function (t, minDist) {
    const out = [t[0]];
    for (let i = 1; i < t.length; i++) {
      const p = out[out.length - 1];
      if (Math.hypot(t[i].x - p.x, t[i].y - p.y) >= minDist) out.push(t[i]);
    }
    if (out[out.length - 1] !== t[t.length - 1]) out.push(t[t.length - 1]);
    return out;
  };

  /* ================================ RENDER ================================ */

  DT.render = function () {
    if (!DT.ctx) return;
    const ctx = DT.ctx;
    ctx.clearRect(0, 0, DT.width, DT.height);

    // Todos los dibujos
    // Los dibujos ocultos con el 👁 del gestor no se pintan
    DT.drawings.forEach((d) => { if (!d.hidden) DT._draw(ctx, d, d === DT.selected); });

    // Trazo del gesto «mantener pulsado y dibujar»
    if (DT.gesture.stroke && DT.gesture.stroke.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,229,255,.9)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,229,255,.45)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      DT.gesture.stroke.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
      // Pista de qué hacer al soltar
      const aviso = 'Suelta para fijar el dibujo · garabato encima = borrar';
      ctx.save();
      ctx.font = '10.5px ui-monospace, monospace';
      const w = ctx.measureText(aviso).width + 14;
      const x = Math.max(8, (DT.width || 800) / 2 - w / 2), y = 26;
      ctx.fillStyle = 'rgba(0,229,255,.14)';
      ctx.strokeStyle = 'rgba(0,229,255,.5)';
      ctx.lineWidth = 1;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y - 15, w, 19, 4); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = '#9fe9ff';
      ctx.fillText(aviso, x + 7, y - 2);
      ctx.restore();
    }

    // Borrador en curso
    if (DT.draft) {
      DT._draw(ctx, DT.draft, false, true);
      // Guía desde el último punto al cursor se omite (se actualiza en _onMove)
    }

    // Handles de posición (SL/TP)
    DT._drawTradeHandles(ctx);

    // Aviso de herramienta activa: en la esquina superior izquierda, con
    // fondo propio, para no tapar el volumen ni la acción del precio.
    if (DT.tool !== 'cursor') {
      const enCurso = (DT.draft && DT.draft.type === 'path')
        ? `${DT.draft.points.length - 1} puntos puestos · doble clic o Enter para terminar`
        : 'clic para fijar puntos · clic derecho cancela';
      const txt = `${TYPE_NAMES[DT.tool] || ''} — ${enCurso}`;
      ctx.save();
      ctx.font = '10.5px ui-monospace, monospace';
      const w = ctx.measureText(txt).width + 14;
      ctx.fillStyle = 'rgba(0,229,255,.10)';
      ctx.strokeStyle = 'rgba(0,229,255,.45)';
      ctx.lineWidth = 1;
      const x = 12, y = (DT.height || 400);
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y - 26, w, 18, 3); ctx.fill(); ctx.stroke(); }
      else { ctx.fillRect(x, y - 26, w, 18); ctx.strokeRect(x, y - 26, w, 18); }
      ctx.fillStyle = '#7defff';
      ctx.fillText(txt, x + 7, y - 13);
      ctx.restore();
    }
  };

  DT._applyStroke = function (ctx, d) {
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.width || 2;
    ctx.setLineDash(d.style === 'dashed' ? [7, 5] : d.style === 'dotted' ? [2, 4] : []);
  };

  DT._draw = function (ctx, d, selected, isDraft) {
    ctx.save();
    DT._applyStroke(ctx, d);
    const pts = d.points.map((p) => DT._screenPoint(p));
    const w = DT.width || 800;

    switch (d.type) {
      case 'hline': {
        const y = DT._yOf(d.points[0].price);
        if (y !== null) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          DT._label(ctx, `${U.fmtPrice(d.points[0].price)}`, 8, y - 5, d.color);
        }
        break;
      }
      case 'vline': {
        const x = DT._xOf(d.points[0].dtime);
        if (x !== null) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, DT.height); ctx.stroke();
          DT._label(ctx, U.fmtDate(d.points[0].dtime), x + 5, 16, d.color);
        }
        break;
      }
      case 'trend': {
        const [a, b] = pts;
        if (a && b) {
          // Extensión visual a la derecha (línea de tendencia proyectada)
          const k = b.x - a.x > 1 ? (w - a.x) / (b.x - a.x) : 1;
          const ex = Math.min(w, a.x + (b.x - a.x) * Math.max(1, k));
          const ey = a.y + (b.y - a.y) * Math.max(1, k);
          ctx.globalAlpha = 0.35;
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          DT._label(ctx, DT._deltaLabel(d), Math.min(a.x, b.x), Math.min(a.y, b.y) - 6, d.color);
        }
        break;
      }
      case 'ray': {
        const [a, b] = pts;
        if (a && b) {
          const dx = b.x - a.x, dy = b.y - a.y;
          const L = Math.hypot(dx, dy) || 1;
          const k = (w * 2) / L;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + dx * k, a.y + dy * k); ctx.stroke();
          DT._label(ctx, DT._deltaLabel(d), a.x, a.y - 6, d.color);
        }
        break;
      }
      case 'rect': {
        const [a, b] = pts;
        if (a && b) {
          const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
          const rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
          ctx.globalAlpha = 0.13; ctx.fillStyle = d.color;
          ctx.fillRect(x1, y1, rw, rh);
          ctx.globalAlpha = 1;
          ctx.strokeRect(x1, y1, rw, rh);
          DT._label(ctx, DT._deltaLabel(d), x1 + 4, y1 + 14, d.color);
        }
        break;
      }
      case 'channel': {
        const [a, b, c] = pts;
        if (a && b && c) {
          const dy = c.y - a.y;
          ctx.globalAlpha = 0.1; ctx.fillStyle = d.color;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.lineTo(b.x, b.y + dy); ctx.lineTo(a.x, a.y + dy);
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(a.x, a.y + dy); ctx.lineTo(b.x, b.y + dy); ctx.stroke();
          // Proyección
          const k = b.x - a.x > 1 ? Math.min(1, 60 / (b.x - a.x)) : 0;
          if (k > 0) {
            ctx.globalAlpha = 0.3;
            ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + (b.x - a.x) * k, b.y + (b.y - a.y) * k); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(b.x, b.y + dy); ctx.lineTo(b.x + (b.x - a.x) * k, b.y + dy + (b.y - a.y) * k); ctx.stroke();
            ctx.globalAlpha = 1;
          }
          DT._label(ctx, 'Canal', Math.min(a.x, b.x), Math.min(a.y, b.y + dy) - 7, d.color);
        }
        break;
      }
      case 'fib': {
        const [a, b] = pts;
        if (a && b) {
          const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
          const up = b.price > a.price;
          FIB_LEVELS.forEach((l) => {
            const y = a.y + (b.y - a.y) * l.r;
            const price = a.price !== undefined ? b.price + (a.price - b.price) * l.r : null;
            ctx.save();
            ctx.strokeStyle = l.color; ctx.globalAlpha = 0.85; ctx.lineWidth = 1;
            ctx.setLineDash(l.r === 0 || l.r === 1 ? [] : [5, 4]);
            ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
            ctx.restore();
            DT._label(ctx, `${(l.r * 100).toFixed(1)}%  ${price ? U.fmtPrice(price) : ''}`,
                      x2 + 6, y + 4, l.color);
          });
          ctx.save();
          ctx.globalAlpha = 0.14; ctx.fillStyle = '#ffffff';
          ctx.fillRect(x1, Math.min(a.y, b.y), x2 - x1, Math.abs(b.y - a.y));
          ctx.restore();
        }
        break;
      }
      case 'measure': {
        const [a, b] = pts;
        if (a && b) {
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.setLineDash([]);
          const up = b.price > a.price;
          const col = up ? '#00c853' : '#ff1744';
          ctx.strokeStyle = col; ctx.beginPath();
          ctx.moveTo(b.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(a.x, b.y); ctx.stroke();
          const dp = b.price - a.price;
          const pct = a.price ? (dp / a.price) * 100 : 0;
          const bars = Math.round((b.dtime - a.dtime) / DT._tfSeconds());
          const txt = `${dp > 0 ? '+' : ''}${U.fmtPrice(dp)}  (${pct > 0 ? '+' : ''}${U.num(pct, 2)}%)  ·  ${bars} velas  ·  ${U.fmtDuration(Math.min(a.dtime, b.dtime), Math.max(a.dtime, b.dtime))}`;
          DT._label(ctx, txt, Math.min(a.x, b.x), Math.min(a.y, b.y) - 10, col);
        }
        break;
      }
      case 'ellipse': {
        const [a, b] = pts;
        if (a && b) {
          const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
          ctx.globalAlpha = 0.10; ctx.fillStyle = d.color;
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
          DT._label(ctx, DT._deltaLabel(d), Math.min(a.x, b.x), Math.min(a.y, b.y) - 6, d.color);
        }
        break;
      }
      case 'arrow': {
        const [a, b] = pts;
        if (a && b) {
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          const L = 13;                       // longitud de las dos «barbas» de la punta
          const abanico = 0.42;               // apertura en radianes (±24°)
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - L * Math.cos(ang - abanico), b.y - L * Math.sin(ang - abanico));
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - L * Math.cos(ang + abanico), b.y - L * Math.sin(ang + abanico));
          ctx.stroke();
          DT._label(ctx, DT._deltaLabel(d), Math.min(a.x, b.x), Math.min(a.y, b.y) - 6, d.color);
        }
        break;
      }
      case 'path': {
        // Polilínea libre: une los puntos que vaya marcando el usuario
        const vivos = pts.filter(Boolean);
        if (vivos.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(vivos[0].x, vivos[0].y);
          for (let i = 1; i < vivos.length; i++) ctx.lineTo(vivos[i].x, vivos[i].y);
          ctx.stroke();
          ctx.fillStyle = d.color;
          vivos.forEach((v) => { ctx.beginPath(); ctx.arc(v.x, v.y, 2.4, 0, Math.PI * 2); ctx.fill(); });
          const p0 = d.points[0], pn = d.points[d.points.length - 1];
          if (p0 && pn) {
            const dp = pn.price - p0.price;
            const pct = p0.price ? (dp / p0.price) * 100 : 0;
            const minX = Math.min.apply(null, vivos.map((v) => v.x));
            const minY = Math.min.apply(null, vivos.map((v) => v.y));
            DT._label(ctx, `Camino (${d.points.length} puntos) ${dp >= 0 ? '+' : ''}${U.fmtPrice(dp)} (${pct >= 0 ? '+' : ''}${U.num(pct, 2)}%)`,
                      minX, minY - 8, d.color);
          }
        }
        break;
      }
    }

    /* --- Selección: handles --- */
    if (selected && !isDraft) {
      ctx.save();
      d.points.forEach((p) => {
        const s = DT._screenPoint(p);
        if (!s) return;
        ctx.fillStyle = '#0a0a0b'; ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(s.x - 4, s.y - 4, 8, 8); ctx.fill(); ctx.stroke();
      });
      ctx.restore();
    }
    ctx.restore();
  };

  DT._tfSeconds = function () {
    const c = CM.candles;
    if (c.length > 1) return c[1].time - c[0].time;
    return 3600;
  };

  DT._deltaLabel = function (d) {
    if (d.points.length < 2) return '';
    const a = d.points[0], b = d.points[1];
    const dp = b.price - a.price;
    const pct = a.price ? (dp / a.price) * 100 : 0;
    return `${dp >= 0 ? '+' : ''}${U.fmtPrice(dp)} (${pct >= 0 ? '+' : ''}${U.num(pct, 2)}%)`;
  };

  /** Etiqueta con fondo para que sea legible sobre el gráfico. */
  DT._label = function (ctx, text, x, y, color) {
    if (!text) return;
    ctx.save();
    ctx.font = '10.5px ui-monospace, monospace';
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(11,12,22,.82)';
    ctx.fillRect(x, y - 11, w, 15);
    ctx.fillStyle = color || '#e8eaf6';
    ctx.fillText(text, x + 4, y);
    ctx.restore();
  };

  /** Handles de SL/TP dibujados como pestañas arrastrables. */
  DT._drawTradeHandles = function (ctx) {
    if (!DT.tradeHandles.length) return;
    const w = DT.width || 800;
    DT.tradeHandles.forEach((h) => {
      const y = DT._yOf(h.price);
      if (y === null) return;
      ctx.save();
      ctx.fillStyle = h.color;
      ctx.globalAlpha = 0.9;
      const txt = h.label + ' ⇕';
      const bw = Math.max(46, Math.ceil((ctx.measureText(txt).width || 24) + 12)), bh = 14;
      const bx = w - 92, by = y - bh / 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 3) : ctx.rect(bx, by, bw, bh);
      ctx.fill();
      ctx.fillStyle = '#0a0a0b';
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.fillText(txt, bx + 5, y + 3.5);
      ctx.restore();
    });
  };

  /* ============================== LISTA / UI ============================== */

  DT._emitChange = function () {
    if (DT.onChange) DT.onChange(DT.drawings, DT.selected);
    const el = document.getElementById('tabDrawCount');
    if (el) el.textContent = DT.drawings.length;
  };

  /** Renderiza la lista de dibujos del panel inferior. */
  DT.renderList = function (container) {
    if (!container) return;
    if (!DT.drawings.length) {
      container.innerHTML = '<div class="empty">Sin dibujos. Elige una herramienta en la barra del gráfico y haz clic para dibujar.</div>';
      return;
    }
    const ocultos = DT.drawings.filter((d) => d.hidden).length;
    const barra = `<div class="draw-bar">
      <span class="draw-total">${DT.drawings.length} dibujo${DT.drawings.length === 1 ? '' : 's'}` +
      (ocultos ? ` · ${ocultos} oculto${ocultos === 1 ? '' : 's'}` : '') + `</span>
      <button class="draw-btn" data-eye-all="1" title="Mostrar u ocultar todos los dibujos">${ocultos === DT.drawings.length ? '👁 Mostrar todos' : '🚫 Ocultar todos'}</button>
      <button class="draw-btn danger" data-clear="1" title="Borrar todos los dibujos">🗑️ Borrar todo</button>
    </div>`;
    container.innerHTML = barra + DT.drawings.map((d) => {
      const p0 = d.points[0];
      const meta = `${U.fmtPrice(p0.price)}${p0.dtime ? ' · ' + U.fmtDate(p0.dtime) : ''}`;
      const nombre = U.esc(d.label || TYPE_NAMES[d.type] || d.type);
      return `<div class="draw-item ${d === DT.selected ? 'sel' : ''}${d.hidden ? ' oculto' : ''}" data-id="${d.id}">
        <span class="draw-swatch" style="background:${d.color}"></span>
        <span class="draw-name" data-nombre="${d.id}" title="Doble clic para renombrarlo">${nombre}</span>
        <span class="draw-meta">${meta}</span>
        <button class="draw-eye" data-eye="${d.id}" title="${d.hidden ? 'Mostrar en el gráfico' : 'Ocultar en el gráfico'}">${d.hidden ? '🚫' : '👁'}</button>
        <button class="draw-del" data-del="${d.id}" title="Eliminar este dibujo">✕</button>
      </div>`;
    }).join('');
  };

  /* ============================== PERSISTENCIA ============================== */

  DT.serialize = function () { return DT.drawings.map((d) => Object.assign({}, d)); };

  DT.restore = function (list) {
    DT.drawings = (list || []).map((d) => Object.assign({}, d, { points: d.points.map((p) => Object.assign({}, p)) }));
    DT.selected = null;
    DT.render();
    DT._emitChange();
  };

  /** Compone los dibujos sobre otro contexto (usado en la captura de pantalla). */
  DT.renderTo = function (ctx, w, h) {
    const saved = { w: DT.width, h: DT.height };
    DT.width = w; DT.height = h;
    const oldCtx = DT.ctx;
    DT.ctx = ctx;
    DT.drawings.forEach((d) => { if (!d.hidden) DT._draw(ctx, d, false); });
    DT.ctx = oldCtx;
    DT.width = saved.w; DT.height = saved.h;
  };

  global.DT = DT;
})(window);
