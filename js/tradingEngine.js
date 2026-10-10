/* =========================================================================
 * tradingEngine.js — Motor de trading simulado.
 *
 *  · Cuenta con balance, equity, margen y comisiones.
 *  · Órdenes a MERCADO (LONG/SHORT) con tamaño en %, USD o cantidad.
 *  · ÓRDENES LÍMITE pendientes: se ejecutan cuando el precio entra en el
 *    nivel indicado, vela a vela, durante el replay (y se pueden cancelar).
 *  · Apalancamiento, precio de liquidación estimado.
 *  · SL / TP automáticos evaluados vela a vela por el Bar Replay.
 *  · PnL en tiempo real sobre la última vela mostrada.
 *
 *  Ejecución intrabar (decisión de diseño):
 *    Solo conocemos OHLC, no el orden real de los precios dentro de la vela.
 *    Por defecto se aplica la hipótesis PESIMISTA: si en una misma vela se
 *    tocan SL y TP, se ejecuta el SL. Con huecos (gap) de apertura, si el
 *    precio abre más allá del stop, se ejecuta al OPEN (slippage realista).
 * =======================================================================*/
(function (global) {
  'use strict';

  const TE = {};

  /* ------------------------------ Estado ------------------------------ */

  TE.state = {
    initialCapital: 10000,
    balance: 10000,          // capital realizado (sin PnL abierto)
    equity: 10000,           // balance + PnL no realizado
    leverage: 1,
    marginMode: 'cross',     // 'cross' (toda la cuenta) | 'isolated' (solo el margen)
    feePct: 0.1,             // % por lado (apertura y cierre)
    /* FUNDING, como lo liquida Bitunix (docs/estudio-futuros-bitunix.md §3): un % sobre el NOTIONAL,
       cada 8 h, en las horas UTC 00/08/16 (que son las 08:00/16:00/00:00 UTC+8 de la documentación),
       y CON SIGNO: con tasa positiva PAGA el largo y COBRA el corto. Lo de antes —un % por vela a
       los dos lados por igual— no es el mecanismo de ningún perpetuo: un cortos-que-pagan en un día
       de funding negativo es un error de 2× en el resultado de la sesión.
       `fundingPct` mantiene el nombre (Ajustes y la sesión guardada lo usan) pero ahora significa
       «% por liquidación». `fundingCadaHoras` permite 1, que es lo que Bitunix aplica en contratos
       recién listados o ilíquidos. */
    fundingPct: 0,
    fundingCadaHoras: 8,
    fundingHorasUTC: [0, 8, 16],
    /* RIESGO POR NIVELES (F6/F6 del estudio):
         Maintenance Margin = Open Price · Size · MMR
         Available Margin   = Initial Margin − PnL      (y en cruzado, + margen libre de la cuenta)
         se liquida cuando Available Margin < Maintenance Margin.
       La tabla por defecto es la que trae la propia API de Bitunix en `get_position_tiers`. Solo hay
       DOS filas medidas en la documentación pública: por encima del último `endValue` se conserva la
       última tasa (más honesto que inventarse tramos) y se señala con `fueraDeTabla`. Poner
       `niveles: null` vuelve al modelo simple sin margen de mantenimiento. */
    niveles: [
      { level: 1, startValue: 0, endValue: 50000, leverage: 125, maintenanceMarginRate: 0.004 },
      { level: 2, startValue: 50000, endValue: 200000, leverage: 100, maintenanceMarginRate: 0.005 },
    ],
    /* VALIDEZ por defecto de las órdenes límite (F7 `effect`: GTC | IOC | FOK | POST_ONLY). */
    efecto: 'GTC',
    /* Comisión de MAKER, si se quiere distinguir de la de taker (`feePct`). `null` = sin dato
       medido y se cobra la misma a los dos lados; ver el estudio §4 (no se inventa el 0,02 %). */
    makerFeePct: null,
    slFirst: 'worst',        // 'worst' | 'best'
    averaging: true,         // permitir AÑADIR a una posición abierta (promediar entrada)
    position: null,          // acceso a la posición «principal» (se redefine más abajo)
    posiciones: { long: null, short: null },   // modo HEDGE: una posición por dirección
    modoPosicion: 'ONE_WAY',                   // 'ONE_WAY' | 'HEDGE' (change_position_mode)
    pending: [],             // órdenes LÍMITE en espera (aún no ejecutadas)
    trades: [],              // historial (abiertas + cerradas)
    equitySeries: [],        // [{t, value, time}] para la curva de capital
    feesPaid: 0,
    lastPrice: null,
    lastTime: null,
    seq: 0,
  };

  /* ------------------------ Posiciones y modo de posición ------------------------
     `state.position` sigue siendo lo que lee casi toda la interfaz, pero es un ACCESO a la
     posición «principal» (la larga si la hay); el sitio de verdad es `state.posiciones`, una
     ranura por dirección, que es lo que devuelve Bitunix en modo hedge (filas con
     `positionSide` LONG/SHORT y su `positionId`). Escribir `state.position = p` cae en la
     ranura de su lado; escribir `null` limpia las dos, que es lo que hacen `resetAccount` y la
     importación de partidas. Así el modo hedge no obliga a reescribir 40 lecturas. */
  Object.defineProperty(TE.state, 'position', {
    configurable: true,
    get() { return this.posiciones.long || this.posiciones.short || null; },
    set(v) {
      if (v && v.side) this.posiciones[v.side] = v;
      else { this.posiciones.long = null; this.posiciones.short = null; }
    },
  });

  TE.posiciones = function () { const q = TE.state.posiciones; return [q.long, q.short].filter(Boolean); };
  TE.posicionDe = function (side) { return TE.state.posiciones[side === 'short' ? 'short' : 'long'] || null; };
  /** La posición que una orden `side` puede REDUCIR: siempre la del lado contrario. */
  TE.posicionEncontra = function (side) { return TE.state.posiciones[side === 'long' ? 'short' : 'long'] || null; };
  TE._quitaPosicion = function (p) { if (p && p.side) TE.state.posiciones[p.side] = null; };

  /**
   * Cambio de modo de posición. La regla está medida en el estudio (§13): la API rechaza
   * `change_position_mode` con `200014` si hay posiciones u órdenes abiertas, así que aquí se
   * reproduce el rechazo en vez de permitir un cambio que dejaría pendientes huérfanas (una
   * orden límite colocada como OPEN en one-way no tiene sentido en hedge, donde OPEN y CLOSE
   * son papeles distintos).
   */
  TE.setPosicionModo = function (modo) {
    const s = TE.state;
    const m = String(modo || '').toUpperCase() === 'HEDGE' ? 'HEDGE' : 'ONE_WAY';
    if (s.modoPosicion === m) return { ok: true, modo: m, igual: true };
    const vivas = TE.posiciones();
    if (vivas.length || s.pending.length) {
      return { ok: false, code: 200014, modo: s.modoPosicion,
        hay: vivas.length ? 'posición' : 'orden',
        msg: 'No se puede cambiar el modo de posición con posiciones u órdenes abiertas (200014 en la API).' };
    }
    s.modoPosicion = m;
    U.log('🔀 Modo de posición: ' + (m === 'HEDGE'
      ? 'HEDGE — LONG y SHORT conviven, cada una con su margen, su SL/TP y su liquidación'
      : 'ONE-WAY — una sola posición; la orden contraria la reduce'), 'info');
    TE._emit();
    return { ok: true, modo: m };
  };

  /* ---------------------------- Configuración ---------------------------- */

  TE.configure = function (opts) {
    const s = TE.state;
    if (opts.initialCapital !== undefined) { s.initialCapital = +opts.initialCapital; }
    if (opts.leverage !== undefined) s.leverage = +opts.leverage;
    if (opts.feePct !== undefined) s.feePct = +opts.feePct;
    if (opts.fundingPct !== undefined) s.fundingPct = +opts.fundingPct;
    if (opts.fundingCadaHoras !== undefined) s.fundingCadaHoras = Math.max(1, +opts.fundingCadaHoras || 8);
    if (Array.isArray(opts.fundingHorasUTC)) s.fundingHorasUTC = opts.fundingHorasUTC.map(Number);
    if (opts.niveles !== undefined) s.niveles = Array.isArray(opts.niveles) && opts.niveles.length ? opts.niveles : null;
    if (opts.efecto) s.efecto = String(opts.efecto).toUpperCase();
    if (opts.makerFeePct !== undefined) s.makerFeePct = opts.makerFeePct === null || !Number.isFinite(+opts.makerFeePct) ? null : +opts.makerFeePct;
    if (opts.slFirst !== undefined) s.slFirst = opts.slFirst;
    if (opts.averaging !== undefined) s.averaging = !!opts.averaging;
  };

  /** Reinicia la cuenta al capital inicial y borra el historial. */
  TE.resetAccount = function (capital) {
    const s = TE.state;
    if (capital !== undefined) s.initialCapital = +capital;
    s.balance = s.initialCapital;
    s.equity = s.initialCapital;
    s.position = null;
    s.pending = [];
    s.trades = [];
    s.equitySeries = [];
    s.feesPaid = 0;
    s.seq = 0;
    TE._pushEquity(s.lastTime, s.initialCapital);
  };

  /* ------------------------------ Utilidades ------------------------------ */

  TE.unrealized = function (price) {
    if (price === null || price === undefined) return 0;
    let u = 0;
    // En modo hedge hay dos posiciones vivas y el PnL del capital es la suma: cada lado
    // gana o pierde por su cuenta (en Bitunix el Long PnL y el Short PnL son columnas distintas).
    for (const p of TE.posiciones()) {
      const dir = p.side === 'long' ? 1 : -1;
      u += (price - p.entryPrice) * p.qty * dir;
    }
    return u;
  };

  TE.marginUsed = function () {
    let m = 0;
    for (const p of TE.posiciones()) m += p.notional / p.leverage;
    return m;
  };

  /** Margen libre: balance realizado menos lo inmovilizado (respaldo del cruzado). */
  TE.freeMargin = function () {
    return Math.max(0, TE.state.balance - TE.marginUsed());
  };

  /**
   * Precio de liquidación aproximado, según el MODO DE MARGEN elegido en el
   * panel de órdenes (Cruzado / Aislado, como en Bitunix):
   *
   *   · aislado  → solo respalda la posición el margen asignado:
   *                  liq = entrada ∓ margen/cantidad
   *   · cruzado  → respalda también el margen libre de la cuenta:
   *                  liq = entrada ∓ (margen + libre)/cantidad
   *
   * Ver `TE.liquidationPrice`: desde el estudio de Bitunix el margen de mantenimiento SÍ se
   * tiene en cuenta (antes no, y así lo decía este comentario).
   */
  /* ---- Niveles de riesgo (get_position_tiers) ---- */

  /** Nivel que ocupa un notional. `null` = no hay tabla ⇒ margen de mantenimiento 0. */
  TE.nivel = function (notional) {
    const tabla = TE.state.niveles;
    if (!Array.isArray(tabla) || !tabla.length) return null;
    const n = Math.abs(+notional || 0);
    for (let i = 0; i < tabla.length; i++) {
      const t = tabla[i];
      if (n >= +t.startValue && n < +t.endValue) return Object.assign({ fueraDeTabla: false }, t);
    }
    // Por encima de lo medido en la documentación: la última tasa conocida, no una extrapolada.
    return Object.assign({ fueraDeTabla: true }, tabla[tabla.length - 1]);
  };

  /** Margen de mantenimiento: `Open Price · Size · MMR` (F6, literal de la documentación). */
  TE.margenMantenimiento = function (position) {
    const p = position; if (!p) return 0;
    const t = TE.nivel(p.notional);
    return t ? Math.abs(p.entryPrice * p.qty * +t.maintenanceMarginRate) : 0;
  };

  /** Margen disponible al precio dado: Initial Margin − PnL (F6), más el libre si es cruzado. */
  TE.margenDisponible = function (position, price) {
    const p = position; if (!p) return 0;
    const dir = p.side === 'long' ? 1 : -1;
    const pr = Number.isFinite(+price) ? +price : (TE.state.lastPrice || p.entryPrice);
    let m = TE.marginOf(p) + dir * (pr - p.entryPrice) * p.qty;
    if ((TE.state.marginMode || 'cross') === 'cross') m += Math.max(0, TE.freeMargin());
    return m;
  };

  /** `Margin Rate` de la carta (F2: margen / valor de la posición) y si está en riesgo (F6). */
  TE.marginRate = function (position, price) {
    const p = position; if (!p || !p.qty) return null;
    const pr = Number.isFinite(+price) ? +price : (TE.state.lastPrice || p.entryPrice);
    const valor = Math.abs(pr * p.qty);
    if (!valor) return null;
    const t = TE.nivel(p.notional);
    const ratio = TE.margenDisponible(p, pr) / valor;
    const mmr = t ? +t.maintenanceMarginRate : 0;
    // `ratio` es el `Margin Rate` que se PINTA en la carta (F2: margen / valor de la posición).
    // `enRiesgo` en cambio usa la regla que de verdad liquida (F6: Available Margin < Maintenance
    // Margin), que NO es equivalente a `ratio < MMR`: el mantenimiento se define sobre el precio de
    // entrada y el ratio sobre el valor actual, así que en la propia liquidación el ratio aún es
    // mayor que el MMR. Comparar las dos cosas pintaría «a salvo» en el momento de liquidar.
    return { ratio, mmr, nivel: t ? t.level : null, fueraDeTabla: t ? t.fueraDeTabla : false,
             disponible: TE.margenDisponible(p, pr), mantenimiento: TE.margenMantenimiento(p),
             enRiesgo: mmr > 0 ? TE.margenDisponible(p, pr) < TE.margenMantenimiento(p) : false };
  };

  /** El apalancamiento pedido es un TECHO, no un derecho: el nivel lo recorta (F8). */
  TE.apalancamientoPermitido = function (notional, pedido) {
    const t = TE.nivel(notional);
    const max = t ? +t.leverage : Math.max(1, +pedido || 1);
    const p = Math.min(Math.max(1, +pedido || 1), max);
    return { leverage: p, max, recortado: p !== Math.max(1, +pedido || 1) };
  };

  /**
   * Precio de liquidación con la cuenta de Bitunix (F6), no con la de libro de texto:
   *
   *     liq = entrada − lado · (margen + libre − entrada·tamaño·MMR) / tamaño
   *
   * despeje de «el margen disponible cae al margen de mantenimiento». Con MMR = 0 (`niveles:
   * null`) sale EXACTAMENTE la fórmula que había antes, así que el modelo simple sigue siendo un
   * caso particular, no un comportamiento perdido. Si el resultado es ≤ 0 la posición no tiene
   * precio de liquidación dentro del dominio del precio: `liqPrice ≤ 0` en la API significa justo
   * eso («riesgo bajo», F8) y se comunica con `TE.liqInfo().sinNivel` en vez de pintar un 0.
   */
  TE.liquidationPrice = function (position) {
    if (!position) return null;
    const p = position;
    const side = p.side === 'long' ? 1 : -1;
    if (!p.qty) return p.entryPrice * (1 - side / p.leverage);
    const margen = TE.marginOf(p);
    const libre = (TE.state.marginMode || 'cross') === 'cross'
      ? Math.max(0, TE.freeMargin()) : 0;
    const liq = p.entryPrice - side * (margen + libre - TE.margenMantenimiento(p)) / p.qty;
    return Math.max(0, +liq.toFixed(6));
  };

  /** Todo lo que la carta de posición tiene que decir del riesgo, junto y medido. */
  TE.liqInfo = function (position) {
    const precio = TE.liquidationPrice(position);
    const t = position ? TE.nivel(position.notional) : null;
    return { precio, sinNivel: precio === null || precio <= 0, mmr: t ? +t.maintenanceMarginRate : 0,
             nivel: t ? t.level : null, apalancamientoMax: t ? +t.leverage : null,
             fueraDeTabla: t ? t.fueraDeTabla : false,
             mantenimiento: TE.margenMantenimiento(position) };
  };

  /** Margen inmovilizado por UNA posición (incluye el añadido al promediar). */
  TE.marginOf = function (position) {
    const p = position;
    if (!p) return 0;
    return Number.isFinite(p.margin) && p.margin > 0 ? p.margin : (p.notional / p.leverage);
  };

  /** Cambia el modo de margen y reescribe la liquidación de lo abierto. */
  TE.setMarginMode = function (mode) {
    const m = mode === 'isolated' ? 'isolated' : 'cross';
    TE.state.marginMode = m;
    // La liquidación no se guarda: se recalcula al pintar (UI, carta y
    // comercial), así cambiar el modo no deja valores viejos.
    return m;
  };

  TE._pushEquity = function (time, value) {
    const s = TE.state;
    const last = s.equitySeries[s.equitySeries.length - 1];
    if (last && last.t === time) last.value = value;
    else s.equitySeries.push({ t: time, value, time });
    // Acotar memoria en sesiones muy largas
    if (s.equitySeries.length > 20000) s.equitySeries.splice(0, 5000);
  };

  /* --------------------------- Abrir / cerrar --------------------------- */

  /**
   * Abre una posición a mercado.
   * @param {'long'|'short'} side
   * @param {object} params { mode:'pct'|'notional'|'qty', size, entryPrice, sl, tp, leverage, feePct, time }
   * @returns {object|null} posición creada
   */
  /**
   * `reduceOnly` (F7): una orden así NUNCA abre ni invierte una posición; solo la reduce. En el
   * exchange se RECHAZA si no hay posición o si, por lado, acabaría aumentando la exposición —no
   * se transforma en otra cosa—. Aquí eso es lo que hace, y por eso el cierre de un TP/SL con
   * ejecución límite se apoya en este camino (es un cierre, no una apertura contraria).
   */
  TE._reduceOnly = function (side, params) {
    const s = TE.state, p = TE.posicionEncontra(side);
    if (!p) {
      // `p` es por construcción la posición del lado CONTRARIO, así que no haberla significa una
      // de dos cosas, y se dicen aparte porque el usuario necesita saber cuál: que no hay nada que
      // cerrar, o que lo que hay está en su mismo lado (y una reduce-only nunca aumenta).
      const principal = s.position;
      if (principal && principal.side === side) {
        U.log('🚫 Orden reduce-only descartada: en el mismo lado AUMENTARÍA la posición.', 'warn');
        return null;
      }
      U.log('🚫 Orden reduce-only descartada: no hay posición abierta que reducir.', 'warn');
      U.toast('Reduce-only: no hay posición que cerrar', 'warn', 3200);
      return null;
    }
    let frac = 1;
    const modo = params.mode || 'pct', size = +params.size || 0;
    if (modo === 'pct') frac = size / 100;
    else if (modo === 'notional') frac = p.notional ? size / p.notional : 1;
    else if (modo === 'qty') frac = p.qty ? size / p.qty : 1;
    frac = Math.min(1, Math.max(0, frac));
    if (!(frac > 0)) return null;
    const price = Number.isFinite(+params.entryPrice) ? +params.entryPrice : (s.lastPrice || p.entryPrice);
    if (frac >= 0.999) return TE.closePosition(price, params.reason || 'manual', params.time, p);
    return TE.reducePosition(frac, price, params.time, params.reason || 'parcial', p);
  };

  TE.openPosition = function (side, params) {
    const s = TE.state;
    params = params || {};
    if (params.reduceOnly) return TE._reduceOnly(side, params);
    // En HEDGE, `Abrir` y `Cerrar` son papeles distintos (la API lo dice con `tradeSide` y
    // exigiendo `positionId` en CLOSE): una orden al otro lado NO toca la posición existente,
    // abre la suya. Con «Cerrar» pedido, en cambio, sí reduce la contraria.
    if (s.modoPosicion === 'HEDGE' && params.tradeSide === 'close') {
      if (!TE.posicionEncontra(side)) {
        U.toast('No hay posición en el lado contrario que cerrar', 'warn', 3200);
        return null;
      }
      return TE._reduceOnly(side, Object.assign({}, params, { reduceOnly: true }));
    }
    const misma = s.modoPosicion === 'HEDGE' ? TE.posicionDe(side) : s.position;
    if (misma) {
      // MISMO LADO con el promediado activo → se AÑADE a la posición abierta, como
      // el «Add position» de Bitunix: precio medio ponderado, tamaño y margen
      // sumados, y los niveles de TP/SL de la posición se conservan.
      if (s.averaging && s.position.side === side && params.allowAverage !== false) {
        return TE.addToPosition(side, params);
      }
      U.toast('Ya hay una posición abierta. Ciérrala antes de abrir otra, o activa «Promediar entradas» en Ajustes.', 'warn', 4200);
      return null;
    }

    const entryPrice = +params.entryPrice;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) { U.toast('Precio de entrada no válido', 'err'); return null; }

    const leverage = Math.max(1, +(params.leverage || s.leverage || 1));
    const feePct = params.feePct !== undefined ? +params.feePct : s.feePct;

    // --- Cálculo del tamaño de la posición ---
    const equity = s.balance; // usamos capital realizado disponible
    let notional = 0, qty = 0;
    if (params.mode === 'pct') {
      const pct = U.clamp(+params.size || 0, 0, 100);
      notional = equity * (pct / 100) * leverage;
    } else if (params.mode === 'notional') {
      notional = Math.max(0, +params.size || 0);
    } else { // qty
      qty = Math.max(0, +params.size || 0);
      notional = qty * entryPrice;
    }
    if (!qty) qty = notional / entryPrice;

    const margin = notional / leverage;
    if (notional <= 0 || !Number.isFinite(qty)) { U.toast('Tamaño de posición no válido', 'err'); return null; }
    if (margin > s.balance + 1e-9) {
      U.toast(`Margen insuficiente: necesitas ${U.fmtMoney(margin)} y tienes ${U.fmtMoney(s.balance)}`, 'err');
      return null;
    }

    const fee = notional * (feePct / 100);

    // --- SL / TP ---
    let sl = Number.isFinite(+params.sl) && +params.sl > 0 ? +params.sl : null;
    let tp = Number.isFinite(+params.tp) && +params.tp > 0 ? +params.tp : null;
    // Validación de coherencia según dirección
    if (side === 'long') {
      if (sl !== null && sl >= entryPrice) { U.toast('En LONG el Stop Loss debe estar por debajo del precio de entrada; se ignora', 'warn'); sl = null; }
      if (tp !== null && tp <= entryPrice) { U.toast('En LONG el Take Profit debe estar por encima del precio de entrada; se ignora', 'warn'); tp = null; }
    } else {
      if (sl !== null && sl <= entryPrice) { U.toast('En SHORT el Stop Loss debe estar por encima del precio de entrada; se ignora', 'warn'); sl = null; }
      if (tp !== null && tp >= entryPrice) { U.toast('En SHORT el Take Profit debe estar por debajo del precio de entrada; se ignora', 'warn'); tp = null; }
    }

    // Riesgo inicial (distancia al SL × tamaño) → para el R múltiplo
    const riskUsd = sl !== null ? Math.abs(entryPrice - sl) * qty : null;

    // Retenemos la comisión de apertura del balance ya (flujo de caja realista)
    s.balance -= fee;
    s.feesPaid += fee;

    const position = {
      id: ++s.seq,
      side,
      status: 'open',
      entryPrice, qty, notional,
      leverage, feePct,
      sl, tp,
      // F7: cada nivel lleva CONTRA QUÉ se mide y CÓMO se ejecuta. Se admiten en la orden de
      // apertura (el formulario de Bitunix los ofrece ahí, y `place_order` lleva los cuatro
      // campos `tp*`/`sl*`), no solo al modificar la posición.
      slSrc: params.slSrc === 'mark' ? 'mark' : 'last',
      tpSrc: params.tpSrc === 'mark' ? 'mark' : 'last',
      slExec: params.slExec === 'limit' ? 'limit' : 'market',
      tpExec: params.tpExec === 'limit' ? 'limit' : 'market',
      slExecPrice: Number.isFinite(+params.slExecPrice) && +params.slExecPrice > 0 ? +params.slExecPrice : null,
      tpExecPrice: Number.isFinite(+params.tpExecPrice) && +params.tpExecPrice > 0 ? +params.tpExecPrice : null,
      // Agenda de funding, anclada a la APERTURA (no a la primera vela evaluada): una posición que
      // se abre y se mueve a una vela diaria tiene que pagar las tres liquidaciones del día.
      pagoFundingEn: TE._siguienteFunding(params.time || s.lastTime || 0),
      riskUsd,
      entryTime: params.time || s.lastTime,
      entryBalance: s.balance,
      openFee: fee,        // comisión de apertura (ya descontada del balance)
      funding: 0,          // coste de financiación acumulado durante la posición
      fees: fee,
      mfe: 0, mae: 0,      // excursión favorable/adversa máxima
      bars: 0,
      initialSl: sl, initialTp: tp,
      origin: params.origin || 'market',   // 'market' (a mercado) | 'limite'
      limitPrice: params.limitPrice !== undefined ? params.limitPrice : null,
      // --- Gestión de posición (estilo Bitunix) ---
      parts: [{ entryPrice, qty, notional, fee, time: params.time || s.lastTime,
                origin: params.origin || 'market' }],   // cada entrada/promediado
      additions: 0,                        // nº de veces que se añadió a esta posición
      tpLevels: [],                        // TP escalonado (Partial TP/SL)
      realizedParcial: 0,                  // PnL ya realizado en cierres parciales
      trail: null,                         // trailing stop { pct, activation, peak, armed, frac }
    };
    s.position = position;
    s.trades.push(position);

    U.playSound('open');
    U.log(`${params.origin === 'limite' ? '⏳→✅ ' : ''}${side === 'long' ? '🟢 LONG' : '🔴 SHORT'} abierto @ ${U.fmtPrice(entryPrice)} · ` +
          `tamaño ${U.num(qty, 6)} (${U.fmtMoney(notional)}) · ${leverage}x · ` +
          `SL ${sl ? U.fmtPrice(sl) : '—'} · TP ${tp ? U.fmtPrice(tp) : '—'} · ` +
          `comisión ${U.fmtMoney(fee)}`, side === 'long' ? 'ok' : 'bad');

    TE.updateEquity(entryPrice, params.time);
    TE._emit();
    return position;
  };

  /**
   * Cierra la posición abierta.
   * @param {number} price  precio de ejecución
   * @param {string} reason 'manual' | 'sl' | 'tp' | 'liq' | 'reset' | 'end'
   * @param {number} time
   */
  TE.closePosition = function (price, reason = 'manual', time, pos) {
    const s = TE.state;
    const p = pos || s.position;
    if (!p) return null;

    const dir = p.side === 'long' ? 1 : -1;
    const gross = (price - p.entryPrice) * p.qty * dir;
    const exitFee = Math.abs(price * p.qty) * (p.feePct / 100);

    // Actualizar excursión antes de cerrar
    p.mfe = Math.max(p.mfe, (price - p.entryPrice) * p.qty * dir);
    p.mae = Math.min(p.mae, (price - p.entryPrice) * p.qty * dir);

    let net = gross - exitFee;      // flujo de caja del cierre

    // Una liquidación no puede perder más que el margen comprometido
    if (reason === 'liq') {
      const margin = p.notional / p.leverage;
      net = Math.max(net, -(margin - (p.openFee || 0)));
    }

    s.balance += net;
    s.feesPaid += exitFee;

    p.status = 'closed';
    p.exitPrice = price;
    p.exitTime = time !== undefined ? time : s.lastTime;
    // PnL del trade = beneficio bruto − comisión de cierre − comisión de apertura − financiación
    p.pnl = net - (p.openFee || 0) - (p.funding || 0);
    p.grossPnl = gross;
    p.fees = (p.fees || 0) + exitFee;
    p.pnlPct = p.entryBalance > 0 ? (p.pnl / p.entryBalance) * 100 : 0;   // % sobre el capital en el momento de entrar
    p.pnlPctPrice = p.entryPrice > 0 ? ((price - p.entryPrice) / p.entryPrice) * 100 * dir : 0; // % de movimiento del precio
    p.rMultiple = p.riskUsd ? p.pnl / p.riskUsd : null;
    p.reason = reason;
    p.bars = p.bars || 0;

    TE._quitaPosicion(p);          // solo la suya: la otra dirección sigue viva en modo hedge
    s.lastPrice = price;

    const won = p.pnl > 0;
    U.playSound(won ? 'win' : 'loss');
    U.log(`${won ? '✅' : '❌'} Posición cerrada @ ${U.fmtPrice(price)} por ${TE.reasonLabel(reason)} · ` +
          `PnL ${U.fmtMoney(p.pnl, true)} (${U.fmtPct(p.pnlPct, 2, true)})` +
          (p.rMultiple !== null ? ` · ${U.num(p.rMultiple, 2)}R` : ''), won ? 'ok' : 'bad');

    TE.updateEquity(price, p.exitTime);
    TE._emit();
    return p;
  };

  TE.reasonLabel = function (r) {
    return ({
      manual: 'cierre manual',
      sl: 'STOP LOSS',
      tp: 'TAKE PROFIT',
      liq: 'LIQUIDACIÓN',
      reset: 'reinicio del replay',
      end: 'fin del replay',
      cambio: 'cambio de serie',
      inversion: 'inversión',
      parcial: 'cierre parcial',
      trail: 'TRAILING STOP',
    })[r] || r;
  };

  /* ------------------------- Modificación de SL/TP ------------------------- */

  TE.setSL = function (price, opts) {
    const p = TE.state.position;
    if (!p) return false;
    const o = opts || {};
    const forzar = !!o.force, sil = !!o.silent;
    if (price === null || price === undefined || !Number.isFinite(+price)) { p.sl = null; }
    else {
      // El break-even de un LONG queda POR ENCIMA de la entrada (es un stop que
      // solo protege ganancias), así que esa validación se omite con {force:true}
      if (!forzar) {
        if (p.side === 'long' && price >= p.entryPrice) { if (!sil) U.toast('SL inválido: debe estar por debajo de la entrada', 'warn'); return false; }
        if (p.side === 'short' && price <= p.entryPrice) { if (!sil) U.toast('SL inválido: debe estar por encima de la entrada', 'warn'); return false; }
      }
      p.sl = +price;
    }
    // F7: un nivel de SL no es solo un precio. Lleva CONTRA QUÉ se mide el disparo
    // (`slStopType`: MARK_PRICE | LAST_PRICE) y CÓMO se ejecuta (`slOrderType`: LIMIT | MARKET,
    // con su `slOrderPrice`). Los campos nuevos son opcionales y su default reproduce el
    // comportamiento anterior: disparo contra los extremos de la vela y cierre a mercado.
    const o2 = opts || {};
    if (o2.src !== undefined) p.slSrc = o2.src === 'mark' ? 'mark' : 'last';
    if (o2.exec !== undefined) p.slExec = o2.exec === 'limit' ? 'limit' : 'market';
    if (o2.execPrice !== undefined) p.slExecPrice = Number.isFinite(+o2.execPrice) && +o2.execPrice > 0 ? +o2.execPrice : null;
    p._slLimitPlaced = false;   // mover el nivel vuelve a permitir colocar su orden de cierre
    TE.updateRisk(p);
    // {silent:true} se usa al ARRASTRAR el nivel: un log por cada mousemove
    // llenaría el registro de líneas inútiles (y los avisos, la pantalla).
    if (!sil) U.log(`🛠 SL actualizado a ${p.sl ? U.fmtPrice(p.sl) : 'sin SL'}`, 'warn');
    TE._emit();
    return true;
  };

  TE.setTP = function (price, opts) {
    const p = TE.state.position;
    if (!p) return false;
    const o = opts || {};
    const sil = !!o.silent;
    if (price === null || price === undefined || !Number.isFinite(+price)) { p.tp = null; }
    else {
      if (p.side === 'long' && price <= p.entryPrice) { if (!sil) U.toast('TP inválido: debe estar por encima de la entrada', 'warn'); return false; }
      if (p.side === 'short' && price >= p.entryPrice) { if (!sil) U.toast('TP inválido: debe estar por debajo de la entrada', 'warn'); return false; }
      p.tp = +price;
    }
    if (opts && opts.src !== undefined) p.tpSrc = opts.src === 'mark' ? 'mark' : 'last';
    if (opts && opts.exec !== undefined) p.tpExec = opts.exec === 'limit' ? 'limit' : 'market';
    if (opts && opts.execPrice !== undefined) p.tpExecPrice = Number.isFinite(+opts.execPrice) && +opts.execPrice > 0 ? +opts.execPrice : null;
    p._tpLimitPlaced = false;
    TE.updateRisk(p);
    if (!sil) U.log(`🛠 TP actualizado a ${p.tp ? U.fmtPrice(p.tp) : 'sin TP'}`, 'warn');
    TE._emit();
    return true;
  };

  /* ------------------------------ TRAILING STOP ------------------------------
   * Stop dinámico (el «Trailing Stop» de Bitunix): en lugar de un precio fijo, el
   * stop se separa un % FIJO del MEJOR precio alcanzado desde que se armó (el
   * «pico»). Sube con el precio y no baja nunca: lo que gana la posición queda
   * protegido, y si el precio retrocede ese % se dispara un cierre a mercado.
   *
   * Opciones, calcadas del diálogo del exchange:
   *   · pct        → «Callback ratio»: retracement en % que dispara el cierre.
   *   · activation → «Activation price»: no empieza a seguir hasta tocar ese precio
   *                  (sin activación, sigue desde el precio actual).
   *   · frac       → fracción de la posición que cierra (1 = entera, como el
   *                  «Partial TP/SL» pero en el lado del stop).
   *
   * Criterio de simulación con velas OHLC —no es un capricho, es lo honesto con
   * este dato—:
   *   · El pico solo se mueve al CERRAR la vela, y una vela no puede disparar un
   *     nivel que ella misma acaba de crear: dentro de la vela se desconoce el
   *     orden real entre el high y el low. Es el mismo sesgo pesimista que aplica
   *     el motor cuando SL y TP caen en la misma vela.
   *   · La activación, en cambio, sí se detecta dentro de la vela (toca high/low),
   *     y el pico arranca en el propio precio de activación (no en el extremo de
   *     la vela: tampoco sabemos si el extreme pasó después de activar).
   *   · Se ejecuta como un stop: si la vela ABRE con el nivel cruzado (hueco) se
   *     rellena a la apertura, deslizamiento incluido (TE._fillPrice).
   * --------------------------------------------------------------------------- */

  /**
   * Precio de disparo actual del trailing, o null si aún no está armado
   * (o si no hay trailing). Long: pico·(1 − pct). Short: pico·(1 + pct).
   */
  TE.trailingPrice = function (pos) {
    const p = pos || TE.state.position;
    const t = p && p.trail;
    if (!t || !t.armed || !Number.isFinite(t.peak) || t.peak <= 0) return null;
    const dir = p.side === 'long' ? 1 : -1;
    const lvl = dir === 1 ? t.peak * (1 - t.pct / 100) : t.peak * (1 + t.pct / 100);
    return Number.isFinite(lvl) && lvl > 0 ? lvl : null;
  };

  /** Todo lo que necesita la interfaz para describir el trailing de la posición. */
  TE.trailingInfo = function (pos) {
    const p = pos || TE.state.position;
    const t = p && p.trail;
    if (!t) return null;
    const level = TE.trailingPrice(p);
    const ref = TE.state.lastPrice || p.entryPrice;
    return {
      pct: t.pct, frac: t.frac, peak: t.peak, armed: !!t.armed,
      activation: t.activation !== null && t.activation !== undefined ? t.activation : null,
      level,
      // Distancia del nivel de disparo al precio actual (negativa en un LONG: está por debajo)
      distPct: level !== null && ref ? ((level - ref) / ref) * 100 : null,
      // Cuánto le falta al precio para armarlo (solo tiene sentido si aún no está armado)
      toActivation: t.armed || t.activation === null ? null
        : ((t.activation - ref) / ref) * 100,
    };
  };

  /**
   * Activa —o reconfigura— el trailing stop de la posición abierta.
   * @param {{pct:number, activation?:number|null, frac?:number}} params
   * @param {{silent?:boolean}} opts
   */
  TE.setTrailing = function (params, opts) {
    const s = TE.state;
    const pr0 = params || {};
    const p = (pr0.side && TE.posicionDe(pr0.side)) || s.position;
    if (!p) { U.toast('Abre una posición antes de activar el trailing', 'warn'); return null; }
    const pr = params || {};
    const o = opts || {};
    const pct = +pr.pct;
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      U.toast('Retracement no válido: indica un % entre 0 y 100', 'err');
      return null;
    }
    const dir = p.side === 'long' ? 1 : -1;
    const ref = s.lastPrice || p.entryPrice;
    // Activación opcional: se admiten '', null y undefined como «sin activación»
    let act = null;
    const raw = pr.activation;
    if (raw !== null && raw !== undefined && raw !== '') {
      act = +raw;
      if (!Number.isFinite(act) || act <= 0) {
        U.toast('Precio de activación no válido', 'err');
        return null;
      }
    }
    // Si la activación ya está superada, el stop nace armado (un exchange haría lo mismo)
    const yaCruzada = act !== null && (dir === 1 ? ref >= act : ref <= act);
    const frac = U.clamp(pr.frac === undefined || pr.frac === null || pr.frac === ''
      ? 100 : +pr.frac, 1, 100) / 100;
    p.trail = {
      pct,
      activation: act,
      frac,
      peak: act === null || yaCruzada ? ref : act,
      armed: act === null || yaCruzada,
      since: s.lastTime,
    };
    if (!o.silent) {
      const lv = TE.trailingPrice(p);
      U.log(`🌀 Trailing ${U.num(pct, 2)} % ${p.trail.armed
        ? `activo: pico ${U.fmtPrice(p.trail.peak)} → dispara a ${lv ? U.fmtPrice(lv) : '—'}`
        : `en espera de la activación en ${U.fmtPrice(act)}`}`, 'sys');
      U.toast(`🌀 Trailing ${U.num(pct, 2)} % · ${p.trail.armed ? 'siguiendo desde ' + U.fmtPrice(p.trail.peak) : 'arma en ' + U.fmtPrice(act)}`, 'ok', 3200);
    }
    TE.updateRisk(p);
    TE._emit();
    return p.trail;
  };

  /** Quita el trailing stop de la posición abierta. */
  TE.removeTrailing = function (opts) {
    const p = (opts && opts.side && TE.posicionDe(opts.side)) || TE.state.position;
    if (!p || !p.trail) return false;
    p.trail = null;
    const sil = !!(opts && opts.silent);
    if (!sil) { U.log('🌀 Trailing stop retirado', 'warn'); U.toast('Trailing stop quitado', 'info', 1800); }
    TE._emit();
    return true;
  };

  /**
   * Avanza el trailing al cerrar la vela: arma el stop si la vela toca la
   * activación y, una vez armado, sube (LONG) o baja (SHORT) el pico con el
   * extremo favorable de la vela. Devuelve 'armado' | 'movido' | null.
   */
  TE._updateTrailing = function (candle, pos) {
    const p = pos || TE.state.position;
    if (!p || !p.trail || !candle) return null;
    const t = p.trail;
    const dir = p.side === 'long' ? 1 : -1;
    if (!t.armed) {
      const tocado = dir === 1 ? candle.high >= t.activation : candle.low <= t.activation;
      if (!tocado) return null;
      t.armed = true;
      t.peak = t.activation;           // el pico arranca en la activación, no en el extremo de la vela
      U.log(`🌀 Trailing armado en ${U.fmtPrice(t.activation)} · pico ${U.fmtPrice(t.peak)}, ` +
            `dispara al retroceder un ${U.num(t.pct, 2)} %`, 'ok');
      return 'armado';
    }
    const fav = dir === 1 ? candle.high : candle.low;
    const nuevo = dir === 1 ? Math.max(t.peak, fav) : Math.min(t.peak, fav);
    if (!Number.isFinite(nuevo) || nuevo === t.peak) return null;
    t.peak = nuevo;
    return 'movido';
  };

  /** Recalcula el riesgo usado para el R múltiplo. */
  TE.updateRisk = function (p) {
    p.riskUsd = p.sl !== null ? Math.abs(p.entryPrice - p.sl) * p.qty : null;
  };

  /* ============ PROMEDIADO Y CIERRE PARCIAL (como lo hace Bitunix) ============
   *
   * Bitunix gestiona una posición abierta con dos acciones en su panel de
   * posición: «Add position» (añadir tamaño, moviendo el PRECIO MEDIO de
   * entrada) y el menú TP/SL con «Position TP/SL» / «Partial TP/SL». Las reglas
   * que replica esta implementación:
   *
   *  · Al añadir, la entrada pasa a ser la MEDIA PONDERADA por tamaño; el
   *    notional y el margen se suman y el precio de liquidación se recalcula
   *    sobre el total.
   *  · Los niveles de TP/SL de la posición NO se mueven al promediar: son de la
   *    posición entera («Position TP/SL»: la cantidad ejecutada se ajusta sola
   *    al cambiar el tamaño de la posición).
   *  · Opcionalmente se pueden fijar nuevos TP/SL en la misma orden de
   *    promediado (Bitunix permite llevarlos en el formulario al añadir).
   *  · «Partial TP/SL»: se pueden poner varios precios de TP, cada uno cerrando
   *    un % de la posición; lo que sigue abierto conserva su SL.
   *  · El precio de break-even NO es el precio medio: incluye comisiones.
   * ============================================================================*/

  /**
   * Añade tamaño a la posición abierta (promediar entrada).
   * @param {'long'|'short'} side  debe coincidir con el de la posición
   * @param {object} params {mode,size,entryPrice,sl,tp,leverage,feePct,time}
   * @returns {object|null} la posición actualizada
   */
  TE.addToPosition = function (side, params) {
    const s = TE.state;
    // La posición del LADO que se pide, no «la que haya»: en modo hedge hay dos y promediar una
    // no puede caer sobre la contraria.
    const p = (params && params.pos) || TE.posicionDe(side) || s.position;
    if (!p) { U.toast('No hay posición abierta que promediar', 'warn'); return null; }
    if (p.side !== side) {
      U.toast('Promediar solo añade a la posición en SU misma dirección; para invertir usa el lado contrario', 'warn', 4200);
      return null;
    }
    const entryPrice = +params.entryPrice;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) { U.toast('Precio de entrada no válido', 'err'); return null; }

    const feePct = params.feePct !== undefined ? +params.feePct : p.feePct;
    const leverage = Math.max(1, +(params.leverage || p.leverage || 1));

    // Tamaño de la nueva tandada: mismos modos que al abrir (% del capital, USD o unidades)
    let notional = 0, qty = 0;
    if (params.mode === 'pct') {
      notional = s.balance * (U.clamp(+params.size || 0, 0, 100) / 100) * leverage;
    } else if (params.mode === 'notional') {
      notional = Math.max(0, +params.size || 0);
    } else {
      qty = Math.max(0, +params.size || 0);
      notional = qty * entryPrice;
    }
    if (!qty) qty = notional / entryPrice;
    if (notional <= 0 || !Number.isFinite(qty) || qty <= 0) { U.toast('Tamaño no válido para promediar', 'err'); return null; }

    // Solo se puede usar el MARGEN LIBRE (el comprometido por la posición sigue siéndolo)
    const margenNuevo = notional / leverage;
    const libre = s.balance - TE.marginUsed();
    if (margenNuevo > libre + 1e-9) {
      U.toast(`Margen libre insuficiente para promediar: hacen falta ${U.fmtMoney(margenNuevo)} y quedan ${U.fmtMoney(Math.max(0, libre))}`, 'err', 4600);
      return null;
    }

    const prevQty = p.qty, prevEntry = p.entryPrice;
    const media = (prevEntry * prevQty + entryPrice * qty) / (prevQty + qty);
    const fee = notional * (feePct / 100);
    s.balance -= fee;
    s.feesPaid += fee;

    p.parts.push({ entryPrice, qty, notional, fee, time: params.time || s.lastTime, origin: params.origin || 'market' });
    p.qty = prevQty + qty;
    p.entryPrice = media;
    p.notional = p.qty * media;
    p.leverage = leverage;
    p.openFee = (p.openFee || 0) + fee;
    p.fees = (p.fees || 0) + fee;
    p.additions = (p.additions || 0) + 1;
    if ((params.time || s.lastTime) < p.entryTime) p.entryTime = params.time || s.lastTime;

    // TP/SL: por defecto SE CONSERVAN (Position TP/SL). Si la orden de promediado
    // trae niveles nuevos, sustituyen a los de la posición entera.
    const slNuevo = Number.isFinite(+params.sl) && +params.sl > 0 ? +params.sl : null;
    const tpNuevo = Number.isFinite(+params.tp) && +params.tp > 0 ? +params.tp : null;
    if (slNuevo !== null) { p.sl = slNuevo; p.initialSl = slNuevo; }
    if (tpNuevo !== null) { p.tp = tpNuevo; p.initialTp = tpNuevo; }
    // El trailing se queda como estaba: un exchange sigue defendiendo el pico ya
    // alcanzado de la POSICIÓN, no del precio medio nuevo. Se avisa para que quede
    // claro (el retroceso % ahora es respecto a otro sitio).
    if (p.trail) {
      const tl = TE.trailingPrice(p);
      U.log(`🌀 El trailing sigue activo: pico ${U.fmtPrice(p.trail.peak)} → dispara a ` +
            `${tl ? U.fmtPrice(tl) : '—'} (${U.num(p.trail.pct, 2)} % de retroceso)`, 'sys');
    }
    if (params.reaim === 'medio') {
      // Re-aim opcional: en vez de conservar los precios absolutos, conserva la
      // DISTANCIA PORCENTUAL que había al precio medio anterior. Así el TP/SL
      // siguen «igual de lejos» del nuevo precio medio tras promediar.
      const dir = p.side === 'long' ? 1 : -1;
      if (slNuevo === null && p.sl !== null) {
        const d = Math.abs(p.sl - prevEntry) / prevEntry;
        p.sl = media * (1 - dir * d);
      }
      if (tpNuevo === null && p.tp !== null) {
        const d = Math.abs(p.tp - prevEntry) / prevEntry;
        p.tp = media * (1 + dir * d);
      }
    }
    TE.updateRisk(p);

    if (p.sl !== null && ((p.side === 'long' && p.sl >= media) || (p.side === 'short' && p.sl <= media))) {
      U.log(`⚠️ Tras promediar, el SL (${U.fmtPrice(p.sl)}) ha quedado al otro lado del precio medio (${U.fmtPrice(media)}): se ejecutará en cuanto toque la vela`, 'warn');
    }

    U.playSound('open');
    U.log(`➕ Promediado ${p.side.toUpperCase()} @ ${U.fmtPrice(entryPrice)} · ${U.num(qty, 6)} uds · ` +
          `nuevo precio medio ${U.fmtPrice(media)} · total ${U.num(p.qty, 6)} uds (${U.fmtMoney(p.notional)}) · ` +
          `entrada ${p.parts.length}/${p.parts.length === 1 ? 'única' : p.parts.length} · comisión ${U.fmtMoney(fee)}`, 'warn');
    TE.updateEquity(entryPrice, params.time);
    TE._emit();
    return p;
  };

  /**
   * Cierra una FRACCIÓN de la posición realizando su PnL (0 < frac < 1).
   * La parte de comisión de apertura proporcional se carga a ESTE registro, así
   * que el resto de la posición la paga al cerrarse: el total de la hoja de
   * resultados sigue cuadrando con el balance.
   * @returns {object|null} el registro cerrado (o la posición cerrada si frac ≥ 1)
   */
  TE.reducePosition = function (frac, price, time, reason = 'parcial', pos) {
    const s = TE.state;
    const p = pos || s.position;
    if (!p) { U.toast('No hay posición abierta', 'warn'); return null; }
    const f = +frac;
    if (!Number.isFinite(f) || f <= 0) return null;
    if (f >= 0.999) return TE.closePosition(price, reason === 'parcial' ? 'manual' : reason, time, p);

    const dir = p.side === 'long' ? 1 : -1;
    const qtyClose = p.qty * f;
    const px = Number.isFinite(+price) ? +price : s.lastPrice;
    const gross = (px - p.entryPrice) * qtyClose * dir;
    const exitFee = Math.abs(px * qtyClose) * (p.feePct / 100);
    const openShare = (p.openFee || 0) * f;

    s.balance += gross - exitFee;
    s.feesPaid += exitFee;

    const row = {
      id: ++s.seq,
      side: p.side,
      status: 'closed',
      parcial: true,
      entryPrice: p.entryPrice, exitPrice: px,
      qty: qtyClose, notional: qtyClose * p.entryPrice,
      leverage: p.leverage, feePct: p.feePct,
      entryTime: p.entryTime, exitTime: time !== undefined ? time : s.lastTime,
      entryBalance: s.balance,
      grossPnl: gross,
      fees: exitFee + openShare,
      pnl: gross - exitFee - openShare,
      bars: p.bars || 0,
      reason,
      sl: p.sl, tp: p.tp, initialSl: p.initialSl, initialTp: p.initialTp,
      mfe: (p.mfe || 0) * f, mae: (p.mae || 0) * f,
      riskUsd: p.sl !== null ? Math.abs(p.entryPrice - p.sl) * qtyClose : null,
      additions: p.additions || 0,
      parts: p.parts.length,
    };
    row.pnlPct = row.entryBalance > 0 ? (row.pnl / row.entryBalance) * 100 : 0;
    row.pnlPctPrice = row.entryPrice > 0 ? ((px - row.entryPrice) / row.entryPrice) * 100 * dir : 0;
    row.rMultiple = row.riskUsd ? row.pnl / row.riskUsd : null;
    s.trades.push(row);

    // Lo que sigue abierto
    p.qty -= qtyClose;
    p.notional = p.qty * p.entryPrice;
    p.openFee = (p.openFee || 0) - openShare;
    p.fees = (p.fees || 0) + exitFee;
    p.realizedParcial = (p.realizedParcial || 0) + row.pnl;
    TE.updateRisk(p);
    s.lastPrice = px;

    U.playSound(gross >= 0 ? 'win' : 'loss');
    U.log(`➗ Cierre parcial ${U.num(f * 100, 0)}% @ ${U.fmtPrice(px)} · realizado ${U.fmtMoney(row.pnl, true)} · ` +
          `quedan ${U.num(p.qty, 6)} uds al precio medio ${U.fmtPrice(p.entryPrice)}`, gross >= 0 ? 'ok' : 'bad');

    TE.updateEquity(px, row.exitTime);
    TE._emit();
    return row;
  };

  /**
   * Precio de break-even de la posición: el punto donde el PnL NETO es cero,
   * contando la comisión de apertura ya pagada y la de cierre. (Bitunix subraya
   * que break-even ≠ precio de entrada por este motivo.)
   */
  TE.breakEvenPrice = function (p) {
    const pos = p || TE.state.position;
    if (!pos || !pos.qty) return null;
    const dir = pos.side === 'long' ? 1 : -1;
    const fee = (pos.feePct || 0) / 100;
    // PnL neto cero: (x − media)·q·dir − x·q·fee − openFee = 0
    const den = pos.qty * (dir - fee);
    if (!Number.isFinite(den) || Math.abs(den) < 1e-12) return null;
    const x = ((pos.openFee || 0) + pos.entryPrice * pos.qty * dir) / den;
    return Number.isFinite(x) && x > 0 ? x : null;
  };

  /** Añade un nivel de TP escalonado (Partial TP/SL): cierra `pct`% al tocarlo. */
  TE.addTpLevel = function (price, pct) {
    const p = TE.state.position;
    if (!p) { U.toast('Abre una posición antes de fijar niveles de TP', 'warn'); return null; }
    const pr = +price;
    const f = U.clamp(+pct || 0, 1, 100) / 100;
    if (!Number.isFinite(pr) || pr <= 0) { U.toast('Precio de TP no válido', 'err'); return null; }
    const dir = p.side === 'long' ? 1 : -1;
    if (dir === 1 && pr <= p.entryPrice) { U.toast('En LONG el TP debe estar por encima del precio medio', 'warn'); return null; }
    if (dir === -1 && pr >= p.entryPrice) { U.toast('En SHORT el TP debe estar por debajo del precio medio', 'warn'); return null; }
    p.tpLevels = p.tpLevels || [];
    if (p.tpLevels.some((l) => Math.abs(l.price - pr) < 1e-9)) { U.toast('Ese nivel de TP ya existe', 'warn'); return null; }
    const nivel = { price: pr, pct: f };
    p.tpLevels.push(nivel);
    p.tpLevels.sort((a, b) => (dir === 1 ? a.price - b.price : b.price - a.price));
    U.log(`🎯 TP escalonado añadido: ${U.fmtPrice(pr)} cierra ${U.num(f * 100, 0)}% de la posición`, 'sys');
    TE._emit();
    return nivel;
  };

  /** Quita un nivel de TP escalonado por su índice. */
  TE.removeTpLevel = function (i) {
    const p = TE.state.position;
    if (!p || !p.tpLevels || !p.tpLevels.length) return false;
    const idx = +i;
    if (!(idx >= 0 && idx < p.tpLevels.length)) return false;
    const [q] = p.tpLevels.splice(idx, 1);
    U.log(`🗑 Nivel de TP ${U.fmtPrice(q.price)} retirado`, 'warn');
    TE._emit();
    return true;
  };

  /**
   * Evalúa el TP escalonado dentro de una vela: cada nivel tocado cierra su
   * fracción. Se ejecutan todos los que quepan en la vela (de menos a más
   * favorable), que es lo que harían las órdenes condicionales del bróker.
   */
  TE._checkTpLevels = function (candle, pos) {
    const s = TE.state;
    let hits = 0;
    for (;;) {
      // Con `pos` se recorre el escalonado de ESA posición (modo hedge: hay dos vivas y cada una
      // tiene sus niveles). Sin ella, se mira la posición principal, que es lo que hacía antes.
      const p = pos || s.position;
      if (!p || !p.tpLevels || !p.tpLevels.length) break;
      const dir = p.side === 'long' ? 1 : -1;
      let i = -1;
      for (let k = 0; k < p.tpLevels.length; k++) {
        const tocado = dir === 1 ? candle.high >= p.tpLevels[k].price : candle.low <= p.tpLevels[k].price;
        if (tocado) { i = k; break; }
      }
      if (i < 0) break;
      const lv = p.tpLevels.splice(i, 1)[0];
      const antes = p.qty;
      TE.reducePosition(lv.pct, TE._fillPrice(candle, lv.price, p.side, false), candle.time, 'parcial', p);
      if (!TE.posicionDe(p.side) || p.qty === antes) break;   // cerró todo o no hubo cambios
      hits++;
    }
    if (hits) U.log(`🎯 ${hits} nivel${hits > 1 ? 'es' : ''} de TP escalonado ejecutado${hits > 1 ? 's' : ''}`, 'ok');
    return hits;
  };

  /* ----------------------------- Replay hooks ----------------------------- */

  /* ======================= ÓRDENES LÍMITE PENDIENTES ======================= */

  /**
   * Coloca una ORDEN LÍMITE: no se ejecuta ahora, queda en espera hasta que el
   * precio del replay entre en el nivel indicado.
   *
   * Criterio de colocación (como en un exchange real):
   *   · COMPRA (LONG)  límite: se coloca POR DEBAJO del precio actual
   *                            («compra más barato en un retroceso»).
   *   · VENTA  (SHORT) límite: se coloca POR ENCIMA del precio actual
   *                            («vende más caro en un rebote»).
   * Si el nivel está al otro lado (se cruzaría al instante), la orden se
   * ejecuta YA a precio de mercado, igual que haría un exchange, y se avisa.
   *
   * @param {'long'|'short'} side
   * @param {object} params { limitPrice, mode, size, sl, tp, leverage, feePct, time }
   * @returns {object|null} la orden creada (o null si se ejecutó al instante por error)
   */
  TE.placeLimit = function (side, params) {
    // En HEDGE, «Cerrar» es una orden que solo puede REDUCIR la posición contraria —igual que el
    // `tradeSide: CLOSE` de la API, que exige posición—. Se traduce a reduce-only en vez de
    // abrir un camino nuevo: así reutiliza la regla que ya impide aumentar por accidente.
    if (params && params.tradeSide === 'close' && TE.state.modoPosicion === 'HEDGE') params.reduceOnly = true;
    const s = TE.state;
    const limitPrice = +params.limitPrice;
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      U.toast('Precio límite no válido', 'err'); return null;
    }
    const ref = +params.refPrice || s.lastPrice;
    if (!ref) { U.toast('No hay precio de referencia todavía', 'err'); return null; }

    // ¿El nivel se cruzaría inmediatamente?
    const inmediata = side === 'long' ? limitPrice >= ref : limitPrice <= ref;
    /* VALIDEZ = `effect` de la API (F7): GTC (descansa, default), POST_ONLY (si cruzaría, NO se
       coloca), IOC y FOK (solo ejecutan lo ejecutable AHORA; lo que no, se cancela en vez de
       descansar). Sin libro de órdenes real no se puede simular el relleno PARCIAL de un IOC, y no
       se finge: aquí IOC/FOK deciden «¿se cruza esta vela?» y «¿hay margen?», que es lo que los
       OHLC permiten decidir. POST_ONLY es el único cuyo efecto completo sí es exacto, porque solo
       necesita saber si la orden cruzaría. */
    const efecto = String(params.efecto || params.effect || s.efecto || 'GTC').toUpperCase();
    if (efecto === 'POST_ONLY' && inmediata) {
      U.log(`⏳ Límite ${U.fmtPrice(limitPrice)} NO se coloca: con POST_ONLY una orden que cruzaría el `
            + `precio se rechaza (es la única forma de asegurarse la comisión de maker).`, 'warn');
      U.toast('POST_ONLY: la orden cruzaría el precio y se ha rechazado', 'warn', 3800);
      return null;
    }
    if ((efecto === 'IOC' || efecto === 'FOK') && !inmediata) {
      U.log(`⏳ Límite ${U.fmtPrice(limitPrice)} cancelada sin ejecutar con ${efecto}: lo que no está `
            + `cruzado ahora no pasa la vela descansando en el libro.`, 'warn');
      U.toast(`${efecto}: la orden no estaba cruzada y se ha cancelado`, 'warn', 3600);
      return null;
    }
    if (inmediata) {
      U.log(`⚡ El límite ${U.fmtPrice(limitPrice)} está al otro lado del precio ` +
            `(${U.fmtPrice(ref)}): se ejecuta a mercado, como en un exchange.`, 'warn');
      const pos = TE.openPosition(side, Object.assign({}, params, {
        entryPrice: ref, origin: 'market',
      }));
      if (pos) U.toast('Tu límite se cruzaba con el precio: se ejecutó a mercado', 'warn', 3800);
      return pos ? { orden: null, ejecutada: pos } : null;
    }

    const orden = {
      id: ++s.seq,
      tipo: 'limite',
      efecto,
      // Una límite que DESCANSA es maker; una que llega cruzada se ejecuta contra el libro y es
      // taker (F7: `roleType` en el histórico de fills). Con `makerFeePct` sin dato medido los dos
      // roles pagan lo mismo y esto solo sirve para pintar/contabilizar el rol, no para inventar.
      rol: 'maker',
      reduceOnly: !!params.reduceOnly,
      motivo: params.motivo || null,      // de qué nivel viene esta orden de cierre (si viene de uno)
      side,
      limitPrice,
      mode: params.mode || 'pct',
      size: +params.size || 0,
      leverage: Math.max(1, +(params.leverage || s.leverage || 1)),
      feePct: params.feePct !== undefined ? +params.feePct
        : (s.makerFeePct === null || s.makerFeePct === undefined ? s.feePct : +s.makerFeePct),
      sl: Number.isFinite(+params.sl) && +params.sl > 0 ? +params.sl : null,
      tp: Number.isFinite(+params.tp) && +params.tp > 0 ? +params.tp : null,
      creada: params.time || s.lastTime,
      refPrice: ref,
      estado: 'pendiente',
      nota: params.nota || null,
    };

    // Distancia al nivel, para mostrarla en el panel
    orden.distPct = ((limitPrice - ref) / ref) * 100;

    s.pending.push(orden);
    U.playSound('open');
    U.log(`⏳ Orden LÍMITE ${side === 'long' ? 'de COMPRA (LONG)' : 'de VENTA (SHORT)'} a ` +
          `${U.fmtPrice(limitPrice)} (${U.num(orden.distPct, 2)}% del precio actual) · ` +
          `tamaño ${orden.size} ${orden.mode === 'pct' ? '%' : orden.mode === 'qty' ? 'uds' : 'USD'}` +
          `${orden.sl ? ' · SL ' + U.fmtPrice(orden.sl) : ''}` +
          `${orden.tp ? ' · TP ' + U.fmtPrice(orden.tp) : ''}`, 'sys');
    TE._emit();
    return orden;
  };

  /**
   * Reubica el precio de una orden límite pendiente (arrastrar su línea en el
   * gráfico, igual que los handles de SL/TP). Solo mueve el nivel: tamaño, SL y
   * TP de la orden se conservan.
   * @returns {object|null} la orden modificada, o null si no es válida
   */
  /* ================= ORDEN TRIGGER (plan) — F1/F7 del estudio =================
   *
   * En Bitunix el selector de tipo de orden ofrece Limit, Market, **Trigger** y Trailing Stop, y la
   * trigger es: «cuando el precio de mercado llegue al precio de activación, se coloca la orden
   * (límite o mercado)». De ahí tres reglas que este motor no tenía y que son las que la distinguen
   * de un límite:
   *
   *  · **No congela margen ni posición mientras espera** (la documentación lo dice dos veces). Por
   *    eso el rechazo es posible AL DISPARAR: si en ese momento no hay margen, la orden no se
   *    ejecuta y se retira. Un backtester que reserva el margen al colocar la miente a favor.
   *  · El disparo se puede medir **contra mark o contra last** (`tpStopType`/`MARK_PRICE|LAST_PRICE`,
   *    mismo conmutador que en TP/SL).
   *  · Al ejecutarse puede ser **mercado** (se rellena al mejor precio disponible tras el trigger)
   *    o **límite** (se COLOCA un límite, que puede no rellenarse nunca).
   */
  TE.placeTrigger = function (side, params) {
    if (params && params.tradeSide === 'close' && TE.state.modoPosicion === 'HEDGE') params.reduceOnly = true;
    const s = TE.state;
    const p = params || {};
    const trig = +p.triggerPrice;
    if (!Number.isFinite(trig) || trig <= 0) { U.toast('Precio de activación no válido', 'err'); return null; }
    const exec = p.exec === 'limit' ? 'limit' : 'market';
    const precioLimite = +p.limitPrice;
    if (exec === 'limit' && !(precioLimite > 0)) {
      U.toast('Una trigger con ejecución LÍMITE necesita su precio de ejecución', 'err');
      return null;
    }
    const ref = s.lastPrice;
    const orden = {
      id: ++s.seq, tipo: 'trigger', side,
      triggerPrice: trig,
      src: p.src === 'mark' ? 'mark' : 'last',
      exec, limitPrice: exec === 'limit' ? precioLimite : null,
      mode: p.mode || 'pct', size: +p.size || 0,
      leverage: Math.max(1, +(p.leverage || s.leverage || 1)),
      feePct: p.feePct !== undefined ? +p.feePct : s.feePct,
      sl: Number.isFinite(+p.sl) && +p.sl > 0 ? +p.sl : null,
      tp: Number.isFinite(+p.tp) && +p.tp > 0 ? +p.tp : null,
      slSrc: p.slSrc === 'mark' ? 'mark' : 'last',
      tpSrc: p.tpSrc === 'mark' ? 'mark' : 'last',
      reduceOnly: !!p.reduceOnly,
      creada: p.time || s.lastTime, estado: 'en espera',
      efecto: String(p.efecto || p.effect || 'GTC').toUpperCase(),
      refPrice: ref,
    };
    // La distancia al disparo, para el panel de órdenes pendientes.
    if (ref) orden.distPct = ((trig - ref) / ref) * 100;
    s.pending.push(orden);
    U.log(`🎯 Orden TRIGGER ${side === 'long' ? 'de COMPRA' : 'de VENTA'}: se dispara a ${U.fmtPrice(trig)} `
          + `(contra ${orden.src === 'mark' ? 'MARK price' : 'last price'}) y ejecuta como `
          + `${exec === 'limit' ? 'límite a ' + U.fmtPrice(precioLimite) : 'MERCADO'}`
          + `${orden.reduceOnly ? ' · reduce-only' : ''}. Mientras espera NO reserva margen.`
          + (ref ? ` · está a ${U.num(orden.distPct, 2)} % del precio actual` : ''), 'sys');
    TE._emit();
    return orden;
  };

  /** ¿Qué precio de relleno tiene una trigger ejecutada a mercado dentro de esta vela? */
  TE._fillTrigger = function (candle, trig, side) {
    // Modo pesimista, coherente con el resto del motor: con OHLC no se sabe en qué punto de la vela
    // se cruzó el trigger, así que se rellena al PEOR precio plausible de la vela (una compra no
    // puede rellenar por debajo de la apertura si abrió con hueco pasado el nivel).
    return side === 'long' ? Math.max(candle.open, trig) : Math.min(candle.open, trig);
  };

  TE._checkTrigger = function (candle, o, i) {
    const s = TE.state;
    // El trigger se mide contra el alto/bajo (last) o contra el cuerpo de la vela (mark) — la misma
    // diferencia que en TP/SL, y se comparte con `TE._alcanza` para que no haya dos versiones.
    // El disparo de una trigger NO es la dirección de un TP/SL: es «el precio llegó al nivel», que
    // para una compra se cumple al subir y para una venta al bajar (y con un hueco que ABRE pasado
    // el nivel, también: por eso se compara con el extremo de la vela, no con un cruce desde el
    // otro lado). Con `mark` el disparo mira el cuerpo de la vela, no la mecha.
    const arriba = Math.max(candle.open, candle.close), abajo = Math.min(candle.open, candle.close);
    const tocado = o.src === 'mark'
      ? (o.side === 'long' ? arriba >= o.triggerPrice : abajo <= o.triggerPrice)
      : (o.side === 'long' ? candle.high >= o.triggerPrice : candle.low <= o.triggerPrice);
    if (!tocado) return false;
    s.pending.splice(i, 1);                   // la trigger muere al disparar: se convierte o se ejecuta
    if (o.exec === 'limit') {
      const limite = {
        id: ++s.seq, tipo: 'limite', side: o.side, limitPrice: o.limitPrice, efecto: 'GTC', rol: 'maker',
        mode: o.mode, size: o.size, leverage: o.leverage, feePct: o.feePct, sl: o.sl, tp: o.tp,
        reduceOnly: !!o.reduceOnly, creada: candle.time, refPrice: candle.close, estado: 'pendiente',
        origenTrigger: o.triggerPrice,
      };
      // NO se evalúa en la misma vela: la orden límite se colocó DESPUÉS de alcanzar el nivel, y si
      // la dejáramos rellenar en esta mecha estaríamos inventando el orden intra-vela.
      s.pending.push(limite);
      U.log(`🎯 Trigger alcanzada en ${U.fmtPrice(o.triggerPrice)}: colocada la orden LÍMITE `
            + `${o.side === 'long' ? 'de compra' : 'de venta'} en ${U.fmtPrice(o.limitPrice)} (desde la vela siguiente).`, 'ok');
      TE._emit();
      return true;
    }
    const precio = TE._fillTrigger(candle, o.triggerPrice, o.side);
    const pos = TE.openPosition(o.side, {
      mode: o.mode, size: o.size, entryPrice: precio, sl: o.sl, tp: o.tp,
      slSrc: o.slSrc, tpSrc: o.tpSrc, leverage: o.leverage, feePct: o.feePct,
      time: candle.time, origin: 'trigger', triggerPrice: o.triggerPrice, reduceOnly: !!o.reduceOnly,
    });
    if (!pos) {
      // El rechazo al disparar ES el comportamiento documentado, no un fallo de esta simulación.
      U.log(`🚫 Trigger alcanzada en ${U.fmtPrice(o.triggerPrice)} y cancelada: al disparar no cabía `
            + `por margen o por posición ya abierta (una trigger no reserva nada mientras espera).`, 'bad');
      U.toast('La trigger se alcanzó pero no pudo ejecutarse', 'warn', 4200);
      TE._emit();
      return false;
    }
    pos.filledAtTime = candle.time;
    if (TE.onFill) TE.onFill(pos, o);
    U.playSound('open');
    U.log(`✅ Trigger ejecutada: ${o.side === 'long' ? 'LONG' : 'SHORT'} @ ${U.fmtPrice(precio)}`
          + ` (disparada en ${U.fmtPrice(o.triggerPrice)})`, 'ok');
    U.toast(`Trigger ejecutada a ${U.fmtPrice(precio)}`, 'ok', 3000);
    TE._emit();
    return true;
  };

  /** Órdenes trigger pendientes (para el panel y para los tests). */
  TE.pendingTriggers = function () { return TE.state.pending.filter((o) => o.tipo === 'trigger'); };
  TE.cancelTrigger = function (id) {
    const l = TE.state.pending;
    for (let i = 0; i < l.length; i++) {
      if (l[i].id === +id && l[i].tipo === 'trigger') {
        const [o] = l.splice(i, 1);
        U.log(`🗑 Trigger cancelada (estaba en ${U.fmtPrice(o.triggerPrice)}; no había reservado margen).`, 'sys');
        TE._emit();
        return o;
      }
    }
    return null;
  };

  TE.setLimitPrice = function (id, price) {
    const s = TE.state;
    const o = (s.pending || []).find((x) => x.id === id);
    const p = +price;
    if (!o) return null;
    if (!Number.isFinite(p) || p <= 0) return null;
    o.limitPrice = p;
    // La distancia al precio de referencia se recalcula para el panel
    if (o.refPrice) o.distPct = ((p - o.refPrice) / o.refPrice) * 100;
    return o;
  };

  /**
   * Ejecuta YA una orden pendiente cuyo nivel ha quedado al otro lado del
   * precio (mismo criterio que al colocarla: un límite cruzado se rellena a
   * mercado). Se usa al soltar la línea arrastrada.
   * @returns {object|null} la posición abierta, o null
   */
  TE.executeNow = function (id) {
    const s = TE.state;
    const i = (s.pending || []).findIndex((o) => o.id === id);
    if (i < 0) return null;
    // En ONE-WAY solo hay una posición a la vez, así que un ejecución anticipada espera a que se
    // cierre. En HEDGE la orden del lado contrario abre SU posición: no hay nada que esperar.
    if (s.position && s.modoPosicion !== 'HEDGE') return null;   // una posición a la vez: sigue en espera
    const ref = s.lastPrice;
    if (!Number.isFinite(ref) || ref <= 0) return null;
    const o = s.pending[i];
    const cruzada = o.side === 'long' ? o.limitPrice >= ref : o.limitPrice <= ref;
    if (!cruzada) return null;
    s.pending.splice(i, 1);
    const pos = TE.openPosition(o.side, {
      mode: o.mode, size: o.size, entryPrice: ref,
      sl: o.sl, tp: o.tp, leverage: o.leverage, feePct: o.feePct,
      time: s.lastTime, origin: 'market', limitPrice: o.limitPrice,
    });
    if (pos) {
      U.log(`⚡ Límite movido a ${U.fmtPrice(o.limitPrice)}: queda cruzado con el precio ` +
            `(${U.fmtPrice(ref)}), se ejecuta a mercado`, 'warn');
    }
    return pos;
  };

  /** ¿El nivel de una orden pendiente quedaría cruzado por el precio actual? */
  TE.isLimitCrossed = function (id) {
    const s = TE.state;
    const o = (s.pending || []).find((x) => x.id === id);
    const ref = s.lastPrice;
    if (!o || !Number.isFinite(ref) || ref <= 0) return false;
    return o.side === 'long' ? o.limitPrice >= ref : o.limitPrice <= ref;
  };

  /** Cancela una orden pendiente por su id. */
  TE.cancelOrder = function (id) {
    const s = TE.state;
    const i = s.pending.findIndex((o) => o.id === id);
    if (i < 0) { U.toast('Esa orden ya no está pendiente', 'warn', 1800); return false; }
    const [o] = s.pending.splice(i, 1);
    // El tipo va en el aviso: cancelar una trigger no ha liberado margen ninguno (no reservaba),
    // y decir «orden límite» en el registro haría que quien repase la sesión crea que sí.
    const esTrig = o.tipo === 'trigger';
    U.log(`🚫 Orden ${esTrig ? 'TRIGGER' : 'límite'} cancelada: ${o.side === 'long' ? 'LONG' : 'SHORT'} @ ` +
      `${U.fmtPrice(esTrig ? o.triggerPrice : o.limitPrice)}` +
      (esTrig ? ' (no había reservado margen: se cancela sin más)' : ''), 'warn');
    U.playSound('close');
    TE._emit();
    return true;
  };

  /** Cancela todas las órdenes pendientes. */
  TE.cancelAllOrders = function () {
    const n = TE.state.pending.length;
    if (!n) { U.toast('No hay órdenes pendientes', 'warn', 1500); return 0; }
    TE.state.pending = [];
    U.log(`🚫 ${n} orden(es) límite cancelada(s)`, 'warn');
    TE._emit();
    return n;
  };

  /** Número de órdenes pendientes. */
  TE.pendingCount = function () { return TE.state.pending.length; };
  /** Cuántas pendientes son de cada tipo, para la pestaña de órdenes y para los tests. */
  TE.pendingPorTipo = function () {
    const out = { limite: 0, trigger: 0 };
    for (const o of TE.state.pending) if (out[o.tipo] !== undefined) out[o.tipo]++;
    return out;
  };

  /**
   * Precio de ejecución de una orden límite dentro de una vela:
   *  · Si la vela abrió MEJOR que el nivel (hueco a favor) → se ejecuta a la
   *    apertura, que es un precio aún mejor para el operador.
   *  · En cualquier otro caso → se ejecuta exactamente en el nivel.
   * (Un límite nunca se ejecuta peor que su precio, por definición.)
   */
  TE._fillLimit = function (candle, level, side) {
    if (side === 'long') return candle.open <= level ? candle.open : level;
    return candle.open >= level ? candle.open : level;
  };

  /**
   * Recorre las órdenes pendientes y ejecuta las que el precio ha alcanzado
   * durante esta vela. Las que no caben por margen se cancelan con aviso.
   * @returns {Array} posiciones abiertas en esta vela
   */
  TE._checkPending = function (candle) {
    const s = TE.state;
    if (!s.pending.length) return [];
    const abiertas = [];
    for (let i = s.pending.length - 1; i >= 0; i--) {
      const o = s.pending[i];
      if (o.tipo === 'trigger') { TE._checkTrigger(candle, o, i); continue; }
      // Con una posición abierta los órdenes ESPERAN, salvo que sean del mismo
      // lado y el promediado esté activo: en ese caso se ejecutan y AÑADEN a la
      // posición (así funciona «Add position» con orden límite en Bitunix).
      const promedia = !!(s.averaging && s.position && s.position.side === o.side);
      if (s.position && !promedia && !o.reduceOnly && !(s.modoPosicion === 'HEDGE' && s.position.side !== o.side)) break;
      const alcanzada = o.side === 'long' ? candle.low <= o.limitPrice : candle.high >= o.limitPrice;
      if (!alcanzada) continue;

      const precio = TE._fillLimit(candle, o.limitPrice, o.side);
      const pos = TE.openPosition(o.side, {
        mode: o.mode, size: o.size, entryPrice: precio,
        sl: o.sl, tp: o.tp, leverage: o.leverage, feePct: o.feePct,
        time: candle.time, origin: 'limite', limitPrice: o.limitPrice,
        reduceOnly: !!o.reduceOnly, reason: o.motivo || undefined,
      });

      if (!pos) {
        // Sin margen suficiente: la orden se retira (como un rechazo del bróker)
        s.pending.splice(i, 1);
        U.log(`🚫 Orden límite ${o.side === 'long' ? 'LONG' : 'SHORT'} @ ${U.fmtPrice(o.limitPrice)} ` +
              `cancelada: no hay margen suficiente`, 'bad');
        U.toast('Se canceló una orden límite por margen insuficiente', 'err', 4200);
        continue;
      }

      // Marca de «ejecutada en esta vela»: el SL/TP de esta misma vela no se
      // evalúa (con solo OHLC no sabemos si se tocó antes o después del fill).
      pos.filledAtTime = candle.time;
      pos.limitPrice = o.limitPrice;
      s.pending.splice(i, 1);
      abiertas.push(pos);

      if (TE.onFill) TE.onFill(pos, o);
      U.log(`✅ Orden LÍMITE ejecutada: ${o.side === 'long' ? 'LONG' : 'SHORT'} @ ${U.fmtPrice(precio)}` +
            `${precio !== o.limitPrice ? ` (límite ${U.fmtPrice(o.limitPrice)}, hueco a favor)` : ''}`, 'ok');
      U.toast(`✅ Orden límite ejecutada a ${U.fmtPrice(precio)}`, 'ok', 3000);
    }
    return abiertas;
  };

  /**
   * Llamado por el Bar Replay cada vez que se "cierra" una vela nueva
   * (avance). Evalúa liquidación, SL y TP, y actualiza estadísticas.
   * @param {object} candle  vela recién cerrada
   * @returns {object|null}  posición cerrada si la hubo
   */
  /** Próxima hora de liquidación de funding estrictamente posterior a `desde` (F3 del estudio). */
  TE._siguienteFunding = function (desde) {
    const s = TE.state, DIA = 86400000;
    const cada = Math.max(1, +s.fundingCadaHoras || 8);
    let horas = Array.isArray(s.fundingHorasUTC) && s.fundingHorasUTC.length ? s.fundingHorasUTC.map(Number) : [0, 8, 16];
    if (cada !== 8) { horas = []; for (let h = 0; h < 24; h += cada) horas.push(h); }
    horas.sort((a, b) => a - b);
    const d0 = Math.floor((+desde || 0) / DIA) * DIA;
    for (let d = 0; d < 3; d++) {
      for (const h of horas) {
        const t = d0 + d * DIA + h * 3600000;
        if (t > desde) return t;
      }
    }
    return (+desde || 0) + cada * 3600000;              // horario imposible: cae al ritmo, sin horas
  };

  /**
   * Evalúa UNA posición dentro de la vela: barras, MFE/MAE, funding, liquidación, SL/TP,
   * trailing y TP escalonado. Devuelve el resultado de la acción ejecutada (cierre o nivel) o
   * null si en esta vela no le ha pasado nada. `p` entra por parámetro porque en modo hedge hay
   * dos y cada una se juzga por sus propios niveles.
   */
  TE._revisaPosicion = function (candle, p) {
    const s = TE.state;
    if (!p) return null;
      p.bars++;

    // Una posición recién ejecutada por un límite no se evalúa en su misma
    // vela: ignoramos el orden real de los precios dentro de ella.
    if (p.filledAtTime !== undefined && p.filledAtTime === candle.time) {
      TE.updateEquity(candle.close, candle.time);
      TE._emit();
      return null;
    }

    // Excursiones máximas durante la vela
    const dir = p.side === 'long' ? 1 : -1;
    const favPrice = dir === 1 ? candle.high : candle.low;
    const advPrice = dir === 1 ? candle.low : candle.high;
    p.mfe = Math.max(p.mfe, (favPrice - p.entryPrice) * p.qty * dir);
    p.mae = Math.min(p.mae, (advPrice - p.entryPrice) * p.qty * dir);

    // FUNDING a lo Bitunix: se paga/recibe en las horas de liquidación, no en cada vela, y con
    // el signo del lado. Las velas de 1 h o 4 h ven pasar la marca; las de 1 d pueden ver pasar
    // tres, así que se recorre la agenda en bucle en vez de «¿esta vela es de liquidación?».
    if (s.fundingPct > 0) {
      if (!(p.pagoFundingEn > 0)) p.pagoFundingEn = TE._siguienteFunding(p.entryTime || candle.time);
      let pagado = 0, hits = 0;
      while (candle.time >= p.pagoFundingEn) {
        const dir = p.side === 'long' ? 1 : -1;
        pagado -= dir * p.notional * (s.fundingPct / 100);
        hits++;
        p.pagoFundingEn = TE._siguienteFunding(p.pagoFundingEn);
        if (hits > 1000) break;                     // reloj roto: no colgar la pestaña
      }
      if (hits) {
        s.balance += pagado; s.feesPaid += Math.abs(pagado);
        p.fees += Math.abs(pagado);
        p.funding = (p.funding || 0) + pagado;
        U.log(`💱 Funding de ${hits} liquidacion(es) ${pagado < 0 ? 'pagado' : 'recibido'}: `
              + `${U.num(Math.abs(pagado), 4)} USDT sobre ${U.num(p.notional, 2)} de notional a `
              + `${U.num(s.fundingPct, 4)} % · posición ${p.side === 'long' ? 'LARGA' : 'CORTA'}`,
              pagado < 0 ? 'warn' : 'ok');
      }
    }

    const liq = TE.liquidationPrice(p);

    // --- 1) Liquidación (prioridad máxima) ---
    if (liq !== null && ((p.side === 'long' && candle.low <= liq) || (p.side === 'short' && candle.high >= liq))) {
      U.log('💀 Precio de liquidación alcanzado: la posición se cierra por margen', 'bad');
      return TE.closePosition(liq, 'liq', candle.time, p);
    }

    // --- 2) SL / TP ---
    const slHit = p.sl !== null && TE._alcanza(p.sl, p.side, 'sl', candle, p);
    const tpHit = p.tp !== null && TE._alcanza(p.tp, p.side, 'tp', candle, p);

    // El TRAILING también es un stop: si SL fijo y trailing están tocados en la
    // misma vela, ejecuta el que esté MÁS CERCA del precio (en un LONG, el nivel
    // más alto; en un SHORT, el más bajo), que es lo que haría el bróker.
    const trailLevel = TE.trailingPrice(p);
    const trailHit = trailLevel !== null && (dir === 1 ? candle.low <= trailLevel : candle.high >= trailLevel);
    let stop = null;
    if (slHit || trailHit) {
      const slPrecio = slHit ? p.sl : null;
      const trPrecio = trailHit ? trailLevel : null;
      const elegido = slPrecio === null ? trPrecio
        : trPrecio === null ? slPrecio
          : (dir === 1 ? Math.max(slPrecio, trPrecio) : Math.min(slPrecio, trPrecio));
      stop = { price: elegido, trail: trailHit && elegido === trailLevel };
    }

    if (slHit && tpHit) {
      const first = s.slFirst === 'best' ? 'tp' : 'sl';
      if (first === 'sl') return TE._hitStop(candle, stop, p);
      return TE._ejecutaNivel(p, 'tp', candle);
    }
    if (stop) return TE._hitStop(candle, stop, p);

    // 2b) TP ESCALONADO (Partial TP/SL): cada nivel tocado cierra su fracción y
    //     deja el resto de la posición vivo con su SL intacto.
    if (p.tpLevels && p.tpLevels.length) {
      TE._checkTpLevels(candle, p);
      if (!TE.posicionDe(p.side)) { return null; }   // el escalonado la cerró entera
    }

    if (tpHit) return TE._ejecutaNivel(p, 'tp', candle);

    // --- 3) El trailing sigue al precio: se arma/mueve al CERRAR la vela (ver
    //     comentario de la sección TRAILING STOP: el pico no se actualiza antes
    //     de evaluar el disparo, para no inventarse el orden intra-vela). ---
    TE._updateTrailing(candle, p);
    return null;
  };

  TE.onCandle = function (candle) {
    const s = TE.state;
    s.lastPrice = candle.close;
    s.lastTime = candle.time;

    // --- 0) ÓRDENES LÍMITE: se comprueban antes que la posición, porque si el
    //        precio entra en el nivel la orden se ejecuta DENTRO de esta vela.
    TE._checkPending(candle);

    // Cada dirección se evalúa por su cuenta: en modo hedge hay dos posiciones vivas y lo que
    // les pasa no se puede mezclar (un LONG tocando su TP no toca el SHORT, y cada una tiene su
    // liquidación, su funding y su trailing). El orden long→short solo importa si las dos se
    // disparan en la MISMA vela: la simulación permite una acción por vela y por posición, y las
    // dos posiciones la obtienen, cosa que con un solo `if (p)` habría dejado a la segunda sin
    // evaluar hasta la vela siguiente.
    let accion = null;
    for (const p of TE.posiciones()) {
      const r = TE._revisaPosicion(candle, p);
      if (r !== null && r !== undefined && accion === null) accion = r;
    }
    // Como antes: si hubo cierre/nivel, ESO es lo que devuelve `onCandle` (el propio cierre ya
    // refresca la interfaz; meter aquí un updateEquity extra duplicaría un punto de la curva de
    // capital y descolocaría las pruebas que la cuentan vela a vela).
    if (accion !== null) return accion;

    TE.updateEquity(candle.close, candle.time);
    TE._emit();
    return null;
  };

  /**
   * Ejecuta el stop elegido por onCandle. Con frac < 1 el trailing cierra solo una
   * parte (Partial TP/SL en el lado del stop) y deja el resto vivo siguiendo el
   * pico; con frac = 1 cierra la posición entera con motivo «trail».
   */
  /**
   * ¿Se DISPARA el nivel en esta vela? Aquí está la diferencia entre `LAST_PRICE` y `MARK_PRICE`
   * (F7), que no es decorativa: con `last` vale cualquier mecha, con `mark` el disparo se mide
   * contra el precio de referencia de la vela —y OHLC solo permite saber su apertura y su cierre,
   * que es lo que se usa—. Una mecha que toca el nivel y vuelve: con `last` cierra la posición,
   * con `mark` no. Eso es exactamente para lo que Bitunix ofrece el conmutador.
   */
  TE._alcanza = function (nivel, side, tipo, candle, p) {
    if (!Number.isFinite(+nivel)) return false;
    const src = (p && (tipo === 'sl' ? p.slSrc : p.tpSrc)) === 'mark' ? 'mark' : 'last';
    const dir = side === 'long' ? 1 : -1;
    const haciaArriba = (tipo === 'tp') === (dir === 1);
    if (src === 'mark') {
      const a = Math.min(candle.open, candle.close), b = Math.max(candle.open, candle.close);
      return haciaArriba ? b >= nivel : a <= nivel;
    }
    return haciaArriba ? candle.high >= nivel : candle.low <= nivel;
  };

  /**
   * Ejecución del nivel disparado, con la `slOrderType` / `tpOrderType` de la API (F7):
   *  · MARKET  → se cierra al precio de relleno de la vela (el comportamiento de siempre).
   *  · LIMIT   → al disparar se COLOCA una orden de cierre con `reduceOnly` en su precio de
   *    ejecución, y esa orden puede no rellenarse nunca: la posición sigue abierta. Es el aviso
   *    que la documentación repite («más control sobre el precio, puede no ejecutarse»).
   */
  TE._ejecutaNivel = function (p, tipo, candle) {
    const nivel = tipo === 'sl' ? p.sl : p.tp;
    const exec = (tipo === 'sl' ? p.slExec : p.tpExec) === 'limit' ? 'limit' : 'market';
    const precioLimite = +((tipo === 'sl' ? p.slExecPrice : p.tpExecPrice) || 0);
    if (exec === 'market' || !(precioLimite > 0)) {
      const fill = TE._fillPrice(candle, nivel, p.side, tipo === 'sl');
      return TE.closePosition(fill, tipo, candle.time, p);
    }
    const yaPuesta = tipo === 'sl' ? p._slLimitPlaced : p._tpLimitPlaced;
    if (yaPuesta) return null;                 // no se inunda el libro de órdenes vela tras vela
    if (tipo === 'sl') p._slLimitPlaced = true; else p._tpLimitPlaced = true;
    // Mover el nivel REEMPLAZA la orden de cierre que hubiera puesto el disparo anterior: la API de
    // Bitunix tiene `modify_order` («modificar una orden pendiente, como su TP/SL y/o precio») justo
    // para eso, así que acumular dos órdenes de cierre del mismo nivel sería un estado imposible en
    // el exchange (cerraría el doble de la posición).
    const st = TE.state;
    const antes = st.pending.length;
    st.pending = st.pending.filter((o) => o.motivo !== tipo);
    if (st.pending.length !== antes) {
      U.log(`🧹 La orden de cierre ${tipo.toUpperCase()} anterior se retira y se sustituye por la nueva (${antes - st.pending.length} sustituida).`, 'sys');
    }
    TE.placeLimit(p.side === 'long' ? 'short' : 'long', {
      limitPrice: precioLimite, mode: 'pct', size: 100, leverage: p.leverage,
      reduceOnly: true, efecto: 'GTC', time: candle.time, motivo: tipo,
    });
    U.log(`🧷 ${tipo.toUpperCase()} disparado en ${U.fmtPrice(nivel)}: se ha colocado una orden LÍMITE `
          + `de cierre en ${U.fmtPrice(precioLimite)} (reduce-only). Con ejecución límite puede no rellenarse.`, 'warn');
    return null;
  };

  TE._hitStop = function (candle, stop, p) {
    const fill = TE._fillPrice(candle, stop.price, p.side, true);
    if (!stop.trail) return TE._ejecutaNivel(p, 'sl', candle);
    const t = p.trail;
    const dir = p.side === 'long' ? 1 : -1;
    U.log(`🌀 Trailing stop: el precio retrocedió un ${U.num(t.pct, 2)} % desde el pico ` +
          `${U.fmtPrice(t.peak)} y se cierra ${U.num(t.frac * 100, 0)} % en ${U.fmtPrice(fill)}`, 'warn');
    if (t.frac >= 0.999) return TE.closePosition(fill, 'trail', candle.time, p);
    return TE.reducePosition(t.frac, fill, candle.time, 'trail', p);
  };

  /**
   * Precio de ejecución realista de SL/TP dentro de una vela:
   *  · Si el nivel se negoció dentro del rango [low, high], se ejecuta al nivel.
   *  · Si la vela ABRIÓ ya más allá del nivel (hueco/gap):
   *      - Stop Loss  → se ejecuta a la apertura (peor precio, slippage real).
   *      - Take Profit→ se ejecuta a la apertura (mejor precio, como en un límite).
   *
   * @param {object} candle vela cerrada
   * @param {number} level  precio del SL o TP
   * @param {'long'|'short'} side
   * @param {boolean} isStop true para SL, false para TP
   */
  TE._fillPrice = function (candle, level, side, isStop) {
    if (level === null || level === undefined) return candle.close;
    if (isStop) {
      const adverseGap = side === 'long' ? candle.open < level : candle.open > level;
      return adverseGap ? candle.open : level;
    }
    const favorableGap = side === 'long' ? candle.open > level : candle.open < level;
    return favorableGap ? candle.open : level;
  };

  /**
   * Recalcula la equity con el último precio conocido y guarda el punto
   * en la curva de capital.
   */
  TE.updateEquity = function (price, time) {
    const s = TE.state;
    if (price !== null && price !== undefined) s.lastPrice = price;
    if (time !== undefined) s.lastTime = time;
    const eq = s.balance + TE.unrealized(s.lastPrice);
    // El margen no se descuenta del balance (queda bloqueado), así que la
    // equity es directamente balance + PnL abierto.
    s.equity = eq;
    TE._pushEquity(s.lastTime, eq);
    return eq;
  };

  /** Emite un evento interno para que la UI se refresque. */
  TE._emit = function () {
    if (TE._batch) return;   // durante un avance rápido no refrescamos por vela
    try { global.dispatchEvent(new CustomEvent('te:update')); } catch (e) {}
  };

  /**
   * Modo "lote": al procesar decenas de velas de golpe (avance rápido, seek o
   * «ir al final») se silencian los eventos por vela y se refresca una sola vez.
   */
  TE.beginBatch = function () { TE._batch = true; };
  TE.endBatch = function () { TE._batch = false; TE._emit(); };

  /* --------------------------- Rebobinado (rewind) --------------------------- */

  /**
   * Restaura el estado de la cuenta desde un checkpoint (creado por App).
   * Permite retroceder velas sin recalcular todo el histórico.
   */
  TE.restoreFromCheckpoint = function (cp) {
    const s = TE.state;
    if (!cp) return;
    s.balance = cp.bal;
    s.equity = cp.eq;
    s.feesPaid = cp.fees;
    s.seq = cp.seq;
    s.lastPrice = cp.lastPrice;
    s.lastTime = cp.lastTime;
    s.equitySeries = s.equitySeries.slice(0, cp.eqLen);
    s.trades.length = Math.min(s.trades.length, cp.tradesLen);

    if (cp.hasPos && cp.pos) {
      const clone = JSON.parse(JSON.stringify(cp.pos));
      // La fila «viva» del historial ES el propio objeto de la posición. Se busca
      // por id en vez de asumir que es la última: con cierres parciales hay filas
      // cerradas DESPUÉS de la posición abierta, y sustituir por posición se las
      // comía (el balance volvía, pero el PnL realizado del histórico no).
      let k = -1;
      for (let i = s.trades.length - 1; i >= 0; i--) {
        if (s.trades[i] && s.trades[i].id === clone.id) { k = i; break; }
      }
      if (k >= 0) s.trades[k] = clone;
      else if (cp.tradesLen > 0 && s.trades.length >= cp.tradesLen) s.trades[cp.tradesLen - 1] = clone;
      else s.trades.push(clone);
      s.position = clone;
    } else {
      s.position = null;
    }
    // Las órdenes límite pendientes también vuelven a su estado de ese momento
    s.pending = cp.pending ? JSON.parse(JSON.stringify(cp.pending)) : [];
    TE._emit();
  };

  /* ------------------------------ Métricas ------------------------------ */

  TE.getMetrics = function () {
    const s = TE.state;
    return {
      balance: s.balance,
      equity: s.equity,
      initialCapital: s.initialCapital,
      pnlTotal: s.trades.filter((t) => t.status === 'closed').reduce((a, t) => a + t.pnl, 0),
      openPnl: TE.unrealized(s.lastPrice),
      margin: TE.marginUsed(),
      free: s.balance - TE.marginUsed(),
      exposure: s.balance > 0 ? (TE.marginUsed() / s.balance) * 100 : 0,
      fees: s.feesPaid,
      position: s.position,
      posiciones: TE.posiciones(),
      modoPosicion: s.modoPosicion,
    };
  };

  /** Posición abierta serializada (para guardar sesión). */
  TE.serialize = function () {
    return {
      state: {
        initialCapital: TE.state.initialCapital,
        balance: TE.state.balance,
        equity: TE.state.equity,
        leverage: TE.state.leverage,
        marginMode: TE.state.marginMode,
        feePct: TE.state.feePct,
        fundingPct: TE.state.fundingPct,
        slFirst: TE.state.slFirst,
        averaging: TE.state.averaging,
        // El modo de posición es estado de la cuenta, no del gráfico: si no viaja aquí, al
        // restaurar una partida en hedge la segunda dirección se caía (y el modo volvía a
        // ONE-WAY con dos posiciones colgando).
        modoPosicion: TE.state.modoPosicion,
        feesPaid: TE.state.feesPaid,
        lastPrice: TE.state.lastPrice,
        lastTime: TE.state.lastTime,
        seq: TE.state.seq,
      },
      position: TE.state.position,
      posiciones: TE.posiciones(),
      pending: TE.state.pending,
      trades: TE.state.trades,
      equitySeries: TE.state.equitySeries.slice(-5000),
    };
  };

  TE.restore = function (data) {
    if (!data) return;
    Object.assign(TE.state, data.state || {});
    // Primero el modo (un restore de una partida en hedge no puede caer en one-way con dos
    // posiciones: la segunda se perdería), luego las dos ranuras; `position` se queda con la
    // principal solo para partidas antiguas que no tenían `posiciones`.
    if (data.state && data.state.modoPosicion) TE.state.modoPosicion = data.state.modoPosicion;
    if (Array.isArray(data.posiciones) && data.posiciones.length) {
      TE.state.posiciones.long = null; TE.state.posiciones.short = null;
      data.posiciones.forEach((x) => { if (x && x.side) TE.state.posiciones[x.side] = x; });
    } else {
      TE.state.position = data.position || null;
    }
    TE.state.pending = data.pending || [];
    TE.state.trades = data.trades || [];
    TE.state.equitySeries = data.equitySeries || [];
    // Mientras una posición vive, SU FILA del historial es el mismo objeto (así lo
    // tratan openPosition/closePosition). Al restaurar desde JSON son dos copias
    // distintas: sin este re-enlace, cerrar después de cargar una sesión dejaba
    // una fila «abierta» fantasma en la hoja y el PnL nunca aparecía (y el balance
    // dejaba de cuadrar). Se vuelve a apuntar la fila a la posición restaurada.
    // Cada posición restaurada vuelve a apuntar a SU fila del historial (ver el comentario de
    // arriba): en modo hedge son dos filas y dos re-enlaces.
    for (const p of TE.posiciones()) {
      const k = TE.state.trades.findIndex((t) => t && t.id === p.id);
      if (k >= 0) TE.state.trades[k] = p;
      else TE.state.trades.push(p);
    }
    TE._emit();
  };

  global.TE = TE;
})(window);
