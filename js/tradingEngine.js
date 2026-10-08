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
    fundingPct: 0,           // % por vela sobre el notional (opcional)
    slFirst: 'worst',        // 'worst' | 'best'
    averaging: true,         // permitir AÑADIR a una posición abierta (promediar entrada)
    position: null,          // posición abierta
    pending: [],             // órdenes LÍMITE en espera (aún no ejecutadas)
    trades: [],              // historial (abiertas + cerradas)
    equitySeries: [],        // [{t, value, time}] para la curva de capital
    feesPaid: 0,
    lastPrice: null,
    lastTime: null,
    seq: 0,
  };

  /* ---------------------------- Configuración ---------------------------- */

  TE.configure = function (opts) {
    const s = TE.state;
    if (opts.initialCapital !== undefined) { s.initialCapital = +opts.initialCapital; }
    if (opts.leverage !== undefined) s.leverage = +opts.leverage;
    if (opts.feePct !== undefined) s.feePct = +opts.feePct;
    if (opts.fundingPct !== undefined) s.fundingPct = +opts.fundingPct;
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
    const p = TE.state.position;
    if (!p || price === null || price === undefined) return 0;
    const dir = p.side === 'long' ? 1 : -1;
    return (price - p.entryPrice) * p.qty * dir;
  };

  TE.marginUsed = function () {
    const p = TE.state.position;
    return p ? p.notional / p.leverage : 0;
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
   * Se desprecia el margen de mantenimiento (el modelo de comisiones de la app
   * tampoco lo tiene), por eso con 1x y cuenta holgada el precio sale 0: en
   * cruzado real la posición no liquida antes de tocar suelo. Con margen de
   * mantenimiento 0 la fórmula aislada coincide exactamente con la anterior.
   */
  TE.liquidationPrice = function (position) {
    if (!position) return null;
    const p = position;
    const side = p.side === 'long' ? 1 : -1;
    if (!p.qty) return p.entryPrice * (1 - side / p.leverage);
    const margen = TE.marginOf(p);
    const libre = (TE.state.marginMode || 'cross') === 'cross'
      ? Math.max(0, TE.freeMargin()) : 0;
    const liq = p.entryPrice - side * (margen + libre) / p.qty;
    return Math.max(0, +liq.toFixed(6));
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
  TE.openPosition = function (side, params) {
    const s = TE.state;
    if (s.position) {
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
  TE.closePosition = function (price, reason = 'manual', time) {
    const s = TE.state;
    const p = s.position;
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

    s.position = null;
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
    const p = s.position;
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
    const p = TE.state.position;
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
  TE._updateTrailing = function (candle) {
    const p = TE.state.position;
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
    const p = s.position;
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
  TE.reducePosition = function (frac, price, time, reason = 'parcial') {
    const s = TE.state;
    const p = s.position;
    if (!p) { U.toast('No hay posición abierta', 'warn'); return null; }
    const f = +frac;
    if (!Number.isFinite(f) || f <= 0) return null;
    if (f >= 0.999) return TE.closePosition(price, reason === 'parcial' ? 'manual' : reason, time);

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
  TE._checkTpLevels = function (candle) {
    const s = TE.state;
    let hits = 0;
    for (;;) {
      const p = s.position;
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
      TE.reducePosition(lv.pct, TE._fillPrice(candle, lv.price, p.side, false), candle.time, 'parcial');
      if (!s.position || s.position.qty === antes) break;   // cerró todo o no hubo cambios
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
    const s = TE.state;
    const limitPrice = +params.limitPrice;
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      U.toast('Precio límite no válido', 'err'); return null;
    }
    const ref = +params.refPrice || s.lastPrice;
    if (!ref) { U.toast('No hay precio de referencia todavía', 'err'); return null; }

    // ¿El nivel se cruzaría inmediatamente?
    const inmediata = side === 'long' ? limitPrice >= ref : limitPrice <= ref;
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
      side,
      limitPrice,
      mode: params.mode || 'pct',
      size: +params.size || 0,
      leverage: Math.max(1, +(params.leverage || s.leverage || 1)),
      feePct: params.feePct !== undefined ? +params.feePct : s.feePct,
      sl: Number.isFinite(+params.sl) && +params.sl > 0 ? +params.sl : null,
      tp: Number.isFinite(+params.tp) && +params.tp > 0 ? +params.tp : null,
      creada: params.time || s.lastTime,
      refPrice: ref,
      estado: 'pendiente',
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
    if (s.position) return null;          // una posición a la vez: sigue en espera
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
    U.log(`🚫 Orden límite cancelada: ${o.side === 'long' ? 'LONG' : 'SHORT'} @ ${U.fmtPrice(o.limitPrice)}`, 'warn');
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
      // Con una posición abierta los órdenes ESPERAN, salvo que sean del mismo
      // lado y el promediado esté activo: en ese caso se ejecutan y AÑADEN a la
      // posición (así funciona «Add position» con orden límite en Bitunix).
      const promedia = !!(s.averaging && s.position && s.position.side === o.side);
      if (s.position && !promedia) break;
      const alcanzada = o.side === 'long' ? candle.low <= o.limitPrice : candle.high >= o.limitPrice;
      if (!alcanzada) continue;

      const precio = TE._fillLimit(candle, o.limitPrice, o.side);
      const pos = TE.openPosition(o.side, {
        mode: o.mode, size: o.size, entryPrice: precio,
        sl: o.sl, tp: o.tp, leverage: o.leverage, feePct: o.feePct,
        time: candle.time, origin: 'limite', limitPrice: o.limitPrice,
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
  TE.onCandle = function (candle) {
    const s = TE.state;
    s.lastPrice = candle.close;
    s.lastTime = candle.time;

    // --- 0) ÓRDENES LÍMITE: se comprueban antes que la posición, porque si el
    //        precio entra en el nivel la orden se ejecuta DENTRO de esta vela.
    TE._checkPending(candle);

    const p = s.position;
    if (p) {
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

      // Coste de financiación opcional por vela
      if (s.fundingPct > 0) {
        const f = p.notional * (s.fundingPct / 100);
        s.balance -= f; s.feesPaid += f;
        p.fees += f;
        p.funding = (p.funding || 0) + f;
      }

      const liq = TE.liquidationPrice(p);

      // --- 1) Liquidación (prioridad máxima) ---
      if (liq !== null && ((p.side === 'long' && candle.low <= liq) || (p.side === 'short' && candle.high >= liq))) {
        U.log('💀 Precio de liquidación alcanzado: la posición se cierra por margen', 'bad');
        return TE.closePosition(liq, 'liq', candle.time);
      }

      // --- 2) SL / TP ---
      const slHit = p.sl !== null && (p.side === 'long' ? candle.low <= p.sl : candle.high >= p.sl);
      const tpHit = p.tp !== null && (p.side === 'long' ? candle.high >= p.tp : candle.low <= p.tp);

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
        return TE.closePosition(TE._fillPrice(candle, p.tp, p.side, false), 'tp', candle.time);
      }
      if (stop) return TE._hitStop(candle, stop, p);

      // 2b) TP ESCALONADO (Partial TP/SL): cada nivel tocado cierra su fracción y
      //     deja el resto de la posición vivo con su SL intacto.
      if (p.tpLevels && p.tpLevels.length) {
        TE._checkTpLevels(candle);
        if (!s.position) { TE.updateEquity(candle.close, candle.time); TE._emit(); return null; }
      }

      if (tpHit) return TE.closePosition(TE._fillPrice(candle, p.tp, p.side, false), 'tp', candle.time);

      // --- 3) El trailing sigue al precio: se arma/mueve al CERRAR la vela (ver
      //     comentario de la sección TRAILING STOP: el pico no se actualiza antes
      //     de evaluar el disparo, para no inventarse el orden intra-vela). ---
      TE._updateTrailing(candle);
    }

    TE.updateEquity(candle.close, candle.time);
    TE._emit();
    return null;
  };

  /**
   * Ejecuta el stop elegido por onCandle. Con frac < 1 el trailing cierra solo una
   * parte (Partial TP/SL en el lado del stop) y deja el resto vivo siguiendo el
   * pico; con frac = 1 cierra la posición entera con motivo «trail».
   */
  TE._hitStop = function (candle, stop, p) {
    const fill = TE._fillPrice(candle, stop.price, p.side, true);
    if (!stop.trail) return TE.closePosition(fill, 'sl', candle.time);
    const t = p.trail;
    const dir = p.side === 'long' ? 1 : -1;
    U.log(`🌀 Trailing stop: el precio retrocedió un ${U.num(t.pct, 2)} % desde el pico ` +
          `${U.fmtPrice(t.peak)} y se cierra ${U.num(t.frac * 100, 0)} % en ${U.fmtPrice(fill)}`, 'warn');
    if (t.frac >= 0.999) return TE.closePosition(fill, 'trail', candle.time);
    return TE.reducePosition(t.frac, fill, candle.time, 'trail');
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
        feesPaid: TE.state.feesPaid,
        lastPrice: TE.state.lastPrice,
        lastTime: TE.state.lastTime,
        seq: TE.state.seq,
      },
      position: TE.state.position,
      pending: TE.state.pending,
      trades: TE.state.trades,
      equitySeries: TE.state.equitySeries.slice(-5000),
    };
  };

  TE.restore = function (data) {
    if (!data) return;
    Object.assign(TE.state, data.state || {});
    TE.state.position = data.position || null;
    TE.state.pending = data.pending || [];
    TE.state.trades = data.trades || [];
    TE.state.equitySeries = data.equitySeries || [];
    // Mientras una posición vive, SU FILA del historial es el mismo objeto (así lo
    // tratan openPosition/closePosition). Al restaurar desde JSON son dos copias
    // distintas: sin este re-enlace, cerrar después de cargar una sesión dejaba
    // una fila «abierta» fantasma en la hoja y el PnL nunca aparecía (y el balance
    // dejaba de cuadrar). Se vuelve a apuntar la fila a la posición restaurada.
    const p = TE.state.position;
    if (p) {
      const k = TE.state.trades.findIndex((t) => t && t.id === p.id);
      if (k >= 0) TE.state.trades[k] = p;
      else TE.state.trades.push(p);
    }
    TE._emit();
  };

  global.TE = TE;
})(window);
