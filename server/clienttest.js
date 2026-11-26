// Prueba del modo en línea SIN navegador: el código del cliente (src/net/online.js) contra un servidor de verdad.
//   node server/clienttest.js [puerto|bouncyblobs.com] [ffa|teams]
// Variables: DUR=segundos · LAT=ms (retardo simulado en cada sentido, contra un servidor local) · FIGHT=1 (persigue y embiste)
import './shim.js';
const port = process.argv[2] || 8798;
const secure = /\./.test(String(port)) && !String(port).startsWith('127.');
globalThis.location = secure ? { protocol: 'https:', host: port, hostname: port, search: '' } : { protocol: 'http:', host: `127.0.0.1:${port}`, hostname: '127.0.0.1', search: '' };
const THREE = await import('three');
const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
await RAPIER.init();
const { Sim, STEP } = await import('../src/game/sim.js');
const { Online } = await import('../src/net/online.js');
if (process.env.CHAIN) Online.chainMode = Number(process.env.CHAIN);
Online.prototype.debug = !!process.env.FPDEBUG;
const { fx } = await import('../src/fx.js');

const LAT = Number(process.env.LAT || 0);
if (LAT) { // retardo simulado (como desde Argentina a Alemania) contra un servidor local
  const Base = globalThis.WebSocket;
  globalThis.WebSocket = class extends Base {
    send(d) { setTimeout(() => { if (this.readyState === 1) super.send(d); }, LAT); }
    set onmessage(fn) { super.onmessage = (e) => { const data = e.data; setTimeout(() => fn({ data }), LAT); }; }
  };
}
for (const k of ['burst', 'ring', 'popup', 'puddle', 'impact', 'puff', 'clear']) fx[k] = () => {};
const sim = new Sim({ scene: new THREE.Scene(), local: true });
sim.loadArena('steam');
const tmLog = [];
const online = new Online(sim, { slice: () => {}, shake: () => {}, teamEvent: (t, d) => tmLog.push(t === 'count' ? 'c' + d.n : t), roster: () => {}, lost: () => console.log('¡conexión perdida!') });
const mode = process.argv[3] || 'ffa';
// FPDEBUG=1: golpes predichos que el servidor nunca confirmó (¿qué pasó en el servidor con esa pareja?)
const FP = process.env.FPDEBUG ? { lost: [], server: [] } : null;
if (FP) {
  const chk = online._checkPredicted.bind(online);
  online._checkPredicted = function () {
    const limit = this.presentStep - 240;
    for (const p of this.predicted) if (!p.ok && p.step <= limit) FP.lost.push({ att: p.att.netId, vic: p.vic.netId, step: p.step, me: p.att === this.sim.jellies[0] ? 'yo pego' : p.vic === this.sim.jellies[0] ? 'me pegan' : '', h: !!(p.att.human || p.vic.human), src: p.att === this.sim.jellies[0] ? 'yo' : p.src, wu: p.wuAt != null ? p.step - p.wuAt : null, closing: p.closing.toFixed(1) });
    return chk();
  };
  const sh = online._serverHit.bind(online);
  online._serverHit = function (step, e) {
    const before = this.stats.unpredicted;
    const r = sh(step, e);
    FP.server.push({ att: e[2], vic: e[3], step, unpred: this.stats.unpredicted > before, chain: !!e[9], me: e[3] === this.you ? 'me pegan' : e[2] === this.you ? 'yo pego' : '', late: this.presentStep - step });
    return r;
  };
}
let physMs = 0, physN = 0;
const physList = [];
{ const orig = sim.world.step.bind(sim.world); sim.world.step = () => { const t = performance.now(); orig(); const d = performance.now() - t; physMs += d; physN++; physList.push(d); }; }
const DUR = Number(process.env.DUR || 10);
const w = await online.connect({ mode, look: { name: 'Prueba', color: '#00ff88', shape: 'round' } });
console.log(`sala ${w.room.id} (${w.room.mode}) · soy ${w.you} · ${LAT ? `latencia simulada ${LAT * 2} ms` : ''}`);
const me = sim.jellies[0];
if (process.env.CCDOFF) sim.jellies.forEach((j, i) => { if (process.env.CCDOFF === 'all' || i > 0) j.body.enableCcd(false); });
const spikes = { yo: { n: 0, fast: 0, max: 0 }, otros: { n: 0, fast: 0, max: 0 } };
let k = 0, last = performance.now(), acc = 0;
const qlog = [];
const start = performance.now();
await new Promise((resolve) => {
  const iv = setInterval(() => {
    const now = performance.now();
    acc += ((now - last) / 1000) * online.timeScale; last = now;
    const tt = (now - start) / 1000;
    const pc = { mx: Math.sin(tt * 0.7), mz: Math.cos(tt * 0.7), jumpHeld: false, sprint: tt % 4 < 2, jump: k % 90 === 0, dash: k % 150 === 0, throw: null };
    if (process.env.FIGHT) { // pelea: perseguir al más cercano y embestirlo
      let best = null, bd = Infinity;
      for (const o of sim.jellies.slice(1)) { if (o.dead || o.benched) continue; const d = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z); if (d < bd) { bd = d; best = o; } }
      if (best) { pc.mx = (best.pos.x - me.pos.x) / bd; pc.mz = (best.pos.z - me.pos.z) / bd; pc.dash = bd < 6 && k % 40 === 0; pc.jump = false; pc.sprint = bd > 8; }
    }
    while (acc >= STEP) {
      // velocidad con que SE VE moverse cada blob (posición + desplazamiento visual): saltos raros = picos
      const before = sim.jellies.map((j) => [j.pos.x + (j.visOff?.x || 0), j.pos.z + (j.visOff?.z || 0), j.dead]);
      const ts0 = performance.now(); online.step(pc, !!process.env.SKIN); globalThis.__stepMs = (globalThis.__stepMs || 0) + performance.now() - ts0; pc.jump = pc.dash = false; acc -= STEP; k++;
      if (k > 240) {
        sim.jellies.forEach((j, i) => {
          if (j.dead || before[i][2] || j.benched) return;
          const v = Math.hypot(j.pos.x + (j.visOff?.x || 0) - before[i][0], j.pos.z + (j.visOff?.z || 0) - before[i][1]) / STEP;
          const s = spikes[i === 0 ? 'yo' : 'otros'];
          s.n++; s.max = Math.max(s.max, v); if (v > 40) s.fast++;
        });
      }
    }
    online.sendInput();
    if (Math.floor(tt * 2) !== qlog.length) qlog.push(online.stats.queue);
    if (tt > DUR) { clearInterval(iv); resolve(); }
  }, 16);
});
const st = online.stats;
const pct = (a, b) => (b ? Math.round((a / b) * 100) + ' %' : '—');
console.log(`${DUR} s · ping ${(online.rtt * 1000).toFixed(0)} ms · fotos ${st.snaps} (${(st.bytes / DUR / 1024).toFixed(1)} KB/s) · cola del servidor cada 0,5 s: ${qlog.join(' ')}`);
console.log(`corrección de tu blob: prom ${(st.corr / Math.max(1, st.corrN)).toFixed(2)} m · máx ${st.corrMax.toFixed(2)} m · saltos bruscos ${st.hard} de ${st.corrN} · de los demás: prom ${(st.corrO / Math.max(1, st.corrON)).toFixed(3)} m`);
console.log(`correcciones visibles (> 0,5 m): tu blob ${st.big} de ${st.corrN} · los demás ${st.bigO} de ${st.corrON} (${(st.bigO / Math.max(1, st.corrON) * 100).toFixed(2)} %)`);
console.log(`decisiones de bots: a tiempo ${st.planOk} · tarde ${st.planLate} · ibas adelantado ${st.lead} pasos (${Math.round(st.lead * STEP * 1000)} ms)`);
console.log(`golpes: el servidor contó ${st.serverHits} · ya los habías visto (predichos) ${st.confirmed} (${pct(st.confirmed, st.serverHits)}) · te pegaron ${st.meHitServer}, viste venir ${st.meHitServer - st.meHitUnpred} (${pct(st.meHitServer - st.meHitUnpred, st.meHitServer)}) · predichos que el servidor no contó ${st.predicted - st.confirmed}`);
console.log(`velocidad en pantalla (picos > 40 m/s): yo ${spikes.yo.fast}/${spikes.yo.n} (máx ${Math.round(spikes.yo.max)}) · otros ${spikes.otros.fast}/${spikes.otros.n} (máx ${Math.round(spikes.otros.max)})`);
if (mode === 'teams') console.log('equipos (eventos):', tmLog.join(' '), '· mi equipo', me.team, '· estado', JSON.stringify(online.tm && { phase: online.tm.phase, round: online.tm.round, wins: online.tm.wins }));
console.log(`costo por paso en este proceso: ${((globalThis.__stepMs || 0) / Math.max(1, k) * 1000).toFixed(0)} µs (${k} pasos)`);
{ const L = [...physList].sort((a, b) => a - b); console.log(`física: mediana ${(L[L.length >> 1] * 1000).toFixed(0)} µs · p95 ${(L[Math.floor(L.length * 0.95)] * 1000).toFixed(0)} · p99 ${(L[Math.floor(L.length * 0.99)] * 1000).toFixed(0)} · máx ${(L[L.length - 1] * 1000).toFixed(0)}`); }
{ let pairs = 0, deep = 0; for (const j of sim.jellies) { if (j.dead) continue; sim.world.contactPairsWith(j.collider, () => { pairs++; }); if (j.pos.y < j.r - 0.15) deep++; } console.log(`contactos de los blobs ahora: ${pairs} · hundidos en el piso: ${deep} · y: ${sim.jellies.filter((j) => !j.dead).map((j) => j.pos.y.toFixed(2)).join(' ')}`); }
console.log(`física del navegador: ${(physMs / Math.max(1, physN) * 1000).toFixed(0)} µs por paso · cuerpos ${sim.world.bodies.len()} · colliders ${sim.world.colliders.len()} · dormidos ${(() => { let z = 0; sim.world.bodies.forEach((b) => { if (b.isSleeping()) z++; }); return z; })()}`);
if (FP) {
  const bl = st.bigList || [];
  const c = (f) => bl.filter(f).length;
  console.log(`  correcciones grandes de tu blob: ${bl.length} · te habían pegado hace < 0,5 s: ${c((x) => x.hitMe >= -10 && x.hitMe < 60)} · mareado ${c((x) => x.daze)} · aceite ${c((x) => x.oil)} · aturdido ${c((x) => x.stun)} · tocando a otro (< 0,3 m): ${c((x) => x.near < 0.3)} · sin nada de eso: ${c((x) => !(x.hitMe >= -10 && x.hitMe < 60) && !x.daze && !x.oil && !x.stun && x.near >= 0.3)}`);
  const un = FP.server.filter((s) => s.unpred);
  console.log(`  golpes del servidor sin predecir: ${un.length} (carambolas ${un.filter((s) => s.chain).length}) · ${un.map((s) => `${s.att}→${s.vic}${s.chain ? ' carambola' : ''}${s.me ? ' ' + s.me : ''}`).join(' | ')}`);
  for (const p of FP.lost) {
    const near = FP.server.filter((s) => (s.att === p.att && s.vic === p.vic) || (s.att === p.vic && s.vic === p.att)).map((s) => `${s.att === p.att ? '' : 'al revés '}${s.step - p.step > 0 ? '+' : ''}${s.step - p.step}`).filter((x) => Math.abs(parseInt(x.replace('al revés ', ''))) < 400);
    console.log(`  predicho ${p.att}→${p.vic} paso ${p.step} ${p.me} ${p.h ? '(persona)' : ''} [embestida por ${p.src}, cargó hace ${p.wu} pasos, choque ${p.closing}] · servidor con esa pareja: ${near.join(', ') || 'nada'}`);
  }
}
online.leave();
process.exit(0);
