// Modo EN LÍNEA del navegador: la partida la decide el servidor (una sala); acá se predice y se dibuja.
//
// TODOS los blobs se muestran en el mismo momento que el tuyo (el "presente": el paso del servidor en el que va a
// aplicar la tecla que estás apretando ahora). Tu navegador simula a todos con la MISMA física que el servidor:
// a vos con tus teclas, y a cada uno de los demás con la última dirección que mandó el servidor. Así lo que ves
// es lo que choca, y un golpe se ve cuando los dos se tocan (antes los demás se veían ~300 ms en el pasado y los
// golpes "llegaban de lejos").
//
// Cada foto del servidor (30 por segundo) dice cómo estaba todo en su paso S, y que ese paso corresponde a tu paso
// local ack+since. Para cada blob se compara lo que habías predicho para ese paso con la verdad: la diferencia se
// le suma al presente (física), la historia se corrige, y lo que se ve se desliza suave (visOff).
// Los BOTS no se adivinan: el servidor los hace decidir con anticipación y manda cada decisión antes de que se
// ejecute (con el paso exacto). Tu navegador la aplica en ese mismo paso: sus embestidas salen acá a la vez que allá.
// Los golpes se predicen (chispas, sonido y rebote al tocarse); el servidor confirma o corrige.
// Tu navegador ajusta su ritmo un pelito (timeScale) para que en el servidor esperen sólo 2-3 teclas tuyas.
// En el navegador, tu blob siempre es jellies[0]: el id del servidor se mapea a ese lugar.
import * as THREE from 'three';
import { fx } from '../fx.js';
import { sfx } from '../sfx.js';
import { STEP, Sim, hitEffects } from '../game/sim.js';
import { CONFIG } from '../config.js';
import { F, decodeSnap } from './protocol.js';
import { TEAM_COLORS } from '../game/teamlogic.js';

const HIST = 256; // pasos de historia (~2 s)
const HS = 7; // por paso: posición (3), velocidad (3), energía
const QUEUE_TARGET = 3; // teclas tuyas esperando en el servidor (colchón contra los saltos de la red)
const _v = new THREE.Vector3();
const STILL = { mx: 0, mz: 0, jump: false, jumpHeld: false, dash: false, sprint: false, throw: null };
const NOOP_SHOTS = { hit() {}, land() {} };

