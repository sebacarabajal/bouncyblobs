import * as THREE from 'three';
import { t } from './i18n.js';

// Modo por equipos (Azul vs Rojo, 8 vs 8 en Steampunk; en las arenas de 12, 6 vs 6).
// Partida al mejor de 5: gana el primer equipo que gana 3 rondas. En cada ronda, el que se cae NO vuelve hasta
// la ronda siguiente; la gana el equipo que deja al otro sin nadie. Si se acaba el tiempo (3 min), la gana el
// que tiene más gelatinas vivas (si son iguales, empate: no suma para nadie).
// Sin fuego amigo: los golpes, el chorro y el aceite no afectan a los compañeros (empujarse sí, es física).
//
// Cómo se reconoce cada equipo: todas las gelatinas de un equipo se tiñen exactamente del mismo azul o rojo
// (el usuario lo pidió así: con tonos distintos no se leía como un equipo). La tuya también: te reconocés por tu tatuaje. Al salir del modo,
// los bots vuelven a su color (el tuyo lo vuelve a poner la pantalla de inicio).
export const TEAM_COLORS = ['#2f8bff', '#ff3b4f'];
const ROUND_TIME = 180;
const TO_WIN = 3; // al mejor de 5
const END_TIME = 4.5; // segundos del cartel de fin de ronda
const SERIES_END_TIME = 7; // y del de fin de partida
const INTRO_TIME = 2.6; // cartel "Juegas en el equipo Azul" (primera ronda de cada partida)
const ROUND_INTRO = 1.4; // cartel "Ronda 2", "Ronda 3"…
const COUNT_TIME = 3; // 3, 2, 1… ¡YA!
// Cada ronda: todos aparecen en formación (Azul a la izquierda, Rojo a la derecha, mirándose), quietos,
// con el cartel y la cuenta regresiva; recién con el ¡YA! se pueden mover.

export class Teams {
  constructor(jellies, { onNewRound }) {
    this.jellies = jellies;
    this.onNewRound = onNewRound;
    this.active = false;
    this.phase = 'play';
    this.wins = [0, 0];
    this.round = 0;
    this.orig = new Map(); // color original de cada bot

    // marcador arriba al medio + cartel (fin de ronda / de partida / a qué equipo perteneces)
    const el = document.createElement('div');
    el.id = 'teams';
    el.innerHTML = `
      <div class="tm-side a"><b></b><span class="tm-dots"></span><em>0</em></div>
      <div class="tm-mid"><span class="tm-clock">3:00</span><small class="tm-round"></small></div>
      <div class="tm-side b"><em>0</em><span class="tm-dots"></span><b></b></div>
      <div class="tm-note"></div>`;
    document.body.appendChild(el);
    const banner = document.createElement('div');
    banner.id = 'tm-banner';
    document.body.appendChild(banner);
    const count = document.createElement('div');
    count.id = 'tm-count';
    document.body.appendChild(count);
    this.countEl = count;
    this.el = el;
    this.banner = banner;
    const q = (s) => el.querySelector(s);
    this.ui = {
      names: [q('.a b'), q('.b b')], dots: [q('.a .tm-dots'), q('.b .tm-dots')], wins: [q('.a em'), q('.b em')],
      clock: q('.tm-clock'), round: q('.tm-round'), note: q('.tm-note'),
    };
    this._last = {};
  }

  // playing = las gelatinas que juegan esta partida (la primera es la tuya)
  start(playing, arena) {
    this.arena = arena;
    this._restore();
    this.active = true;
    this.playing = playing;
    for (const j of this.jellies) j.team = null;
    // vos en Azul; los bots se reparten al azar para que queden parejos
    const bots = playing.filter((j) => !j.isPlayer).sort(() => Math.random() - 0.5);
    const player = playing.find((j) => j.isPlayer);
    const half = Math.floor(playing.length / 2);
    if (player) player.team = 0;
    let a = player ? 1 : 0;
    for (const b of bots) b.team = a++ < half ? 0 : 1;
    // teñir: todas las de un equipo exactamente del mismo color
    for (const j of [player, ...bots].filter(Boolean)) {
      if (!j.isPlayer) this.orig.set(j, '#' + j.color.getHexString());
      this._paint(j, TEAM_COLORS[j.team]);
    }
    this.size = half;
    this.wins = [0, 0];
    this.round = 0;
    document.body.classList.add('teams');
    this._newRound(false);
  }

