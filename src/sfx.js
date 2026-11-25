// Sonidos: sintetizados con WebAudio (sin archivos), o reemplazados por un archivo desde el admin (🔊 Sonidos).
// Los reemplazos viven en public/sfx/ (el admin los guarda ahí en modo desarrollo) y se listan en
// public/sfx/sounds.json: { files: { hit: 'hit.mp3' }, vol: { hit: 0.8 } }. Así viajan con el juego al compilarlo.
let ctx = null;
let noiseBuf = null;

const raw = new Map(); // clave -> ArrayBuffer todavía sin decodificar (se decodifica al tener audio)
const buffers = new Map(); // clave -> AudioBuffer listo para sonar
export const sfxVol = {}; // clave -> volumen (1 = normal), vale para el sintetizado y para el archivo
export const sfxFiles = {}; // clave -> nombre del archivo que lo reemplaza

function decodeLater(key, ab) {
  if (!ctx) { raw.set(key, ab); return Promise.resolve(); }
  raw.delete(key);
  return ctx.decodeAudioData(ab).then((b) => { buffers.set(key, b); }).catch(() => { console.warn('sonido inválido:', key); });
}

export function unlockAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const [k, ab] of raw) decodeLater(k, ab);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

const SFX_URL = 'sfx/'; // relativo a la página (en el build también)
// al abrir el juego: trae los reemplazos que haya (si no hay ninguno, el 404 no molesta)
export async function loadSoundOverrides() {
  try {
    const r = await fetch(SFX_URL + 'sounds.json', { cache: 'no-store' });
    if (!r.ok) return;
    const m = await r.json();
    Object.assign(sfxVol, m.vol || {});
    await Promise.all(Object.entries(m.files || {}).map(async ([k, f]) => {
      const a = await fetch(SFX_URL + f, { cache: 'no-store' });
      if (!a.ok) return;
      sfxFiles[k] = f;
      await decodeLater(k, await a.arrayBuffer());
    }));
  } catch { /* sin reemplazos */ }
}

// reemplazo elegido en el admin: suena al toque (aunque no se haya podido guardar)
export function setSoundOverride(key, ab, file) {
  sfxFiles[key] = file;
  return decodeLater(key, ab);
}
export function clearSoundOverride(key) { buffers.delete(key); raw.delete(key); delete sfxFiles[key]; }

function playBuffer(b, vol, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol;
  s.connect(g).connect(ctx.destination);
  s.start();
}

let _gain = 1; // volumen del sonido que se está armando (sfxVol)
// las notas que suenan después (setTimeout) conservan el volumen del sonido que las lanzó
const later = (fn, ms) => { const g = _gain; setTimeout(() => { _gain = g; try { fn(); } finally { _gain = 1; } }, ms); };
function tone(f0, f1, dur, type = 'sine', vol = 0.2) {
  if (!ctx || sfx.muted) return;
  vol *= _gain;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol, freq) {
  if (!ctx || sfx.muted) return;
  vol *= _gain;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(t);
  s.stop(t + dur + 0.02);
}

