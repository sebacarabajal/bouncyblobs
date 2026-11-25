// Calidad gráfica: UN solo nivel para todos (el usuario eligió así: el "vidrio" de las gelatinas —que deforman
// lo que tienen atrás— y el halo de las luces no le aportaban nada y costaban mucho en PCs flojas).
// Gelatinas translúcidas comunes, sin halo, sombras de 1024. Lo único que se adapta es la resolución
// (adaptive.js), y en pantallas de alta densidad (Retina, 4K) se dibuja hasta x1.5 para que se vea nítido.
export const LEVELS = {
  minima: { label: 'Única', pr: 1.5, glass: false, trs: 0.35, shadow: 1024, bloom: false },
};
export const ORDER = ['minima'];

const STORE = 'gelatinas.quality';
export const isTouch = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('touch'));

export const Q = {
  auto: true,
  // en modo automático se recuerda hasta dónde bajó en este aparato
  level: 'minima', // (lo guardado de antes ya no importa: hay un solo nivel)
  get p() { return LEVELS[this.level]; },
};

export function saveQuality() {
  try { localStorage.setItem(STORE, JSON.stringify({ auto: Q.auto, level: Q.level })); } catch { /* sin storage */ }
}

// ---------------------------------------------------------------- materiales "de vidrio"
// Cada material con transmission se registra acá; al cambiar de calidad se pasan todos juntos.
const glassMats = new Set();

function apply(m) {
  if (m.userData.glassT === undefined) m.userData.glassT = m.transmission;
  const glass = Q.p.glass;
  const t = glass ? m.userData.glassT : 0;
  if (m.transmission !== t) m.transmission = t; // three recompila solo al pasar de 0 a >0 y al revés
  if (m.transparent !== !glass) {
    m.transparent = !glass;
    m.opacity = glass ? 1 : (m.userData.glassOpacity ?? 0.86);
    m.needsUpdate = true;
  }
}

export function glassMaterial(m, opacity) {
  if (opacity !== undefined) m.userData.glassOpacity = opacity;
  apply(m);
  glassMats.add(m);
  return m;
}

export function forgetGlass(m) { glassMats.delete(m); }

export function refreshGlass() { for (const m of glassMats) apply(m); }

