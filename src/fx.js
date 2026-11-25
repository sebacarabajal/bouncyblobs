import * as THREE from 'three';

// Partículas (gotitas), humo/vapor, ondas de choque, manchas de "splat" y textos flotantes.
const MAX = 500;
const MAX_PUFFS = 180;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 0, 1);
const _cWeak = new THREE.Color('#fff1c4'), _cStrong = new THREE.Color('#ffa63a'), _cBrutal = new THREE.Color('#ff4a2e');

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class FX {
  init(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.floorAt = () => true;

    const geo = new THREE.SphereGeometry(1, 10, 8);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.15 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.p = Array.from({ length: MAX }, () => ({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0.1, max: 1 }));
    const white = new THREE.Color('#fff');
    for (let i = 0; i < MAX; i++) { this.mesh.setColorAt(i, white); this._hide(i); }
    this.next = 0;

    const tex = puffTexture();
    this.puffs = [];
    for (let i = 0; i < MAX_PUFFS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      s.userData = { life: 0, max: 1, vel: new THREE.Vector3(), size: 1, grow: 2, alpha: 0.6 };
      scene.add(s);
      this.puffs.push(s);
    }
    this.nextPuff = 0;

    // destellos de impacto (golpes): un fogonazo redondo y suave (sin picos), mirando a la cámara
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c2 = cv.getContext('2d');
    const grd = c2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.2)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = grd;
    c2.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(cv);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const glowGeo = new THREE.PlaneGeometry(2, 2);
    this.impacts = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: glowTex, color: '#fff', transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      g.renderOrder = 5;
      g.visible = false;
      g.userData = { life: 0, max: 0.12, size: 1 };
      scene.add(g);
      this.impacts.push(g);
    }
    this.nextImpact = 0;

    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 1, 40),
        new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      r.visible = false;
      r.userData.life = 0;
      scene.add(r);
      this.rings.push(r);
    }

    // charcos: se reutilizan (nunca se descartan sus materiales → sin recompilar shaders en plena partida)
    this.puddles = [];
    this.puddlePool = [];
    this.puddleGeo = new THREE.CircleGeometry(1, 24);
    this.pops = [];
    this.layer = document.getElementById('popups');
    // cartelitos (números, emojis): se crean una sola vez y se reutilizan. Crear y borrar elementos de la
    // página en cada golpe obligaba al navegador a armar capas nuevas (trabones de ~50 ms al pegar)
    this.popPool = [];
    for (let i = 0; i < 24; i++) {
      const el = document.createElement('div');
      el.className = 'popup';
      el.style.display = 'none';
      this.layer.appendChild(el);
      this.popPool.push(el);
    }
  }

  _hide(i) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); }

  burst(pos, color, count, speed, dir = null, size = 0.1, flat = false) {
    for (let n = 0; n < count; n++) {
      const i = this.next; this.next = (this.next + 1) % MAX;
      const p = this.p[i];
      p.pos.copy(pos);
      p.vel.set(Math.random() - 0.5, Math.random() * (flat ? 0.4 : 1), Math.random() - 0.5).normalize();
      if (flat) p.vel.y = 0.25 + Math.random() * 0.3;
      if (dir) p.vel.addScaledVector(dir, 1.4).normalize();
      p.vel.multiplyScalar(speed * (0.5 + Math.random() * 0.8));
      p.size = size * (0.6 + Math.random() * 0.8);
      p.life = p.max = 0.5 + Math.random() * 0.6;
      this.mesh.setColorAt(i, color);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  // humo / vapor / chispas suaves
  puff(pos, vel, { size = 1, life = 1, color = '#ffffff', grow = 2, alpha = 0.6 } = {}) {
    const s = this.puffs[this.nextPuff];
    this.nextPuff = (this.nextPuff + 1) % MAX_PUFFS;
    const u = s.userData;
    s.position.copy(pos);
    u.vel.copy(vel);
    u.life = u.max = life;
    u.size = size;
    u.grow = grow;
    u.alpha = alpha;
    s.material.color.set(color);
    s.visible = true;
  }

  // destello de un golpe: k = fuerza (tamaño y color: crema → naranja → rojo)
  impact(pos, k) {
    const g = this.impacts[this.nextImpact];
    this.nextImpact = (this.nextImpact + 1) % this.impacts.length;
    const u = g.userData;
    u.life = u.max = 0.09 + Math.min(0.06, k * 0.002);
    u.size = 0.6 + Math.min(1.4, k * 0.04);
    const c = k < 12 ? _cWeak : k < 20 ? _cStrong : _cBrutal;
    g.material.color.copy(c).multiplyScalar(1.4);
    g.position.copy(pos);
    g.visible = true;
  }

  ring(pos, normal, color, size = 2.5) {
    const r = this.rings.find((x) => x.userData.life <= 0) || this.rings[0];
    r.position.copy(pos);
    r.quaternion.setFromUnitVectors(UP, normal);
    r.material.color.copy(color);
    r.userData.life = 0.35;
    r.userData.size = size;
    r.visible = true;
  }

  _newPuddle() {
    const m = new THREE.Mesh(
      this.puddleGeo,
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3, roughness: 0.1, clearcoat: 1, transparent: true }),
    );
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  puddle(pos, normal, color, size = 1.4) {
    const m = this.puddlePool.pop() || this._newPuddle();
    m.material.color.copy(color);
    m.material.emissive.copy(color);
    m.material.opacity = 1;
    m.position.copy(pos).addScaledVector(normal, 0.03);
    m.quaternion.setFromUnitVectors(UP, normal);
    m.userData = { life: 4, size };
    m.scale.setScalar(0.1);
    m.visible = true;
    this.puddles.push(m);
  }

  _freePuddle(m) { m.visible = false; this.puddlePool.push(m); }

  // precalentado: un charco (escondido bajo el piso) para que su material quede compilado
  warmBegin() {
    const m = this.puddlePool.pop() || this._newPuddle();
    m.position.set(0, -0.6, 0);
    m.scale.setScalar(0.01);
    m.visible = true;
    this._warm = m;
  }

  warmEnd() { if (this._warm) this._freePuddle(this._warm); this._warm = null; }

  popup(worldPos, text, color = '#fff', big = false) {
    // si se acabaron, se recicla el más viejo
    const el = this.popPool.pop() || this.pops.shift().el;
    const cls = 'popup' + (big ? ' big' : '');
    if (el.className !== cls) el.className = cls;
    if (el.textContent !== text) el.textContent = text;
    el.style.color = color;
    el.style.display = '';
    this.pops.push({ el, pos: worldPos.clone(), life: big ? 1.3 : 0.9, max: big ? 1.3 : 0.9 });
  }

  clear() {
    for (const m of this.puddles) this._freePuddle(m);
    this.puddles = [];
    for (const p of this.puffs) { p.userData.life = 0; p.visible = false; }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { this._hide(i); continue; }
      p.vel.y -= 22 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < p.size && p.pos.y > -0.5 && this.floorAt(p.pos.x, p.pos.z)) {
        p.pos.y = p.size; p.vel.y *= -0.3; p.vel.x *= 0.7; p.vel.z *= 0.7;
      }
      const k = Math.min(1, p.life / (p.max * 0.4));
      _s.set(1, 1, 1).multiplyScalar(p.size * k);
      _s.y *= 1 + Math.min(1.5, Math.abs(p.vel.y) * 0.05);
      _m.compose(p.pos, _q.identity(), _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    for (const s of this.puffs) {
      const u = s.userData;
      if (u.life <= 0) continue;
      u.life -= dt;
      if (u.life <= 0) { s.visible = false; continue; }
      const t = 1 - u.life / u.max;
      s.position.addScaledVector(u.vel, dt);
      u.vel.multiplyScalar(Math.exp(-1.5 * dt));
      s.scale.setScalar(u.size * (0.4 + t * u.grow));
      s.material.opacity = u.alpha * Math.min(1, t * 6) * (1 - t);
    }

    for (const g of this.impacts) {
      const u = g.userData;
      if (u.life <= 0) continue;
      u.life -= dt;
      if (u.life <= 0) { g.visible = false; continue; }
      const t = 1 - u.life / u.max; // 0 → 1
      g.quaternion.copy(this.camera.quaternion);
      g.scale.setScalar(u.size * (0.7 + t * 0.5));
      g.material.opacity = (1 - t) * (1 - t);
    }

    for (const r of this.rings) {
      if (r.userData.life <= 0) continue;
      r.userData.life -= dt;
      const t = 1 - r.userData.life / 0.35;
      r.scale.setScalar(0.3 + t * r.userData.size);
      r.material.opacity = (1 - t) * 0.9;
      if (r.userData.life <= 0) r.visible = false;
    }

    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const m = this.puddles[i];
      m.userData.life -= dt;
      m.scale.setScalar(Math.min(m.userData.size, m.scale.x + dt * 12));
      m.material.opacity = Math.min(1, m.userData.life);
      if (m.userData.life <= 0) { this._freePuddle(m); this.puddles.splice(i, 1); }
    }

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const o = this.pops[i];
      o.life -= dt;
      o.pos.y += dt * 1.2;
      _p.copy(o.pos).project(this.camera);
      const t = 1 - o.life / o.max;
      o.el.style.transform = `translate(${(_p.x * 0.5 + 0.5) * innerWidth}px, ${(-_p.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%) scale(${t < 0.15 ? 0.5 + t * 4 : 1.1})`;
      o.el.style.opacity = Math.min(1, o.life * 3);
      if (o.life <= 0) { o.el.style.display = 'none'; this.popPool.push(o.el); this.pops.splice(i, 1); }
    }
  }
}

export const fx = new FX();