const synth = {
  jump() { tone(240, 560, 0.16, 'sine', 0.12); },
  land(s) { tone(170, 60, 0.14, 'sine', Math.min(0.25, 0.03 * s)); },
  dash() { noise(0.2, 0.12, 1400); tone(380, 180, 0.16, 'triangle', 0.05); },
  hit(s) {
    const k = Math.min(1, s / 25);
    tone(230, 55, 0.28, 'sine', 0.25 + 0.2 * k);
    tone(520, 1100, 0.09, 'square', 0.03);
    noise(0.14, 0.18 + 0.15 * k, 1800);
  },
  bump(s) { tone(200, 90, 0.12, 'sine', Math.min(0.2, 0.012 * s)); },
  splat() { noise(0.45, 0.45, 900); tone(130, 35, 0.45, 'sawtooth', 0.12); },
  ko() { tone(700, 120, 0.7, 'triangle', 0.12); },
  gulp() { tone(300 + Math.random() * 120, 700, 0.09, 'sine', 0.1); },
  zap() { noise(0.25, 0.3, 6000); tone(90, 60, 0.25, 'square', 0.08); tone(1800, 600, 0.15, 'sawtooth', 0.04); },
  boing() { tone(160, 620, 0.25, 'sine', 0.22); tone(320, 900, 0.18, 'triangle', 0.06); },
  steam() { noise(0.9, 0.22, 3500); },
  slam() { noise(0.35, 0.5, 600); tone(80, 30, 0.4, 'square', 0.15); },
  whoosh() { noise(0.15, 0.06, 2500); },
  button() {
    tone(240, 120, 0.1, 'square', 0.15);
    for (let i = 0; i < 3; i++) later(() => tone(880, 660, 0.18, 'square', 0.07), 120 + i * 260);
  },
  slip() { tone(700, 1500, 0.25, 'sine', 0.08); noise(0.2, 0.08, 3000); },
  power() { tone(500, 1000, 0.1, 'triangle', 0.12); later(() => tone(750, 1500, 0.14, 'triangle', 0.1), 90); },
  use() { tone(300, 900, 0.18, 'sawtooth', 0.06); },
  stab() { noise(0.12, 0.35, 5000); tone(900, 200, 0.18, 'sawtooth', 0.08); tone(160, 60, 0.3, 'sine', 0.25); },
  pop() { tone(500, 1400, 0.08, 'sine', 0.2); noise(0.3, 0.35, 1200); },
  // v: volumen según la distancia (las sierras lejanas se oyen menos)
  sawWarn(v = 1) { tone(90, 140, 0.9, 'sawtooth', 0.05 * v); noise(0.9, 0.06 * v, 2500); },
  sawRise(v = 1) {
    noise(0.35, 0.3 * v, 5000);
    tone(500, 1300, 0.35, 'sawtooth', 0.06 * v);
    later(() => tone(1300, 1150, 1.6, 'sawtooth', 0.035 * v), 300);
  },
  spikesWarn(v = 1) { for (let i = 0; i < 4; i++) later(() => tone(320, 260, 0.06, 'square', 0.04 * v), i * 220); noise(0.9, 0.05 * v, 900); },
  spikesUp(v = 1) { noise(0.18, 0.45 * v, 6000); tone(900, 300, 0.15, 'sawtooth', 0.08 * v); tone(120, 60, 0.25, 'sine', 0.2 * v); },
  slice() { noise(0.12, 0.4, 7000); tone(1400, 300, 0.2, 'sawtooth', 0.1); later(() => { noise(0.5, 0.4, 700); tone(140, 40, 0.5, 'sine', 0.3); }, 120); },
  spit() { noise(0.12, 0.25, 2200); tone(500, 180, 0.12, 'sine', 0.12); },
  splosh() { noise(0.25, 0.3, 1100); tone(260, 90, 0.2, 'sine', 0.15); },
  dizzy() {
    // pajaritos: piiu piiu
    tone(1400, 2200, 0.12, 'sine', 0.06);
    later(() => tone(1600, 2500, 0.12, 'sine', 0.05), 140);
    later(() => tone(1300, 2100, 0.12, 'sine', 0.05), 280);
  },
};

