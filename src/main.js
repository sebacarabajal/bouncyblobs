import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { CONFIG } from './config.js';
import { Jelly, R } from './jelly.js';
import { Input } from './input.js';
import { fx } from './fx.js';
import { sfx } from './sfx.js';
import { FaceBatch } from './facebatch.js';
import { Adaptive } from './adaptive.js';
import { loadSoundOverrides } from './sfx.js';
import { buildSoundFolder } from './sfxadmin.js';
import { Options } from './options.js';
import { Teams } from './teams.js';
import { IS_ADMIN } from './env.js';
import { telemetry } from './telemetry.js';
import { Pickups } from './pickups.js';
import { CameraRig, CAM_PRESETS } from './camera.js';
import { POWERS, OilSlicks } from './powers.js';
import { Lobby } from './lobby.js';
import { Slices } from './slice.js';
import { Projectiles } from './projectiles.js';
import { PerfMonitor } from './perf.js';
import { Q, ORDER, isTouch, saveQuality, refreshGlass } from './quality.js';
import { TouchControls } from './touch.js';
import { t, translate, onLang, getLang } from './i18n.js';
import { preloadBackdrops, onLateAsset } from './arenas/common.js';
import { buildCyber } from './arenas/cyber.js';
import { buildSteam } from './arenas/steam.js';
import { buildCrystal } from './arenas/crystal.js';
import { buildTutorial, DUMMY_HOME } from './arenas/tutorial.js';
import { Tutorial } from './tutorial.js';

