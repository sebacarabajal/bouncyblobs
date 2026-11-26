import * as THREE from 'three';
import { glassMaterial, forgetGlass } from './quality.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { fx } from './fx.js';
import { sfx } from './sfx.js';

export const R = 0.9; // radio del collider físico
const ARM_SCALE = 3; // tamaño de los brazos musculosos (poder Fuerza)

// Siluetas basadas en las referencias. (La chata se sacó: era tan baja que pasaba por debajo del botón rojo de los pozos.)
const SHAPES = {
  round: { top: 1.42, bottom: 0.62, flat: 0.55, width: 1.1, bulge: 0.1 },
  tall: { top: 1.75, bottom: 0.6, flat: 0.55, width: 0.98, bulge: 0.14 },
  drop: { top: 1.55, bottom: 0.6, flat: 0.5, width: 1.18, bulge: 0.16, point: 0.45 },
  box: { top: 1.15, bottom: 0.55, flat: 0.45, width: 1.18, bulge: 0.04, cube: 4 },
  bean: { top: 1.2, bottom: 0.6, flat: 0.55, width: 1.15, bulge: 0.08, bean: 0.22 },
};

// nombres para elegir en la pantalla de inicio
export const SHAPE_NAMES = { round: 'Redonda', tall: 'Alta', drop: 'Gota', box: 'Cuadrada', bean: 'Poroto' };

// silueta de frente (para dibujar los botones de forma): puntos [x, y] con y hacia arriba
export function shapeOutline(name, n = 64) {
  const s = SHAPES[name] || SHAPES.round, out = new THREE.Vector3(), pts = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    shapePoint(Math.sin(t), Math.cos(t), 0, s, out);
    pts.push([out.x, out.y]);
  }
  return pts;
}

function shapePoint(x, y, z, s, out) {
  if (s.cube) {
    // superelipsoide: caja con bordes redondeados
    const p = s.cube, n = Math.pow(Math.abs(x) ** p + Math.abs(y) ** p + Math.abs(z) ** p, 1 / p);
    x /= n; y /= n; z /= n;
  }
  if (s.bean) {
    // poroto: un lado más gordo y una muesca arriba
    x *= 1 + s.bean * x;
    if (y > 0) y -= s.bean * 0.8 * Math.exp(-x * x * 10) * y;
  }
  const ny = y >= 0 ? y * s.top : -s.bottom * Math.pow(-y, s.flat);
  let h = s.width * (1 + s.bulge * Math.sin(Math.max(0, -y) * Math.PI));
  if (s.point && y > 0) h *= 1 - s.point * y * y;
  return out.set(x * h, ny, z * h);
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const angleLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _bm = new THREE.Matrix4();
let _bubbleGeo = null;
const _t = new THREE.Vector3();
const _white = new THREE.Color('#fff6d0');
const _whiteC = new THREE.Color('#ffffff');
let lxD = 0, lzD = 0;

let _spiralTex = null;
// Materiales y formas de la cara, compartidos por todas las gelatinas: así main.js puede dibujar las caras
// de las 16 juntas en pocos dibujos instanciados (ver facebatch.js) en vez de ~10 dibujos por gelatina.
let _face = null;
function faceAssets() {
  if (_face) return _face;
  _face = {
    black: new THREE.MeshStandardMaterial({ color: '#120818', roughness: 0.25 }),
    white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    mouthMat: new THREE.MeshStandardMaterial({ color: '#3a0c1e', roughness: 0.4 }),
    tongueMat: new THREE.MeshStandardMaterial({ color: '#ff5b7a' }),
    blush: new THREE.MeshBasicMaterial({ color: '#ff6f9f', transparent: true, opacity: 0.45, depthWrite: false }),
    spiralMat: new THREE.MeshBasicMaterial({ map: spiralTexture(), transparent: true }),
    starMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.35, 0.3), toneMapped: false }),
    sphere: new THREE.SphereGeometry(1, 16, 12),
    browGeo: new THREE.BoxGeometry(0.25, 0.05, 0.03),
    spiralGeo: new THREE.CircleGeometry(0.15, 24),
    smileGeo: new THREE.TorusGeometry(0.075, 0.017, 6, 16, Math.PI),
    cheekGeo: new THREE.CircleGeometry(0.1, 16),
  };
  return _face;
}
// Accesorios que muestran los poderes (compartidos por todas las gelatinas: se crean una sola vez)
let _acc = null;
function accessories() {
  if (_acc) return _acc;
  // casco de carrera rojo con franja blanca (Turbo); las alitas lo hacen leer como "rápido"
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e3262e'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#ffffff';
  for (const u of [0.25, 0.75]) g.fillRect(u * 256 - 12, 0, 24, 64);
  g.fillStyle = '#1d1418';
  for (const u of [0.25, 0.75]) { g.fillRect(u * 256 - 16, 0, 4, 64); g.fillRect(u * 256 + 12, 0, 4, 64); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const helmetGeo = new THREE.SphereGeometry(0.5, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  helmetGeo.rotateX(Math.PI / 2); // cúpula alrededor de +z (el eje que apunta hacia afuera de la cabeza)
  helmetGeo.scale(1, 1.12, 0.72);
  const wing = new THREE.Shape();
  wing.moveTo(0, 0); wing.lineTo(0.36, -0.06); wing.lineTo(0.44, 0.1); wing.lineTo(0.31, 0.11); wing.lineTo(0.38, 0.23);
  wing.lineTo(0.23, 0.22); wing.lineTo(0.27, 0.33); wing.lineTo(0.08, 0.25); wing.lineTo(0, 0.14); wing.lineTo(0, 0);
  _acc = {
    helmetGeo,
    helmetMat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.28, metalness: 0.25 }),
    wingGeo: new THREE.ShapeGeometry(wing),
    wingMat: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, side: THREE.DoubleSide }),
    // lata de aceite en la espalda (cuando tenés aceite para tirar)
    canGeo: new THREE.CylinderGeometry(0.15, 0.15, 0.36, 18),
    bandGeo: new THREE.CylinderGeometry(0.153, 0.153, 0.12, 18, 1, true),
    spoutGeo: new THREE.CylinderGeometry(0.022, 0.034, 0.24, 8),
    canMat: new THREE.MeshStandardMaterial({ color: '#25303a', roughness: 0.35, metalness: 0.7 }),
    labelMat: new THREE.MeshStandardMaterial({ color: '#f2b21a', roughness: 0.5 }),
    // brazos musculosos (Fuerza)
    upperArmGeo: new THREE.CapsuleGeometry(0.11, 0.12, 4, 12),
    foreArmGeo: new THREE.CapsuleGeometry(0.095, 0.1, 4, 12),
    ballGeo: new THREE.SphereGeometry(1, 16, 12),
  };
  return _acc;
}

