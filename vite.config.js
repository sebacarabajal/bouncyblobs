import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Registro de rendimiento: en modo desarrollo el juego manda un resumen cada 10 s (ver src/perf.js)
// y acá se guarda en perf/perf-log.jsonl (una línea JSON por resumen) para poder auditarlo.
const perfLog = () => ({
  name: 'perf-log',
  configureServer(server) {
    server.middlewares.use('/__perf', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
      req.on('end', () => {
        try {
          JSON.parse(body); // sólo JSON válido
          fs.mkdirSync('perf', { recursive: true });
          fs.appendFileSync(path.join('perf', 'perf-log.jsonl'), body.trim() + '\n');
          res.end('ok');
        } catch {
          res.statusCode = 400;
          res.end();
        }
      });
    });
  },
});

// Sonidos del admin (🔊 Sonidos): en modo desarrollo guarda los reemplazos en public/sfx/ y la lista en
// public/sfx/sounds.json, así quedan en el juego (y salen en el build). Ver src/sfx.js.
const SFX_DIR = path.join('public', 'sfx');
const SFX_EXT = ['mp3', 'wav', 'ogg', 'webm', 'm4a', 'flac', 'aac'];
const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', json: 'application/json' };
const sfxStore = () => ({
  name: 'sfx-store',
  configureServer(server) {
    const manifestPath = path.join(SFX_DIR, 'sounds.json');
    const readM = () => { try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return { files: {}, vol: {} }; } };
    const writeM = (m) => { fs.mkdirSync(SFX_DIR, { recursive: true }); fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n'); };
    const body = (req, max, cb) => {
      const chunks = []; let n = 0;
      req.on('data', (c) => { n += c.length; if (n > max) req.destroy(); else chunks.push(c); });
      req.on('end', () => cb(Buffer.concat(chunks)));
    };
    server.middlewares.use('/__sfx', (req, res) => {
      const u = new URL(req.url, 'http://x');
      const key = u.searchParams.get('key') || '';
      const fail = (code) => { res.statusCode = code; res.end(); };
      if (!/^[a-zA-Z]{2,20}$/.test(key)) return fail(400);
      const m = readM();
      m.files ||= {}; m.vol ||= {};
      const removeFile = () => { if (m.files[key]) { fs.rmSync(path.join(SFX_DIR, m.files[key]), { force: true }); delete m.files[key]; } };
      if (u.pathname === '/file' && req.method === 'POST') {
        const ext = (u.searchParams.get('ext') || '').toLowerCase();
        if (!SFX_EXT.includes(ext)) return fail(400);
        return body(req, 8e6, (buf) => {
          if (!buf.length) return fail(400);
          removeFile();
          fs.mkdirSync(SFX_DIR, { recursive: true });
          const file = `${key}.${ext}`;
          fs.writeFileSync(path.join(SFX_DIR, file), buf);
          m.files[key] = file;
          writeM(m);
          res.end(file);
        });
      }
      if (u.pathname === '/file' && req.method === 'DELETE') { removeFile(); writeM(m); return res.end('ok'); }
      if (u.pathname === '/vol' && req.method === 'POST') {
        const v = Number(u.searchParams.get('vol'));
        if (!(v >= 0 && v <= 3)) return fail(400);
        if (Math.abs(v - 1) < 1e-3) delete m.vol[key]; else m.vol[key] = Math.round(v * 100) / 100;
        writeM(m);
        return res.end('ok');
      }
      fail(405);
    });
    // los archivos de public/sfx se sirven acá (sin caché y sin que Vite recargue la página al guardarlos)
    server.middlewares.use('/sfx', (req, res, next) => {
      const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
      if (!/^[a-zA-Z]{2,20}\.[a-z0-9]{2,4}$/.test(name)) return next();
      const f = path.join(SFX_DIR, name);
      if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', MIME[name.split('.').pop()] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(fs.readFileSync(f));
    });
  },
});

// API del juego (server/api.js) dentro de Vite: con `npm run dev` anda todo junto (juego + analíticas + panel).
// Usa la base de compose.dev.yml (docker compose -f compose.dev.yml up -d). Si la base no está, el juego anda igual.
const devApi = () => ({
  name: 'dev-api',
  async configureServer(server) {
    const env = { ADMIN_DEV: '1', ...process.env };
    const url = env.DATABASE_URL || 'postgres://gelatinas:gelatinas_dev@127.0.0.1:5440/gelatinas';
    const { createPool, migrate } = await import('./server/db.js');
    const { createApi } = await import('./server/api.js');
    let pool = createPool(url);
    try { await migrate(pool); } catch (e) {
      console.warn('[dev-api] sin base de datos (' + e.message + '): el juego anda, pero sin analíticas. Levantala con: docker compose -f compose.dev.yml up -d');
      pool.end().catch(() => {}); pool = null;
    }
    // salas en tiempo real: el mismo servidor de producción (server/realtime.js), enganchado al de Vite
    const { createRealtime } = await import('./server/realtime.js');
    const realtime = createRealtime({ env });
    server.httpServer?.on('upgrade', (req, socket, head) => { realtime.upgrade(req, socket, head); });
    server.httpServer?.on('close', () => realtime.close());
    const api = createApi({ pool, env, realtime });
    server.middlewares.use(async (req, res, next) => { if (!(await api(req, res))) next(); });
  },
});

export default defineConfig({
  plugins: [perfLog(), sfxStore(), devApi()],
  // dos páginas: el juego (index.html) y el panel de analíticas (admin.html, sólo en admin.* en producción)
  build: { rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } },
  // abierto a la red de la casa: así se puede probar desde el celular (http://IP-de-la-PC:5173)
  server: { host: true, watch: { ignored: ['**/public/sfx/**'] } },
});
