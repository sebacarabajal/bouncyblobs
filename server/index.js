// Servidor de producción: sirve el juego compilado (dist/), la API (/api/...) y, en el subdominio admin.*,
// el panel de analíticas (/) y el juego con las herramientas de admin (/juego).
//   node server/index.js        (variables: ver .env.example)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from './db.js';
import { createApi } from './api.js';

const env = process.env;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8',
};

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; res.end('no existe'); return; }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Length', st.size);
    res.setHeader('Cache-Control', cache);
    fs.createReadStream(file).pipe(res);
  });
}

const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : null;
if (pool) await migrate(pool);
else console.warn('[server] sin DATABASE_URL: el juego anda, pero sin analíticas ni récords');
const api = createApi({ pool, env });

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    try { if (pool) await pool.query('select 1'); res.end('ok'); } catch { res.statusCode = 503; res.end('db'); }
    return;
  }
  if (await api(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }

  const admin = /^admin\./.test(String(req.headers.host || ''));
  let p = decodeURIComponent(url.pathname);
  if (admin && (p === '/' || p === '/admin.html')) p = '/admin.html';
  else if (admin && (p === '/juego' || p === '/juego/')) p = '/index.html';
  else if (p === '/admin.html') { res.statusCode = 404; res.end('no existe'); return; } // el panel no existe en el sitio público
  else if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.statusCode = 400; res.end(); return; }
  // los archivos con hash (assets/) no cambian nunca: caché de un año; el resto se revalida
  const cache = p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  serveFile(res, file, cache);
});

server.listen(PORT, '0.0.0.0', () => console.log(`[server] Bouncy Blobs en el puerto ${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(() => process.exit(0)); pool?.end(); setTimeout(() => process.exit(0), 3000).unref(); });
