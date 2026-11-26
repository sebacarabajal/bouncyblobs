// Prueba del modo en línea SIN navegador: el código del cliente (src/net/online.js) contra un servidor de verdad.
//   node server/clienttest.js [puerto|bouncyblobs.com] [ffa|teams]
// Variables: DUR=segundos · LAT=ms (retardo simulado en cada sentido, contra un servidor local) · FIGHT=1 (persigue y embiste)
//   JIT=ms (variación al azar de cada mensaje, promedio) · SPK=probabilidad por mensaje de un trabón · SPKMS=ms del trabón
//   (como en TCP: los mensajes nunca se adelantan entre sí; un trabón demora también a los que vienen atrás)
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
if (process.env.TUNE) Object.assign(Online.tune, JSON.parse(process.env.TUNE));
Online.prototype.debug = !!process.env.FPDEBUG;
const { fx } = await import('../src/fx.js');

const LAT = Number(process.env.LAT || 0), JIT = Number(process.env.JIT || 0), SPK = Number(process.env.SPK || 0), SPKMS = Number(process.env.SPKMS || 80);
if (LAT || JIT || SPK) { // retardo simulado (como desde Argentina a Alemania) contra un servidor local
  const Base = globalThis.WebSocket;
  const delay = (prev) => {
    let d = LAT + (JIT ? -JIT * Math.log(1 - Math.random()) : 0) + (Math.random() < SPK ? SPKMS * (0.5 + Math.random() * 0.5) : 0);
    return Math.max(performance.now() + d, prev); // en orden, como TCP
  };
  let upT = 0, downT = 0;
  globalThis.WebSocket = class extends Base {
    send(d) { upT = delay(upT); setTimeout(() => { if (this.readyState === 1) super.send(d); }, upT - performance.now()); }
    set onmessage(fn) { super.onmessage = (e) => { const data = e.data; downT = delay(downT); setTimeout(() => fn({ data }), downT - performance.now()); }; }
  };
}
for (const k of ['burst', 'ring', 'popup', 'puddle', 'impact', 'puff', 'clear']) fx[k] = () => {};
const sim = new Sim({ scene: new THREE.Scene(), local: true });
sim.loadArena('steam');
const tmLog = [];
const online = new Online(sim, { slice: () => {}, shake: () => {}, teamEvent: (t, d) => tmLog.push(t === 'count' ? 'c' + d.n : t), roster: () => {}, lost: () => console.log('¡conexión perdida!') });
const mode = process.argv[3] || 'ffa';
// FPDEBUG=1: golpes predichos que el servidor nunca confirmó (¿qué pasó en el servidor con esa pareja?)
const FP = process.env.FPDEBUG ? { lost: [], server: [], ok: [] } : null;
if (FP) {
  const chk = online._checkPredicted.bind(online);
  online._checkPredicted = function () {
    const limit = this.presentStep - 240;
    for (const p of this.predicted) if (!p.ok && p.step <= limit) FP.lost.push({ att: p.att.netId, vic: p.vic.netId, step: p.step, me: p.att === this.sim.jellies[0] ? 'yo pego' : p.vic === this.sim.jellies[0] ? 'me pegan' : '', h: !!(p.att.human || p.vic.human), src: p.att === this.sim.jellies[0] ? 'yo' : p.src, wu: p.wuAt != null ? p.step - p.wuAt : null, closing: p.closing.toFixed(1), gap: p.gap, claim: !!p.claim });
    for (const p of this.predicted) if (p.ok && !p._seen) { p._seen = true; FP.ok.push({ gap: p.gap, closing: p.closing, src: p.src }); }
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
console.log(`sala ${w.room.id} (${w.room.mode}) · soy ${w.you} · ${LAT ? `latencia simulada ${LAT * 2} ms` : ''}${JIT || SPK ? ` · variación ${JIT} ms · trabones ${SPK} de ${SPKMS} ms` : ''}`);
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
      for (const o of sim.jellies.slice(1)) { if (o.dead || o.benched || (me.team != null && o.team === me.team)) continue; /* (a los compañeros no) */ const d = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z); if (d < bd) { bd = d; best = o; } }
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
console.log(`decisiones de bots: a tiempo ${st.planOk} · tarde ${st.planLate} (con botones aplicados igual: ${st.planLateFired}) · ibas adelantado ${st.lead} pasos (${Math.round(st.lead * STEP * 1000)} ms)`);
console.log(`tus golpes a bots avisados al servidor: ${st.claims} · confirmados ${st.claimsOk} · golpes fantasma (predichos que no fueron): ${st.lost} · correcciones deslizándose a más de 8 m/s (pasos): tu blob ${st.jumpMe} · los demás ${st.jumpOt} · teletransportes: tu blob ${st.tpMe} · los demás ${st.tpOt}`);
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
  {
    const L = st.bigOList || [], c = (f) => L.filter(f).length;
    console.log(`  correcciones grandes de los demás: ${L.length} · golpe predicho < 0,5 s: ${c((x) => x.hit)} · golpe del servidor < 0,5 s: ${c((x) => x.srvHit)} · embistiendo/cargando: ${c((x) => x.dash)} (de foto ${c((x) => x.dash && x.src === 'foto')}, tarde ${c((x) => x.dash && x.src === 'tarde')}) · aturdido ${c((x) => x.stun)} · aceite ${c((x) => x.oil)} · mareado ${c((x) => x.daze)} · en el aire ${c((x) => x.air)} · tocando a otro ${c((x) => x.near < 0.3)} · sobre todo vertical ${c((x) => x.dy > 0.5 * x.err)} · sin nada de eso: ${c((x) => !x.hit && !x.srvHit && !x.dash && !x.stun && !x.oil && !x.daze && !x.air && x.near >= 0.3)}`);
    const ok = FP.ok, by = (k) => ok.filter((x) => x.src === k).length;
    console.log(`  golpes predichos confirmados por tipo: plan ${by('plan')} · tarde ${by('tarde')} · foto ${by('foto')} · yo ${by('yo')} · carambola ${by('carambola')} · otros ${ok.length - by('plan') - by('tarde') - by('foto') - by('yo') - by('carambola')}`);
  }
  {
    const L = st.kList || [], med = (a) => { const s2 = [...a].sort((x, y) => x - y); return s2.length ? s2[s2.length >> 1] : 0; };
    const ab = L.map((x) => Math.abs(x.dK)), rel = L.map((x) => Math.abs(x.dK) / Math.max(1, x.K)), ang = L.map((x) => (x.ang * 180) / Math.PI), ds = L.map((x) => Math.abs(x.dStep));
    console.log(`  fuerza predicha vs servidor (${L.length} golpes): error mediano ${med(ab).toFixed(1)} (${(med(rel) * 100).toFixed(0)} %) · > 20 %: ${rel.filter((x) => x > 0.2).length} · predicha menor: ${L.filter((x) => x.dK < -0.5).length} · mayor: ${L.filter((x) => x.dK > 0.5).length} · ángulo mediano ${med(ang).toFixed(1)}° (> 10°: ${ang.filter((x) => x > 10).length}) · paso distinto: ${ds.filter((x) => x > 0).length} (mediana ${med(ds)})`);
  }
  { const L = st.tpList || [], c = (f) => L.filter(f).length; console.log(`  teletransportes: ${L.length} · sin historia ${c((x) => x.why === 'hist')} · error > 6 m ${c((x) => x.why === 'err')} · otro ${c((x) => !x.why)} · con golpe predicho reciente ${c((x) => x.split)} (confirmado ${c((x) => x.split && x.ok)}) · clavado ${c((x) => x.imp)} · distancia mediana ${(L.map((x) => x.d).sort((a, b) => a - b)[L.length >> 1] || 0).toFixed(1)} m`); }
  console.log(`  embestidas de otros: acá empezaron y allá no (se cancelaron): cargas ${st.wuCancel || 0} · embestidas ${st.dashCancel || 0} · allá sí y acá no (arrancadas por la foto): cargas ${st.wuFoto || 0} · embestidas ${st.dashFoto || 0}`);
  if (process.env.BIGME) for (const x of (st.bigList || []).filter((x) => !(x.hitMe >= -10 && x.hitMe < 60) && !x.daze && !x.stun).slice(0, 14)) console.log('   tu corrección grande:', JSON.stringify(x));
  for (const x of st.meUnpList || []) console.log('   te pegaron sin verlo venir:', JSON.stringify(x));
  const un = FP.server.filter((s) => s.unpred);
  console.log(`  golpes del servidor sin predecir: ${un.length} (carambolas ${un.filter((s) => s.chain).length}) · ${un.map((s) => `${s.att}→${s.vic}${s.chain ? ' carambola' : ''}${s.me ? ' ' + s.me : ''}`).join(' | ')}`);
  for (const p of FP.lost) {
    const near = FP.server.filter((s) => (s.att === p.att && s.vic === p.vic) || (s.att === p.vic && s.vic === p.att)).map((s) => `${s.att === p.att ? '' : 'al revés '}${s.step - p.step > 0 ? '+' : ''}${s.step - p.step}`).filter((x) => Math.abs(parseInt(x.replace('al revés ', ''))) < 400);
    console.log(`  predicho ${p.att}→${p.vic} paso ${p.step} ${p.me} ${p.h ? '(persona)' : ''} [embestida por ${p.src}, cargó hace ${p.wu} pasos, choque ${p.closing}, separación ${p.gap?.toFixed(2)}${p.claim ? ', avisado' : ''}] · servidor con esa pareja: ${near.join(', ') || 'nada'}`);
  }
  const hist = (arr) => { const b = [-0.3, -0.1, 0, 0.1, 0.2, 0.3]; return b.map((x, i) => `≤${b[i + 1] ?? '∞'}: ${arr.filter((g) => g > (i ? x : -9) && (b[i + 1] == null || g <= b[i + 1])).length}`).join(' '); };
  console.log(`  separación al predecir (m) · confirmados: ${hist(FP.ok.map((x) => x.gap))} · fantasma: ${hist(FP.lost.map((x) => x.gap))}`);
}
if (process.env.AUDIT) console.log('registro (lo que manda el juego cada minuto):', JSON.stringify(online.auditReport()));
online.leave();
process.exit(0);