// Lista para el admin: nombre, cuándo suena, cuán fuerte suena el archivo según la situación (los
// sintetizados ya cambian solos) y el prompt para generarlo con una IA de efectos de sonido.
// (slam no se usa en ningún lado: no aparece)
const TAIL = 'Cartoon arcade party-game sound effect, clean and punchy, single one-shot, no music, no voice, no background noise.';
export const SOUNDS = [
  { key: 'jump', name: 'Salto', when: 'un blob salta', p: 'A squishy blob jumping up: quick rising rubbery "bwoop" with a soft wet wobble. About 0.3 seconds.' },
  { key: 'land', name: 'Aterrizaje', when: 'cae al piso después de un salto', vol: (s) => Math.min(1, s / 8), p: 'A soft squishy blob landing on a metal floor: short wet squishy thud with a tiny bounce. About 0.3 seconds.' },
  { key: 'dash', name: 'Embestida', when: 'un blob embiste', p: 'A squishy blob charging forward at high speed: fast airy whoosh with a stretchy rubber zip. About 0.4 seconds.' },
  { key: 'hit', name: 'Golpe', when: 'una embestida le pega a otro', vol: (s) => 0.6 + 0.4 * Math.min(1, s / 25), p: 'Two squishy blobs smashing together: punchy wet slap layered with a deep bassy thump, very satisfying fighting-game hit. About 0.4 seconds.' },
  { key: 'bump', name: 'Choque suave', when: 'dos se chocan sin embestir', vol: (s) => Math.min(1, s / 16), p: 'Two squishy blobs gently bumping into each other: soft rubbery "boop", short and light. About 0.2 seconds.' },
  { key: 'splat', name: 'Aplastado contra la pared', when: 'sale volando y se estrella', p: 'A squishy blob flying into a wall and splatting: big gooey wet splat with a squelch. About 0.7 seconds.' },
  { key: 'ko', name: 'KO', when: 'una se cae de la arena', p: 'Cartoon knockout: playful descending slide whistle, arcade KO feeling. About 0.8 seconds.' },
  { key: 'gulp', name: 'Comer blobcito', when: 'come una bolita blanca', rate: () => 0.9 + Math.random() * 0.25, p: 'A cute blob swallowing a tiny candy: quick bubbly "blup" gulp, high and cheerful. About 0.15 seconds.' },
  { key: 'power', name: 'Poder', when: 'agarra una bolita amarilla (y al pasar de paso en el tutorial)', p: 'Power-up pickup: two bright rising magical chime notes, sparkly and rewarding. About 0.35 seconds.' },
  { key: 'use', name: 'Agarrar arma', when: 'consigue aceite o chorro', p: 'Picking up a weapon item: short rising zip with a light metallic click. About 0.25 seconds.' },
  { key: 'spit', name: 'Chorro (disparo)', when: 'tira el chorro (F)', p: 'A blob shooting a quick jet of liquid: short pressurized wet squirt. About 0.2 seconds.' },
  { key: 'splosh', name: 'Chorro (impacto)', when: 'el chorro o el aceite pega o cae', p: 'A blob of liquid splashing onto a squishy blob: wet splosh with small droplets. About 0.3 seconds.' },
  { key: 'whoosh', name: 'Tirar aceite / trampilla', when: 'tira aceite (D) y se abre una trampilla', p: 'Quick airy whoosh of something tossed through the air. About 0.3 seconds.' },
  { key: 'slip', name: 'Resbalón', when: 'pisa aceite', p: 'Cartoon slip on oil: squeaky slide with a rising whistle. About 0.4 seconds.' },
  { key: 'dizzy', name: 'Mareo', when: 'queda mareada', p: 'Cartoon dizziness: three tiny birds tweeting in a circle, light and silly. About 0.5 seconds.' },
  { key: 'pop', name: 'Explota', when: 'un blob clavado explota', p: 'A squishy blob popping like a balloon full of goo: bright pop followed by a wet splash. About 0.4 seconds.' },
  { key: 'stab', name: 'Pinchazo', when: 'queda clavado en los pinchos', p: 'Sharp metal spike stabbing into a squishy blob: quick metallic "shing" with a wet thud. About 0.4 seconds.' },
  { key: 'slice', name: 'Corte de sierra', when: 'la sierra lo corta en dos', p: 'A spinning saw blade slicing a squishy blob in half: sharp metallic swish, then a heavy wet split and plop. About 0.8 seconds.' },
  { key: 'sawWarn', name: 'Sierra: aviso', when: 'la sierra está por salir (Steampunk)', vol: (v) => v, p: 'Industrial circular saw spinning up under the floor: low mechanical growl as a warning. About 1 second.' },
  { key: 'sawRise', name: 'Sierra: sale', when: 'la sierra sale del piso', vol: (v) => v, p: 'Giant circular saw blade rising out of a metal floor and screaming at full speed: metallic whine with a mechanical clank. About 2 seconds.' },
  { key: 'spikesWarn', name: 'Pinchos: aviso', when: 'los pinchos están por salir', vol: (v) => v, p: 'Mechanical warning before floor spikes: four short ticking metallic clicks with a low rumble. About 1 second.' },
  { key: 'spikesUp', name: 'Pinchos: salen', when: 'salen los pinchos', vol: (v) => v, p: 'Metal floor spikes shooting up fast: sharp metallic "shhk" with a heavy thunk. About 0.4 seconds.' },
  { key: 'steam', name: 'Vapor', when: 'sopla una válvula de vapor', p: 'Steampunk boiler valve blasting pressurized steam: loud hiss that fades out. About 1 second.' },
  { key: 'button', name: 'Botón del pozo', when: 'presionan el botón que abre el pozo', p: 'Big brass button pressed in a steampunk machine: heavy mechanical clunk followed by three short alarm beeps. About 1 second.' },
  { key: 'zap', name: 'Electricidad', when: 'toca el borde electrificado (Cyberpunk)', p: 'Neon electric fence shocking a squishy blob: crackling electric zap with a buzzy hum. About 0.4 seconds.' },
  { key: 'boing', name: 'Rebotador', when: 'pisa un rebotador (Cyberpunk)', p: 'Springy bounce pad launching a squishy blob: cartoon "boing" with a metallic spring wobble. About 0.4 seconds.' },
].map((x) => ({ ...x, prompt: `${x.p} ${TAIL}` }));
const BY_KEY = Object.fromEntries(SOUNDS.map((x) => [x.key, x]));

// lo que llama el juego: si hay archivo, suena el archivo; si no, el sintetizado
export const sfx = { muted: false, master: 1 }; // master = volumen general (Opciones)
for (const key of Object.keys(synth)) {
  sfx[key] = (...args) => {
    if (!ctx || sfx.muted) return;
    const vol = (sfxVol[key] ?? 1) * sfx.master;
    const b = buffers.get(key);
    if (b) {
      const info = BY_KEY[key];
      playBuffer(b, vol * (info?.vol ? info.vol(args[0] ?? 1) : 1), info?.rate ? info.rate() : 1);
      return;
    }
    _gain = vol;
    try { synth[key](...args); } finally { _gain = 1; }
  };
}
