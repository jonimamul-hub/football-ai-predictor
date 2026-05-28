#!/usr/bin/env node
// ─── Ollama Local Proxy ────────────────────────────────────────────────────
// Runs on your machine. Forwards requests from the Railway app (or local dev)
// to your local Ollama instance, with CORS headers that satisfy the browser.
//
// Usage:
//   node proxy.js
//
// Then open the Railway app in your browser — Ollama will be available.
// Keep this terminal open while using the app. Ctrl+C to stop.
//
// Requirements: Node.js 18+ (uses only built-in modules — nothing to install)
// ──────────────────────────────────────────────────────────────────────────

const http = require('http');

const PROXY_PORT  = 11435;   // port this proxy listens on
const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;

// Origins allowed to call this proxy.
// Add your Railway URL here if it changes.
const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /\.railway\.app$/,
  /\.up\.railway\.app$/,
];

function corsOrigin(origin) {
  if (!origin) return '*';
  return ALLOWED_ORIGINS.some(r => r.test(origin)) ? origin : null;
}

const server = http.createServer((req, res) => {
  const origin  = req.headers.origin || '';
  const allowed = corsOrigin(origin);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin',  allowed);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age',        '86400');
  }

  // Pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check — lets ollama_agent.js confirm the proxy is running
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok', proxy: 'ollama',
      target: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
    }));
    return;
  }

  // Strip /api/ollama prefix, forward the rest to Ollama
  const targetPath = req.url.replace(/^\/api\/ollama/, '') || '/';

  const proxyReq = http.request(
    {
      hostname: OLLAMA_HOST,
      port:     OLLAMA_PORT,
      path:     targetPath,
      method:   req.method,
      headers:  { ...req.headers, host: `${OLLAMA_HOST}:${OLLAMA_PORT}` },
    },
    (proxyRes) => {
      // Forward CORS headers already set; pass everything else through
      const fwd = { ...proxyRes.headers };
      delete fwd['access-control-allow-origin'];   // don't let Ollama override ours
      res.writeHead(proxyRes.statusCode, fwd);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on('error', (err) => {
    console.error(`[proxy] Ollama unreachable: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Ollama not reachable', detail: err.message }));
  });

  req.pipe(proxyReq, { end: true });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PROXY_PORT} is already in use.`);
    console.error(`    Stop the other process, or edit PROXY_PORT at the top of proxy.js.\n`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`\n✅  Ollama proxy listening on http://localhost:${PROXY_PORT}`);
  console.log(`    Forwarding /api/ollama/* → http://${OLLAMA_HOST}:${OLLAMA_PORT}`);
  console.log(`    CORS: localhost + *.railway.app\n`);
  console.log(`    Keep this running while using the Railway app.`);
  console.log(`    Ctrl+C to stop.\n`);
});
