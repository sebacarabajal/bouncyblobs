import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { CONFIG } from './config.js';
import { Input } from './input.js';
import { fx } from './fx.js';
import { sfx, ear } from './sfx.js';
import { FaceBatch } from './facebatch.js';
import { Adaptive } from './adaptive.js';
import { loadSoundOverrides } from './sfx.js';
import { buildSoundFolder } from './sfxadmin.js';
import { Options } from './options.js';
import { TeamsHUD } from './teams.js';
import { Sim, STEP, ARENAS, BUILDERS } from './game/sim.js';
import { IS_ADMIN } from './env.js';
import { telemetry } from './telemetry.js';
import { CameraRig, CAM_PRESETS } from './camera.js';
import { POWERS } from './powers.js';
import { Lobby } from './lobby.js';
import { Slices } from './slice.js';
import { PerfMonitor } from './perf.js';
import { Q, ORDER, isTouch, saveQuality, refreshGlass } from './quality.js';
import { TouchControls } from './touch.js';
import { t, translate, onLang, getLang } from './i18n.js';
import { preloadBackdrops, onLateAsset } from './arenas/common.js';
import { Tutorial } from './tutorial.js';
import { Online } from './net/online.js';

const ARENA_KEYS = { Digit8: 'cyber', Digit9: 'steam', Digit0: 'crystal' }; // 1-4 quedan para las armas

// los parámetros de prueba de la URL y los ajustes del admin sólo valen en la página del admin (ver env.js)
const params = new URLSearchParams(IS_ADMIN ? location.search : '');
if (params.has('bots')) CONFIG.botsAggressive = true;
if (ARENAS[params.get('arena')]) CONFIG.arena = params.get('arena');

// ajustes del admin guardados en este navegador
// solo se guarda lo que difiere de fábrica, así los cambios de valores por defecto llegan siempre
const ADMIN_KEY = 'gelatinas.admin.v2';
const DEFAULTS = { ...CONFIG };
try { localStorage.removeItem('gelatinas.admin'); } catch { /* */ }
if (IS_ADMIN) { try { Object.assign(CONFIG, JSON.parse(localStorage.getItem(ADMIN_KEY)) || {}); } catch { /* sin storage */ } }

