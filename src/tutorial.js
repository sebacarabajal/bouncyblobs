// Tutorial: una tarjeta arriba que te dice qué hacer, paso por paso, y no avanza hasta que lo hacés.
// El juego le avisa lo que pasa (action / hit / thrown / spitHit / ate) y cada frame llama a update().
// Se juega en la arena chiquita de arenas/tutorial.js, con una gelatina de práctica quieta en la diana.
// Las bolitas (blancas, de poder y las que traen armas) las pone el tutorial con drop(x, z, poder).
import { t, translate, onLang } from './i18n.js';
import { POWERS } from './powers.js';
import { DUMMY_HOME } from './arenas/tutorial.js';

// goal = cuánto hay que hacer · unit = cómo se muestra el progreso · weapon = arma que se consigue en ese paso
const STEPS = [
  { id: 'move', goal: 12, unit: 'm' }, // metros caminados
  { id: 'sprint', goal: 2, unit: 's' }, // segundos corriendo
  { id: 'jump', goal: 3 }, // saltos
  { id: 'eat', goal: 6 }, // gelatinitas blancas comidas
  { id: 'dash', goal: 2 }, // embestidas que le pegan a la de práctica
  { id: 'dive', goal: 2 }, // picadas (saltar + embestir en el aire)
  { id: 'powers', goal: 4 }, // las 4 bolitas de poder (una de cada)
  { id: 'oil', goal: 1, weapon: 'oil' }, // agarrar la bolita del aceite y tirarlo
  { id: 'spit', goal: 1, weapon: 'spit' }, // agarrar la bolita del chorro y pegarle a la de práctica
];
const POWER_LIST = ['turbo', 'strength', 'heal', 'feast'];
const POWER_SPOTS = [[-7, 4], [-3, 9], [3, 9], [7, 4]];
const OK_TIME = 1.4; // segundos que se muestra el "¡Bien!" antes del paso siguiente
const SPOT_R = 12.5; // las bolitas caen dentro de este radio (la arena mide 16)

// ¿ya lo hizo (o lo rechazó) en este navegador? Así la ventanita de "¿primera vez?" sale una sola vez.
const STORE = 'gelatinas.tutorial';
export const tutorialSeen = () => { try { return !!localStorage.getItem(STORE); } catch { return true; } };
export const markTutorial = (v) => { try { localStorage.setItem(STORE, v); } catch { /* sin storage */ } };

export class Tutorial {
  constructor({ drop, sfx, onPlay, onMenu }) {
    this.drop = drop;
    this.sfx = sfx;
    this.active = false;
    this.player = null;
    this.dummy = null;

    const el = document.createElement('div');
    el.id = 'tutorial';
    el.innerHTML = `
      <div class="tu-card">
        <div class="tu-head"><span class="tu-step"></span><button class="tu-skip" data-i18n="tut.skip"></button></div>
        <div class="tu-title"></div>
        <div class="tu-text"></div>
        <ul class="tu-list"></ul>
        <div class="tu-prog"><div class="tube"><i></i></div><b></b></div>
        <div class="tu-end">
          <button class="tu-play" data-i18n="tut.play"></button>
          <button class="tu-again" data-i18n="tut.again"></button>
          <button class="tu-menu" data-i18n="tut.menu"></button>
        </div>
        <div class="tu-ok" data-i18n="tut.ok"></div>
      </div>`;
    document.body.appendChild(el);
    translate(el);
    this.el = el;
    const $ = (s) => el.querySelector(s);
    this.ui = { card: $('.tu-card'), step: $('.tu-step'), title: $('.tu-title'), text: $('.tu-text'), list: $('.tu-list'), fill: $('.tu-prog i'), count: $('.tu-prog b') };
    // los botones no se tienen que quedar con el foco (si no, Espacio los "aprieta" en vez de saltar)
    const btn = (s, fn) => $(s).addEventListener('click', (e) => { e.currentTarget.blur(); fn(); });
    btn('.tu-skip', () => onMenu());
    btn('.tu-play', () => onPlay());
    btn('.tu-menu', () => onMenu());
    btn('.tu-again', () => this.start(this.player, this.dummy));
    onLang(() => { if (this.active) this._show(); });
  }

  start(player, dummy) {
    this.player = player;
    this.dummy = dummy;
    this.active = true;
    markTutorial('seen');
    this.el.classList.add('show');
    document.body.classList.add('tutorial');
    this._go(0);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.el.classList.remove('show');
    document.body.classList.remove('tutorial');
  }

  get step() { return STEPS[this.i]; }

  _go(i) {
    this.i = i;
    this.onStep?.(i, STEPS[i]?.id); // analíticas: hasta qué paso llega la gente
    this.n = 0;
    this.okT = 0;
    this.wait = 0;
    this.balls = [];
    this.got = new Set();
    this.last = this.player.pos.clone();
    this.ui.card.classList.remove('ok');
    this.ui.card.classList.toggle('end', i >= STEPS.length);
    if (i >= STEPS.length) this.sfx.power();
    const s = this.step;
    if (s?.id === 'eat') this._dropWhite(8);
    if (s?.id === 'powers') this.balls = POWER_LIST.map((p, k) => this.drop(POWER_SPOTS[k][0], POWER_SPOTS[k][1], p));
    if (s?.weapon) {
      // el arma no te la regalan: la trae una bolita amarilla que cae cerca
      this.player.ammo.oil = this.player.ammo.spit = 0;
      this._dropWeapon();
    }
    this._show();
  }

