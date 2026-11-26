// Prueba del modo en línea SIN navegador: el código del cliente (src/net/online.js) contra el servidor real.
//   node server/clienttest.js [puerto]
import './shim.js';
const port = process.argv[2] || 8798;
const secure = /\./.test(String(port)); // un dominio (ej. bouncyblobs.com) → wss:// por el puerto 443
globalThis.location = secure ? { protocol: 'https:', host: port, hostname: port, search: '' } : { protocol: 'http:', host: `127.0.0.1:${port}`, hostname: '127.0.0.1', search: '' };
const THREE = await import('three');
const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
await RAPIER.init();
const { Sim, STEP } = await import('../src/game/sim.js');
const { Online } = await import('../src/net/online.js');
// LAT=80 → simula 80 ms de ida y 80 de vuelta (como desde Argentina a Alemania) contra un servidor local
const LAT = Number(process.env.LAT || 0);
if (LAT) {
  const Base = globalThis.WebSocket;
  globalThis.WebSocket = class extends Base {
    send(d) { setTimeout(() => { if (this.readyState === 1) super.send(d); }, LAT); }
    set onmessage(fn) { super.onmessage = (e) => setTimeout(() => fn({ data: e.data }), LAT); }
  };
}
const { fx } = await import('../src/fx.js');
const played = {};
for (const k of ['burst', 'ring', 'popup', 'puddle', 'impact', 'puff', 'clear']) fx[k] = () => { played['fx:' + k] = (played['fx:' + k] || 0) + 1; };
const sim = new Sim({ scene: new THREE.Scene(), local: true });
sim.loadArena('steam');
let slices = 0, shakes = 0, tmEv = 0;
const DUR = Number(process.env.DUR || 8);
const online = new Online(sim, { slice: () => slices++, shake: () => shakes++, teamEvent: () => tmEv++, roster: () => {}, lost: () => console.log('¡conexión perdida!') });
const mode = process.argv[3] || 'ffa';
const w = await online.connect({ mode, look: { name: 'Prueba', color: '#00ff88', shape: 'round' } });
console.log(`entré: sala ${w.room.id} (${w.room.mode}) · soy ${w.you} · humanos: ${w.roster.filter((r) => r.human).map((r) => r.name).join(', ')}`);
const me = sim.jellies[0];
if (process.env.NOPRED) online.predictHits = false;
if (process.env.BODY) online.bodyMode = process.env.BODY;
const spikes = {};
let k = 0, errMax = 0, errSum = 0, errN = 0, last = performance.now(), acc = 0;
const start = performance.now();
await new Promise((resolve) => {
  const iv = setInterval(() => {
    const now = performance.now();
    acc += (now - last) / 1000; last = now;
    const tt = (now - start) / 1000;
    const pc = { mx: Math.sin(tt * 0.7), mz: Math.cos(tt * 0.7), jumpHeld: false, sprint: tt % 4 < 2, jump: k % 90 === 0, dash: k % 150 === 0, throw: null };
    if (process.env.FIGHT) { // pelea: perseguir al más cercano y embestirlo
      let best = null, bd = Infinity;
      for (const o of sim.jellies.slice(1)) { if (o.dead || o.benched) continue; const d = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z); if (d < bd) { bd = d; best = o; } }
      if (best) { pc.mx = (best.pos.x - me.pos.x) / bd; pc.mz = (best.pos.z - me.pos.z) / bd; pc.dash = bd < 6 && k % 40 === 0; pc.jump = false; pc.sprint = bd > 8; }
    }
    while (acc >= STEP) {
      // velocidad con que SE VE moverse cada blob (lo que nota el jugador): saltos raros = picos
      const before = sim.jellies.map((j) => [j.pos.x + (j.visOff?.x || 0), j.pos.z + (j.visOff?.z || 0), j.dead]);
      online.step(pc, false); pc.jump = pc.dash = false; acc -= STEP; k++;
      sim.jellies.forEach((j, i) => {
        if (j.dead || before[i][2]) return;
        const v = Math.hypot(j.pos.x + (j.visOff?.x || 0) - before[i][0], j.pos.z + (j.visOff?.z || 0) - before[i][1]) / STEP;
        if (k < 240) return;
        const key = i === 0 ? 'yo' : 'otros';
        if (v > 60 && i > 0 && k > 240 && (globalThis.__dbg = (globalThis.__dbg || 0) + 1) <= 6) { const [s0, s1, kk] = online._bracket(online.rt); console.log(`pico blob ${i} (id ${j.netId}) imp=${j.impaled} stun=${j.stun.toFixed(2)}: ${v.toFixed(0)} m/s · de (${before[i][0].toFixed(1)},${before[i][1].toFixed(1)}) a (${j.pos.x.toFixed(1)},${j.pos.z.toFixed(1)}) · rt ${online.rt.toFixed(3)} · s0 ${s0?.time} s1 ${s1?.time} k ${kk.toFixed(2)} · s0 tiene al blob: ${!!s0?.b.get(j.netId)} · s1: ${!!s1?.b.get(j.netId)}`); }
        spikes[key] ||= { n: 0, fast: 0, max: 0 }; spikes[key].n++; spikes[key].max = Math.max(spikes[key].max, v); if (v > 40) spikes[key].fast++;
      });
    }
    online.sendInput();
    // error de predicción: tu blob vs lo que dice la última foto del servidor
    const s = online.snaps[online.snaps.length - 1];
    const a = s?.b.get(online.you);
    if (a && !me.dead && tt > 1) { const e = Math.hypot(a[1] - me.pos.x, a[3] - me.pos.z); errMax = Math.max(errMax, e); errSum += e; errN++; }
    if (tt > DUR) { clearInterval(iv); resolve(); }
  }, 16);
});
const others = sim.jellies.filter((j, i) => i > 0 && !j.dead && !j.benched);
console.log(`8 s: pasos ${k} · fotos ${online.snaps.length} en el búfer · ping ${(online.rtt * 1000).toFixed(0)} ms`);
console.log(`mi blob en (${me.pos.x.toFixed(1)}, ${me.pos.z.toFixed(1)}) · distancia con el servidor: prom ${(errSum / Math.max(1, errN)).toFixed(2)} m, máx ${errMax.toFixed(2)} m (incluye los 100 ms de diferencia de cada foto)`);
console.log(`los demás: ${others.length} vivos · se movieron: ${others.filter((j) => j.pos.distanceTo(j.prevPos) > 0 || j.pos.length() > 0).length} · equipos: ${JSON.stringify(online.tm)}`);
console.log(`eventos reproducidos: ${JSON.stringify(played)} · cortes ${slices} · temblores ${shakes} · equipos ${tmEv} · bolitas ${sim.pickups.list.length} · pendientes ${online.events.length}`);
console.log('cola del servidor [largo, repetidas, descartadas]:', JSON.stringify(online._lastDbg));
console.log("debug: último ack", online.snaps.at(-1)?.ack, "historia", online.history.length, online.history.at(0)?.seq, online.history.at(-1)?.seq, "stepSeq", online.stepSeq, "me.dead", me.dead);
const es = online.errStats || { n: 0, sum: 0, max: 0, snaps: 0 };
console.log(`corrección del servidor (misma tecla): prom ${(es.sum / Math.max(1, es.n)).toFixed(2)} m · máx ${es.max.toFixed(2)} m · saltos bruscos ${es.snaps} de ${es.n}`);
console.log('velocidad en pantalla (picos > 40 m/s, más que una embestida):', JSON.stringify(Object.fromEntries(Object.entries(spikes).map(([k, v]) => [k, { pasos: v.n, rapidos: v.fast, max: Math.round(v.max) }]))));
online.leave();
process.exit(0);
