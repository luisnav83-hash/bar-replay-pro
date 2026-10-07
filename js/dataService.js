/* =========================================================================
 * dataService.js — Obtención y normalización de velas OHLCV.
 *
 *  Fuentes:
 *   1) Binance REST público  GET /api/v3/klines  (1000 velas por petición,
 *      con paginación automática para rangos grandes). Varios hosts espejo.
 *   2) CoinGecko (fallback de 2º nivel) usando velas agregadas.
 *   3) CSV importado por el usuario.
 *   4) Generador de datos sintéticos verificables (modo Demo / sin red).
 *
 *  Formato interno de vela (compatible con servicios de datos de librerías
 *  de gráficos): { time, open, high, low, close, volume }  con time en
 *  SEGUNDOS UNIX UTC.
 * =======================================================================*/
(function (global) {
  'use strict';

  const DS = {};

  /* ----------------------------- Configuración ----------------------------- */

  DS.TIMEFRAMES = {
    '1m':  { ms: 60e3,          binance: '1m', label: '1 min' },
    '5m':  { ms: 300e3,         binance: '5m', label: '5 min' },
    '15m': { ms: 900e3,         binance: '15m', label: '15 min' },
    '1h':  { ms: 3600e3,        binance: '1h', label: '1 hora' },
    '4h':  { ms: 4 * 3600e3,    binance: '4h', label: '4 horas' },
    '1d':  { ms: 86400e3,       binance: '1d', label: '1 día' },
    '1w':  { ms: 7 * 86400e3,   binance: '1w', label: '1 semana' },
  };

  // Hosts de Binance, en orden de preferencia. `data-api.binance.vision` es el
  // endpoint público de datos de mercado (el más accesible desde cualquier
  // región); el resto son espejos por si hubiera bloqueos o caídas.
  DS.BINANCE_HOSTS = [
    'https://data-api.binance.vision',
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
    'https://api4.binance.com',
  ];

  // Si la aplicación se sirve por HTTP(S) mediante server.js, añadimos el
  // mismo origen como último recurso: el backend opcional proxifica
  // /api/v3/klines hacia Binance y evita bloqueos regionales o de CORS.
  try {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
      // Se prueba PRIMERO: si la app se sirve con server.js, esta ruta es la
      // más rápida y fiable; si no existe, responde 404/502 al instante y se
      // rota al siguiente host sin penalizar el arranque.
      DS.BINANCE_HOSTS.unshift('');
    }
  } catch (e) { /* entorno sin location (tests) */ }

  DS.PAIRS = {
    BTCUSDT: 'BTC/USDT', ETHUSDT: 'ETH/USDT', SOLUSDT: 'SOL/USDT', BNBUSDT: 'BNB/USDT',
    XRPUSDT: 'XRP/USDT', ADAUSDT: 'ADA/USDT', DOGEUSDT: 'DOGE/USDT', AVAXUSDT: 'AVAX/USDT',
    LINKUSDT: 'LINK/USDT', MATICUSDT: 'MATIC/USDT',
  };

  // CoinGecko ids para el fallback
  DS.CG_IDS = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', XRP: 'ripple',
    ADA: 'cardano', DOGE: 'dogecoin', AVAX: 'avalanche-2', LINK: 'chainlink', MATIC: 'matic-network',
  };

  /* ------------------------------ Utilidades ------------------------------ */

  /** Timeout por petición. Corto a propósito: es mejor rotar de host rápido
   *  que dejar al usuario mirando un spinner. */
  DS.REQUEST_TIMEOUT = 6000;

  /** Descarga JSON con timeout (AbortController). */
  async function fetchJSON(url, timeoutMs = DS.REQUEST_TIMEOUT) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  /** Normaliza una fila de Binance klines a vela interna. */
  function normBinanceRow(r) {
    return {
      time: Math.floor(r[0] / 1000),
      open: +r[1], high: +r[2], low: +r[3], close: +r[4],
      volume: +r[5], quoteVolume: +r[7], trades: +r[8],
    };
  }

  /** Ordena por tiempo y elimina duplicados (por si se solapan páginas). */
  DS.clean = function (candles) {
    candles.sort((a, b) => a.time - b.time);
    const out = [];
    for (const c of candles) {
      if (!out.length || out[out.length - 1].time !== c.time) out.push(c);
    }
    return out.filter((c) => Number.isFinite(c.open) && Number.isFinite(c.close) && c.high >= c.low);
  };

  /* ------------------------- Binance: klines paginadas ------------------------- */
  /**
   * Descarga velas de Binance entre startTs y endTs (segundos) recorriendo
   * en páginas de 1000 velas con paginación automática hacia delante.
   * @param {string} symbol    Ej: 'BTCUSDT'
   * @param {string} interval  Ej: '1h'
   * @param {number} startTs   epoch segundos
   * @param {number} endTs     epoch segundos
   * @param {function} onProgress  (cargadas, totalAprox, mensaje)
   */
  DS.fetchBinanceKlines = async function (symbol, interval, startTs, endTs, onProgress, opts) {
    const tf = DS.TIMEFRAMES[interval];
    if (!tf) throw new Error('Temporalidad no soportada: ' + interval);
    const deadline = opts && opts.deadlineMs;   // límite de performance.now() (opcional)

    const totalAprox = Math.ceil((endTs - startTs) * 1000 / tf.ms);
    const all = [];
    let cursor = startTs * 1000;      // Binance trabaja en milisegundos
    const endMs = endTs * 1000;
    let hostIdx = 0;
    let firstPage = true;

    while (cursor < endMs) {
      // Presupuesto agotado: se devuelve lo descargado (la app decidirá si
      // le sirve o si arranca directamente en modo DEMO).
      if (deadline && performance.now() > deadline) {
        if (all.length) {
          U.log(`⏱️ Presupuesto de tiempo agotado: se usan las ${all.length} velas ya descargadas`, 'warn');
          break;
        }
        throw new Error('Tiempo de espera agotado al descargar velas');
      }
      const url = `${DS.BINANCE_HOSTS[hostIdx]}/api/v3/klines?symbol=${symbol}` +
                  `&interval=${tf.binance}&startTime=${cursor}&limit=1000`;
      let rows;
      try {
        rows = await fetchJSON(url);
      } catch (err) {
        // Rotación de host espejo antes de rendirse
        if (hostIdx < DS.BINANCE_HOSTS.length - 1) {
          hostIdx++;
          if (firstPage) U.log(`⚠ Binance no responde en el host principal, probando espejo ${hostIdx + 1}…`, 'warn');
          continue;
        }
        throw new Error('No se pudo conectar con Binance (' + err.message + '). ' +
                        'Prueba el botón Demo o importa un CSV.');
      }
      firstPage = false;
      if (!Array.isArray(rows) || rows.length === 0) break;

      for (const r of rows) all.push(normBinanceRow(r));

      const lastOpen = rows[rows.length - 1][0];
      const next = lastOpen + tf.ms;
      if (next <= cursor) break;         // protección anti-bucle infinito
      cursor = next;

      if (onProgress) onProgress(all.length, totalAprox, `Descargando velas de Binance… ${all.length}`);

      // Si la última vela ya supera el final pedido, terminamos
      if (lastOpen >= endMs) break;
      if (rows.length < 1000) break;     // no hay más histórico
    }
    return DS.clean(all.filter((c) => c.time <= endTs));
  };

  /* ----------------------------- CoinGecko fallback ----------------------------- */
  /**
   * Fallback: velas diarias/horarias de CoinGecko (1 día → 4h, 1h → 30m, etc.).
   * Se usa solo si Binance no está accesible. Menos preciso en volumen.
   */
  DS.fetchCoinGeckoKlines = async function (symbol, interval, startTs, endTs) {
    const base = symbol.replace(/USDT$/, '');
    const id = DS.CG_IDS[base];
    if (!id) throw new Error('Par no disponible en CoinGecko');

    const days = Math.max(1, Math.ceil((Date.now() - startTs * 1000) / 86400e3));
    const url = `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${Math.min(days, 365)}`;
    const raw = await fetchJSON(url, 20000);

    const granularity = days <= 2 ? 1800 : days <= 30 ? 14400 : 86400; // seg. por vela
    const candles = raw.map((r) => ({
      time: Math.floor(r[0] / 1000),
      open: r[1], high: r[2], low: r[3], close: r[4], volume: 0,
    }));

    // Reagrupar a la temporalidad solicitada si es mayor que la granularidad
    const tf = DS.TIMEFRAMES[interval];
    const grouped = DS.resample(candles, Math.max(tf.ms, granularity * 1000));
    return DS.clean(grouped).filter((c) => c.time >= startTs && c.time <= endTs);
  };

  /** Reagrupa velas a un intervalo mayor (ms). */
  DS.resample = function (candles, targetMs) {
    const out = [];
    let cur = null;
    for (const c of candles) {
      const bucket = Math.floor(c.time * 1000 / targetMs) * targetMs;
      if (!cur || cur.time !== Math.floor(bucket / 1000)) {
        if (cur) out.push(cur);
        cur = { time: Math.floor(bucket / 1000), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
      } else {
        cur.high = Math.max(cur.high, c.high);
        cur.low = Math.min(cur.low, c.low);
        cur.close = c.close;
        cur.volume += c.volume || 0;
      }
    }
    if (cur) out.push(cur);
    return out;
  };

  /* ------------------------ Instantánea incrustada ------------------------ */
  /**
   * Velas REALES incrustadas en el propio archivo (window.BRP_SNAPSHOT), útiles
   * cuando el entorno bloquea toda salida a internet (visores embebidos).
   * El archivo se genera con `node tools/build-single.js` a partir de
   * snapshot/velas-reales.json.
   */
  DS.loadSnapshot = function (symbol, interval) {
    const S = global.BRP_SNAPSHOT;
    if (!S || !S.sets) return null;
    const rows = S.sets[symbol + '|' + interval];
    if (!rows || !rows.length) return null;
    const candles = DS.clean(rows.map((r) => ({
      time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5],
    })));
    if (!candles.length) return null;
    return {
      candles,
      source: 'Binance (guardada)',
      savedAt: S.savedAt || '',
    };
  };

  /** Lista legible de los conjuntos de velas incrustados: ['BTC/USDT 1h', …] */
  DS.snapshotPairs = function () {
    const S = global.BRP_SNAPSHOT;
    if (!S || !S.sets) return [];
    return Object.keys(S.sets).map((k) => k.replace('|', ' '));
  };

  /* ------------------------------ Carga unificada ------------------------------ */

  /**
   * Carga velas probando Binance → CoinGecko.
   * @returns {Promise<{candles:Array, source:string}>}
   */
  DS.load = async function ({ symbol, interval, startTs, endTs, onProgress, deadlineMs }) {
    // Deja margen para el fallback de CoinGecko dentro del mismo presupuesto
    const binanceDeadline = deadlineMs ? deadlineMs - 3000 : null;
    onProgress && onProgress(0, 0, 'Contactando con Binance…');
    try {
      const candles = await DS.fetchBinanceKlines(symbol, interval, startTs, endTs, onProgress, { deadlineMs: binanceDeadline });
      if (candles.length) return { candles, source: 'Binance' };
      U.log('⚠ Binance devolvió 0 velas, probando CoinGecko…', 'warn');
    } catch (e) {
      U.log('⚠ Binance falló: ' + e.message, 'warn');
    }
    if (deadlineMs && performance.now() > deadlineMs) {
      const snap = DS.loadSnapshot(symbol, interval);
      if (snap) return snap;                       // datos reales incrustados
      throw new Error('Sin datos de Binance y sin tiempo para CoinGecko');
    }
    onProgress && onProgress(0, 0, 'Probando CoinGecko…');
    try {
      const candles2 = await DS.fetchCoinGeckoKlines(symbol, interval, startTs, endTs);
      if (candles2.length) return { candles: candles2, source: 'CoinGecko' };
    } catch (e) {
      U.log('⚠ CoinGecko falló: ' + e.message, 'warn');
    }
    // Último recurso: instantánea de velas reales incrustada en el archivo
    const snap = DS.loadSnapshot(symbol, interval);
    if (snap) return snap;
    throw new Error('Sin conexión y sin instantánea para ' + symbol + ' ' + interval);
  };

  /* -------------------------------- CSV -------------------------------- */
  /**
   * Parsea CSV de velas. Acepta con o sin cabecera y separador , o ;.
   * Columnas reconocidas: fecha/time/timestamp + open/high/low/close/volume.
   * El timestamp puede ser epoch (s o ms) o ISO 8601.
   */
  DS.parseCSV = function (text) {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const out = [];
    let idx = { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5 };

    // Detectar cabecera
    const head = lines[0].toLowerCase();
    let start = 0;
    if (/[a-z]/.test(head) && /open|close|date|fecha|time|hora/.test(head)) {
      const cols = lines[0].split(/[,;\t]/).map((c) => c.trim().toLowerCase());
      const find = (...keys) => cols.findIndex((c) => keys.some((k) => c.includes(k)));
      idx = {
        t: Math.max(0, find('date', 'fecha', 'time', 'hora', 'timestamp', 'open_time', 'unix')),
        o: find('open', 'apertura'), h: find('high', 'max', 'máx'),
        l: find('low', 'min'), c: find('close', 'cierre'), v: find('volume', 'volumen', 'vol'),
      };
      start = 1;
    }
    for (let i = start; i < lines.length; i++) {
      const parts = lines[i].split(/[,;\t]/);
      const parseTs = (s) => {
        s = String(s).trim().replace(/^"|"$/g, '');
        if (/^\d+$/.test(s)) { const n = +s; return n > 1e11 ? Math.floor(n / 1000) : n; }
        const d = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
        return Number.isNaN(d) ? null : Math.floor(d / 1000);
      };
      const t = parseTs(parts[idx.t]);
      if (t === null) continue;
      const o = +parts[idx.o], h = +parts[idx.h], l = +parts[idx.l], c = +parts[idx.c];
      const v = idx.v >= 0 ? +parts[idx.v] || 0 : 0;
      if ([o, h, l, c].some((x) => !Number.isFinite(x))) continue;
      out.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
    }
    return DS.clean(out);
  };

  /* ------------------------- Datos sintéticos (Demo) ------------------------- */
  /**
   * Genera velas sintéticas con caminata aleatoria + tendencias y ciclos,
   * pensadas para poder practicar sin conexión. NO son datos reales.
   */
  DS.synth = function ({ n = 3000, interval = '1h', startPrice = 60000, seed = 42, startTs }) {
    // PRNG determinista (mulberry32): los mismos parámetros dan los mismos datos
    let s = seed >>> 0;
    const rnd = () => {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = () => {
      // Box-Muller
      const u = Math.max(1e-9, rnd()), v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    const tfMs = DS.TIMEFRAMES[interval].ms;
    const t0 = (startTs || Math.floor(Date.now() / 1000) - Math.floor(n * tfMs / 1000)) ;
    const candles = [];
    let price = startPrice;
    let trend = 0;

    for (let i = 0; i < n; i++) {
      // El régimen de tendencia cambia lentamente (mercado con impulsos y rangos)
      if (i % 240 === 0) trend = (rnd() - 0.45) * 0.0016;
      const vol = 0.006 + 0.004 * Math.sin(i / 180);
      const drift = trend + 0.00004 * Math.sin(i / 90);
      const open = price;
      const close = open * Math.exp(drift + vol * gauss());
      const wick = Math.abs(open * vol * (0.35 + rnd()));
      const high = Math.max(open, close) + wick * rnd();
      const low = Math.min(open, close) - wick * rnd();
      const volume = Math.round((900 + 2500 * rnd()) * (1 + Math.abs(close - open) / open * 60));
      candles.push({
        time: Math.floor((t0 * 1000 + i * tfMs) / 1000),
        open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2),
        volume,
      });
      price = close;
    }
    return candles;
  };

  /* ------------------------------- Caché ------------------------------- */
  // La caché vive en localStorage (ver storage.js): aquí solo las claves.

  DS.cacheKey = (symbol, interval) => `brp_kl_${symbol}_${interval}`;

  global.DS = DS;
})(window);