  stop() {
    this._restore();
    if (!this.active) return;
    this.active = false;
    for (const j of this.jellies) j.team = null;
    document.body.classList.remove('teams');
    this.banner.className = '';
    this.countEl.className = '';
  }

  _paint(j, hex) {
    j.setLook({ color: hex });
    j.rank?.el.style.setProperty('--c', hex);
  }

  _restore() {
    for (const [j, hex] of this.orig) this._paint(j, hex);
    this.orig.clear();
  }

  isEnemy(a, b) { return !this.active || a.team == null || b.team == null || a.team !== b.team; }
  // quietos mientras están el cartel y la cuenta regresiva
  get frozen() { return this.active && (this.phase === 'intro' || this.phase === 'count'); }

  // Formación: dos columnas por equipo (Azul a la izquierda, x < 0; Rojo a la derecha). El Rojo es el Azul
  // girado 180° alrededor del centro (la Steampunk es simétrica así: sus torres se repiten cada 60°).
  // Se busca la distancia al centro más cercana en la que TODOS los lugares son seguros (sin pozos, sierras…).
  _formation() {
    const a = this.arena, n = this.size, rows = Math.ceil(n / 2), gap = 3.2;
    const ok = (x, z) => a.floorAt(x, z) && (!a.spawnOk || a.spawnOk(x, z));
    let best = null;
    for (let d = a.R * 0.22; d < a.R * 0.7 && !best; d += 0.75) {
      for (const shift of [0, 1.6, -1.6, 3.2, -3.2]) {
        const spots = [];
        for (let k = 0; k < n; k++) {
          const col = k < rows ? 0 : 1, row = k % rows;
          const z = (row - (rows - 1) / 2) * gap + shift;
          spots.push([-(d + col * 3.6), z]);
        }
        if (spots.every(([x, z]) => ok(x, z) && ok(-x, -z))) { best = spots; break; }
      }
    }
    if (!best) best = Array.from({ length: n }, (_, k) => [-(a.R * 0.3 + (k < rows ? 0 : 3.6)), ((k % rows) - (rows - 1) / 2) * 3.2]);
    // tu lugar: adelante y al medio
    const mid = Math.floor((rows - 1) / 2);
    this.slots = [best[mid], ...best.filter((_, k) => k !== mid)];
  }

  // dónde aparece cada uno al empezar la ronda (y mirando al otro equipo)
  spawnFor(j) {
    if (!this.active || j.team == null) return null;
    const mates = this.playing.filter((o) => o.team === j.team);
    const k = mates.indexOf(j);
    const [x, z] = this.slots[Math.max(0, k) % this.slots.length];
    j.yaw = j.targetYaw = j.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    return j.team === 0 ? new THREE.Vector3(x, 6, z) : new THREE.Vector3(-x, 6, -z);
  }
  // en equipos nadie reaparece solo: todos vuelven juntos al empezar la ronda siguiente
  canRespawn() { return !this.active; }

  _show(html, color, secs, cls = '') {
    this.banner.innerHTML = html;
    this.banner.style.setProperty('--tc', color);
    this.banner.className = 'show ' + cls;
    this.bannerT = secs;
  }

  // cartel al empezar cada ronda: en la primera, de qué equipo sos; en las demás, el número de ronda
  _intro(player) {
    if (this.round === 1 && player) {
      const tm = player.team;
      this._show(`<small>${t('tm.youAre')}</small><b>${t('team.' + tm).toUpperCase()}</b><small>${t('tm.bestOf')}</small>`, TEAM_COLORS[tm], INTRO_TIME, 'intro');
      return INTRO_TIME;
    }
    this._show(`<b>${t('tm.round', { n: this.round })}</b><small>${this.wins[0]} – ${this.wins[1]}</small>`, '#ffd21a', ROUND_INTRO);
    return ROUND_INTRO;
  }

