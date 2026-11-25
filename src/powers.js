import * as THREE from 'three';
import { CONFIG } from './config.js';

// Poderes de las bolitas amarillas. Los que tienen `throw` son armas para tirar, cada una con su tecla;
// el resto se activa solo apenas lo agarrás.
export const POWERS = {
  oil: { name: 'Aceite', icon: '🛢️', desc: 'Se tira hacia atrás: mancha resbalosa para quien te persigue', throw: true, key: 'D' },
  spit: { name: 'Chorro', icon: '💦', desc: 'Chorro pegajoso a distancia: quien lo recibe queda mareado', throw: true, key: 'F' },
  turbo: { name: 'Turbo', icon: '💨', desc: 'Doble de velocidad (30 s)' },
  strength: { name: 'Fuerza', icon: '💪', desc: 'Tus golpes pegan más fuerte (30 s)' },
  heal: { name: 'Firmeza', icon: '🛡️', desc: 'Vuelves a estar firme como recién hecha' },
  feast: { name: 'Banquete', icon: '🍮', desc: 'Equivale a 10 blobcitos' },
};
export const POWER_KEYS = Object.keys(POWERS);
export const randomPower = () => POWER_KEYS[Math.floor(Math.random() * POWER_KEYS.length)];

// Manchas de aceite: las gelatinas que pasan por encima patinan.
export class OilSlicks {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.freeMats = []; // materiales de manchas viejas, para reutilizar
    this.mat = new THREE.MeshPhysicalMaterial({
      color: '#140f0a', roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02,
      iridescence: 1, iridescenceIOR: 1.35, transparent: true,
    });
  }

  spawn(x, z, owner) {
    const sh = new THREE.Shape();
    const ph = Math.random() * 6;
    for (let k = 0; k <= 48; k++) {
      const t = (k / 48) * Math.PI * 2;
      const rr = 1 + 0.18 * Math.sin(3 * t + ph) + 0.1 * Math.sin(5 * t + ph * 2) + 0.06 * Math.sin(9 * t);
      if (k === 0) sh.moveTo(Math.cos(t) * rr, Math.sin(t) * rr); else sh.lineTo(Math.cos(t) * rr, Math.sin(t) * rr);
    }
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), this.freeMats.pop() || this.mat.clone());
    m.material.opacity = 0.95;
    m.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
    m.position.set(x, 0.025, z);
    m.scale.setScalar(0.05);
    m.receiveShadow = true;
    this.scene.add(m);
    this.list.push({ mesh: m, x, z, t: CONFIG.oilLife, owner, age: 0 });
    this.onSpawn?.(x, z, owner); // el servidor avisa a los jugadores
  }

  clear() {
    for (const o of this.list) this._free(o);
    this.list.length = 0;
  }

  _free(o) { this.scene.remove(o.mesh); o.mesh.geometry.dispose(); this.freeMats.push(o.mesh.material); }

  // precalentado: una mancha escondida bajo el piso para que su material quede compilado
  warmBegin() {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.01, 8), this.freeMats.pop() || this.mat.clone());
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, -0.6, 0);
    this.scene.add(m);
    this._warm = m;
  }

  warmEnd() {
    const m = this._warm;
    if (!m) return;
    this.scene.remove(m); m.geometry.dispose(); this.freeMats.push(m.material);
    this._warm = null;
  }

  // marca a las gelatinas que están arriba de una mancha
  step(dt, jellies, now = 0) {
    const R = CONFIG.oilRadius;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t -= dt;
      o.age += dt;
      if (o.t <= 0) { this._free(o); this.list.splice(i, 1); continue; }
      for (const j of jellies) {
        if (j.dead || j.impaled || !j.grounded) continue;
        if (j === o.owner && o.age < 1) continue;
        if (j !== o.owner && o.owner && this.friendly?.(o.owner, j)) continue; // equipos: no hace patinar a los compañeros
        if ((j.pos.x - o.x) ** 2 + (j.pos.z - o.z) ** 2 < (R + j.r * 0.4) ** 2) {
          if (j.oilT <= 0) j.justSlipped = true;
          if (o.owner && o.owner !== j) { j.slipBy = o.owner; j.slipTime = now; } // si se cae, el KO es de quien tiró el aceite
          j.oilT = 0.4;
        }
      }
    }
  }

  update(dt) {
    for (const o of this.list) {
      const s = Math.min(CONFIG.oilRadius, o.mesh.scale.x + dt * 14);
      o.mesh.scale.setScalar(s);
      o.mesh.material.opacity = Math.min(1, o.t / 2) * 0.95;
    }
  }
}
