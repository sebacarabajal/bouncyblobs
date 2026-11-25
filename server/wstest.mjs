// prueba: dos jugadores falsos entran a una sala y mandan teclas (node server/wstest.mjs [puerto])
import WebSocket from 'ws';
const port = process.argv[2] || 8798;
function bot(name, mode) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const st = { name, snaps: 0, bytes: 0, ev: 0, welcome: null, last: null, kinds: {} };
    let seq = 0;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', mode, look: { name, color: '#22ccff', shape: 'tall' } })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') { st.welcome = m; setInterval(() => ws.send(JSON.stringify({ t: 'in', s: ++seq, mx: Math.sin(seq / 30), mz: Math.cos(seq / 30), jh: false, sp: true, d: seq % 120 === 0 })), 16); }
      if (m.t === 's') { st.snaps++; st.bytes += raw.length; st.ev += m.ev.length; st.last = m; for (const e of m.ev) st.kinds[e[1] + (e[1] === 'f' || e[1] === 'a' ? ':' + e[2] : '')] = (st.kinds[e[1] + (e[1] === 'f' || e[1] === 'a' ? ':' + e[2] : '')] || 0) + 1; }
    });
    setTimeout(() => { ws.close(); resolve(st); }, 6000);
  });
}
const [a, b] = await Promise.all([bot('Ana', 'ffa'), bot('Beto', 'ffa')]);
for (const s of [a, b]) {
  const me = s.last.b.find((x) => x[0] === s.welcome.you);
  console.log(`${s.name}: sala ${s.welcome.room.id} · soy el blob ${s.welcome.you} · fotos ${s.snaps} en 6 s · ${(s.bytes / 6 / 1024).toFixed(1)} KB/s · eventos ${s.ev} · ack ${s.last.ack} · mi pos ${me.slice(1, 4)} · humanos en roster: ${s.welcome.roster.filter((r) => r.human).map((r) => r.name).join(',')}`);
}
console.log('tipos de eventos (Ana):', JSON.stringify(a.kinds));
const r = await fetch(`http://127.0.0.1:${port}/api/admin/rooms`).then((x) => x.json());
console.log('panel de salas:', JSON.stringify(r.rooms.map((x) => ({ id: x.id, mode: x.mode, humans: x.humans, bots: x.bots, players: x.players.map((p) => p.name) }))));
process.exit(0);
