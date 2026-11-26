// Opciones (⚙️ arriba a la derecha, o Esc): ventanita en el medio con Controles, Gráficos, Sonido e Idioma.
// El juego sigue corriendo de fondo (pensado para multijugador): sólo se deja de mover tu gelatina.
// Lo que elige el jugador se guarda en este navegador (gelatinas.prefs; las teclas, en keys.js).
import { t, translate, onLang, setLang, getLang, LANGS, refreshTexts } from './i18n.js';
import { ACTIONS, keys, onKeys, usePreset, bind, keyName } from './keys.js';
import { music } from './music.js';

const PREFS = 'gelatinas.prefs';
export function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* sin storage */ } }

const FPS = ['auto', '60', 'off'];

// ctx: fps() / setFps(v) · status() → { hz, fps, res } · sfx · canOpen() ·
// onOpen() / onClose() · onLobby()
export class Options {
  constructor(ctx) {
    this.ctx = ctx;
    this.prefs = loadPrefs();
    this.tab = 'controls';
    this.capturing = null;

    const gear = document.createElement('button');
    gear.id = 'gear';
    gear.innerHTML = '<span>⚙️</span>';
    document.body.appendChild(gear);
    gear.addEventListener('click', (e) => { e.currentTarget.blur(); this.toggle(); });

    const el = document.createElement('div');
    el.id = 'options';
    el.className = 'op-modal';
    const chips = (cls, list, label) => `<div class="op-chips ${cls}">${list.map((k) => `<button data-k="${k}" data-i18n="${label(k)}"></button>`).join('')}</div>`;
    el.innerHTML = `
      <div class="op-box">
        <div class="op-head"><h2 data-i18n="op.title"></h2><span class="op-arena" id="arena"></span><button class="op-x" aria-label="✕">✕</button></div>
        <div class="op-tabs">${['controls', 'graphics', 'sound', 'lang'].map((k) => `<button data-tab="${k}" data-i18n="op.tab.${k}"></button>`).join('')}</div>
        <section data-tab="controls">
          <div class="op-row"><label data-i18n="op.preset"></label>${chips('op-presets', ['arrows', 'wasd'], (k) => 'op.preset.' + k)}<span class="op-custom" data-i18n="op.preset.custom"></span></div>
          <p class="op-hint" data-i18n="op.rebind"></p>
          <div class="op-keys">${ACTIONS.map((a) => `<div class="op-key"><span data-i18n="act.${a}"></span><button data-a="${a}"></button></div>`).join('')}</div>
          <h3 data-i18n="op.howto"></h3><div class="op-help" data-i18n-html="help"></div>
          <h3 data-i18n="op.other"></h3><div class="op-help" data-i18n-html="op.otherKeys"></div>
          <div class="op-dev"><span data-i18n-html="op.dev"></span> <span id="mode"></span></div>
        </section>
        <section data-tab="graphics">
          <h3 data-i18n="op.fps"></h3>${chips('op-fps', FPS, (k) => 'op.fps.' + k)}
          <p class="op-hint" data-i18n="op.fpsHint"></p>
          <p class="op-status"></p>
        </section>
        <section data-tab="sound">
          <h3 data-i18n="op.sound"></h3>${chips('op-mute', ['on', 'off'], (k) => 'op.' + k)}
          <h3 data-i18n="op.volume"></h3>
          <div class="op-vol"><input type="range" min="0" max="100" step="1" /><b></b></div>
          <div class="op-music">
            <h3 data-i18n="op.music"></h3>
            <div class="op-vol op-mvol"><input type="range" min="0" max="100" step="1" /><b></b></div>
            <div class="op-mrow"><span class="op-mnow"></span><button class="op-mnext" data-i18n="op.musicNext"></button></div>
          </div>
        </section>
        <section data-tab="lang">
          <div class="op-chips op-langs">${Object.entries(LANGS).map(([k, n]) => `<button data-k="${k}">${n}</button>`).join('')}</div>
        </section>
        <div class="op-foot"><button class="op-lobby" data-i18n="op.lobby"></button><button class="op-back" data-i18n="op.close"></button></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    const $ = (s) => el.querySelector(s), $$ = (s) => [...el.querySelectorAll(s)];
    translate(el);
    gear.title = t('op.gear');

    const click = (b, fn) => b.addEventListener('click', (e) => { e.currentTarget.blur(); fn(e.currentTarget); });
    click($('.op-x'), () => this.close());
    click($('.op-back'), () => this.close());
    click($('.op-lobby'), () => { this.close(); ctx.onLobby(); });
    el.addEventListener('pointerdown', (e) => { if (e.target === el) this.close(); }); // clic afuera
    $$('.op-tabs button').forEach((b) => click(b, () => { this.tab = b.dataset.tab; this._render(); }));
    $$('.op-presets button').forEach((b) => click(b, () => usePreset(b.dataset.k)));
    $$('.op-keys button').forEach((b) => click(b, () => { this.capturing = b.dataset.a; this._render(); }));
    $$('.op-fps button').forEach((b) => click(b, () => { ctx.setFps(b.dataset.k); this.prefs.fps = b.dataset.k; savePrefs(this.prefs); this._render(); }));
    $$('.op-mute button').forEach((b) => click(b, () => { ctx.sfx.muted = b.dataset.k === 'off'; this.prefs.muted = ctx.sfx.muted; savePrefs(this.prefs); music.apply(); this._render(); }));
    // música de fondo: volumen aparte y "otra canción"
    const mvol = $('.op-mvol input');
    mvol.addEventListener('input', () => { music.setVol(mvol.value / 100); this.prefs.musicRel = music.vol; savePrefs(this.prefs); this._render(); });
    click($('.op-mnext'), () => music.next());
    music.onChange = () => this._render();
    $$('.op-langs button').forEach((b) => click(b, () => setLang(b.dataset.k)));
    const vol = $('.op-vol input');
    vol.addEventListener('input', () => { ctx.sfx.master = vol.value / 100; this.prefs.volume = ctx.sfx.master; savePrefs(this.prefs); this._render(); });
    vol.addEventListener('change', () => ctx.sfx.power?.()); // al soltar: un sonido de muestra

    // lo guardado (sonido y fluidez)
    if (this.prefs.volume != null) ctx.sfx.master = this.prefs.volume;
    if (this.prefs.muted != null) ctx.sfx.muted = this.prefs.muted;
    if (this.prefs.musicRel != null) music.setVol(this.prefs.musicRel);
    if (FPS.includes(this.prefs.fps)) ctx.setFps(this.prefs.fps);

    // Esc abre/cierra · capturar la tecla nueva (va antes que el resto del juego)
    addEventListener('keydown', (e) => {
      if (this.capturing) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.code !== 'Escape') bind(this.capturing, e.code, e.key);
        this.capturing = null;
        this._render();
        return;
      }
      if (e.code !== 'Escape' || e.repeat) return;
      if (this.isOpen) { e.preventDefault(); this.close(); } else if (ctx.canOpen()) { e.preventDefault(); this.open(); }
    }, true);

    onKeys(() => { refreshTexts(); this._render(); }); // el tutorial y la ayuda muestran las teclas nuevas
    onLang(() => { gear.title = t('op.gear'); this._render(); });
  }

  get isOpen() { return this.el.classList.contains('show'); }
  toggle() { if (this.isOpen) this.close(); else if (this.ctx.canOpen()) this.open(); }

  open() {
    this.el.classList.add('show');
    document.body.classList.add('opts-open');
    this.ctx.onOpen();
    this._render();
    clearInterval(this._timer);
    this._timer = setInterval(() => { if (this.tab === 'graphics') this._status(); }, 500);
  }

  close() {
    if (!this.isOpen) return;
    this.capturing = null;
    this.el.classList.remove('show');
    document.body.classList.remove('opts-open');
    clearInterval(this._timer);
    this.ctx.onClose();
  }

  _status() {
    const s = this.ctx.status();
    this.el.querySelector('.op-status').textContent = s.hz ? t('op.now', s) : '';
  }

  _render() {
    const el = this.el, ctx = this.ctx;
    const on = (sel, pred) => el.querySelectorAll(sel).forEach((b) => b.classList.toggle('on', pred(b)));
    on('.op-tabs button', (b) => b.dataset.tab === this.tab);
    el.querySelectorAll('section').forEach((s) => s.classList.toggle('show', s.dataset.tab === this.tab));
    on('.op-presets button', (b) => b.dataset.k === keys.preset);
    el.querySelector('.op-custom').style.display = keys.preset === 'custom' ? '' : 'none';
    el.querySelectorAll('.op-keys button').forEach((b) => {
      const a = b.dataset.a, cap = this.capturing === a;
      b.classList.toggle('wait', cap);
      b.textContent = cap ? t('op.press') : keyName(keys.map[a]);
    });
    on('.op-fps button', (b) => b.dataset.k === ctx.fps());
    on('.op-mute button', (b) => (b.dataset.k === 'off') === !!ctx.sfx.muted);
    const vol = el.querySelector('.op-vol input');
    vol.value = Math.round((ctx.sfx.master ?? 1) * 100);
    el.querySelector('.op-vol b').textContent = `${vol.value} %`;
    const mv = el.querySelector('.op-mvol input');
    mv.value = Math.round(music.vol * 100);
    el.querySelector('.op-mvol b').textContent = `${mv.value} %`;
    el.querySelector('.op-music').style.display = music.started && !music.has ? 'none' : ''; // sin canciones subidas, no se muestra
    el.querySelector('.op-mnow').textContent = music.title ? `🎵 ${music.title}` : '';
    el.querySelector('.op-mnext').style.display = music.has ? '' : 'none';
    on('.op-langs button', (b) => b.dataset.k === getLang());
    this._status();
  }
}
