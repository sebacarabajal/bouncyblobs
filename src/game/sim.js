// La partida en sí (sin pantalla): física, blobs, bots, golpes, KO, armas, bolitas, peligros de la arena y equipos.
// La usan el SERVIDOR (una por sala, ver server/rooms.js) y el navegador en modo local (tutorial).
// Lo que se ve y se oye sale por fx/sfx (en el servidor se graban y se mandan a los jugadores) y por hooks:
//   shake(a) · slice(j, normal, along) · event(nombre) · hit(att, vic) · thrown(j, tipo) · spitHit(dueño, j)
//   ate(j, poder) · matchReset() · teamEvent(tipo, datos) · mute(bool) · who(j|null) · ko(killer, victim, pts)
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { Jelly, R, setSimStep } from '../jelly.js';
import { fx } from '../fx.js';
import { sfx, soundAt, ear } from '../sfx.js';
import { Pickups } from '../pickups.js';
import { POWERS, OilSlicks } from '../powers.js';
import { Projectiles } from '../projectiles.js';
import { buildCyber } from '../arenas/cyber.js';
import { buildSteam } from '../arenas/steam.js';
import { buildCrystal } from '../arenas/crystal.js';
import { buildTutorial, DUMMY_HOME } from '../arenas/tutorial.js';
import { TeamLogic, TEAM_COLORS } from './teamlogic.js';

export const STEP = 1 / 120;
export const ARENAS = { cyber: buildCyber, steam: buildSteam, crystal: buildCrystal };
export const BUILDERS = { ...ARENAS, tutorial: buildTutorial }; // el tutorial no aparece en los selectores de arena
export const SLOTS = 16;

// los bots (y los lugares de la sala: un jugador real reemplaza a uno de estos)
export const BOT_DEFS = [
  { name: 'Bubblegum', color: '#ff4fa3', shape: 'round', brow: 0.35, spawn: [0, 0, 5] },
  { name: 'Lemon', color: '#ffc21a', shape: 'round', brow: 0.45, spawn: [-6, 0, -3] },
  { name: 'Sky', color: '#2fc8ff', shape: 'tall', brow: -0.15, spawn: [6, 0, -3] },
  { name: 'Grape', color: '#a24dff', shape: 'drop', brow: 0.5, spawn: [0, 0, -8] },
  { name: 'Lime', color: '#7be22a', shape: 'bean', brow: 0.2, spawn: [-8, 0, 4] },
  { name: 'Tangerine', color: '#ff7a1a', shape: 'drop', brow: 0.55, spawn: [8, 0, 4] },
  { name: 'Blueberry', color: '#3d6bff', shape: 'tall', brow: 0.3, spawn: [-4, 0, 9] },
  { name: 'Mint', color: '#22e0b4', shape: 'box', brow: 0.4, spawn: [4, 0, 9] },
  { name: 'Strawberry', color: '#ff2f4f', shape: 'round', brow: 0.5, spawn: [-10, 0, -8] },
  { name: 'Kiwi', color: '#9bd400', shape: 'box', brow: 0.1, spawn: [10, 0, -8] },
  { name: 'Coconut', color: '#f2ece0', shape: 'bean', brow: 0.3, spawn: [-11, 0, 0] },
  { name: 'Mulberry', color: '#c0137a', shape: 'box', brow: 0.6, spawn: [11, 0, 0] },
  // las 4 de abajo sólo juegan en arenas grandes (arena.players, ej. Steampunk = 16)
  { name: 'Cocoa', color: '#7a4428', shape: 'tall', brow: 0.4, spawn: [-14, 0, 6] },
  { name: 'Peach', color: '#ffb18a', shape: 'bean', brow: 0.2, spawn: [14, 0, 6] },
  { name: 'Plum', color: '#4b1d84', shape: 'bean', brow: 0.5, spawn: [-14, 0, -6] },
  { name: 'Pistachio', color: '#b8c97a', shape: 'drop', brow: 0.3, spawn: [14, 0, -6] },
];
// nombres de repuesto para cuando un bot vuelve a ocupar el lugar que dejó un jugador
const SPARE_NAMES = ['Lemon', 'Sky', 'Grape', 'Lime', 'Tangerine', 'Blueberry', 'Mint', 'Strawberry', 'Kiwi', 'Coconut', 'Mulberry', 'Cocoa', 'Peach', 'Plum', 'Pistachio', 'Grapefruit', 'Cherry', 'Mango', 'Pineapple', 'Currant'];

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _hitWhite = new THREE.Color('#ffffff'), _hitCream = new THREE.Color('#fff2c0');

// Lo que se ve, se oye y se siente de un golpe (chispas, aro, destello, abolladuras, sonido, temblor).
// En el servidor NO se manda pedazo por pedazo: se manda UN evento 'hit' y cada navegador llama a esto
// (o ya lo llamó antes, si predijo el golpe al ver a los dos tocarse).
export function hitEffects({ att, vic, contact, nh, K, air = false, dazed = false, chain = false }, shake) {
  const back = _n.copy(nh).negate();
  fx.burst(contact, vic.color, (chain ? 8 : 10) + (K | 0), K * (chain ? 0.4 : 0.45), nh, chain ? 0.1 : 0.11);
  if (!chain) fx.burst(contact, att.color, 5, K * 0.3, back, 0.08);
  fx.ring(contact, nh, air ? _hitWhite : _hitCream, (1.5 + K * 0.08) * (air ? 1.5 : 1));
  fx.impact(contact.clone().setY(contact.y + 0.3), K * (air ? 1.25 : 1));
  if (!vic.dead) { vic.dent(back, K * (chain ? 1.2 : 1.3), 0.2); vic.squashVel -= 3; }
  if (!att.dead) att.dent(nh, K * 0.6, 0.3);
  shake?.(CONFIG.shake * Math.min(chain ? 1.5 : 1.8, K / 15));
  // tu golpe (o el que te dan) suena fuerte; el de otros, según dónde fue
  soundAt(att === ear.me || vic === ear.me ? 'me' : contact, () => { if (dazed) sfx.dizzy(); sfx.hit(K); });
}
const _hn = new THREE.Vector3();
const _cn = new THREE.Vector3();
// golpe visto por el navegador del que pega (applyClaims): hasta cuánto más lejos que tocarse puede estar el bot acá
const CLAIM_REACH = 1;
const CLAIM_DEBUG = typeof process !== 'undefined' && !!process.env?.CLAIMDEBUG;
const STILL = { mx: 0, mz: 0, jump: false, jumpHeld: false, dash: false, sprint: false, throw: null };
const BOT_EVERY = 4; // los bots deciden 30 veces por segundo (no 120)
const q127 = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 127) / 127; // (así viaja en la foto: igual en los dos lados)
const lim3 = (v) => (v > 3 ? 3 : v < -3 ? -3 : v);

