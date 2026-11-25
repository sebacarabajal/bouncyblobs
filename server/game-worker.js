// Hilo de las SALAS: cada sala es una partida de verdad (src/game/sim.js) corriendo 120 veces por segundo.
// El hilo principal (server/realtime.js) maneja los WebSockets y le pasa los mensajes; acá se decide en qué
// sala entra cada uno, se reemplazan bots por personas, se simula y se mandan las fotos (20 por segundo).
import './shim.js';
import { parentPort } from 'node:worker_threads';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, STEP } from '../src/game/sim.js';
import { fx } from '../src/fx.js';
import { sfx } from '../src/sfx.js';
import { encodeBlob, encArg, SNAP_HZ } from '../src/net/protocol.js';

await RAPIER.init();

const EMPTY_TTL = 60; // segundos que una sala sin personas sigue viva (por si vuelve alguien)
const MAX_TATTOO = 200000; // tamaño máximo del dibujo (data URL)
const ARENA = 'steam';

// ---------------------------------------------------------------- efectos y sonidos → eventos para mandar
// fx y sfx son únicos para todo el hilo: se graban en la sala que se está simulando en ese momento.
let cur = null;
for (const k of ['burst', 'ring', 'popup', 'puddle', 'impact', 'puff']) fx[k] = (...a) => cur?.fx(k, a);
fx.clear = () => {}; fx.update = () => {};
for (const k of Object.keys(sfx)) if (typeof sfx[k] === 'function') sfx[k] = (...a) => cur?.sound(k, a);

let nextRoomId = 1;
const rooms = new Map(); // id → Room
const clients = new Map(); // cid → { room, j, input, edges, ack, admin }

const post = (m) => parentPort.postMessage(m);

class Room {
  constructor(mode) {
    this.id = String(nextRoomId++);
    this.mode = mode;
    this.created = Date.now();
    this.events = [];
    this.who = null;
    this.muted = false;
    this.members = new Set(); // cids
    this.emptyFor = 0;
    this.acc = 0;
    this.snapAcc = 0;
    const room = this;
    const ev = (...e) => this.events.push([+this.sim.time.toFixed(3), ...e]);
    this.ev = ev;
    cur = this;
    this.sim = new Sim({
      scene: new THREE.Scene(),
      hooks: {
        shake: (a) => ev('sh', encArg(a)),
        slice: (j, n, along) => ev('sl', j.id, encArg(n), encArg(along)),
        impale: (j, c, inward, t) => ev('im', j.id, encArg(c), encArg(inward), encArg(t)),
        dent: (j, dir, s, spread) => ev('dn', j.id, encArg(dir), encArg(s), encArg(spread)),
        teamEvent: (type, d) => ev('tm', type, d),
        ko: (killer, victim, pts) => ev('ko', killer.id, victim.id, pts),
        who: (j) => { room.who = j; },
        mute: (m) => { room.muted = m; },
      },
    });
    const sim = this.sim;
    sim.mode = mode;
    sim.pickups.onSpawn = (p) => ev('p+', p.id, ...[p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, p.vel.x, p.vel.y, p.vel.z].map(encArg), p.power);
    sim.pickups.onEaten = (p, j) => ev('p-', p.id, j.id);
    sim.oil.onSpawn = (x, z, owner) => ev('o', encArg(x), encArg(z), owner?.id ?? -1);
    sim.shots.onSpawn = (kind, owner, pos, vel) => ev('s', kind, owner.id, encArg(pos), encArg(vel));
    sim.loadArena(ARENA);
    this.events = []; // lo de armar la sala no se manda
    cur = null;
  }

  get capacity() { return this.sim.arena.players ?? 16; }
  get humans() { return this.sim.jellies.filter((j) => j.human).length; }

  fx(k, a) {
    if (this.muted || this.who) return; // brillos de bolitas y estelas de cada blob: los arma cada navegador
    this.ev('f', k, ...a.map(encArg));
  }

  sound(k, a) {
    if (this.muted && k !== 'gulp' && k !== 'power' && k !== 'use') return;
    this.ev('a', k, this.who ? this.who.id : -1, ...a.map(encArg));
  }

