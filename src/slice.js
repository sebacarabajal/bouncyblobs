import * as THREE from 'three';
import { glassMaterial } from './quality.js';
import { fx } from './fx.js';

// Gelatina partida al medio (sierra): se copian la forma deformada del momento del corte y se arman
// dos mitades recortadas por el plano de la hoja, cada una con su "cara" del corte rellena.
// Las mitades se deslizan un toque por el corte, se abren hacia los costados rebotando como gelatina,
// gotean y al final se derriten en un charco.
//
// Los materiales de las mitades salen de "juegos" que se reutilizan siempre y nunca se descartan:
// si se descartaran, la placa de video tiraría los shaders compilados y el próximo corte los volvería
// a compilar (eso es lo que congelaba el juego un segundo).

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();

// Copia un objeto SIN su userData. three.js copia userData con JSON.stringify, y los ojos guardan ahí
// sus mallas (con texturas): serializarlas convertía imágenes a texto y trababa ~40 ms cada corte.
function cloneLite(o) {
  const saved = [];
  o.traverse((x) => { saved.push([x, x.userData]); x.userData = {}; });
  const c = o.clone(true);
  for (const [x, ud] of saved) x.userData = ud;
  c.traverse((x) => x.layers.set(0)); // las piezas de la cara viven en una capa escondida (ver facebatch.js)
  return c;
}

