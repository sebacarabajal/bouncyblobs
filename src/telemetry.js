// Analíticas propias del juego (las ve el panel del admin). Anónimas: cada navegador tiene un id al azar;
// no se manda nada personal (el nombre de la gelatina sí, para los récords).
// Se juntan en una cola y se mandan cada ~20 s a /api/t (y una última vez al cerrar la pestaña).
// No se manda nada desde la página del admin en producción (para no ensuciar los números).
import { IS_ADMIN } from './env.js';

const uuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); // http por la red de la casa: no hay randomUUID
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const PID = 'gelatinas.pid';
let pid;
try { pid = localStorage.getItem(PID) || uuid(); localStorage.setItem(PID, pid); } catch { pid = uuid(); }
const OFF = IS_ADMIN && !import.meta.env?.DEV;

class Telemetry {
  constructor() {
    this.pid = pid;
    this.sid = uuid();
    this.queue = [];
    this.match = null;
    this.statsFn = null; // () => { score, kos, falls, maxMass, won, lost } de la partida en curso
    this.perfAcc = { fps: 0, p95: 0, target: 0, res: 0, n: 0 };
  }

  start(info) {
    if (OFF || this.started) return;
    this.started = true;
    this.track('session', info);
    this.flush();
    setInterval(() => this.flush(), 20000);
    setInterval(() => { this._perfOut(); if (!this.queue.length) this.track('beat'); }, 60000);
    // al cerrar o esconder la pestaña: se cierra la partida y se manda lo pendiente
    addEventListener('pagehide', () => { this.endMatch('leave'); this._perfOut(); this.flush(true); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(true); });
  }

  track(k, d) { if (!OFF) this.queue.push(d ? { k, d } : { k }); }

  startMatch({ mode, arena, team, name }) {
    this.endMatch('new');
    this.match = { mid: uuid(), t0: performance.now() };
    this.track('match_start', { mid: this.match.mid, mode, arena, team, name });
  }

  endMatch(reason) {
    if (!this.match) return;
    const s = this.statsFn?.() || {};
    const dur = Math.round((performance.now() - this.match.t0) / 1000);
    this.track('match_end', { mid: this.match.mid, dur, reason, ...s });
    this.match = null;
  }

  // resumen de rendimiento (perf.js lo da cada 10 s); se manda un promedio por minuto
  perf(rep, playing) {
    if (!playing || !rep.fps) return;
    const a = this.perfAcc;
    a.fps += rep.fps; a.p95 += rep.p95Ms || 0; a.target += rep.fpsTarget || 0; a.res += rep.resScale || 1; a.n++;
  }

  _perfOut() {
    const a = this.perfAcc;
    if (!a.n) return;
    this.track('perf', { fps: Math.round(a.fps / a.n), p95: Math.round(a.p95 / a.n), target: Math.round(a.target / a.n), res: +(a.res / a.n).toFixed(2) });
    this.perfAcc = { fps: 0, p95: 0, target: 0, res: 0, n: 0 };
  }

  flush(beacon = false) {
    if (OFF || !this.queue.length) return;
    const ev = this.queue.splice(0, 40);
    const body = JSON.stringify({ pid: this.pid, sid: this.sid, ev });
    if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/t', new Blob([body], { type: 'application/json' }));
    else fetch('/api/t', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    if (this.queue.length) this.flush(beacon);
  }
}

export const telemetry = new Telemetry();

// récords públicos (para la pantalla de inicio)
export async function fetchRecords(mode = 'ffa', period = 'week') {
  try {
    const r = await fetch(`/api/records?mode=${mode}&period=${period}`);
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
