/* =========================================================================
 * tools/snapshot.js — Guarda una INSTANTÁNEA de velas REALES de Binance en
 * snapshot/velas-reales.json. Ese archivo se incrusta después en el archivo
 * único (tools/build-single.js), de forma que la app muestre precios reales
 * incluso en entornos SIN salida a internet (visores embebidos, sin red…).
 *
 * Uso:
 *   node server.js            (en otra terminal, para usar el proxy)
 *   node tools/snapshot.js    [--base http://127.0.0.1:8080] [--sets BTCUSDT:1h:2000,ETHUSDT:1h:1000]
 * =======================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'snapshot', 'velas-reales.json');

/* ------------------------------ Argumentos ------------------------------ */
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const BASE = getArg('base', process.env.BASE_URL || 'http://127.0.0.1:8080');
const SETS = getArg('sets', 'BTCUSDT:1h:2000,BTCUSDT:15m:1000,ETHUSDT:1h:1000')
  .split(',').map((s) => {
    const [symbol, interval, limit] = s.split(':');
    return { symbol: symbol.trim(), interval: interval.trim(), limit: +(limit || 1000) };
  });

/** Descarga `limit` velas paginando de 1000 en 1000 (límite de Binance). */
async function klines(symbol, interval, limit) {
  const out = [];
  let end = null;
  while (out.length < limit) {
    const n = Math.min(1000, limit - out.length);
    let url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${n}`;
    if (end) url += `&endTime=${end}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${symbol} ${interval}: HTTP ${r.status}`);
    const batch = await r.json();
    if (!batch.length) break;
    out.unshift(...batch);
    end = batch[0][0] - 1;          // sigue hacia atrás desde la primera vela
  }
  return out.slice(-limit);
}

/** Fila compacta [t, o, h, l, c, v] con los decimales justos (menos peso). */
const num = (x, d) => {
  const s = Number(x).toFixed(d).replace(/\.?0+$/, '');
  return s === '' || s === '-' ? 0 : Number(s);
};
const compact = (rows) => rows.map((r) => [
  Math.floor(r[0] / 1000), num(r[1], 2), num(r[2], 2), num(r[3], 2), num(r[4], 2), num(r[5], 3),
]);

const fmt = (ts) => new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

(async () => {
  console.log(`\n▸ Descargando velas reales desde ${BASE}`);
  const sets = {};
  let total = 0;
  for (const { symbol, interval, limit } of SETS) {
    const rows = compact(await klines(symbol, interval, limit));
    if (!rows.length) { console.log(`  ⚠ ${symbol} ${interval}: sin datos`); continue; }
    sets[`${symbol}|${interval}`] = rows;
    total += rows.length;
    console.log(`  · ${(symbol + ' ' + interval).padEnd(14)} ${String(rows.length).padStart(5)} velas · ` +
      `${fmt(rows[0][0])} → ${fmt(rows[rows.length - 1][0])} · último cierre ${rows[rows.length - 1][4]}`);
  }
  const snap = {
    savedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    note: 'Velas reales de Binance incrustadas para uso sin conexión (generado por tools/snapshot.js)',
    sets,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snap));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`\n✅ ${path.relative(ROOT, OUT)}  (${total} velas · ${kb} KB)`);
  console.log('   Siguiente paso: node tools/build-single.js\n');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