  // el lugar para un humano nuevo: un bot muerto si hay (no hace falta sacar a nadie); si no, uno vivo al azar
  freeSlot() {
    const playing = this.sim.jellies.filter((j) => !j.benched && !j.human);
    if (!playing.length) return null;
    const dead = playing.filter((j) => j.dead);
    const list = dead.length ? dead : playing;
    return list[Math.floor(Math.random() * list.length)];
  }

  roster() {
    return this.sim.jellies.map((j) => ({ id: j.id, name: j.name, color: j.look.color, shape: j.look.shape, brow: j.look.brow, tattoo: j.look.tattoo || null, human: !!j.human, out: !!j.benched }));
  }

  summary() {
    const js = this.sim.jellies.filter((j) => !j.benched);
    return {
      id: this.id, mode: this.mode, arena: ARENA, capacity: this.capacity, humans: js.filter((j) => j.human).length, bots: js.filter((j) => !j.human).length,
      alive: js.filter((j) => !j.dead).length, created: this.created, team: this.sim.teams.active ? this.sim.teams.state() : null,
      players: js.filter((j) => j.human).map((j) => ({ name: j.name, score: Math.floor(j.score), kos: j.kos, team: j.team ?? null })),
    };
  }

  join(cid, look, admin) {
    const j = this.freeSlot();
    if (!j) return false;
    cur = this;
    this.sim.takeSlot(j, look);
    cur = null;
    j.cid = cid;
    this.members.add(cid);
    clients.set(cid, { room: this, j, queue: [], last: { mx: 0, mz: 0, jumpHeld: false, sprint: false }, ack: 0, admin });
    const s = this.sim;
    send(cid, { t: 'welcome', you: j.id, room: { id: this.id, mode: this.mode, arena: ARENA }, roster: this.roster(), pickups: s.pickups.snapshotList(), time: s.time, tm: s.teams.active ? s.teams.state() : null, ar: s.arena.getState?.() });
    this.broadcast({ t: 'roster', list: this.roster() }, cid);
    return true;
  }

  leave(cid) {
    const c = clients.get(cid);
    if (!c) return;
    clients.delete(cid);
    this.members.delete(cid);
    cur = this;
    c.j.cid = null;
    this.sim.releaseSlot(c.j);
    cur = null;
    this.broadcast({ t: 'roster', list: this.roster() });
  }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    const out = [];
    for (const cid of this.members) if (cid !== except) out.push(cid);
    if (out.length) post({ type: 'send', cids: out, data });
  }

  cmdFor(j) {
    if (!j.human || j.cid == null) return null;
    const c = clients.get(j.cid);
    if (!c) return null;
    // una tecla por paso, en el mismo orden en que las aplicó el navegador (así su predicción coincide).
    // Si se juntan muchas (la red se trabó un momento), se saltean las viejas para no quedar atrasado.
    const q = c.queue;
    let jump = false, dash = false, thr = null;
    while (q.length > 12) { const d = q.shift(); jump ||= d.jump; dash ||= d.dash; thr = d.throw || thr; c.ack = d.s; c.drops = (c.drops || 0) + 1; }
    const it = q.shift();
    if (!it) { c.reps = (c.reps || 0) + 1; return { ...c.last, jump: false, dash: false, throw: null }; } // no llegó nada: sigue con la última
    c.ack = it.s;
    c.last = { mx: it.mx, mz: it.mz, jumpHeld: it.jumpHeld, sprint: it.sprint };
    return { ...c.last, jump: it.jump || jump, dash: it.dash || dash, throw: it.throw || thr };
  }

  tick(dt) {
    cur = this;
    this.acc = Math.min(this.acc + dt, 0.25); // si el servidor se atrasa, no intenta "alcanzar" más de 1/4 s
    const cmdFor = (j) => this.cmdFor(j);
    while (this.acc >= STEP) { this.sim.step(cmdFor, { doSkin: false }); this.acc -= STEP; }
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAP_HZ) { this.snapAcc = 0; this.snapshot(); }
    cur = null;
    this.emptyFor = this.members.size ? 0 : this.emptyFor + dt;
  }

  snapshot() {
    if (!this.members.size) { this.events.length = 0; return; }
    const s = this.sim;
    const b = s.jellies.filter((j) => !j.benched).map(encodeBlob);
    const common = JSON.stringify({ time: +s.time.toFixed(3), b, tm: s.teams.active ? s.teams.state() : null, ar: s.arena.getState?.(), ev: this.events });
    this.events = [];
    const list = [];
    for (const cid of this.members) {
      const c = clients.get(cid);
      list.push([cid, `{"t":"s","ack":${c ? c.ack : 0},"dbg":[${c ? c.queue.length : 0},${c?.reps || 0},${c?.drops || 0}],${common.slice(1)}`]);
    }
    post({ type: 'sendEach', list });
  }

  dispose() {
    for (const cid of this.members) this.leave(cid);
    this.sim.arena?.dispose();
    this.sim.world.free();
    rooms.delete(this.id);
  }
}

