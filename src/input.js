import { unlockAudio } from './sfx.js';
import { keys as K, actionOf, norm } from './keys.js';

// Teclado + mouse + primer gamepad. Las teclas de cada acción salen de keys.js (presets flechas / WASD,
// o las que elija el jugador en Opciones). Por defecto: flechas mover · Shift correr · Espacio saltar ·
// E embestir · D aceite · F chorro.
// Los "edges" (jump/dash) quedan pendientes hasta que un paso de física los consume.
export class Input {
  constructor() {
    this.keys = new Set();
    this.jumpPressed = false;
    this.dashPressed = false;
    this.throwPressed = null; // 'oil' | 'spit'
    this.handlers = {};
    this.keyHandlers = {};
    this.mashCount = 0; // para despabilarse cuando está mareado
    this.padPrev = {};
    this.enabled = true; // false mientras está abierta la pantalla de inicio
    this.touch = { mx: 0, mz: 0, sprint: false, jumpHeld: false, active: false }; // lo llena touch.js

    addEventListener('keydown', (e) => {
      unlockAudio();
      if (e.repeat || !this.enabled) return;
      if (e.target instanceof HTMLInputElement) return;
      const code = norm(e.code);
      this.keys.add(code);
      const act = actionOf(code);
      if (act) {
        e.preventDefault(); // que Espacio o las flechas no muevan la página
        if (act === 'jump') this.jumpPressed = true;
        if (act === 'dash') this.dashPressed = true;
        // cada arma tiene su tecla (no se reemplazan: se guardan las dos)
        if (act === 'oil') this.throwPressed = 'oil';
        if (act === 'spit') this.throwPressed = 'spit';
        this.mashCount++;
        return; // una tecla del jugador no dispara además un atajo (ej. D con WASD)
      }
      this.handlers[e.code]?.();
      this.keyHandlers[e.key]?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(norm(e.code)));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('pointerdown', unlockAudio);
    // en iPhone el audio sólo se puede prender al soltar el dedo (pointerdown no cuenta como "gesto")
    addEventListener('pointerup', unlockAudio);
    addEventListener('touchend', unlockAudio);
  }

  on(code, fn) { this.handlers[code] = fn; }
  // por carácter (sirve para + y - en cualquier distribución de teclado)
  onKey(key, fn) { this.keyHandlers[key] = fn; }

  // Devuelve el comando del jugador (dirección en mundo: W = -z).
  command() {
    if (!this.enabled) return { mx: 0, mz: 0, jumpHeld: false, sprint: false, jump: false, dash: false, throw: null };
    const k = this.keys;
    const m = K.map, on = (a) => k.has(m[a]);
    let mx = (on('right') ? 1 : 0) - (on('left') ? 1 : 0);
    let mz = (on('down') ? 1 : 0) - (on('up') ? 1 : 0);
    let jumpHeld = on('jump');
    let sprint = on('sprint');
    const t = this.touch;
    if (t.mx || t.mz) { mx = t.mx; mz = t.mz; }
    jumpHeld = jumpHeld || t.jumpHeld;
    sprint = sprint || t.sprint;

    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const ax = pad.axes[0] ?? 0, az = pad.axes[1] ?? 0;
      if (Math.hypot(ax, az) > 0.2) { mx = ax; mz = az; }
      const a = pad.buttons[0]?.pressed;
      const x = pad.buttons[2]?.pressed || pad.buttons[1]?.pressed || pad.buttons[7]?.pressed;
      const y = pad.buttons[3]?.pressed, lb = pad.buttons[4]?.pressed; // Y = chorro · LB = aceite
      if (a && !this.padPrev.a) this.jumpPressed = true;
      if (x && !this.padPrev.x) this.dashPressed = true;
      if (y && !this.padPrev.y) this.throwPressed = 'spit';
      if (lb && !this.padPrev.lb) this.throwPressed = 'oil';
      jumpHeld = jumpHeld || a;
      sprint = sprint || pad.buttons[5]?.pressed || pad.buttons[6]?.pressed || pad.buttons[10]?.pressed;
      this.padPrev = { a, x, y, lb };
    }

    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    return { mx, mz, jumpHeld, sprint, jump: false, dash: false, throw: null };
  }

  consumeEdges(cmd) {
    cmd.jump = this.jumpPressed;
    cmd.dash = this.dashPressed;
    cmd.throw = this.throwPressed;
    this.jumpPressed = false;
    this.dashPressed = false;
    this.throwPressed = null;
  }
}
