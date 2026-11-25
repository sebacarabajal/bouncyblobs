import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Jelly, R, SHAPE_NAMES, shapeOutline } from './jelly.js';
import { t, translate, onLang, setLang, getLang, LANGS, isDefaultName } from './i18n.js';
import { tutorialSeen, markTutorial } from './tutorial.js';
import { fetchRecords } from './telemetry.js';
import { logoHTML } from './logo.js';

// Pantalla de inicio: nombre, forma, color (selector con gotero) y tatuaje dibujado a mano alzada.
// Tiene su propia vista previa 3D con una gelatina de verdad (misma física de piel que en el juego).

const STORE = 'gelatinas.look';
const TAT = 256; // resolución del tatuaje
const INKS = ['#14081f', '#ffffff', '#ff2d55', '#ffcc00', '#36e05a', '#21c7ff', '#3d5bff', '#a64dff', '#ff7ac8', '#ff7a1a'];

const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* sin storage */ } };

// ---------------------------------------------------------------- color HSV
const hsv2rgb = (h, s, v) => {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
};
const rgb2hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h / 6) + 1) % 1, mx ? d / mx : 0, mx];
};
const toHex = ([r, g, b]) => '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export class Lobby {
  constructor(el, { onStart, track }) {
    this.track = track || (() => {});
    this.el = el;
    this.onStart = onStart;
    const saved = load();
    this.name = saved.name || t('you');
    this.shape = SHAPE_NAMES[saved.shape] ? saved.shape : 'round';
    this.hsv = rgb2hsv(...fromHex(/^#[0-9a-f]{6}$/i.test(saved.color || '') ? saved.color : '#ff4fa3'));
    this.ink = INKS[0];
    this.brush = 10;
    this.lookBackT = 0;

    el.innerHTML = `
      <div class="lb-wrap">
      <div class="lb-logo"><h1>${logoHTML()}</h1><p class="lb-sub" data-i18n="lb.sub"></p></div>
      <div class="lb-panel">
        <label class="lb-h" data-i18n="lb.lang"></label>
        <div class="lb-langs"></div>
        <label class="lb-h" data-i18n="lb.name"></label>
        <input class="lb-name" maxlength="12" spellcheck="false" />
        <label class="lb-h" data-i18n="lb.shape"></label>
        <div class="lb-shapes"></div>
        <label class="lb-h"><span data-i18n="lb.color"></span> <span class="lb-hint" data-i18n="lb.colorHint"></span></label>
        <div class="lb-color">
          <div class="lb-sv"><canvas width="300" height="170"></canvas><i class="lb-drop"></i></div>
          <div class="lb-hue"><canvas width="300" height="18"></canvas><i class="lb-hcur"></i></div>
          <div class="lb-crow"><span class="lb-sw"></span><input class="lb-hex" maxlength="7" spellcheck="false" /><button class="lb-rand" data-i18n="lb.random" data-i18n-title="lb.randomTitle"></button></div>
        </div>
        <label class="lb-h"><span data-i18n="lb.tattoo"></span> <span class="lb-hint" data-i18n="lb.tattooHint"></span></label>
        <div class="lb-tat">
          <div class="lb-pad"><canvas width="${TAT}" height="${TAT}"></canvas></div>
          <div class="lb-tools">
            <div class="lb-inks"></div>
            <div class="lb-trow"><span data-i18n="lb.thickness"></span><input type="range" class="lb-size" min="2" max="36" value="10" /></div>
            <div class="lb-trow">
              <button class="lb-clear" data-i18n="lb.clear" data-i18n-title="lb.clearTitle"></button>
            </div>
          </div>
        </div>
        <button class="lb-go" data-i18n="lb.go"></button>
        <button class="lb-tut" data-i18n="tut.btn"></button>
        <p class="lb-foot" data-i18n-html="lb.foot"></p>
        <div class="lb-recs"><b data-i18n="lb.records"></b><ol></ol></div>
      </div>
      <div class="lb-stage"><div class="lb-tag"></div><canvas class="lb-3d"></canvas><div class="lb-tip" data-i18n="lb.tip"></div></div>
      </div>
      <div class="lb-modal" role="dialog" aria-modal="true">
        <div class="lb-mbox">
          <div class="lb-mblob"><i></i><b></b><b></b></div>
          <h2 data-i18n="tm.title"></h2>
          <p data-i18n="tm.text"></p>
          <button class="lb-myes" data-i18n="tm.yes"></button>
          <button class="lb-mno" data-i18n="tm.no"></button>
        </div>
      </div>
      <div class="lb-modal lb-modes" role="dialog" aria-modal="true">
        <div class="lb-mbox lb-mwide">
          <h2 data-i18n="mode.title"></h2>
          <div class="lb-mcards">
            <button class="lb-mcard" data-mode="ffa"><span class="lb-mico">🥊</span><b data-i18n="mode.ffa"></b><small data-i18n="mode.ffaD"></small></button>
            <button class="lb-mcard" data-mode="teams"><span class="lb-mico"><i class="tA"></i><i class="tB"></i></span><b data-i18n="mode.teams"></b><small data-i18n="mode.teamsD"></small></button>
          </div>
          <button class="lb-mno lb-mback" data-i18n="mode.back"></button>
        </div>
      </div>`;
    const $ = (s) => el.querySelector(s);
    this.$ = $;

    // nombre
    const nameIn = $('.lb-name');
    nameIn.value = this.name;
    const tag = $('.lb-tag');
    const showName = () => { tag.textContent = ((this.name || '').trim() || t('you')).toUpperCase(); };
    showName();
    nameIn.addEventListener('input', () => { this.name = nameIn.value; showName(); });

    // ------------------------------------------------ forma (siluetas de frente, dibujadas con la misma fórmula del juego)
    const shapesEl = $('.lb-shapes');
    const outlines = Object.keys(SHAPE_NAMES).map((k) => [k, shapeOutline(k)]);
    let maxW = 0, maxH = 0;
    for (const [, pts] of outlines) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      maxW = Math.max(maxW, Math.max(...xs) - Math.min(...xs));
      maxH = Math.max(maxH, Math.max(...ys) - Math.min(...ys));
    }
    const sc = 52 / Math.max(maxW, maxH); // misma escala para todas: se nota cuál es más alta o más chata
    for (const [k, pts] of outlines) {
      const minY = Math.min(...pts.map((p) => p[1])), h = Math.max(...pts.map((p) => p[1])) - minY;
      const ey = (57 - h * 0.5 * sc).toFixed(1); // ojos a media altura
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(30 + x * sc).toFixed(1)} ${(57 - (y - minY) * sc).toFixed(1)}`).join('') + 'Z';
      const b = document.createElement('button');
      b.className = 'lb-shape' + (k === this.shape ? ' on' : '');
      b.dataset.shape = k;
      b.innerHTML = `<svg viewBox="0 0 60 60"><path d="${d}"/><circle cx="24.5" cy="${ey}" r="2.4"/><circle cx="35.5" cy="${ey}" r="2.4"/></svg><span data-i18n="shape.${k}"></span>`;
      b.addEventListener('click', () => {
        this.shape = k;
        shapesEl.querySelectorAll('.lb-shape').forEach((x) => x.classList.toggle('on', x === b));
        if (this.jelly) { this.jelly.setShape(k); this.jelly.squashVel -= 4; }
      });
      shapesEl.appendChild(b);
    }

    // ------------------------------------------------ idioma (cambia todo al toque, también el nombre si es el de fábrica)
    const lEl = $('.lb-langs');
    const lBtns = Object.entries(LANGS).map(([k, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.lang = k;
      b.addEventListener('click', () => setLang(k));
      lEl.appendChild(b);
      return b;
    });
    const langShow = () => { for (const b of lBtns) b.classList.toggle('on', b.lang === getLang()); };
    onLang(() => {
      langShow();
      if (isDefaultName(this.name.trim())) { this.name = t('you'); nameIn.value = this.name; }
      showName();
    });
    langShow();
    translate(el);

    // ------------------------------------------------ selector de color
    this.sv = $('.lb-sv canvas');
    this.hue = $('.lb-hue canvas');
    this.drop = $('.lb-drop');
    this.hcur = $('.lb-hcur');
    this.sw = $('.lb-sw');
    this.hex = $('.lb-hex');
    const hg = this.hue.getContext('2d');
    const grd = hg.createLinearGradient(0, 0, this.hue.width, 0);
    for (let i = 0; i <= 12; i++) grd.addColorStop(i / 12, toHex(hsv2rgb(i / 12, 1, 1)));
    hg.fillStyle = grd; hg.fillRect(0, 0, this.hue.width, this.hue.height);
    const dragOn = (target, fn) => {
      target.addEventListener('pointerdown', (e) => {
        target.setPointerCapture(e.pointerId);
        fn(e);
        const mv = (ev) => fn(ev);
        const up = () => { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); };
        target.addEventListener('pointermove', mv);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      });
    };
    const rel = (e, c) => { const r = c.getBoundingClientRect(); return [THREE.MathUtils.clamp((e.clientX - r.left) / r.width, 0, 1), THREE.MathUtils.clamp((e.clientY - r.top) / r.height, 0, 1)]; };
    dragOn($('.lb-sv'), (e) => { const [x, y] = rel(e, this.sv); this.hsv[1] = x; this.hsv[2] = 1 - y; this._color(); });
    dragOn($('.lb-hue'), (e) => { const [x] = rel(e, this.hue); this.hsv[0] = Math.min(0.999, x); this._color(true); });
    this.hex.addEventListener('change', () => {
      const v = this.hex.value.trim();
      if (/^#?[0-9a-f]{6}$/i.test(v)) { this.hsv = rgb2hsv(...fromHex(v[0] === '#' ? v : '#' + v)); this._color(true); } else this._color();
    });
    $('.lb-rand').addEventListener('click', () => { this.hsv = [Math.random(), 0.55 + Math.random() * 0.45, 0.75 + Math.random() * 0.25]; this._color(true); });

    // ------------------------------------------------ tatuaje
    this.pad = $('.lb-pad canvas');
    this.pg = this.pad.getContext('2d');
    if (saved.tattoo) {
      const img = new Image();
      img.onload = () => { this.pg.drawImage(img, 0, 0, TAT, TAT); this._tatChanged(); };
      img.src = saved.tattoo;
    }
    const inks = $('.lb-inks');
    for (const c of INKS) {
      const b = document.createElement('button');
      b.className = 'lb-ink' + (c === this.ink ? ' on' : '');
      b.style.background = c;
      b.addEventListener('click', () => {
        this.ink = c;
        inks.querySelectorAll('.lb-ink').forEach((x) => x.classList.toggle('on', x === b));
      });
      inks.appendChild(b);
    }
    $('.lb-size').addEventListener('input', (e) => { this.brush = +e.target.value; });
    $('.lb-clear').addEventListener('click', () => { this.pg.clearRect(0, 0, TAT, TAT); this._tatChanged(); });

    let last = null;
    const pt = (e) => { const r = this.pad.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * TAT, ((e.clientY - r.top) / r.height) * TAT]; };
    const stroke = (a, b) => {
      const g = this.pg;
      g.save();
      // sólo dentro del círculo (lo que se ve en la espalda); el borde queda transparente
      g.beginPath(); g.arc(TAT / 2, TAT / 2, TAT / 2 - 3, 0, Math.PI * 2); g.clip();
      g.strokeStyle = g.fillStyle = this.ink;
      g.lineWidth = this.brush;
      g.lineCap = g.lineJoin = 'round';
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.restore();
      this._tatChanged();
    };
    this.pad.addEventListener('pointerdown', (e) => {
      this.pad.setPointerCapture(e.pointerId);
      last = pt(e);
      stroke(last, [last[0] + 0.01, last[1]]);
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = pt(e);
      stroke(last, p);
      last = p;
    });
    const end = () => { last = null; };
    this.pad.addEventListener('pointerup', end);
    this.pad.addEventListener('pointercancel', end);

    // "¡A jugar!": si en este navegador nunca vio el tutorial, primero se lo ofrece (una sola vez)
    // después: elegir el modo (todos contra todos · equipos)
    const modal = $('.lb-modal'), modes = $('.lb-modes');
    this.modalOpen = false;
    const closeModal = () => { this.modalOpen = false; modal.classList.remove('show'); modes.classList.remove('show'); };
    const chooseMode = () => {
      this.modalOpen = true;
      modal.classList.remove('show');
      modes.classList.add('show');
      const last = load().mode === 'teams' ? 'teams' : 'ffa';
      setTimeout(() => modes.querySelector(`[data-mode="${last}"]`).focus(), 30);
    };
    const play = () => {
      if (tutorialSeen()) { chooseMode(); return; }
      this.track('tutorial', { state: 'offered' });
      this.modalOpen = true;
      modal.classList.add('show');
      setTimeout(() => $('.lb-myes').focus(), 30);
    };
    $('.lb-go').addEventListener('click', play);
    $('.lb-tut').addEventListener('click', () => this.start({ tutorial: true }));
    $('.lb-myes').addEventListener('click', () => { closeModal(); this.start({ tutorial: true }); });
    $('.lb-mno').addEventListener('click', () => { markTutorial('declined'); this.track('tutorial', { state: 'declined' }); chooseMode(); });
    modes.querySelectorAll('.lb-mcard').forEach((b) => b.addEventListener('click', () => { closeModal(); this.start({ mode: b.dataset.mode }); }));
    $('.lb-mback').addEventListener('click', closeModal);
    for (const m of [modal, modes]) m.addEventListener('pointerdown', (e) => { if (e.target === m) closeModal(); }); // clic afuera = cancelar
    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (this.modalOpen) { if (e.code === 'Escape') closeModal(); return; } // Enter lo maneja el botón con foco
      if (e.code === 'Enter' && e.target !== this.hex) { e.preventDefault(); play(); }
    });

    this._buildPreview($('.lb-3d'));
    this._color(true);
  }

  // ---------------------------------------------------------------- vista previa 3D
  _buildPreview(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    this.renderer = renderer;
    const scene = new THREE.Scene();
    const bg = document.createElement('canvas');
    bg.width = bg.height = 256;
    const bgg = bg.getContext('2d');
    const rg = bgg.createRadialGradient(128, 110, 10, 128, 128, 190);
    rg.addColorStop(0, '#5b2a8f'); rg.addColorStop(0.55, '#2a1150'); rg.addColorStop(1, '#12061f');
    bgg.fillStyle = rg; bgg.fillRect(0, 0, 256, 256);
    scene.background = new THREE.CanvasTexture(bg);
    scene.background.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.8;
    scene.add(new THREE.HemisphereLight('#e5d5ff', '#2a1050', 0.7));
    const sun = new THREE.DirectionalLight('#fff4e6', 2.2);
    sun.position.set(3, 7, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 20 });
    scene.add(sun);
    const rim = new THREE.PointLight('#ff6bd9', 25, 12);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);
    // pedestal
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.3, 64), new THREE.MeshStandardMaterial({ color: '#3a2468', metalness: 0.4, roughness: 0.35 }));
    ped.position.y = -0.15;
    ped.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.12, 0.05, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.35, 0.85), toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    scene.add(ped, ring);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera = camera;
    this.scene = scene;

    // mundo de física propio, sólo con el piso
    const world = new RAPIER.World({ x: 0, y: -30, z: 0 });
    world.timestep = 1 / 120;
    world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.5, 5).setTranslation(0, -0.5, 0));
    this.world = world;
    this.jelly = new Jelly({ name: 'preview', color: '#ff4fa3', shape: 'round', brow: 0.35, world, scene, spawn: new THREE.Vector3(0, R + 0.05, 0), yaw: 0 });
    this.jelly.setLook({ tattoo: this.pad });
    this.jelly.setShape(this.shape);
    this.viewYaw = 0.5;

    // girar arrastrando · clic = pinchazo
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, moved: 0 };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      drag.x = e.clientX; drag.moved += Math.abs(dx);
      this.viewYaw += dx * 0.012;
      this.spinPause = 2.5;
    });
    canvas.addEventListener('pointerup', () => {
      if (drag && drag.moved < 4) {
        const j = this.jelly;
        j.dent(new THREE.Vector3(Math.random() - 0.5, -0.3, Math.random() - 0.5).normalize(), 10, 0.35);
        j.squashVel -= 3;
        j.body.setLinvel({ x: 0, y: 6, z: 0 }, true);
      }
      drag = null;
    });
    this.spinPause = 0;

    // medir el propio canvas (es cuadrado por CSS); medir el contenedor la estiraba
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(50, r.width), h = Math.max(50, r.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    addEventListener('resize', resize);
    new ResizeObserver(resize).observe(canvas);
    this._resize = resize;

    const cmd = { mx: 0, mz: 0, jump: false, jumpHeld: false, dash: false, sprint: false };
    let last = performance.now(), acc = 0;
    const loop = (now) => {
      if (!this.isOpen) { this.raf = 0; return; }
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const j = this.jelly;
      // mientras dibujás, la gira para mostrarte la espalda
      this.lookBackT = Math.max(0, this.lookBackT - dt);
      this.spinPause = Math.max(0, this.spinPause - dt);
      if (this.lookBackT > 0) {
        const tgt = Math.PI;
        this.viewYaw += Math.atan2(Math.sin(tgt - this.viewYaw), Math.cos(tgt - this.viewYaw)) * (1 - Math.exp(-6 * dt));
      } else if (this.spinPause <= 0) this.viewYaw += dt * 0.6;
      acc += dt;
      while (acc >= 1 / 120) {
        j.targetYaw = this.viewYaw;
        j.yaw = this.viewYaw;
        j.control(1 / 120, cmd);
        world.step();
        j.postStep(1 / 120);
        j.skin(1 / 120);
        acc -= 1 / 120;
      }
      j.render(acc * 120, [j]);
      camera.position.set(0, 2.9, 7.6);
      camera.lookAt(0, 0.6, 0);
      renderer.render(scene, camera);
    };
    this._loop = loop;
  }

  // ---------------------------------------------------------------- helpers
  _color(redrawSV = false) {
    const [h, s, v] = this.hsv;
    if (redrawSV) {
      const g = this.sv.getContext('2d'), w = this.sv.width, hh = this.sv.height;
      g.fillStyle = toHex(hsv2rgb(h, 1, 1)); g.fillRect(0, 0, w, hh);
      const gw = g.createLinearGradient(0, 0, w, 0); gw.addColorStop(0, '#fff'); gw.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gw; g.fillRect(0, 0, w, hh);
      const gb = g.createLinearGradient(0, 0, 0, hh); gb.addColorStop(0, 'rgba(0,0,0,0)'); gb.addColorStop(1, '#000');
      g.fillStyle = gb; g.fillRect(0, 0, w, hh);
    }
    const hex = toHex(hsv2rgb(h, s, v));
    this.colorHex = hex;
    this.drop.style.left = `${s * 100}%`;
    this.drop.style.top = `${(1 - v) * 100}%`;
    this.drop.style.background = hex;
    this.hcur.style.left = `${h * 100}%`;
    this.hcur.style.background = toHex(hsv2rgb(h, 1, 1));
    this.sw.style.background = hex;
    if (document.activeElement !== this.hex) this.hex.value = hex;
    this.el.style.setProperty('--pc', hex);
    this.jelly?.setLook({ color: hex });
  }

  _tatChanged() {
    const m = this.jelly?.tattooMat.map;
    if (m) m.needsUpdate = true;
    this.lookBackT = 1.2;
  }

  _tattooEmpty() {
    const d = this.pg.getImageData(0, 0, TAT, TAT).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
    return true;
  }

  // ---------------------------------------------------------------- abrir / cerrar
  open() {
    this._records();
    this.isOpen = true;
    this.el.classList.add('show');
    this._resize();
    if (!this.raf) this.raf = requestAnimationFrame(this._loop);
    setTimeout(() => this.$('.lb-go').focus(), 50);
  }

  // mode.tutorial = entrar al tutorial en vez de a una partida
  // récords de la semana (todos contra todos). Los nombres los escriben los jugadores: siempre como texto.
  async _records() {
    const box = this.$('.lb-recs'), ol = box.querySelector('ol');
    const list = (await fetchRecords('ffa', 'week')).slice(0, 5);
    box.classList.toggle('show', list.length > 0);
    ol.replaceChildren(...list.map((r) => {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.textContent = r.name;
      const p = document.createElement('b'); p.textContent = String(r.score);
      li.append(n, p);
      return li;
    }));
  }

  start(mode = {}) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('show');
    const name = (this.name || '').trim() || t('you');
    const empty = this._tattooEmpty();
    // copia del dibujo para la gelatina del juego (así seguir dibujando no la cambia en vivo)
    let tattoo = null;
    if (!empty) {
      tattoo = document.createElement('canvas');
      tattoo.width = tattoo.height = TAT;
      tattoo.getContext('2d').drawImage(this.pad, 0, 0);
    }
    const gameMode = mode.mode === 'teams' ? 'teams' : 'ffa';
    const tattooURL = empty ? null : this.pad.toDataURL('image/png');
    save({ name, shape: this.shape, color: this.colorHex, tattoo: tattooURL, mode: mode.tutorial ? load().mode : gameMode });
    this.onStart({ name, shape: this.shape, color: this.colorHex, tattoo, tattooURL, tutorial: !!mode.tutorial, mode: gameMode });
  }
}
