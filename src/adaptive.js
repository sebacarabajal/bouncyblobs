// Ritmo y calidad automáticos: el juego se adapta solo a cada monitor y a cada PC.
//
// 1) RITMO (cuántos frames por segundo se dibujan). El monitor da un "tic" cada 1/Hz. Se mide su frecuencia
//    y se arma una lista de ritmos parejos: 144 Hz → [144, 72], 165 → [165, 82,5, 55], 120 → [120, 60],
//    60 → [60]. Si ningún ritmo parejo da 55 o más y el más bajo pasa de 65 (100 Hz, 90, 75…), se agrega
//    "60 fijos" (un poco desparejo, pero mejor que bajar la calidad).
//    Arranca en el más alto. Si más del 8 % de los frames llegan tarde, baja al siguiente. Cada tanto prueba
//    volver a subir, si el trabajo por frame entra holgado en el ritmo más rápido. Si la prueba falla,
//    espera el doble antes de volver a probar (10 s, 20 s, 40 s… hasta ~2,5 min).
//    La física no cambia (paso fijo de 1/120 s): sólo se dibuja más o menos seguido.
//
// 2) CALIDAD (sólo si ya está en el ritmo más bajo y aun así no llega):
//    - si la placa de video es la que no da (o no se puede medir y la CPU sobra): baja la resolución
//      de a 10 %, hasta el 60 %. Es casi invisible y rinde mucho. Cuando sobra, la vuelve a subir de a poco.
//    - si con eso no alcanza (4 s seguidos), baja un nivel de calidad (alta → media → baja → mínima).
//    - goodT cuenta los segundos seguidos con margen de sobra: main.js sube un nivel al cargar la próxima arena
//      (tapado por la pantalla de carga), así un mal momento no deja la calidad baja para siempre.
const MIN_FPS = 55;
const LOW_FPS = 28; // último recurso (ya en calidad mínima y sin llegar): 30 parejos se sienten mejor que 45 a los saltos
const RES_SOFT = 0.8; // hasta acá baja la resolución antes de tocar el nivel de calidad
const LATE = 0.08; // fracción de frames tarde que ya se nota
export const RES_MIN = 0.6;

const p90 = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
const win = () => ({ n: 0, late: 0, work: [], cpu: 0, gpu: 0, gpuN: 0, t: 0 });

export class Adaptive {
  // onLevelDown() devuelve false si ya no hay un nivel más bajo
  constructor({ onResScale, onLevelDown } = {}) {
    this.cb = { onResScale, onLevelDown };
    this.allowLow = false; this.lowestQuality = false;
    this.hz = 0;
    this.levels = [{ k: 1, fps: 60 }];
    this.lvl = 0;
    this.mode = 'auto';
    this._ticks = []; this._prevTick = 0;
    this.lastDraw = -1e9; this.next = 0; this._late = false; this._iv = 0;
    this.pw = win(); this.qw = win();
    this.probing = false; this.probeIn = 10; this.probeDelay = 10;
    this.hold = 2; // segundos sin juzgar (arranque, cargas, cambios de resolución)
    this.lateRate = 0;
    this.resScale = 1; this.resUp = 0; this.resProbe = 8; this.resRaisedAt = -1e9; this.clock = 0;
    this.struggleT = 0; this.goodT = 0;
  }

  // ritmo que se usa ahora según el modo del admin ('auto' | '60' | 'off')
  get level() {
    if (this.mode === 'off' || !this.hz) return { k: 1, fps: this.hz || 60 };
    if (this.mode === '60') return this.hz > 65 ? { fixed: 60, fps: 60 } : { k: 1, fps: this.hz };
    return this.levels[this.lvl];
  }
  get target() { return this.level.fps; }
  get canSlowDown() { return this.mode === 'auto' && this.lvl < this.levels.length - 1; }
  holdFor(s) { this.hold = Math.max(this.hold, s); }

  _setHz(hz) {
    this.hz = hz;
    this.levels = this._levels();
    this.lvl = 0; this.probing = false; this.probeDelay = 10; this.probeIn = 10;
    this.holdFor(2);
  }

