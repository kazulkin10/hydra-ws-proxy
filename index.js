// HYDRA VLESS WebSocket → TCP прокси
// Универсальный — работает на Node.js (Render, Railway, Koyeb, Amvera, etc.)
const http = require('http');
const net = require('net');
const crypto = require('crypto');

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
  // API relay
  if (req.url.startsWith('/api/v1/') || req.url.startsWith('/sync/')) {
    const opts = { hostname: MAIN_HOST, port: 8443, path: req.url, method: req.method, headers: { 'Content-Type': 'application/json' } };
    const proxy = http.request(opts, (pRes) => {
      res.writeHead(pRes.statusCode, pRes.headers);
      pRes.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end('upstream error'); });
    req.pipe(proxy);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body>Service OK</body></html>');
});

// WebSocket upgrade — проксируем в Xray WS
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/vless-ws')) {
    socket.destroy();
    return;
  }

  // Подключаемся к Xray WS inbound на main
  const tcpConn = net.createConnection({ host: MAIN_HOST, port: VLESS_PORT }, () => {
    // Пересобираем WS handshake для Xray
    const wsKey = req.headers['sec-websocket-key'] || crypto.randomBytes(16).toString('base64');
    const acceptKey = crypto.createHash('sha1').update(wsKey + '258EAFA5-E914-47DA-95CA-5AB5DC1165B0').digest('base64');

    // Отправляем WS upgrade запрос к Xray
    const upgradeReq = `GET /vless-ws HTTP/1.1\r\nHost: ${MAIN_HOST}:${VLESS_PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${wsKey}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
    tcpConn.write(upgradeReq);

    let handshakeDone = false;
    let buffer = Buffer.alloc(0);

    tcpConn.once('data', (chunk) => {
      // Ищем конец HTTP заголовков от Xray
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      // Проверяем что Xray принял WS
      const headerStr = buffer.slice(0, headerEnd).toString();
      if (!headerStr.includes('101')) {
        socket.destroy();
        tcpConn.destroy();
        return;
      }
      handshakeDone = true;

      // Отвечаем клиенту с WS accept
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n');

      // Если были данные после заголовков — отправляем клиенту
      const remaining = buffer.slice(headerEnd + 4);
      if (remaining.length > 0) {
        socket.write(remaining);
      }

      // Двунаправленный pipe: клиент ↔ Xray
      socket.pipe(tcpConn);
      tcpConn.pipe(socket);
    });
  });

  tcpConn.on('error', () => socket.destroy());
  socket.on('error', () => tcpConn.destroy());
  socket.on('close', () => tcpConn.destroy());
  tcpConn.on('close', () => socket.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HYDRA WS proxy [${NODE_NAME}] → ${MAIN_HOST}:${VLESS_PORT} on :${PORT}`);
});
