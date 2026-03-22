// Vercel Serverless Function — VLESS HTTP relay proxy
// Vercel не поддерживает WebSocket, поэтому делаем HTTP relay
const http = require('http');
const https = require('https');

const MAIN_HOST = process.env.MAIN_HOST || '208.123.185.235';
const VLESS_PORT = parseInt(process.env.VLESS_PORT || '2007');

module.exports = async (req, res) => {
  // Relay HTTP request to Xray on main
  const targetUrl = `http://${MAIN_HOST}:${VLESS_PORT}${req.url}`;

  try {
    const proxyRes = await new Promise((resolve, reject) => {
      const proxyReq = http.request(targetUrl, {
        method: req.method,
        headers: { ...req.headers, host: `${MAIN_HOST}:${VLESS_PORT}` },
        timeout: 25000,
      }, resolve);
      proxyReq.on('error', reject);
      req.pipe(proxyReq);
    });

    res.status(proxyRes.statusCode);
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });

    const chunks = [];
    for await (const chunk of proxyRes) chunks.push(chunk);
    res.send(Buffer.concat(chunks));
  } catch (e) {
    res.status(502).json({ error: 'upstream error', msg: e.message });
  }
};
