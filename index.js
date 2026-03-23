const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const MAIN_HOST = process.env.MAIN_HOST || '208.123.185.235';
const VLESS_PORT = parseInt(process.env.VLESS_PORT || '2001');
const PORT = parseInt(process.env.PORT || '3000');
const NODE_NAME = process.env.NODE_NAME || 'generic';

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/api/v1/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, node: NODE_NAME, port: VLESS_PORT, ts: Date.now() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body>Service OK</body></html>');
});

const wss = new WebSocketServer({ server, path: '/vless-ws' });

wss.on('connection', (clientWs) => {
  const buffer = [];
  let upstreamReady = false;

  const upstream = new WebSocket(`ws://${MAIN_HOST}:${VLESS_PORT}/vless-ws`);

  // Buffer client messages immediately — don't wait for upstream.open
  clientWs.on('message', (data) => {
    if (upstreamReady && upstream.readyState === WebSocket.OPEN) {
      upstream.send(data);
    } else {
      buffer.push(data);
    }
  });

  upstream.on('open', () => {
    upstreamReady = true;
    // Flush buffered messages
    for (const msg of buffer) { upstream.send(msg); }
    buffer.length = 0;
    // Wire upstream → client
    upstream.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
    });
  });

  upstream.on('error', (e) => { console.error('upstream err:', e.message); try { clientWs.close(); } catch {} });
  upstream.on('close', () => { try { clientWs.close(); } catch {} });
  clientWs.on('error', () => { try { upstream.close(); } catch {} });
  clientWs.on('close', () => { try { upstream.close(); } catch {} });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WS relay [${NODE_NAME}] -> ${MAIN_HOST}:${VLESS_PORT} on :${PORT}`);
});
