// Modo EN LÍNEA del navegador: la partida la corre el servidor (una sala); acá se dibuja.
// - Tu blob se mueve al instante con tus teclas (predicción local) y se corrige de a poco con lo que dice el
//   servidor (con ~165 ms de ida y vuelta a Alemania, esperar la respuesta se sentiría pesado).
// - Los demás se muestran 100 ms "atrás" (INTERP_DELAY), interpolando entre dos fotos: movimiento suave.
// - Efectos, sonidos, bolitas, aceite y chorros llegan como eventos y se reproducen a su hora.
// En el navegador, la gelatina "tuya" siempre es jellies[0]: el id del servidor se mapea a ese lugar.
import * as THREE from 'three';
import { R } from '../jelly.js';
import { fx } from '../fx.js';
import { sfx } from '../sfx.js';
import { STEP } from '../game/sim.js';
import { F, INTERP_DELAY } from './protocol.js';
import { TEAM_COLORS } from '../game/teamlogic.js';

const _v = new THREE.Vector3();
const _white = new THREE.Color('#fff6d0');
const STILL = { mx: 0, mz: 0, jump: false, jumpHeld: false, dash: false, sprint: false, throw: null };
const NOOP_SHOTS = { hit() {}, land() {} };

const dec = (a) => (Array.isArray(a) ? (a[0] === 'V' ? new THREE.Vector3(a[1], a[2], a[3]) : a[0] === 'C' ? new THREE.Color(a[1]) : a) : a);
const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class Online {
  // sim: la partida local (sólo se usan sus objetos: blobs, arena, bolitas…) · ui: callbacks de main.js
  constructor(sim, ui) {
    this.sim = sim;
    this.ui = ui; // { slice, shake, teamEvent, roster, lost, welcome }
    this.active = false;
    this.ws = null;
    this.snaps = [];
    this.events = [];
    this.seq = 0;
    this.history = [];
    this.corr = new THREE.Vector3();
    this.rt = 0; // tiempo del servidor que se está mostrando (para los demás)
    this.offset = 0; // tiempo del servidor - tiempo local
    this.edges = { jump: false, dash: false, throw: null };
    this.tm = null;
    this.rtt = 0;
  }

  // ---------------------------------------------------------------- conexión
  connect({ mode, look, room = null }) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let welcomed = false;
      const timer = setTimeout(() => { if (!welcomed) { ws.close(); reject(new Error('timeout')); } }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', mode, look, room }));
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') { welcomed = true; clearTimeout(timer); this._welcome(m); resolve(m); }
        else if (m.t === 's') this._snap(m);
        else if (m.t === 'roster') this._roster(m.list);
        else if (m.t === 'pong') { this.rtt = performance.now() / 1000 - m.c; }
        else if (m.t === 'full') { clearTimeout(timer); reject(new Error('full')); ws.close(); }
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!welcomed) { reject(new Error('closed')); return; }
        if (this.active) { this.stop(); this.ui.lost?.(); }
      };
      ws.onerror = () => {};
    });
  }

  leave() {
    const ws = this.ws;
    this.stop();
    if (ws && ws.readyState <= 1) ws.close();
  }

  stop() {
    if (!this.active) { this.ws = null; return; }
    this.active = false;
    this.ws = null;
    clearInterval(this._ping);
    for (const j of this.sim.jellies) { j.setRemote(false); j.netId = null; }
    this.sim.pickups.remote = false;
    this.sim.pickups.clear();
    this.sim.oil.clear();
    this.sim.shots.clear();
  }

  // id del servidor ↔ lugar en el navegador (el tuyo siempre en jellies[0])
  _idx(sid) { return sid === this.you ? 0 : sid === 0 ? this.you : sid; }
  jelly(sid) { return this.sim.jellies[this._idx(sid)]; }

  _welcome(m) {
    const sim = this.sim;
    this.you = m.you;
    this.room = m.room;
    this.active = true;
    this.snaps = []; this.events = []; this.history = []; this.corr.set(0, 0, 0);
    this._introShown = false;
    this.out = []; this.stepSeq = 0;
    this._firstOwn = true;
    this.offset = m.time - performance.now() / 1000;
    this.rt = m.time - INTERP_DELAY;
    this.tm = m.tm;
    sim.teams.stop(); // en línea la lógica de equipos es la del servidor
    sim.pickups.remote = true;
    sim.pickups.clear(); sim.oil.clear(); sim.shots.clear();
    for (const p of m.pickups) sim.pickups.addRemote(p);
    sim.jellies.forEach((j, i) => { j.netId = this._idx(i); j.setRemote(i !== 0); });
    this._roster(m.roster);
    if (m.ar) sim.arena.setState?.(m.ar, m.time);
    this._ping = setInterval(() => this._send({ t: 'ping', c: performance.now() / 1000 }), 2000);
  }

  _roster(list) {
    for (const r of list) {
      const j = this.jelly(r.id);
      if (!j) continue;
      j.benched = !!r.out;
      j.human = r.human;
      const key = `${r.name}|${r.color}|${r.shape}|${(r.tattoo || '').length}`;
      if (j._lookKey === key) continue;
      j._lookKey = key;
      j.name = r.name;
      j.look = r;
      if (r.shape) j.setShape(r.shape);
      j.setLook({ color: j.team != null && j.team >= 0 ? TEAM_COLORS[j.team] : r.color });
      if (r.tattoo) {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          j.setLook({ tattoo: c });
        };
        img.src = r.tattoo;
      } else j.setLook({ tattoo: null });
    }
    this.ui.roster?.();
  }

  _send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }

  // ---------------------------------------------------------------- fotos del servidor
  _snap(m) {
    const now = performance.now() / 1000;
    // reloj del servidor: se ajusta de a poco (si se va muy lejos, de golpe)
    const target = m.time - now;
    if (Math.abs(target - this.offset) > 0.5) this.offset = target; else this.offset += (target - this.offset) * 0.08;
    const b = new Map();
    for (const a of m.b) b.set(a[0], a);
    this.snaps.push({ time: m.time, b, tm: m.tm, ar: m.ar, ack: m.ack });
    if (m.dbg) this._lastDbg = m.dbg;
    if (this.snaps.length > 40) this.snaps.shift();
    for (const e of m.ev) this.events.push(e);
    this._own(m);
  }

  // tu blob: lo que diga el servidor manda en todo, salvo la posición (que se corrige de a poco)
  _own(m) {
    const me = this.sim.jellies[0];
    const a = m.b.find((x) => x[0] === this.you);
    if (!a) return;
    const flags = a[10];
    const dead = !!(flags & F.dead) || !!(flags & F.out);
    if (dead && !me.dead) { me.kill(); this.history = []; return; }
    if (dead) return;
    if (me.dead) { me.respawn(_v.set(a[1], a[2], a[3])); this.history = []; this.corr.set(0, 0, 0); }
    else if (this._firstOwn) { // primera foto: tu blob, directo a donde te puso el servidor
      me.body.setTranslation({ x: a[1], y: a[2], z: a[3] }, true);
      me.body.setLinvel({ x: a[4], y: a[5], z: a[6] }, true);
      me.pos.set(a[1], a[2], a[3]); me.prevPos.copy(me.pos); me.renderPos.copy(me.pos);
      this.history = []; this.corr.set(0, 0, 0);
    }
    this._firstOwn = false;
    this._fields(me, a, true);
    if (!this._introShown && m.tm?.active && me.team != null) { // entraste en equipos: de qué equipo sos
      this._introShown = true;
      this.ui.teamEvent?.('intro', { round: 1, wins: m.tm.wins });
    }
    if (flags & F.impaled) return;
    // posición: comparar con lo que habías predicho para esa misma tecla (ack) y corregir la diferencia
    // el mismo instante: el servidor dice hasta qué paso tuyo aplicó (ack); la historia guarda cada paso
    const h = this.history.find((x) => x.seq === m.ack);
    if (!h) return;
    const ex = a[1] - h.x, ey = a[2] - h.y, ez = a[3] - h.z;
    const err = Math.hypot(ex, ey, ez);
    const st = this.errStats ||= { n: 0, sum: 0, max: 0, snaps: 0 }; // cuánto corrige el servidor (para medir)
    st.n++; st.sum += err; st.max = Math.max(st.max, err); if (err > 4) st.snaps++;
    if (err > 4) { // demasiado lejos (te tiraron, reapareciste…): directo a donde está
      me.body.setTranslation({ x: a[1], y: a[2], z: a[3] }, true);
      me.body.setLinvel({ x: a[4], y: a[5], z: a[6] }, true);
      me.pos.set(a[1], a[2], a[3]); me.prevPos.copy(me.pos);
      me.visOff?.set(0, 0, 0); this.history = [];
      return;
    }
    if (err < 0.02) return;
    // la física se corrige YA (sumando la diferencia, no reemplazando: tu blob siguió moviéndose desde entonces)
    // y la historia de los pasos siguientes también, así la próxima foto no vuelve a corregir lo mismo.
    // Lo que se ve se desliza suave (visOff), así no hay saltos.
    const t = me.body.translation();
    me.body.setTranslation({ x: t.x + ex, y: t.y + ey, z: t.z + ez }, true);
    me.pos.x += ex; me.pos.y += ey; me.pos.z += ez;
    me.prevPos.x += ex; me.prevPos.y += ey; me.prevPos.z += ez;
    (me.visOff ||= new THREE.Vector3()).x -= ex; me.visOff.y -= ey; me.visOff.z -= ez;
    for (const x of this.history) if (x.seq > m.ack) { x.x += ex; x.y += ey; x.z += ez; }
    // un golpe que no predijiste (te embistieron): sumar la diferencia de velocidad de ese momento
    const dvx = a[4] - h.vx, dvy = a[5] - h.vy, dvz = a[6] - h.vz;
    if (Math.hypot(dvx, dvy, dvz) > 6) {
      const v = me.body.linvel();
      me.body.setLinvel({ x: v.x + dvx, y: v.y + dvy, z: v.z + dvz }, true);
      for (const x of this.history) if (x.seq > m.ack) { x.vx += dvx; x.vy += dvy; x.vz += dvz; }
    }
  }

  // los datos que no son posición (masa, daño, poderes, armas, puntos…)
  _fields(j, a, own) {
    j.mass = a[8];
    j.damage = a[9];
    const flags = a[10];
    if (!own) {
      j.energy = a[11];
      j.dashTimer = flags & F.dashing ? 0.05 : 0;
      j.airDash = !!(flags & F.airDash);
      j.sprinting = !!(flags & F.sprint);
      j.grounded = !!(flags & F.grounded);
      if (a[12] > 0 && j.daze <= 0) j.dazeT = 0;
      j.daze = a[12];
      j.stun = a[13];
    } else {
      // tu blob: energía, mareo y aturdimiento los predice tu navegador (la foto llega con ~160 ms de atraso:
      // copiarlos "devolvería" energía ya gastada y correrías de más). El servidor sólo manda si es algo nuevo (un golpe).
      if (Math.abs(a[11] - j.energy) > 35) j.energy = a[11];
      if (a[12] > j.daze + 0.3) { if (j.daze <= 0) j.dazeT = 0; j.daze = a[12]; }
      if (a[13] > j.stun + 0.1) j.stun = a[13];
    }
    j.buffs.turbo = a[14]; j.buffs.strength = a[15];
    j.ammo.oil = a[16]; j.ammo.spit = a[17];
    j.score = a[18]; j.kos = a[19]; j.falls = a[20];
    const team = a[21] >= 0 ? a[21] : null;
    if (team !== j.team) { j.team = team; j.setLook({ color: team != null ? TEAM_COLORS[team] : j.look?.color || '#' + j.color.getHexString() }); this.ui.roster?.(); }
    j.oilT = a[22];
    if (!own && (flags & F.impaled) && !j.impaled) j.impaledT = a[23];
  }

  // ---------------------------------------------------------------- cada paso de física (1/120 s)
  step(pc, doSkin) {
    const sim = this.sim, me = sim.jellies[0];
    // tiempo que se muestra: avanza con el reloj local y se acerca de a poco al del servidor (menos el retardo)
    this.rt += STEP;
    const want = performance.now() / 1000 + this.offset - INTERP_DELAY;
    if (Math.abs(want - this.rt) > 0.3) this.rt = want; else this.rt += (want - this.rt) * 0.02;
    sim.time = this.rt;
    // la tecla de este paso (numerado): se manda en el próximo envío, y el servidor la aplica en este mismo orden
    this.stepSeq = (this.stepSeq || 0) + 1;
    const frozenNow = this.tm?.phase === 'intro' || this.tm?.phase === 'count';
    const flags = (pc.jumpHeld ? 1 : 0) | (pc.sprint ? 2 : 0) | (pc.jump ? 4 : 0) | (pc.dash ? 8 : 0) | (pc.throw === 'oil' ? 16 : pc.throw === 'spit' ? 32 : 0);
    (this.out ||= []).push([this.stepSeq, +pc.mx.toFixed(3), +pc.mz.toFixed(3), frozenNow ? 0 : flags]);

    const [s0, s1, k] = this._bracket(this.rt);
    const frozen = this.tm?.phase === 'intro' || this.tm?.phase === 'count';
    sim.arena.preStep(STEP, this.rt);
    // los demás: a la posición interpolada (cuerpos cinemáticos)
    for (let i = 1; i < sim.jellies.length; i++) this._remote(sim.jellies[i], s0, s1, k);
    // vos: predicción con tus teclas
    if (!me.dead && !me.impaled) {
      me.control(STEP, frozen ? STILL : pc);
    }
    if (me.visOff) me.visOff.multiplyScalar(0.9); // lo que se ve alcanza a la física de a poco
    sim.world.step();
    if (!me.dead) me.postStep(STEP);
    if (!me.dead && !me.impaled) {
      const v = me.body.linvel();
      this.history.push({ seq: this.stepSeq, x: me.pos.x, y: me.pos.y, z: me.pos.z, vx: v.x, vy: v.y, vz: v.z });
      if (this.history.length > 240) this.history.shift();
    }
    if (s1?.ar) sim.arena.setState?.(s1.ar, this.rt);
    if (s1) this.tm = s1.tm;
    sim.pickups.step(STEP, sim.arena, [], () => {});
    sim.oil.step(STEP, [], this.rt);
    sim.shots.step(STEP, sim.jellies, NOOP_SHOTS);
    this._playEvents();
    if (doSkin) for (const j of sim.jellies) j.skin(STEP);
  }

  // una vez por frame: mandar las teclas (con lo que se apretó desde el envío anterior)
  sendInput() {
    if (!this.active || !this.out?.length) return;
    this._send({ t: 'in', l: this.out });
    this.out = [];
  }

  _bracket(t) {
    const S = this.snaps;
    if (!S.length) return [null, null, 0];
    let i = S.length - 1;
    while (i > 0 && S[i - 1].time > t) i--;
    const s1 = S[i], s0 = S[i - 1] || s1;
    if (t >= S[S.length - 1].time) return [S[S.length - 1], S[S.length - 1], 1];
    const k = s1.time > s0.time ? Math.min(1, Math.max(0, (t - s0.time) / (s1.time - s0.time))) : 1;
    // las fotos viejas ya no hacen falta
    while (this.snaps.length > 2 && this.snaps[1].time < t - 1) this.snaps.shift();
    return [s0, s1, k];
  }

  _remote(j, s0, s1, k) {
    if (!s1) return;
    const sid = j.netId;
    const a1 = s1.b.get(sid), a0 = s0.b.get(sid) || a1;
    if (!a1) return;
    const flags = a1[10];
    const out = !!(flags & F.out);
    j.benched = out;
    if ((flags & F.dead) || out) { if (!j.dead) j.kill(); return; }
    if (j.dead) { j.respawn(_v.set(a1[1], a1[2], a1[3])); j.setRemote(true); }
    this._fields(j, a1, false);
    if (j.impaled) { j.impaledT = a1[23]; return; }
    const x = a0[1] + (a1[1] - a0[1]) * k, y = a0[2] + (a1[2] - a0[2]) * k, z = a0[3] + (a1[3] - a0[3]) * k;
    j.prevPos.copy(j.pos);
    j.pos.set(x, y, z);
    j.body.setNextKinematicTranslation({ x, y, z });
    j.yaw = angLerp(a0[7], a1[7], k);
    j.targetYaw = j.yaw;
    // tamaño según la masa (como hace control() en tu blob)
    j.size += (Math.cbrt(j.mass) - j.size) * 0.05;
    if (Math.abs(j.size - j.colSize) > 0.004) { j.collider.setRadius(R * j.size); j.colSize = j.size; }
    if (j.daze > 0) j.dazeT += STEP;
    // decoración que no viaja por la red: estela de la embestida y polvo al correr
    if (j.dashing && Math.random() < 0.5) fx.burst(_v.set(x, y - 0.4 * j.size, z), j.airDash ? _white : j.color, j.airDash ? 2 : 1, 1.5, null, 0.07 * j.size);
    else if (j.sprinting && j.grounded && Math.random() < 0.25) fx.burst(_v.set(x, y - j.r + 0.15, z), j.color, 1, 2, null, 0.06 * j.size);
    if (j.impaled && Math.random() < STEP * 6) fx.burst(_v.set(x, y - j.r * 0.3, z), j.color, 1, 1, null, 0.07);
  }

  // ---------------------------------------------------------------- eventos (a su hora: la del blob que se ve)
  _playEvents() {
    const E = this.events;
    let n = 0;
    while (n < E.length && E[n][0] <= this.rt) n++;
    if (!n) return;
    const due = E.splice(0, n);
    for (const e of due) {
      try { this._event(e); } catch (err) { console.warn('evento', e[1], err); }
    }
  }

  _event(e) {
    const sim = this.sim, type = e[1];
    switch (type) {
      case 'f': fx[e[2]]?.(...e.slice(3).map(dec)); break;
      case 'a': {
        if (e[3] === this.you && (e[2] === 'jump' || e[2] === 'dash' || e[2] === 'land')) break; // eso ya sonó (lo predijiste vos)
        let args = e.slice(4).map(dec);
        // las sierras y los pinchos suenan según qué tan cerca estás
        if (['sawWarn', 'sawRise', 'spikesWarn', 'spikesUp'].includes(e[2])) args = [1];
        sfx[e[2]]?.(...args);
        break;
      }
      case 'p+': sim.pickups.addRemote({ id: e[2], x: e[3], y: e[4], z: e[5], vx: e[6], vy: e[7], vz: e[8], power: e[9] }); break;
      case 'p-': sim.pickups.eatRemote(e[2], this.jelly(e[3])); break;
      case 'o': sim.oil.spawn(e[2], e[3], this.jelly(e[4]) || null); break;
      case 's': { const owner = this.jelly(e[3]); if (owner) sim.shots.spawn(e[2], owner, dec(e[4]), dec(e[5])); break; }
      case 'sl': { const j = this.jelly(e[2]); if (j && !j.dead) this.ui.slice?.(j, dec(e[3]), dec(e[4])); break; }
      case 'im': { const j = this.jelly(e[2]); if (j) { j.impale(dec(e[3]), dec(e[4]), e[5]); j.impaleN = dec(e[4]); } break; }
      case 'dn': { const j = this.jelly(e[2]); if (j && !j.dead) j.dent(dec(e[3]), e[4], e[5]); break; }
      case 'sh': this.ui.shake?.(e[2]); break;
      case 'tm': this.ui.teamEvent?.(e[2], e[3]); break;
      default: break;
    }
  }

  // estado de equipos para el marcador (o null)
  teamState() { return this.tm; }
}
