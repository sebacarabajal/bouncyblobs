import * as THREE from 'three';
import { CONFIG } from './config.js';

// Vistas predefinidas (V para ciclar, C para volver a "Juego").
// "Juego" es la cámara con la que arranca la partida: sale de CONFIG (se elige en el admin → 🎥 Cámara inicial).
export const CAM_PRESETS = [
  { key: 'game', yaw: 0, get pitch() { return CONFIG.camPitch; }, get dist() { return CONFIG.camDist; } },
  { key: 'ref', yaw: 0, pitch: 0.47, dist: 37 },
  { key: 'far', yaw: 0.45, pitch: 0.55, dist: 58 },
  { key: 'top', yaw: 0, pitch: 1.35, dist: 46 },
];

// Cámara orbital que sigue al jugador.
// Arrastrar con el mouse = girar · rueda = zoom · stick derecho del gamepad = girar.
export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.shake = 0;
    this.presetIndex = 0;
    this.set(CAM_PRESETS[0], true);
    this._off = new THREE.Vector3();

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    // un dedo (o el mouse) = girar · dos dedos = pellizcar para zoom
    const ptrs = new Map();
    let pinch = 0;
    const spread = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) pinch = spread();
    });
    dom.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size >= 2) {
        const d = spread();
        if (pinch > 0 && d > 0) this.tDist = THREE.MathUtils.clamp(this.tDist * (pinch / d), 10, 110);
        pinch = d;
        return;
      }
      const touch = e.pointerType === 'touch' ? 1.6 : 1; // con el dedo, un poco más sensible
      this.tYaw -= dx * 0.005 * touch;
      this.tPitch = THREE.MathUtils.clamp(this.tPitch + dy * 0.004 * touch, 0.08, 1.5);
    });
    const end = (e) => { ptrs.delete(e.pointerId); pinch = ptrs.size === 2 ? spread() : 0; };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.tDist = THREE.MathUtils.clamp(this.tDist * Math.exp(e.deltaY * 0.001), 10, 110);
    }, { passive: false });
  }

  set(p, instant = false) {
    this.tYaw = p.yaw; this.tPitch = p.pitch; this.tDist = p.dist;
    if (instant) { this.yaw = p.yaw; this.pitch = p.pitch; this.dist = p.dist; }
  }

  cycle() {
    this.presetIndex = (this.presetIndex + 1) % CAM_PRESETS.length;
    this.set(CAM_PRESETS[this.presetIndex]);
    return CAM_PRESETS[this.presetIndex].key;
  }

  reset() { this.presetIndex = 0; this.set(CAM_PRESETS[0]); }

  // Convierte el input (W = alejarse de la cámara) a dirección de mundo.
  toWorld(mx, mz) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return [mx * c + mz * s, -mx * s + mz * c];
  }

  update(dt, focus, zoom = 1) {
    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const ax = pad.axes[2] ?? 0, ay = pad.axes[3] ?? 0;
      if (Math.abs(ax) > 0.2) this.tYaw -= ax * 2.2 * dt;
      if (Math.abs(ay) > 0.2) this.tPitch = THREE.MathUtils.clamp(this.tPitch + ay * 1.4 * dt, 0.08, 1.5);
    }
    const k = 1 - Math.exp(-12 * dt);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    this.dist += (this.tDist - this.dist) * (1 - Math.exp(-8 * dt));

    this.target.lerp(focus, 1 - Math.exp(-CONFIG.camFollow * dt)); // qué tan rápido te alcanza (antes 4: quedaba atrás al correr)
    const d = this.dist * zoom, cp = Math.cos(this.pitch);
    this._off.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(d);
    this.camera.position.copy(this.target).add(this._off);
    this.shake *= Math.exp(-8 * dt);
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.target);
  }
}