  // ---------------------------------------------------- dónde caen las bolitas
  _spot(cx, cz, rMin, rMax) {
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (Math.hypot(x, z) > SPOT_R) continue;
      if (Math.hypot(x - DUMMY_HOME.x, z - DUMMY_HOME.z) < 3.5) continue; // lejos de la de práctica
      return [x, z];
    }
    return [cx * 0.5, 6];
  }

  _dropWhite(count) {
    const p = this.player.pos;
    for (let k = 0; k < count; k++) {
      const [x, z] = this._spot(p.x, p.z, 2.5, 8);
      this.balls.push(this.drop(x, z, null, 4 + k * 0.6)); // van cayendo de a una
    }
  }

  _dropWeapon() {
    const p = this.player.pos;
    const [x, z] = this._spot(p.x, p.z, 3, 5);
    this.balls = [this.drop(x, z, this.step.weapon)];
  }

  // ---------------------------------------------------- tarjeta
  _show() {
    const s = this.step, u = this.ui;
    u.step.textContent = t('tut.head', { n: Math.min(this.i + 1, STEPS.length), total: STEPS.length });
    if (!s) {
      u.title.textContent = t('tut.end.t');
      u.text.innerHTML = t('tut.end.d');
      u.list.innerHTML = '';
      return;
    }
    u.title.textContent = t(`tut.${s.id}.t`);
    u.text.innerHTML = t(`tut.${s.id}.d`);
    this._listSig = null;
    this._list();
    this._progress();
  }

  // lista con tildes: los 4 poderes, o los 2 pasos de un arma (agarrarla · usarla)
  _list() {
    const s = this.step;
    let items = [];
    if (s?.id === 'powers') {
      items = POWER_LIST.map((p) => ({ icon: POWERS[p].icon, html: `<b>${t('power.' + p)}</b>: ${t('pdesc.' + p)}`, done: this.got.has(p) }));
    } else if (s?.weapon) {
      const done = this.n >= s.goal;
      items = [
        { icon: '1', html: t(`tut.${s.id}.a`), done: done || this.player.ammo[s.weapon] > 0 },
        { icon: '2', html: t(`tut.${s.id}.b`), done },
      ];
    }
    const sig = items.map((x) => +x.done).join('') + (s?.id || '');
    if (sig === this._listSig) return;
    this._listSig = sig;
    this.ui.list.innerHTML = items.map((x) => `<li class="${x.done ? 'got' : ''}"><i>${x.icon}</i><span>${x.html}</span></li>`).join('');
  }

  _progress() {
    const s = this.step;
    if (!s) return;
    const n = Math.min(this.n, s.goal);
    this.ui.fill.style.transform = `translateX(${(n / s.goal) * 100 - 100}%)`;
    const shown = s.unit ? Math.floor(n) : n;
    this.ui.count.textContent = `${shown} / ${s.goal}${s.unit ? ' ' + s.unit : ''}`;
  }

  _add(id, amount = 1) {
    const s = this.step;
    if (!this.active || !s || s.id !== id || this.okT > 0) return;
    const before = Math.floor(this.n);
    this.n += amount;
    if (this.n >= s.goal) {
      this.n = s.goal;
      this.okT = OK_TIME;
      this.ui.card.classList.add('ok');
      this.sfx.power();
    } else if (!s.unit || Math.floor(this.n) !== before) this.sfx.gulp?.();
    this._progress();
    this._list();
  }

  // ---------------------------------------------------- lo que avisa el juego
  action(kind) { if (kind === 'jump') this._add('jump'); if (kind === 'dive') this._add('dive'); }
  hit(att, vic) { if (att === this.player && vic === this.dummy) this._add('dash'); }
  thrown(j, type) { if (j === this.player && type === 'oil') this._add('oil'); }
  spitHit(owner, vic) { if (owner === this.player && vic === this.dummy) this._add('spit'); }
  ate(j, power) {
    if (!this.active || j !== this.player) return;
    if (!power) this._add('eat');
    else if (this.step?.id === 'powers' && POWER_LIST.includes(power) && !this.got.has(power)) {
      this.got.add(power);
      this._add('powers');
    }
  }

  update(dt) {
    if (!this.active) return;
    const p = this.player, s = this.step;
    if (this.okT > 0) {
      this.okT -= dt;
      if (this.okT <= 0) this._go(this.i + 1);
      return;
    }
    if (!s || p.dead) { if (p) this.last.copy(p.pos); return; }
    // metros caminados (los saltos grandes de posición, como reaparecer, no cuentan)
    const d = Math.hypot(p.pos.x - this.last.x, p.pos.z - this.last.z);
    this.last.copy(p.pos);
    if (s.id === 'move' && d < 2) this._add('move', d);
    if (s.id === 'sprint' && p.sprinting) this._add('sprint', dt);

    // si se acabaron las bolitas antes de lograrlo (se las comió la otra, o se gastó el arma sin pegar), caen más
    this.wait += dt;
    if (this.wait > 1.2) {
      this.wait = 0;
      if (s.id === 'eat' && this.balls.every((b) => b.gone)) { this.balls = []; this._dropWhite(s.goal - this.n + 2); }
      if (s.id === 'powers') {
        POWER_LIST.forEach((pw, k) => {
          if (!this.got.has(pw) && this.balls[k].gone) this.balls[k] = this.drop(POWER_SPOTS[k][0], POWER_SPOTS[k][1], pw);
        });
      }
      if (s.weapon && p.ammo[s.weapon] <= 0 && this.balls.every((b) => b.gone)) this._dropWeapon();
    }
    if (s.weapon) this._list(); // la tilde de "agarrala" depende de si tenés el arma
  }
}
