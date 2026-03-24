const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const MAIN = 'wss://208.123.185.235.sslip.io:8443';
const PORTS = [2001,2002,2003,2004,2007,2008,2009,2010,2011,2012,2013,2014];
const PORT = parseInt(process.env.PORT || '3000');

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/api/v1/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }
  res.writeHead(200); res.end('OK');
});

const wss = new WebSocketServer({ server, path: '/vless-ws' });

wss.on('connection', (clientWs) => {
  const port = PORTS[Math.floor(Math.random() * PORTS.length)];
  const buffer = [];
  let upstreamReady = false;
  const upstream = new WebSocket(`${MAIN}/p${port}/vless-ws`);

  clientWs.on('message', (data) => {
    if (upstreamReady && upstream.readyState === WebSocket.OPEN) upstream.send(data);
    else buffer.push(data);
  });

  upstream.on('open', () => {
    upstreamReady = true;
    for (const msg of buffer) upstream.send(msg);
    buffer.length = 0;
    upstream.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
  });

  upstream.on('error', () => { try { clientWs.close(); } catch {} });
  upstream.on('close', () => { try { clientWs.close(); } catch {} });
  clientWs.on('error', () => { try { upstream.close(); } catch {} });
  clientWs.on('close', () => { try { upstream.close(); } catch {} });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Relay on :${PORT}`));
