import * as THREE from 'three';
import { glassMaterial } from './quality.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { fx } from './fx.js';

// Cosas que se tiran: escupitajo (recto y rápido, marea al que toca) y mancha de aceite (en arco,
// deja la mancha donde cae). Chocan contra paredes y piso con un rayo de Rapier por paso.
const _a = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _white = new THREE.Color('#ffffff');

export class Projectiles {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.sphere = new THREE.SphereGeometry(1, 16, 12);
    this.freeSpit = []; // materiales de escupitajos para reutilizar
    this.oilMat = new THREE.MeshPhysicalMaterial({ color: '#16100a', roughness: 0.05, metalness: 0.2, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.35 });
  }

  // kind: 'spit' | 'oil'
  spawn(kind, owner, pos, vel) {
    const spit = kind === 'spit';
    const size = (spit ? 0.24 : 0.42) * Math.sqrt(owner.size);
    let mat = this.oilMat;
    if (spit) {
      mat = this._spitMat();
      mat.color.copy(owner.color).lerp(_white, 0.55);
      mat.emissive.copy(owner.color);
    }
    const m = new THREE.Mesh(this.sphere, mat);
    m.scale.setScalar(size);
    m.position.copy(pos);
    m.castShadow = true;
    this.scene.add(m);
    this.list.push({ kind, owner, mesh: m, pos: pos.clone(), vel: vel.clone(), size, t: 0, g: spit ? -9 : -30, color: spit ? mat.color.clone() : new THREE.Color('#2a1f12') });
    this.onSpawn?.(kind, owner, pos, vel); // el servidor avisa a los jugadores
  }

  _spitMat() {
    return this.freeSpit.pop() || glassMaterial(new THREE.MeshPhysicalMaterial({ transmission: 0.5, thickness: 0.4, roughness: 0.08, clearcoat: 1, emissiveIntensity: 0.35 }), 0.8);
  }

  // precalentado: un escupitajo y un aceite escondidos bajo el piso (para que sus materiales queden compilados)
  warmBegin() {
    this._warm = [this._spitMat(), this.oilMat].map((mat) => {
      const m = new THREE.Mesh(this.sphere, mat);
      m.position.set(0, -0.6, 0);
      m.scale.setScalar(0.01);
      this.scene.add(m);
      return m;
    });
  }

  warmEnd() {
    for (const m of this._warm || []) { this.scene.remove(m); if (m.material !== this.oilMat) this.freeSpit.push(m.material); }
    this._warm = null;
  }

  clear() {
    for (const p of this.list) this._remove(p);
    this.list.length = 0;
  }

  _remove(p) {
    this.scene.remove(p.mesh);
    if (p.kind === 'spit') this.freeSpit.push(p.mesh.material);
  }

  // hooks.hit(p, jelly) · hooks.land(p, point, normal)
  step(dt, jellies, hooks) {
    const jc = new Set(jellies.map((j) => j.collider.handle));
    const notJelly = (c) => !jc.has(c.handle);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.vel.y += p.g * dt;
      const move = _a.copy(p.vel).multiplyScalar(dt);
      const len = move.length();
      let done = false;
      // ¿le pegó a una gelatina?
      for (const j of jellies) {
        if (j === p.owner && p.t < 0.4) continue;
        if (j.dead || j.impaled) continue;
        if (j !== p.owner && this.friendly?.(p.owner, j)) continue; // equipos: atraviesa a los compañeros
        // distancia del segmento a la gelatina
        const rx = j.pos.x - p.pos.x, ry = j.pos.y - p.pos.y, rz = j.pos.z - p.pos.z;
        const k = len > 0 ? Math.max(0, Math.min(1, (rx * move.x + ry * move.y + rz * move.z) / (len * len))) : 0;
        const dx = rx - move.x * k, dy = ry - move.y * k, dz = rz - move.z * k;
        if (dx * dx + dy * dy + dz * dz < (j.r + p.size) ** 2) {
          p.pos.addScaledVector(move, k);
          hooks.hit(p, j);
          done = true;
          break;
        }
      }
      // ¿pared o piso?
      if (!done && len > 0) {
        const ray = new RAPIER.Ray({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, { x: move.x / len, y: move.y / len, z: move.z / len });
        const hit = this.world.castRayAndGetNormal(ray, len + p.size * 0.5, true, undefined, undefined, undefined, undefined, notJelly);
        if (hit) {
          const toi = hit.timeOfImpact ?? hit.toi;
          p.pos.addScaledVector(move, toi / len);
          hooks.land(p, p.pos.clone(), new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z));
          done = true;
        }
      }
      if (!done) {
        p.pos.add(move);
        if (p.pos.y < -25 || p.t > 4) done = true;
      }
      if (done) { this._remove(p); this.list.splice(i, 1); continue; }
      // estela
      if (Math.random() < dt * (p.kind === 'spit' ? 40 : 15)) fx.burst(p.pos, p.color, 1, 1, null, p.size * 0.4);
    }
  }

  update() {
    for (const p of this.list) {
      p.mesh.position.copy(p.pos);
      // se estira en la dirección en la que vuela
      const sp = p.vel.length();
      if (sp > 0.1) p.mesh.quaternion.setFromUnitVectors(_z, _a.copy(p.vel).divideScalar(sp));
      const st = 1 + Math.min(0.9, sp * 0.03);
      p.mesh.scale.set(p.size / Math.sqrt(st), p.size / Math.sqrt(st), p.size * st);
    }
  }
}
