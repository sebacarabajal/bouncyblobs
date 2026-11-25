// El servidor corre el MISMO código del juego que el navegador (src/game/sim.js, las arenas, los blobs…),
// pero sin pantalla. Ese código arma también lo visual (texturas pintadas en un canvas, imágenes de fondo),
// así que acá se simula lo mínimo del navegador para que funcione: un canvas que no pinta nada, imágenes que
// nunca cargan, localStorage en memoria. Importar ANTES que cualquier cosa de src/.
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w, height: h });
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});

function fakeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [], width: 1, height: 1,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getContext: () => ctx2d, toDataURL: () => 'data:,',
    addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; }, removeChild() {}, remove() {},
    setAttribute() {}, getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
  };
  return el;
}

const g = globalThis;
if (!g.document) {
  g.document = {
    createElement: fakeEl,
    createElementNS: (ns, tag) => fakeEl(tag),
    body: fakeEl('body'), documentElement: fakeEl('html'), head: fakeEl('head'),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, hidden: false, visibilityState: 'visible',
  };
}
if (!g.window) g.window = g;
if (!g.Image) g.Image = class { constructor() { return fakeEl('img'); } };
if (!g.HTMLCanvasElement) g.HTMLCanvasElement = class {};
if (!g.HTMLImageElement) g.HTMLImageElement = class {};
if (!g.ImageBitmap) g.ImageBitmap = class {};
if (!g.requestAnimationFrame) g.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 16);
if (!g.matchMedia) g.matchMedia = () => ({ matches: false, addEventListener() {} });
try { g.localStorage.getItem('x'); } catch {
  const mem = new Map();
  Object.defineProperty(g, 'localStorage', { value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }, configurable: true });
}
if (!g.addEventListener) { g.addEventListener = () => {}; g.removeEventListener = () => {}; }
if (!g.location) g.location = { hostname: 'server', search: '', href: 'http://server/' };
