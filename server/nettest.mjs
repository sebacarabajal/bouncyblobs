// mide cómo llegan las fotos del servidor: cada cuánto (en el reloj local) y cuánto avanza el reloj del servidor
//   node server/nettest.mjs bouncyblobs.com
import WebSocket from 'ws';
const host = process.argv[2] || '127.0.0.1:8798';
const url = /\./.test(host) && !host.startsWith('127.') ? `wss://${host}/ws` : `ws://${host}/ws`;
const ws = new WebSocket(url);
const arr = [], dts = [];
let lastT = null, lastS = null;
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', mode: 'ffa', look: { name: 'Medidor' } })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t !== 's') return;
  const now = performance.now() / 1000;
  if (lastT != null) { arr.push(now - lastT); dts.push(m.time - lastS); }
  lastT = now; lastS = m.time;
});
setTimeout(() => {
  const st = (a) => { const s = [...a].sort((x, y) => x - y); return `prom ${(a.reduce((x, y) => x + y, 0) / a.length * 1000).toFixed(0)} ms · p50 ${(s[s.length >> 1] * 1000).toFixed(0)} · p95 ${(s[Math.floor(s.length * 0.95)] * 1000).toFixed(0)} · máx ${(s[s.length - 1] * 1000).toFixed(0)}`; };
  console.log('llegada entre fotos (reloj local):', st(arr), `· fotos ${arr.length}`);
  console.log('avance del reloj del servidor entre fotos:', st(dts));
  console.log('fotos que llegaron "juntas" (< 15 ms):', arr.filter((x) => x < 0.015).length, '· huecos > 100 ms:', arr.filter((x) => x > 0.1).length);
  process.exit(0);
}, 15000);