async function main() {
  // fondos pintados: se piden ya, mientras se inicia la física y elegís color en la pantalla de inicio
  preloadBackdrops(Object.keys(ARENAS).map((k) => [`${k}.jpg`, `${k}.png`, `${k}.webp`]));
  await RAPIER.init();

  // ------------------------------------------------------------ render
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.localClippingEnabled = true; // para las mitades de la gelatina rebanada
  // la transparencia de las gelatinas se calcula a media resolución (en movimiento no se nota y ahorra mucho)
  renderer.transmissionResolutionScale = 0.5;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);
  const perf = new PerfMonitor(renderer); // contador de FPS (tecla I) + registro en perf/perf-log.jsonl
  if (!IS_ADMIN) perf.toggle(); // la cajita de FPS sólo la ve el admin (en el juego público, oculta)

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#1b0c35', 45, 160);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(CONFIG.camFov, innerWidth / innerHeight, 0.1, 1000);
  const rig = new CameraRig(camera, renderer.domElement);
  if (params.get('cam') === 'ref') rig.set(CAM_PRESETS[1], true);

  scene.add(new THREE.HemisphereLight('#cdb6ff', '#2a1050', 0.6));
  const sun = new THREE.DirectionalLight('#fff4e6', 2.4);
  sun.position.set(8, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 70 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const rim = new THREE.PointLight('#b46bff', 60, 50);
  rim.position.set(-14, 8, -16);
  scene.add(rim);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.6, 0.85);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // ritmo de fps y resolución automáticos (ver adaptive.js)
  const adaptive = new Adaptive({
    onResScale: () => { applyResolution(); perf.event('resolución ' + Math.round(adaptive.resScale * 100) + '%'); },
    onLevelDown: () => {
      const i = ORDER.indexOf(Q.level);
      if (i >= ORDER.length - 1) return false;
      perf.event('calidad ' + ORDER[i + 1]);
      changeQuality(ORDER[i + 1], true);
    },
  });  adaptive.lowestQuality = Q.level === ORDER[ORDER.length - 1];

  // resolución = la del nivel de calidad × la escala automática (baja de a 10 % si la placa no da)
  function applyResolution() {
    renderer.setPixelRatio(Math.max(0.5, Math.min(devicePixelRatio, Q.p.pr) * adaptive.resScale));
    renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(innerWidth, innerHeight);
  }

  // calidad gráfica (ver quality.js): resolución, sombras, brillo y vidrio de las gelatinas
  let lastGlass = null;
  function applyQuality() {
    const p = Q.p;
    applyResolution();
    renderer.transmissionResolutionScale = p.trs;
    if (sun.shadow.mapSize.x !== p.shadow) {
      sun.shadow.mapSize.set(p.shadow, p.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    CONFIG.bloom = p.bloom;
    refreshGlass();
    const changed = lastGlass !== null && lastGlass !== p.glass; // los materiales se recompilan
    lastGlass = p.glass;
    return changed;
  }
  applyQuality();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  fx.init(scene, camera);

  // ------------------------------------------------------------ la partida (game/sim.js)
  // En modo local (tutorial) la partida corre acá; en línea la corre el servidor (ver net/).
  let shake = 0;
  let gameMode = 'ffa';
  const slices = new Slices(scene);
  const teamsHUD = new TeamsHUD();
  const sim = new Sim({
    scene, local: true,
    hooks: {
      shake: (a) => { shake = Math.max(shake, a); },
      slice: (j, normal, along) => slices.cut(j, normal, along),
      event: (name) => perf.event(name),
      hit: (att, vic) => tutorial.hit(att, vic),
      thrown: (j, type) => tutorial.thrown(j, type),
      spitHit: (owner, j) => tutorial.spitHit(owner, j),
      ate: (j, power) => tutorial.ate(j, power),
      matchReset: () => onMatchReset(),
      teamEvent: (type, d) => {
        teamsHUD.onEvent(type, d, player.team);
        if (type === 'count') sfx[d.n > 0 ? 'use' : 'power']();
        if (type === 'roundEnd') {
          telemetry.track('round', { round: d.round, win: d.w === player.team ? 1 : 0, draw: d.w < 0 ? 1 : 0 });
          if (d.series) telemetry.endMatch('series');
        }
        if (type === 'seriesStart' && !inLobby) telemetry.startMatch({ mode: 'teams', arena: arenaName, team: player.team, name: player.name });
      },
    },
  });
  const world = sim.world;
  const jellies = sim.jellies;
  const player = sim.player;
  const { pickups, oil, shots, teams } = sim;
  const faces = new FaceBatch(scene, jellies); // caras de todas en pocos dibujos
  let arena = null;
  const _p = new THREE.Vector3();

  // Dibuja una vez TODA la arena desde arriba con gran angular (con y sin bloom): así se compilan todas las
  // variantes de materiales (sombras, transparencia de las gelatinas) y nada traba la primera vez que entra en cámara.
  function warmRender() {
    const saved = { p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov, aspect: camera.aspect };
    camera.fov = 150; camera.aspect = 1;
    camera.position.set(0, 60, 0.01);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    composer.render();
    renderer.render(scene, camera);
    camera.position.copy(saved.p); camera.quaternion.copy(saved.q);
    camera.fov = saved.fov; camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
  }

  function loadArena(name, warm = true) {
    if (!BUILDERS[name]) return;
    if (name !== 'tutorial') endTutorial();
    arenaName = name;
    if (name !== 'tutorial') CONFIG.arena = name; // la arena "elegida" sigue siendo la de las partidas
    sim.mode = gameMode;
    sim.loadArena(name); // arma la arena y arranca la partida (onMatchReset)
    arena = sim.arena;
    scene.fog.color.set(arena.fog[0]);
    scene.fog.near = arena.fog[1];
    scene.fog.far = arena.fog[2];
    [bloomPass.strength, bloomPass.radius, bloomPass.threshold] = arena.bloom || [0.5, 0.6, 0.85];
    document.getElementById('arena').textContent = t('arena.' + name);
    if (warm) warmAll();
  }

  // partida de cero en la arena que ya está armada (no la vuelve a construir: así no se traba)
  function resetMatch() {
    sim.mode = gameMode;
    slices.clear();
    sim.resetMatch();
  }

  // lo que hay que actualizar en pantalla cuando arranca una partida
  function onMatchReset() {
    slices.clear();
    for (const j of jellies) {
      if (j.rank) j.rank.el.style.display = j.benched ? 'none' : '';
      j.rank?.el.classList.toggle('tA', j.team === 0);
      j.rank?.el.classList.toggle('tB', j.team === 1);
    }
    meEl.style.setProperty('--c', '#' + player.color.getHexString()); // en equipos, tu panel también toma el color del equipo
    if (online.active || connecting) return;
    if (!sim.arena.tutorial && !inLobby) telemetry.startMatch({ mode: gameMode, arena: arenaName, team: player.team, name: player.name });
    else telemetry.endMatch('arena');
  }

  // Pantalla de carga: tapa el juego mientras se arma la arena y se compilan los materiales, y se va
  // recién después de unos frames ya dibujados (las primeras subidas a la placa de video también traban).
  const loadingEl = document.getElementById('loading');
  let coverFrames = 0, arenaName = null;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const loadingText = loadingEl.querySelector('.ld-text');
  async function loadArenaCovered(name) {
    if (!BUILDERS[name]) return;
    loadingText.textContent = t('loading');
    loadingEl.classList.add('show');
    await nextFrame(); await nextFrame(); // que se llegue a ver antes del trabajo pesado
    // calidad automática: si había bajado y desde hace más de un minuto sobra margen, sube un nivel
    // (acá, tapado por la pantalla de carga, así no interrumpe una partida)
    const qi = ORDER.indexOf(Q.level);
    if (Q.auto && qi > 0 && adaptive.goodT >= 60 && !isTouch()) {
      Q.level = ORDER[qi - 1];
      saveQuality();
      applyQuality();
      adaptive.goodT = 0;
      adaptive.lowestQuality = false;
      perf.event('calidad ' + Q.level);
    }
    loadArena(name, false);
    await warmAll(true); // tapado: compila sin congelar la pantalla de carga
    coverFrames = 8;
    adaptive.holdFor(3);
  }

  async function changeQuality(level, auto = Q.auto) {
    Q.level = level; Q.auto = auto;
    adaptive.lowestQuality = level === ORDER[ORDER.length - 1];
    saveQuality();
    if (!arena || inLobby) { if (applyQuality() && arena) warmAll(); return; }
    loadingText.textContent = t('loadingQuality');
    loadingEl.classList.add('show');
    await nextFrame(); await nextFrame();
    if (applyQuality()) await warmAll(true);
    coverFrames = 6;
    adaptive.holdFor(3);
  }

  // Si la placa de video se reinicia (el driver o el navegador "pierden" el contexto WebGL), three.js lo
  // recupera solo, pero todos los materiales se tienen que volver a compilar: sin esto, el primer corte
  // de sierra (o lo que sea nuevo) después del reinicio traba. Se tapa con la pantalla de carga y se precalienta.
  renderer.domElement.addEventListener('webglcontextlost', () => {
    perf.event('contexto perdido');
    perf.contextLost++;
    loadingText.textContent = t('loadingGpu');
    loadingEl.classList.add('show');
    coverFrames = 0;
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    perf.resetGpu();
    if (arena) warmAll();
    coverFrames = 8;
  });

  // Precalentado: la placa de video compila cada material la primera vez que lo dibuja, y con todas las luces
  // de una arena eso puede tardar casi un segundo (era el congelón al cortarte la sierra). Al cargar cada arena
  // se dibuja todo una vez: lo que hay, lo que está escondido (estrellitas de mareo, bocas, ondas…) y una muestra
  // escondida de lo que aparece después (charcos, manchas, escupitajos, gelatinitas y la gelatina cortada).
  // Como esos materiales después se reutilizan y nunca se descartan, no se vuelven a compilar en plena partida.
  const warmers = [fx, oil, shots, pickups, faces];
  onLateAsset(() => warmAll()); // por si un fondo termina de cargar después de armar la arena
  // async (sólo con la pantalla de carga puesta): la placa compila los materiales en paralelo mientras la
  // página sigue andando (KHR_parallel_shader_compile). Antes se compilaban de a uno con la página
  // congelada: 5-9 segundos sin que se moviera nada al cambiar de arena. Mientras tanto no se dibuja ni se simula.
  let warming = false;
  async function warmAll(async = false) {
    if (warming) return;
    perf.event('precalentado');
    for (const w of warmers) w.warmBegin();
    slices.warmBegin([player, jellies.find((j) => !j.isPlayer)]);
    const shown = [];
    scene.traverse((o) => { if (!o.visible) { o.visible = true; shown.push(o); } });
    if (async && renderer.compileAsync) {
      warming = true;
      try { await renderer.compileAsync(scene, camera); } catch { /* si falla, warmRender compila igual */ }
      warming = false;
    } else renderer.compile(scene, camera);
    warmRender();
    for (const o of shown) o.visible = false;
    slices.warmEnd();
    for (const w of warmers) w.warmEnd();
  }

  // ------------------------------------------------------------ UI
  // Panel propio (abajo a la izquierda) con todo explicado + lista de rivales (derecha)
  const meEl = document.getElementById('me');
  meEl.style.setProperty('--c', '#' + player.color.getHexString());
  meEl.innerHTML = `
    <div class="me-tag"><span class="nm">${t('you').toUpperCase()}</span></div>
    <div class="me-pts"><b class="pts">0</b><small data-i18n="pts"></small></div>
    <div class="me-stats"><span><b class="ko">0</b><span data-i18n="ko"></span></span><span><b class="falls">0</b><span data-i18n="falls"></span></span></div>
    <div class="gauge stab" data-i18n-title="stabTip"><span class="lbl" data-i18n="stab"></span><div class="tube"><i></i></div><b class="v stabv"></b></div>
    <div class="gauge mass" data-i18n-title="massTip"><span class="lbl" data-i18n="mass"></span><div class="tube"><i></i></div><b class="v massv"></b></div>
    <div class="gauge cd" data-i18n-title="energyTip"><span class="lbl" data-i18n="energy"></span><div class="tube"><i></i><s class="cost"></s></div><b class="v cdv"></b></div>
    <div class="me-bottom">
      <div class="weapon">${['oil', 'spit'].map((t) => `<span class="key ${t}"><kbd data-i18n="k.${t}"></kbd><i>${POWERS[t].icon}</i><b>0</b></span>`).join('')}</div>
      <div class="buffs"></div>
    </div>
`;
  translate(meEl);
  const q = (s) => meEl.querySelector(s);
  player.ui = {
    stab: q('.stab .tube i'), stabv: q('.stabv'), mass: q('.mass .tube i'), massv: q('.massv'), cd: q('.cd .tube i'), cost: q('.cd .cost'), cdv: q('.cdv'),
    ko: q('.ko'), falls: q('.falls'), pts: q('.pts'), buffs: q('.buffs'),
    keys: { oil: q('.key.oil'), spit: q('.key.spit') }, last: {},
  };
  // escribe en la página sólo si cambió (tocar el HUD en cada frame obliga al navegador a recalcular estilos)
  const setText = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  const setStyle = (el, k, v) => { const c = '_' + k; if (el[c] !== v) { el[c] = v; el.style[k] = v; } };
  const setVar = (el, k, v) => { if (el['_' + k] !== v) { el['_' + k] = v; el.style.setProperty(k, v); } };
  const setClass = (el, k, on) => { if (el.classList.contains(k) !== on) el.classList.toggle(k, on); };

  // tabla de posiciones (todos, ordenados por puntaje)
  const rankEl = document.getElementById('rivals');
  rankEl.innerHTML = '<div class="rank-title" data-i18n="ranking"></div>';
  translate(rankEl);
  for (const j of jellies) {
    const el = document.createElement('div');
    el.className = 'rival' + (j.isPlayer ? ' me' : '');
    el.style.setProperty('--c', '#' + j.color.getHexString());
    el.innerHTML = `<span class="pos"></span><i class="blob"></i><span class="n">${j.name}</span><span class="k"></span><b class="s"></b><i class="st"><i></i></i>`;
    rankEl.appendChild(el);
    j.rank = { el, n: el.querySelector('.n'), pos: el.querySelector('.pos'), blob: el.querySelector('.blob'), st: el.querySelector('.st'), k: el.querySelector('.k'), s: el.querySelector('.s') };
  }
  let rankOrder = '';

  const stabColor = (st) => `hsl(${Math.round(st * 1.2)}, 85%, 55%)`;
  // ⚙️ Opciones (Esc): controles, gráficos, sonido e idioma, en una ventanita en el medio (el juego sigue de fondo)
  const options = new Options({
    fps: () => CONFIG.fpsCap,
    setFps: (v) => { CONFIG.fpsCap = v; },
    status: () => ({ hz: adaptive.hz, fps: Math.round(adaptive.target), res: Math.round(adaptive.resScale * 100) }),
    sfx,
    canOpen: () => !inLobby,
    onOpen: () => { input.enabled = false; input.keys.clear(); },
    onClose: () => { input.enabled = !inLobby; },
    onLobby: () => openLobby(),
  });
  const modeEl = document.getElementById('mode');
  const toastEl = document.getElementById('toast');
  let toastTimer = 0;
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1200);
  };
  const updateMode = () => { modeEl.textContent = t(CONFIG.botsAggressive ? 'bots.aggr' : 'bots.passive'); modeEl.classList.toggle('hot', CONFIG.botsAggressive); };
  updateMode();
  onLang(() => {
    updateMode();
    if (arenaName) document.getElementById('arena').textContent = t('arena.' + arenaName);
    player.ui.last.buffs = null; // los títulos de los poderes activos se rearman en el próximo frame
  });

  // ------------------------------------------------------------ ADMIN (tecla H)
  // Todo lo que cambies se guarda solo en este navegador. "Restaurar" vuelve a los valores de fábrica.
  const gui = new GUI({ title: '⚙️ Admin (H)', width: 380 });
  gui.close();
  if (!IS_ADMIN) gui.hide(); // en el juego público no existe (ver env.js)
  document.body.classList.toggle('is-admin', IS_ADMIN);
  const saveCfg = () => { try { const c = {}; for (const k in CONFIG) if (k !== 'arena' && k !== 'bloom' && CONFIG[k] !== DEFAULTS[k]) c[k] = CONFIG[k]; localStorage.setItem(ADMIN_KEY, JSON.stringify(c)); } catch { /* */ } };
  gui.onFinishChange(() => { saveCfg(); calc.update(); });
  gui.add(CONFIG, 'arena', { Cyberpunk: 'cyber', Steampunk: 'steam', Cristal: 'crystal' }).name('Escenario').onChange(loadArenaCovered).listen();
  gui.add(CONFIG, 'botsAggressive').name('Bots agresivos (B)').onChange(updateMode).listen();

  // Gelatinitas (pelotitas) que caen del cielo: "cantidad" escala a la vez cuántas caen y el máximo en el piso
  const fpk = gui.addFolder('🍬 Blobcitos que caen');
  const pkInfo = { get ahora() { return `${pickups.list.length} en el piso (máx. ${Math.round(CONFIG.pickupMax * (arena?.pickupScale ?? 1) * CONFIG.pickupAmount / 100)})`; } };
  fpk.add(CONFIG, 'pickupAmount', 0, 300, 5).name('cantidad (%)');
  fpk.add(pkInfo, 'ahora').name('→ ahora').listen().disable();
  fpk.add(CONFIG, 'pickupInterval', 0.1, 5, 0.05).name('seg. entre una y otra (100%)');
  fpk.add(CONFIG, 'pickupMax', 0, 150, 1).name('máx. en el piso (100%)');
  fpk.add(CONFIG, 'powerChance', 0, 1, 0.01).name('chance de que sea amarilla');

  // Cámara con la que arranca la partida. Acomodala con el mouse (arrastrar + rueda) y apretá "usar la de ahora",
  // o movela con los deslizadores. Se guarda en este navegador como el resto del admin.
  const fpsUI = { get info() { return adaptive.describe(); } };
  gui.add(CONFIG, 'fpsCap', { 'Automático (se adapta a monitor y PC)': 'auto', '60 fijos': '60', 'Sin límite (lo que dé el monitor)': 'off' }).name('🎯 Ritmo de fps');
  gui.add(fpsUI, 'info').name('').disable().listen();
  const fcam = gui.addFolder('🎥 Cámara inicial');
  const camUI = {
    get grados() { return Math.round(THREE.MathUtils.radToDeg(CONFIG.camPitch)); },
    set grados(v) { CONFIG.camPitch = THREE.MathUtils.degToRad(v); },
    get ahora() { return `distancia ${rig.tDist.toFixed(1)} · ángulo ${Math.round(THREE.MathUtils.radToDeg(rig.tPitch))}°`; },
    usarActual() {
      CONFIG.camDist = Math.round(rig.tDist * 2) / 2;
      CONFIG.camPitch = rig.tPitch;
      fcam.controllers.forEach((c) => c.updateDisplay());
      saveCfg();
      toast(`Cámara inicial: ${CONFIG.camDist} · ${camUI.grados}°`);
    },
    ir() { rig.reset(); },
  };
  fcam.add(CONFIG, 'camDist', 15, 90, 0.5).name('distancia (zoom)').onChange((v) => { rig.tDist = v; });
  fcam.add(camUI, 'grados', 5, 85, 1).name('ángulo (°)').onChange(() => { rig.tPitch = CONFIG.camPitch; });
  fcam.add(CONFIG, 'camCenter', 0.5, 1, 0.05).name('centrado (1 = tu blob al medio)');
  fcam.add(CONFIG, 'camFollow', 2, 20, 0.5).name('rapidez para seguirte');
  fcam.add(CONFIG, 'camFov', 25, 80, 1).name('campo visual (°)').onChange((v) => { camera.fov = v; camera.updateProjectionMatrix(); });
  fcam.add(camUI, 'ahora').name('→ cámara de ahora').listen().disable();
  fcam.add(camUI, 'usarActual').name('📸 Usar la cámara de ahora como inicial');
  fcam.add(camUI, 'ir').name('🎯 Ir a la cámara inicial (C)');

  // Calculadora: probá un golpe y mirá el resultado sin jugar
  const calc = {
    atacante: 1, victima: 1, estabilidad: 100, picada: false,
    fuerza: '', vuelo: '', estab: '',
    update() {
      const closing = CONFIG.dashSpeed; // embestida contra alguien quieto
      const r = Sim.hitForce(calc.atacante, calc.victima, 100 - calc.estabilidad, closing, calc.picada, false, false);
      const v = r.K, vy = 3 + v * CONFIG.knockLift;
      const dist = (v * (2 * vy / -CONFIG.gravity)) * 0.8; // vuelo aproximado
      calc.fuerza = `${v.toFixed(1)}${r.raw > CONFIG.knockMax ? ` (topeado, sin tope ${r.raw.toFixed(0)})` : ''} · ${v < 12 ? 'Pum' : v < 20 ? 'FUERTE' : 'BRUTAL'}`;
      calc.vuelo = `≈ ${dist.toFixed(0)} m (arena: ${arena ? arena.R * 2 : '?'} m de ancho)`;
      calc.estab = `-${r.loss} (le queda ${Math.max(0, calc.estabilidad - r.loss)})`;
    },
  };
  const fc = gui.addFolder('🧮 Calculadora de golpe');
  fc.add(calc, 'atacante', 0.6, 60, 0.1).name('masa atacante').onChange(calc.update);
  fc.add(calc, 'victima', 0.6, 60, 0.1).name('masa víctima').onChange(calc.update);
  fc.add(calc, 'estabilidad', 0, 100, 1).name('firmeza víctima').onChange(calc.update);
  fc.add(calc, 'picada').name('en picada (salto+E)').onChange(calc.update);
  fc.add(calc, 'fuerza').name('→ fuerza').listen().disable();
  fc.add(calc, 'vuelo').name('→ vuela').listen().disable();
  fc.add(calc, 'estab').name('→ firmeza').listen().disable();

  const fd = gui.addFolder('💥 Fuerza de los golpes');
  fd.add(CONFIG, 'knockBase', 0, 20).name('fuerza base');
  fd.add(CONFIG, 'knockScale', 0, 1.5).name('extra por velocidad');
  fd.add(CONFIG, 'massExp', 0, 1.5, 0.05).name('peso de la diferencia de masa');
  fd.add(CONFIG, 'knockMax', 10, 200, 1).name('TOPE de fuerza');
  fd.add(CONFIG, 'knockLift', 0, 0.6, 0.01).name('cuánto levanta');
  fd.add(CONFIG, 'airDashBonus', 1, 3).name('bonus en picada');
  fd.add(CONFIG, 'strengthMul', 1, 3).name('bonus poder Fuerza');
  const fst = gui.addFolder('🛡️ Firmeza');
  fst.add(CONFIG, 'instPerHit', 0, 50).name('cuánto saca un golpe');
  fst.add(CONFIG, 'instMassExp', 0, 1.5, 0.05).name('peso de la masa en eso');
  fst.add(CONFIG, 'instKnock', 0, 6).name('vuelo extra con estab. 0');
  fst.add(CONFIG, 'stabRegenDelay', 0, 10).name('seg. sin golpes p/ recuperar');
  fst.add(CONFIG, 'stabRegenTime', 5, 180).name('seg. para recuperar toda');
  fst.add(CONFIG, 'dazeForce', 0, 60).name('fuerza para marear');
  fst.add(CONFIG, 'dazeMin', 0, 5).name('mareo mín (s)'); fst.add(CONFIG, 'dazeMax', 0, 8).name('mareo máx (s)');
  fst.add(CONFIG, 'stunBase', 0, 1).name('aturdido base (s)'); fst.add(CONFIG, 'stunPerForce', 0, 0.1).name('aturdido por fuerza');
  const fe = gui.addFolder('⚡ Energía y embestida');
  fe.add(CONFIG, 'dashEnergy', 0, 100, 1).name('energía por embestida');
  fe.add(CONFIG, 'sprintEnergy', 0, 100, 1).name('energía/s corriendo');
  fe.add(CONFIG, 'energyRegen', 0, 100, 1).name('recarga/s');
  fe.add(CONFIG, 'dashSpeed', 8, 40).name('velocidad embestida'); fe.add(CONFIG, 'dashTime', 0.05, 0.5).name('duración embestida');
  fe.add(CONFIG, 'dashWindup', 0, 0.3, 0.01).name('carga antes de embestir (s)');
  fe.add(CONFIG, 'dashCooldown', 0, 4).name('espera entre embestidas');
  const fm = gui.addFolder('🏃 Movimiento');
  fm.add(CONFIG, 'moveSpeed', 3, 20).name('velocidad'); fm.add(CONFIG, 'groundAccel', 10, 150).name('agarre en piso'); fm.add(CONFIG, 'airAccel', 0, 80).name('control en el aire');
  fm.add(CONFIG, 'gravity', -60, -10).name('gravedad').onChange((v) => { world.gravity = { x: 0, y: v, z: 0 }; });
  fm.add(CONFIG, 'jumpVel', 5, 20).name('salto'); fm.add(CONFIG, 'sprintMul', 1, 2.5).name('multiplicador correr');
  const fmass = gui.addFolder('⚖️ Masa');
  fmass.add(CONFIG, 'pickupMass', 0, 0.6).name('masa por blobcito');
  fmass.add(CONFIG, 'speedMassExp', 0, 0.6).name('cuánto frena la masa');
  const fpw = gui.addFolder('⭐ Poderes y peligros');
  fpw.add(CONFIG, 'buffTime', 1, 120, 1).name('duración poderes (s)');
  fpw.add(CONFIG, 'oilLife', 1, 120, 1).name('duración aceite (s)'); fpw.add(CONFIG, 'oilRadius', 0.5, 6).name('tamaño aceite');
  fpw.add(CONFIG, 'oilCharges', 1, 10, 1).name('manchas por bolita'); fpw.add(CONFIG, 'oilThrowDist', 1, 15).name('aceite: metros detrás tuyo');
  fpw.add(CONFIG, 'spitCharges', 1, 10, 1).name('chorros por bolita'); fpw.add(CONFIG, 'spitSpeed', 10, 80).name('velocidad del chorro');
  fpw.add(CONFIG, 'spitRange', 5, 60).name('alcance puntería del chorro'); fpw.add(CONFIG, 'spitKnock', 0, 30).name('empujón del chorro');
  fpw.add(CONFIG, 'impaleTime', 0.5, 6).name('segundos clavado');
  fpw.add(CONFIG, 'wallSplat').name('reventar contra muros'); fpw.add(CONFIG, 'splatImpulse', 8, 60).name('fuerza p/ reventar');
  const fsc = gui.addFolder('🏆 Puntaje');
  fsc.add(CONFIG, 'koPoints', 0, 500, 10).name('pts por KO (igual tamaño)');
  fsc.add(CONFIG, 'koSizeExp', 0, 2, 0.05).name('peso de la diferencia de tamaño');
  fsc.add(CONFIG, 'alivePoints', 0, 10, 0.5).name('pts por segundo vivo');
  const fs = gui.addFolder('🫧 Blob (piel)');
  fs.add(CONFIG, 'skinStiffness', 30, 500).name('firmeza'); fs.add(CONFIG, 'skinDamping', 0, 30).name('amortiguación'); fs.add(CONFIG, 'skinCoupling', 0, 300).name('contagio de ondas');
  fs.add(CONFIG, 'skinInertia', 0, 1.5).name('bamboleo'); fs.add(CONFIG, 'dentDepth', 0, 0.1).name('abolladuras'); fs.add(CONFIG, 'squashAmount', 0, 0.2).name('aplastado');
  fs.add(CONFIG, 'shake', 0, 1.5).name('temblor de cámara'); fs.add(CONFIG, 'bloom').name('brillo (bloom)');
  const test = {
    botMass: 1,
    normal() { player.mass = 1; for (const j of jellies) if (!j.isPlayer) j.mass = 1; test.botMass = 1; },
    restaurar() {
      if (!confirm('¿Volver todos los ajustes a los valores de fábrica?')) return;
      Object.assign(CONFIG, DEFAULTS, { arena: CONFIG.arena });
      try { localStorage.removeItem(ADMIN_KEY); } catch { /* */ }
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      world.gravity = { x: 0, y: CONFIG.gravity, z: 0 };
      camera.fov = CONFIG.camFov; camera.updateProjectionMatrix(); rig.reset();
      calc.update(); toast('Ajustes de fábrica');
    },
    copiar() {
      const c = { ...CONFIG }; delete c.arena;
      navigator.clipboard?.writeText(JSON.stringify(c, null, 2)).then(() => toast('Ajustes copiados'), () => toast('No se pudo copiar'));
    },
  };
  const fp = gui.addFolder('🧪 Pruebas');
  fp.add(player, 'mass', 0.3, 60, 0.1).name('Masa tuya (+/-)').listen();
  fp.add(test, 'botMass', 0.3, 60, 0.1).name('Masa bots').onChange((v) => { for (const j of jellies) if (!j.isPlayer) j.mass = v; });
  fp.add(test, 'normal').name('Todos a masa 1');
  const sounds = buildSoundFolder(gui, toast); // 🔊 Sonidos: probar, reemplazar y copiar el prompt de cada uno
  loadSoundOverrides().then(() => sounds.refresh());
  gui.add(test, 'copiar').name('📋 Copiar ajustes (JSON)');
  gui.add(test, 'restaurar').name('↺ Restaurar valores de fábrica');
  for (const f of [fpk, fcam, fd, fst, fe, fm, fmass, fpw, fsc, fs, fp]) f.close();
  calc.update();

  // ------------------------------------------------------------ input
  const input = new Input();
  input.on('KeyM', () => { sfx.muted = !sfx.muted; });
  // atajos de prueba: sólo en la página del admin
  if (IS_ADMIN) {
    input.on('KeyB', () => { CONFIG.botsAggressive = !CONFIG.botsAggressive; updateMode(); });
    input.on('KeyH', () => (gui._hidden ? gui.show() : gui.hide()));
    input.on('KeyI', () => perf.toggle());
    input.on('KeyR', () => loadArenaCovered(CONFIG.arena));
  }
  input.on('KeyC', () => { rig.reset(); toast(t('toast.cam', { n: t('cam.game') })); });
  input.on('KeyV', () => toast(t('toast.cam', { n: t('cam.' + rig.cycle()) })));
  // pruebas: hacer crecer/encoger a tu gelatina
  const setPlayerMass = (m) => {
    player.mass = Math.max(0.3, m);
    player.squashVel += 4;
    toast(t('toast.mass', { m: player.mass.toFixed(1) }));
  };
  if (IS_ADMIN) {
    for (const k of ['+', '=']) input.onKey(k, () => setPlayerMass(player.mass + 0.5));
    for (const k of ['-', '_']) input.onKey(k, () => setPlayerMass(player.mass - 0.5));
    for (const [code, name] of Object.entries(ARENA_KEYS)) input.on(code, () => loadArenaCovered(name));
  }

  // ------------------------------------------------------------ tutorial
  // Arena chiquita, el jugador y una gelatina de práctica que no hace nada: espera en la diana, lo mira y, si la
  // sacás de lugar, vuelve sola caminando despacito (y se le resetea la estabilidad, así no sale volando lejos).
  const tutorial = new Tutorial({
    drop: (x, z, power, h) => pickups.drop(x, z, power, h),
    sfx,
    onPlay: () => { endTutorial(); loadArenaCovered(CONFIG.arena); rig.reset(); },
    onMenu: () => { if (tutorial.step) telemetry.track('tutorial', { state: 'skip', step: tutorial.i + 1 }); openLobby(); },
  });
  tutorial.onStep = (i, id) => telemetry.track('tutorial', id ? { state: 'step', step: `${i + 1} ${id}` } : { state: 'done' });
  player.onAction = (kind) => tutorial.action(kind);
  async function startTutorial() {
    telemetry.track('tutorial', { state: 'start' });
    if (arenaName === 'tutorial') resetMatch(); else await loadArenaCovered('tutorial');
    for (const j of jellies) j.dummy = false;
    const dummy = jellies[1];
    dummy.dummy = true;
    rig.reset();
    tutorial.start(player, dummy);
  }
  function endTutorial() {
    if (!tutorial.active) return;
    tutorial.stop();
    for (const j of jellies) j.dummy = false;
  }

  // ------------------------------------------------------------ loop
  function fixedStep(doSkin = true) {
    const pc = input.command();
    input.consumeEdges(pc);
    input.mashCount = 0; // (ya no se acorta el mareo apretando teclas)
    [pc.mx, pc.mz] = rig.toWorld(pc.mx, pc.mz); // flechas relativas a la cámara
    if (online.active) { const t0 = performance.now(); online.step(pc, doSkin); perf.add('online', performance.now() - t0); return; }
    sim.step((j) => (j === player ? pc : null), { doSkin, perfAdd: (k, ms) => perf.add(k, ms) });
  }

  // la arena se arma recién al salir de la pantalla de inicio (con la pantalla de carga encima)

  // ------------------------------------------------------------ pantalla de inicio (color + tatuaje)
  let inLobby = false;
  const lobby = new Lobby(document.getElementById('lobby'), {
    track: (k, d) => telemetry.track(k, d),
    // "auto" arranca en el nivel que corresponde al aparato y baja solo si hace falta
    onStart(look) {
      inLobby = false;
      player.away = false;
      input.enabled = true;
      document.body.classList.remove('in-lobby');
      player.name = look.name;
      player.setShape(look.shape);
      player.setLook({ color: look.color, tattoo: look.tattoo });
      const hex = '#' + player.color.getHexString();
      meEl.style.setProperty('--c', hex);
      meEl.querySelector('.me-tag .nm').textContent = look.name.toUpperCase();
      player.rank.el.style.setProperty('--c', hex);
      player.rank.n.textContent = look.name;
      if (look.tutorial) { gameMode = 'ffa'; startTutorial(); return; }
      gameMode = look.mode === 'teams' ? 'teams' : 'ffa';
      // las partidas son en línea: entrar a una sala del servidor
      goOnline(look);
    },
  });
  const openLobby = () => {
    endTutorial();
    if (inLobby) return;
    telemetry.endMatch('lobby');
    if (online.active) { online.leave(); afterOnline(); }
    inLobby = true;
    input.enabled = false;
    input.keys.clear();
    document.body.classList.add('in-lobby');
    player.kill();
    player.away = true; // fuera de la partida hasta que arranques (los bots siguen jugando de fondo)
    player.respawnAt = Infinity;
    rig.set(CAM_PRESETS[2]);
    lobby.open();
  };
  input.on('KeyP', openLobby);

  // ------------------------------------------------------------ en línea (salas del servidor, ver net/online.js)
  let connecting = false;
  const joinRoom = params.get('room'); // el admin entra a una sala elegida (desde el panel de salas)
  const online = new Online(sim, {
    slice: (j, normal, along) => slices.cut(j, normal, along),
    shake: (a) => { shake = Math.max(shake, a); },
    teamEvent: (type, d) => {
      teamsHUD.onEvent(type, d, player.team);
      if (type === 'count') sfx[d.n > 0 ? 'use' : 'power']();
      if (type === 'roundEnd') telemetry.track('round', { round: d.round, win: d.w === player.team ? 1 : 0, draw: d.w < 0 ? 1 : 0 });
    },
    roster: () => refreshRank(),
    lost: () => { toast(t('net.lost')); telemetry.endMatch('lost'); afterOnline(); openLobby(); },
  });

  // nombres y colores de la tabla (en línea cambian cuando entra o sale alguien)
  function refreshRank() {
    for (const j of jellies) {
      if (!j.rank) continue;
      j.rank.n.textContent = j.name;
      j.rank.el.style.setProperty('--c', '#' + j.color.getHexString());
      j.rank.el.style.display = j.benched ? 'none' : '';
      j.rank.el.classList.toggle('tA', j.team === 0);
      j.rank.el.classList.toggle('tB', j.team === 1);
      j.rank.el.classList.toggle('human', !!j.human && j !== player);
    }
    meEl.style.setProperty('--c', '#' + player.color.getHexString());
  }

  // a quién mira la cámara cuando te sacaron en equipos: el compañero vivo con más puntos
  function spectateTarget() {
    if (!online.active) return teams.spectate(player);
    if (!player.dead || player.team == null || !online.tm?.active) return null;
    let best = null;
    for (const j of jellies) if (j !== player && !j.dead && !j.benched && j.team === player.team && (!best || j.score > best.score)) best = j;
    return best;
  }

  async function goOnline(look) {
    connecting = true;
    loadingText.textContent = t('net.connecting');
    loadingEl.classList.add('show');
    await nextFrame(); await nextFrame();
    try {
      // la arena se arma acá también (para dibujarla y para que tu blob choque con ella); por ahora todas las salas son Steampunk
      if (arenaName !== 'steam') {
        const keep = gameMode; gameMode = 'ffa';
        loadArena('steam', false);
        gameMode = keep;
        await warmAll(true);
      }
      await online.connect({ mode: gameMode, look: { name: look.name, color: look.color, shape: look.shape, brow: player.browBase, tattoo: look.tattooURL }, room: joinRoom });
      player.away = false;
      refreshRank();
      rig.reset();
      telemetry.startMatch({ mode: gameMode, arena: 'steam', team: player.team, name: player.name });
      toast(t('toast.welcome', { name: look.name }));
      coverFrames = 8;
      adaptive.holdFor(3);
    } catch (e) {
      afterOnline();
      if (e.message === 'full') { loadingEl.classList.remove('show'); toast(t('net.full')); openLobby(); return; }
      // el servidor tiene una versión nueva del juego: se recarga la página (una vez; si vuelve a pasar enseguida,
      // se sigue sin conexión, para no quedar recargando)
      if (e.message === 'old') {
        let recent = false;
        try { recent = Date.now() - Number(sessionStorage.getItem('gelatinas.reloadAt') || 0) < 60000; sessionStorage.setItem('gelatinas.reloadAt', String(Date.now())); } catch { /* sin sessionStorage */ }
        if (!recent) { location.reload(); return; }
      }
      // el servidor no responde: se juega igual, contra bots y sin conexión (mejor que quedarse afuera)
      telemetry.track('net_fail', { reason: String(e.message).slice(0, 20) });
      if (arenaName !== CONFIG.arena) await loadArenaCovered(CONFIG.arena); else { resetMatch(); coverFrames = 8; }
      player.away = false;
      rig.reset();
      toast(t('net.offline'));
    } finally {
      connecting = false;
    }
  }

  // al salir de la sala: la partida local vuelve (bots de fondo detrás del menú)
  function afterOnline() {
    online.stop();
    gameMode = 'ffa';
    if (arena) { resetMatch(); refreshRank(); }
  }

  // ---- celular / tablet: controles en pantalla (también si el primer toque es con el dedo)
  let touchUI = null;
  const enableTouch = () => {
    if (touchUI) return;
    touchUI = new TouchControls(input, { onMenu: () => { if (!inLobby) openLobby(); } });
    document.body.classList.add('touch');
    gui.hide();
  };
  if (isTouch()) enableTouch();
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enableTouch(); });
  // Safari: que pellizcar o tocar dos veces no haga zoom de la página
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault());
  openLobby();

  perf.ctxFn = () => ({
    arena: arenaName, online: online.active ? { room: online.room?.id, rtt: Math.round(online.rtt * 1000), snapMs: online.takeNetMs(), queue: online.stats.queue, scale: +online.timeScale.toFixed(3), corr: online.stats.corrN ? +(online.stats.corr / online.stats.corrN).toFixed(2) : 0, hitsPred: online.stats.predicted, hitsConfirmed: online.stats.confirmed, hitsUnpred: online.stats.unpredicted, pickups: pickups.list.length } : null, fpsCap: CONFIG.fpsCap, monitorHz: adaptive.hz, fpsTarget: Math.round(adaptive.target * 10) / 10, resScale: adaptive.resScale, bloom: CONFIG.bloom, inLobby, tutorial: tutorial.active, quality: Q.level, qualityAuto: Q.auto, touch: !!touchUI,
    jellies: jellies.filter((j) => !j.dead).length, onScreen: jellies.filter((j) => !j.dead && !j.offscreen).length,
    pickups: pickups.list.length, oilSlicks: oil.list.length, slices: slices.list.length, shots: shots.list.length,
  });
  telemetry.statsFn = () => ({
    score: Math.floor(player.score), kos: player.kos, falls: player.falls, maxMass: +(player.maxMass || 1).toFixed(1),
    won: teams.active ? teams.wins[player.team] : undefined, lost: teams.active ? teams.wins[1 - player.team] : undefined,
  });
  perf.onReport = (rep) => telemetry.perf({ ...rep, fpsTarget: adaptive.target, resScale: adaptive.resScale, hz: adaptive.hz, lateRate: adaptive.lateRate, win: `${innerWidth}x${innerHeight}@${devicePixelRatio}` }, !inLobby && !!arena);
  telemetry.netFn = () => online.auditReport();
  // dónde escuchás: tu blob (o adonde mira la cámara si estás afuera); en el menú y el tutorial, todo igual
  ear.me = player;
  ear.pos = () => (inLobby || tutorial.active ? null : player.dead ? rig.target : player.pos); // en línea: cómo anduvo la red cada minuto (ping, correcciones, golpes fantasma)
  {
    const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    telemetry.start({
      name: player.name, lang: getLang(), screen: `${screen.width}x${screen.height}`, ref: document.referrer ? new URL(document.referrer).hostname : null,
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
    });
  }
  const camFocus = new THREE.Vector3();
  const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4();
  let last = performance.now(), acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!adaptive.tick(now, CONFIG.fpsCap)) return; // ritmo automático (ver adaptive.js)
    const t0 = performance.now();
    perf.begin(now);
    // nunca negativo: el reloj de los frames puede arrancar un toque antes que performance.now()
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    if (!arena) { renderer.clear(); return; } // todavía en la pantalla de inicio, sin arena armada
    if (warming) { acc = 0; return; } // compilando materiales tapado por la pantalla de carga
    // en el menú la arena no se ve (el fondo del menú es opaco): no se simula ni se dibuja nada. Antes seguía la
    // partida entera de fondo (16 bots, física, piel, dibujo) y en una PC lenta el menú se pintaba a los tirones
    if (inLobby && !loadingEl.classList.contains('show')) { acc = 0; return; }

    // sin congelamientos: la simulación nunca se pausa (pensado para multiplayer)
    acc += dt * (online.active ? online.timeScale : 1); // en línea: ritmo apenas ajustado (ver online.js timeScale)
    // después de un trabón se hacen varios pasos seguidos para alcanzar: la piel (sólo visual) se
    // simula en los 2 primeros nada más, así un trabón no arrastra a los siguientes frames
    for (let k = 0; acc >= STEP; k++) { fixedStep(k < 2); acc -= STEP; perf.t.steps++; }
    online.sendInput(); // en línea: tus teclas al servidor (una vez por frame)
    perf.lap('sim');
    const alpha = acc / STEP;
    // las gelatinas fuera de cámara no recalculan su forma (cámara del frame anterior, con margen)
    _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const j of jellies) j.render(alpha, jellies, inLobby ? null : _frustum);
    faces.sync();
    perf.lap('skin');

    fx.update(dt);
    oil.update(dt);
    slices.update(dt);
    shots.update(dt);
    arena.update(sim.time, dt);

    // cámara: sigue al jugador y se aleja un poco cuando crece
    // muerto: la cámara se queda mirando donde caíste (no se va al centro)
    if (inLobby) camFocus.set(0, 0, 0);
    else if (!player.dead) camFocus.copy(player.renderPos).multiplyScalar(CONFIG.camCenter).setY(0); // 1 = tu gelatina en el centro
    else if (spectateTarget()) camFocus.lerp(_p.copy(spectateTarget().renderPos).setY(0), 1 - Math.exp(-4 * dt)); // equipos: miras a un compañero
    else camFocus.lerp(_p.set(player.pos.x, 0, player.pos.z), 1 - Math.exp(-3 * dt)); // se acerca a donde moriste
    const desired = _p.copy(camFocus);
    if (inLobby) rig.tYaw += dt * 0.06; // de fondo: la arena girando despacito
    rig.shake = Math.max(rig.shake, shake);
    shake = 0;
    rig.update(dt, desired, 1 + (player.size - 1) * 0.35);
    sun.position.set(rig.target.x + 8, 30, rig.target.z + 10);
    sun.target.position.copy(rig.target);

    tutorial.update(dt);
    {
      const ts = online.active ? online.teamState() : teams.state();
      const watch = spectateTarget();
      teamsHUD.update(dt, ts, ts?.active && player.dead && ts.phase === 'play' ? t('tm.waiting', { name: watch ? watch.name : '…' }) : '');
    }

    // HUD
    {
      const u = player.ui, st = player.dead ? 0 : Math.round(100 - player.damage);
      setStyle(u.stab, 'transform', `translateX(${st - 100}%)`);
      setVar(u.stab, '--f', stabColor(st));
      setText(u.stabv, player.dead ? '—' : String(st));
      // sin tope de masa: la barra compara con la gelatina más grande de la sala (escala logarítmica)
      const biggest = Math.max(4, ...jellies.map((o) => (o.dead ? 0 : o.mass)));
      const mp = Math.round(Math.min(100, (Math.log(player.mass / CONFIG.massMin) / Math.log(biggest / CONFIG.massMin)) * 100));
      setStyle(u.mass, 'transform', `translateX(${mp - 100}%)`);
      setText(u.massv, `x${player.mass.toFixed(1)}`);
      if (player.mass > (player.maxMass || 0)) player.maxMass = player.mass;
      setClass(meEl, 'sprint', player.sprinting);
      const cost = CONFIG.dashEnergy;
      const ready = player.dashCd <= 0 && player.energy >= cost;
      const en = Math.round(player.energy);
      setStyle(u.cd, 'transform', `translateX(${en - 100}%)`);
      setText(u.cdv, String(en));
      setStyle(u.cost, 'left', `${cost}%`);
      setClass(meEl, 'ready', ready);
      setClass(meEl, 'isdazed', player.daze > 0);
      setText(u.ko, String(player.kos));
      setText(u.falls, String(player.falls));
      setText(u.pts, String(Math.floor(player.score)));
      for (const t of ['oil', 'spit']) {
        const k = u.keys[t], n = player.ammo[t];
        setClass(k, 'on', n > 0);
        setText(k.lastChild, String(n));
      }
      touchUI?.update(player.ammo);
      // poderes activos: un círculo por poder, con el tiempo que le queda
      const bl = [];
      for (const k of ['turbo', 'strength']) if (player.buffs[k] > 0) bl.push(`<span class="buff" style="--p:${(player.buffs[k] / CONFIG.buffTime).toFixed(2)}" title="${t('power.' + k)}"><i>${POWERS[k].icon}</i><b>${Math.ceil(player.buffs[k])}</b></span>`);
      if (player.oilT > 0) bl.push(`<span class="buff slip" style="--p:1" title="${t('slip')}"><i>🛢️</i></span>`);
      const bh = bl.join('');
      if (bh !== u.last.buffs) { u.buffs.innerHTML = bh; u.last.buffs = bh; }
    }
    // ranking
    const sorted = jellies.filter((j) => !j.benched).sort((a, b) => b.score - a.score);
    const order = sorted.map((j) => j.name).join();
    if (order !== rankOrder) { rankOrder = order; for (const j of sorted) rankEl.appendChild(j.rank.el); }
    sorted.forEach((j, i) => {
      const r = j.rank, st = j.dead ? 0 : 100 - j.damage;
      setText(r.pos, String(i + 1));
      for (let p = 1; p <= 3; p++) setClass(r.el, 'p' + p, i + 1 === p);
      setVar(r.st, '--st', (Math.round(st) / 100).toFixed(2));
      setVar(r.blob, '--s', Math.min(1.45, 0.7 + 0.25 * Math.log2(1 + j.mass)).toFixed(2)); // más grande = más masa
      setText(r.k, j.kos ? `${j.kos} KO` : '');
      setText(r.s, String(Math.floor(j.score)));
      setClass(r.el, 'out', j.dead);
      setClass(r.el, 'isdazed', j.daze > 0);
    });

    perf.lap('fx'); // efectos, cámara y HUD
    perf.gpuBegin();
    if (CONFIG.bloom) composer.render();
    else renderer.render(scene, camera);
    perf.gpuEnd();
    perf.lap('draw');
    if (coverFrames > 0 && --coverFrames === 0) loadingEl.classList.remove('show');
    perf.end();
    // la resolución se adapta siempre; el nivel de calidad, sólo si está en Auto (si lo elegiste a mano, se respeta)
    adaptive.frameDone(performance.now() - t0, perf.gpuExt ? perf.gpuLast : null,
      !inLobby && coverFrames === 0 && !loadingEl.classList.contains('show'), Q.auto);
  }
  requestAnimationFrame(frame);
  loadingEl.classList.remove('show'); // lo que se ve al abrir la página, hasta que aparece la pantalla de inicio
}

main();