// casco convexo (monotone chain) de puntos 2D
function hull(pts) {
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

export class Slices {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.slots = []; // juegos de materiales reutilizables
    this.warming = [];
  }

  // juego de materiales para cortar a la gelatina j (2 mitades + tatuaje + cara del corte)
  _slot(j) {
    let s = this.slots.find((x) => !x.busy);
    if (!s) {
      const planes = [new THREE.Plane(), new THREE.Plane()];
      s = {
        busy: false,
        planes,
        body: planes.map((pl) => {
          const m = j.material.clone();
          m.clippingPlanes = [pl];
          m.clipShadows = true;
          m.side = THREE.DoubleSide;
          return glassMaterial(m);
        }),
        tat: [null, null],
        cap: glassMaterial(new THREE.MeshPhysicalMaterial({
          roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, transmission: 0.2, thickness: 0.6, emissiveIntensity: 0.12, side: THREE.DoubleSide,
        }), 0.92),
      };
      this.slots.push(s);
    }
    s.busy = true;
    // colores de esta gelatina (cambiar colores no recompila nada)
    for (const m of s.body) {
      m.color.copy(j.material.color);
      m.emissive.copy(j.material.emissive);
      m.attenuationColor.copy(j.material.attenuationColor);
      m.emissiveIntensity = 0.22;
    }
    s.cap.color.copy(j.color).multiplyScalar(0.85);
    s.cap.emissive.copy(j.color);
    if (j.tattoo?.visible) {
      for (let i = 0; i < 2; i++) {
        if (!s.tat[i]) {
          s.tat[i] = j.tattoo.material.clone();
          s.tat[i].clippingPlanes = [s.planes[i]];
        }
        s.tat[i].map = j.tattoo.material.map;
      }
    }
    return s;
  }

  // Precalentado: cortes reales pero diminutos y escondidos bajo el piso, para que la placa de video
  // compile ahora (al cargar la arena) exactamente los mismos materiales que usa un corte de verdad.
  warmBegin(jellies) {
    for (const j of jellies) if (j) this.warming.push(this.cut(j, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), true));
  }

  warmEnd() {
    for (const c of this.warming) this._release(c);
    this.warming.length = 0;
  }

  // j: gelatina (todavía visible) · normal: normal horizontal de la hoja · along: dirección de la hoja
  cut(j, normal, along, hidden = false) {
    const S = j.size, r = j.r, color = j.color.clone();
    const n = _v.copy(normal).setY(0).normalize().clone();
    const al = along.clone().setY(0).normalize();
    const center = j.root.position.clone();
    const geo = j.geo.clone(); // forma del instante del corte (coordenadas locales, sin escala)
    const P = geo.attributes.position.array;
    const slot = this._slot(j);

    // contorno del corte: puntos cerca del plano, en coordenadas (a lo largo, alto)
    let pts = [];
    for (let band = 0.12; pts.length < 12 && band < 0.6; band *= 1.8) {
      pts = [];
      for (let i = 0; i < P.length; i += 3) {
        if (Math.abs(P[i] * n.x + P[i + 2] * n.z) < band) pts.push(new THREE.Vector2(P[i] * al.x + P[i + 2] * al.z, P[i + 1]));
      }
    }
    const outline = hull(pts).map((p) => p.multiplyScalar(0.985));
    const capGeo = new THREE.ShapeGeometry(new THREE.Shape(outline), 1);
    const basis = new THREE.Matrix4().makeBasis(al, UP, new THREE.Vector3().crossVectors(al, UP));
    capGeo.applyMatrix4(basis);

    const halves = [];
    for (const [i, s] of [[0, 1], [1, -1]]) {
      const sn = n.clone().multiplyScalar(s);
      // bisagra: borde de abajo, del lado de afuera de cada mitad
      const pivot = new THREE.Group();
      pivot.position.copy(center).addScaledVector(sn, r * 0.45).setY(center.y - r * 0.95);
      const inner = new THREE.Group();
      inner.position.subVectors(center, pivot.position);
      inner.scale.setScalar(S);
      pivot.add(inner);
      const body = new THREE.Mesh(geo, slot.body[i]);
      body.castShadow = true;
      body.frustumCulled = false;
      inner.add(body);
      if (j.tattoo?.visible) {
        const tat = new THREE.Mesh(geo, slot.tat[i]);
        tat.renderOrder = 2;
        tat.frustumCulled = false;
        inner.add(tat);
      }
      // ojos, boca, cachetes y burbujas: cada uno se va con la mitad en la que estaba
      for (const o of [...j.features.map((f) => f.obj), ...j.bubbles]) {
        if ((o.position.x * sn.x + o.position.z * sn.z) <= 0) continue;
        inner.add(cloneLite(o));
      }
      const cap = new THREE.Mesh(capGeo, slot.cap);
      cap.position.addScaledVector(sn, 0.004);
      inner.add(cap);
      this.scene.add(pivot);
      halves.push({
        s, sn, pivot, inner,
        plane: slot.planes[i],
        local: new THREE.Plane(sn.clone(), 0), // plano del corte en coordenadas de la gelatina
        ang: 0, angVel: 0, wob: 0, wobVel: 0, vy: 0, baseY: pivot.position.y,
        axis: new THREE.Vector3().crossVectors(UP, sn).normalize(), // girar sobre este eje lleva la punta hacia sn
        slide: s * (0.18 + Math.random() * 0.08), // la mitad que se desliza por el corte
        open: 1.15 + Math.random() * 0.35,
      });
    }
    const c = { t: 0, halves, geo, capGeo, slot, color, S, r, puddled: false };

    if (hidden) {
      for (const h of halves) {
        h.pivot.scale.setScalar(0.001);
        h.pivot.position.set(0, -0.6, 0);
        h.pivot.traverse((o) => { o.frustumCulled = false; });
        h.pivot.updateMatrixWorld(true);
        h.plane.copy(h.local).applyMatrix4(h.inner.matrixWorld);
      }
      return c;
    }
    // salpicón del corte
    fx.burst(center, color, 30, 7, UP, 0.12 * S);
    fx.burst(center, color, 14, 6, n, 0.1 * S, true);
    fx.burst(center, color, 14, 6, n.clone().negate(), 0.1 * S, true);
    fx.burst(center, new THREE.Color('#ffffff'), 10, 9, UP, 0.05);
    fx.ring(center, n, new THREE.Color('#fff4d0'), 2.2 * S);

    this.list.push(c);
    return c;
  }

  clear() {
    for (const c of this.list) this._release(c);
    this.list.length = 0;
  }

  // saca las mitades de la escena y devuelve el juego de materiales (sin descartarlo)
  _release(c) {
    for (const h of c.halves) this.scene.remove(h.pivot);
    c.geo.dispose();
    c.capGeo.dispose();
    c.slot.busy = false;
  }

  update(dt) {
    // pasos chicos: los resortes se vuelven inestables con frames largos
    const n = Math.ceil(dt / (1 / 60));
    for (let k = 0; k < n; k++) this._step(dt / n);
  }

  _step(dt) {
    const floorAt = fx.floorAt || (() => true);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.t += dt;
      const t = c.t;
      for (const h of c.halves) {
        // 1) se desliza por el corte (un instante quieta, como en las películas)
        const sl = Math.min(1, Math.max(0, (t - 0.06) / 0.22));
        const slideY = -Math.abs(h.slide) * c.r * 0.35 * sl * (h.s > 0 ? 1 : 0);
        // 2) se abre hacia afuera con resorte (rebota como gelatina)
        const target = t > 0.22 ? h.open : 0;
        h.angVel += ((target - h.ang) * 70 - h.angVel * 5.5) * dt;
        h.ang += h.angVel * dt;
        if (h.ang < 0) { h.ang = 0; h.angVel = 0; }
        h.pivot.quaternion.setFromAxisAngle(h.axis, h.ang);
        // bamboleo de la gelatina (se aplasta y estira)
        h.wobVel += (-h.wob * 160 - h.wobVel * 4) * dt;
        if (t > 0.22 && t - dt <= 0.22) h.wobVel += 4;
        if (Math.abs(h.ang - h.open) < 0.04 && Math.abs(h.angVel) > 1.5) h.wobVel -= h.angVel * 0.05;
        h.wob += h.wobVel * dt;
        // 3) se derrite al final
        const melt = Math.min(1, Math.max(0, (t - 2.6) / 1.1));
        const sy = (1 + h.wob * 0.25) * (1 - melt * 0.5), sxz = (1 - h.wob * 0.12) * (1 + melt * 0.25);
        h.inner.scale.set(c.S * sxz, c.S * sy, c.S * sxz);
        // se separan un poco y caen al piso si estaban en el aire
        const out = Math.min(1, t / 0.6);
        h.pivot.position.addScaledVector(h.sn, dt * (1 - out) * 1.6 * c.S);
        const px = h.pivot.position.x, pz = h.pivot.position.z;
        if (h.baseY > 0 || !floorAt(px, pz)) {
          h.vy -= 30 * dt;
          h.baseY += h.vy * dt;
          if (floorAt(px, pz) && h.baseY < 0) { h.baseY = 0; h.vy = 0; h.wobVel -= 3; }
        }
        h.pivot.position.y = h.baseY - melt * melt * c.r * 1.4; // se hunde en el charco
        h.inner.position.y = c.r * 0.95 + slideY;
        // el plano de recorte sigue a la mitad
        h.pivot.updateMatrixWorld(true);
        h.plane.copy(h.local).applyMatrix4(h.inner.matrixWorld);
        // goteo de la cara cortada
        if (t < 1.8 && Math.random() < dt * 14) {
          h.inner.localToWorld(_v.set((Math.random() - 0.5) * 0.8, (Math.random() - 0.3) * 0.8, 0));
          fx.burst(_v, c.color, 1, 1.5, DOWN, 0.07 * c.S);
        }
      }
      if (t > 2.6 && !c.puddled) {
        c.puddled = true;
        for (const h of c.halves) {
          const p = h.inner.localToWorld(_v.set(0, 0, 0)).clone();
          if (floorAt(p.x, p.z) && h.baseY < 0.5) fx.puddle(p.setY(0.02), UP, c.color.clone().multiplyScalar(0.6), 1.2 * c.S);
        }
      }
      if (t > 3.8 || c.halves[0].baseY < -30) { this._release(c); this.list.splice(i, 1); }
    }
  }
}