const STEP = 1 / 120;
const ARENAS = { cyber: buildCyber, steam: buildSteam, crystal: buildCrystal };
const BUILDERS = { ...ARENAS, tutorial: buildTutorial }; // el tutorial no aparece en los selectores de arena
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

  // ------------------------------------------------------------ física
  const world = new RAPIER.World({ x: 0, y: CONFIG.gravity, z: 0 });
  world.timestep = STEP;

  const defs = [
    { name: t('you'), color: '#ff4fa3', shape: 'round', brow: 0.35, isPlayer: true, spawn: [0, 0, 5] },
    { name: 'Limón', color: '#ffc21a', shape: 'round', brow: 0.45, spawn: [-6, 0, -3] },
    { name: 'Celeste', color: '#2fc8ff', shape: 'tall', brow: -0.15, spawn: [6, 0, -3] },
    { name: 'Uva', color: '#a24dff', shape: 'drop', brow: 0.5, spawn: [0, 0, -8] },
    { name: 'Lima', color: '#7be22a', shape: 'bean', brow: 0.2, spawn: [-8, 0, 4] },
    { name: 'Mandarina', color: '#ff7a1a', shape: 'drop', brow: 0.55, spawn: [8, 0, 4] },
    { name: 'Arándano', color: '#3d6bff', shape: 'tall', brow: 0.3, spawn: [-4, 0, 9] },
    { name: 'Menta', color: '#22e0b4', shape: 'box', brow: 0.4, spawn: [4, 0, 9] },
    { name: 'Frutilla', color: '#ff2f4f', shape: 'round', brow: 0.5, spawn: [-10, 0, -8] },
    { name: 'Kiwi', color: '#9bd400', shape: 'box', brow: 0.1, spawn: [10, 0, -8] },
    { name: 'Coco', color: '#f2ece0', shape: 'bean', brow: 0.3, spawn: [-11, 0, 0] },
    { name: 'Mora', color: '#c0137a', shape: 'box', brow: 0.6, spawn: [11, 0, 0] },
    // las 4 de abajo sólo juegan en arenas grandes (arena.players, ej. Steampunk = 16)
    { name: 'Chocolate', color: '#7a4428', shape: 'tall', brow: 0.4, spawn: [-14, 0, 6] },
    { name: 'Durazno', color: '#ffb18a', shape: 'bean', brow: 0.2, spawn: [14, 0, 6] },
    { name: 'Ciruela', color: '#4b1d84', shape: 'bean', brow: 0.5, spawn: [-14, 0, -6] },
    { name: 'Pistacho', color: '#b8c97a', shape: 'drop', brow: 0.3, spawn: [14, 0, -6] },
  ];
  const jellies = defs.map((d) => new Jelly({
    ...d,
    scene,
    world,
    spawn: new THREE.Vector3(d.spawn[0], R + 0.05, d.spawn[2]),
    yaw: d.isPlayer ? 0 : Math.atan2(-d.spawn[0], -d.spawn[2]),
  }));
  const player = jellies[0];
  const faces = new FaceBatch(scene, jellies); // caras de todas en pocos dibujos
  // modo de juego: 'ffa' (todos contra todos, se reaparece) o 'teams' (Azul vs Rojo por rondas, ver teams.js)
  let gameMode = 'ffa';
  const teams = new Teams(jellies, {
    onNewRound: () => {
      // ronda nueva: todos vuelven a su mitad de la arena, con masa 1 (los puntos siguen)
      pickups.clear(); oil.clear(); shots.clear();
      for (const j of jellies) if (!j.benched && !(inLobby && j.isPlayer)) j.respawn(spawnPoint(j));
    },
  });
  const isEnemy = (a, b) => teams.isEnemy(a, b);
  teams.onRoundEnd = (w) => telemetry.track('round', { round: teams.round, win: w === player.team ? 1 : 0, draw: w < 0 ? 1 : 0 });
  // cada partida al mejor de 5 es una "partida" en las analíticas
  teams.onSeriesEnd = () => telemetry.endMatch('series');
  teams.onCount = (n) => (n > 0 ? sfx.use() : sfx.power()); // 3, 2, 1 · ¡YA!
  teams.onSeriesStart = () => { if (!inLobby) telemetry.startMatch({ mode: 'teams', arena: arenaName, team: player.team, name: player.name }); };
  const pickups = new Pickups(scene);
  const oil = new OilSlicks(scene);
  const slices = new Slices(scene);
  const shots = new Projectiles(scene, world);
  shots.friendly = (owner, j) => !teams.isEnemy(owner, j);
  oil.friendly = (owner, j) => !teams.isEnemy(owner, j);

  // ------------------------------------------------------------ estado de juego
  let time = 0;
  let shake = 0;
  let arena = null;
  const _n = new THREE.Vector3();
  const _p = new THREE.Vector3();

  function spawnPoint(j) {
    if (arena.spawnAt) return arena.spawnAt(j); // tutorial: cada una en su lugar
    const tp = teams.spawnFor(j); // equipos: formación de cada equipo
    if (tp) return tp;
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * arena.R * 0.45;
      _p.set(Math.cos(a) * r, 10, Math.sin(a) * r);
      if (!arena.floorAt(_p.x, _p.z)) continue;
      if (arena.spawnOk && !arena.spawnOk(_p.x, _p.z)) continue; // lejos de las sierras, pozos, géiseres…
      if (jellies.every((o) => o === j || o.dead || Math.hypot(o.pos.x - _p.x, o.pos.z - _p.z) > 3.5)) break;
    }
    return _p.clone();
  }

  // Puntos por KO según tamaños: noquear a uno más grande que vos vale más (y a uno chiquito, menos).
  // pts = koPoints × (masa víctima / masa tuya)^koSizeExp  → x1 vs x4 ≈ 283 · x4 vs x1 ≈ 35
  const koValue = (killer, victim) => {
    const f = Math.pow(victim.mass / killer.mass, CONFIG.koSizeExp);
    return Math.round(CONFIG.koPoints * THREE.MathUtils.clamp(f, 0.25, 10));
  };

  // El KO se reparte entre quien te pegó (últimos 6 s) y quien abrió la trampa en la que caíste (pozo).
  // Si son dos distintos, cada uno se lleva la mitad de sus puntos.
  function creditKO(victim) {
    // quién lo sacó: el más reciente entre el último golpe (6 s), el último empujón (3 s) y el aceite que pisó (4 s)
    let by = null, at = -Infinity;
    for (const [who, when, win] of [[victim.lastHitBy, victim.lastHitTime, 6], [victim.pushBy, victim.pushTime, 3], [victim.slipBy, victim.slipTime, 4]]) {
      if (who && who !== victim && isEnemy(who, victim) && time - when < win && when > at) { by = who; at = when; }
    }
    const killers = by ? [by] : [];
    const trap = victim.trapBy;
    if (trap && trap !== victim && isEnemy(trap, victim) && time - victim.trapTime < 3 && !killers.includes(trap)) killers.push(trap);
    for (const killer of killers) {
      killer.kos++;
      const pts = Math.round(koValue(killer, victim) / killers.length);
      killer.score += pts;
      const upset = victim.mass / killer.mass >= 1.5;
      if (!killer.dead) fx.popup(killer.pos.clone().setY(killer.pos.y + 2.4 * killer.size), `+${pts} ${t('pts').toLowerCase()}${upset ? ' 🏆' : ''}`, upset ? '#ffd21a' : '#7dff8a', true);
    }
    perf.event('KO');
    victim.falls++;
    victim.respawnAt = time + 1.4;
  }

  // API que usan las arenas para sus peligros
  const game = {
    jellies,
    get time() { return time; },
    shake(a) { shake = Math.max(shake, a); },
    splat(j, normal, point, label = '💥') {
      if (j.dead) return;
      perf.event('splat');
      fx.burst(point, j.color, 45, 9, normal, 0.14 * j.size);
      fx.puddle(point, normal, j.color, 1.4 * j.size);
      fx.ring(point, normal, j.color, 4);
      fx.popup(point.clone().setY(point.y + 1.5), label, '#' + j.color.getHexString(), true);
      sfx.splat();
      shake = Math.max(shake, CONFIG.shake * 2);
      j.kill();
      creditKO(j);
    },
    // sierra: la parte al medio
    slice(j, { normal, along, point }) {
      if (j.dead) return;
      perf.event('corte sierra');
      slices.cut(j, normal, along);
      fx.popup(point.clone().setY(point.y + 2 * j.size), '🪚', '#' + j.color.getHexString(), true);
      sfx.slice();
      shake = Math.max(shake, 0.6);
      j.kill();
      creditKO(j);
      j.respawnAt = time + 3.4; // tiempo para ver cómo quedaste partido
    },
    // clavado en pinches: queda pataleando unos segundos y después revienta
    // t: segundos clavado antes de reventar (los pinches del piso son más rápidos)
    impale(j, center, inward, t = CONFIG.impaleTime) {
      if (j.dead || j.impaled) return;
      perf.event('clavado');
      j.impale(center, inward, t);
      j.impaleN = inward.clone();
      fx.burst(center.clone().addScaledVector(inward, -j.r), j.color, 18, 5, inward, 0.1);
      sfx.stab();
      shake = Math.max(shake, 0.5);
    },
    hazardHit(j, { vx, vy, vz, stun, dmg = 0, color, sound, point }) {
      const mult = (1 + (CONFIG.instKnock * j.damage) / 100) / Math.pow(j.mass, 0.35);
      const k = Math.min(1.8, 0.6 + 0.4 * mult);
      j.knockback(vx * k, vy, vz * k, stun);
      if (dmg) j.damage = Math.min(100, j.damage + dmg);
      if (point) {
        _n.set(vx, 0, vz).normalize().negate();
        j.dent(_n, 12, 0.25);
        fx.burst(point, color, 14, 7, null, 0.08);
        fx.ring(point, _n.negate(), color, 2.2);
      }
      if (sound) sfx[sound](12);
      shake = Math.max(shake, 0.2);
    },
  };

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
    arena?.dispose();
    perf.event('arena ' + name);
    arena = BUILDERS[name](scene, world);
    arenaName = name;
    if (name !== 'tutorial') CONFIG.arena = name; // la arena "elegida" sigue siendo la de las partidas
    scene.fog.color.set(arena.fog[0]);
    scene.fog.near = arena.fog[1];
    scene.fog.far = arena.fog[2];
    [bloomPass.strength, bloomPass.radius, bloomPass.threshold] = arena.bloom || [0.5, 0.6, 0.85];
    fx.floorAt = arena.floorAt;
    resetMatch();
    document.getElementById('arena').textContent = t('arena.' + name);
    if (warm) warmAll();
  }

  // partida de cero en la arena que ya está armada (no la vuelve a construir: así no se traba)
  function resetMatch() {
    fx.clear();
    pickups.clear();
    oil.clear();
    slices.clear();
    shots.clear();
    // cuántas gelatinas juegan en esta arena (las que sobran quedan en el banco, fuera del juego)
    const playing = arena.players ?? 12;
    jellies.forEach((j, i) => {
      j.kos = 0; j.falls = 0; j.score = 0;
      j.benched = i >= playing;
      if (j.benched) { j.kill(); j.respawnAt = Infinity; } else j.respawn(spawnPoint(j));
      if (j.rank) j.rank.el.style.display = j.benched ? 'none' : '';
    });
    if (gameMode === 'teams' && !arena.tutorial) {
      teams.start(jellies.filter((j) => !j.benched), arena);
      for (const j of jellies) if (!j.benched && !j.dead) j.respawn(spawnPoint(j)); // cada uno a su mitad
    } else teams.stop();
    meEl.style.setProperty('--c', '#' + player.color.getHexString()); // en equipos, tu panel también toma el color del equipo
    for (const j of jellies) j.rank?.el.classList.toggle('tA', j.team === 0), j.rank?.el.classList.toggle('tB', j.team === 1);
    player.maxMass = 1;
    if (!arena.tutorial && !inLobby) telemetry.startMatch({ mode: gameMode, arena: arenaName, team: player.team, name: player.name });
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
      const r = hitForce(calc.atacante, calc.victima, 100 - calc.estabilidad, closing, calc.picada, false, false);
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

  // ------------------------------------------------------------ armas
  // poderes de las bolitas amarillas: se activan solos al agarrarlos
  function applyPower(j, type) {
    if (j.dead || j.impaled) return;
    const P = POWERS[type];
    switch (type) {
      case 'turbo': case 'strength':
        j.buffs[type] = CONFIG.buffTime;
        break;
      case 'heal':
        j.damage = 0;
        break;
      case 'feast':
        j.mass += CONFIG.pickupMass * 10;
        j.squashVel += 6;
        break;
    }
    fx.popup(j.pos.clone().setY(j.pos.y + 2 * j.size), P.icon, '#ffe14d');
    fx.ring(j.pos.clone().setY(0.1), new THREE.Vector3(0, 1, 0), new THREE.Color('#ffd21a'), 2.5 * j.size);
    sfx.use();
  }

  // armas para tirar: cada una se acumula por separado y tiene su tecla (D aceite · F escupitajo)
  function giveWeapon(j, type) {
    j.ammo[type] += type === 'spit' ? CONFIG.spitCharges : CONFIG.oilCharges;
    const P = POWERS[type];
    fx.popup(j.pos.clone().setY(j.pos.y + 2 * j.size), `${P.icon}×${j.ammo[type]}`, '#ffe14d');
    sfx.use();
  }

  // a quién apuntar: el rival más cercano dentro de un cono adelante (ayuda de puntería)
  function aimTarget(j, range, cone = 0.82, f = j.facing) {
    let best = null, bs = Infinity;
    for (const o of jellies) {
      if (o === j || o.dead || o.impaled) continue;
      const dx = o.pos.x - j.pos.x, dz = o.pos.z - j.pos.z, d = Math.hypot(dx, dz);
      if (d < 1 || d > range) continue;
      const dot = (dx * f.x + dz * f.z) / d;
      if (dot < cone) continue;
      const score = d * (2 - dot);
      if (score < bs) { bs = score; best = o; }
    }
    return best;
  }

  function throwWeapon(j, type) {
    if (!(j.ammo[type] > 0) || j.throwCd > 0 || j.dead || j.impaled || j.stunned || j.daze > 0) return;
    const f = j.facing;
    const from = j.pos.clone().addScaledVector(f, j.r * 0.9).setY(j.pos.y + j.r * 0.25);
    if (type === 'spit') {
      const sp = CONFIG.spitSpeed, g = -9;
      const tgt = aimTarget(j, CONFIG.spitRange);
      let aim;
      if (tgt) {
        // apunta adonde va a estar (adelanta según su velocidad)
        const v = tgt.body.linvel();
        const T = tgt.pos.distanceTo(from) / sp;
        aim = new THREE.Vector3(tgt.pos.x + v.x * T, tgt.pos.y, tgt.pos.z + v.z * T);
      } else aim = from.clone().addScaledVector(f, 18).setY(from.y);
      const dx = aim.x - from.x, dz = aim.z - from.z, dh = Math.hypot(dx, dz) || 1;
      const T = dh / sp;
      const vel = new THREE.Vector3((dx / dh) * sp, (aim.y - from.y) / T - 0.5 * g * T, (dz / dh) * sp);
      shots.spawn('spit', j, from, vel);
      j.squashVel -= 3; j.stretchVel += 5;
      j.dent(f.clone().negate(), 4, 0.5);
      sfx.spit();
    } else {
      // aceite: se tira PARA ATRÁS, a pocos metros (sin puntería)
      const back = f.clone().negate();
      const behind = j.pos.clone().addScaledVector(back, j.r * 0.9).setY(j.pos.y + j.r * 0.4);
      const T = 0.4, g = -30;
      const land = j.pos.clone().addScaledVector(back, j.r + CONFIG.oilThrowDist).setY(0);
      const vel = new THREE.Vector3((land.x - behind.x) / T, (land.y - behind.y) / T - 0.5 * g * T, (land.z - behind.z) / T);
      shots.spawn('oil', j, behind, vel);
      j.dent(back, 4, 0.5);
      sfx.whoosh();
    }
    j.throwCd = 0.35;
    j.ammo[type]--;
    tutorial.thrown(j, type);
  }

  const shotHooks = {
    hit(p, j) {
      if (p.kind === 'spit') {
        // escupitajo: SIEMPRE marea
        const n = p.vel.clone().setY(0).normalize();
        const k = CONFIG.spitKnock / Math.sqrt(j.mass);
        j.knockback(n.x * k, 2, n.z * k, 0.2);
        j.dizzy(CONFIG.dazeMin + Math.random() * (CONFIG.dazeMax - CONFIG.dazeMin));
        j.lastHitBy = p.owner; j.lastHitTime = time;
        j.dent(n.clone().negate(), 10, 0.3);
        fx.burst(p.pos, p.color, 22, 5, n, 0.09);
        fx.ring(p.pos, n, p.color, 1.8);
        sfx.splosh(); sfx.dizzy();
        tutorial.spitHit(p.owner, j);
      } else {
        // aceite que le cae encima: mancha a sus pies
        oil.spawn(j.pos.x, j.pos.z, p.owner);
        fx.burst(p.pos, p.color, 16, 4, null, 0.12);
        sfx.splosh();
      }
    },
    land(p, point, normal) {
      if (p.kind === 'spit') {
        fx.burst(point, p.color, 12, 3, normal, 0.07);
        if (normal.y > 0.6) fx.puddle(point.clone().setY(point.y + 0.02), normal, p.color, 0.5);
        sfx.splosh();
      } else {
        // si pegó contra una pared, la mancha queda al pie
        if (normal.y < 0.6) point.addScaledVector(normal.setY(0).normalize(), CONFIG.oilRadius * 0.6);
        if (arena.floorAt(point.x, point.z)) oil.spawn(point.x, point.z, p.owner);
        fx.burst(point.clone().setY(0.4), p.color, 14, 4, null, 0.12, true);
        sfx.splosh();
      }
    },
  };

  // ------------------------------------------------------------ golpes entre gelatinas
  // Toda la fórmula en un lugar (la usa también la calculadora del admin).
  //   relación de masa = masaAtacante / masaVíctima  → importa la DIFERENCIA, no el tamaño absoluto
  //   fuerza  = (knockBase + choque × knockScale) × relación^massExp × (1 + instKnock × inestabilidad) × picada × fuerza extra
  //   estabilidad que saca = instPerHit × (choque/20, máx 1.5) × relación^instMassExp × picada
  function hitForce(am, vm, dmg, closing, airDash, strong, dazed) {
    const ratio = am / vm;
    const air = airDash ? CONFIG.airDashBonus : 1;
    const raw = (CONFIG.knockBase + closing * CONFIG.knockScale) * Math.pow(ratio, CONFIG.massExp)
      * (1 + (CONFIG.instKnock * dmg) / 100) * (dazed ? 1.25 : 1) * air * (strong ? CONFIG.strengthMul : 1);
    const K = Math.min(CONFIG.knockMax, raw);
    const loss = Math.min(60, Math.round(CONFIG.instPerHit * Math.min(1.5, closing / 20) * Math.pow(ratio, CONFIG.instMassExp) * air));
    return { K, loss, raw };
  }

  function tryHit(att, vic, n) {
    if (!att.dashing || vic.dead || !isEnemy(att, vic)) return;
    const closing = att.vBefore.dot(n) - vic.vBefore.dot(n);
    if (closing < 6) return;
    const nh = new THREE.Vector3(n.x, 0, n.z).normalize();
    const back = nh.clone().negate();
    const { K, loss } = hitForce(att.mass, vic.mass, vic.damage, closing, att.airDash, att.buffs.strength > 0, vic.daze > 0);
    const air = att.airDash ? CONFIG.airDashBonus : 1;
    vic.knockback(nh.x * K, 3 + K * CONFIG.knockLift, nh.z * K, CONFIG.stunBase + K * CONFIG.stunPerForce);
    vic.damage = Math.min(100, vic.damage + loss);
    vic.lastHitBy = att;
    vic.lastHitTime = time;
    if (K >= 10) { vic.flyUntil = time + 0.9; vic.flyBy = att; } // sale volando: si choca a otro, le pega (carambola)
    att.dashTimer = 0;
    const recoil = 4 / Math.sqrt(att.mass);
    att.knockback(-nh.x * recoil, 3, -nh.z * recoil, 0.12);

    vic.dent(back, K * 1.3, 0.2);
    att.dent(nh, K * 0.6, 0.3);
    vic.squashVel -= 3;

    perf.event('golpe');
    const contact = att.pos.clone().addScaledVector(nh, att.r);
    fx.burst(contact, vic.color, 10 + (K | 0), K * 0.45, nh, 0.11);
    fx.burst(contact, att.color, 5, K * 0.3, back, 0.08);
    fx.ring(contact, nh, new THREE.Color(air > 1 ? '#ffffff' : '#fff2c0'), (1.5 + K * 0.08) * (air > 1 ? 1.5 : 1));
    // destello en el punto del golpe (tamaño y color según la fuerza); en picada, más grande
    fx.impact(contact.clone().setY(contact.y + 0.3), K * (air > 1 ? 1.25 : 1));

    // golpe fuerte → muchas chances de dejarlo mareado
    if (K >= CONFIG.dazeForce && vic.daze <= 0) {
      const over = (K - CONFIG.dazeForce) / 15;
      if (Math.random() < Math.min(0.9, 0.5 + over * 0.5)) {
        vic.dizzy(CONFIG.dazeMin + (CONFIG.dazeMax - CONFIG.dazeMin) * Math.min(1, over));
        sfx.dizzy();
      }
    }

    // golpe fuerte: le saca masa al rival (gelatinitas que salen volando)
    const lose = Math.min(3, Math.floor(K / 14));
    for (let i = 0; i < lose && vic.mass - CONFIG.pickupMass >= 1; i++) {
      vic.mass -= CONFIG.pickupMass;
      const a = Math.random() * Math.PI * 2;
      pickups.eject(vic.pos.clone().setY(vic.pos.y + vic.r), new THREE.Vector3(nh.x * 6 + Math.cos(a) * 3, 8 + Math.random() * 4, nh.z * 6 + Math.sin(a) * 3), vic);
    }

    shake = Math.max(shake, CONFIG.shake * Math.min(1.8, K / 15));
    sfx.hit(K);
    tutorial.hit(att, vic);
  }

  // Carambola: una gelatina que sale volando por un golpe le pega a la que choca como si la embistiera
  // (misma fórmula de fuerza, con su masa y la velocidad del choque). El KO es de quien empezó todo.
  function chainHit(src, dst, n, closing) {
    if (dst === src.flyBy || time < (dst.chainUntil || 0) || !isEnemy(src.flyBy || src, dst)) return;
    const nh = new THREE.Vector3(n.x, 0, n.z).normalize();
    const { K, loss } = hitForce(src.mass, dst.mass, dst.damage, closing, false, false, dst.daze > 0);
    dst.knockback(nh.x * K, 3 + K * CONFIG.knockLift, nh.z * K, CONFIG.stunBase + K * CONFIG.stunPerForce);
    dst.damage = Math.min(100, dst.damage + loss);
    dst.lastHitBy = src.flyBy || src;
    dst.lastHitTime = time;
    dst.chainUntil = time + 0.4;
    if (K >= 10) { dst.flyUntil = time + 0.9; dst.flyBy = dst.lastHitBy; } // y puede seguir la cadena
    // la que venía volando le pasa parte del impulso y frena
    const v = src.body.linvel();
    src.body.setLinvel({ x: v.x * 0.45, y: v.y, z: v.z * 0.45 }, true);
    src.flyUntil = 0;
    dst.dent(nh.clone().negate(), K * 1.2, 0.2);
    src.dent(nh, K * 0.6, 0.3);
    const contact = src.pos.clone().addScaledVector(nh, src.r);
    fx.burst(contact, dst.color, 8 + (K | 0), K * 0.4, nh, 0.1);
    fx.ring(contact, nh, new THREE.Color('#fff2c0'), 1.5 + K * 0.08);
    fx.impact(contact.clone().setY(contact.y + 0.3), K);
    shake = Math.max(shake, CONFIG.shake * Math.min(1.5, K / 15));
    sfx.hit(K);
  }

  const _hn = new THREE.Vector3();
  function checkHits() {
    for (let i = 0; i < jellies.length; i++) {
      for (let k = i + 1; k < jellies.length; k++) {
        const a = jellies[i], b = jellies[k];
        if (a.dead || b.dead || a.impaled || b.impaled) continue;
        const n = _hn.subVectors(b.pos, a.pos); // vector reusado: esto corre 120 veces por segundo por cada par
        const d = n.length();
        if (d > a.r + b.r + 0.25 || d < 1e-4) continue;
        n.divideScalar(d);
        const aDash = a.dashing, bDash = b.dashing;
        if (aDash) tryHit(a, b, n);
        if (bDash) tryHit(b, a, n.clone().negate());
        if (!aDash && !bDash) {
          const rel = a.vBefore.dot(n) - b.vBefore.dot(n);
          if (rel > 7 && time < (a.flyUntil || 0)) chainHit(a, b, n, rel);
          else if (rel > 7 && time < (b.flyUntil || 0)) chainHit(b, a, n.clone().negate(), rel);
          else if (rel > 7) sfx.bump(rel);
          // empujón (sin embestir): el que se mete contra el otro queda anotado como "quien lo empujó"
          const va = a.vBefore.dot(n), vb = -b.vBefore.dot(n);
          if (va > 1.5 && va > vb) { if (isEnemy(a, b)) { b.pushBy = a; b.pushTime = time; } }
          else if (vb > 1.5 && isEnemy(a, b)) { a.pushBy = b; a.pushTime = time; }
        }
      }
    }
  }

  function checkSplat(j, mag) {
    if (!CONFIG.wallSplat || j.dead || j.impaled || !j.stunned || mag < CONFIG.splatImpulse) return;
    _n.copy(j.contact).divideScalar(mag);
    if (Math.abs(_n.y) > 0.6) return;
    if (jellies.some((o) => o !== j && !o.dead && o.pos.distanceTo(j.pos) < j.r + o.r + 0.4)) return;
    game.splat(j, _n.clone(), j.pos.clone().addScaledVector(_n, -j.r));
  }

  // ------------------------------------------------------------ bots
  const lookAheadSafe = (x, z, dx, dz, dist) => (arena.safeAt ? arena.safeAt(x + dx * dist, z + dz * dist) : arena.floorAt(x + dx * dist, z + dz * dist));

  // Los bots deciden 30 veces por segundo (no 120): cada uno en un paso distinto, así no piensan todos juntos.
  // Entre decisiones siguen con el mismo rumbo; saltar/embestir/tirar se hacen una sola vez.
  // (En una Mac de 2015 los bots eran ~7 ms por frame; en PCs lentas cada frame hace muchos pasos de física.)
  const BOT_EVERY = 4;
  let stepN = 0;
  function botCmd(j, i) {
    if (!j.ai || (stepN + i) % BOT_EVERY === 0) return botThink(j, STEP * BOT_EVERY);
    const c = j.ai.cmd;
    c.jump = false; c.dash = false; c.throw = null;
    return c;
  }

  // los bots también usan sus armas
  function botThink(b, dt) {
    const ai = (b.ai ||= { t: 0, wx: 0, wz: 0, dashWait: 1 + Math.random() * 2, hold: 0, pounce: 0, cmd: { mx: 0, mz: 0, jump: false, jumpHeld: false, dash: false, sprint: false } });
    const cmd = ai.cmd;
    cmd.jump = false; cmd.dash = false; cmd.sprint = false; cmd.throw = null;
    ai.dashWait -= dt; ai.t -= dt; ai.hold -= dt;
    const px = b.pos.x, pz = b.pos.z;
    let mx = 0, mz = 0;

    // gelatinita más cercana
    let food = null, fd = Infinity;
    for (const p of pickups.list) {
      if (p.state === 'eaten') continue;
      const d = Math.hypot(p.mesh.position.x - px, p.mesh.position.z - pz);
      if (d < fd) { fd = d; food = p; }
    }
    // rival más cercano
    let tgt = null, td = Infinity;
    const aggr = CONFIG.botsAggressive || teams.active;
    for (const o of jellies) {
      if (o === b || o.dead || !isEnemy(b, o)) continue;
      const d = Math.hypot(o.pos.x - px, o.pos.z - pz) * (o.isPlayer ? 0.7 : 1);
      if (d < td) { td = d; tgt = o; }
    }

    // trampa: si el rival está sobre un pozo y tengo el botón cerca, voy a embestirlo
    let trap = null;
    if (aggr && tgt && arena.traps) {
      for (const tr of arena.traps) {
        if (!tr.ready()) continue;
        if (Math.hypot(tgt.pos.x - tr.x, tgt.pos.z - tr.z) < tr.r + 1.5 && Math.hypot(tr.button.x - px, tr.button.z - pz) < 16) { trap = tr; break; }
      }
    }
    const goFood = !trap && food && (!aggr ? fd < 18 : fd < Math.min(8, td * 0.5));
    if (trap) {
      const dx = trap.button.x - px, dz = trap.button.z - pz, d = Math.hypot(dx, dz) || 1;
      mx = dx / d; mz = dz / d;
      const f = b.facing;
      if (d < 5 && f.x * mx + f.z * mz > 0.9 && b.dashCd <= 0) cmd.dash = true;
      else if (d > 8) cmd.sprint = b.energy > 50;
    } else if (goFood) {
      const dx = food.mesh.position.x - px, dz = food.mesh.position.z - pz;
      mx = dx / (fd || 1); mz = dz / (fd || 1);
      if (!aggr) { mx *= 0.7; mz *= 0.7; }
      if (fd > 9 && b.energy > 60) cmd.sprint = true;
    } else if (!aggr || !tgt) {
      if (ai.t <= 0) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * arena.R * 0.5;
        ai.wx = Math.cos(a) * r; ai.wz = Math.sin(a) * r; ai.t = 2 + Math.random() * 3;
      }
      const dx = ai.wx - px, dz = ai.wz - pz, d = Math.hypot(dx, dz);
      if (d > 0.8) { mx = (dx / d) * 0.4; mz = (dz / d) * 0.4; }
    } else {
      const dx = tgt.pos.x - px, dz = tgt.pos.z - pz, d = Math.hypot(dx, dz) || 1;
      mx = dx / d; mz = dz / d;
      if (d > 12 && b.energy > 60) cmd.sprint = true;
      const f = b.facing;
      if (d < 7.5 && d > 1.5 && f.x * mx + f.z * mz > 0.93 && ai.dashWait <= 0 && b.dashCd <= 0 && ai.pounce <= 0) {
        // a veces salta primero para embestir en picada
        if (Math.random() < 0.35 && b.grounded) { cmd.jump = true; ai.hold = 0.25; ai.pounce = 0.32; }
        else { cmd.dash = true; ai.dashWait = 0.8 + Math.random() * 2.2; }
      }
      if (tgt.dashing && d < 5 && Math.random() < 0.04) { cmd.jump = true; ai.hold = 0.3; }
    }
    // escupitajo: escupe a los que tiene adelante y lejos
    if (b.ammo.spit > 0 && tgt && b.throwCd <= 0 && aggr) {
      const dx = tgt.pos.x - px, dz = tgt.pos.z - pz, d = Math.hypot(dx, dz) || 1;
      const face = (b.facing.x * dx + b.facing.z * dz) / d;
      if (d > 7 && d < CONFIG.spitRange * 0.8 && face > 0.9 && Math.random() < dt * 1.5) cmd.throw = 'spit';
    }
    // aceite: lo tira cuando alguien lo viene persiguiendo de atrás
    if (b.ammo.oil > 0 && b.throwCd <= 0 && !cmd.throw) {
      for (const o of jellies) {
        if (o === b || o.dead || !isEnemy(b, o)) continue;
        const dx = o.pos.x - px, dz = o.pos.z - pz, d = Math.hypot(dx, dz) || 1;
        if (d < 3 || d > 14) continue;
        const behind = (b.facing.x * dx + b.facing.z * dz) / d < -0.6;
        const v = o.body.linvel();
        const chasing = -(v.x * dx + v.z * dz) / d > 4; // se me acerca rápido
        if (behind && chasing && Math.random() < dt * 3) { cmd.throw = 'oil'; break; }
      }
    }
    if (ai.pounce > 0) {
      ai.pounce -= dt;
      if (ai.pounce <= 0) { cmd.dash = true; ai.dashWait = 1 + Math.random() * 2; }
    }

    // destrabarse: encimado sobre otro (o debajo), o queriendo avanzar sin moverse → sale hacia un costado y salta.
    // (antes se quedaban congelados: con el rival justo arriba/abajo, "ir hacia él" da una dirección casi nula)
    let stack = null;
    for (const o of jellies) {
      if (o === b || o.dead) continue;
      const h = Math.hypot(o.pos.x - px, o.pos.z - pz);
      if (h < (b.r + o.r) * 0.75 && Math.abs(b.pos.y - o.pos.y) > Math.min(b.r, o.r) * 0.6) { stack = o; break; }
    }
    const v = b.body.linvel(), sp = Math.hypot(v.x, v.z);
    ai.stuck = Math.hypot(mx, mz) > 0.3 && sp < 0.6 ? (ai.stuck || 0) + dt : Math.max(0, (ai.stuck || 0) - dt * 2);
    if ((stack || ai.stuck > 1) && !(ai.escapeT > 0)) {
      let ex = stack ? px - stack.pos.x : 0, ez = stack ? pz - stack.pos.z : 0;
      const el = Math.hypot(ex, ez);
      if (el < 0.2) { const a = Math.random() * Math.PI * 2; ex = Math.cos(a); ez = Math.sin(a); } else { ex /= el; ez /= el; }
      ai.ex = ex; ai.ez = ez; ai.escapeT = 0.8; ai.stuck = 0;
      if (b.grounded || (stack && b.pos.y > stack.pos.y)) { cmd.jump = true; ai.hold = 0.15; }
    }
    if (ai.escapeT > 0) { ai.escapeT -= dt; mx = ai.ex; mz = ai.ez; cmd.dash = false; cmd.sprint = false; }

    // no tirarse al vacío: mirar adelante
    const ml = Math.hypot(mx, mz);
    if (ml > 0.05) {
      const ux = mx / ml, uz = mz / ml, ahead = 2.5 + b.r;
      if (!lookAheadSafe(px, pz, ux, uz, ahead)) {
        let fixed = false;
        for (const ang of [0.8, -0.8, 1.6, -1.6]) {
          const c = Math.cos(ang), s = Math.sin(ang);
          const rx = ux * c - uz * s, rz = ux * s + uz * c;
          if (lookAheadSafe(px, pz, rx, rz, ahead)) { mx = rx * ml; mz = rz * ml; fixed = true; break; }
        }
        if (!fixed) { mx = -px; mz = -pz; }
        if (!trap) cmd.dash = false;
      }
    }
    const rc = Math.hypot(px, pz);
    if (rc > arena.R - 3 && !trap) { const k = ((rc - (arena.R - 3)) / 3) * 1.2; mx -= (px / rc) * k; mz -= (pz / rc) * k; }
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    cmd.mx = mx; cmd.mz = mz; cmd.jumpHeld = ai.hold > 0;
    return cmd;
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
  const stillCmd = { mx: 0, mz: 0, jump: false, jumpHeld: false, dash: false, sprint: false, throw: null };
  function dummyThink(j) {
    const dx = DUMMY_HOME.x - j.pos.x, dz = DUMMY_HOME.z - j.pos.z, d = Math.hypot(dx, dz);
    const settled = j.sinceHit > 1.5 && j.daze <= 0 && !j.stunned;
    if (settled) j.damage = 0;
    if (settled && d > 0.8) {
      const k = Math.min(0.45, d * 0.2) / d;
      stillCmd.mx = dx * k; stillCmd.mz = dz * k;
    } else {
      stillCmd.mx = stillCmd.mz = 0;
      if (settled && !player.dead) j.targetYaw = Math.atan2(player.pos.x - j.pos.x, player.pos.z - j.pos.z);
    }
    return stillCmd;
  }
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
  const onEat = (j, m, power) => {
    tutorial.ate(j, power);
    if (power) {
      fx.burst(j.pos.clone().setY(j.pos.y + j.r * 0.5), new THREE.Color('#ffd21a'), 8, 3, null, 0.07);
      sfx.power();
      if (POWERS[power].throw) giveWeapon(j, power);
      else applyPower(j, power);
      return;
    }
    j.feed(m);
    sfx.gulp();
    fx.burst(j.pos.clone().setY(j.pos.y + j.r * 0.5), new THREE.Color('#ffffff'), 4, 2.5, null, 0.06);
  };

  function fixedStep(doSkin = true) {
    time += STEP;
    const pc = input.command();
    input.consumeEdges(pc);
    input.mashCount = 0; // (ya no se acorta el mareo apretando teclas)
    [pc.mx, pc.mz] = rig.toWorld(pc.mx, pc.mz); // flechas relativas a la cámara
    arena.preStep(STEP, time);
    oil.step(STEP, jellies, time);
    for (const j of jellies) {
      if (j.justSlipped) {
        j.justSlipped = false;
        fx.popup(j.pos.clone().setY(j.pos.y + 1.8 * j.size), '🛢️', '#c8b27a');
        sfx.slip();
      }
      if (!j.dead) j.score += CONFIG.alivePoints * STEP;
    }
    let pt = performance.now();
    const tick = (key) => { const n = performance.now(); perf.add(key, n - pt); pt = n; };
    stepN++;
    for (let i = 0; i < jellies.length; i++) {
      const j = jellies[i];
      const cmd = teams.frozen ? stillCmd : j.isPlayer ? pc : j.dummy ? dummyThink(j) : botCmd(j, i); // equipos: quietos hasta el ¡YA!
      j.control(STEP, cmd);
      j.throwCd = Math.max(0, j.throwCd - STEP);
      if (cmd.throw) throwWeapon(j, cmd.throw);
    }
    tick('bots');
    world.step();
    tick('physics');
    const mags = jellies.map((j) => j.postStep(STEP));
    checkHits();
    jellies.forEach((j, i) => checkSplat(j, mags[i]));
    tick('hits');
    arena.postStep(STEP, game);
    tick('arena');
    pickups.step(STEP, arena, jellies, onEat);
    shots.step(STEP, jellies, shotHooks);
    tick('pickups');
    for (const j of jellies) {
      if (!j.dead && j.pos.y < -14) {
        fx.popup(j.pos.clone().setY(-2), '💀', '#' + j.color.getHexString(), true);
        sfx.ko();
        j.kill();
        creditKO(j);
      }
      if (j.impaled) {
        j.impaledT -= STEP;
        if (Math.random() < STEP * 6) fx.burst(j.pos.clone().setY(j.pos.y - j.r * 0.3), j.color, 1, 1, null, 0.07); // gotea
        if (j.impaledT <= 0) {
          // ¡revienta!
          const n = j.impaleN || new THREE.Vector3(0, 1, 0);
          fx.burst(j.pos, j.color, 40, 9, n, 0.13 * j.size);
          fx.puddle(new THREE.Vector3(j.pos.x, 0.02, j.pos.z), new THREE.Vector3(0, 1, 0), j.color, 1.6 * j.size);
          fx.popup(j.pos.clone().setY(j.pos.y + 1.5), '💥', '#' + j.color.getHexString(), true);
          sfx.pop();
          shake = Math.max(shake, 0.4);
          j.kill();
          creditKO(j);
        }
      }
      if (j.dead && time > j.respawnAt && teams.canRespawn(j)) j.respawn(spawnPoint(j));
      if (doSkin) j.skin(STEP);
    }
    tick('skinSim');
  }

  // la arena se arma recién al salir de la pantalla de inicio (con la pantalla de carga encima)

  // ------------------------------------------------------------ pantalla de inicio (color + tatuaje)
  let inLobby = false;
  const lobby = new Lobby(document.getElementById('lobby'), {
    track: (k, d) => telemetry.track(k, d),
    // "auto" arranca en el nivel que corresponde al aparato y baja solo si hace falta
    onStart(look) {
      inLobby = false;
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
      // arranca la partida de cero (si la arena ya está armada, sólo se reinicia: sin pantalla de carga)
      if (CONFIG.arena === arenaName) resetMatch(); else loadArenaCovered(CONFIG.arena);
      rig.reset();
      toast(t('toast.welcome', { name: look.name }));
    },
  });
  const openLobby = () => {
    endTutorial();
    if (inLobby) return;
    telemetry.endMatch('lobby');
    inLobby = true;
    input.enabled = false;
    input.keys.clear();
    document.body.classList.add('in-lobby');
    player.kill();
    player.respawnAt = Infinity; // no reaparece hasta que arranques
    rig.set(CAM_PRESETS[2]);
    lobby.open();
  };
  input.on('KeyP', openLobby);

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
    arena: arenaName, fpsCap: CONFIG.fpsCap, monitorHz: adaptive.hz, fpsTarget: Math.round(adaptive.target * 10) / 10, resScale: adaptive.resScale, bloom: CONFIG.bloom, inLobby, tutorial: tutorial.active, quality: Q.level, qualityAuto: Q.auto, touch: !!touchUI,
    jellies: jellies.filter((j) => !j.dead).length, onScreen: jellies.filter((j) => !j.dead && !j.offscreen).length,
    pickups: pickups.list.length, oilSlicks: oil.list.length, slices: slices.list.length, shots: shots.list.length,
  });
  telemetry.statsFn = () => ({
    score: Math.floor(player.score), kos: player.kos, falls: player.falls, maxMass: +(player.maxMass || 1).toFixed(1),
    won: teams.active ? teams.wins[player.team] : undefined, lost: teams.active ? teams.wins[1 - player.team] : undefined,
  });
  perf.onReport = (rep) => telemetry.perf({ ...rep, fpsTarget: adaptive.target, resScale: adaptive.resScale }, !inLobby && !!arena);
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

    // sin congelamientos: la simulación nunca se pausa (pensado para multiplayer)
    acc += dt;
    // después de un trabón se hacen varios pasos seguidos para alcanzar: la piel (sólo visual) se
    // simula en los 2 primeros nada más, así un trabón no arrastra a los siguientes frames
    for (let k = 0; acc >= STEP; k++) { fixedStep(k < 2); acc -= STEP; perf.t.steps++; }
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
    arena.update(time, dt);

    // cámara: sigue al jugador y se aleja un poco cuando crece
    // muerto: la cámara se queda mirando donde caíste (no se va al centro)
    if (inLobby) camFocus.set(0, 0, 0);
    else if (!player.dead) camFocus.copy(player.renderPos).multiplyScalar(CONFIG.camCenter).setY(0); // 1 = tu gelatina en el centro
    else if (teams.spectate(player)) camFocus.lerp(_p.copy(teams.spectate(player).renderPos).setY(0), 1 - Math.exp(-4 * dt)); // equipos: miras a un compañero
    else camFocus.lerp(_p.set(player.pos.x, 0, player.pos.z), 1 - Math.exp(-3 * dt)); // se acerca a donde moriste
    const desired = _p.copy(camFocus);
    if (inLobby) rig.tYaw += dt * 0.06; // de fondo: la arena girando despacito
    rig.shake = Math.max(rig.shake, shake);
    shake = 0;
    rig.update(dt, desired, 1 + (player.size - 1) * 0.35);
    sun.position.set(rig.target.x + 8, 30, rig.target.z + 10);
    sun.target.position.copy(rig.target);

    tutorial.update(dt);
    teams.update(inLobby ? 0 : dt, player);

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
