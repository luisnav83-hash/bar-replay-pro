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
    feePct: 0.1,             // % por lado (apertura y cierre)
    fundingPct: 0,           // % por vela sobre el notional (opcional)
    slFirst: 'worst',        // 'worst' | 'best'
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

  /** Precio de liquidación aproximado (aislado, sin mantenimiento). */
  TE.liquidationPrice = function (position) {
    if (!position) return null;
    const p = position;
    const side = p.side === 'long' ? 1 : -1;
    return p.entryPrice * (1 - side / p.leverage);
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
    if (s.position) { U.toast('Ya hay una posición abierta. Ciérrala antes de abrir otra.', 'warn'); return null; }

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
    })[r] || r;
  };

  /* ------------------------- Modificación de SL/TP ------------------------- */

  TE.setSL = function (price) {
    const p = TE.state.position;
    if (!p) return false;
    if (price === null || price === undefined || !Number.isFinite(+price)) { p.sl = null; }
    else {
      if (p.side === 'long' && price >= p.entryPrice) { U.toast('SL inválido: debe estar por debajo de la entrada', 'warn'); return false; }
      if (p.side === 'short' && price <= p.entryPrice) { U.toast('SL inválido: debe estar por encima de la entrada', 'warn'); return false; }
      p.sl = +price;
    }
    TE.updateRisk(p);
    U.log(`🛠 SL actualizado a ${p.sl ? U.fmtPrice(p.sl) : 'sin SL'}`, 'warn');
    TE._emit();
    return true;
  };

  TE.setTP = function (price) {
    const p = TE.state.position;
    if (!p) return false;
    if (price === null || price === undefined || !Number.isFinite(+price)) { p.tp = null; }
    else {
      if (p.side === 'long' && price <= p.entryPrice) { U.toast('TP inválido: debe estar por encima de la entrada', 'warn'); return false; }
      if (p.side === 'short' && price >= p.entryPrice) { U.toast('TP inválido: debe estar por debajo de la entrada', 'warn'); return false; }
      p.tp = +price;
    }
    TE.updateRisk(p);
    U.log(`🛠 TP actualizado a ${p.tp ? U.fmtPrice(p.tp) : 'sin TP'}`, 'warn');
    TE._emit();
    return true;
  };

  /** Recalcula el riesgo usado para el R múltiplo. */
  TE.updateRisk = function (p) {
    p.riskUsd = p.sl !== null ? Math.abs(p.entryPrice - p.sl) * p.qty : null;
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
      if (s.position) break;   // con una posición abierta las órdenes esperan
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

      if (slHit && tpHit) {
        const first = s.slFirst === 'best' ? 'tp' : 'sl';
        if (first === 'sl') return TE.closePosition(TE._fillPrice(candle, p.sl, p.side, true), 'sl', candle.time);
        return TE.closePosition(TE._fillPrice(candle, p.tp, p.side, false), 'tp', candle.time);
      }
      if (slHit) return TE.closePosition(TE._fillPrice(candle, p.sl, p.side, true), 'sl', candle.time);
      if (tpHit) return TE.closePosition(TE._fillPrice(candle, p.tp, p.side, false), 'tp', candle.time);
    }

    TE.updateEquity(candle.close, candle.time);
    TE._emit();
    return null;
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
      if (cp.tradesLen > 0 && s.trades.length >= cp.tradesLen) s.trades[cp.tradesLen - 1] = clone;
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
        feePct: TE.state.feePct,
        fundingPct: TE.state.fundingPct,
        slFirst: TE.state.slFirst,
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
    TE._emit();
  };

  global.TE = TE;
})(window);
