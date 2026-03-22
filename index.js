// HYDRA VLESS WebSocket → TCP прокси
// Универсальный — работает на Node.js (Render, Railway, Koyeb, etc.)
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
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body>Service OK</body></html>');
});

// WebSocket upgrade — проксируем в Xray WS
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/vless-ws')) {
    socket.destroy();
    return;
  }

  // Подключаемся к Xray WS inbound на main через TCP
  const upstream = net.createConnection({ host: MAIN_HOST, port: VLESS_PORT }, () => {
    // Формируем WS handshake для Xray
    const wsKey = crypto.randomBytes(16).toString('base64');
    const lines = [
      'GET /vless-ws HTTP/1.1',
      `Host: ${MAIN_HOST}:${VLESS_PORT}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${wsKey}`,
      'Sec-WebSocket-Version: 13',
      '', ''
    ];
    upstream.write(lines.join('\r\n'));

    // Ждём ответ от Xray (101 Switching Protocols)
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return; // ещё не весь заголовок — ждём

      upstream.removeListener('data', onData);

      const headerStr = buf.slice(0, idx).toString();
      if (!headerStr.includes('101')) {
        console.error('Xray rejected WS:', headerStr.split('\r\n')[0]);
        socket.destroy();
        upstream.destroy();
        return;
      }

      // Отвечаем клиенту
      const acceptKey = crypto.createHash('sha1')
        .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-5AB5DC1165B0')
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
      );

      // Если head содержит данные от клиента — передаём upstream
      if (head && head.length > 0) upstream.write(head);

      // Оставшиеся данные после заголовков Xray → клиенту
      const rest = buf.slice(idx + 4);
      if (rest.length > 0) socket.write(rest);

      // Двунаправленный pipe
      socket.pipe(upstream);
      upstream.pipe(socket);
    };
    upstream.on('data', onData);
  });

  upstream.on('error', (e) => { console.error('upstream err:', e.message); socket.destroy(); });
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HYDRA WS proxy [${NODE_NAME}] → ${MAIN_HOST}:${VLESS_PORT} on :${PORT}`);
});
