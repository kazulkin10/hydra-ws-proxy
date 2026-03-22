// Vercel Serverless Function — health check
module.exports = (req, res) => {
  res.status(200).json({ ok: true, node: 'vercel', port: 2007, ts: Date.now() });
};
