/* =========================================================================
 * server.js — Servidor de desarrollo (backend OPCIONAL) para Bar Replay Pro.
 *
 *  Hace dos cosas:
 *   1) Sirve la aplicación estática (index.html, css/, js/, vendor/…).
 *   2) Expone un proxy de velas de Binance en /api/v3/klines que evita
 *      problemas de CORS/bloqueos regionales. El frontend lo usa como uno
 *      más de los hosts disponibles: si el navegador no puede hablar
 *      directamente con Binance, cae a este proxy del mismo origen.
 *
 *  Funciona SIN dependencias (módulos nativos de Node ≥ 18).
 *  Si tienes Express instalado, se usa su capa HTTP; si no, el servidor nativo.
 *
 *  Uso:
 *      node server.js              → http://localhost:8080
 *      PORT=3000 node server.js    → otro puerto
 * =======================================================================*/
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || process.argv[2] || '8080', 10);

// Hosts de Binance en orden de preferencia: primero el endpoint público de
// datos de mercado (accesible en casi todas las regiones) y después espejos.
// `BINANCE_HOST` permite forzar uno concreto desde el entorno.
const BINANCE_HOSTS = process.env.BINANCE_HOST
  ? [process.env.BINANCE_HOST]
  : ['data-api.binance.vision', 'api.binance.com', 'api1.binance.com', 'api2.binance.com', 'api3.binance.com', 'api4.binance.com'];

/* ------------------------------ Tipos MIME ------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/* ------------------------------- Utilidades ------------------------------- */

/** Evita que una petición escape de la carpeta del proyecto (path traversal). */
function safeJoin(root, target) {
  const p = path.normalize(path.join(root, target));
  return p.startsWith(root) ? p : null;
}

/**
 * Descarga JSON de Binance (una página de hasta 1000 velas) probando hosts en
 * orden: si uno responde 451/403/404 o falla la conexión, se pasa al siguiente.
 * Esto evita los bloqueos por región («Service unavailable from a restricted
 * location») que devuelven algunos espejos.
 */
function proxyKlines(query, res) {
  const qs = new URLSearchParams({
    symbol: (query.symbol || 'BTCUSDT').toUpperCase(),
    interval: query.interval || '1h',
    limit: String(Math.min(parseInt(query.limit || '1000', 10) || 1000, 1000)),
  });
  if (query.startTime) qs.set('startTime', query.startTime);
  if (query.endTime) qs.set('endTime', query.endTime);

  const qstr = qs.toString();
  let i = 0;
  const tried = [];

  const next = () => {
    if (i >= BINANCE_HOSTS.length) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ningún host de Binance respondió', hosts: tried }));
      return;
    }
    const host = BINANCE_HOSTS[i++];
    const req = https.get(`https://${host}/api/v3/klines?${qstr}`,
      { timeout: 12000, headers: { 'User-Agent': 'bar-replay-pro/1.0', 'Accept': 'application/json' } },
      (up) => {
        let body = '';
        up.on('data', (c) => { body += c; });
        up.on('end', () => {
          tried.push({ host, status: up.statusCode });
          if (up.statusCode !== 200) {
            console.warn(`  · ${host} → HTTP ${up.statusCode}, probando el siguiente host…`);
            next();
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=30',
            'Access-Control-Allow-Origin': '*',
            'X-Binance-Host': host,
          });
          res.end(body);
        });
      });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      tried.push({ host, error: err.message });
      console.warn(`  · ${host} → ${err.message}, probando el siguiente host…`);
      next();
    });
  };
  next();
}

/** Sirve un archivo estático. */
function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = safeJoin(ROOT, rel);
  if (!file) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 — No encontrado: ' + rel);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* --------------------------------- Servidor --------------------------------- */

const handler = (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  // API interna
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'Bar Replay Pro', binance: BINANCE_HOSTS, time: new Date().toISOString() }));
    return;
  }
  // Proxy de velas (alineado con la API de Binance para no cambiar el cliente)
  if (pathname === '/api/v3/klines') {
    proxyKlines(parsed.query, res);
    return;
  }
  // El mismo origen puede exponer también otros endpoints de Binance
  if (pathname === '/api/v3/time') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ serverTime: Date.now() }));
    return;
  }

  serveStatic(pathname, res);
};

/* Si Express está instalado se usa; si no, el servidor nativo. */
let server;
let engine = 'http nativo';
try {
  const express = require('express');
  const app = express();
  app.use(express.static(ROOT, { extensions: ['html'] }));
  app.get('/api/status', (req, res) => res.json({ ok: true, app: 'Bar Replay Pro', binance: BINANCE_HOSTS }));
  app.get('/api/v3/klines', (req, res) => proxyKlines(req.query, res));
  app.get('/api/v3/time', (req, res) => res.json({ serverTime: Date.now() }));
  server = http.createServer(app);
  engine = 'express';
} catch (e) {
  server = http.createServer(handler);
}

server.listen(PORT, '0.0.0.0', () => {
  const lines = [
    '',
    '  ┌──────────────────────────────────────────────┐',
    '  │   BAR REPLAY PRO — servidor de desarrollo    │',
    '  └──────────────────────────────────────────────┘',
    `  · URL:          http://localhost:${PORT}`,
    `  · Servidor:     ${engine}`,
    `  · Proxy velas:  http://localhost:${PORT}/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5`,
    `  · Hosts Binance: ${BINANCE_HOSTS.join(', ')}`,
    '',
    '  Pulsa Ctrl+C para detener.',
    '',
  ];
  console.log(lines.join('\n'));
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
