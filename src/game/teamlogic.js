import * as THREE from 'three';

// Lógica del modo por equipos (corre igual en el servidor y en el modo local). Sin DOM: lo que se ve
// (marcador, carteles, 3-2-1) lo dibuja src/teams.js a partir de state() y de los eventos que emite.
//
// Azul vs Rojo (8 vs 8 en Steampunk; en las arenas de 12, 6 vs 6). Partida al mejor de 5: gana el primero que
// gana 3 rondas. En cada ronda el que se cae no vuelve hasta la siguiente; la gana el equipo que deja al otro
// sin nadie, o (si se acaba el tiempo) el que tiene más vivos (empate: no suma).
// Cada ronda: todos en formación (Azul a la izquierda, Rojo a la derecha), quietos con el cartel y el 3-2-1.
// Todas las de un equipo se tiñen del mismo color (al salir del modo vuelven al suyo).
export const TEAM_COLORS = ['#2f8bff', '#ff3b4f'];
export const ROUND_TIME = 180;
const TO_WIN = 3;
const END_TIME = 4.5;
const SERIES_END_TIME = 7;
export const INTRO_TIME = 2.6;
export const ROUND_INTRO = 1.4;
export const COUNT_TIME = 3;

export class TeamLogic {
  // emit(tipo, datos): 'intro' {round, wins} · 'count' {n} (0 = ¡YA!) · 'roundEnd' {w, wins, series}
  constructor(jellies, { onNewRound, emit = () => {} }) {
    this.jellies = jellies;
    this.onNewRound = onNewRound;
    this.emit = emit;
    this.active = false;
    this.phase = 'play';
    this.wins = [0, 0];
    this.round = 0;
    this.clock = ROUND_TIME;
    this.size = 0;
    this.orig = new Map();
    this.playing = [];
  }

  // playing = las que juegan; firstTeamOf(j) opcional: a qué equipo va cada humano (si no, parejo)
  start(playing, arena) {
    this._restore();
    this.arena = arena;
    this.active = true;
    this.playing = playing;
    for (const j of this.jellies) j.team = null;
    const half = Math.floor(playing.length / 2);
    // humanos (o tu gelatina en local) repartidos primero, parejo; después los bots al azar
    const humans = playing.filter((j) => j.isPlayer || j.human);
    const bots = playing.filter((j) => !(j.isPlayer || j.human)).sort(() => Math.random() - 0.5);
    const count = [0, 0];
    for (const j of [...humans, ...bots]) {
      const tm = count[0] <= count[1] ? 0 : 1;
      j.team = count[tm] < half ? tm : 1 - tm;
      count[j.team]++;
    }
    for (const j of playing) { this.orig.set(j, '#' + j.color.getHexString()); j.setLook({ color: TEAM_COLORS[j.team] }); }
    this.size = half;
    this.wins = [0, 0];
    this.round = 0;
    this._newRound(false);
  }

  stop() {
    this._restore();
    if (!this.active) return;
    this.active = false;
    for (const j of this.jellies) j.team = null;
  }

  _restore() {
    for (const [j, hex] of this.orig) j.setLook({ color: hex });
    this.orig.clear();
  }

  // una gelatina entra a la partida en curso (un jugador que reemplaza a un bot): va al equipo con menos
  join(j) {
    if (!this.active) return;
    // si ocupa el lugar de un bot, se queda con su equipo (así los equipos siguen parejos); si no, al que tenga menos
    const n = [0, 1].map((tm) => this.playing.filter((o) => o !== j && o.team === tm).length);
    if (j.team == null) j.team = n[0] <= n[1] ? 0 : 1;
    if (!this.playing.includes(j)) this.playing.push(j);
    this.orig.set(j, '#' + j.color.getHexString());
    j.setLook({ color: TEAM_COLORS[j.team] });
  }

  isEnemy(a, b) { return !this.active || a.team == null || b.team == null || a.team !== b.team; }
  get frozen() { return this.active && (this.phase === 'intro' || this.phase === 'count'); }
  canRespawn() { return !this.active; }

