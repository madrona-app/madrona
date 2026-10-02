#!/usr/bin/env node
/**
 * E2E test server: serves the Vite dist build with SPA fallback AND
 * proxies /api/* to the local backend.
 *
 * Why this exists
 * ---------------
 * Two requirements collide in CI:
 *
 * 1. The SPA needs SPA-style fallback (every unknown URL → index.html)
 *    so client-routed paths like /sign-in render correctly. `vite preview`
 *    won't do this because vite.config.ts sets `appType: 'mpa'` (we have
 *    both index.html and admin.html entry points).
 * 2. The SPA's API calls (/api/me, /api/auth/login, ...) need to reach
 *    the FastAPI backend on localhost:8000. `serve --single` does (1) but
 *    not (2) — every /api/* request gets the index.html fallback, the
 *    SPA tries to JSON.parse HTML, and the page crashes with
 *    "Cannot read properties of undefined (reading 'map')".
 *
 * This script does both:
 *   * /api/*  →  proxies to localhost:8000 (BACKEND_ORIGIN env)
 *   * /admin, /admin/*  →  serve dist/admin.html
 *   * everything else  →  serve dist/index.html (SPA fallback)
 *   * existing files (assets/*, favicon.svg, ...) served as-is
 *
 * Built with Node built-ins only — no `express`, no `http-proxy-middleware`,
 * no `serve-handler`. Keeps the E2E runner fast to install.
 */
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, resolve, extname, normalize } from 'node:path';

const PORT = parseInt(process.env.PORT || '4173', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DIST = resolve(process.argv[2] || 'dist');
const BACKEND = process.env.BACKEND_ORIGIN || 'http://localhost:8000';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const backendUrl = new URL(BACKEND);

function proxyToBackend(req, res) {
  // Strip the host header so the backend's session cookies are scoped
  // correctly to localhost. Keep everything else.
  const headers = { ...req.headers };
  delete headers.host;

  const upstream = httpRequest(
    {
      protocol: backendUrl.protocol,
      hostname: backendUrl.hostname,
      port: backendUrl.port || (backendUrl.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    console.error(`[serve-e2e] proxy error for ${req.method} ${req.url}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad Gateway: backend not reachable');
    } else {
      res.destroy();
    }
  });

  req.pipe(upstream);
}

function serveFile(res, absPath, statusCode = 200) {
  const ext = extname(absPath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  res.writeHead(statusCode, { 'content-type': contentType });
  createReadStream(absPath).pipe(res);
}

function safePath(reqUrl) {
  // Strip query string + normalize to prevent path traversal.
  const url = new URL(reqUrl, 'http://localhost');
  const decoded = decodeURIComponent(url.pathname);
  const norm = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  return norm.startsWith('/') ? norm.slice(1) : norm;
}

const server = createServer((req, res) => {
  // 1. Backend-proxied routes. /api is the app's API; /iiif is the public
  //    IIIF Image/Presentation API (anonymous, published-only — see
  //    routers/media_iiif.py). Both — plus socket.io — must reach the
  //    backend, not the SPA fallback, or they return index.html — mirror
  //    prod nginx here.
  if (
    req.url.startsWith('/api/') ||
    req.url === '/api' ||
    req.url.startsWith('/iiif/') ||
    req.url === '/iiif' ||
    req.url.startsWith('/socket.io')
  ) {
    return proxyToBackend(req, res);
  }

  // 2. Static asset lookup (only for actual paths inside dist)
  const rel = safePath(req.url);
  const candidate = join(DIST, rel);
  if (rel && existsSync(candidate)) {
    try {
      const st = statSync(candidate);
      if (st.isFile()) return serveFile(res, candidate);
    } catch {
      // fall through to fallback
    }
  }

  // 3. SPA fallback. /admin and /admin/* go to admin.html (separate
  //    Vite entry); everything else falls back to index.html.
  if (req.url === '/admin' || req.url.startsWith('/admin/')) {
    return serveFile(res, join(DIST, 'admin.html'));
  }
  return serveFile(res, join(DIST, 'index.html'));
});

// WebSocket upgrades (socket.io realtime) → proxy to the backend. Without
// this the upgrade hits the SPA fallback and the client gets a 200 (HTML)
// instead of a 101, surfacing as a handshake console error in e2e.
server.on('upgrade', (req, clientSocket, head) => {
  if (!req.url.startsWith('/socket.io') && !req.url.startsWith('/api/')) {
    clientSocket.destroy();
    return;
  }
  const headers = { ...req.headers };
  delete headers.host;

  const upstream = httpRequest({
    protocol: backendUrl.protocol,
    hostname: backendUrl.hostname,
    port: backendUrl.port || (backendUrl.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: req.url,
    headers,
  });

  upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    const statusLine = `HTTP/1.1 101 ${upstreamRes.statusMessage || 'Switching Protocols'}\r\n`;
    const headerLines = Object.entries(upstreamRes.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    clientSocket.write(`${statusLine}${headerLines}\r\n\r\n`);
    if (upstreamHead && upstreamHead.length) upstreamSocket.unshift(upstreamHead);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
    const cleanup = () => {
      upstreamSocket.destroy();
      clientSocket.destroy();
    };
    upstreamSocket.on('error', cleanup);
    clientSocket.on('error', cleanup);
  });
  upstream.on('error', () => clientSocket.destroy());
  if (head && head.length) upstream.write(head);
  upstream.end();
});

server.listen(PORT, HOST, () => {
  console.log(`[serve-e2e] dist=${DIST} listening on http://${HOST}:${PORT}, /api → ${BACKEND}`);
});