  _levels() {
    const hz = this.hz, L = [];
    for (let k = 1; hz / k >= MIN_FPS; k++) L.push({ k, fps: hz / k });
    if (!L.length) L.push({ k: 1, fps: hz }); // monitor de menos de 55 Hz
    if (L[L.length - 1].fps > 65) L.push({ fixed: 60, fps: 60 });
    if (this.allowLow) {
      let k = L[L.length - 1].k ? L[L.length - 1].k + 1 : Math.ceil(hz / 60) + 1;
      for (; hz / k >= LOW_FPS; k++) if (Number.isInteger(hz / k) || hz / k <= 36) { L.push({ k, fps: hz / k }); break; }
    }
    return L;
  }

  // en cada requestAnimationFrame: ¿se dibuja este tic?
  tick(now, mode) {
    this.mode = mode;
    const d = now - this._prevTick;
    this._prevTick = now;
    // la frecuencia del monitor sólo se mide con tics que siguen a un frame liviano (uno salteado, o la pantalla
    // de inicio sin arena): si el frame anterior fue pesado, el tic llega tarde y daría menos Hz de los reales
    // (una PC que no llega a 60 en un monitor de 60 "mediría" 30)
    if (this._cheap !== false && d > 3 && d < 100) {
      this._ticks.push(d);
      if (this._ticks.length >= 60) {
        const s = this._ticks.sort((a, b) => a - b);
        const hz = Math.round(1000 / s[s.length >> 1]);
        this._ticks = [];
        if (!this.hz || Math.abs(hz - this.hz) / this.hz > 0.05) this._setHz(hz); // otro monitor
      }
    }
    this._cheap = true; // si este tic no dibuja, el próximo llega a tiempo
    if (!this.hz) return this._draw(now, Infinity);
    const vs = 1000 / this.hz, L = this.level;
    if (L.fixed) {
      if (now < this.next - vs * 0.5) return false;
      const iv = 1000 / L.fixed;
      this.next = now - this.next > iv ? now + iv : this.next + iv;
      return this._draw(now, (Math.ceil(iv / vs - 0.01) + 0.5) * vs);
    }
    if (now - this.lastDraw < L.k * vs - vs * 0.5) return false;
    return this._draw(now, (L.k + 0.5) * vs);
  }

  _draw(now, lateAfter) {
    this._cheap = 'pending'; // frameDone dice si fue liviano (si no se llama, fue un frame vacío: liviano)
    const iv = now - this.lastDraw;
    this.lastDraw = now;
    this._iv = iv < 250 ? iv : 0; // pestaña escondida o recién vuelta: no cuenta
    this._late = this._iv > 0 && iv > lateAfter;
    return true;
  }

  // después de dibujar: cuánto tardó (JS) y cuánto la placa (null si no se puede medir).
  // active = se puede tocar la calidad (calidad automática, jugando, sin pantalla de carga)
  frameDone(workMs, gpuMs, active, autoLevel = true) {
    this.autoLevel = autoLevel;
    this._cheap = workMs < 2 && (gpuMs ?? 0) < 2;
    const dt = this._iv / 1000;
    if (!dt) return;
    this.clock += dt;
    if (this.hold > 0) { this.hold -= dt; return; }
    for (const w of [this.pw, this.qw]) {
      w.n++; w.t += dt;
      if (this._late) w.late++;
      w.work.push(Math.max(workMs, gpuMs ?? 0));
      w.cpu += workMs;
      if (gpuMs != null) { w.gpu += gpuMs; w.gpuN++; }
    }
    if (this.pw.t >= 2) this._pace();
    if (this.qw.t >= 1) this._quality(active);
  }