function send(cid, msg) { post({ type: 'send', cids: [cid], data: JSON.stringify(msg) }); }

// ---------------------------------------------------------------- en qué sala entra cada uno
// la sala del modo con MÁS personas que todavía tenga lugar (así se juntan); si no hay, se abre otra
function pickRoom(mode) {
  let best = null;
  for (const r of rooms.values()) {
    if (r.mode !== mode || r.humans >= r.capacity) continue;
    if (!best || r.humans > best.humans) best = r;
  }
  if (best) return best;
  const r = new Room(mode);
  rooms.set(r.id, r);
  return r;
}

function cleanLook(l = {}) {
  const hex = /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#ff4fa3';
  const shape = ['round', 'tall', 'drop', 'box', 'bean'].includes(l.shape) ? l.shape : 'round';
  const tattoo = typeof l.tattoo === 'string' && l.tattoo.startsWith('data:image/png;base64,') && l.tattoo.length < MAX_TATTOO ? l.tattoo : null;
  const name = String(l.name || 'Blob').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Blob';
  return { name, color: hex, shape, brow: Number.isFinite(l.brow) ? Math.max(-0.5, Math.min(0.8, l.brow)) : 0.3, tattoo };
}

function onMessage(cid, m) {
  const c = clients.get(cid);
  if (m.t === 'in' && c && Array.isArray(m.l)) {
    // l: [[paso, mx, mz, flags], …] · flags: 1 saltar (mantener) · 2 correr · 4 saltó · 8 embistió · 16 aceite · 32 chorro
    for (const it of m.l.slice(0, 30)) {
      if (!Array.isArray(it) || !Number.isFinite(it[0]) || it[0] <= (c.queue.length ? c.queue[c.queue.length - 1].s : c.ack)) continue;
      const mx = Number(it[1]) || 0, mz = Number(it[2]) || 0, l = Math.hypot(mx, mz), f = it[3] | 0;
      c.queue.push({ s: it[0], mx: l > 1 ? mx / l : mx, mz: l > 1 ? mz / l : mz, jumpHeld: !!(f & 1), sprint: !!(f & 2), jump: !!(f & 4), dash: !!(f & 8), throw: f & 16 ? 'oil' : f & 32 ? 'spit' : null });
    }
    if (c.queue.length > 120) c.queue.splice(0, c.queue.length - 120);
  } else if (m.t === 'ping') {
    send(cid, { t: 'pong', c: m.c, time: c ? +c.room.sim.time.toFixed(3) : 0 });
  } else if (m.t === 'join') {
    if (c) c.room.leave(cid);
    const mode = m.mode === 'teams' ? 'teams' : 'ffa';
    const look = cleanLook(m.look);
    let room;
    if (m.room != null && m.admin) { // el admin elige la sala (sólo si tiene lugar)
      room = rooms.get(String(m.room));
      if (!room || room.humans >= room.capacity) { send(cid, { t: 'full' }); return; }
    } else room = pickRoom(mode);
    if (!room.join(cid, look, !!m.admin)) send(cid, { t: 'full' });
  }
}

parentPort.on('message', (msg) => {
  if (msg.type === 'msg') { try { onMessage(msg.cid, msg.m); } catch (e) { console.error('[salas]', e); } }
  else if (msg.type === 'close') clients.get(msg.cid)?.room.leave(msg.cid);
});

// ---------------------------------------------------------------- reloj de todas las salas
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const r of rooms.values()) {
    try { r.tick(dt); } catch (e) { console.error('[sala ' + r.id + ']', e); }
    if (r.emptyFor > EMPTY_TTL) r.dispose();
  }
}, 8);
// resumen para el panel del admin (cada segundo)
setInterval(() => post({ type: 'rooms', rooms: [...rooms.values()].map((r) => r.summary()) }), 1000);
post({ type: 'ready' });
