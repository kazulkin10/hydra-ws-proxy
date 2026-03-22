// HYDRA VLESS WebSocket → TCP прокси
// Использует ws для надёжного WS relay
const http = require('http');
const net = require('net');
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

// WS сервер для приёма клиентских подключений
const wss = new WebSocketServer({ server, path: '/vless-ws' });

wss.on('connection', (clientWs, req) => {
  // Открываем WS к Xray
  const upstreamUrl = `ws://${MAIN_HOST}:${VLESS_PORT}/vless-ws`;
  const upstream = new WebSocket(upstreamUrl);

  upstream.on('open', () => {
    // Relay: client → upstream
    clientWs.on('message', (data) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data);
      }
    });

    // Relay: upstream → client
    upstream.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });
  });

  upstream.on('error', (e) => {
    console.error('upstream err:', e.message);
    clientWs.close();
  });
  upstream.on('close', () => clientWs.close());

  clientWs.on('error', () => upstream.close());
  clientWs.on('close', () => upstream.close());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HYDRA WS proxy [${NODE_NAME}] → ${MAIN_HOST}:${VLESS_PORT} on :${PORT}`);
});