  _pace() {
    const w = this.pw;
    this.pw = win();
    if (w.n < 10) return;
    const late = w.late / w.n;
    this.lateRate = late;
    if (this.mode !== 'auto') return;
    // tarde PERO con poco trabajo = la culpa es del navegador/escritorio (otro programa, el compositor de
    // Linux…), no del juego: bajar el ritmo no lo arregla. Sólo se baja si el frame de verdad es pesado.
    // (si no se puede medir la placa, el trabajo medido no la incluye: ahí cuenta que lleguen tarde MUCHOS frames)
    this.heavy = p90(w.work) > 0.6 * (1000 / this.target) || (!w.gpuN && late > 0.3);
    if (late > LATE && this.heavy) {
      if (this.probing) { this.probing = false; this.probeDelay = Math.min(this.probeDelay * 2, 160); }
      if (this.lvl < this.levels.length - 1) { this.lvl++; this.probeIn = this.probeDelay; this.holdFor(0.5); }
      return;
    }
    if (this.probing) { this.probing = false; this.probeDelay = 10; } // aguantó el ritmo más rápido
    if (this.lvl > 0) {
      this.probeIn -= w.t;
      const faster = 1000 / this.levels[this.lvl - 1].fps;
      if (this.probeIn <= 0 && p90(w.work) < 0.75 * faster) {
        this.lvl--; this.probing = true; this.probeIn = this.probeDelay; this.holdFor(0.5);
      }
    }
  }

  _setRes(s) {
    s = Math.round(Math.min(1, Math.max(RES_MIN, s)) * 10) / 10;
    if (s === this.resScale) return;
    if (s > this.resScale) this.resRaisedAt = this.clock;
    else if (this.clock - this.resRaisedAt < 5) this.resProbe = Math.min(this.resProbe * 2, 120); // subirla no anduvo
    this.resScale = s;
    this.cb.onResScale?.(s);
    this.holdFor(1);
  }

  _quality(active) {
    const w = this.qw;
    this.qw = win();
    if (!active || w.n < 5) { this.struggleT = 0; return; } // en el menú no se juzga (goodT queda como estaba)
    const budget = 1000 / this.target;
    const late = w.late / w.n, fps = w.n / w.t;
    const cpu = w.cpu / w.n, gpu = w.gpuN ? w.gpu / w.gpuN : null;
    // en automático: frames tarde y el ritmo ya no puede bajar más · en los otros modos: menos de ~60 fps
    const heavy = p90(w.work) > 0.6 * budget || (!w.gpuN && late > 0.3); // ver _pace: sin trabajo pesado, no es culpa del juego
    const bad = heavy && (this.mode === 'auto' ? late > LATE && !this.canSlowDown : fps < Math.min(this.target, 60) * 0.9);
    const gpuBound = gpu != null ? gpu > 0.7 * budget : cpu < 0.5 * budget;
    if (bad) {
      this.goodT = 0; this.resUp = 0;
      this.struggleT++;
      // resolución hasta 80 %; después, nivel de calidad; ya en mínima, resolución hasta 60 %; y por último, 30 fps
      const lowest = this.lowestQuality || !this.autoLevel; // calidad elegida a mano: no se toca el nivel
      const floor = lowest ? RES_MIN : RES_SOFT;
      if (gpuBound && this.resScale > floor + 1e-3) { this._setRes(this.resScale - 0.1); return; }
      if (this.struggleT >= 4) {
        this.struggleT = 0;
        if (!lowest && this.cb.onLevelDown?.() !== false) { this.holdFor(3); return; }
        if (this.autoLevel) this.lowestQuality = true;
        if (gpuBound && this.resScale > RES_MIN + 1e-3) return;
        if (!this.allowLow && this.mode === 'auto') { this.allowLow = true; this.levels = this._levels(); this.lvl = this.levels.length - 1; this.holdFor(1); }
      }
      return;
    }
    this.struggleT = 0;
    if (this.resScale < 1) {
      const room = gpu != null ? gpu < 0.45 * budget && late < 0.02 : late === 0;
      this.resUp = room ? this.resUp + 1 : 0;
      if (this.resUp >= (gpu != null ? 3 : this.resProbe)) { this.resUp = 0; this._setRes(this.resScale + 0.1); }
    }
    const comfy = late < 0.02 && Math.max(cpu, gpu ?? 0) < 0.5 * budget && this.resScale >= 1;
    this.goodT = comfy ? this.goodT + 1 : 0;
  }

  // para el admin y el registro de rendimiento
  describe() {
    if (!this.hz) return 'midiendo el monitor…';
    const L = this.level;
    return `monitor ${this.hz} Hz → ${Math.round(L.fps * 10) / 10} fps${L.fixed ? ' (fijos)' : ''} · resolución ${Math.round(this.resScale * 100)} %`;
  }
}