export class Sim {
  // local = true: hay una gelatina "tuya" (jellies[0], isPlayer) que maneja el teclado
  constructor({ scene, local = false, hooks = {} }) {
    this.scene = scene;
    this.hooks = hooks;
    this.world = new RAPIER.World({ x: 0, y: CONFIG.gravity, z: 0 });
    this.world.timestep = STEP;
    this.time = 0;
    this.stepN = 0;
    // anticipación de los bots (en pasos). 0 = deciden y hacen en el mismo paso (jugando solo). En las salas en
    // línea el servidor la sube (ver botPlanned): los navegadores reciben cada decisión antes de que se ejecute.
    this.botLead = 0;
    this.claimsOk = 0; // golpes de personas a bots que valieron porque los vio su navegador
    this.mode = 'ffa';
    this.arena = null;
    this.arenaName = null;
    this.jellies = BOT_DEFS.map((d, i) => {
      const j = new Jelly({
        ...d, isPlayer: local && i === 0, scene, world: this.world,
        spawn: new THREE.Vector3(d.spawn[0], R + 0.05, d.spawn[2]), yaw: i === 0 ? 0 : Math.atan2(-d.spawn[0], -d.spawn[2]),
      });
      j.id = i;
      j.look = { name: d.name, color: d.color, shape: d.shape, brow: d.brow, tattoo: null };
      return j;
    });
    this.player = local ? this.jellies[0] : null;
    this.pickups = new Pickups(scene);
    this.oil = new OilSlicks(scene);
    this.shots = new Projectiles(scene, this.world);
    this.teams = new TeamLogic(this.jellies, {
      onNewRound: () => {
        // ronda nueva: todos vuelven a su lugar de la formación, con masa 1 (los puntos siguen)
        this.pickups.clear(); this.oil.clear(); this.shots.clear();
        this.hooks.cleared?.();
        for (const j of this.jellies) if (!j.benched && !j.away) j.respawn(this.spawnPoint(j));
      },
      emit: (type, d) => this.hooks.teamEvent?.(type, d),
    });
    this.shots.friendly = (owner, j) => !this.teams.isEnemy(owner, j);
    this.oil.friendly = (owner, j) => !this.teams.isEnemy(owner, j);
    this.game = this._gameApi();
    this.shotHooks = this._shotHooks();
    this.onEat = this._onEat.bind(this);
  }

  isEnemy(a, b) { return this.teams.isEnemy(a, b); }

  // ------------------------------------------------------------ arena y partida
  loadArena(name) {
    if (!BUILDERS[name]) return false;
    this.arena?.dispose();
    this.hooks.event?.('arena ' + name);
    this.arena = BUILDERS[name](this.scene, this.world);
    this.arenaName = name;
    fx.floorAt = this.arena.floorAt;
    this.resetMatch();
    return true;
  }

  // partida de cero en la arena que ya está armada (no la vuelve a construir)
  resetMatch() {
    fx.clear?.();
    this.pickups.clear();
    this.oil.clear();
    this.shots.clear();
    this.hooks.cleared?.();
    const playing = this.arena.players ?? 12; // las que sobran quedan en el banco, fuera del juego
    this.jellies.forEach((j, i) => {
      j.kos = 0; j.falls = 0; j.score = 0;
      j.benched = i >= playing;
      if (j.benched || j.away) { j.kill(); j.respawnAt = Infinity; } else j.respawn(this.spawnPoint(j));
    });
    if (this.mode === 'teams' && !this.arena.tutorial) {
      this.teams.start(this.jellies.filter((j) => !j.benched), this.arena);
      for (const j of this.jellies) if (!j.benched && !j.dead) j.respawn(this.spawnPoint(j)); // cada uno a su lugar
    } else this.teams.stop();
    for (const j of this.jellies) j.maxMass = 1;
    this.hooks.matchReset?.();
  }

