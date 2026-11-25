// Prueba rápida de la partida sin pantalla (lo que corre el servidor): node server/selftest.js
import './shim.js';
const THREE = await import('three');
const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
await RAPIER.init();
const { Sim, STEP } = await import('../src/game/sim.js');
const { fx } = await import('../src/fx.js');
// en el servidor fx se graba: acá sólo contamos
const counts = {};
for (const k of ['burst', 'ring', 'popup', 'puddle', 'impact', 'puff', 'clear']) fx[k] = () => { counts[k] = (counts[k] || 0) + 1; };
let kos = 0, events = {};
const t0 = performance.now();
const sim = new Sim({ scene: new THREE.Scene(), hooks: { ko: () => kos++, event: (n) => { events[n] = (events[n] || 0) + 1; }, teamEvent: (t) => { events['tm:' + t] = (events['tm:' + t] || 0) + 1; } } });
sim.loadArena('steam');
const tBuild = performance.now() - t0;
let t1 = performance.now();
const N = 120 * 60;
for (let i = 0; i < N; i++) sim.step(() => null, { doSkin: false });
const ms = performance.now() - t1;
console.log(`arma la sala en ${tBuild.toFixed(0)} ms · 60 s de partida en ${ms.toFixed(0)} ms (${(ms / 60 / 120 * 1000).toFixed(0)} µs por paso → ${(ms / 60 / 10).toFixed(1)} % de un núcleo)`);
console.log('vivos:', sim.jellies.filter((j) => !j.dead && !j.benched).length, '| KOs:', kos, '| bolitas:', sim.pickups.list.length, '| eventos:', JSON.stringify(events), '| fx:', JSON.stringify(counts));
console.log('masas:', sim.jellies.map((j) => j.mass.toFixed(1)).join(' '));
// equipos
sim.mode = 'teams'; sim.resetMatch();
for (let i = 0; i < 120 * 90; i++) sim.step(() => null, { doSkin: false });
console.log('equipos tras 90 s →', JSON.stringify(sim.teams.state()), '| eventos:', JSON.stringify(events));
