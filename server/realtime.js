// Conexiones en tiempo real (WebSocket en /ws). Las salas corren en otro hilo (game-worker.js): acá sólo se
// reciben y reenvían mensajes. Se usa igual en producción (server/index.js) y en desarrollo (vite.config.js).
import { Worker } from 'node:worker_threads';
import { WebSocketServer } from 'ws';
import { adminUser } from './auth.js';
import { PROTO } from '../src/net/protocol.js';

export function createRealtime({ env }) {
  const worker = new Worker(new URL('./game-worker.js', import.meta.url));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: { threshold: 512 } });
  const socks = new Map(); // cid → ws
  let nextCid = 1;
  let rooms = [];

  worker.on('message', (m) => {
    if (m.type === 'send') { for (const cid of m.cids) { const ws = socks.get(cid); if (ws?.readyState === 1) ws.send(m.data); } }
    else if (m.type === 'sendEach') { for (const [cid, data] of m.list) { const ws = socks.get(cid); if (ws?.readyState === 1) ws.send(data); } }
    else if (m.type === 'bin') { for (const [cid, buf] of m.list) { const ws = socks.get(cid); if (ws?.readyState === 1) ws.send(buf, { binary: true, compress: false }); } }
    else if (m.type === 'rooms') rooms = m.rooms;
  });
  worker.on('error', (e) => console.error('[salas] el hilo de las salas se cayó:', e));

  async function onConnection(ws, req) {
    const cid = nextCid++;
    socks.set(cid, ws);
    const admin = !!(await adminUser(req, env).catch(() => null));
    let n = 0, t0 = Date.now();
    ws.on('message', (raw) => {
      // límite: 150 mensajes por segundo (un navegador manda ~60)
      const now = Date.now();
      if (now - t0 > 1000) { t0 = now; n = 0; }
      if (++n > 150) return;
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join') {
        // página de otra versión (formato de fotos distinto): que se recargue, en vez de mostrar cualquier cosa
        if (m.v !== PROTO) { ws.send(JSON.stringify({ t: 'old' })); ws.close(4000, 'old'); return; }
        m.admin = admin;
      }
      worker.postMessage({ type: 'msg', cid, m });
    });
    ws.on('close', () => { socks.delete(cid); worker.postMessage({ type: 'close', cid }); });
    ws.on('error', () => {});
  }

  return {
    // engancharlo al servidor HTTP: server.on('upgrade', realtime.upgrade)
    upgrade(req, socket, head) {
      if (!String(req.url || '').startsWith('/ws')) return false;
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req));
      return true;
    },
    rooms: () => rooms,
    close: () => { wss.close(); worker.terminate(); },
  };
}
