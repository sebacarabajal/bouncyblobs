// mide cómo llegan las fotos del servidor (binarias): cada cuánto en el reloj local y cuántos pasos avanza el servidor
//   node server/nettest.mjs bouncyblobs.com
import WebSocket from 'ws';
import { decodeSnap, PROTO } from '../src/net/protocol.js';
const host = process.argv[2] || '127.0.0.1:8798';
const url = /\./.test(host) && !host.startsWith('127.') ? `wss://${host}/ws` : `ws://${host}/ws`;
const ws = new WebSocket(url);
const arr = [], steps = [];
let lastT = null, lastS = null, bytes = 0, meta = 0;
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', v: PROTO, mode: 'ffa', look: { name: 'Medidor' } })));
ws.on('message', (raw, isBinary) => {
  bytes += raw.length;
  if (!isBinary) { meta++; return; }
  const d = decodeSnap(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const now = performance.now() / 1000;
  if (lastT != null) { arr.push(now - lastT); steps.push(d.step - lastS); }
  lastT = now; lastS = d.step;
});
setTimeout(() => {
  const st = (a, f = (x) => (x * 1000).toFixed(0) + ' ms') => { const s = [...a].sort((x, y) => x - y); return `p50 ${f(s[s.length >> 1])} · p95 ${f(s[Math.floor(s.length * 0.95)])} · máx ${f(s[s.length - 1])}`; };
  console.log(`fotos: ${arr.length + 1} en 15 s · llegada entre fotos ${st(arr)} · pasos del servidor entre fotos ${st(steps, (x) => x)} · ${(bytes / 15 / 1024).toFixed(1)} KB/s (${meta} mensajes de eventos)`);
  process.exit(0);
}, 15000);
