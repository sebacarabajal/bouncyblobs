import * as THREE from 'three';
import { CONFIG } from './config.js';
import { fx } from './fx.js';
import { randomPower } from './powers.js';

// Gelatinitas blancas que caen del cielo y se absorben al pasarles por encima (tipo agar.io),
// y bolitas especiales doradas (poderes).
// Se dibujan "instanciadas": todas las blancas en una sola pasada, todas las doradas en otra y todas las
// sombras en otra (antes cada bolita eran 3 objetos: con 125 bolitas, ~375 dibujos por frame).
const PR = 0.32;
const PR_POWER = PR * 1.15;
const MAX_WHITE = 400, MAX_POWER = 200;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _hide = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color('#f4f0ff');
const YELLOW = new THREE.Color('#ffd21a');

export class Pickups {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.timer = 0;
    this.nextId = 0;
    // en línea, el navegador sólo dibuja: las bolitas las crea y las come el servidor (remote = true)
    this.remote = false;
    this.onSpawn = null; // (p) => … el servidor avisa a los jugadores
    this.onEaten = null; // (p, j) => …
    // blanca: bolita lechosa, mate con un barniz suave (no tan clara: si no, el brillo del escenario la quema
    // y se ve como un círculo plano que brilla)
    const geo = new THREE.SphereGeometry(PR, 22, 16);
    geo.translate(0, PR, 0);
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#b9b0c9', roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.6, sheenRoughness: 0.5, sheenColor: '#ffffff',
    });
    this.white = new THREE.InstancedMesh(geo, mat, MAX_WHITE);
    // especial: bolita dorada de metal pulido (refleja el escenario), con un brillo cálido suave
    const pgeo = new THREE.SphereGeometry(PR_POWER, 26, 18);
    pgeo.translate(0, PR_POWER, 0);
    const pmat = new THREE.MeshPhysicalMaterial({
      color: '#ffc23a', metalness: 0.9, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.1, emissive: '#ff9a00', emissiveIntensity: 0.15,
    });
    this.gold = new THREE.InstancedMesh(pgeo, pmat, MAX_POWER);
    // sombra de las que caen (para saber dónde caen)
    const sgeo = new THREE.CircleGeometry(PR * 1.1, 20);
    sgeo.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(sgeo, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }), MAX_WHITE + MAX_POWER);
    this.shadows.renderOrder = 1;
    for (const im of [this.white, this.gold, this.shadows]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
    }
    this.white.castShadow = this.gold.castShadow = true;
  }

  // cada bolita guarda su posición/escala en un Object3D suelto (no está en la escena): "mesh" por compatibilidad
  _make(pos, vel, power = null, id = null) {
    const m = new THREE.Object3D();
    m.position.copy(pos);
    const shadow = { visible: false, position: new THREE.Vector3(), scale: 1 };
    const p = { id: id ?? ++this.nextId, mesh: m, shadow, vel: vel.clone(), state: 'fall', t: 0, age: 0, immune: null, phase: Math.random() * 6, target: null, mass: CONFIG.pickupMass, power };
    this.list.push(p);
    this.onSpawn?.(p);
    return p;
  }

  // en línea: bolita que creó el servidor (con su id) · estado 'rest' si ya estaba en el piso
  // age: hace cuánto la creó el servidor (se adelanta la caída hasta el presente que se está mostrando)
  addRemote({ id, x, y, z, vx = 0, vy = 0, vz = 0, power = null, rest = false, age = 0 }) {
    if (this.list.some((p) => p.id === id)) return;
    const p = this._make(_v.set(x, y, z), new THREE.Vector3(vx, vy, vz), power, id);
    if (rest) { p.state = 'rest'; p.mesh.position.y = 0; p.t = 1; return; }
    if (age > 0) {
      const g = CONFIG.gravity * 0.7, m = p.mesh.position;
      m.x += vx * age; m.z += vz * age;
      m.y += vy * age + 0.5 * g * age * age;
      p.vel.y += g * age;
      if (m.y <= 0) { m.y = Math.max(m.y, 0); if (this.floorAt?.(m.x, m.z) !== false) { p.vel.set(0, 0, 0); p.state = 'rest'; p.t = 0; } }
    }
  }

  // en línea: el servidor dice que j se la comió (se ve cómo la absorbe)
  eatRemote(id, j) {
    const p = this.list.find((x) => x.id === id);
    if (!p || p.state === 'eaten') return;
    if (!j) { p.gone = true; this.list.splice(this.list.indexOf(p), 1); return; }
    p.state = 'eaten'; p.target = j; p.t = 0; p.shadow.visible = false;
  }

  // para mandarle a un jugador que entra todo lo que hay en el piso
  snapshotList() {
    return this.list.filter((p) => p.state !== 'eaten').map((p) => ({
      id: p.id, x: +p.mesh.position.x.toFixed(2), y: +p.mesh.position.y.toFixed(2), z: +p.mesh.position.z.toFixed(2),
      vx: +p.vel.x.toFixed(2), vy: +p.vel.y.toFixed(2), vz: +p.vel.z.toFixed(2), power: p.power, rest: p.state === 'rest',
    }));
  }

  // escribe las bolitas en los dibujos instanciados
  _sync() {
    let w = 0, g = 0, sh = 0;
    for (const p of this.list) {
      const m = p.mesh;
      m.updateMatrix();
      if (p.power) { if (g < MAX_POWER) this.gold.setMatrixAt(g++, m.matrix); }
      else if (w < MAX_WHITE) this.white.setMatrixAt(w++, m.matrix);
      if (p.shadow.visible && sh < this.shadows.instanceMatrix.count) {
        _s.setScalar(p.shadow.scale);
        this.shadows.setMatrixAt(sh++, _m.compose(p.shadow.position, _q, _s));
      }
    }
    this.white.count = w; this.gold.count = g; this.shadows.count = sh;
    for (const im of [this.white, this.gold, this.shadows]) im.instanceMatrix.needsUpdate = true;
  }

  // hotspot (opcional, lo define la arena): una zona donde cae una parte de las bolitas, con más especiales
  spawnFromSky(arena) {
    const hs = arena.hotspot;
    const hot = hs && Math.random() < hs.share;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (hot ? hs.r : arena.R * 0.92);
      const x = (hot ? hs.x : 0) + Math.cos(a) * r, z = (hot ? hs.z : 0) + Math.sin(a) * r;
      if (!arena.floorAt(x, z)) continue;
      const chance = hot ? hs.power : CONFIG.powerChance;
      this._make(_v.set(x, 22 + Math.random() * 8, z), new THREE.Vector3(), Math.random() < chance ? randomPower() : null);
      return;
    }
  }

  // gelatinita expulsada (por ejemplo, al recibir un golpe fuerte)
  eject(pos, vel, from) { const p = this._make(pos, vel); p.immune = from; }

  // bolita puesta a mano (la usa el tutorial): cae desde poquita altura en (x, z). Devuelve la bolita;
  // cuando alguien se la come (o se cae) queda con gone = true.
  drop(x, z, power = null, h = 5) {
    return this._make(_v.set(x, h, z), new THREE.Vector3(), power);
  }

  clear() {
    for (const p of this.list) p.gone = true;
    this.list.length = 0;
    this._sync();
  }

  _remove(p) { p.gone = true; }

  // precalentado: una blanca, una dorada y una sombra escondidas bajo el piso (al arrancar la arena no hay
  // ninguna, y la primera que cae compilaría sus materiales en plena partida)
  warmBegin() {
    const under = new THREE.Vector3(0, -2, 0);
    this._warm = [this._make(under, new THREE.Vector3(), null), this._make(under, new THREE.Vector3(), 'turbo')];
    this._warm[0].shadow.visible = true;
    this._warm[0].shadow.position.set(0, -0.6, 0);
    this._sync();
  }

  warmEnd() {
    for (const p of this._warm || []) this.list.splice(this.list.indexOf(p), 1);
    this._warm = null;
    this._sync();
  }

  step(dt, arena, jellies, onEat) {
    this.timer -= dt;
    if (!this.remote && this.timer <= 0) {
      const sc = (arena.pickupScale ?? 1) * CONFIG.pickupAmount / 100; // arenas grandes: más gelatinitas · cantidad del admin
      this.timer = (CONFIG.pickupInterval / Math.max(sc, 0.05)) * (0.6 + Math.random() * 0.8); // con 0% igual se vuelve a fijar seguido
      if (this.list.length < CONFIG.pickupMax * sc) this.spawnFromSky(arena);
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const m = p.mesh;
      p.t += dt;
      p.age += dt;

      if (p.state === 'eaten') {
        const j = p.target;
        const k = Math.min(1, p.t / 0.15);
        m.position.lerp(j.pos, k * 0.5);
        m.scale.setScalar(Math.max(0.01, 1 - k));
        if (k >= 1) { if (!this.remote) onEat(j, p.mass, p.power); this._remove(p); this.list.splice(i, 1); }
        continue;
      }

      if (p.state === 'fall') {
        p.vel.y += CONFIG.gravity * 0.7 * dt;
        m.position.addScaledVector(p.vel, dt);
        const onFloor = arena.floorAt(m.position.x, m.position.z);
        if (onFloor && m.position.y <= 0 && m.position.y > -0.8 && p.vel.y < 0) {
          m.position.y = 0;
          const impact = -p.vel.y;
          p.vel.set(0, 0, 0);
          p.state = 'rest';
          p.t = 0;
          p.landImpact = impact;
          fx.burst(_v.copy(m.position).setY(0.1), p.power ? YELLOW : WHITE, 5, 3, null, 0.06, true);
        }
        if (m.position.y < -30) { this._remove(p); this.list.splice(i, 1); continue; }
        // sombra para saber dónde cae
        if (onFloor && m.position.y > 0) {
          p.shadow.visible = true;
          p.shadow.position.set(m.position.x, 0.03, m.position.z);
          const h = Math.min(1, m.position.y / 25);
          p.shadow.scale = 1 - h * 0.5;
        } else p.shadow.visible = false;
        // estirada al caer
        const st = Math.min(0.5, Math.abs(p.vel.y) * 0.02);
        m.scale.set(1 - st * 0.4, 1 + st, 1 - st * 0.4);
      } else {
        p.shadow.visible = false;
        // rebote de aterrizaje + temblor idle
        const land = p.landImpact ? Math.exp(-p.t * 7) * Math.sin(p.t * 30) * Math.min(0.5, p.landImpact * 0.02) : 0;
        const idle = Math.sin(p.t * 5 + p.phase) * 0.06;
        const sy = 1 - land + idle;
        m.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
        if (p.power) { m.position.y = 0.12 + Math.sin(p.t * 3) * 0.1; if (Math.random() < dt * 2) fx.burst(_v.copy(m.position).setY(0.8), YELLOW, 1, 1.2, null, 0.035); }
        // si el piso desaparece (trampilla), vuelve a caer
        if (!arena.floorAt(m.position.x, m.position.z)) { p.state = 'fall'; }
      }

      // absorción
      for (const j of jellies) {
        if (j.dead || j.impaled || (j === p.immune && p.age < 0.8)) continue;
        const dx = j.pos.x - m.position.x, dz = j.pos.z - m.position.z;
        const dy = m.position.y + PR - j.pos.y;
        if (dx * dx + dz * dz < (j.r * 0.95 + PR) ** 2 && dy > -j.r - PR * 2 && dy < j.r * 1.3) {
          p.state = 'eaten';
          p.target = j;
          p.t = 0;
          p.shadow.visible = false;
          this.onEaten?.(p, j);
          break;
        }
      }
    }
    this._sync();
  }
}