const dec = (a) => (Array.isArray(a) ? (a[0] === 'V' ? new THREE.Vector3(a[1], a[2], a[3]) : a[0] === 'C' ? new THREE.Color(a[1]) : a) : a);
const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Online {
  static chainMode = 1; // carambolas: 0 no se predicen · 1 sí, pero no en cadena sin confirmar · 2 siempre · 3 sólo confirmadas
  // sim: la partida local (se usan sus objetos: blobs, arena, bolitas…) · ui: callbacks de main.js
  constructor(sim, ui) {
    this.sim = sim;
    this.ui = ui; // { slice, shake, teamEvent, roster, lost }
    this.active = false;
    this.ws = null;
    this.rtt = 0;
    this.timeScale = 1;
    this.tm = null;
    this.stats = this._emptyStats();
  }

  _emptyStats() {
    return { snaps: 0, corr: 0, corrN: 0, corrMax: 0, hard: 0, predicted: 0, confirmed: 0, serverHits: 0, unpredicted: 0, meHitPred: 0, meHitServer: 0, meHitUnpred: 0, queue: 0, bytes: 0, planOk: 0, planLate: 0, lead: 0, corrO: 0, corrON: 0, big: 0, bigO: 0 };
  }

  // ---------------------------------------------------------------- conexión
  connect({ mode, look, room = null }) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let welcomed = false;
      const timer = setTimeout(() => { if (!welcomed) { ws.close(); reject(new Error('timeout')); } }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', mode, look, room }));
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') { if (this.active) this._snap(e.data); return; }
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') { welcomed = true; clearTimeout(timer); this._welcome(m); resolve(m); }
        else if (m.t === 'x') this._meta(m);
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
    this.timeScale = 1;
    clearInterval(this._ping);
    const sim = this.sim;
    for (const j of sim.jellies) { j.setRemote(false); j.collider.setSensor(false); j.netId = null; j.netCmd = null; j.netPlan = null; j.visOff?.set(0, 0, 0); }
    sim.pickups.remote = false;
    sim.pickups.clear(); sim.oil.clear(); sim.shots.clear();
    sim.oil.friendly = this._oilFriendly; sim.shots.friendly = this._shotsFriendly;
  }

  // id del servidor ↔ lugar en el navegador (el tuyo siempre en jellies[0])
  _idx(sid) { return sid === this.you ? 0 : sid === 0 ? this.you : sid; }
  jelly(sid) { return this.sim.jellies[this._idx(sid)]; }

  _welcome(m) {
    const sim = this.sim;
    this.you = m.you;
    this.room = m.room;
    this.active = true;
    this.stats = this._emptyStats();
    this.stepSeq = 0; // tus pasos locales (cada uno con su tecla)
    this._byId = null;
    this.out = [];
    this.presentStep = m.step; // el paso del servidor que estás mostrando
    sim.time = this.presentStep * STEP;
    this.timeScale = 1;
    this._lastReps = 0;
    this._introShown = false;
    this.predicted = []; // golpes que predijiste: { att, vic, step }
    this.bumpAt = new Map();
    // historia: por blob, posición y velocidad en cada paso local
    this.histSeq = new Int32Array(HIST).fill(-1);
    this.hist = sim.jellies.map(() => new Float32Array(HIST * HS).fill(NaN));
    this.lead = 0; this._leadMax = 0; this._leadPrev = 0; this._leadT = performance.now(); // cuántos pasos vas adelantado
    // después de ubicar un blob "de golpe" (apareció, se fue muy lejos), las fotos que hablan de antes de ese
    // momento ya no sirven para corregirlo: se ignoran hasta que lleguen las de después (si no, salta en cada foto)
    this.barrier = new Int32Array(sim.jellies.length);
    this._setTeams(m.tm, m.step);
    sim.teams.stop(); // en línea la lógica de equipos es la del servidor
    sim.pickups.remote = true;
    sim.pickups.clear(); sim.oil.clear(); sim.shots.clear();
    for (const p of m.pickups) sim.pickups.addRemote(p);
    // aceite y chorro: en equipos no afectan a los compañeros (el equipo lo dice el servidor)
    this._oilFriendly = sim.oil.friendly; this._shotsFriendly = sim.shots.friendly;
    const friendly = (owner, j) => !!owner && owner.team != null && owner.team === j.team;
    sim.oil.friendly = friendly; sim.shots.friendly = friendly;
    sim.jellies.forEach((j, i) => {
      j.netId = this._idx(i);
      j.netCmd = null; j.netPlan = null;
      j.setRemote(false); // todos son cuerpos normales: se simulan acá con la misma física
      j.collider.setSensor(false);
      j.visOff?.set(0, 0, 0);
    });
    this._roster(m.roster);
    if (m.ar) sim.arena.setState?.(m.ar, sim.time);
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

  // ---------------------------------------------------------------- historia (por blob, por paso local)
  _record() {
    const slot = this.stepSeq % HIST;
    this.histSeq[slot] = this.stepSeq;
    const js = this.sim.jellies, o = slot * HS;
    for (let i = 0; i < js.length; i++) {
      const j = js[i], h = this.hist[i];
      if (j.dead || j.impaled || j.benched) { h[o] = NaN; continue; }
      const v = j.body.linvel();
      h[o] = j.pos.x; h[o + 1] = j.pos.y; h[o + 2] = j.pos.z; h[o + 3] = v.x; h[o + 4] = v.y; h[o + 5] = v.z; h[o + 6] = j.energy;
    }
  }

  _histAt(i, seq) {
    const slot = ((seq % HIST) + HIST) % HIST;
    if (this.histSeq[slot] !== seq) return -1;
    const o = slot * HS;
    return Number.isNaN(this.hist[i][o]) ? -1 : o;
  }

  // ---------------------------------------------------------------- fotos del servidor (binario)
  _snap(buf) {
    const t0 = performance.now();
    const d = decodeSnap(buf);
    const st = this.stats;
    st.snaps++; st.bytes += buf.byteLength; st.queue = d.queue;
    // tu ritmo: que en el servidor esperen ~3 teclas tuyas (ni más, que es atraso; ni 0, que repite la última)
    const underflow = d.reps !== this._lastReps;
    this._lastReps = d.reps;
    let scale = 1 - (d.queue - QUEUE_TARGET) * 0.01;
    if (underflow && d.queue === 0) scale = Math.max(scale, 1.03);
    this.timeScale = clamp(scale, 0.94, 1.05);
    // a qué paso tuyo corresponde la foto, y cuántos pasos vas adelantado
    const local = d.ack + d.since;
    const N = clamp(this.stepSeq - local, 0, HIST - 8);
    this.presentStep = d.step + N;
    this.sim.time = this.presentStep * STEP;
    this._snapStep = d.step;
    // cuánto vas adelantado (lo peor de los últimos ~2 s): se le avisa al servidor para que los bots decidan con
    // al menos esa anticipación (si no, sus decisiones te llegan tarde)
    this._leadMax = Math.max(this._leadMax, N);
    if (t0 - this._leadT > 1000) { this.lead = Math.max(this._leadMax, this._leadPrev); this._leadPrev = this._leadMax; this._leadMax = 0; this._leadT = t0; st.lead = this.lead; }
    for (const b of d.b.values()) {
      const j = this.jelly(b.id);
      if (j) this._apply(j, this._idx(b.id), b, N, local);
    }
    this._checkPredicted();
    this.netMs = (this.netMs || 0) + performance.now() - t0;
  }

  _apply(j, i, b, N, local) {
    const own = i === 0, flags = b.flags, ahead = N * STEP;
    j.human = !!(flags & F.human);
    // equipo y puntos valen aunque esté muerto (en equipos, muerto se espera la ronda siguiente)
    const team = b.team >= 0 ? b.team : null;
    if (team !== j.team) { j.team = team; j.setLook({ color: team != null ? TEAM_COLORS[team] : j.look?.color || '#' + j.color.getHexString() }); this.ui.roster?.(); }
    j.score = b.score; j.kos = b.kos; j.falls = b.falls;
    if (flags & F.out) { j.benched = true; if (!j.dead) j.kill(); return; }
    j.benched = false;
    if (flags & F.dead) { if (!j.dead) j.kill(); j.netPlan = null; return; }
    if (j.dead) { // reapareció: directo a donde está (proyectado al presente)
      j.respawn(_v.set(b.x + b.vx * ahead, b.y, b.z + b.vz * ahead));
      j.body.setLinvel({ x: b.vx, y: b.vy, z: b.vz }, true);
      j.yaw = j.targetYaw = b.yaw;
      j.visOff?.set(0, 0, 0);
      this.barrier[i] = this.stepSeq;
    }
    this._fields(j, b, ahead, own);
    if (!own) {
      j.netCmd = { mx: b.mx, mz: b.mz, jumpHeld: !!(b.cmdFlags & 1), sprint: !!(b.cmdFlags & 2), jump: false, dash: false, throw: null };
      if (b.p1 && !j.human) this._mergePlan(j, b); else j.netPlan = null;
      // hacia dónde mira: un bot con plan gira acá igual que allá (la foto es de hace un rato: no se lo tira para atrás)
      const dy = Math.atan2(Math.sin(b.yaw - j.yaw), Math.cos(b.yaw - j.yaw));
      if (!j.netPlan || Math.abs(dy) > 1.2) j.yaw = angLerp(j.yaw, b.yaw, 0.35);
    }
    if (flags & F.impaled) { if (!j.impaled) j.impaledT = b.impaledT; return; }
    if (j.impaled) return;
    if (own && !this._introShown && this.tm?.active && j.team != null) { // entraste en equipos: de qué equipo sos
      this._introShown = true;
      this.ui.teamEvent?.('intro', { round: 1, wins: this.tm.wins });
    }
    if (local <= this.barrier[i]) return; // foto de antes de que lo ubicaras: ya no sirve para corregir
    // lo que habías predicho para ese paso vs. la verdad
    const o = this._histAt(i, local);
    const h = this.hist[i];
    if (o < 0) { this._hardSet(j, i, b, ahead); return; }
    const ex = b.x - h[o], ey = b.y - h[o + 1], ez = b.z - h[o + 2];
    const err = Math.hypot(ex, ey, ez);
    const st = this.stats;
    if (own) {
      st.corr += err; st.corrN++; st.corrMax = Math.max(st.corrMax, err);
      if (err > 0.5) {
        st.big++;
        if (this.debug) {
          let near = Infinity;
          for (const o2 of this.sim.jellies) if (o2 !== j && !o2.dead && !o2.benched) near = Math.min(near, o2.pos.distanceTo(j.pos) - o2.r - j.r);
          (st.bigList ||= []).push({ err, daze: j.daze > 0, oil: j.oilT > 0 || !!j.slipActive, stun: j.stun > 0, hitMe: local - (this._meHitLocal ?? -1e9), near });
        }
      }
    }
    else { st.corrO += err; st.corrON++; if (err > 0.5) st.bigO++; }
    if (err > 6) { this._hardSet(j, i, b, ahead); if (own) this.stats.hard++; return; }
    { // energía: igual que la posición (la diferencia con lo predicho para ese paso)
      const de = b.energy - h[o + 6];
      if (Math.abs(de) > 1) { j.energy = clamp(j.energy + de, 0, 100); this._shiftHist1(i, local, 6, de); }
    }
    if (err > 0.005) {
      // la física se corrige ya (sumando la diferencia: el blob siguió moviéndose desde entonces), la historia
      // de los pasos siguientes también (así la próxima foto no corrige lo mismo), y lo que se ve se desliza
      const t = j.body.translation();
      j.body.setTranslation({ x: t.x + ex, y: t.y + ey, z: t.z + ez }, true);
      j.pos.x += ex; j.pos.y += ey; j.pos.z += ez;
      j.prevPos.x += ex; j.prevPos.y += ey; j.prevPos.z += ez;
      (j.visOff ||= new THREE.Vector3()).x -= ex; j.visOff.y -= ey; j.visOff.z -= ez;
      this._shiftHist(i, local, ex, ey, ez, 0);
    }
    // velocidad: a los demás siempre (cambiaron de dirección); a vos, sólo si fue un golpe que no predijiste
    const dvx = b.vx - h[o + 3], dvy = b.vy - h[o + 4], dvz = b.vz - h[o + 5];
    const dv = Math.hypot(dvx, dvy, dvz);
    if ((own && dv > 6) || (!own && dv > 0.25)) {
      const v = j.body.linvel();
      j.body.setLinvel({ x: v.x + dvx, y: v.y + dvy, z: v.z + dvz }, true);
      this._shiftHist(i, local, dvx, dvy, dvz, 3);
    }
  }

  _shiftHist1(i, from, off, a) {
    const h = this.hist[i];
    for (let s = from + 1; s <= this.stepSeq; s++) { const o = this._histAt(i, s); if (o >= 0) h[o + off] += a; }
  }

  _shiftHist(i, from, ax, ay, az, off) {
    const h = this.hist[i];
    for (let s = from + 1; s <= this.stepSeq; s++) {
      const o = this._histAt(i, s);
      if (o < 0) continue;
      h[o + off] += ax; h[o + off + 1] += ay; h[o + off + 2] += az;
    }
  }

  // sin historia (recién aparecido) o diferencia enorme: directo a la verdad, proyectada al presente
  _hardSet(j, i, b, ahead) {
    const x = b.x + b.vx * ahead, z = b.z + b.vz * ahead;
    j.body.setTranslation({ x, y: b.y, z }, true);
    j.body.setLinvel({ x: b.vx, y: b.vy, z: b.vz }, true);
    j.pos.set(x, b.y, z); j.prevPos.copy(j.pos);
    j.visOff?.set(0, 0, 0);
    if (i !== 0) j.energy = b.energy;
    this.barrier[i] = this.stepSeq;
  }

  // las decisiones de un bot (las 2 últimas de cada foto), ordenadas por el paso en que se ejecutan
  _mergePlan(j, b) {
    const L = (j.netPlan ||= []), P = this.presentStep;
    while (L.length && L[L.length - 1].at > b.p1.at) L.pop(); // (el servidor las reemplazó: bajó la anticipación)
    for (const p of [b.p2, b.p1]) {
      if (!p) continue;
      let k = L.length - 1;
      while (k >= 0 && L[k].at > p.at) k--;
      if (k >= 0 && L[k].at === p.at) continue; // ya la tenías
      p.late = p.at <= P; // llegó cuando ya pasó: sus botones no se aplican (la foto lo corrige)
      if (p.late) this.stats.planLate++; else this.stats.planOk++;
      L.splice(k + 1, 0, p);
    }
    while (L.length > 1 && L[1].at <= P - 12) L.shift();
  }

  // el comando de un bot en este paso: su última decisión que ya tocaba (los botones, sólo en su paso exacto)
  _planCmd(j) {
    const L = j.netPlan;
    if (!L || !L.length) return null;
    const P = this.presentStep;
    let e = null;
    for (let k = L.length - 1; k >= 0; k--) if (L[k].at <= P) { e = L[k]; break; }
    if (!e) return null;
    const c = (j._planCmd ||= { ...STILL });
    c.mx = e.mx; c.mz = e.mz; c.jumpHeld = !!(e.f & 1); c.sprint = !!(e.f & 2);
    const fire = !e.late && !e.fired;
    c.jump = fire && !!(e.f & 4); c.dash = fire && !!(e.f & 8); c.throw = null;
    e.fired = true;
    return c;
  }

  // los datos que no son posición (masa, daño, poderes, armas, puntos…), "envejecidos" hasta el presente
  _fields(j, b, ahead, own) {
    j.mass = b.mass;
    j.damage = b.damage;
    j.buffs.turbo = Math.max(0, b.turbo - ahead); j.buffs.strength = Math.max(0, b.strength - ahead);
    j.ammo.oil = b.oil; j.ammo.spit = b.spit;
    if (!own) {
      // aturdimiento y mareo: los del servidor, envejecidos; si tu navegador le predijo un golpe DESPUÉS de la
      // foto, el suyo es más nuevo y se respeta
      const S = this._snapStep, fresh = (j.hitAt ?? -1) > S;
      const stun = Math.max(0, b.stun - ahead);
      j.stun = fresh ? Math.max(j.stun, stun) : stun;
      const daze = Math.max(0, b.daze - ahead);
      if (daze > 0) j.dazeT = b.dazeT + ahead;
      j.daze = fresh ? Math.max(j.daze, daze) : daze;
      j.oilT = Math.max(j.oilT, b.oilT - ahead);
      this._dashSync(j, b, ahead, S);
    } else {
      // tu blob: mareo, aturdimiento y aceite los predice tu navegador; el servidor sólo manda si es algo nuevo
      // (envejecido hasta tu presente: si no, te quedaba mareado o aturdido más tiempo que allá)
      const dz = b.daze - ahead, sn = b.stun - ahead, ol = b.oilT - ahead;
      if (dz > j.daze + 0.3) j.daze = dz;
      if (dz > 0 && j.daze > 0) j.dazeT = b.dazeT + ahead; // camina "borracho" igual que allá
      if (sn > j.stun + 0.1) j.stun = sn;
      if (ol > j.oilT + 0.1) j.oilT = ol;
    }
  }

  // carga y embestida de los demás. Lo que la foto dice de ANTES de su paso manda; lo que tu navegador ya hizo
  // DESPUÉS (un bot que salió en el paso de su plan) se respeta. wuAt/dashAt: paso del servidor en que empezó acá.
  _dashSync(j, b, ahead, S) {
    if ((j.hitAt ?? -1) > S) return; // acá ya chocó DESPUÉS de esa foto (golpe predicho): la foto es vieja para esto
    const wuLocal = j.windup > 0, dashLocal = j.dashTimer > 0;
    if (b.windup > 0) { // cargando: se sabe hacia dónde y cuándo sale
      if (dashLocal && !wuLocal) return; // acá ya salió (un pelito antes): se deja
      j.dashDir.set(Math.sin(b.yaw), 0, Math.cos(b.yaw));
      const wu = b.windup - ahead;
      if (wu > 0) {
        if (!wuLocal) { j.squashVel -= 5; j.wuAt = S; j.dashSrc = 'foto'; }
        j.windup = wu;
      } else { // ya salió (la noticia llegó tarde)
        j.windup = 0;
        if (CONFIG.dashTime + wu > 0) { j.dashTimer = CONFIG.dashTime + wu; j.airDash = !j.grounded; j.dashAt = S; j.dashSrc = 'foto'; }
      }
    } else if (b.dashTimer > 0) { // embistiendo: sigue acá en la dirección en que va
      const left = b.dashTimer - ahead;
      if (left <= 0) return;
      if (!dashLocal) {
        const hl = Math.hypot(b.vx, b.vz);
        if (hl > 0.5) j.dashDir.set(b.vx / hl, 0, b.vz / hl);
        j.airDash = !!(b.flags & F.airDash);
        j.dashAt = S; j.dashSrc = 'foto';
      }
      j.windup = 0;
      j.dashTimer = left;
    } else { // el servidor no lo hizo: lo que acá empezó antes de la foto era un error
      if (wuLocal && (j.wuAt ?? -1) <= S) j.windup = 0;
      if (dashLocal && (j.dashAt ?? -1) <= S) j.dashTimer = 0;
    }
  }

  // ---------------------------------------------------------------- eventos y estado de equipos/arena (JSON)
  _meta(m) {
    if (!this.active) return;
    if (m.tm !== undefined) this._setTeams(m.tm, m.step);
    if (m.ar) this.sim.arena.setState?.(m.ar, this.sim.time);
    for (const e of m.ev) {
      try { this._event(e); } catch (err) { console.warn('evento', e[1], err); }
    }
  }

  _setTeams(tm, step) {
    this.tm = tm;
    // equipos: el ¡YA! es en un paso exacto del servidor (así arrancás justo, sin esperar el aviso)
    const go = tm?.active && tm.goIn > 0 ? step + Math.round(tm.goIn / STEP) : 0;
    if (go && Math.abs(go - (this.goStep || 0)) > 3) { this.goStep = go; this._lastCount = null; } // ronda nueva
  }

  _event(e) {
    const sim = this.sim, step = e[0], type = e[1];
    const age = Math.max(0, (this.presentStep - step) * STEP); // hace cuánto pasó (en el presente que mostrás)
    switch (type) {
      case 'f': fx[e[2]]?.(...e.slice(3).map(dec)); break;
      case 'a': {
        const who = e[3];
        if (e[2] === 'land') break; // los aterrizajes los arma cada navegador
        if (who === this.you && (e[2] === 'jump' || e[2] === 'dash')) break; // eso ya sonó (lo predijiste vos)
        if (e[2] === 'dash' && performance.now() - (this.jelly(who)?.lastLaunch || -1e9) < 500) break; // ya sonó acá (salió de la carga)
        if (e[2] === 'jump' && performance.now() - (this.jelly(who)?.lastJump || -1e9) < 500) break; // ya sonó acá (el plan del bot)
        let args = e.slice(4).map(dec);
        if (['sawWarn', 'sawRise', 'spikesWarn', 'spikesUp'].includes(e[2])) args = [1];
        sfx[e[2]]?.(...args);
        break;
      }
      case 'hit': this._serverHit(step, e); break;
      case 'p+': sim.pickups.addRemote({ id: e[2], x: e[3], y: e[4], z: e[5], vx: e[6], vy: e[7], vz: e[8], power: e[9], age }); break;
      case 'p-': sim.pickups.eatRemote(e[2], this.jelly(e[3])); break;
      case 'o': sim.oil.spawn(e[2], e[3], this.jelly(e[4]) || null); break;
      case 's': {
        const owner = this.jelly(e[3]);
        if (!owner) break;
        const pos = dec(e[4]), vel = dec(e[5]);
        const g = e[2] === 'spit' ? -9 : -30; // adelantado al presente (vuela por donde va ahora)
        pos.addScaledVector(vel, age); pos.y += 0.5 * g * age * age; vel.y += g * age;
        sim.shots.spawn(e[2], owner, pos, vel);
        break;
      }
      case 'sl': { const j = this.jelly(e[2]); if (j && !j.dead) { this.ui.slice?.(j, dec(e[3]), dec(e[4])); j.kill(); } break; }
      case 'im': { const j = this.jelly(e[2]); if (j && !j.dead) { j.impale(dec(e[3]), dec(e[4]), e[5]); j.impaleN = dec(e[4]); } break; }
      case 'dn': { const j = this.jelly(e[2]); if (j && !j.dead) j.dent(dec(e[3]), e[4], e[5]); break; }
      case 'sh': this.ui.shake?.(e[2]); break;
      case 'clr': sim.pickups.clear(); sim.oil.clear(); sim.shots.clear(); break;
      case 'tm': if (e[2] !== 'count') this.ui.teamEvent?.(e[2], e[3]); break; // la cuenta 3-2-1 la arma cada uno (ver step)
      default: break;
    }
  }

  // ---------------------------------------------------------------- golpes: predichos acá, confirmados por el servidor
  _enemy(a, b) { return a.team == null || b.team == null || a.team !== b.team; }

  // en el MISMO orden que el servidor (por su número de blob): si dos se embisten a la vez, gana el mismo
  _localHits() {
    const js = (this._byId ||= this.sim.jellies.map((_, sid) => this.jelly(sid)));
    for (let i = 0; i < js.length; i++) {
      const a = js[i];
      if (a.dead || a.benched || a.impaled) continue;
      for (let k = i + 1; k < js.length; k++) {
        const b = js[k];
        if (b.dead || b.benched || b.impaled) continue;
        _v.subVectors(b.pos, a.pos);
        const d = _v.length();
        if (d > a.r + b.r + 0.25 || d < 1e-4) continue;
        _v.divideScalar(d);
        const aD = a.dashing, bD = b.dashing;
        if (aD) this._tryHit(a, b, _v);
        if (bD) this._tryHit(b, a, _v.clone().negate());
        if (!aD && !bD) {
          const rel = a.vBefore.dot(_v) - b.vBefore.dot(_v), time = this.sim.time;
          const key = i * 32 + k;
          // carambola: como en el servidor (que la cuenta desde 7 m/s); acá sólo las claras, las dudosas las decide allá
          if (rel > 8.5 && time < (a.flyUntil || 0)) this._chainHit(a, b, _v, rel);
          else if (rel > 8.5 && time < (b.flyUntil || 0)) this._chainHit(b, a, _v.clone().negate(), rel);
          else if (rel > 7 && this.presentStep - (this.bumpAt.get(key) || -99) > 30) { this.bumpAt.set(key, this.presentStep); sfx.bump(rel); }
        }
      }
    }
  }

  _tryHit(att, vic, n) {
    if (!att.dashing || !this._enemy(att, vic)) return; // (si recién lo golpeó el otro, ya no embiste: como allá)
    const closing = att.vBefore.dot(n) - vic.vBefore.dot(n);
    if (closing < 6) return;
    const nh = new THREE.Vector3(n.x, 0, n.z).normalize();
    const { K } = Sim.hitForce(att.mass, vic.mass, vic.damage, closing, att.airDash, att.buffs.strength > 0, vic.daze > 0);
    vic.knockback(nh.x * K, 3 + K * CONFIG.knockLift, nh.z * K, CONFIG.stunBase + K * CONFIG.stunPerForce);
    att.dashTimer = 0;
    const recoil = 4 / Math.sqrt(att.mass);
    att.knockback(-nh.x * recoil, 3, -nh.z * recoil, 0.12);
    att.hitAt = vic.hitAt = this.presentStep;
    const me = this.sim.jellies[0];
    hitEffects({ att, vic, contact: att.pos.clone().addScaledVector(nh, att.r), nh, K, air: att.airDash }, (a) => this._shake(a, att, vic, me));
    const p = { att, vic, step: this.presentStep, ok: false, src: att.dashSrc, dashAt: att.dashAt, wuAt: att.wuAt, closing };
    this.predicted.push(p);
    // sale volando: si choca a otro, carambola (se predice recién cuando el servidor confirmó este golpe)
    if (K >= 10) { vic.flyUntil = this.sim.time + 0.9; vic.flyBy = att; vic.flyHit = p; }
    this.stats.predicted++;
    if (vic === me) this.stats.meHitPred++;
  }

  // carambola: el que sale volando por un golpe le pega al que choca (misma regla que el servidor)
  _chainHit(src, dst, n, closing) {
    const time = this.sim.time;
    if (dst === src.flyBy || time < (dst.chainUntil || 0) || !this._enemy(src.flyBy || src, dst)) return;
    // si el golpe que lo hizo volar todavía no está confirmado, sólo se arriesga una carambola (no una cadena)
    const m = Online.chainMode;
    if (!m) return;
    if (src.flyHit && !src.flyHit.ok && (m === 3 || (m === 1 && src.flyHit.src === 'carambola'))) return;
    const nh = new THREE.Vector3(n.x, 0, n.z).normalize();
    const { K } = Sim.hitForce(src.mass, dst.mass, dst.damage, closing, false, false, dst.daze > 0);
    dst.knockback(nh.x * K, 3 + K * CONFIG.knockLift, nh.z * K, CONFIG.stunBase + K * CONFIG.stunPerForce);
    dst.chainUntil = time + 0.4;
    const v = src.body.linvel();
    src.body.setLinvel({ x: v.x * 0.45, y: v.y, z: v.z * 0.45 }, true);
    src.flyUntil = 0;
    src.hitAt = dst.hitAt = this.presentStep;
    const me = this.sim.jellies[0];
    hitEffects({ att: src, vic: dst, contact: src.pos.clone().addScaledVector(nh, src.r), nh, K, chain: true }, (a) => this._shake(a, src, dst, me));
    const p = { att: src, vic: dst, step: this.presentStep, ok: false, src: 'carambola', closing };
    this.predicted.push(p);
    if (K >= 10) { dst.flyUntil = time + 0.9; dst.flyBy = src.flyBy || src; dst.flyHit = p; }
    this.stats.predicted++;
    if (dst === me) this.stats.meHitPred++;
  }

  // el temblor de cámara es fuerte si el golpe es tuyo; si es de otros, según qué tan cerca está
  _shake(a, att, vic, me) {
    if (att === me || vic === me) { this.ui.shake?.(a); return; }
    if (me.dead) return;
    const d = Math.min(me.pos.distanceTo(att.pos), me.pos.distanceTo(vic.pos));
    if (d < 25) this.ui.shake?.(a * (1 - d / 25) * 0.6);
  }

  _serverHit(step, e) {
    const att = this.jelly(e[2]), vic = this.jelly(e[3]);
    if (!att || !vic) return;
    this.stats.serverHits++;
    const me = this.sim.jellies[0];
    if (vic === me) { this.stats.meHitServer++; this._meHitLocal = this.stepSeq - (this.presentStep - step); }
    // ¿ya lo mostraste (lo predijiste al verlos tocarse)? Entonces sólo falta lo que no se puede adivinar (el mareo)
    const p = this.predicted.find((x) => !x.ok && x.att === att && x.vic === vic && Math.abs(x.step - step) < 45);
    if (p) { p.ok = true; this.stats.confirmed++; if (e[8]) sfx.dizzy(); return; }
    this.stats.unpredicted++;
    if (vic === me) this.stats.meHitUnpred++;
    if (e[6] >= 10) { vic.flyUntil = step * STEP + 0.9; vic.flyBy = e[9] ? att.flyBy || att : att; vic.flyHit = null; }
    const nh = dec(e[5]);
    hitEffects({ att, vic, contact: dec(e[4]), nh, K: e[6], air: !!e[7], dazed: !!e[8], chain: !!e[9] }, (a) => this._shake(a, att, vic, me));
  }

  // las predicciones que el servidor nunca confirmó se olvidan (las corrige la próxima foto)
  _checkPredicted() {
    const limit = this.presentStep - 240;
    this.predicted = this.predicted.filter((p) => !p.ok && p.step > limit);
  }

  // ---------------------------------------------------------------- cada paso de física (1/120 s)
  step(pc, doSkin) {
    const sim = this.sim, js = sim.jellies, me = js[0];
    this.stepSeq++;
    this.presentStep++;
    sim.time = this.presentStep * STEP;
    // equipos: quietos hasta el ¡YA! (y la cuenta 3-2-1, exacta en tu presente)
    const frozen = this.goStep > this.presentStep;
    if (this.goStep && this._firedGo !== this.goStep) {
      const left = (this.goStep - this.presentStep) * STEP;
      const n = left > 0 ? Math.ceil(left - 1e-6) : 0;
      if (n !== this._lastCount && n <= 3) { this._lastCount = n; this.ui.teamEvent?.('count', { n }); if (n === 0) this._firedGo = this.goStep; }
    }
    // la tecla de este paso (numerada): el servidor la aplica en este mismo orden
    const flags = (pc.jumpHeld ? 1 : 0) | (pc.sprint ? 2 : 0) | (pc.jump ? 4 : 0) | (pc.dash ? 8 : 0) | (pc.throw === 'oil' ? 16 : pc.throw === 'spit' ? 32 : 0);
    this.out.push([this.stepSeq, +pc.mx.toFixed(3), +pc.mz.toFixed(3), frozen ? 0 : flags]);

    sim.arena.preStep(STEP, sim.time);
    // todos con la misma física: vos con tus teclas, los bots con su plan, las otras personas con su última dirección
    const P = this.presentStep;
    for (let i = 0; i < js.length; i++) {
      const j = js[i];
      if (j.dead || j.benched || j.impaled) continue;
      if (i === 0) { j.control(STEP, frozen ? STILL : pc); j.throwCd = Math.max(0, j.throwCd - STEP); continue; }
      const cmd = frozen ? STILL : this._planCmd(j) || j.netCmd || STILL;
      const wu = j.windup > 0, da = j.dashTimer > 0;
      j.control(STEP, cmd);
      if (!wu && j.windup > 0) { j.wuAt = P; j.dashSrc = 'plan'; }
      if (!da && j.dashTimer > 0) j.dashAt = P;
      j.throwCd = Math.max(0, j.throwCd - STEP);
    }
    sim.world.step();
    for (const j of js) if (!j.dead && !j.benched) j.postStep(STEP);
    this._localHits();
    this._record();
    for (const j of js) if (j.visOff) j.visOff.multiplyScalar(j.visOff.lengthSq() > 1 ? 0.94 : 0.88); // lo que se ve alcanza a la física
    const alive = js.filter((j) => !j.dead && !j.benched && !j.impaled);
    sim.oil.step(STEP, alive, sim.time); // patinar en el aceite también se predice
    sim.pickups.step(STEP, sim.arena, me.dead ? [] : [me], () => {}); // tu blob se las "come" al pasar (el servidor confirma)
    sim.shots.step(STEP, js, NOOP_SHOTS);
    for (const j of js) j.justSlipped = false;
    if (doSkin) for (const j of js) j.skin(STEP);
  }

  // una vez por frame: mandar las teclas de los pasos de este frame
  sendInput() {
    if (!this.active || !this.out?.length) return;
    this._send({ t: 'in', l: this.out, n: this.lead });
    this.out = [];
  }

  // ms gastados leyendo fotos desde la última vez (registro de rendimiento, cada 10 s)
  takeNetMs() { const v = +(this.netMs || 0).toFixed(1); this.netMs = 0; return v; }

  // estado de equipos para el marcador (o null)
  teamState() { return this.tm; }
}