  // Formación: dos columnas por equipo (Azul a la izquierda, x < 0). El Rojo es el Azul girado 180° alrededor
  // del centro (la Steampunk es simétrica así). Se busca la distancia más cercana con TODOS los lugares seguros.
  _formation() {
    const a = this.arena, n = Math.max(1, this.size), rows = Math.ceil(n / 2), gap = 3.2;
    const ok = (x, z) => a.floorAt(x, z) && (!a.spawnOk || a.spawnOk(x, z));
    let best = null;
    for (let d = a.R * 0.22; d < a.R * 0.7 && !best; d += 0.75) {
      for (const shift of [0, 1.6, -1.6, 3.2, -3.2]) {
        const spots = [];
        for (let k = 0; k < n; k++) {
          const col = k < rows ? 0 : 1, row = k % rows;
          spots.push([-(d + col * 3.6), (row - (rows - 1) / 2) * gap + shift]);
        }
        if (spots.every(([x, z]) => ok(x, z) && ok(-x, -z))) { best = spots; break; }
      }
    }
    if (!best) best = Array.from({ length: n }, (_, k) => [-(a.R * 0.3 + (k < rows ? 0 : 3.6)), ((k % rows) - (rows - 1) / 2) * 3.2]);
    const mid = Math.floor((rows - 1) / 2); // el primer humano: adelante y al medio
    this.slots = [best[mid], ...best.filter((_, k) => k !== mid)];
  }

  spawnFor(j) {
    if (!this.active || j.team == null) return null;
    // los humanos primero (así quedan adelante); después los bots
    const mates = this.playing.filter((o) => o.team === j.team).sort((x, y) => (y.isPlayer || y.human ? 1 : 0) - (x.isPlayer || x.human ? 1 : 0));
    const k = Math.max(0, mates.indexOf(j));
    const [x, z] = this.slots[k % this.slots.length];
    j.yaw = j.targetYaw = j.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    return j.team === 0 ? new THREE.Vector3(x, 6, z) : new THREE.Vector3(-x, 6, -z);
  }

  _newRound(notify = true) {
    if (this.seriesOver) { this.seriesOver = false; this.wins = [0, 0]; this.round = 0; this.emit('seriesStart', {}); }
    this.round++;
    this.clock = ROUND_TIME;
    this._formation();
    if (notify) this.onNewRound();
    this.phase = 'intro';
    this.phaseT = this.round === 1 ? INTRO_TIME : ROUND_INTRO;
    this.lastCount = null;
    this.emit('intro', { round: this.round, wins: [...this.wins] });
  }

  // compañero vivo para mirar cuando te sacaron (el que va ganando más puntos)
  spectate(j) {
    if (!this.active || !j.dead) return null;
    let best = null;
    for (const o of this.playing) if (!o.dead && o.team === j.team && (!best || o.score > best.score)) best = o;
    return best;
  }

  alive(team) { let n = 0; for (const j of this.playing) if (!j.dead && j.team === team) n++; return n; }

  state() {
    // goIn: segundos que faltan para el ¡YA! (0 si ya se juega): el navegador arranca exacto, sin esperar el aviso
    const goIn = this.phase === 'intro' ? this.phaseT + COUNT_TIME : this.phase === 'count' ? this.phaseT : 0;
    return { active: this.active, phase: this.phase, clock: this.clock, wins: this.wins, round: this.round, size: this.size, alive: [this.alive(0), this.alive(1)], goIn: Math.max(0, goIn) };
  }

  update(dt) {
    if (!this.active) return;
    if (this.phase === 'intro' && (this.phaseT -= dt) <= 0) { this.phase = 'count'; this.phaseT = COUNT_TIME; }
    if (this.phase === 'count') {
      this.phaseT -= dt;
      const n = Math.ceil(this.phaseT);
      if (this.phaseT <= 0) { this.phase = 'play'; this.emit('count', { n: 0 }); }
      else if (n !== this.lastCount) { this.lastCount = n; this.emit('count', { n }); }
    } else if (this.phase === 'play') {
      this.clock -= dt;
      const alive = [this.alive(0), this.alive(1)];
      if (alive[0] === 0 || alive[1] === 0 || this.clock <= 0) {
        const w = alive[0] === alive[1] ? -1 : alive[0] > alive[1] ? 0 : 1;
        if (w >= 0) this.wins[w]++;
        this.phase = 'end';
        this.winner = w;
        const series = w >= 0 && this.wins[w] >= TO_WIN;
        if (series) this.seriesOver = true;
        this.endT = series ? SERIES_END_TIME : END_TIME;
        this.emit('roundEnd', { w, wins: [...this.wins], series, round: this.round });
      }
    } else if (this.phase === 'end' && (this.endT -= dt) <= 0) this._newRound();
  }
}
