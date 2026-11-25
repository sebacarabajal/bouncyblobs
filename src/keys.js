// Teclas del jugador: dos presets (flechas o WASD) y cada acción se puede cambiar desde Opciones (⚙️).
// Se guarda en este navegador. Los textos (ayuda, tutorial, HUD) muestran las teclas elegidas con {key:acción}.
import { t, setKeyTokens } from './i18n.js';

export const ACTIONS = ['up', 'left', 'down', 'right', 'jump', 'sprint', 'dash', 'oil', 'spit'];
export const PRESETS = {
  arrows: { up: 'ArrowUp', left: 'ArrowLeft', down: 'ArrowDown', right: 'ArrowRight', jump: 'Space', sprint: 'ShiftLeft', dash: 'KeyE', oil: 'KeyD', spit: 'KeyF' },
  wasd: { up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', dash: 'KeyJ', oil: 'KeyK', spit: 'KeyL' },
};

const STORE = 'gelatinas.keys';
// Shift/Ctrl/Alt de la derecha valen igual que los de la izquierda
export const norm = (code) => code.replace(/^(Shift|Control|Alt|Meta)Right$/, '$1Left');

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && s.map && ACTIONS.every((a) => typeof s.map[a] === 'string')) return { preset: s.preset || 'custom', map: s.map, labels: s.labels || {} };
  } catch { /* sin storage */ }
  return { preset: 'arrows', map: { ...PRESETS.arrows }, labels: {} };
}

export const keys = load();
let reverse = null;
const subs = new Set();
export const onKeys = (fn) => subs.add(fn);

function changed() {
  reverse = null;
  const match = Object.entries(PRESETS).find(([, m]) => ACTIONS.every((a) => m[a] === keys.map[a]));
  keys.preset = match ? match[0] : 'custom';
  try { localStorage.setItem(STORE, JSON.stringify(keys)); } catch { /* sin storage */ }
  for (const fn of subs) fn();
}

// qué acción tiene esta tecla (o null)
export function actionOf(code) {
  if (!reverse) { reverse = new Map(); for (const a of ACTIONS) reverse.set(keys.map[a], a); }
  return reverse.get(norm(code)) ?? null;
}

export function usePreset(name) {
  if (!PRESETS[name]) return;
  keys.map = { ...PRESETS[name] };
  changed();
}

// asignar una tecla: si ya la usaba otra acción, se intercambian
export function bind(action, code, key) {
  code = norm(code);
  const other = actionOf(code);
  if (other && other !== action) keys.map[other] = keys.map[action];
  keys.map[action] = code;
  if (key && key.length === 1) keys.labels[code] = key.toUpperCase(); // la letra real (teclados que no son QWERTY: Ñ, Ç…)
  changed();
}

const SPECIAL = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', MetaLeft: '⌘',
  Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', CapsLock: 'Bloq Mayús', Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
};
export function keyName(code) {
  if (code === 'Space') return t('key.space');
  if (SPECIAL[code]) return keys.labels[code] || SPECIAL[code];
  if (keys.labels[code]) return keys.labels[code];
  let m = code.match(/^Key(.)$/) || code.match(/^Digit(.)$/);
  if (m) return m[1];
  if ((m = code.match(/^Numpad(.+)$/))) return 'Num ' + m[1];
  return code;
}

// para los textos: {key:dash} → "E" · {key:move} → "↑ ← ↓ →" o "W A S D"
export function keyToken(a) {
  if (a === 'move') return ['up', 'left', 'down', 'right'].map((x) => keyName(keys.map[x])).join(' ');
  return keys.map[a] ? keyName(keys.map[a]) : a;
}
setKeyTokens(keyToken);
