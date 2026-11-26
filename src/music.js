// Música de fondo: las canciones que sube el admin (página Sonidos). Suenan en orden al azar, una tras otra,
// desde el primer clic o tecla (los navegadores no dejan sonar nada antes). Volumen aparte en Opciones → Sonido.
import { sfx } from './sfx.js';

class Music {
  constructor() {
    // volumen = base (el general que elige el admin) × el de cada canción (admin) × vol (el de cada jugador, Opciones)
    this.vol = 1;
    this.base = 0.4;
    this.cur = null;
    this.list = null;
    this.order = [];
    this.i = -1;
    this.title = '';
    this.fails = 0;
    this.audio = null;
    this.onChange = null; // () => avisar a Opciones qué suena
  }

  // la lista (una vez) y la primera canción; se llama con el primer gesto del jugador
  async start() {
    if (this.started) return;
    this.started = true;
    try {
      const r = await fetch('/api/music?v=2', { cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      this.list = d?.list || [];
      if (Number.isFinite(d?.base)) this.base = d.base;
    } catch { this.list = []; }
    if (!this.list.length) { this.onChange?.(); return; }
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('error', () => { if (++this.fails < this.list.length) this.next(); });
    this.audio.addEventListener('playing', () => { this.fails = 0; });
    this.next();
  }

  get has() { return !!this.list?.length; }

  // la siguiente (al azar, sin repetir hasta que suenen todas)
  next() {
    if (!this.has || !this.audio) return;
    if (++this.i >= this.order.length) {
      const last = this.order[this.order.length - 1];
      this.order = this.list.map((_, k) => k).sort(() => Math.random() - 0.5);
      if (this.order.length > 1 && this.order[0] === last) this.order.push(this.order.shift()); // no repetir la última
      this.i = 0;
    }
    const t = this.list[this.order[this.i]];
    this.cur = t;
    this.title = t.title;
    this.audio.src = `/api/music/${t.file}`;
    this.apply();
    this.audio.play().catch(() => {});
    this.onChange?.();
  }

  // volumen (el "Silenciado" general también la apaga)
  setVol(v) { this.vol = Math.max(0, Math.min(1, v)); this.apply(); }
  apply() {
    if (!this.audio) return;
    const v = sfx.muted ? 0 : Math.min(1, this.base * (this.cur?.vol ?? 1) * this.vol);
    this.audio.volume = v;
    if (v === 0 && !this.audio.paused) this.audio.pause();
    else if (v > 0 && this.audio.paused && this.audio.src) this.audio.play().catch(() => {});
  }
}

export const music = new Music();

// arranca con el primer gesto (clic, tecla o toque)
const kick = () => { music.start(); removeEventListener('pointerdown', kick); removeEventListener('keydown', kick); };
addEventListener('pointerdown', kick);
addEventListener('keydown', kick);
