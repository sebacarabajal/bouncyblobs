import { t } from './i18n.js';
import { TEAM_COLORS, INTRO_TIME, ROUND_INTRO } from './game/teamlogic.js';

// Lo que se VE del modo por equipos: marcador arriba al medio, carteles (de qué equipo sos, fin de ronda,
// fin de partida) y la cuenta 3-2-1. La lógica está en game/teamlogic.js (corre en el servidor o en local);
// esto sólo dibuja su estado (state()) y reacciona a sus eventos.
export { TEAM_COLORS };

export class TeamsHUD {
  constructor() {
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
    this.el = el; this.banner = banner; this.countEl = count;
    const q = (s) => el.querySelector(s);
    this.ui = {
      names: [q('.a b'), q('.b b')], dots: [q('.a .tm-dots'), q('.b .tm-dots')], wins: [q('.a em'), q('.b em')],
      clock: q('.tm-clock'), round: q('.tm-round'), note: q('.tm-note'),
    };
    this._last = {};
    this.bannerT = 0;
    this.active = false;
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    document.body.classList.toggle('teams', on);
    if (!on) { this.banner.className = ''; this.countEl.className = ''; }
  }

  _show(html, color, secs, cls = '') {
    this.banner.innerHTML = html;
    this.banner.style.setProperty('--tc', color);
    this.banner.className = 'show ' + cls;
    this.bannerT = secs;
  }

  _count(txt, go = false) {
    const c = this.countEl;
    c.textContent = txt;
    c.className = '';
    void c.offsetWidth; // reinicia la animación
    c.className = 'show' + (go ? ' go' : '');
    if (go) setTimeout(() => { if (c.textContent === txt) c.className = ''; }, 800);
  }

  // eventos de la lógica · myTeam = equipo de quien mira
  onEvent(type, d, myTeam) {
    if (type === 'intro') {
      if (d.round === 1 && myTeam != null) {
        this._show(`<small>${t('tm.youAre')}</small><b>${t('team.' + myTeam).toUpperCase()}</b><small>${t('tm.bestOf')}</small>`, TEAM_COLORS[myTeam], INTRO_TIME, 'intro');
      } else {
        this._show(`<b>${t('tm.round', { n: d.round })}</b><small>${d.wins[0]} – ${d.wins[1]}</small>`, '#ffd21a', ROUND_INTRO);
      }
    } else if (type === 'count') {
      if (d.n > 0) this._count(String(d.n)); else { this.banner.className = ''; this._count(t('tm.go'), true); }
    } else if (type === 'roundEnd') {
      const { w, wins, series } = d;
      const score = `<small>${wins[0]} – ${wins[1]}</small>`;
      if (series) {
        this._show(`<b>${w === myTeam ? t('tm.youWinMatch') : t('tm.wonMatch', { team: t('team.' + w) })}</b>${score}`, TEAM_COLORS[w], 7, 'big');
      } else {
        const txt = w < 0 ? t('tm.draw') : w === myTeam ? t('tm.youWin') : t('tm.won', { team: t('team.' + w) });
        this._show(`<b>${txt}</b>${score}`, w < 0 ? '#ffd21a' : TEAM_COLORS[w], 4.5);
      }
    }
  }

  // cada frame: s = state() de la lógica · note = texto de abajo ("miras a…")
  update(dt, s, note = '') {
    this.setActive(!!s?.active);
    if (!this.active) return;
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.banner.className = '';
    const u = this.ui, L = this._last;
    const set = (k, el, v, html = false) => { if (L[k] !== v) { L[k] = v; if (html) el.innerHTML = v; else el.textContent = v; } };
    for (const tm of [0, 1]) {
      set('n' + tm, u.names[tm], t('team.' + tm).toUpperCase());
      set('d' + tm, u.dots[tm], Array.from({ length: s.size }, (_, k) => `<i class="${k < s.alive[tm] ? 'on' : ''}"></i>`).join(''), true);
      set('w' + tm, u.wins[tm], String(s.wins[tm]));
    }
    const sec = Math.max(0, Math.ceil(s.clock));
    set('c', u.clock, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
    set('r', u.round, t('tm.round', { n: s.round }));
    set('note', u.note, note);
  }
}
