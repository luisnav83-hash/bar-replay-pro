/* =========================================================================
 * statistics.js — Cálculo de métricas de rendimiento a partir del historial
 * de trades y de la curva de capital (equity).
 *
 * Convenio de signos: todo se expresa en USD del balance realizado.
 * --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  const STATS = {};

  /**
   * Calcula el bloque completo de métricas.
   * @param {Array} trades  Trades cerrados: {pnl, pnlPct, rMultiple, side, ...}
   * @param {Array} equity  Puntos de capital: {t, value}
   * @param {number} initialCapital
   */
  STATS.compute = function (trades, equity, initialCapital) {
    const closed = trades.filter((t) => t.status === 'closed');
    const n = closed.length;

    const wins = closed.filter((t) => t.pnl > 0);
    const losses = closed.filter((t) => t.pnl <= 0);
    const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));

    const pnl = closed.reduce((a, t) => a + t.pnl, 0);

    // Serie de equity realizada (solo trades cerrados) para métricas
    let eq = initialCapital, peak = initialCapital, maxDD = 0, maxDDPct = 0;
    const eqCurve = [{ i: 0, value: initialCapital }];
    closed.forEach((t, i) => {
      eq += t.pnl;
      eqCurve.push({ i: i + 1, value: eq, time: t.exitTime });
      if (eq > peak) peak = eq;
      const dd = peak - eq;
      if (dd > maxDD) maxDD = dd;
      if (peak > 0 && dd / peak > maxDDPct) maxDDPct = dd / peak;
    });
    // Drawdown sobre la equity real (incluye curvas intradía si se aportan)
    if (Array.isArray(equity) && equity.length) {
      let p = initialCapital, dd = 0, ddPct = 0;
      equity.forEach((pt) => {
        if (pt.value > p) p = pt.value;
        const d = p - pt.value;
        if (d > dd) dd = d;
        if (p > 0 && d / p > ddPct) ddPct = d / p;
      });
      maxDD = Math.max(maxDD, dd);
      maxDDPct = Math.max(maxDDPct, ddPct);
    }

    // Rachas
    let bestStreak = 0, worstStreak = 0, curWin = 0, curLoss = 0;
    closed.forEach((t) => {
      if (t.pnl > 0) { curWin++; curLoss = 0; } else { curLoss++; curWin = 0; }
      bestStreak = Math.max(bestStreak, curWin);
      worstStreak = Math.max(worstStreak, curLoss);
    });
    let currentStreak = 0, streakType = '—';
    for (let i = closed.length - 1; i >= 0; i--) {
      const isWin = closed[i].pnl > 0;
      if (i === closed.length - 1) { streakType = isWin ? 'W' : 'L'; currentStreak = 1; }
      else if ((isWin && streakType === 'W') || (!isWin && streakType === 'L')) currentStreak++;
      else break;
    }

    const best = n ? Math.max(...closed.map((t) => t.pnl)) : 0;
    const worst = n ? Math.min(...closed.map((t) => t.pnl)) : 0;
    const avgWin = wins.length ? grossWin / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const winRate = n ? (wins.length / n) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
    const payoff = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0);
    const expectancy = n ? pnl / n : 0;

    // R múltiplo medio: pnl / riesgo inicial (si se registró riesgo)
    const withR = closed.filter((t) => Number.isFinite(t.rMultiple));
    const avgR = withR.length ? withR.reduce((a, t) => a + t.rMultiple, 0) / withR.length : null;

    // Tiempo medio en mercado
    const durations = closed.filter((t) => t.exitTime && t.entryTime).map((t) => t.exitTime - t.entryTime);
    const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    // Trades por motivo de salida
    const byReason = {};
    closed.forEach((t) => { byReason[t.reason] = (byReason[t.reason] || 0) + 1; });

    return {
      total: n,
      opens: trades.filter((t) => t.status === 'open').length,
      wins: wins.length,
      losses: losses.length,
      winRate, profitFactor, payoff, expectancy, avgR,
      grossWin, grossLoss,
      totalPnl: pnl,
      totalPnlPct: initialCapital ? (pnl / initialCapital) * 100 : 0,
      maxDD, maxDDPct,
      best, worst, avgWin, avgLoss,
      bestStreak, worstStreak, currentStreak, streakType,
      avgDuration,
      byReason,
      eqCurve,
      totalFees: trades.reduce((a, t) => a + (t.fees || 0), 0),
    };
  };

  /* --------------------------- Exportaciones --------------------------- */

  /** Convierte el historial de trades a CSV. */
  STATS.tradesToCSV = function (trades, pair, interval) {
    const head = ['#', 'Direccion', 'Entrada_UTC', 'Salida_UTC', 'Precio_entrada', 'Precio_salida',
      'Tamano', 'Notional_USD', 'Apalancamiento', 'PnL_USD', 'PnL_%', 'R', 'Motivo', 'Velas', 'Comisiones'];
    const rows = trades.map((t, i) => [
      i + 1, t.side === 'long' ? 'LONG' : 'SHORT',
      U.fmtDateSec(t.entryTime), t.exitTime ? U.fmtDateSec(t.exitTime) : '',
      t.entryPrice, t.exitPrice || '', t.qty, U.round(t.notional, 2), t.leverage,
      U.round(t.pnl, 2), U.round(t.pnlPct, 3), Number.isFinite(t.rMultiple) ? U.round(t.rMultiple, 2) : '',
      t.reason || '', t.bars || '', U.round(t.fees, 2),
    ]);
    const meta = `# Exportado por Bar Replay Pro — ${pair} ${interval} — ${new Date().toISOString()}`;
    return meta + '\n' + [head, ...rows].map((r) => r.join(',')).join('\n');
  };

  /** Convierte la curva de capital a CSV. */
  STATS.equityToCSV = function (equity) {
    const rows = [['Indice', 'UTC', 'Equity']].concat(
      equity.map((p, i) => [i, p.time ? U.fmtDateSec(p.time) : '', U.round(p.value, 2)])
    );
    return rows.map((r) => r.join(',')).join('\n');
  };

  /** Convierte velas a CSV (formato compatible con la importación). */
  STATS.candlesToCSV = function (candles) {
    const rows = [['time', 'open', 'high', 'low', 'close', 'volume']].concat(
      candles.map((c) => [U.fmtDateSec(c.time), c.open, c.high, c.low, c.close, c.volume])
    );
    return rows.map((r) => r.join(',')).join('\n');
  };

  /** Resumen en texto de las métricas principales (para el informe). */
  STATS.summaryLines = function (s, initialCapital, finalEquity) {
    const f = (v, d = 2) => U.num(v, d);
    return [
      ['Capital inicial', U.fmtMoney(initialCapital)],
      ['Balance final', U.fmtMoney(finalEquity)],
      ['PnL total', U.fmtMoney(s.totalPnl, true) + '  (' + U.fmtPct(s.totalPnlPct, 2, true) + ')'],
      ['Nº de trades', s.total],
      ['Ganadores / Perdedores', `${s.wins} / ${s.losses}`],
      ['Win rate', U.fmtPct(s.winRate, 1)],
      ['Profit factor', s.profitFactor === Infinity ? '∞' : f(s.profitFactor)],
      ['Payoff (Gan.medio/Perd.medio)', s.payoff === Infinity ? '∞' : f(s.payoff)],
      ['Expectancy por trade', U.fmtMoney(s.expectancy, true)],
      ['R medio', s.avgR === null ? '—' : f(s.avgR) + 'R'],
      ['Máximo drawdown', U.fmtMoney(-s.maxDD) + '  (' + U.fmtPct(s.maxDDPct * 100, 2) + ')'],
      ['Mejor trade', U.fmtMoney(s.best, true)],
      ['Peor trade', U.fmtMoney(s.worst, true)],
      ['Ganancia media', U.fmtMoney(s.avgWin)],
      ['Pérdida media', U.fmtMoney(s.avgLoss)],
      ['Comisiones pagadas', U.fmtMoney(s.totalFees)],
      ['Mejor racha ganadora', s.bestStreak + ' trades'],
      ['Peor racha perdedora', s.worstStreak + ' trades'],
      ['Duración media en mercado', U.fmtDuration(0, s.avgDuration)],
      ['Salidas por TP / SL / manual', `${s.byReason.tp || 0} / ${s.byReason.sl || 0} / ${(s.byReason.manual || 0) + (s.byReason.liq || 0) + (s.byReason.reset || 0)}`],
    ];
  };

  global.STATS = STATS;
})(window);
