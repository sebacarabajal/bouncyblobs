// Medidor de rendimiento: contador en pantalla (tecla I) + registro para auditar.
// Cada frame mide cuánto tarda cada parte (física, piel de las gelatinas, efectos, dibujo) y detecta
// "trabones" (frames de más de 50 ms) con lo que pasó en ese momento (corte de sierra, shader nuevo…).
// En modo desarrollo (npm run dev) manda un resumen cada 10 s al servidor de Vite, que lo guarda en
// perf/perf-log.jsonl (ver vite.config.js). En la versión publicada sólo muestra el contador.

const HITCH_MS = 50;
const PARTS = ['bots', 'physics', 'hits', 'arena', 'pickups', 'skinSim', 'online'];
const REPORT_EVERY = 10; // segundos

export class PerfMonitor {
  constructor(renderer) {
    this.renderer = renderer;
    renderer.info.autoReset = false; // sumamos todas las pasadas del frame (bloom incluido)
    this.session = Math.random().toString(36).slice(2, 8);
    this.el = document.createElement('div');
    this.el.id = 'perf';
    document.body.appendChild(this.el);
    this.visible = true;
    this.t = {}; // marcas del frame actual
    this.events = []; // { at, name } de los últimos segundos
    this.sec = this._empty();
    this.win = this._empty();
    this.lastNow = 0;
    this.secStart = performance.now();
    this.winStart = performance.now();
    this.programs = 0;
    this.sentDevice = false;
    this.ctxFn = null; // () => datos del juego para el reporte (arena, gelatinas…)
    addEventListener('pagehide', () => this._send(true));
    // tareas largas del navegador (> 50 ms): incluye cosas que no son nuestro código (estilos, pintado, GC…)
    this.longTasks = { n: 0, ms: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { this.longTasks.n++; this.longTasks.ms += e.duration; }
      }).observe({ type: 'longtask', buffered: false });
    } catch { /* no soportado */ }
    this.heapMin = Infinity; this.heapMax = 0;
    // tiempo de la placa de video (lo que tarda en dibujar de verdad, no sólo en recibir las órdenes)
    const gl = renderer.getContext();
    this.gl = gl;
    this.gpuExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.gpuQueries = []; // pendientes de leer
    this.gpuFree = [];
    this.gpuLast = 0;
    this.contextLost = 0; // veces que se reinició la placa de video
  }

  // después de recuperar el contexto WebGL, las mediciones viejas ya no sirven
  resetGpu() {
    this.gpuExt = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.gpuQueries = []; this.gpuFree = []; this._gq = null;
  }

  // envolver el dibujo del frame (si el navegador no soporta la medición, no hace nada)
  gpuBegin() {
    if (!this.gpuExt || this._gq || this.gl.isContextLost()) return;
    const q = this.gpuFree.pop() || this.gl.createQuery();
    this.gl.beginQuery(this.gpuExt.TIME_ELAPSED_EXT, q);
    this._gq = q;
  }

  gpuEnd() {
    if (!this._gq) return;
    this.gl.endQuery(this.gpuExt.TIME_ELAPSED_EXT);
    this.gpuQueries.push(this._gq);
    this._gq = null;
  }

  // resultados de frames anteriores (llegan con unos frames de atraso)
  _gpuRead() {
    const gl = this.gl;
    if (!this.gpuExt || gl.isContextLost()) return;
    const disjoint = gl.getParameter(this.gpuExt.GPU_DISJOINT_EXT);
    while (this.gpuQueries.length) {
      const q = this.gpuQueries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      this.gpuQueries.shift();
      this.gpuFree.push(q);
      if (disjoint) continue;
      const ms = ns / 1e6;
      this.gpuLast = ms;
      for (const s of [this.sec, this.win]) { s.gpu += ms; s.gpuN++; s.gpuMax = Math.max(s.gpuMax, ms); }
    }
  }

  // suma tiempos de partes de la simulación (se llama varias veces por frame)
  add(key, ms) { this.t[key] = (this.t[key] || 0) + ms; }

  _empty() {
    return { n: 0, frame: [], sim: 0, simMax: 0, skin: 0, fx: 0, draw: 0, drawMax: 0, gpu: 0, gpuN: 0, gpuMax: 0, calls: 0, tris: 0, steps: 0, hitches: [], parts: {} };
  }

  toggle() { this.visible = !this.visible; this.el.style.display = this.visible ? '' : 'none'; }

  // algo que pasó en el juego (sirve para saber qué causó un trabón)
  event(name) { this.events.push({ at: performance.now(), name }); if (this.events.length > 40) this.events.shift(); }

  begin(now) {
    this.frameNow = now;
    this.renderer.info.reset();
    this.prevT = this.t;
    this.t = { sim: 0, skin: 0, fx: 0, draw: 0, steps: 0 };
    this._m = performance.now();
  }

  // mide el tramo desde la marca anterior y lo suma a "key"
  lap(key) { const n = performance.now(); this.t[key] += n - this._m; this._m = n; }

  end() {
    const now = this.frameNow;
    const interval = this.lastNow ? now - this.lastNow : 16.7;
    this.lastNow = now;
    // pestaña en segundo plano o recién vuelta: no cuenta
    this._gpuRead();
    if (document.hidden || interval > 1000) return;
    const info = this.renderer.info;
    const progs = info.programs?.length ?? 0;
    const newPrograms = Math.max(0, progs - this.programs);
    this.programs = progs;
    for (const s of [this.sec, this.win]) {
      s.n++;
      s.frame.push(interval);
      s.sim += this.t.sim; s.simMax = Math.max(s.simMax, this.t.sim);
      s.skin += this.t.skin; s.fx += this.t.fx;
      s.draw += this.t.draw; s.drawMax = Math.max(s.drawMax, this.t.draw);
      s.calls += info.render.calls; s.tris += info.render.triangles; s.steps += this.t.steps;
      for (const k of PARTS) s.parts[k] = (s.parts[k] || 0) + (this.t[k] || 0);
    }
    const heap = performance.memory?.usedJSHeapSize;
    if (heap) { this.heapMin = Math.min(this.heapMin, heap); this.heapMax = Math.max(this.heapMax, heap); }
    if (interval > HITCH_MS) {
      const recent = this.events.filter((e) => now - e.at < 600).map((e) => e.name);
      // el atraso se nota en este frame pero lo causó el anterior: se guardan los dos
      const brief = (t) => (t ? Object.fromEntries(Object.entries(t).filter(([, v]) => v > 0.05).map(([k, v]) => [k, +v.toFixed(1)])) : null);
      this.win.hitches.push({
        ms: Math.round(interval), prev: brief(this.prevT), cur: brief(this.t), gpuMs: +this.gpuLast.toFixed(1), newPrograms, events: recent, at: Math.round((now - this.winStart) / 100) / 10,
      });
    }
    if (now - this.secStart >= 1000) { this._show(); this.sec = this._empty(); this.secStart = now; }
    if (now - this.winStart >= REPORT_EVERY * 1000) this._send(false);
  }

  _stats(s) {
    const f = [...s.frame].sort((a, b) => a - b);
    const avg = f.reduce((a, b) => a + b, 0) / (f.length || 1);
    const p = (q) => f[Math.min(f.length - 1, Math.floor(f.length * q))] || 0;
    return { fps: Math.round(1000 / avg), avgMs: +avg.toFixed(1), p95Ms: +p(0.95).toFixed(1), maxMs: +(f[f.length - 1] || 0).toFixed(1), low1Fps: Math.round(1000 / (p(0.99) || 1)) };
  }

  _show() {
    if (!this.visible || !this.sec.n) return;
    const s = this.sec, st = this._stats(s), n = s.n;
    const color = st.fps >= 55 ? '#7dff8a' : st.fps >= 40 ? '#ffd21a' : '#ff5a5a';
    this.el.innerHTML = `<b style="color:${color}">${st.fps} fps</b> · ${st.avgMs} ms (peor ${st.maxMs})<br>`
      + `<span>física ${(s.sim / n).toFixed(1)} · blobs ${(s.skin / n).toFixed(1)} · efectos ${(s.fx / n).toFixed(1)} · dibujo ${(s.draw / n).toFixed(1)} ms${s.gpuN ? ` · placa ${(s.gpu / s.gpuN).toFixed(1)} ms` : ''}</span><br>`
      + `<span>${Math.round(s.calls / n)} dibujos · ${Math.round(s.tris / n / 1000)}k triángulos</span>`;
  }

  _device() {
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      cores: navigator.hardwareConcurrency, ram: navigator.deviceMemory, dpr: devicePixelRatio,
      screen: `${innerWidth}x${innerHeight}`, pixelRatio: this.renderer.getPixelRatio(), ua: navigator.userAgent,
    };
  }

  _send(final) {
    const w = this.win;
    if (!w.n) return;
    const n = w.n;
    const rep = {
      time: new Date().toISOString(), session: this.session, final, seconds: Math.round((this.frameNow - this.winStart) / 100) / 10,
      ...this._stats(w),
      simMs: +(w.sim / n).toFixed(2), simMaxMs: +w.simMax.toFixed(1), stepsPerFrame: +(w.steps / n).toFixed(2),
      skinMs: +(w.skin / n).toFixed(2), fxMs: +(w.fx / n).toFixed(2), drawMs: +(w.draw / n).toFixed(2), drawMaxMs: +w.drawMax.toFixed(1),
      gpuMs: w.gpuN ? +(w.gpu / w.gpuN).toFixed(2) : null, gpuMaxMs: w.gpuN ? +w.gpuMax.toFixed(1) : null,
      focused: document.hasFocus(), visible: document.visibilityState, contextLost: this.contextLost,
      drawCalls: Math.round(w.calls / n), triangles: Math.round(w.tris / n),
      programs: this.programs, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
      ...(this.ctxFn ? this.ctxFn() : {}),
      parts: Object.fromEntries(Object.entries(w.parts).map(([k, v]) => [k, +(v / n).toFixed(2)])),
      longTasks: this.longTasks.n, longTaskMs: Math.round(this.longTasks.ms),
      heapMB: this.heapMax ? [Math.round(this.heapMin / 1048576), Math.round(this.heapMax / 1048576)] : null,
      hitches: w.hitches.slice(0, 30), hitchCount: w.hitches.length,
    };
    this.longTasks = { n: 0, ms: 0 };
    this.heapMin = Infinity; this.heapMax = 0;
    if (!this.sentDevice) { rep.device = this._device(); this.sentDevice = true; }
    this.win = this._empty();
    this.winStart = this.frameNow;
    this.onReport?.(rep); // analíticas (telemetry.js): promedio de fps por minuto
    if (!import.meta.env?.DEV) return;
    const body = JSON.stringify(rep);
    if (final && navigator.sendBeacon) navigator.sendBeacon('/__perf', body);
    else fetch('/__perf', { method: 'POST', body, keepalive: true }).catch(() => {});
  }
}
