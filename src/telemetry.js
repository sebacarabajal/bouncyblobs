// Analíticas propias del juego (las ve el panel del admin). Cada navegador tiene un id al azar; no se pide ni se
// manda nada personal (el nombre del blob sí, para los récords). El servidor anota además la IP de cada visita y la
// borra sola a los IP_RETENTION_DAYS días (ver server/index.js).
// Se juntan en una cola y se mandan cada ~20 s a /api/t (y una última vez al cerrar la pestaña).
// No se manda nada desde la página del admin en producción (para no ensuciar los números).
import { IS_ADMIN } from './env.js';

// el equipo y el navegador (sin nada personal): para saber dónde anda bien el juego y dónde no
function deviceInfo() {
  const nav = navigator, q = new URLSearchParams(location.search);
  let tz = null;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* viejo */ }
  return {
    win: `${innerWidth}x${innerHeight}`, dpr: +(devicePixelRatio || 1).toFixed(2), cores: nav.hardwareConcurrency || null, ram: nav.deviceMemory || null,
    tz, langs: (nav.languages || [nav.language]).slice(0, 4).join(','), touch: (nav.maxTouchPoints || 0) > 0,
    conn: nav.connection?.effectiveType || null, ver: typeof __BUILD__ !== 'undefined' ? __BUILD__ : null,
    utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'), utm_campaign: q.get('utm_campaign'),
  };
}

// versión exacta del sistema y del navegador (Chrome y Edge la dan aparte: el texto del navegador miente, por
// ejemplo Windows 11 dice ser Windows 10)
async function deviceHints() {
  const ud = navigator.userAgentData;
  if (!ud?.getHighEntropyValues) return null;
  try {
    const h = await ud.getHighEntropyValues(['platformVersion', 'model', 'fullVersionList']);
    return { platformVersion: h.platformVersion || null, model: h.model || null, browsers: (h.fullVersionList || []).map((b) => [b.brand, b.version]) };
  } catch { return null; }
}

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
    this.netFn = null; // () => resumen de la red en línea desde el último (online.auditReport) o null
    this.perfAcc = this._perfEmpty();
  }

  start(info) {
    if (OFF || this.started) return;
    this.started = true;
    this.track('session', { ...deviceInfo(), ...info });
    deviceHints().then((h) => { if (h) this.track('device', h); });
    this.flush();
    setInterval(() => this.flush(), 20000);
    setInterval(() => { this._perfOut(); this._netOut(); if (!this.queue.length) this.track('beat'); }, 60000);
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
    this._netOut(); // lo que falta del último minuto en línea, antes del cierre de la partida
    const s = this.statsFn?.() || {};
    const dur = Math.round((performance.now() - this.match.t0) / 1000);
    this.track('match_end', { mid: this.match.mid, dur, reason, ...s });
    this.match = null;
  }

  // resumen de rendimiento (perf.js lo da cada 10 s); se manda un promedio por minuto.
  // hz: el monitor medido · late: fracción de frames que llegaron tarde · cpu/gpu: ms por frame (lo que tarda el
  // juego / la placa) · win: tamaño de la ventana. Con eso se distingue "el juego no llega" de "el monitor o el
  // escritorio no dejan" (un frame liviano que igual llega tarde no es culpa del juego).
  _perfEmpty() { return { fps: 0, p95: 0, target: 0, res: 0, hz: 0, late: 0, cpu: 0, gpu: 0, gpuN: 0, n: 0 }; }
  perf(rep, playing) {
    if (!playing || !rep.fps) return;
    const a = this.perfAcc;
    a.fps += rep.fps; a.p95 += rep.p95Ms || 0; a.target += rep.fpsTarget || 0; a.res += rep.resScale || 1;
    a.hz += rep.hz || 0; a.late += rep.lateRate || 0;
    a.cpu += (rep.simMs || 0) + (rep.skinMs || 0) + (rep.fxMs || 0) + (rep.drawMs || 0);
    if (rep.gpuMs != null) { a.gpu += rep.gpuMs; a.gpuN++; }
    a.win = rep.win; a.n++;
  }

  _perfOut() {
    const a = this.perfAcc;
    if (!a.n) return;
    this.track('perf', {
      fps: Math.round(a.fps / a.n), p95: Math.round(a.p95 / a.n), target: Math.round(a.target / a.n), res: +(a.res / a.n).toFixed(2),
      hz: Math.round(a.hz / a.n), late: +(a.late / a.n).toFixed(2), cpu: +(a.cpu / a.n).toFixed(1), gpu: a.gpuN ? +(a.gpu / a.gpuN).toFixed(1) : null, win: a.win,
    });
    this.perfAcc = this._perfEmpty();
  }

  _netOut() {
    const r = this.netFn?.();
    if (r) this.track('net', r);
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

// ranking (mejor partida de cada uno): { list: [{ rank, mine, name, country, score, kos, games, at }], me: { rank, score } }
// period: 'week' | 'month' | 'all'. Va el id de este navegador para marcar su fila (el servidor no muestra ids).
export async function fetchRanking({ mode = 'ffa', period = 'week', limit = 10 } = {}) {
  try {
    const r = await fetch(`/api/records?v=2&mode=${mode}&period=${period}&limit=${limit}&me=${encodeURIComponent(pid)}`);
    return r.ok ? await r.json() : { list: [], me: null };
  } catch { return { list: [], me: null }; }
}

// récords públicos (versión vieja)
export async function fetchRecords(mode = 'ffa', period = 'week') {
  try {
    const r = await fetch(`/api/records?mode=${mode}&period=${period}`);
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