  _countShow(txt, go = false) {
    const c = this.countEl;
    c.textContent = txt;
    c.className = '';
    void c.offsetWidth; // reinicia la animación
    c.className = 'show' + (go ? ' go' : '');
  }

  _newRound(notify = true) {
    if (this.seriesOver) { // terminó la partida: arranca otra (mismos equipos)
      this.seriesOver = false;
      this.wins = [0, 0];
      this.round = 0;
      this.onSeriesStart?.();
    }
    this.round++;
    this.clock = ROUND_TIME;
    this._formation();
    this.banner.className = '';
    if (notify) this.onNewRound(); // main los hace aparecer a todos (en su lugar de la formación)
    this.phase = 'intro';
    this.phaseT = this._intro(this.playing.find((j) => j.isPlayer));
    this.lastCount = null;
  }

  // compañero vivo para mirar cuando te sacaron (el que va ganando más puntos)
  spectate(player) {
    if (!this.active || !player.dead) return null;
    let best = null;
    for (const j of this.playing) if (!j.dead && j.team === player.team && (!best || j.score > best.score)) best = j;
    return best;
  }

  alive(team) { let n = 0; for (const j of this.playing) if (!j.dead && j.team === team) n++; return n; }

  update(dt, player) {
    if (!this.active) return;
    const alive = [this.alive(0), this.alive(1)];
    if (this.phase === 'intro' && (this.phaseT -= dt) <= 0) { this.phase = 'count'; this.phaseT = COUNT_TIME; this.banner.className = ''; }
    if (this.phase === 'count') {
      this.phaseT -= dt;
      const n = Math.ceil(this.phaseT);
      if (this.phaseT <= 0) { this.phase = 'play'; this._countShow(t('tm.go'), true); this.onCount?.(0); setTimeout(() => { if (this.phase === 'play') this.countEl.className = ''; }, 800); }
      else if (n !== this.lastCount) { this.lastCount = n; this._countShow(String(n)); this.onCount?.(n); }
    } else if (this.phase === 'play') {
      this.clock -= dt;
      if (alive[0] === 0 || alive[1] === 0 || this.clock <= 0) {
        const w = alive[0] === alive[1] ? -1 : alive[0] > alive[1] ? 0 : 1;
        if (w >= 0) this.wins[w]++;
        this.phase = 'end';
        this.winner = w;
        this.onRoundEnd?.(w);
        const score = `<small>${this.wins[0]} – ${this.wins[1]}</small>`;
        if (w >= 0 && this.wins[w] >= TO_WIN) {
          this.seriesOver = true;
          this.endT = SERIES_END_TIME;
          this._show(`<b>${w === player.team ? t('tm.youWinMatch') : t('tm.wonMatch', { team: t('team.' + w) })}</b>${score}`, TEAM_COLORS[w], SERIES_END_TIME, 'big');
          this.onSeriesEnd?.(w);
        } else {
          this.endT = END_TIME;
          const txt = w < 0 ? t('tm.draw') : w === player.team ? t('tm.youWin') : t('tm.won', { team: t('team.' + w) });
          this._show(`<b>${txt}</b>${score}`, w < 0 ? '#ffd21a' : TEAM_COLORS[w], END_TIME);
        }
      }
    } else if ((this.endT -= dt) <= 0) this._newRound();
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.banner.className = '';

    // marcador (sólo se toca la página si algo cambió)
    const u = this.ui, L = this._last;
    const set = (k, el, v, html = false) => { if (L[k] !== v) { L[k] = v; if (html) el.innerHTML = v; else el.textContent = v; } };
    for (const tm of [0, 1]) {
      set('n' + tm, u.names[tm], t('team.' + tm).toUpperCase());
      set('d' + tm, u.dots[tm], Array.from({ length: this.size }, (_, k) => `<i class="${k < alive[tm] ? 'on' : ''}"></i>`).join(''), true);
      set('w' + tm, u.wins[tm], String(this.wins[tm]));
    }
    const s = Math.max(0, Math.ceil(this.clock));
    set('c', u.clock, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    set('r', u.round, t('tm.round', { n: this.round }));
    const watch = this.spectate(player);
    set('note', u.note, player.dead && this.phase === 'play' ? t('tm.waiting', { name: watch ? watch.name : '…' }) : '');
  }
}
