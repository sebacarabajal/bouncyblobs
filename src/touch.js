// Controles táctiles (celular / tablet).
// Mitad izquierda: joystick que aparece donde apoyás el dedo (si lo estirás más allá del aro, corrés).
// Derecha: botones de saltar, embestir, aceite y escupitajo. Arrastrar en cualquier otro lado gira la
// cámara y pellizcar hace zoom (eso lo maneja la cámara).
import { POWERS } from './powers.js';
import { translate } from './i18n.js';

const R = 56; // radio del joystick en px
const SPRINT_AT = 1.3; // estirarlo 1.3 veces el radio = correr

export class TouchControls {
  constructor(input, { onMenu }) {
    this.input = input;
    const el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `
      <div class="tc-zone"><div class="tc-base"><div class="tc-knob"></div></div></div>
      <button class="tc-btn tc-jump" data-act="jump"><span data-i18n="tc.jump"></span></button>
      <button class="tc-btn tc-dash" data-act="dash"><span data-i18n="tc.dash"></span></button>
      <button class="tc-btn tc-w tc-oil" data-act="oil"><i>${POWERS.oil.icon}</i><b>0</b></button>
      <button class="tc-btn tc-w tc-spit" data-act="spit"><i>${POWERS.spit.icon}</i><b>0</b></button>
      <button class="tc-menu">☰</button>`;
    translate(el);
    document.body.appendChild(el);
    this.el = el;
    const $ = (s) => el.querySelector(s);
    this.base = $('.tc-base');
    this.knob = $('.tc-knob');
    this.wOil = $('.tc-oil');
    this.wSpit = $('.tc-spit');

    // ---------------------------------------------------- joystick
    const zone = $('.tc-zone');
    let stick = null; // { id, x, y }
    const t = input.touch;
    const move = (e) => {
      const dx = e.clientX - stick.x, dy = e.clientY - stick.y, d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const m = Math.min(1, d / R);
      t.mx = d > 6 ? (dx / d) * m : 0;
      t.mz = d > 6 ? (dy / d) * m : 0;
      t.sprint = d > R * SPRINT_AT;
      this.base.classList.toggle('run', t.sprint);
    };
    zone.addEventListener('pointerdown', (e) => {
      if (stick || !input.enabled) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      t.active = true;
      input.mashCount++;
      move(e);
    });
    zone.addEventListener('pointermove', (e) => { if (stick && e.pointerId === stick.id) move(e); });
    const endStick = (e) => {
      if (!stick || e.pointerId !== stick.id) return;
      stick = null;
      t.mx = t.mz = 0; t.sprint = false;
      this.knob.style.transform = '';
      this.base.classList.remove('on', 'run');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    // ---------------------------------------------------- botones
    for (const b of el.querySelectorAll('.tc-btn')) {
      const act = b.dataset.act;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!input.enabled) return;
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        input.mashCount++; // también sirve para despabilarse cuando está mareado
        if (act === 'jump') { input.jumpPressed = true; t.jumpHeld = true; }
        if (act === 'dash') input.dashPressed = true;
        if (act === 'oil' || act === 'spit') input.throwPressed = act;
      });
      const up = () => { b.classList.remove('down'); if (act === 'jump') t.jumpHeld = false; };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }
    $('.tc-menu').addEventListener('click', () => onMenu?.());

    // nada de menús de "copiar", lupa ni zoom de la página mientras jugás
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // contadores de las armas (se llama desde el HUD; sólo toca la página si cambió algo)
  update(ammo) {
    for (const [b, n] of [[this.wOil, ammo.oil], [this.wSpit, ammo.spit]]) {
      if (b._n === n) continue;
      b._n = n;
      b.classList.toggle('on', n > 0);
      b.lastChild.textContent = String(n);
    }
  }
}