  spawnPoint(j) {
    if (this.arena.spawnAt) return this.arena.spawnAt(j); // tutorial: cada una en su lugar
    const tp = this.teams.spawnFor(j); // equipos: formación de cada equipo
    if (tp) return tp;
    const arena = this.arena;
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * arena.R * 0.45;
      _p.set(Math.cos(a) * r, 10, Math.sin(a) * r);
      if (!arena.floorAt(_p.x, _p.z)) continue;
      if (arena.spawnOk && !arena.spawnOk(_p.x, _p.z)) continue; // lejos de las sierras, pozos, géiseres…
      if (this.jellies.every((o) => o === j || o.dead || Math.hypot(o.pos.x - _p.x, o.pos.z - _p.z) > 3.5)) break;
    }
    return _p.clone();
  }

  // ------------------------------------------------------------ KO y puntos
  koValue(killer, victim) {
    const f = Math.pow(victim.mass / killer.mass, CONFIG.koSizeExp);
    return Math.round(CONFIG.koPoints * THREE.MathUtils.clamp(f, 0.25, 10));
  }

  // El KO es de quien lo sacó: el más reciente entre el último golpe (6 s), el último empujón (3 s) y el aceite
  // que pisó (4 s). Si además cayó en una trampa que abrió otro (pozo), se reparten los puntos.
  creditKO(victim) {
    const time = this.time;
    let by = null, at = -Infinity;
    for (const [who, when, win] of [[victim.lastHitBy, victim.lastHitTime, 6], [victim.pushBy, victim.pushTime, 3], [victim.slipBy, victim.slipTime, 4]]) {
      if (who && who !== victim && this.isEnemy(who, victim) && time - when < win && when > at) { by = who; at = when; }
    }
    const killers = by ? [by] : [];
    const trap = victim.trapBy;
    if (trap && trap !== victim && this.isEnemy(trap, victim) && time - victim.trapTime < 3 && !killers.includes(trap)) killers.push(trap);
    for (const killer of killers) {
      killer.kos++;
      const pts = Math.round(this.koValue(killer, victim) / killers.length);
      killer.score += pts;
      const upset = victim.mass / killer.mass >= 1.5;
      if (!killer.dead) fx.popup(killer.pos.clone().setY(killer.pos.y + 2.4 * killer.size), `+${pts} pts${upset ? ' 🏆' : ''}`, upset ? '#ffd21a' : '#7dff8a', true);
      this.hooks.ko?.(killer, victim, pts);
    }
    this.hooks.event?.('KO');
    victim.falls++;
    victim.respawnAt = time + 1.4;
  }

  // API que usan las arenas para sus peligros
  _gameApi() {
    const sim = this;
    return {
      get jellies() { return sim.jellies; },
      get time() { return sim.time; },
      shake(a) { sim.hooks.shake?.(a); },
      splat(j, normal, point, label = '💥') {
        if (j.dead) return;
        sim.hooks.event?.('splat');
        fx.burst(point, j.color, 45, 9, normal, 0.14 * j.size);
        fx.puddle(point, normal, j.color, 1.4 * j.size);
        fx.ring(point, normal, j.color, 4);
        fx.popup(point.clone().setY(point.y + 1.5), label, '#' + j.color.getHexString(), true);
        sfx.splat();
        sim.hooks.shake?.(CONFIG.shake * 2);
        j.kill();
        sim.creditKO(j);
      },
      // sierra: la parte al medio
      slice(j, { normal, along, point }) {
        if (j.dead) return;
        sim.hooks.event?.('corte sierra');
        sim.hooks.slice?.(j, normal, along);
        fx.popup(point.clone().setY(point.y + 2 * j.size), '🪚', '#' + j.color.getHexString(), true);
        sfx.slice();
        sim.hooks.shake?.(0.6);
        j.kill();
        sim.creditKO(j);
        j.respawnAt = sim.time + 3.4; // tiempo para ver cómo quedaste partido
      },
      // clavado en pinches: queda pataleando unos segundos y después revienta
      impale(j, center, inward, t = CONFIG.impaleTime) {
        if (j.dead || j.impaled) return;
        sim.hooks.event?.('clavado');
        j.impale(center, inward, t);
        j.impaleN = inward.clone();
        sim.hooks.impale?.(j, center, inward, t);
        fx.burst(center.clone().addScaledVector(inward, -j.r), j.color, 18, 5, inward, 0.1);
        sfx.stab();
        sim.hooks.shake?.(0.5);
      },
      hazardHit(j, { vx, vy, vz, stun, dmg = 0, color, sound, point }) {
        const mult = (1 + (CONFIG.instKnock * j.damage) / 100) / Math.pow(j.mass, 0.35);
        const k = Math.min(1.8, 0.6 + 0.4 * mult);
        j.knockback(vx * k, vy, vz * k, stun);
        if (dmg) j.damage = Math.min(100, j.damage + dmg);
        if (point) {
          _n.set(vx, 0, vz).normalize().negate();
          j.dent(_n, 12, 0.25);
          sim.hooks.dent?.(j, _n, 12, 0.25);
          fx.burst(point, color, 14, 7, null, 0.08);
          fx.ring(point, _n.negate(), color, 2.2);
        }
        if (sound) sfx[sound](12);
        sim.hooks.shake?.(0.2);
      },
    };
  }

  // ------------------------------------------------------------ armas y poderes
  // poderes de las bolitas amarillas: se activan solos al agarrarlos
  applyPower(j, type) {
    if (j.dead || j.impaled) return;
    const P = POWERS[type];
    switch (type) {
      case 'turbo': case 'strength': j.buffs[type] = CONFIG.buffTime; break;
      case 'heal': j.damage = 0; break;
      case 'feast': j.mass += CONFIG.pickupMass * 10; j.squashVel += 6; break;
    }
    fx.popup(j.pos.clone().setY(j.pos.y + 2 * j.size), P.icon, '#ffe14d');
    fx.ring(j.pos.clone().setY(0.1), new THREE.Vector3(0, 1, 0), new THREE.Color('#ffd21a'), 2.5 * j.size);
    sfx.use();
  }

  // armas para tirar: cada una se acumula por separado y tiene su tecla
  giveWeapon(j, type) {
    j.ammo[type] += type === 'spit' ? CONFIG.spitCharges : CONFIG.oilCharges;
    const P = POWERS[type];
    fx.popup(j.pos.clone().setY(j.pos.y + 2 * j.size), `${P.icon}×${j.ammo[type]}`, '#ffe14d');
    sfx.use();
  }

  // a quién apuntar: el rival más cercano dentro de un cono adelante (ayuda de puntería)
  aimTarget(j, range, cone = 0.82, f = j.facing) {
    let best = null, bs = Infinity;
    for (const o of this.jellies) {
      if (o === j || o.dead || o.impaled || !this.isEnemy(j, o)) continue;
      const dx = o.pos.x - j.pos.x, dz = o.pos.z - j.pos.z, d = Math.hypot(dx, dz);
      if (d < 1 || d > range) continue;
      const dot = (dx * f.x + dz * f.z) / d;
      if (dot < cone) continue;
      const score = d * (2 - dot);
      if (score < bs) { bs = score; best = o; }
    }
    return best;
  }

  throwWeapon(j, type) {
    if (!(j.ammo[type] > 0) || j.throwCd > 0 || j.dead || j.impaled || j.stunned || j.daze > 0) return;
    const f = j.facing;
    const from = j.pos.clone().addScaledVector(f, j.r * 0.9).setY(j.pos.y + j.r * 0.25);
    if (type === 'spit') {
      const sp = CONFIG.spitSpeed, g = -9;
      const tgt = this.aimTarget(j, CONFIG.spitRange);
      let aim;
      if (tgt) {
        const v = tgt.body.linvel(); // apunta adonde va a estar
        const T = tgt.pos.distanceTo(from) / sp;
        aim = new THREE.Vector3(tgt.pos.x + v.x * T, tgt.pos.y, tgt.pos.z + v.z * T);
      } else aim = from.clone().addScaledVector(f, 18).setY(from.y);
      const dx = aim.x - from.x, dz = aim.z - from.z, dh = Math.hypot(dx, dz) || 1;
      const T = dh / sp;
      const vel = new THREE.Vector3((dx / dh) * sp, (aim.y - from.y) / T - 0.5 * g * T, (dz / dh) * sp);
      this.shots.spawn('spit', j, from, vel);
      j.squashVel -= 3; j.stretchVel += 5;
      j.dent(f.clone().negate(), 4, 0.5);
      sfx.spit();
    } else {
      // aceite: se tira PARA ATRÁS, a pocos metros (sin puntería)
      const back = f.clone().negate();
      const behind = j.pos.clone().addScaledVector(back, j.r * 0.9).setY(j.pos.y + j.r * 0.4);
      const T = 0.4, g = -30;
      const land = j.pos.clone().addScaledVector(back, j.r + CONFIG.oilThrowDist).setY(0);
      const vel = new THREE.Vector3((land.x - behind.x) / T, (land.y - behind.y) / T - 0.5 * g * T, (land.z - behind.z) / T);
      this.shots.spawn('oil', j, behind, vel);
      j.dent(back, 4, 0.5);
      sfx.whoosh();
    }
    j.throwCd = 0.35;
    j.ammo[type]--;
    this.hooks.thrown?.(j, type);
  }

  _shotHooks() {
    const sim = this;
    return {
      hit(p, j) {
        if (p.kind === 'spit') {
          // chorro: SIEMPRE marea
          const n = p.vel.clone().setY(0).normalize();
          const k = CONFIG.spitKnock / Math.sqrt(j.mass);
          j.knockback(n.x * k, 2, n.z * k, 0.2);
          j.dizzy(CONFIG.dazeMin + Math.random() * (CONFIG.dazeMax - CONFIG.dazeMin));
          j.lastHitBy = p.owner; j.lastHitTime = sim.time;
          j.dent(n.clone().negate(), 10, 0.3);
          sim.hooks.dent?.(j, n.clone().negate(), 10, 0.3);
          fx.burst(p.pos, p.color, 22, 5, n, 0.09);
          fx.ring(p.pos, n, p.color, 1.8);
          sfx.splosh(); sfx.dizzy();
          sim.hooks.spitHit?.(p.owner, j);
        } else {
          sim.oil.spawn(j.pos.x, j.pos.z, p.owner); // aceite que le cae encima: mancha a sus pies
          fx.burst(p.pos, p.color, 16, 4, null, 0.12);
          sfx.splosh();
        }
      },
      land(p, point, normal) {
        if (p.kind === 'spit') {
          fx.burst(point, p.color, 12, 3, normal, 0.07);
          if (normal.y > 0.6) fx.puddle(point.clone().setY(point.y + 0.02), normal, p.color, 0.5);
          sfx.splosh();
        } else {
          if (normal.y < 0.6) point.addScaledVector(normal.setY(0).normalize(), CONFIG.oilRadius * 0.6); // contra una pared: al pie
          if (sim.arena.floorAt(point.x, point.z)) sim.oil.spawn(point.x, point.z, p.owner);
          fx.burst(point.clone().setY(0.4), p.color, 14, 4, null, 0.12, true);
          sfx.splosh();
        }
      },
    };
  }

  // ------------------------------------------------------------ golpes entre gelatinas
  // fuerza  = (knockBase + choque × knockScale) × relación^massExp × (1 + instKnock × inestabilidad) × picada × fuerza extra
  // firmeza que saca = instPerHit × (choque/20, máx 1.5) × relación^instMassExp × picada
  static hitForce(am, vm, dmg, closing, airDash, strong, dazed) {
    const ratio = am / vm;
    const air = airDash ? CONFIG.airDashBonus : 1;
    const raw = (CONFIG.knockBase + closing * CONFIG.knockScale) * Math.pow(ratio, CONFIG.massExp)
      * (1 + (CONFIG.instKnock * dmg) / 100) * (dazed ? 1.25 : 1) * air * (strong ? CONFIG.strengthMul : 1);
    const K = Math.min(CONFIG.knockMax, raw);
    const loss = Math.min(60, Math.round(CONFIG.instPerHit * Math.min(1.5, closing / 20) * Math.pow(ratio, CONFIG.instMassExp) * air));
    return { K, loss, raw };
  }

  // closingIn: la velocidad de choque ya calculada (un golpe que vio el navegador del atacante: applyClaims)
  tryHit(att, vic, n, closingIn) {
    if (!att.dashing || vic.dead || !this.isEnemy(att, vic)) return;
    const closing = closingIn ?? att.vBefore.dot(n) - vic.vBefore.dot(n);
    if (closing < 6) return;
    const time = this.time;
    const nh = new THREE.Vector3(n.x, 0, n.z).normalize();
    const back = nh.clone().negate();
    const { K, loss } = Sim.hitForce(att.mass, vic.mass, vic.damage, closing, att.airDash, att.buffs.strength > 0, vic.daze > 0);
    const air = att.airDash ? CONFIG.airDashBonus : 1;
    vic.knockback(nh.x * K, 3 + K * CONFIG.knockLift, nh.z * K, CONFIG.stunBase + K * CONFIG.stunPerForce);
    vic.damage = Math.min(100, vic.damage + loss);
    vic.lastHitBy = att;
    vic.lastHitTime = time;
    if (K >= 10) { vic.flyUntil = time + 0.9; vic.flyBy = att; } // sale volando: si choca a otro, le pega (carambola)
    att.dashTimer = 0;
    const recoil = 4 / Math.sqrt(att.mass);
    att.knockback(-nh.x * recoil, 3, -nh.z * recoil, 0.12);
    this.hooks.event?.('golpe');
    const contact = att.pos.clone().addScaledVector(nh, att.r);
    // golpe fuerte → muchas chances de dejarlo mareado
    let dazed = false;
    if (K >= CONFIG.dazeForce && vic.daze <= 0) {
      const over = (K - CONFIG.dazeForce) / 15;
      if (Math.random() < Math.min(0.9, 0.5 + over * 0.5)) {
        vic.dizzy(CONFIG.dazeMin + (CONFIG.dazeMax - CONFIG.dazeMin) * Math.min(1, over));
        dazed = true;
      }
    }
    const hit = { att, vic, contact, nh, K, air: air > 1, dazed, chain: false };
    this.hooks.hitFx?.(hit); // servidor: un evento 'hit' (los efectos los arma cada navegador)
    this.hooks.mute?.(true);
    hitEffects(hit, (a) => this.hooks.shake?.(a));
    this.hooks.mute?.(false);
    // golpe fuerte: le saca masa al rival (blobcitos que salen volando)
    const lose = Math.min(3, Math.floor(K / 14));
    for (let i = 0; i < lose && vic.mass - CONFIG.pickupMass >= 1; i++) {
      vic.mass -= CONFIG.pickupMass;
      const a = Math.random() * Math.PI * 2;
      this.pickups.eject(vic.pos.clone().setY(vic.pos.y + vic.r), new THREE.Vector3(nh.x * 6 + Math.cos(a) * 3, 8 + Math.random() * 4, nh.z * 6 + Math.sin(a) * 3), vic);
    }
    this.hooks.hit?.(att, vic);
  }

  // Carambola: una gelatina que sale volando por un golpe le pega a la que choca (el KO es de quien empezó todo)
  chainHit(src, dst, n, closing) {
    const time = this.time;
    if (dst === src.flyBy || time < (dst.chainUntil || 0) || !this.isEnemy(src.flyBy || src, dst)) return;
    const nh = new THREE.Vector3(n.x, 0, n.z).normalize();
    const { K, loss } = Sim.hitForce(src.mass, dst.mass, dst.damage, closing, false, false, dst.daze > 0);
    dst.knockback(nh.x * K, 3 + K * CONFIG.knockLift, nh.z * K, CONFIG.stunBase + K * CONFIG.stunPerForce);
    dst.damage = Math.min(100, dst.damage + loss);
    dst.lastHitBy = src.flyBy || src;
    dst.lastHitTime = time;
    dst.chainUntil = time + 0.4;
    if (K >= 10) { dst.flyUntil = time + 0.9; dst.flyBy = dst.lastHitBy; }
    const v = src.body.linvel();
    src.body.setLinvel({ x: v.x * 0.45, y: v.y, z: v.z * 0.45 }, true);
    src.flyUntil = 0;
    const hit = { att: src, vic: dst, contact: src.pos.clone().addScaledVector(nh, src.r), nh, K, air: false, dazed: false, chain: true };
    this.hooks.hitFx?.(hit);
    this.hooks.mute?.(true);
    hitEffects(hit, (a) => this.hooks.shake?.(a));
    this.hooks.mute?.(false);
  }

  // EN LÍNEA, a favor del que pega: si el navegador de una persona vio que su embestida le pegó a un BOT, el golpe
  // vale (así nunca "le pegás y no pasa nada"), siempre que sea creíble acá: sigue embistiendo, el bot está cerca
  // (lo que la red pudo correrlo) y el choque no es más fuerte que lo posible. Entre personas decide el servidor.
  // Va antes que checkHits: si acá también se tocan, el golpe sale con la dirección y fuerza que vio esa persona.
  applyClaims() {
    for (const a of this.jellies) {
      const cl = a.claim;
      if (!cl) continue;
      a.claim = null;
      const v = this.jellies[cl.v];
      const why = !v || v === a || v.human || v.benched ? 'víctima' : v.dead || v.impaled ? 'muerta' : a.dead || a.impaled ? 'atacante' : !a.dashing ? (a.windup > 0 ? 'cargando' : a.stun > 0 ? 'golpeado' : 'no embiste') : !this.isEnemy(a, v) ? 'equipo' : a.pos.distanceTo(v.pos) > a.r + v.r + CLAIM_REACH ? 'lejos' : null;
      if (why) { if (CLAIM_DEBUG) console.log('[golpe avisado] rechazado:', why, v && !v.dead ? (a.pos.distanceTo(v.pos) - a.r - v.r).toFixed(2) : ''); continue; }
      const l = Math.hypot(cl.nx, cl.nz);
      if (!(l > 0.5)) continue;
      const n = _cn.set(cl.nx / l, 0, cl.nz / l);
      const closing = Math.min(cl.c, a.vBefore.length() + v.vBefore.length() + 4);
      if (!(closing >= 6)) continue;
      this.tryHit(a, v, n, closing);
      this.claimsOk++;
    }
  }

  checkHits() {
    const js = this.jellies, time = this.time;
    for (let i = 0; i < js.length; i++) {
      for (let k = i + 1; k < js.length; k++) {
        const a = js[i], b = js[k];
        if (a.dead || b.dead || a.impaled || b.impaled) continue;
        const n = _hn.subVectors(b.pos, a.pos);
        const d = n.length();
        if (d > a.r + b.r + 0.25 || d < 1e-4) continue;
        n.divideScalar(d);
        const aDash = a.dashing, bDash = b.dashing;
        if (aDash) this.tryHit(a, b, n);
        if (bDash) this.tryHit(b, a, n.clone().negate());
        if (!aDash && !bDash) {
          const rel = a.vBefore.dot(n) - b.vBefore.dot(n);
          if (rel > 7 && time < (a.flyUntil || 0)) this.chainHit(a, b, n, rel);
          else if (rel > 7 && time < (b.flyUntil || 0)) this.chainHit(b, a, n.clone().negate(), rel);
          else if (rel > 7) { this.hooks.mute?.(true); sfx.bump(rel); this.hooks.mute?.(false); }
          // empujón (sin embestir): el que se mete contra el otro queda anotado como "quien lo empujó"
          const va = a.vBefore.dot(n), vb = -b.vBefore.dot(n);
          if (va > 1.5 && va > vb) { if (this.isEnemy(a, b)) { b.pushBy = a; b.pushTime = time; } }
          else if (vb > 1.5 && this.isEnemy(a, b)) { a.pushBy = b; a.pushTime = time; }
        }
      }
    }
  }

  checkSplat(j, mag) {
    if (!CONFIG.wallSplat || j.dead || j.impaled || !j.stunned || mag < CONFIG.splatImpulse) return;
    _n.copy(j.contact).divideScalar(mag);
    if (Math.abs(_n.y) > 0.6) return;
    if (this.jellies.some((o) => o !== j && !o.dead && o.pos.distanceTo(j.pos) < j.r + o.r + 0.4)) return;
    this.game.splat(j, _n.clone(), j.pos.clone().addScaledVector(_n, -j.r));
  }

  // ------------------------------------------------------------ bots
  _safe(x, z, dx, dz, dist) {
    const a = this.arena;
    return a.safeAt ? a.safeAt(x + dx * dist, z + dz * dist) : a.floorAt(x + dx * dist, z + dz * dist);
  }

  // los bots deciden 30 veces por segundo, cada uno en un paso distinto; entre decisiones siguen el rumbo
  botCmd(j, i) {
    if (!j.ai || (this.stepN + i) % BOT_EVERY === 0) return this.botThink(j, STEP * BOT_EVERY);
    const c = j.ai.cmd;
    c.jump = false; c.dash = false; c.throw = null;
    return c;
  }

  // EN LÍNEA: el bot decide AHORA lo que va a hacer dentro de botLead pasos (mirando dónde van a estar todos para
  // entonces). La decisión viaja en la foto y llega a cada navegador ANTES de que se ejecute: así cada navegador
  // mueve a los bots igual que el servidor, con sus embestidas y saltos en el mismo paso exacto, en vez de
  // adivinarlos tarde (eso eran los golpes "que llegaban de la nada" y los saltos de lugar de los bots).
  // j.plan: [{ at (paso del servidor en que se hace), mx, mz, jumpHeld, sprint, jump, dash, throw }…]
  botPlanned(j, i) {
    if (j.dead) { j.plan = null; return STILL; }
    const plan = (j.plan ||= []);
    if (!j.ai || (this.stepN + i) % BOT_EVERY === 0) {
      const L = this.botLead;
      const d = this.botThink(j, STEP * BOT_EVERY, L * STEP);
      const at = this.stepN + L;
      while (plan.length && plan[plan.length - 1].at >= at) plan.pop(); // (bajó la anticipación: lo nuevo manda)
      plan.push({ at, mx: q127(d.mx), mz: q127(d.mz), jumpHeld: d.jumpHeld, sprint: d.sprint, jump: d.jump, dash: d.dash, throw: d.throw });
    }
    while (plan.length > 1 && plan[1].at <= this.stepN) plan.shift();
    const e = plan.length && plan[0].at <= this.stepN ? plan[0] : null;
    const c = (j.planCmd ||= { ...STILL });
    const now = !!e && e.at === this.stepN;
    c.mx = e ? e.mx : 0; c.mz = e ? e.mz : 0;
    c.jumpHeld = !!e && e.jumpHeld; c.sprint = !!e && e.sprint;
    c.jump = now && e.jump; c.dash = now && e.dash; c.throw = now ? e.throw : null;
    return c;
  }

  // T: segundos a futuro en que se va a ejecutar lo que se decide (las posiciones se proyectan con la velocidad)
  botThink(b, dt, T = 0) {
    const arena = this.arena, jellies = this.jellies;
    const ai = (b.ai ||= { t: 0, wx: 0, wz: 0, dashWait: 1 + Math.random() * 2, hold: 0, pounce: 0, cmd: { mx: 0, mz: 0, jump: false, jumpHeld: false, dash: false, sprint: false } });
    const cmd = ai.cmd;
    cmd.jump = false; cmd.dash = false; cmd.sprint = false; cmd.throw = null;
    ai.dashWait -= dt; ai.t -= dt; ai.hold -= dt;
    const bv = T ? b.body.linvel() : null;
    const px = T ? b.pos.x + lim3(bv.x * T) : b.pos.x, pz = T ? b.pos.z + lim3(bv.z * T) : b.pos.z;
    let mx = 0, mz = 0;

    let food = null, fd = Infinity; // blobcito más cercano
    for (const p of this.pickups.list) {
      if (p.state === 'eaten') continue;
      const d = Math.hypot(p.mesh.position.x - px, p.mesh.position.z - pz);
      if (d < fd) { fd = d; food = p; }
    }
    let tgt = null, td = Infinity, tx = 0, tz = 0; // rival más cercano (a los humanos los buscan un poco más)
    const aggr = CONFIG.botsAggressive || this.teams.active;
    for (const o of jellies) {
      if (o === b || o.dead || !this.isEnemy(b, o)) continue;
      let ox = o.pos.x, oz = o.pos.z;
      if (T) { const v = o.body.linvel(); ox += lim3(v.x * T); oz += lim3(v.z * T); }
      const d = Math.hypot(ox - px, oz - pz) * (o.isPlayer || o.human ? 0.7 : 1);
      if (d < td) { td = d; tgt = o; tx = ox; tz = oz; }
    }
    // trampa: si el rival está sobre un pozo y tengo el botón cerca, voy a embestirlo
    let trap = null;
    if (aggr && tgt && arena.traps) {
      for (const tr of arena.traps) {
        if (!tr.ready()) continue;
        if (Math.hypot(tx - tr.x, tz - tr.z) < tr.r + 1.5 && Math.hypot(tr.button.x - px, tr.button.z - pz) < 16) { trap = tr; break; }
      }
    }
    const goFood = !trap && food && (!aggr ? fd < 18 : fd < Math.min(8, td * 0.5));
    if (trap) {
      const dx = trap.button.x - px, dz = trap.button.z - pz, d = Math.hypot(dx, dz) || 1;
      mx = dx / d; mz = dz / d;
      const f = b.facing;
      if (d < 5 && f.x * mx + f.z * mz > 0.9 && b.dashCd <= 0 && (!T || b.energy >= CONFIG.dashEnergy + 6)) cmd.dash = true;
      else if (d > 8) cmd.sprint = b.energy > 50;
    } else if (goFood) {
      const dx = food.mesh.position.x - px, dz = food.mesh.position.z - pz;
      mx = dx / (fd || 1); mz = dz / (fd || 1);
      if (!aggr) { mx *= 0.7; mz *= 0.7; }
      if (fd > 9 && b.energy > 60) cmd.sprint = true;
    } else if (!aggr || !tgt) {
      if (ai.t <= 0) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * arena.R * 0.5;
        ai.wx = Math.cos(a) * r; ai.wz = Math.sin(a) * r; ai.t = 2 + Math.random() * 3;
      }
      const dx = ai.wx - px, dz = ai.wz - pz, d = Math.hypot(dx, dz);
      if (d > 0.8) { mx = (dx / d) * 0.4; mz = (dz / d) * 0.4; }
    } else {
      const dx = tx - px, dz = tz - pz, d = Math.hypot(dx, dz) || 1;
      mx = dx / d; mz = dz / d;
      if (d > 12 && b.energy > 60) cmd.sprint = true;
      const f = b.facing;
      // (en línea, con energía de sobra: si no, al ejecutarlo la energía queda justo en el límite y en un lado sale
      // y en el otro no)
      if (d < 7.5 && d > 1.5 && f.x * mx + f.z * mz > 0.93 && ai.dashWait <= 0 && b.dashCd <= 0 && ai.pounce <= 0 && (!T || b.energy >= CONFIG.dashEnergy + 6)) {
        if (Math.random() < 0.35 && b.grounded) { cmd.jump = true; ai.hold = 0.25; ai.pounce = 0.32; } // salta primero: picada
        else { cmd.dash = true; ai.dashWait = 0.8 + Math.random() * 2.2; }
      }
      if (tgt.dashing && d < 5 && Math.random() < 0.04) { cmd.jump = true; ai.hold = 0.3; }
    }
    // chorro: a los que tiene adelante y lejos
    if (b.ammo.spit > 0 && tgt && b.throwCd <= 0 && aggr) {
      const dx = tx - px, dz = tz - pz, d = Math.hypot(dx, dz) || 1;
      const face = (b.facing.x * dx + b.facing.z * dz) / d;
      if (d > 7 && d < CONFIG.spitRange * 0.8 && face > 0.9 && Math.random() < dt * 1.5) cmd.throw = 'spit';
    }
    // aceite: cuando alguien lo viene persiguiendo de atrás
    if (b.ammo.oil > 0 && b.throwCd <= 0 && !cmd.throw) {
      for (const o of jellies) {
        if (o === b || o.dead || !this.isEnemy(b, o)) continue;
        const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
        if (d < 3 || d > 14) continue;
        const behind = (b.facing.x * dx + b.facing.z * dz) / d < -0.6;
        const v = o.body.linvel();
        const chasing = -(v.x * dx + v.z * dz) / d > 4;
        if (behind && chasing && Math.random() < dt * 3) { cmd.throw = 'oil'; break; }
      }
    }
    if (ai.pounce > 0) {
      ai.pounce -= dt;
      if (ai.pounce <= 0) { if (!T || b.energy >= CONFIG.dashEnergy + 6) cmd.dash = true; ai.dashWait = 1 + Math.random() * 2; }
    }

    // destrabarse: encimado sobre otro (o debajo), o queriendo avanzar sin moverse → sale hacia un costado y salta
    let stack = null;
    for (const o of jellies) {
      if (o === b || o.dead) continue;
      const h = Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z);
      if (h < (b.r + o.r) * 0.75 && Math.abs(b.pos.y - o.pos.y) > Math.min(b.r, o.r) * 0.6) { stack = o; break; }
    }
    const v = b.body.linvel(), sp = Math.hypot(v.x, v.z);
    ai.stuck = Math.hypot(mx, mz) > 0.3 && sp < 0.6 ? (ai.stuck || 0) + dt : Math.max(0, (ai.stuck || 0) - dt * 2);
    if ((stack || ai.stuck > 1) && !(ai.escapeT > 0)) {
      let ex = stack ? b.pos.x - stack.pos.x : 0, ez = stack ? b.pos.z - stack.pos.z : 0;
      const el = Math.hypot(ex, ez);
      if (el < 0.2) { const a = Math.random() * Math.PI * 2; ex = Math.cos(a); ez = Math.sin(a); } else { ex /= el; ez /= el; }
      ai.ex = ex; ai.ez = ez; ai.escapeT = 0.8; ai.stuck = 0;
      if (b.grounded || (stack && b.pos.y > stack.pos.y)) { cmd.jump = true; ai.hold = 0.15; }
    }
    if (ai.escapeT > 0) { ai.escapeT -= dt; mx = ai.ex; mz = ai.ez; cmd.dash = false; cmd.sprint = false; }

    // no tirarse al vacío: mirar adelante
    const ml = Math.hypot(mx, mz);
    if (ml > 0.05) {
      const ux = mx / ml, uz = mz / ml, ahead = 2.5 + b.r;
      if (!this._safe(px, pz, ux, uz, ahead)) {
        let fixed = false;
        for (const ang of [0.8, -0.8, 1.6, -1.6]) {
          const c = Math.cos(ang), s = Math.sin(ang);
          const rx = ux * c - uz * s, rz = ux * s + uz * c;
          if (this._safe(px, pz, rx, rz, ahead)) { mx = rx * ml; mz = rz * ml; fixed = true; break; }
        }
        if (!fixed) { mx = -px; mz = -pz; }
        if (!trap) cmd.dash = false;
      }
    }
    const rc = Math.hypot(px, pz);
    if (rc > arena.R - 3 && !trap) { const k = ((rc - (arena.R - 3)) / 3) * 1.2; mx -= (px / rc) * k; mz -= (pz / rc) * k; }
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    cmd.mx = mx; cmd.mz = mz; cmd.jumpHeld = ai.hold > 0;
    return cmd;
  }

  // la gelatina de práctica del tutorial: vuelve a la diana, mira al jugador y se le resetea la firmeza
  dummyThink(j) {
    const player = this.player;
    const dx = DUMMY_HOME.x - j.pos.x, dz = DUMMY_HOME.z - j.pos.z, d = Math.hypot(dx, dz);
    const settled = j.sinceHit > 1.5 && j.daze <= 0 && !j.stunned;
    if (settled) j.damage = 0;
    const c = this._dummyCmd ||= { ...STILL };
    if (settled && d > 0.8) {
      const k = Math.min(0.45, d * 0.2) / d;
      c.mx = dx * k; c.mz = dz * k;
    } else {
      c.mx = c.mz = 0;
      if (settled && player && !player.dead) j.targetYaw = Math.atan2(player.pos.x - j.pos.x, player.pos.z - j.pos.z);
    }
    return c;
  }

  // ------------------------------------------------------------ comer
  _onEat(j, m, power) {
    this.hooks.ate?.(j, power);
    this.hooks.mute?.(false); // (en el servidor, lo que pasa al comer sí se manda)
    if (power) {
      fx.burst(j.pos.clone().setY(j.pos.y + j.r * 0.5), new THREE.Color('#ffd21a'), 8, 3, null, 0.07);
      soundAt(j, () => sfx.power());
      if (POWERS[power].throw) this.giveWeapon(j, power); else this.applyPower(j, power);
    } else {
      j.feed(m);
      soundAt(j, () => sfx.gulp());
      fx.burst(j.pos.clone().setY(j.pos.y + j.r * 0.5), new THREE.Color('#ffffff'), 4, 2.5, null, 0.06);
    }
    this.hooks.mute?.(true);
  }

  // ------------------------------------------------------------ un paso de 1/120 s
  // cmdFor(j) → comando de un humano (o null: lo maneja un bot) · perfAdd(parte, ms) opcional
  step(cmdFor, { doSkin = true, perfAdd = null } = {}) {
    const H = this.hooks;
    this.time += STEP;
    this.stepN++;
    setSimStep(this.stepN);
    const arena = this.arena, jellies = this.jellies;
    arena.preStep(STEP, this.time);
    this.oil.step(STEP, jellies, this.time);
    for (const j of jellies) {
      if (j.justSlipped) {
        j.justSlipped = false;
        fx.popup(j.pos.clone().setY(j.pos.y + 1.8 * j.size), '🛢️', '#c8b27a');
        sfx.slip();
      }
      if (!j.dead) j.score += CONFIG.alivePoints * STEP;
    }
    let pt = performance.now();
    const tick = perfAdd ? (key) => { const n = performance.now(); perfAdd(key, n - pt); pt = n; } : () => {};
    const frozen = this.teams.frozen;
    for (let i = 0; i < jellies.length; i++) {
      const j = jellies[i];
      if (j.benched || j.away) continue;
      // la tecla de un humano se consume SIEMPRE, aunque esté quieto (¡YA!) o muerto: si no, se le juntan en la
      // cola del servidor y todo lo que hace después llega con atraso
      let cmd = cmdFor(j);
      if (frozen) { cmd = STILL; j.plan = null; } // equipos: quietos hasta el ¡YA!
      else if (!cmd) cmd = j.dummy ? this.dummyThink(j) : this.botLead > 0 ? this.botPlanned(j, i) : this.botCmd(j, i);
      j.lastCmd = cmd; // (se manda a los navegadores: así predicen hacia dónde va cada uno)
      j.claim = cmd.claim || null; // en línea: "le pegué a ese bot" (lo vio el navegador de esa persona, ver applyClaims)
      H.who?.(j);
      j.control(STEP, cmd);
      j.throwCd = Math.max(0, j.throwCd - STEP);
      H.who?.(null);
      if (cmd.throw) this.throwWeapon(j, cmd.throw);
    }
    tick('bots');
    this.world.step();
    tick('physics');
    const mags = jellies.map((j) => { H.who?.(j); const m = j.postStep(STEP); H.who?.(null); return m; });
    this.applyClaims();
    this.checkHits();
    jellies.forEach((j, i) => this.checkSplat(j, mags[i]));
    tick('hits');
    arena.postStep(STEP, this.game);
    tick('arena');
    H.mute?.(true); // los brillos de las bolitas los dibuja cada navegador
    this.pickups.step(STEP, arena, jellies, this.onEat);
    H.mute?.(false);
    this.shots.step(STEP, jellies, this.shotHooks);
    tick('pickups');
    for (const j of jellies) {
      if (!j.dead && j.pos.y < -14) {
        fx.popup(j.pos.clone().setY(-2), '💀', '#' + j.color.getHexString(), true);
        sfx.ko();
        j.kill();
        this.creditKO(j);
      }
      if (j.impaled) {
        j.impaledT -= STEP;
        if (Math.random() < STEP * 6) { H.mute?.(true); fx.burst(j.pos.clone().setY(j.pos.y - j.r * 0.3), j.color, 1, 1, null, 0.07); H.mute?.(false); } // gotea (decoración)
        if (j.impaledT <= 0) {
          const n = j.impaleN || new THREE.Vector3(0, 1, 0); // ¡revienta!
          fx.burst(j.pos, j.color, 40, 9, n, 0.13 * j.size);
          fx.puddle(new THREE.Vector3(j.pos.x, 0.02, j.pos.z), new THREE.Vector3(0, 1, 0), j.color, 1.6 * j.size);
          fx.popup(j.pos.clone().setY(j.pos.y + 1.5), '💥', '#' + j.color.getHexString(), true);
          sfx.pop();
          H.shake?.(0.4);
          j.kill();
          this.creditKO(j);
        }
      }
      if (j.dead && !j.benched && !j.away && this.time > j.respawnAt && this.teams.canRespawn(j)) j.respawn(this.spawnPoint(j));
      if (!j.dead && j.mass > (j.maxMass || 0)) j.maxMass = j.mass;
      if (doSkin) j.skin(STEP);
    }
    this.teams.update(STEP);
    tick('skinSim');
  }

  // ------------------------------------------------------------ salas: jugadores reales que entran y salen
  // un humano ocupa el lugar de un bot: el bot desaparece (de un "puf") y el humano aparece fresco
  // (en equipos, en su lugar de la formación si la ronda no empezó; si no, en un lugar seguro de su lado)
  takeSlot(j, look) {
    const wasAlive = !j.dead;
    if (wasAlive) {
      fx.burst(j.pos.clone(), j.color, 24, 6, null, 0.1);
      sfx.pop();
      j.kill();
    }
    j.human = true; j.ai = null; j.plan = null; j.away = false;
    this.applyLook(j, look);
    j.kos = 0; j.falls = 0; j.score = 0; j.maxMass = 1;
    if (this.teams.active) this.teams.join(j);
    if (!this.teams.active || wasAlive || this.teams.phase !== 'play') j.respawn(this.spawnPoint(j));
    else { j.respawnAt = Infinity; } // equipos con la ronda en juego y su lugar ya estaba afuera: espera la próxima
  }

  // el humano se fue: vuelve a ser un bot (con otro nombre y su color de bot)
  releaseSlot(j) {
    j.human = false;
    const d = BOT_DEFS[j.id];
    const used = new Set(this.jellies.map((o) => o.name));
    const name = SPARE_NAMES.find((n) => !used.has(n)) || d.name;
    this.applyLook(j, { name, color: d.color, shape: d.shape, brow: d.brow, tattoo: null });
  }

  applyLook(j, look) {
    j.look = { ...j.look, ...look };
    j.name = j.look.name;
    if (look.shape) j.setShape(look.shape);
    j.setLook({ color: look.color, tattoo: look.tattooCanvas !== undefined ? look.tattooCanvas : undefined });
    if (this.teams.active && j.team != null) {
      this.teams.orig.set(j, look.color || '#' + j.color.getHexString());
      j.setLook({ color: TEAM_COLORS[j.team] });
    }
  }
}