function spiralTexture() {
  if (_spiralTex) return _spiralTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#120818';
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.beginPath();
  for (let t = 0; t < Math.PI * 6; t += 0.1) {
    const r = 3 + t * 3.1;
    const x = 64 + Math.cos(t) * r, y = 64 + Math.sin(t) * r;
    if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  _spiralTex = new THREE.CanvasTexture(c);
  _spiralTex.colorSpace = THREE.SRGBColorSpace;
  return _spiralTex;
}

let _starGeo = null;
function starGeometry() {
  if (_starGeo) return _starGeo;
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.06 : 0.14;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  _starGeo = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
  _starGeo.translate(0, 0, -0.02);
  return _starGeo;
}

export class Jelly {
  constructor(o) {
    this.name = o.name;
    this.isPlayer = !!o.isPlayer;
    this.color = new THREE.Color(o.color);
    this.browBase = o.brow ?? 0.25;
    this.world = o.world;

    this.yaw = o.yaw ?? 0;
    this.targetYaw = this.yaw;
    this.grounded = false;
    this.groundDist = Infinity;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.dashTimer = 0;
    this.dashCd = 0;
    this.dashDir = new THREE.Vector3();
    this.stun = 0;
    this.damage = 0;
    this.kos = 0;
    this.falls = 0;
    this.dead = false;
    this.lastHitBy = null;
    this.trapBy = null; this.trapTime = -99;
    this.pushBy = null; this.pushTime = -99; this.slipBy = null; this.slipTime = -99;
    this.flyUntil = 0; this.flyBy = null; this.chainUntil = 0;
    this.lastHitTime = -99;
    this.hitFlash = 0;
    this.mass = 1;
    this.size = 1;
    this.colSize = 1;
    this.sprinting = false;
    this.airDash = false;
    this.hazardCd = 0;
    this.daze = 0; // mareado
    this.impaledT = 0; // clavado en pinches
    this.impact = 0;
    this.buffs = { turbo: 0, strength: 0 }; // segundos restantes
    this.energy = 100; // para correr y embestir
    this.oilT = 0; // patinando en aceite
    this.muscle = 0; // 0..1: músculos (poder Fuerza)
    this.puff = 0; // 0..1: cachetes inflados (tiene un escupitajo guardado)
    this.ammo = { oil: 0, spit: 0 }; // armas para tirar (cada una con su tecla)
    this.throwCd = 0;
    this.sinceHit = 99; // para recuperar estabilidad
    this.score = 0;
    this.dazeT = 0;
    this.dazePhase = Math.random() * 6;

    this.vBefore = new THREE.Vector3();
    this.vPrev = new THREE.Vector3();
    this.contact = new THREE.Vector3();
    this.pos = new THREE.Vector3(o.spawn.x, o.spawn.y, o.spawn.z);
    this.prevPos = this.pos.clone();
    this.renderPos = this.pos.clone();

    this.squash = 1; this.squashVel = 0;
    this.stretch = 1; this.stretchVel = 0;
    this.blinkT = 1 + Math.random() * 3;
    this.blink = 0;

    this._buildBody(o.world, o.spawn);
    this.shapeName = SHAPES[o.shape] ? o.shape : 'round';
    this._buildVisual(o.scene, SHAPES[this.shapeName]);
  }

  // Cambia la forma: se rearma la malla (se usa al elegirla en la pantalla de inicio)
  setShape(name) {
    if (!SHAPES[name] || name === this.shapeName) return;
    this.shapeName = name;
    const scene = this.root.parent, vis = this.root.visible;
    scene?.remove(this.root);
    this.geo.dispose();
    this._oldMat = this.material;
    this.cheeks = [];
    this._buildVisual(scene, SHAPES[name]);
    this.root.visible = vis;
    this.root.position.copy(this.renderPos);
    if (this._tattooSrc) this.setLook({ tattoo: this._tattooSrc });
  }

  // ---------------------------------------------------------------- física
  _buildBody(world, p) {
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .lockRotations()
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.ball(R)
      .setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0.25)
      .setDensity(1);
    this.collider = world.createCollider(cd, this.body);
  }

  get dashing() { return this.dashTimer > 0; }
  get r() { return R * this.size; }
  get impaled() { return this.impaledT > 0; }

  // queda clavado en los pinches: la física se apaga y queda fijo en el lugar
  impale(center, inward, t) {
    this.impaledT = t;
    this.body.setEnabled(false);
    this.pos.copy(center);
    this.prevPos.copy(center);
    // no lo giramos: queda clavado en la pose en que llegó (de frente, de costado o de espalda)
    this.pinDir = inward.clone().negate(); // hacia la pared
    this.stun = 0; this.daze = 0; this.dashTimer = 0;
    this.dent(_v.copy(inward).negate(), 30, 0.1);
    this.squashVel -= 4;
    this.pinFlat = 1; // se aplasta contra los pinches (ver render)
  }

  // profundidad (radio hacia adelante/atrás) aproximada mientras está aplastado
  get pinnedDepth() { return R * 0.92 * this.size * 0.72; }

  feed(m) {
    this.mass += m; // sin tope
    this.squashVel += 3;
    this.dent(_v.set(0, 1, 0), 3, 0.5);
  }
  get stunned() { return this.stun > 0; }
  get facing() { return _t.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  _probeGround() {
    const t = this.body.translation();
    const ray = new RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, this.r + 1.5, true, undefined, undefined, undefined, this.body);
    this.groundDist = hit ? (hit.timeOfImpact ?? hit.toi) : Infinity;
  }

  // Paso de control: lee el comando y fija la velocidad antes de world.step().
  control(dt, cmd) {
    if (this.dead) return;
    if (this.impaledT > 0) return; // el temporizador lo maneja el juego (main)
    const v = this.body.linvel();
    let vx = v.x, vy = v.y, vz = v.z;

    // tamaño según masa (crece/encoge suave)
    this.size += (Math.cbrt(this.mass) - this.size) * (1 - Math.exp(-6 * dt));
    if (Math.abs(this.size - this.colSize) > 0.004) {
      this.collider.setRadius(R * this.size);
      this.colSize = this.size;
    }

    this._probeGround();
    this.grounded = this.groundDist < this.r + 0.1 && vy < 2.5;
    this.hazardCd = Math.max(0, this.hazardCd - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    for (const k in this.buffs) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    // estabilidad: se recupera sola si nadie te pega (100 en stabRegenTime segundos)
    this.sinceHit += dt;
    if (this.sinceHit > CONFIG.stabRegenDelay) this.damage = Math.max(0, this.damage - (100 / CONFIG.stabRegenTime) * dt);
    const slipping = this.oilT > 0 && this.grounded;
    this.oilT = Math.max(0, this.oilT - dt);
    if (slipping && !this.slipActive) {
      // pisó aceite: sale disparado hacia un costado al azar (nunca para atrás) y va girando
      this.slipActive = true;
      let hs = Math.hypot(vx, vz);
      let h = hs > 1 ? Math.atan2(vx, vz) : Math.random() * Math.PI * 2;
      hs = Math.max(hs, 5);
      this.slipBase = h;
      this.slipTurn = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 2.4);
      h += (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 1.1);
      vx = Math.sin(h) * hs; vz = Math.cos(h) * hs;
    } else if (this.oilT <= 0) this.slipActive = false;
    this.stun = Math.max(0, this.stun - dt);
    this.jumpBuffer = cmd.jump ? 0.13 : Math.max(0, this.jumpBuffer - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    // Mareado: ignora el input y camina como borracho
    if (this.daze > 0) {
      this.daze = Math.max(0, this.daze - dt);
      this.dazeT += dt;
      const a = this.dazeT * 1.6 + (((this.netId ?? this.id) || 0) * 2.399) % 6.283; // (igual en el servidor y en el navegador)
      cmd = { mx: Math.sin(a) * 0.3, mz: Math.cos(a * 1.37) * 0.3, jump: false, jumpHeld: false, dash: false, sprint: false };
      this.jumpBuffer = 0;
    }

    let mx = cmd.mx, mz = cmd.mz;
    const ml = Math.hypot(mx, mz);
    const stunned = this.stunned;

    // Más masa = más fuerza pero más lento. Correr (Shift) gasta masa.
    let speed = (CONFIG.moveSpeed / Math.pow(this.mass, CONFIG.speedMassExp)) * (this.buffs.turbo > 0 ? 2 : 1);
    this.sprinting = !!cmd.sprint && ml > 0.15 && !stunned && this.energy > 0;
    if (this.sprinting) {
      speed *= CONFIG.sprintMul;
      this.energy = Math.max(0, this.energy - CONFIG.sprintEnergy * dt);
      if (this.grounded && Math.random() < 0.25) {
        fx.burst(_v.set(this.pos.x, this.pos.y - this.r + 0.15, this.pos.z), this.color, 1, 2, null, 0.06 * this.size);
      }
    }

    if (ml > 0.15 && !stunned && !this.dashing) this.targetYaw = Math.atan2(mx, mz);

    // Embestida: primero un instante de CARGA (dashWindup: se encoge, frena y mira hacia donde va a salir) y
    // después sale disparado. La carga hace que la embestida se vea venir, también por la red: llega a todos los
    // jugadores antes del golpe (sin carga, una embestida dura menos que lo que tarda en llegar la noticia).
    const dashCost = CONFIG.dashEnergy;
    if (!this.sprinting) this.energy = Math.min(100, this.energy + CONFIG.energyRegen * dt);
    let launch = false;
    if (cmd.dash && this.dashCd <= 0 && !stunned && this.energy >= dashCost && !(this.windup > 0)) {
      this.energy -= dashCost;
      if (ml > 0.15) this.dashDir.set(mx / ml, 0, mz / ml);
      else this.dashDir.copy(this.facing);
      this.yaw = this.targetYaw = Math.atan2(this.dashDir.x, this.dashDir.z);
      this.dashCd = CONFIG.dashCooldown;
      if (CONFIG.dashWindup > 0) { this.windup = CONFIG.dashWindup; this.squashVel -= 5; } // se encoge: carga
      else launch = true;
    }
    if (this.windup > 0) {
      if (stunned) this.windup = 0; // si le pegan mientras carga, pierde la embestida
      else {
        this.windup -= dt;
        speed *= 0.4; // mientras carga, casi quieto
        this.yaw = this.targetYaw = Math.atan2(this.dashDir.x, this.dashDir.z);
        if (this.windup <= 0) { this.windup = 0; launch = true; }
      }
    }
    if (launch) {
      this.dashTimer = CONFIG.dashTime;
      this.airDash = !this.grounded && this.coyote <= 0;
      // en el aire: se tira en picada (más fuerte)
      vy = this.airDash ? Math.min(vy, 0) - 5 : Math.max(vy, 2.5);
      this.stretchVel += 8;
      this.lastLaunch = globalThis.performance?.now?.() ?? 0;
      sfx.dash();
      this.onAction?.(this.airDash ? 'dive' : 'dash'); // el tutorial escucha esto
    }

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      const s = this.dashTimer > 0 ? CONFIG.dashSpeed * (this.airDash ? 1.1 : 1) : speed * 1.15;
      vx = this.dashDir.x * s;
      vz = this.dashDir.z * s;
      if (Math.random() < 0.5) {
        fx.burst(_v.copy(this.pos).addScaledVector(this.dashDir, -this.r).setY(this.pos.y - 0.4 * this.size), this.airDash ? _white : this.color, this.airDash ? 2 : 1, 1.5, null, 0.07 * this.size);
      }
    } else {
      let tx, tz, acc;
      if (stunned) {
        acc = this.grounded ? CONFIG.stunFriction : 1.5;
        tx = mx * speed * 0.3;
        tz = mz * speed * 0.3;
      } else {
        acc = this.grounded ? CONFIG.groundAccel : CONFIG.airAccel;
        tx = mx * speed;
        tz = mz * speed;
      }
      if (slipping) {
        // aceite: casi sin agarre; la trayectoria se curva (máx ~115° respecto de donde venía)
        acc = 2;
        const hs = Math.hypot(vx, vz);
        if (hs > 0.5) {
          let h = Math.atan2(vx, vz) + this.slipTurn * dt;
          const dev = Math.atan2(Math.sin(h - this.slipBase), Math.cos(h - this.slipBase));
          if (Math.abs(dev) > 2) { h = this.slipBase + Math.sign(dev) * 2; this.slipTurn *= -0.5; }
          vx = Math.sin(h) * hs; vz = Math.cos(h) * hs;
          tx = vx; tz = vz; // el input casi no corrige
          tx += mx * 1.5; tz += mz * 1.5;
        }
        this.yaw += dt * 7 * Math.sign(this.slipTurn || 1);
        this.targetYaw = this.yaw;
      }
      const dx = tx - vx, dz = tz - vz, dl = Math.hypot(dx, dz), step = acc * dt;
      if (dl <= step) { vx = tx; vz = tz; } else { vx += (dx / dl) * step; vz += (dz / dl) * step; }
    }

    // Salto (con buffer y coyote time)
    if (this.jumpBuffer > 0 && this.coyote > 0 && !stunned) {
      vy = CONFIG.jumpVel / Math.pow(this.mass, 0.08);
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.squashVel += 6;
      this.lastJump = globalThis.performance?.now?.() ?? 0;
      sfx.jump();
      this.onAction?.('jump');
    }
    if (!cmd.jumpHeld && vy > 0 && !stunned) vy += CONFIG.gravity * 1.3 * dt; // salto variable
    if (vy < 0) vy += CONFIG.gravity * 0.35 * dt; // caída más seca

    if (!slipping) this.yaw = angleLerp(this.yaw, this.targetYaw, 1 - Math.exp(-14 * dt));

    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    this.vBefore.set(vx, vy, vz);
  }

  // Después de world.step(): detecta impactos por el cambio de velocidad que causó el solver.
  postStep(dt) {
    if (this.dead) return 0;
    if (this.impaledT > 0) { this.prevPos.copy(this.pos); this.impact = 0; return 0; }
    const t = this.body.translation();
    this.prevPos.copy(this.pos);
    this.pos.set(t.x, t.y, t.z);
    const v = this.body.linvel();
    this.contact.set(v.x - this.vBefore.x, v.y - this.vBefore.y - CONFIG.gravity * dt, v.z - this.vBefore.z);
    const mag = this.contact.length();
    this.impact = mag;
    if (mag > 2.5) {
      _n.copy(this.contact).divideScalar(mag);
      if (_n.y > 0.6) {
        // aterrizaje
        this.squashVel -= Math.min(mag, 25) * CONFIG.squashAmount * 6;
        this.dent(_v.copy(_n).negate(), mag * 0.5, 0.55);
        if (mag > 9) {
          fx.burst(_v.set(this.pos.x, this.pos.y - this.r + 0.1, this.pos.z), this.color, Math.min(14, mag * 0.7 | 0), mag * 0.25, null, 0.09 * this.size, true);
          sfx.land(mag);
        }
      } else {
        this.dent(_v.copy(_n).negate(), mag);
      }
    }
    return mag;
  }

  knockback(vx, vy, vz, stun) {
    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    this.stun = Math.max(this.stun, stun);
    this.dashTimer = 0;
    this.hitFlash = 0.15;
    this.sinceHit = 0;
  }

  // ---------------------------------------------------------------- piel
  _buildVisual(scene, shape) {
    this.visualVer = (this.visualVer || 0) + 1; // facebatch.js se entera de que hay piezas nuevas
    // detalle de la malla: 8 → 812 puntos (antes 11 → 1442). A la distancia de juego no se nota y cuesta la mitad.
    let geo = new THREE.IcosahedronGeometry(1, 8);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = mergeVertices(geo, 1e-4);
    const pos = geo.attributes.position;
    const N = pos.count;
    this.N = N;

    // Forma de reposo
    const rest = new Float32Array(N * 3);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      _v.fromBufferAttribute(pos, i).normalize();
      shapePoint(_v.x, _v.y, _v.z, shape, _v).multiplyScalar(0.92);
      rest[i * 3] = _v.x; rest[i * 3 + 1] = _v.y; rest[i * 3 + 2] = _v.z;
      minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
    }
    const shift = -R - minY;
    for (let i = 0; i < N; i++) rest[i * 3 + 1] += shift;
    this.height = maxY - minY;
    this.topY = maxY + shift;
    this.centerY = -R + this.height * 0.42;

    this.rest = rest;
    // panza: al despegar del piso la base deja de estar plana y cuelga un poco (como al levantar un flan)
    let rb = 0;
    for (let i = 0; i < N; i++) if (rest[i * 3 + 1] < -R + this.height * 0.12) rb = Math.max(rb, Math.hypot(rest[i * 3], rest[i * 3 + 2]));
    this.sagW = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const h = (rest[i * 3 + 1] + R) / (this.height * 0.4);
      const rh = Math.hypot(rest[i * 3], rest[i * 3 + 2]) / (rb || 1);
      this.sagW[i] = Math.max(0, 1 - h) ** 1.5 * Math.max(0, 1 - rh * rh * 0.7);
    }
    this.sag = 0; this.sagVel = 0;
    this.off = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.restDir = new Float32Array(N * 3);
    this.weight = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      _v.set(rest[i * 3], rest[i * 3 + 1] - this.centerY, rest[i * 3 + 2]).normalize();
      this.restDir.set([_v.x, _v.y, _v.z], i * 3);
      this.weight[i] = Math.pow(Math.max(0, (rest[i * 3 + 1] + R) / this.height), 1.3);
    }
    // bulto que se suma a la forma: cachetes inflados (escupitajo en la boca)
    const bump = (out, cx, cy, cz, width, k = 1) => {
      _n.set(cx, cy, cz).normalize();
      const c0 = Math.cos(width);
      for (let i = 0; i < N; i++) {
        const d = this.restDir[i * 3] * _n.x + this.restDir[i * 3 + 1] * _n.y + this.restDir[i * 3 + 2] * _n.z;
        if (d > c0) out[i] = Math.max(out[i], k * ((d - c0) / (1 - c0)) ** 1.6);
      }
    };
    this.cheekW = new Float32Array(N);
    for (const sd of [-1, 1]) bump(this.cheekW, sd * 0.62, -0.05, 0.78, 0.38);

    // Vecinos (para que las ondas se propaguen por la superficie)
    const idx = geo.index.array;
    const sets = Array.from({ length: N }, () => new Set());
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f], b = idx[f + 1], c = idx[f + 2];
      sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b);
    }
    this.adjStart = new Uint32Array(N + 1);
    const list = [];
    for (let i = 0; i < N; i++) { this.adjStart[i] = list.length; for (const j of sets[i]) list.push(j); }
    this.adjStart[N] = list.length;
    this.adj = Uint32Array.from(list);
    this.avg = new Float32Array(N * 3);

    for (let i = 0; i < N * 3; i++) pos.array[i] = rest[i];
    geo.computeVertexNormals();
    this.geo = geo;
    this.tri = geo.index.array; // para calcular normales rápido (ver _normals)

    this.root = new THREE.Group();
    scene.add(this.root);

    const c = this.color;
    this.material = new THREE.MeshPhysicalMaterial({
      color: c,
      transmission: 0.72,
      thickness: 1.4,
      roughness: 0.1,
      ior: 1.35,
      attenuationColor: c.clone().multiplyScalar(0.9),
      attenuationDistance: 1.1,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      emissive: c,
      emissiveIntensity: 0.22,
      specularIntensity: 1,
    });
    if (this._oldMat) forgetGlass(this._oldMat);
    glassMaterial(this.material); // en calidad baja: translúcida común (sin vidrio)
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this._buildTattoo(geo, rest);

    // Burbujas internas: las 7 en un solo dibujo (antes eran 7 mallas sueltas, y se dibujan dos veces por la transparencia)
    const bmat = this.bubbleMat = new THREE.MeshStandardMaterial({ color: c.clone().lerp(new THREE.Color('#fff'), 0.75), emissive: c, emissiveIntensity: 0.3, roughness: 0.1 });
    _bubbleGeo ||= new THREE.SphereGeometry(1, 10, 8);
    this.bubbleMesh = new THREE.InstancedMesh(_bubbleGeo, bmat, 7);
    this.bubbleMesh.frustumCulled = false;
    this.bubbleRest = [];
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.6;
      this.bubbleRest.push({ r: 0.035 + Math.random() * 0.05, p: new THREE.Vector3(Math.cos(a) * rr, -R + 0.2 + Math.random() * this.height * 0.6, Math.sin(a) * rr) });
    }
    this.root.add(this.bubbleMesh);
    this.bubbles = []; // (las mitades cortadas ya no llevan burbujas)

    this._buildFace();

    // estrellitas de mareo
    this.stars = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(starGeometry(), faceAssets().starMat);
      const a = (i / 5) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.62, Math.sin(i * 2.1) * 0.08, Math.sin(a) * 0.62);
      this.stars.add(st);
    }
    this.stars.visible = false;
    this.root.add(this.stars);
  }

  // Tatuaje: proyección plana desde atrás y un poco arriba (lo que ve la cámara cuando te alejás).
  // Comparte la geometría de la piel, así se estira y se abolla junto con la gelatina.
  _buildTattoo(geo, rest) {
    const N = this.N;
    const vdir = new THREE.Vector3(0, 0.45, -1).normalize(); // de la gelatina hacia quien mira
    const f = vdir.clone().negate();
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    const cy = this.centerY + 0.05, span = 1.45;
    const uv = new Float32Array(N * 2), col = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const x = rest[i * 3], y = rest[i * 3 + 1] - cy, z = rest[i * 3 + 2];
      uv[i * 2] = 0.5 + (x * right.x + y * right.y + z * right.z) / span;
      uv[i * 2 + 1] = 0.5 + (x * up.x + y * up.y + z * up.z) / span;
      const d = this.restDir[i * 3] * vdir.x + this.restDir[i * 3 + 1] * vdir.y + this.restDir[i * 3 + 2] * vdir.z;
      col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1;
      col[i * 4 + 3] = smooth(0.12, 0.45, d); // sólo del lado de atrás
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    this.tattooMat = new THREE.MeshStandardMaterial({
      transparent: true, vertexColors: true, roughness: 0.35, metalness: 0,
      emissive: '#ffffff', emissiveIntensity: 0.18,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false,
    });
    this.tattoo = new THREE.Mesh(geo, this.tattooMat);
    this.tattoo.frustumCulled = false;
    this.tattoo.renderOrder = 2;
    this.tattoo.visible = false;
    this.root.add(this.tattoo);
  }

  // Cambia color y tatuaje (canvas o imagen, o null para sacarlo).
  setLook({ color, tattoo } = {}) {
    if (color) {
      this.color.set(color);
      const c = this.color;
      this.material.color.copy(c);
      this.material.emissive.copy(c);
      this.material.attenuationColor.copy(c).multiplyScalar(0.9);
      this.bubbleMat.color.copy(c).lerp(_whiteC, 0.75);
      this.bubbleMat.emissive.copy(c);
    }
    if (tattoo !== undefined) {
      this._tattooSrc = tattoo;
      this.tattooMat.map?.dispose();
      if (tattoo) {
        const tex = new THREE.CanvasTexture(tattoo);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this.tattooMat.map = tex;
        this.tattooMat.emissiveMap = tex;
      } else {
        this.tattooMat.map = this.tattooMat.emissiveMap = null;
      }
      this.tattooMat.needsUpdate = true;
      this.tattoo.visible = !!tattoo;
    }
  }

  // Piezas de la cara y accesorios con material compartido (las dibuja facebatch.js todas juntas).
  // No entran el cuerpo, el tatuaje, las burbujas ni los brazos (usan el color de cada gelatina).
  faceMeshes() {
    const out = [];
    const skip = new Set([this.mesh, this.tattoo, this.bubbleMesh]);
    this.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !skip.has(o) && o.material !== this.material) out.push(o); });
    return out;
  }

  // golpe fuerte → mareado unos segundos
  dizzy(t) {
    if (this.daze <= 0) this.dazeT = 0;
    this.daze = Math.max(this.daze, t);
  }

  // machacar teclas para recuperarse antes
  mash() { if (this.daze > 0) this.daze = Math.max(0, this.daze - 0.13); }

  _anchor(dx, dy, dz) {
    _n.set(dx, dy, dz).normalize();
    let best = 0, bd = -2;
    for (let i = 0; i < this.N; i++) {
      const d = this.restDir[i * 3] * _n.x + this.restDir[i * 3 + 1] * _n.y + this.restDir[i * 3 + 2] * _n.z;
      if (d > bd) { bd = d; best = i; }
    }
    return best;
  }

  _buildFace() {
    const F = faceAssets();
    const { black, white, sphere } = F;
    this.features = [];
    const add = (obj, idx, lift = 0.012) => { this.root.add(obj); this.features.push({ obj, idx, lift }); return obj; };

    this.eyes = [];
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const pupil = new THREE.Mesh(sphere, black);
      pupil.scale.set(0.12, 0.17, 0.05);
      const hl = new THREE.Mesh(sphere, white);
      hl.scale.setScalar(0.04);
      hl.position.set(0.035, 0.06, 0.045);
      const brow = new THREE.Mesh(F.browGeo, black);
      brow.position.set(-side * 0.03, 0.25, 0.01);
      const spiral = new THREE.Mesh(F.spiralGeo, F.spiralMat);
      spiral.position.z = 0.03;
      spiral.visible = false;
      g.add(pupil, hl, brow, spiral);
      g.userData = { pupil, hl, brow, side, spiral };
      add(g, this._anchor(side * 0.36, 0.2, 1));
      this.eyes.push(g);
    }

    // Boca: sonrisa (arco) y boca abierta
    const mouth = new THREE.Group();
    const smile = new THREE.Mesh(F.smileGeo, black);
    smile.rotation.z = Math.PI;
    const open = new THREE.Mesh(sphere, F.mouthMat);
    open.scale.set(0.07, 0.06, 0.03);
    const tongue = new THREE.Mesh(sphere, F.tongueMat);
    tongue.scale.set(0.045, 0.025, 0.02);
    tongue.position.set(0, -0.03, 0.015);
    open.add(tongue);
    mouth.add(smile, open);
    mouth.userData = { smile, open };
    this.mouth = add(mouth, this._anchor(0, -0.08, 1));

    // Cachetes
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(F.cheekGeo, F.blush);
      m.scale.y = 0.6;
      add(m, this._anchor(side * 0.62, -0.02, 0.85), 0.006);
      (this.cheeks ||= []).push(m);
    }

    // casco alado (Turbo)
    const A = accessories();
    const helmet = new THREE.Group();
    const dome = new THREE.Mesh(A.helmetGeo, A.helmetMat);
    dome.position.z = -0.1; // un toque hundido: abraza la cabeza
    dome.castShadow = true;
    helmet.add(dome);
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(A.wingGeo, A.wingMat);
      w.position.set(side * 0.46, 0.02, 0.06);
      w.scale.x = side;
      w.rotation.y = -side * 0.7; // la punta del ala apunta hacia arriba
      helmet.add(w);
    }
    helmet.visible = false;
    this.helmet = add(helmet, this._anchor(0, 1, 0.35), 0);
    // lata de aceite en la espalda (tiene aceite para tirar)
    const can = new THREE.Group();
    const body = new THREE.Mesh(A.canGeo, A.canMat);
    const band = new THREE.Mesh(A.bandGeo, A.labelMat);
    const spout = new THREE.Mesh(A.spoutGeo, A.canMat);
    spout.position.set(0.06, 0.25, 0);
    spout.rotation.z = -0.5;
    can.add(body, band, spout);
    can.children.forEach((m) => { m.position.z += 0.16; });
    can.visible = false;
    this.oilCan = add(can, this._anchor(0, 0.2, -1), 0);
    // brazos musculosos (Fuerza): salen de los costados, con bíceps y puño; se balancean al andar
    // y tiran una trompada con los dos en la embestida. Ejes locales: z = hacia afuera del cuerpo, x = adelante·fw
    this.arms = [-1, 1].map((side) => {
      const fw = -side; // en este marco, "adelante" es -x del lado derecho y +x del izquierdo
      const mk = (geo) => { const m = new THREE.Mesh(geo, this.material); m.castShadow = true; return m; };
      const mount = new THREE.Group(), arm = new THREE.Group(), shoulder = new THREE.Group(), tilt = new THREE.Group();
      tilt.rotation.x = -1.0; // el brazo sale del cuerpo hacia afuera y abajo (como un patovica)
      const upper = mk(A.upperArmGeo); upper.position.y = -0.15;
      const bicep = mk(A.ballGeo); bicep.scale.set(0.15, 0.17, 0.14); bicep.position.set(fw * 0.06, -0.13, 0.02);
      const delt = mk(A.ballGeo); delt.scale.setScalar(0.14); delt.position.y = -0.03;
      const elbow = new THREE.Group(); elbow.position.y = -0.27;
      const fore = mk(A.foreArmGeo); fore.position.y = -0.12;
      const fist = mk(A.ballGeo); fist.scale.setScalar(0.14); fist.position.y = -0.25;
      elbow.add(fore, fist);
      tilt.add(upper, bicep, delt, elbow);
      shoulder.add(tilt);
      arm.add(shoulder);
      mount.add(arm);
      mount.visible = false;
      add(mount, this._anchor(side, 0.5, 0.05), -0.15);
      return { side, fw, mount, arm, shoulder, elbow };
    });
    this.armPh = 0; this.armAmp = 0; this.punch = 0;
  }

  dent(worldDir, strength, spread = 0.3) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lx = worldDir.x * c - worldDir.z * s;
    const lz = worldDir.x * s + worldDir.z * c;
    const ly = worldDir.y;
    const depth = Math.min(0.5, strength * CONFIG.dentDepth);
    const kick = strength * 0.35;
    const rd = this.restDir, off = this.off, vel = this.vel;
    for (let i = 0; i < this.N; i++) {
      const i3 = i * 3;
      const d = rd[i3] * lx + rd[i3 + 1] * ly + rd[i3 + 2] * lz;
      const f = smooth(spread, 1, d);
      if (f > 0) {
        for (let k = 0; k < 3; k++) { off[i3 + k] -= rd[i3 + k] * depth * f; vel[i3 + k] -= rd[i3 + k] * kick * f; }
      } else {
        const b = kick * 0.12;
        for (let k = 0; k < 3; k++) vel[i3 + k] += rd[i3 + k] * b; // abulta el resto (conserva volumen)
      }
    }
  }

  // Simulación de resortes de la piel (paso fijo).
  skin(dt) {
    if (this.dead) return;
    const v = this.impaledT > 0 ? { x: 0, y: 0, z: 0 } : this.body.linvel();
    // fuera de cámara: la piel queda quieta (nadie la ve); sólo se sigue la velocidad para no dar un tirón al volver
    if (this.offscreen) { this.vPrev.set(v.x, v.y, v.z); return; }
    if (this.impaledT > 0 && Math.random() < dt * 5) {
      // pataleo: sacudidas al azar
      this.dent(_v.set(Math.random() - 0.5, Math.random() * 0.5, Math.random() - 0.5).normalize(), 5, 0.4);
      this.squashVel += (Math.random() - 0.5) * 3;
    }
    // aceleración no gravitatoria -> la gelatina "se queda atrás"
    let dx = v.x - this.vPrev.x, dy = v.y - this.vPrev.y - CONFIG.gravity * dt, dz = v.z - this.vPrev.z;
    this.vPrev.set(v.x, v.y, v.z);
    const dl = Math.hypot(dx, dy, dz), maxDv = 6;
    if (dl > maxDv) { dx *= maxDv / dl; dy *= maxDv / dl; dz *= maxDv / dl; }
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c, ly = dy;

    // menos estabilidad = gelatina más "aguada" (tiembla más)
    const k = CONFIG.skinStiffness, damp = CONFIG.skinDamping * (1 - 0.5 * Math.min(1, this.damage / 100));
    const kn = CONFIG.skinCoupling, inert = CONFIG.skinInertia;
    if (this.daze > 0) {
      // bamboleo de mareado
      lxD = Math.sin(this.dazeT * 7) * 0.35; lzD = Math.cos(this.dazeT * 5.3) * 0.25;
    } else { lxD = 0; lzD = 0; }
    const off = this.off, vel = this.vel, avg = this.avg, adj = this.adj, st = this.adjStart, w = this.weight;
    const N = this.N;

    for (let i = 0; i < N; i++) {
      let ax = 0, ay = 0, az = 0;
      const a = st[i], b = st[i + 1];
      for (let j = a; j < b; j++) { const n3 = adj[j] * 3; ax += off[n3]; ay += off[n3 + 1]; az += off[n3 + 2]; }
      const inv = 1 / (b - a);
      avg[i * 3] = ax * inv; avg[i * 3 + 1] = ay * inv; avg[i * 3 + 2] = az * inv;
    }
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, wi = w[i] * inert;
      for (let q = 0; q < 3; q++) {
        const o = off[i3 + q];
        vel[i3 + q] += (-k * o - damp * vel[i3 + q] + kn * (avg[i3 + q] - o)) * dt;
      }
      vel[i3] -= (lx + lxD) * wi; vel[i3 + 1] -= ly * wi; vel[i3 + 2] -= (lz + lzD) * wi;
      for (let q = 0; q < 3; q++) {
        let o = off[i3 + q] + vel[i3 + q] * dt;
        if (o > 0.6) o = 0.6; else if (o < -0.6) o = -0.6;
        off[i3 + q] = o;
      }
    }

    // Squash vertical y estiramiento hacia adelante (conservan volumen)
    this.squashVel += (-(this.squash - 1) * 260 - this.squashVel * 9) * dt;
    this.squash = Math.min(1.6, Math.max(0.45, this.squash + this.squashVel * dt));
    const hs = Math.hypot(v.x, v.z);
    const target = this.dashing ? 1.32 : 1 + Math.min(0.1, hs * 0.007);
    this.stretchVel += (-(this.stretch - target) * 220 - this.stretchVel * 12) * dt;
    this.stretch = Math.min(1.6, Math.max(0.7, this.stretch + this.stretchVel * dt));

    const airborne = !this.grounded && this.impaledT <= 0 && this.groundDist > this.r + 0.12;
    this.sagVel += ((airborne ? 1 : 0) - this.sag) * 90 * dt - this.sagVel * 7 * dt;
    this.sag = Math.min(1.5, Math.max(-0.3, this.sag + this.sagVel * dt));

    // poderes: músculos y cachetes crecen/se desinflan suave; Recarga x2 chispea; Turbo deja estela
    const kk = Math.min(1, dt * 6);
    this.muscle += ((this.buffs.strength > 0 ? 1 : 0) - this.muscle) * kk;
    this.puff += ((this.ammo.spit > 0 ? 1 : 0) - this.puff) * kk;
    if (this.muscle > 0.02) {
      // balanceo de brazos: más rápido y amplio cuanto más rápido vas; en la embestida, trompada
      this.armPh += dt * (4 + hs * 1.15);
      this.armAmp += (Math.min(0.8, 0.1 + hs * 0.08) - this.armAmp) * kk;
      this.punch += ((this.dashing ? 1 : 0) - this.punch) * Math.min(1, dt * 14);
    }
    if (this.buffs.turbo > 0 && hs > 7 && Math.random() < dt * 30) {
      fx.puff(_v.set(this.pos.x - (v.x / hs) * this.r, this.pos.y, this.pos.z - (v.z / hs) * this.r),
        _n.set(-v.x * 0.15, 0.3, -v.z * 0.15), { size: 0.7 * this.size, life: 0.35, color: '#ffffff', alpha: 0.4, grow: 1.6 });
    }

    // parpadeo
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blink = 0.12; this.blinkT = 2 + Math.random() * 3.5; }
    this.blink = Math.max(0, this.blink - dt);
  }

  // normales de la malla deformada (versión rápida de computeVertexNormals, sin objetos intermedios)
  _normals() {
    const p = this.geo.attributes.position.array, nAttr = this.geo.attributes.normal, n = nAttr.array, t = this.tri;
    n.fill(0);
    for (let f = 0; f < t.length; f += 3) {
      const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
      const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
      n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
      n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
    }
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    nAttr.needsUpdate = true;
  }

  // ---------------------------------------------------------------- render
  // frustum (opcional): si la gelatina está fuera de cámara no se recalcula su forma (ahorra mucho con 16)
  render(alpha, others, frustum = null) {
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    if (this.visOff) this.renderPos.add(this.visOff); // en línea: corrección del servidor, deslizada suave
    this.root.position.copy(this.renderPos);
    if (this.dead) return;
    if (frustum) {
      _sphere.center.copy(this.renderPos);
      _sphere.radius = this.r * 2.2;
      this.offscreen = !frustum.intersectsSphere(_sphere);
      if (this.offscreen) return;
    } else this.offscreen = false;
    const S = this.size;
    this.root.scale.setScalar(S);

    const sway = this.daze > 0 ? Math.sin(this.dazeT * 6) * 0.4 : 0;
    const c = Math.cos(this.yaw + sway), s = Math.sin(this.yaw + sway);
    const a = this.squash, b = this.stretch;
    const sqa = Math.sqrt(a), sqb = Math.sqrt(b);
    const sx = 1 / (sqa * sqb), sy = a / sqb, sz = b / sqa;
    const groundY = this.groundDist < this.r + 1 ? (-this.groundDist - (this.renderPos.y - this.pos.y)) / S : -Infinity;

    // Planos de contacto con otras gelatinas: se aplastan entre sí
    const planes = this._planes || (this._planes = []); // se reusa (sin basura por frame)
    planes.length = 0;
    for (const o of others) {
      if (o === this || o.dead) continue;
      _v.subVectors(o.renderPos, this.renderPos);
      const d = _v.length();
      if (d < (this.r + o.r) * 1.6 && d > 0.01) {
        _v.divideScalar(d);
        planes.push(_v.x, _v.y, _v.z, (d * (S / (S + o.size)) + 0.03) / S);
      }
    }
    const np = planes.length;

    const arr = this.geo.attributes.position.array;
    const rest = this.rest, off = this.off, sagW = this.sagW, sagA = this.sag * 0.16;
    const rd = this.restDir, cW = this.cheekW, cA = this.puff * 0.15;
    const pin = this.impaledT > 0 && this.pinDir, pdx = pin ? this.pinDir.x : 0, pdz = pin ? this.pinDir.z : 0, pinK = 0.28;
    for (let i = 0; i < this.N; i++) {
      const i3 = i * 3;
      const bb = cW[i] * cA; // cachetes inflados
      let x = (rest[i3] + off[i3] + rd[i3] * bb) * sx;
      let y = -R + (rest[i3 + 1] + off[i3 + 1] + rd[i3 + 1] * bb + R) * sy - sagW[i] * sagA;
      let z = (rest[i3 + 2] + off[i3 + 2] + rd[i3 + 2] * bb) * sz;
      let wx = x * c + z * s;
      let wz = -x * s + z * c;
      if (pin) { const d = wx * pdx + wz * pdz; wx -= pdx * d * pinK; wz -= pdz * d * pinK; } // aplastado contra la pared
      if (y < groundY) y = groundY;
      for (let p = 0; p < np; p += 4) {
        const d = wx * planes[p] + y * planes[p + 1] + wz * planes[p + 2] - planes[p + 3];
        if (d > 0) { wx -= planes[p] * d; y -= planes[p + 1] * d; wz -= planes[p + 2] * d; }
      }
      arr[i3] = wx; arr[i3 + 1] = y; arr[i3 + 2] = wz;
    }
    this.geo.attributes.position.needsUpdate = true;
    this._normals();

    const bm = this.bubbleMesh;
    for (let i = 0; i < 7; i++) {
      const { r, p } = this.bubbleRest[i];
      const x = p.x * sx, y = -R + (p.y + R) * sy, z = p.z * sz;
      _bm.makeScale(r, r, r).setPosition(x * c + z * s, y, -x * s + z * c);
      bm.setMatrixAt(i, _bm);
    }
    bm.instanceMatrix.needsUpdate = true;

    // Cara pegada a la superficie deformada
    const nrm = this.geo.attributes.normal.array;
    for (const f of this.features) {
      const i3 = f.idx * 3;
      _n.set(nrm[i3], nrm[i3 + 1], nrm[i3 + 2]);
      f.obj.position.set(arr[i3], arr[i3 + 1], arr[i3 + 2]).addScaledVector(_n, f.lift);
      _v.copy(f.obj.position).multiplyScalar(S).add(this.root.position).add(_n);
      f.obj.lookAt(_v);
      f.obj.scale.set(sx, sy, 1);
    }
    // lo que muestran los poderes
    for (const ch of this.cheeks) ch.scale.multiplyScalar(1 + this.puff * 0.7);
    this.helmet.visible = this.buffs.turbo > 0;
    this.oilCan.visible = this.ammo.oil > 0;
    const showArms = this.muscle > 0.02;
    for (const a of this.arms) {
      a.mount.visible = showArms;
      if (!showArms) continue;
      a.arm.scale.setScalar(this.muscle * ARM_SCALE);
      const sw = Math.sin(this.armPh), p = this.punch;
      const walk = -this.armAmp * sw; // mismo valor en los dos: los marcos están espejados, así van alternados
      a.shoulder.rotation.z = walk * (1 - p) + a.fw * 1.55 * p;
      a.elbow.rotation.z = a.fw * ((1.75 + 0.3 * sw * a.side) * (1 - p) + 0.25 * p);
    }

    // Mareado: estrellitas girando + ojos en espiral
    const dazed = this.daze > 0;
    this.stars.visible = dazed;
    if (dazed) {
      this.stars.rotation.y = this.dazeT * 4;
      this.stars.position.y = this.topY + 0.35 + Math.sin(this.dazeT * 6) * 0.06;
      this.stars.children.forEach((st, i) => { st.rotation.y = this.dazeT * 6 + i; });
    }

    // Expresiones
    const hurt = this.stunned || dazed || this.impaledT > 0;
    const angry = this.dashing || this.windup > 0 || this.dashCd > CONFIG.dashCooldown - 0.35;
    for (const e of this.eyes) {
      const { pupil, brow, side, hl, spiral } = e.userData;
      spiral.visible = dazed;
      pupil.visible = !dazed;
      if (dazed) spiral.rotation.z = -this.dazeT * 9 * side;
      let ey = 0.17;
      if (this.blink > 0) ey = 0.02;
      if (hurt) ey = 0.04;
      pupil.scale.y = ey;
      pupil.scale.x = hurt ? 0.14 : 0.12;
      hl.visible = !hurt && this.blink <= 0;
      const ang = hurt ? -0.45 : angry ? 0.6 : this.browBase;
      brow.rotation.z = side * ang;
      brow.position.y = hurt ? 0.16 : angry ? 0.19 : 0.25;
    }
    const { smile, open } = this.mouth.userData;
    const openMouth = hurt || angry;
    smile.visible = !openMouth;
    open.visible = openMouth;
    open.scale.set(hurt ? 0.11 : 0.09, hurt ? 0.1 : 0.07, 0.03);

    this.material.emissiveIntensity = 0.22 + this.hitFlash * 5;
  }

  // ---------------------------------------------------------------- vida
  // en línea: los demás blobs los mueve el servidor (cuerpo "cinemático": empuja al tuyo pero nada lo empuja)
  setRemote(on) {
    if (this.remote === on) return;
    this.remote = on;
    this.body.setBodyType(on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
  }

  kill() {
    this.dead = true;
    this.impaledT = 0;
    this.body.setEnabled(false);
    this.root.visible = false;
  }

  respawn(p) {
    this.body.setEnabled(true);
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.pos.copy(p); this.prevPos.copy(p); this.renderPos.copy(p);
    this.vPrev.set(0, 0, 0);
    this.off.fill(0); this.vel.fill(0);
    this.squash = 1; this.squashVel = 0; this.stretch = 1; this.stretchVel = 0;
    this.damage = 0; this.stun = 0; this.dashTimer = 0; this.dashCd = 0; this.daze = 0; this.impaledT = 0; this.windup = 0;
    this.mass = 1; this.size = 1; this.colSize = 1;
    this.muscle = 0; this.puff = 0;
    this.collider.setRadius(R);
    this.buffs = { turbo: 0, strength: 0 };
    this.energy = 100;
    this.oilT = 0;
    this.ammo = { oil: 0, spit: 0 };
    this.throwCd = 0;
    this.sinceHit = 99;
    this.slipActive = false;
    this.lastHitBy = null;
    this.trapBy = null; this.trapTime = -99;
    this.pushBy = null; this.pushTime = -99; this.slipBy = null; this.slipTime = -99;
    this.flyUntil = 0; this.flyBy = null; this.chainUntil = 0;
    this.dead = false;
    this.root.visible = true;
  }
}
