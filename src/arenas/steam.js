import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  createCtx, buildFloor, canvasTex, stripesTex, circlePts, wall, skyDome, gearGeometry,
  arcBand, arcCurb, arcTube, lantern, gauge, backdrop,
} from './common.js';
import { fx } from '../fx.js';
import { sfx } from '../sfx.js';
import { R as R_JELLY } from '../jelly.js';

const ORANGE = new THREE.Color('#ff9a2e');
const UP = new THREE.Vector3(0, 1, 0);

// Plataforma steampunk (radio 60) dentro de una estructura cerrada:
// columna central que baja a un mar de nubes, 6 torres alrededor unidas por anillos de vigas,
// pasarelas que terminan en las torres, caldera sobre una torre, engranajes montados en las torres.
//
// Distribución simétrica, siguiendo a las 6 torres (cada 60°):
//  · entre torre y torre, alternados: pozo, sierra, pozo, sierra, pozo, sierra
//    (cada pozo con su botón en la pared detrás; cada sierra con pinches en la pared detrás)
//  · frente a cada torre: un géiser (anillo interior), una placa de pinches que salen del piso
//    y una abertura en la pared (2 son las pasarelas)
//  · en el centro, 2 sierras grandes en cruz que se turnan; ahí caen más bolitas especiales (tentación)
export function buildSteam(scene, world) {
  const ctx = createCtx(scene, world);
  const R = 60; // radio de la arena (era 40)
  const TOWER_D = R + 16; // distancia de las torres al centro
  const TOWER_R = 6.5;

  skyDome(ctx, '#1c0a38', '#7a3c7a', '#2a0f44');

  // ---------------------------------------------------------- materiales (dorado menos encandilante)
  const brass = new THREE.MeshStandardMaterial({ color: '#a8783a', metalness: 0.75, roughness: 0.45, envMapIntensity: 0.6 });
  const brassDark = new THREE.MeshStandardMaterial({ color: '#6e4f28', metalness: 0.7, roughness: 0.5, envMapIntensity: 0.5 });
  const copper = new THREE.MeshStandardMaterial({ color: '#8e5234', metalness: 0.7, roughness: 0.48, envMapIntensity: 0.5 });
  const iron = new THREE.MeshStandardMaterial({ color: '#33283f', metalness: 0.7, roughness: 0.55, envMapIntensity: 0.5 });
  const fireTex = canvasTex(256, 256, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w * 0.62, 4, w / 2, w / 2, w * 0.7);
    grd.addColorStop(0, '#ffe7a0'); grd.addColorStop(0.35, '#ffa52a'); grd.addColorStop(0.75, '#d24e0e'); grd.addColorStop(1, '#5a1606');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(255,${120 + Math.random() * 100},40,0.25)`;
      g.beginPath(); g.ellipse(Math.random() * w, w * 0.4 + Math.random() * w * 0.6, 6 + Math.random() * 20, 10 + Math.random() * 30, 0, 0, Math.PI * 2); g.fill();
    }
  });
  const fire = new THREE.MeshBasicMaterial({ map: fireTex, color: new THREE.Color(1.05, 0.95, 0.9), toneMapped: false });
  const neonPink = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5ae8').multiplyScalar(1.5), toneMapped: false });
  const lampGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.95, 0.4), toneMapped: false });
  const windowBars = new THREE.MeshStandardMaterial({ color: '#2a1a12', metalness: 0.7, roughness: 0.6 });
  const stripe = stripesTex('#e8a000', '#1d1418', 10);

  // ---------------------------------------------------------- distribución
  const TOWER_ANGLES = Array.from({ length: 6 }, (_, k) => 0.3 + (k * Math.PI) / 3);
  const BETWEEN = TOWER_ANGLES.map((a) => a + Math.PI / 6); // entre torre y torre
  const HOLE_ANGLES = [BETWEEN[0], BETWEEN[2], BETWEEN[4]];
  const SAW_ANGLES = [BETWEEN[1], BETWEEN[3], BETWEEN[5]];

  // ---------------------------------------------------------- piso
  const CENTER_R = 15;
  // pozos en el piso: si caés, KO
  // 3 pozos tapados (todos iguales, cada 120°): se abren cuando alguien embiste el botón rojo de la pared;
  // cada pozo queda justo delante de su botón (mismo ángulo), así el botón abre el pozo más cercano
  const HOLES = HOLE_ANGLES.map((a, i) => ({ a, d: 39, r: 6.6, label: ['I', 'II', 'III'][i] }))
    .map((h) => ({ ...h, x: Math.cos(h.a) * h.d, z: Math.sin(h.a) * h.d, btn: h.a }));
  const inHole = (x, z, m = 0) => HOLES.some((h) => (x - h.x) ** 2 + (z - h.z) ** 2 < (h.r + m) ** 2);
  const inOpenHole = (x, z) => HOLES.some((h) => h.open && (x - h.x) ** 2 + (z - h.z) ** 2 < h.r ** 2);
  const floorTex = canvasTex(2048, 2048, (g, w) => {
    const c = w / 2, px = c / R;
    g.fillStyle = '#3a2a66';
    g.fillRect(0, 0, w, w);
    const plate = (r0, r1, a0, a1) => {
      const grd = g.createLinearGradient(c + Math.cos(a0) * r0, c + Math.sin(a0) * r0, c + Math.cos(a1) * r1, c + Math.sin(a1) * r1);
      const l = 19 + Math.random() * 8;
      grd.addColorStop(0, `hsl(264, 38%, ${l}%)`);
      grd.addColorStop(1, `hsl(272, 42%, ${l + 6 + Math.random() * 6}%)`);
      g.fillStyle = grd;
      g.beginPath(); g.arc(c, c, r1, a0, a1); g.arc(c, c, r0, a1, a0, true); g.closePath(); g.fill();
    };
    const r1 = 21 * px, r2 = 31 * px;
    for (let i = 0; i < 12; i++) plate(CENTER_R * px, r1, (i / 12) * Math.PI * 2, ((i + 1) / 12) * Math.PI * 2);
    for (let i = 0; i < 18; i++) plate(r1, r2, ((i + 0.5) / 18) * Math.PI * 2, ((i + 1.5) / 18) * Math.PI * 2);
    for (let i = 0; i < 24; i++) plate(r2, c, (i / 24) * Math.PI * 2, ((i + 1) / 24) * Math.PI * 2);
    g.strokeStyle = '#21183a'; g.lineWidth = 5;
    const seam = (a, ra, rb) => { g.beginPath(); g.moveTo(c + Math.cos(a) * ra, c + Math.sin(a) * ra); g.lineTo(c + Math.cos(a) * rb, c + Math.sin(a) * rb); g.stroke(); };
    for (let i = 0; i < 12; i++) seam((i / 12) * Math.PI * 2, CENTER_R * px, r1);
    for (let i = 0; i < 18; i++) seam(((i + 0.5) / 18) * Math.PI * 2, r1, r2);
    for (let i = 0; i < 24; i++) seam((i / 24) * Math.PI * 2, r2, c);
    for (const rr of [r1, r2]) { g.beginPath(); g.arc(c, c, rr, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#9586bd';
    const rivetsArc = (r, n) => { for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 3, 0, Math.PI * 2); g.fill(); } };
    for (const rr of [r1 - 9, r1 + 9, r2 - 9, r2 + 9, c - 40]) rivetsArc(rr, Math.round(rr * 0.35));
    for (let k = 0; k < 90; k++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,120,220' : '170,140,255'},0.05)`;
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * w, 30 + Math.random() * 120, 6 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  const top = new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.6, roughness: 0.28, envMapIntensity: 0.7 });
  buildFloor(ctx, {
    outline: circlePts(R, 192),
    holes: [circlePts(CENTER_R, 96), ...HOLES.map((h) => circlePts(h.r, 48).map(([x, z]) => [x + h.x, z + h.z]))],
    top, side: copper, uvScale: R,
  });

  // visual de los pozos: tubo que baja con brillo al fondo, borde de bronce y franja de peligro
  const shaftTex = canvasTex(64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#1a1020'); grd.addColorStop(0.55, '#4a1a3a'); grd.addColorStop(1, '#ff7a2a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const holeHazard = new THREE.MeshStandardMaterial({ map: stripe, metalness: 0.3, roughness: 0.55 });
  for (const h of HOLES) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(h.r, h.r * 0.85, 9, 48, 1, true), new THREE.MeshBasicMaterial({ map: shaftTex, side: THREE.BackSide }));
    shaft.position.set(h.x, -4.5, h.z);
    const lip = new THREE.Mesh(arcTube(h.r + 0.05, 0.2, 0, Math.PI * 2, 64), brass);
    lip.position.set(h.x, 0.06, h.z);
    const band = new THREE.Mesh(arcBand(h.r + 0.25, h.r + 1.1, 0, Math.PI * 2, 64, Math.round((Math.PI * 2 * (h.r + 0.7)) / 1.6)), holeHazard.clone());
    band.material.emissive = new THREE.Color('#ff2a10');
    band.material.emissiveIntensity = 0;
    band.position.set(h.x, 0.014, h.z);
    const outer = new THREE.Mesh(arcTube(h.r + 1.15, 0.08, 0, Math.PI * 2, 64), brassDark);
    outer.position.set(h.x, 0.04, h.z);
    // luz en el borde: se prende sutil cuando alguien aprieta el botón (titila) y queda encendida mientras está abierto
    const edge = new THREE.Mesh(arcTube(h.r + 0.05, 0.07, 0, Math.PI * 2, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.55, 0.25), toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    edge.position.set(h.x, 0.24, h.z);
    edge.visible = false;
    ctx.add(shaft, lip, band, outer, edge);
    h.band = band;
    h.edge = ctx.dynamic(edge);
    // tapa de dos hojas con bisagra + número romano (el mismo que el botón)
    const lidTex = canvasTex(256, 256, (g, w) => {
      const c = w / 2;
      g.fillStyle = '#3b2c4a'; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#6e5a84'; g.lineWidth = 6;
      for (const rr of [0.92, 0.7]) { g.beginPath(); g.arc(c, c, c * rr, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(c, 6); g.lineTo(c, w - 6); g.stroke();
      g.fillStyle = '#ff3b3b'; g.font = 'bold 92px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(h.label, c, c + 4);
    });
    const lidMat = new THREE.MeshStandardMaterial({ map: lidTex, metalness: 0.6, roughness: 0.4 });
    h.doors = [1, -1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(h.x + side * h.r, -0.1, h.z);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(h.r, h.r, 0.18, 32, 1, false, side > 0 ? 0 : Math.PI, Math.PI), iron);
      body.position.x = -side * h.r;
      const topDecal = new THREE.Mesh(new THREE.CircleGeometry(h.r, 32, side > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI), lidMat);
      topDecal.rotation.x = -Math.PI / 2;
      topDecal.position.set(-side * h.r, 0.095, 0);
      pivot.add(body, topDecal);
      pivot.userData.side = side;
      ctx.add(pivot);
      return ctx.dynamic(pivot); // la tapa se abre
    });
    h.col = ctx.collider(RAPIER.ColliderDesc.cylinder(0.12, h.r + 0.05).setTranslation(h.x, -0.12, h.z).setFriction(0.5));
    h.state = 'closed'; h.timer = 0; h.open = false; h.amount = 0; h.presser = null; h.btnCd = 0;
  }

  // ---------------------------------------------------------- centro hundido con engranajes
  ctx.collider(RAPIER.ColliderDesc.cylinder(0.25, CENTER_R + 0.1).setTranslation(0, -0.25, 0).setFriction(0.5));
  const pitWall = new THREE.Mesh(new THREE.CylinderGeometry(CENTER_R, CENTER_R, 1.6, 96, 1, true), new THREE.MeshStandardMaterial({ color: '#2a1c30', metalness: 0.7, roughness: 0.55, side: THREE.BackSide }));
  pitWall.position.y = -0.8;
  const glowTex = canvasTex(256, 256, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, '#ffb347'); grd.addColorStop(0.5, '#d0581a'); grd.addColorStop(1, '#2a0d0a');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
  const pitFloor = new THREE.Mesh(new THREE.CircleGeometry(CENTER_R, 96), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(0.8, 0.8, 0.8) }));
  pitFloor.rotation.x = -Math.PI / 2;
  pitFloor.position.y = -1.55;
  ctx.add(pitWall, pitFloor);
  const gearMat = new THREE.MeshStandardMaterial({ color: '#8a6430', metalness: 0.8, roughness: 0.38, emissive: '#ff7a1a', emissiveIntensity: 0.06, envMapIntensity: 0.6 });
  const gearsFloor = [];
  for (const [x, z, r, n, w, y] of [
    [0, 0, 4.6, 30, 0.2, -1.1], [-6.4, 2.8, 2.7, 18, -0.34, -0.7], [6.1, 4.1, 3.0, 20, -0.31, -0.8],
    [2.2, -7.0, 2.9, 19, -0.32, -0.85], [-4.7, -5.4, 2.0, 14, 0.46, -0.5], [7.0, -3.9, 1.8, 12, 0.51, -0.45],
    [-7.8, -1.6, 1.5, 11, 0.6, -0.35], [-1.2, 7.8, 2.2, 15, -0.42, -0.6],
  ]) {
    const gm = new THREE.Mesh(gearGeometry(r, n, 0.45, 0.35, r * 0.22), gearMat);
    gm.rotation.x = -Math.PI / 2;
    gm.position.set(x, y, z);
    ctx.add(gm);
    gearsFloor.push({ m: ctx.dynamic(gm), w });
  }
  const glass = new THREE.Mesh(new THREE.CircleGeometry(CENTER_R, 96), new THREE.MeshPhysicalMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.06, roughness: 0.02, clearcoat: 1, depthWrite: false }));
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = -0.01;
  ctx.add(glass);
  const centerLight = new THREE.PointLight('#ff8a2a', 12, 18, 1.6);
  centerLight.position.set(0, 0.8, 0);
  ctx.add(centerLight);
  const ringFlat = new THREE.Mesh(arcBand(CENTER_R, CENTER_R + 1.8, 0, Math.PI * 2, 128, 1), brass);
  ringFlat.position.y = 0.03;
  const lipIn = new THREE.Mesh(arcTube(CENTER_R + 0.05, 0.2, 0, Math.PI * 2, 128), brass);
  lipIn.position.y = 0.08;
  const lipOut = new THREE.Mesh(arcTube(CENTER_R + 1.82, 0.16, 0, Math.PI * 2, 128), brassDark);
  lipOut.position.y = 0.06;
  ctx.add(ringFlat, lipIn, lipOut);
  const rivet = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), brassDark, 72);
  const _m = new THREE.Matrix4();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    rivet.setMatrixAt(i, _m.makeTranslation(Math.cos(a) * (CENTER_R + 0.95), 0.06, Math.sin(a) * (CENTER_R + 0.95)));
  }
  ctx.add(rivet);
  // (en el centro, bajo el vidrio, se esconden las 2 sierras grandes en cruz: ver más abajo)

  // ---------------------------------------------------------- borde: cordón con neón, abrazaderas y aberturas
  const towerAngles = TOWER_ANGLES;
  // frente a cada torre hay una abertura en la pared: 2 son pasarelas y 4 son caídas al vacío
  const WALK_ANGLES = [towerAngles[0], towerAngles[3]]; // adelante-derecha y atrás-izquierda
  const DROP_ANGLES = [towerAngles[1], towerAngles[2], towerAngles[4], towerAngles[5]];
  const gaps = [
    ...WALK_ANGLES.map((a) => ({ a, half: 0.052 })),
    ...DROP_ANGLES.map((a) => ({ a, half: 0.075 })),
  ].sort((p, q) => p.a - q.a);
  const arcs = gaps.map((g, i) => {
    const nx = gaps[(i + 1) % gaps.length];
    let a1 = nx.a - nx.half;
    if (i === gaps.length - 1) a1 += Math.PI * 2;
    return [g.a + g.half, a1];
  });
  const curbIn = R - 0.6, curbOut = R + 0.35, curbH = 0.55;
  const hazard = new THREE.MeshStandardMaterial({ map: stripe, metalness: 0.3, roughness: 0.55 });
  const clampGeo = new RoundedBoxGeometry(1.15, 1.05, 1.35, 3, 0.14);
  // cada tramo del borde se parte en: cordón normal (rebota) o pinches (te clavás)
  const SPIKE_ANGLES = SAW_ANGLES; // detrás de cada sierra
  const SPIKE_HALF = 0.26; // medio ancho del tramo (el doble que antes: un módulo más a cada lado)
  const pieces = [];
  for (const [a0, a1] of arcs) {
    let cur = a0;
    const inside = SPIKE_ANGLES.map((a) => (a < a0 ? a + Math.PI * 2 : a)).filter((a) => a - SPIKE_HALF > a0 && a + SPIKE_HALF < a1).sort((p, q) => p - q);
    for (const sa of inside) {
      pieces.push([cur, sa - SPIKE_HALF, 'curb']);
      pieces.push([sa - SPIKE_HALF, sa + SPIKE_HALF, 'spike']);
      cur = sa + SPIKE_HALF;
    }
    pieces.push([cur, a1, 'curb']);
  }
  const spikeMat = new THREE.MeshStandardMaterial({ color: '#cfc8dc', metalness: 0.9, roughness: 0.22, envMapIntensity: 0.8 });
  const redStripe = new THREE.MeshStandardMaterial({ map: stripesTex('#d42a2a', '#1d1418', 10), metalness: 0.3, roughness: 0.55 });
  const SPIKE_LEN = 1.4; // un toque más largos: atraviesan a la gelatina clavada
  const SPIKE_BASE = curbIn + 0.08; // radio donde nacen (dentro del cordón)
  const spikeGeo = new THREE.ConeGeometry(0.17, 1, 8);
  const spikeMesh = new THREE.InstancedMesh(spikeGeo, spikeMat, 800);
  spikeMesh.castShadow = true;
  let spikeCount = 0;
  const _sq = new THREE.Quaternion(), _sp = new THREE.Vector3(), _ss = new THREE.Vector3(1, 1, 1), _in = new THREE.Vector3();
  const spikeLights = [];
  const spikes = [];
  const _sm = new THREE.Matrix4();
  const setSpike = (sp) => {
    const rr = SPIKE_BASE - sp.len / 2;
    _sp.set(Math.cos(sp.a) * rr, sp.y, Math.sin(sp.a) * rr);
    _ss.set(1, sp.len, 1);
    spikeMesh.setMatrixAt(sp.i, _sm.compose(_sp, sp.q, _ss));
  };
  for (const [a0, a1, type] of pieces) {
    const spike = type === 'spike';
    const h = spike ? 1.5 : curbH;
    const curb = new THREE.Mesh(arcCurb(curbIn, curbOut, a0, a1, h, Math.ceil((a1 - a0) * 60)), spike ? iron : copper);
    curb.castShadow = curb.receiveShadow = true;
    ctx.add(curb);
    const trimTop = new THREE.Mesh(arcTube(curbOut + 0.02, 0.07, a0, a1, Math.ceil((a1 - a0) * 80)), brass);
    trimTop.position.y = h + 0.04;
    const band = new THREE.Mesh(arcBand(R - 1.5, curbIn - 0.02, a0, a1, Math.ceil((a1 - a0) * 100), Math.round(((a1 - a0) * R) / 7)), spike ? redStripe : hazard);
    band.position.y = 0.013;
    ctx.add(trimTop, band);
    if (!spike) {
      const tube = new THREE.Mesh(arcTube(curbIn + 0.12, 0.2, a0, a1, Math.ceil((a1 - a0) * 80)), neonPink);
      tube.position.y = curbH + 0.12;
      ctx.add(tube);
    } else {
      // púas de acero apuntando hacia el centro, en dos filas
      const len = (a1 - a0) * curbIn;
      for (const [y, off] of [[0.45, 0], [1.05, 0.5]]) {
        const n = Math.floor(len / 0.6);
        for (let i = 0; i < n && spikeCount < 800; i++) {
          const a = a0 + (((i + 0.5 + off * 0.5) / n) * (a1 - a0));
          _in.set(-Math.cos(a), 0, -Math.sin(a));
          _sq.setFromUnitVectors(UP, _in);
          const sp = { a, y, q: _sq.clone(), len: SPIKE_LEN, target: SPIKE_LEN, i: spikeCount++ };
          spikes.push(sp);
          setSpike(sp);
        }
      }
      // luces rojas en las puntas del tramo
      for (const a of [a0 + 0.01, a1 - 0.01]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.2, 0.2), toneMapped: false }));
        lamp.position.set(Math.cos(a) * (R - 0.1), h + 0.35, Math.sin(a) * (R - 0.1));
        ctx.add(lamp);
        spikeLights.push(lamp);
      }
    }
    const N = Math.ceil((a1 - a0) / 0.08);
    const rc = (curbIn + curbOut) / 2;
    for (let i = 0; i < N; i++) {
      const b0 = a0 + ((a1 - a0) * i) / N, b1 = a0 + ((a1 - a0) * (i + 1)) / N;
      wall(ctx, Math.cos(b0) * rc, Math.sin(b0) * rc, Math.cos(b1) * rc, Math.sin(b1) * rc, { height: spike ? 1.6 : 0.85, thick: curbOut - curbIn, visual: false, restitution: spike ? 0.1 : 0.5 });
    }
    if (!spike) {
      const nClamp = Math.max(1, Math.round(((a1 - a0) * R) / 9));
      for (let i = 0; i <= nClamp; i++) {
        const a = a0 + 0.012 + ((a1 - a0 - 0.024) * i) / nClamp;
        const cl = new THREE.Mesh(clampGeo, brass);
        cl.position.set(Math.cos(a) * (R - 0.12), 0.52, Math.sin(a) * (R - 0.12));
        cl.rotation.y = -a;
        cl.castShadow = true;
        ctx.add(cl);
      }
    }
  }
  spikeMesh.count = spikeCount;
  ctx.add(spikeMesh);
  // aberturas de caída: franja de peligro en el piso + balizas que parpadean
  const beacons = [];
  const BEACON = new THREE.Color(1.8, 0.5, 0.1);
  for (const a of DROP_ANGLES) {
    const warn = new THREE.Mesh(arcBand(R - 3.2, R, a - 0.075, a + 0.075, 16, 2), hazard);
    warn.position.y = 0.015;
    ctx.add(warn);
    for (const s of [-1, 1]) {
      const b = a + s * 0.085;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.4, 10), brassDark);
      post.position.set(Math.cos(b) * (R - 0.1), 0.7, Math.sin(b) * (R - 0.1));
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: BEACON.clone(), toneMapped: false }));
      lamp.position.set(post.position.x, 1.55, post.position.z);
      ctx.add(post, lamp);
      beacons.push(lamp);
    }
  }

  // lateral de la plataforma
  const sideBand = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.36, R + 0.36, 1.8, 192, 1, true), copper);
  sideBand.position.y = -0.9;
  const trimLow = new THREE.Mesh(arcTube(R + 0.4, 0.14, 0, Math.PI * 2, 192), brass);
  trimLow.position.y = -1.8;
  ctx.add(sideBand, trimLow);
  const winGeo = new RoundedBoxGeometry(2.2, 0.8, 0.12, 2, 0.08), frameGeo = new RoundedBoxGeometry(2.5, 1.05, 0.08, 2, 0.06), barGeo = new THREE.BoxGeometry(0.07, 0.8, 0.08);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + 0.08;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * (R + 0.38), -0.95, Math.sin(a) * (R + 0.38));
    g.rotation.y = Math.PI / 2 - a;
    const frame = new THREE.Mesh(frameGeo, brassDark);
    frame.position.z = -0.04;
    g.add(frame, new THREE.Mesh(winGeo, fire));
    for (let k = 0; k < 4; k++) {
      const bar = new THREE.Mesh(barGeo, windowBars);
      bar.position.set(-0.75 + k * 0.5, 0, 0.08);
      g.add(bar);
    }
    ctx.add(g);
  }

  // ---------------------------------------------------------- estructura inferior: cuenco + columna central hasta las nubes
  const bowl = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(R + 0.36, -1.8), new THREE.Vector2(R - 0.4, -4), new THREE.Vector2(R - 5, -7.5),
    new THREE.Vector2(R - 14, -10.5), new THREE.Vector2(16, -13), new THREE.Vector2(10, -16), new THREE.Vector2(9, -18),
  ], 96), iron);
  ctx.add(bowl);
  for (const [yy, rr] of [[-4, R - 0.35], [-7.5, R - 4.95]]) {
    const t = new THREE.Mesh(arcTube(rr, 0.2, 0, Math.PI * 2, 128), brassDark);
    t.position.y = yy;
    ctx.add(t);
  }
  const column = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 130, 48, 1, true), copper);
  column.position.y = -18 - 65;
  ctx.add(column);
  for (let y = -24; y > -120; y -= 12) {
    const hoop = new THREE.Mesh(arcTube(9.6 + (-y - 18) * 0.015, 0.45, 0, Math.PI * 2, 64), brass);
    hoop.position.y = y;
    ctx.add(hoop);
  }
  // hornos en el cuenco
  for (const a of [Math.PI / 2, Math.PI / 2 + 1.0, Math.PI / 2 - 1.0, -Math.PI / 2]) {
    const furnace = new THREE.Group();
    furnace.position.set(Math.cos(a) * (R + 0.1), -3.3, Math.sin(a) * (R + 0.1));
    furnace.rotation.y = Math.PI / 2 - a;
    furnace.rotateX(0.33);
    const fw = new THREE.Mesh(new RoundedBoxGeometry(6, 2.2, 0.3, 3, 0.4), fire);
    const ff = new THREE.Mesh(new RoundedBoxGeometry(6.8, 2.8, 0.2, 3, 0.45), brass);
    ff.position.z = -0.1;
    furnace.add(ff, fw);
    for (let k = 0; k < 9; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.14), windowBars);
      bar.position.set(-2.6 + k * 0.65, 0, 0.18);
      furnace.add(bar);
    }
    ctx.add(furnace);
  }

  // ---------------------------------------------------------- torres alrededor (todo nace de acá)
  const towerTopY = (k) => (Math.sin(towerAngles[k]) > 0.4 ? -2 : k === 4 ? 6 : 16); // las de adelante son bajas para no tapar
  const towerPos = (k) => new THREE.Vector3(Math.cos(towerAngles[k]) * TOWER_D, 0, Math.sin(towerAngles[k]) * TOWER_D);
  const towerWinGeo = new RoundedBoxGeometry(1.6, 2.4, 0.2, 2, 0.3);
  const smokeTops = [];
  for (let k = 0; k < 6; k++) {
    const p = towerPos(k), topY = towerTopY(k), bottomY = -110, h = topY - bottomY;
    const g = new THREE.Group();
    g.position.copy(p);
    // +z local mira hacia el centro de la plataforma
    g.rotation.y = Math.atan2(-p.x, -p.z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R, TOWER_R + 1.2, h, 40, 1, true), copper);
    body.position.y = bottomY + h / 2;
    g.add(body);
    const hasDoor = WALK_ANGLES.includes(towerAngles[k]);
    for (let y = topY - 3; y > bottomY + 10; y -= 9) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(TOWER_R + 0.2 + (topY - y) * 0.004, 0.3, 8, 48), brass);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.y = y;
      g.add(hoop);
      for (const ang of [-0.5, 0, 0.5]) {
        if (hasDoor && Math.abs(ang) < 0.1 && y - 4.5 > -6) continue; // ahí va la puerta
        const wnd = new THREE.Mesh(towerWinGeo, fire);
        wnd.position.set(Math.sin(ang) * (TOWER_R + 0.15), y - 4.5, Math.cos(ang) * (TOWER_R + 0.15));
        wnd.rotation.y = ang;
        g.add(wnd);
      }
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R + 0.8, TOWER_R + 0.8, 1, 40), brassDark);
    cap.position.y = topY + 0.5;
    g.add(cap);
    if (k !== 4) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(TOWER_R + 0.6, 4.5, 40), copper);
      roof.position.y = topY + 3.2;
      const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 5, 16), brass);
      chim.position.set(2.5, topY + 4, -1.5);
      g.add(roof, chim);
      smokeTops.push(new THREE.Vector3(2.5, topY + 6.6, -1.5).applyMatrix4(new THREE.Matrix4().compose(g.position, g.quaternion, new THREE.Vector3(1, 1, 1))));
    }
    const l = lantern(brass, lampGlow, 2);
    l.position.set(0, topY + 1, TOWER_R + 0.5);
    if (k !== 4) g.add(l);
    ctx.add(g);
    // vigas radiales desde el cuenco hasta la torre (debajo de la plataforma)
    const dir = new THREE.Vector3(Math.cos(towerAngles[k]), 0, Math.sin(towerAngles[k]));
    for (const [y0, y1] of [[-9, -14], [-14, -19]]) {
      const a2 = dir.clone().multiplyScalar(R - 6).setY(y0), b2 = dir.clone().multiplyScalar(TOWER_D - TOWER_R).setY(y1);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, a2.distanceTo(b2)), brassDark);
      beam.position.copy(a2).add(b2).multiplyScalar(0.5);
      beam.lookAt(b2);
      ctx.add(beam);
    }
  }
  // anillos de vigas que unen las torres
  for (const y of [-14, -40]) {
    const ring = new THREE.Mesh(arcTube(TOWER_D, 0.9, 0, Math.PI * 2, 160), brassDark);
    ring.position.y = y;
    ctx.add(ring);
  }

  // ---------------------------------------------------------- pasarelas: van del borde a la puerta de una torre
  const gridTex = canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#1c1426'; g.fillRect(0, 0, w, w);
    g.strokeStyle = '#7a6896'; g.lineWidth = 3;
    for (let x = 0; x <= w; x += 12) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, w); g.stroke();
      g.beginPath(); g.moveTo(0, x); g.lineTo(w, x); g.stroke();
    }
  }, { repeat: [6, 2] });
  const gridMat = new THREE.MeshStandardMaterial({ map: gridTex, metalness: 0.7, roughness: 0.45 });
  const WALK_W = 1.9;
  const WALK_START = R - 1, WALK_END = TOWER_D - TOWER_R;
  const WALK_L = WALK_END - WALK_START;
  const walks = WALK_ANGLES.map((ga) => {
    const dir = new THREE.Vector3(Math.cos(ga), 0, Math.sin(ga));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const mid = dir.clone().multiplyScalar(WALK_START + WALK_L / 2);
    const g = new THREE.Group();
    g.position.copy(mid);
    g.rotation.y = Math.atan2(-dir.z, dir.x);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(WALK_L, 0.2, WALK_W * 2), gridMat);
    deck.position.y = -0.1;
    deck.receiveShadow = true;
    g.add(deck);
    for (const s of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(WALK_L, 0.35, 0.18), brassDark);
      beam.position.set(0, -0.2, s * WALK_W);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, WALK_L, 8), brass);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, 1.05, s * WALK_W);
      const rail2 = rail.clone();
      rail2.position.y = 0.55;
      g.add(beam, rail, rail2);
      for (let k = 0; k <= 10; k++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.1, 8), brass);
        post.position.set(-WALK_L / 2 + (k / 10) * WALK_L, 0.55, s * WALK_W);
        g.add(post);
      }
      const lpost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.6, 8), brassDark);
      lpost.position.set(-WALK_L / 2 + 1.5, 0.8, s * (WALK_W + 0.1));
      const l = lantern(brass, lampGlow, 1.1);
      l.position.set(-WALK_L / 2 + 1.5, 1.6, s * (WALK_W + 0.1));
      g.add(lpost, l);
    }
    // puerta de la torre al final
    const door = new THREE.Mesh(new RoundedBoxGeometry(3.2, 3.6, 0.3, 3, 0.5), fire);
    door.position.set(WALK_L / 2 + 0.1, 1.8, 0);
    door.rotation.y = Math.PI / 2;
    const doorFrame = new THREE.Mesh(new RoundedBoxGeometry(4.2, 4.4, 0.3, 3, 0.6), brass);
    doorFrame.position.set(WALK_L / 2 + 0.25, 2.1, 0);
    doorFrame.rotation.y = Math.PI / 2;
    g.add(doorFrame, door);
    for (let k = 0; k < 5; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.4, 0.15), windowBars);
      bar.position.set(WALK_L / 2 - 0.08, 1.8, -1.2 + k * 0.6);
      g.add(bar);
    }
    // ménsulas que sostienen la pasarela
    for (const x of [-WALK_L / 2 + 2, WALK_L / 2 - 2]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), brassDark);
      brace.position.set(x, -2.1, 0);
      brace.rotation.z = x < 0 ? -0.5 : 0.5;
      g.add(brace);
    }
    ctx.add(g);
    const q = g.quaternion;
    ctx.collider(RAPIER.ColliderDesc.cuboid(WALK_L / 2, 0.1, WALK_W).setTranslation(mid.x, -0.1, mid.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.5));
    for (const s of [-1, 1]) {
      const p = mid.clone().addScaledVector(side, s * WALK_W);
      ctx.collider(RAPIER.ColliderDesc.cuboid(WALK_L / 2, 0.6, 0.08).setTranslation(p.x, 0.6, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setRestitution(0.4));
    }
    const endP = dir.clone().multiplyScalar(WALK_END + 0.2);
    ctx.collider(RAPIER.ColliderDesc.cuboid(0.3, 2, WALK_W + 0.3).setTranslation(endP.x, 2, endP.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setRestitution(0.5));
    const light = new THREE.PointLight('#ffa040', 14, 14, 1.8);
    light.position.copy(dir.clone().multiplyScalar(WALK_END - 1.5)).setY(3);
    ctx.add(light);
    return { dir, side };
  });

  // cadenas con faroles colgando de las pasarelas
  const link = new THREE.TorusGeometry(0.13, 0.035, 6, 10);
  const chainMesh = new THREE.InstancedMesh(link, iron, 200);
  let li = 0;
  const _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
  const chains = [];
  for (const w of walks) {
    for (const d of [4, 10]) {
      const p = w.dir.clone().multiplyScalar(WALK_START + d).addScaledVector(w.side, WALK_W + 0.1);
      const n = 12 + Math.round(Math.random() * 6);
      for (let k = 0; k < n && li < 200; k++, li++) {
        _p.set(p.x, -0.3 - k * 0.2, p.z);
        _q.setFromEuler(new THREE.Euler(Math.PI / 2, k % 2 ? Math.PI / 2 : 0, 0));
        chainMesh.setMatrixAt(li, new THREE.Matrix4().compose(_p, _q, _s));
      }
      const l = lantern(brass, lampGlow, 1.3);
      l.position.set(p.x, -0.3 - n * 0.2 - 1.05, p.z);
      ctx.add(l);
      chains.push(ctx.dynamic(l));
    }
  }
  chainMesh.count = li;
  ctx.add(chainMesh);

  // ---------------------------------------------------------- caldera arriba de la torre 4 (atrás a la izquierda)
  const t4 = towerPos(4);
  const boiler = new THREE.Group();
  boiler.position.set(t4.x, towerTopY(4) + 1 + 5.5, t4.z);
  boiler.rotation.y = Math.atan2(t4.z, -t4.x); // eje +x local (puerta) mira al centro
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 12, 40), copper);
  tank.rotation.z = Math.PI / 2;
  boiler.add(tank);
  for (const x of [-5, -1.8, 1.8, 5]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(5.55, 0.22, 8, 48), brass);
    hoop.rotation.y = Math.PI / 2;
    hoop.position.x = x;
    boiler.add(hoop);
  }
  const endCap = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.3, 40), brassDark);
  endCap.rotation.z = Math.PI / 2;
  endCap.position.x = 6;
  const doorRing = new THREE.Mesh(new THREE.TorusGeometry(4, 0.5, 12, 48), brass);
  doorRing.rotation.y = Math.PI / 2;
  doorRing.position.x = 6.15;
  const doorFire = new THREE.Mesh(new THREE.CircleGeometry(3.7, 40), fire);
  doorFire.rotation.y = Math.PI / 2;
  doorFire.position.x = 6.1;
  boiler.add(endCap, doorRing, doorFire);
  for (let k = 0; k < 6; k++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 7, 0.35), windowBars);
    bar.position.set(6.3, 0, -2.9 + k * 1.16);
    boiler.add(bar);
  }
  for (const z of [-3.5, 3.5]) {
    const leg = new THREE.Mesh(new RoundedBoxGeometry(9, 2.2, 1.2, 2, 0.2), brassDark);
    leg.position.set(0, -5, z);
    boiler.add(leg);
  }
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 9, 16), brass);
  stack.position.set(-3.5, 8.5, 0);
  boiler.add(stack);
  const g2 = gauge(brass, 1.1);
  ctx.dynamic(g2.needle);
  g2.group.position.set(2.5, 6.8, 0);
  g2.group.rotation.y = Math.PI / 2;
  const g2post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 8), brassDark);
  g2post.position.set(2.5, 5.8, 0);
  boiler.add(g2.group, g2post);
  ctx.add(boiler);
  smokeTops.push(new THREE.Vector3(-3.5, 13.2, 0).applyMatrix4(new THREE.Matrix4().compose(boiler.position, boiler.quaternion, new THREE.Vector3(1, 1, 1))));
  const boilerLight = new THREE.PointLight('#ff8a30', 50, 34, 1.6);
  boilerLight.position.copy(t4).multiplyScalar(0.8).setY(boiler.position.y);
  ctx.add(boilerLight);

  // ---------------------------------------------------------- caños: salen del cuenco y entran a las torres
  const pipe = (pts, r = 0.85) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    ctx.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, r, 14), copper));
    for (const t of [0.12, 0.5, 0.88]) {
      const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const fl = new THREE.Mesh(new THREE.TorusGeometry(r + 0.05, 0.18, 8, 20), brass);
      fl.position.copy(p);
      fl.lookAt(p.clone().add(tan));
      ctx.add(fl);
    }
  };
  for (const [k, da, y0, y1] of [[1, 0.35, -5, -8], [2, -0.3, -6, -20], [5, 0.25, -5, -12], [4, -0.25, -5, -3]]) {
    const a = towerAngles[k] + da * 0.4;
    const tp = towerPos(k);
    const start = new THREE.Vector3(Math.cos(a) * (R - 1.5), y0, Math.sin(a) * (R - 1.5));
    const end = tp.clone().add(new THREE.Vector3(-Math.cos(towerAngles[k]), 0, -Math.sin(towerAngles[k])).multiplyScalar(TOWER_R - 0.5)).setY(y1);
    const midP = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, -4, 0));
    pipe([start, start.clone().lerp(midP, 0.5).setY(y0 - 2.5), midP, end]);
  }

  // engranajes gigantes montados al costado de las torres de atrás (con eje)
  const bigGears = [];
  const bigGear = (r, teeth) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(gearGeometry(r, teeth, r * 0.12, r * 0.12, r * 0.78), brass));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, r * 0.2, 24), brassDark);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
    for (let k = 0; k < 6; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, r * 0.62, r * 0.08), brass);
      sp.position.y = r * 0.48;
      const pivot = new THREE.Group();
      pivot.rotation.z = (k / 6) * Math.PI * 2;
      pivot.add(sp);
      g.add(pivot);
    }
    return g;
  };
  for (const [k, side, y, r, w] of [[5, 1, 8, 7, 0.12], [3, -1, 9, 6, -0.15]]) {
    const tp = towerPos(k);
    const axisDir = new THREE.Vector3(-Math.sin(towerAngles[k]), 0, Math.cos(towerAngles[k])).multiplyScalar(side);
    const center = tp.clone().addScaledVector(axisDir, TOWER_R + 1.2).setY(y);
    const g = bigGear(r, Math.round(r * 2.4));
    g.position.copy(center);
    g.lookAt(center.clone().add(axisDir));
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, 2.4, 16), iron);
    axle.position.copy(tp).addScaledVector(axisDir, TOWER_R + 0.2).setY(y);
    axle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisDir);
    ctx.add(g, axle);
    bigGears.push({ g: ctx.dynamic(g), w });
  }

  // ---------------------------------------------------------- botones rojos en la pared (uno por pozo, mismo número)
  const btnRed = new THREE.MeshStandardMaterial({ color: '#ff1a1a', emissive: '#ff0000', emissiveIntensity: 1.2, roughness: 0.25, metalness: 0.1 });
  for (const h of HOLES) {
    const dir = new THREE.Vector3(Math.cos(h.btn), 0, Math.sin(h.btn));
    const g = new THREE.Group();
    g.position.copy(dir).multiplyScalar(curbIn - 0.35);
    g.rotation.y = Math.atan2(-dir.x, -dir.z); // +z local mira al centro
    const housing = new THREE.Mesh(new RoundedBoxGeometry(1.8, 2.4, 0.8, 3, 0.15), brassDark);
    housing.position.set(0, 1.2, -0.1);
    housing.castShadow = true;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 0.22, 28), brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 1.05, 0.38);
    const dome = ctx.dynamic(new THREE.Mesh(new THREE.SphereGeometry(0.56, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), btnRed.clone())); // se hunde al apretarlo
    dome.rotation.x = Math.PI / 2;
    dome.position.set(0, 1.05, 0.45);
    const signTex = canvasTex(128, 64, (c, w, hh) => {
      c.fillStyle = '#1d1418'; c.fillRect(0, 0, w, hh);
      c.strokeStyle = '#e8a000'; c.lineWidth = 5; c.strokeRect(3, 3, w - 6, hh - 6);
      c.fillStyle = '#ff3b3b'; c.font = 'bold 44px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(h.label, w / 2, hh / 2 + 2);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(0, 2.05, 0.31);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.2, 0.2), toneMapped: false }));
    lamp.position.set(0, 2.6, 0);
    g.add(housing, ring, dome, sign, lamp);
    ctx.add(g);
    const q = g.quaternion;
    const cpos = g.position.clone().setY(1.2);
    ctx.collider(RAPIER.ColliderDesc.cuboid(0.9, 1.2, 0.5).setTranslation(cpos.x, cpos.y, cpos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setRestitution(0.4));
    h.button = { dome, lamp, press: 0, point: dir.clone().multiplyScalar(curbIn - 1.2).setY(1) };
  }
  // púas que atraviesan a una gelatina clavada: se alargan lo justo para asomar por delante
  const pinned = new Set();
  const updateSpikes = (dt) => {
    for (const sp of spikes) sp.target = SPIKE_LEN;
    for (const j of pinned) {
      if (!j.impaled) { pinned.delete(j); continue; }
      const S = j.size, rc = Math.hypot(j.pos.x, j.pos.z), ja = Math.atan2(j.pos.z, j.pos.x);
      const depth = j.pinnedDepth, w = R_JELLY * 0.95 * S, hh = j.height * 0.5 * S;
      const yc = j.pos.y + (j.centerY + 0.05) * S;
      for (const sp of spikes) {
        const l = Math.abs(Math.atan2(Math.sin(sp.a - ja), Math.cos(sp.a - ja))) * curbIn;
        if (l > w) continue;
        const e = (l / w) ** 2 + ((sp.y - yc) / hh) ** 2;
        if (e > 0.75) continue;
        const front = rc - depth * Math.sqrt(1 - e);
        sp.target = Math.max(sp.target, SPIKE_BASE - front + 0.38);
      }
    }
    let dirty = false;
    for (const sp of spikes) {
      if (Math.abs(sp.len - sp.target) < 0.002) continue;
      sp.len += (sp.target - sp.len) * (1 - Math.exp(-(sp.target > sp.len ? 30 : 6) * dt));
      setSpike(sp);
      dirty = true;
    }
    if (dirty) spikeMesh.instanceMatrix.needsUpdate = true;
  };

  const pressButton = (h, j, game) => {
    h.state = 'warn';
    h.timer = 1.0;
    h.presser = j;
    h.btnCd = 1 + 6 + 2;
    h.button.press = 0.35;
    sfx.button();
    game.shake(0.25);
  };

  // ---------------------------------------------------------- géiseres: uno frente a cada torre (anillo interior)
  // Se disparan en ronda: uno cada VENT_PERIOD/6 segundos, dando la vuelta a la arena.
  const VENT_D = 27, VENT_PERIOD = 9.9, VS = 1.3;
  const VENTS = TOWER_ANGLES.map((a, k) => ({ x: Math.cos(a) * VENT_D, z: Math.sin(a) * VENT_D, off: (k * VENT_PERIOD) / 6 }));
  const ventState = (v, t) => {
    const ph = (t + v.off) % VENT_PERIOD;
    return ph < VENT_PERIOD - 2.2 ? 'idle' : ph < VENT_PERIOD - 1.2 ? 'warn' : 'blast';
  };
  const vents = VENTS.map((v) => {
    const g = new THREE.Group();
    g.position.set(v.x, 0, v.z);
    g.scale.setScalar(VS);
    const plate = new THREE.Mesh(arcBand(1.2, 1.85, 0, Math.PI * 2, 48, 1), brass);
    plate.position.y = 0.03;
    const outer = new THREE.Mesh(arcTube(1.85, 0.12, 0, Math.PI * 2, 48), brassDark);
    outer.position.y = 0.05;
    const inner = new THREE.Mesh(arcTube(1.2, 0.09, 0, Math.PI * 2, 48), brassDark);
    inner.position.y = 0.05;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), new THREE.MeshBasicMaterial({ color: '#1a0e10' }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = 0.02;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshBasicMaterial({ color: ORANGE.clone().multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.25 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.025;
    g.add(plate, outer, inner, hole, glow);
    for (let k = 0; k < 12; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 0.09), brass);
      const a = (k / 12) * Math.PI * 2;
      b.position.set(Math.cos(a) * 0.6, 0.04, Math.sin(a) * 0.6);
      b.rotation.y = -a;
      g.add(b);
    }
    ctx.add(g);
    return { ...v, glow, state: 'idle' };
  });

  // ---------------------------------------------------------- sierras circulares
  // Cada una tiene una ranura en el piso. Brota en un extremo, la recorre y se esconde. La que toque, la parte al medio.
  //  · 3 en el anillo, entre pozo y pozo, cerca de la pared: se turnan (una cada SAW_PERIOD/3 s)
  //  · 2 grandes en cruz en el centro: salen una y después la otra (nunca las dos juntas)
  const SAW_D = 48, SAW_R = 2.6, SAW_HALF = 6.5, SAW_PERIOD = 8;
  const BIG_R = 3.8, BIG_HALF = 12;
  // fases: escondida → aviso (chispas) → brota → recorre → se esconde (activa ~3.3 s de cada SAW_PERIOD)
  const sawState = (t, R, half) => {
    const hidden = -R - 0.4, up = R * 0.35;
    const cyc = Math.floor((t + 2) / SAW_PERIOD), ph = (t + 2) % SAW_PERIOD;
    const sign = cyc % 2 ? 1 : -1, ends = half - R * 0.55;
    let y = hidden, u = -sign * ends, st = 'idle';
    if (ph >= 4.6 && ph < 5.6) st = 'warn';
    else if (ph >= 5.6 && ph < 5.9) { st = 'rise'; y = hidden + (up - hidden) * ((ph - 5.6) / 0.3) ** 0.6; }
    else if (ph >= 5.9 && ph < 7.5) { st = 'out'; y = up; const k = (ph - 5.9) / 1.6; u = -sign * ends + 2 * sign * ends * (k * k * (3 - 2 * k)); }
    else if (ph >= 7.5 && ph < 7.85) { st = 'sink'; y = up + (hidden - up) * ((ph - 7.5) / 0.35); u = sign * ends; }
    return { y, u, st };
  };
  // piezas compartidas (las grandes usan las mismas, escaladas)
  const bladeShape = new THREE.Shape();
  const TEETH = 40;
  for (let k = 0; k < TEETH; k++) {
    const a0 = (k / TEETH) * Math.PI * 2, a1 = ((k + 0.78) / TEETH) * Math.PI * 2, a2 = ((k + 1) / TEETH) * Math.PI * 2;
    const p0 = [Math.cos(a0) * SAW_R * 0.88, Math.sin(a0) * SAW_R * 0.88];
    if (k === 0) bladeShape.moveTo(...p0); else bladeShape.lineTo(...p0);
    bladeShape.lineTo(Math.cos(a1) * SAW_R, Math.sin(a1) * SAW_R); // punta del diente (inclinada)
    bladeShape.lineTo(Math.cos(a2 - 0.01) * SAW_R * 0.9, Math.sin(a2 - 0.01) * SAW_R * 0.9);
  }
  const arbor = new THREE.Path();
  arbor.absarc(0, 0, 0.22, 0, Math.PI * 2, true);
  bladeShape.holes.push(arbor);
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 8 });
  bladeGeo.translate(0, 0, -0.04);
  const steel = new THREE.MeshStandardMaterial({ color: '#d4d4de', metalness: 0.95, roughness: 0.22, envMapIntensity: 1.1 });
  const sawStripe = new THREE.MeshStandardMaterial({ map: stripesTex('#e8a000', '#1d1418', 18), metalness: 0.4, roughness: 0.5 });
  const slotW = 0.55;
  const slotMat = new THREE.MeshBasicMaterial({ color: '#0b0508' });
  const sawCapGeo = new RoundedBoxGeometry(0.35, 0.14, slotW + 0.7, 2, 0.05);
  const hubGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.22, 24), hubInGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.3, 6);
  const sawRingGeo = new THREE.RingGeometry(1.0, 1.08, 40), sawRingMat = new THREE.MeshBasicMaterial({ color: '#7a7a86', side: THREE.DoubleSide });
  const sawSlotGeo = new THREE.BoxGeometry(0.9, 0.06, 0.1), sawSlotMat = new THREE.MeshBasicMaterial({ color: '#2a2630' });
  const blurGeo = new THREE.RingGeometry(SAW_R * 0.8, SAW_R * 1.02, 48);
  // x, z: centro de la ranura · dir: a lo largo de la ranura · gap: hueco en las barandas (donde se cruzan dos)
  const makeSaw = ({ x, z, dir, R = SAW_R, half = SAW_HALF, off = 0, gap = 0, lift = 0 }) => {
    const n = new THREE.Vector3(dir.z, 0, -dir.x); // normal del disco
    const g = new THREE.Group();
    g.position.set(x, lift, z);
    g.rotation.y = Math.atan2(-dir.z, dir.x); // x local = a lo largo de la ranura
    const slotL = half * 2;
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(slotL, slotW), slotMat);
    slot.rotation.x = -Math.PI / 2; slot.position.y = 0.025;
    const slotGlow = new THREE.Mesh(new THREE.PlaneGeometry(slotL - 0.3, slotW * 0.45), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.25, 0.1), toneMapped: false, transparent: true, opacity: 0.2 }));
    slotGlow.rotation.x = -Math.PI / 2; slotGlow.position.y = 0.03;
    g.add(slot, slotGlow);
    // barandas con franjas a los costados (con un hueco en el medio si se cruza con otra ranura)
    const pieces = gap ? [[-half - 0.3, -gap], [gap, half + 0.3]] : [[-half - 0.3, half + 0.3]];
    for (const [a0, a1] of pieces) {
      const railGeo = new RoundedBoxGeometry(a1 - a0, 0.12, 0.35, 2, 0.04);
      for (const sd of [-1, 1]) {
        const rail = new THREE.Mesh(railGeo, sawStripe);
        rail.position.set((a0 + a1) / 2, 0.06, sd * (slotW / 2 + 0.17));
        rail.receiveShadow = true;
        g.add(rail);
      }
    }
    for (const ex of [-1, 1]) {
      const cap = new THREE.Mesh(sawCapGeo, brassDark);
      cap.position.set(ex * (half + 0.45), 0.07, 0);
      g.add(cap);
    }
    const pivot = ctx.dynamic(new THREE.Group()); // se mueve a lo largo de la ranura y sube/baja
    g.add(pivot);
    const blade = new THREE.Group();
    const bladeMesh = new THREE.Mesh(bladeGeo, steel);
    bladeMesh.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, brass);
    hub.rotation.x = Math.PI / 2;
    const hubIn = new THREE.Mesh(hubInGeo, iron);
    hubIn.rotation.x = Math.PI / 2;
    blade.add(bladeMesh, hub, hubIn, new THREE.Mesh(sawRingGeo, sawRingMat));
    for (let k = 0; k < 4; k++) {
      const sl = new THREE.Mesh(sawSlotGeo, sawSlotMat);
      const b = (k / 4) * Math.PI * 2;
      sl.position.set(Math.cos(b) * 1.55, Math.sin(b) * 1.55, 0);
      sl.rotation.z = b;
      blade.add(sl);
    }
    const blur = new THREE.Mesh(blurGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    blade.add(blur);
    blade.scale.setScalar(R / SAW_R);
    pivot.add(blade);
    pivot.position.y = -R - 0.4;
    ctx.add(g);
    return {
      x, z, dir, n, R, half, off, pivot, blade, blur, slotGlow, prev: 'idle', big: R > SAW_R,
      at: (u, y) => new THREE.Vector3(x + dir.x * u, y, z + dir.z * u),
      state: (t) => sawState(t + off, R, half),
    };
  };
  const SAWS = [
    ...SAW_ANGLES.map((a, k) => makeSaw({
      x: Math.cos(a) * SAW_D, z: Math.sin(a) * SAW_D, dir: new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), off: (k * SAW_PERIOD) / 3,
    })),
    // cruz del centro: una a lo largo de las pasarelas y la otra perpendicular, a medio período (se alternan)
    ...[0, 1].map((k) => {
      const a = TOWER_ANGLES[0] + (k * Math.PI) / 2;
      return makeSaw({ x: 0, z: 0, dir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), R: BIG_R, half: BIG_HALF, off: (k * SAW_PERIOD) / 2, gap: slotW / 2 + 0.6, lift: k * 0.004 });
    }),
  ];
  const BIG_SAWS = SAWS.filter((s) => s.big);

  // ---------------------------------------------------------- pinches del piso: 6 placas, una frente a cada torre
  // (entre cada pozo y cada sierra). Salen en dos turnos: 3 placas y después las otras 3.
  // Avisan (los agujeros se ponen rojos y las puntas asoman), salen de golpe, y bajan.
  const PAD_D = 44, PAD_W = 8, PAD_DEPTH = 4.8, PAD_PERIOD = 7;
  const PAD_HIDDEN = -1.62, PAD_PEEK = -1.38, PAD_UP = 0;
  const padTex = canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#2b2433'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4a3f57'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    for (let i = 0; i < 8; i++) for (let k = 0; k < 5; k++) {
      const x = ((i + 0.5) / 8) * w, y = ((k + 0.5) / 5) * h;
      g.fillStyle = '#0b0608'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    }
  });
  const padGlowTex = canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) for (let k = 0; k < 5; k++) {
      const x = ((i + 0.5) / 8) * w, y = ((k + 0.5) / 5) * h;
      g.strokeStyle = '#ff3010'; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.stroke();
    }
  });
  const PAD_LEN = 1.5;
  const padSpikeGeo = new THREE.ConeGeometry(0.17, PAD_LEN, 8);
  padSpikeGeo.translate(0, PAD_LEN / 2, 0); // la base en y = 0
  const _padM = new THREE.Matrix4();
  // púas que atraviesan a una gelatina clavada desde abajo: se alargan hasta asomar por arriba
  const updatePadSpikes = (pad, dt) => {
    for (const b of pad.base) b.target = PAD_LEN;
    for (const j of pad.victims) {
      if (!j.impaled) continue;
      const dx = j.pos.x - pad.x, dz = j.pos.z - pad.z;
      const lx = dx * pad.dir.x + dz * pad.dir.z, lz = -(dx * pad.rad.x + dz * pad.rad.z); // en coordenadas de la placa
      const S = j.size, w = R_JELLY * 0.95 * S, hh = j.height * 0.5 * S;
      const yc = j.pos.y + (j.centerY + 0.05) * S;
      for (const b of pad.base) {
        const e = ((b.x - lx) ** 2 + (b.z - lz) ** 2) / (w * w);
        if (e > 0.8) continue;
        b.target = Math.max(b.target, yc + hh * Math.sqrt(1 - e) - pad.y + 0.35);
      }
    }
    let dirty = false;
    pad.base.forEach((b, i) => {
      if (Math.abs(b.len - b.target) < 0.002) return;
      b.len += (b.target - b.len) * (1 - Math.exp(-(b.target > b.len ? 30 : 6) * dt));
      _padM.makeScale(1, b.len / PAD_LEN, 1).setPosition(b.x, 0, b.z);
      pad.spikes.setMatrixAt(i, _padM);
      dirty = true;
    });
    if (dirty) pad.spikes.instanceMatrix.needsUpdate = true;
  };
  const padFrameGeo = new RoundedBoxGeometry(PAD_W + 0.5, 0.1, 0.3, 2, 0.04), padFrameSideGeo = new RoundedBoxGeometry(0.3, 0.1, PAD_DEPTH + 0.2, 2, 0.04);
  const PADS = TOWER_ANGLES.map((a, k) => {
    const x = Math.cos(a) * PAD_D, z = Math.sin(a) * PAD_D;
    const dir = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)); // a lo ancho (tangente)
    const rad = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)); // hacia la pared
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(-dir.z, dir.x); // x local = a lo ancho
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(PAD_W, PAD_DEPTH), new THREE.MeshStandardMaterial({
      map: padTex, metalness: 0.6, roughness: 0.45, emissive: '#ffffff', emissiveMap: padGlowTex, emissiveIntensity: 0,
    }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.022;
    plate.receiveShadow = true;
    g.add(plate);
    for (const sd of [-1, 1]) {
      const fz = new THREE.Mesh(padFrameGeo, sawStripe);
      fz.position.set(0, 0.05, sd * (PAD_DEPTH / 2 + 0.15));
      const fx_ = new THREE.Mesh(padFrameSideGeo, sawStripe);
      fx_.position.set(sd * (PAD_W / 2 + 0.1), 0.05, 0);
      g.add(fz, fx_);
    }
    const spikes = new THREE.InstancedMesh(padSpikeGeo, spikeMat, 40);
    const base = [];
    for (let ix = 0; ix < 8; ix++) for (let iz = 0; iz < 5; iz++) base.push({ x: ((ix + 0.5) / 8 - 0.5) * PAD_W, z: ((iz + 0.5) / 5 - 0.5) * PAD_DEPTH, len: PAD_LEN, target: PAD_LEN });
    base.forEach((b, i) => spikes.setMatrixAt(i, _padM.makeTranslation(b.x, 0, b.z)));
    spikes.castShadow = true;
    spikes.position.y = PAD_HIDDEN;
    g.add(spikes);
    ctx.add(g);
    return { x, z, dir, rad, plate, spikes, base, y: PAD_HIDDEN, off: (k % 2) * (PAD_PERIOD / 2), prev: 'idle', victims: new Set() };
  });
  const padState = (pad, t) => {
    const ph = (t + pad.off) % PAD_PERIOD;
    return ph < 4.3 ? 'idle' : ph < 5.3 ? 'warn' : ph < 6.6 ? 'up' : 'idle';
  };
  // ¿(x, z) está sobre la placa (con margen m)?
  const onPad = (pad, x, z, m) => {
    const dx = x - pad.x, dz = z - pad.z;
    return Math.abs(dx * pad.dir.x + dz * pad.dir.z) < PAD_W / 2 + m && Math.abs(dx * pad.rad.x + dz * pad.rad.z) < PAD_DEPTH / 2 + m;
  };


  // ---------------------------------------------------------- nubes (mar de nubes abajo + lejanas)
  const cloudTex = canvasTex(256, 256, (g, w) => {
    for (let k = 0; k < 22; k++) {
      const x = 50 + Math.random() * 156, y = 90 + Math.random() * 90, r = 30 + Math.random() * 50;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.38)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, w);
    }
  });
  const clouds = [];
  // menos nubes pero más grandes (cada una es un dibujo aparte): el mar se ve igual
  for (let i = 0; i < 46; i++) {
    const below = i < 32;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex,
      color: new THREE.Color().setHSL(0.78 + Math.random() * 0.14, 0.5, below ? 0.3 + Math.random() * 0.18 : 0.42 + Math.random() * 0.15),
      transparent: true, depthWrite: false, opacity: 0.9,
    }));
    const a = Math.random() * Math.PI * 2, r = below ? 20 + Math.random() * 130 : 110 + Math.random() * 90;
    s.position.set(Math.cos(a) * r, below ? -70 + Math.random() * 30 : -25 + Math.random() * 35, Math.sin(a) * r);
    s.scale.setScalar((45 + Math.random() * 55) * 1.4);
    s.userData = { a, r, w: 0.003 + Math.random() * 0.005 };
    ctx.add(s);
    clouds.push(s);
  }

  // luces rosas del neón
  for (let i = 0; i < 6; i++) {
    const a = BETWEEN[i]; // frente a cada pozo y cada sierra
    const l = new THREE.PointLight('#ff4ee0', 10, 14, 1.8);
    l.position.set(Math.cos(a) * (R - 2.5), 1.6, Math.sin(a) * (R - 2.5));
    ctx.add(l);
  }

  // fondo pintado opcional: public/fondos/steam.(jpg|png|webp)
  backdrop(ctx, ['steam.jpg', 'steam.png', 'steam.webp'], {
    onLoad: () => { for (const c of clouds) if (c.position.y > -40) c.visible = false; },
  });

  // todo lo que no se mueve, en una malla por material (cientos de dibujos menos por frame)
  const frozen = ctx.freeze();
  console.info(`Steampunk: ${frozen.before} piezas fijas juntadas en ${frozen.after} mallas`);

  // ---------------------------------------------------------- lógica
  // ¿(x, z) está sobre la ranura de la sierra sw (con margen m)?
  const onSlot = (sw, x, z, m) => {
    const sx = x - sw.x, sz = z - sw.z;
    return Math.abs(sx * sw.n.x + sz * sw.n.z) < m && Math.abs(sx * sw.dir.x + sz * sw.dir.z) < sw.half + m - 1;
  };
  const inWalk = (x, z) => walks.some((w) => {
    const along = x * w.dir.x + z * w.dir.z;
    const lat = Math.abs(x * w.side.x + z * w.side.z);
    return along > R - 1.5 && along < WALK_END && lat < WALK_W;
  });

  return {
    name: 'Steampunk',
    R,
    pickupScale: 2.5,
    fog: ['#4e2462', 100, 340],
    bloom: [0.28, 0.5, 0.95],
    floorAt: (x, z) => (x * x + z * z < R * R && !inOpenHole(x, z)) || inWalk(x, z),
    // para los bots: además del piso, evita pinches y pozos abiertos/por abrirse
    safeAt(x, z) {
      if (!this.floorAt(x, z)) return false;
      const rc = Math.hypot(x, z);
      if (rc > curbIn - 3.5) {
        const ang = Math.atan2(z, x);
        for (const sa of SPIKE_ANGLES) if (Math.abs(Math.atan2(Math.sin(ang - sa), Math.cos(ang - sa))) < SPIKE_HALF + 0.06) return false;
      }
      for (const h of HOLES) if (h.state !== 'closed' && (x - h.x) ** 2 + (z - h.z) ** 2 < (h.r + 1.2) ** 2) return false;
      // ranuras de las sierras: las del anillo siempre; las del centro sólo cuando avisan o están afuera
      for (const sw of SAWS) if ((!sw.big || sw.state(this._t || 0).st !== 'idle') && onSlot(sw, x, z, 3)) return false;
      for (const pad of PADS) if ((pad.y > PAD_HIDDEN + 0.05 || padState(pad, this._t || 0) === 'warn') && onPad(pad, x, z, 1.5)) return false;
      return true;
    },
    // dónde reaparecer: lejos de las ranuras de las sierras, los pozos y los géiseres
    spawnOk(x, z) {
      if (inHole(x, z, 1.5)) return false;
      for (const v of VENTS) if (Math.hypot(x - v.x, z - v.z) < 3.5) return false;
      for (const sw of SAWS) if (onSlot(sw, x, z, 3.5)) return false;
      for (const pad of PADS) if (onPad(pad, x, z, 2.5)) return false;
      return true;
    },
    // en el centro caen más bolitas, y muchas especiales: es tentador, pero están las sierras
    hotspot: { x: 0, z: 0, r: BIG_HALF, share: 0.3, power: 0.5 },
    players: 16, // gelatinas en esta arena
    // trampas para que los bots aprendan a usarlas
    traps: HOLES.map((h) => ({ x: h.x, z: h.z, r: h.r, button: h.button.point, ready: () => h.state === 'closed' && h.btnCd <= 0 })),
    preStep(dt, t) {
      this._t = t;
    },
    postStep(dt, game) {
      const t = game.time;
      // sierras (el sonido depende de qué tan cerca estás)
      const me = game.jellies.find((j) => j.isPlayer);
      for (const sw of SAWS) {
        const ss = sw.state(t);
        if (ss.st !== sw.prev) {
          const vol = me && !me.dead ? Math.max(0.2, 1 - Math.hypot(me.pos.x - sw.x, me.pos.z - sw.z) / 80) : 0.5;
          if (ss.st === 'warn') sfx.sawWarn(vol);
          if (ss.st === 'rise') { sfx.sawRise(vol); game.shake(0.25 * vol); }
          sw.prev = ss.st;
        }
        if (ss.st === 'warn' && Math.random() < dt * 30) fx.burst(sw.at((Math.random() * 2 - 1) * sw.half * 0.9, 0.1), ORANGE, 1, 4, UP, 0.04, true);
        if (ss.st !== 'rise' && ss.st !== 'out' && ss.st !== 'sink') continue;
        const top = ss.y + sw.R;
        if (top <= 0.2) continue;
        // chispas donde el disco toca el piso
        const half = Math.sqrt(Math.max(0, sw.R * sw.R - ss.y * ss.y));
        if (Math.random() < dt * 40) fx.burst(sw.at(ss.u - half, 0.08), ORANGE, 2, 7, sw.dir.clone().negate().setY(0.6), 0.05, true);
        if (Math.random() < dt * 20) fx.burst(sw.at(ss.u + half, 0.08), ORANGE, 1, 5, sw.dir.clone().setY(0.6), 0.04, true);
        const c = sw.at(ss.u, ss.y);
        for (const j of game.jellies) {
          if (j.dead || j.impaled) continue;
          const rx = j.pos.x - c.x, ry = j.pos.y - c.y, rz = j.pos.z - c.z;
          const dn = rx * sw.n.x + rz * sw.n.z;
          if (Math.abs(dn) > j.r * 0.8 + 0.1) continue;
          const du = rx * sw.dir.x + rz * sw.dir.z;
          if (Math.hypot(du, ry) > sw.R + j.r * 0.35 || j.pos.y - j.r * 0.8 > top) continue;
          game.slice(j, { normal: sw.n, along: sw.dir, point: new THREE.Vector3(j.pos.x - sw.n.x * dn, j.pos.y, j.pos.z - sw.n.z * dn) });
        }
      }
      // pinches del piso
      for (const pad of PADS) {
        const st = padState(pad, t);
        for (const j of pad.victims) {
          if (!j.impaled) { pad.victims.delete(j); continue; }
          // se va hundiendo despacio, atravesada por las púas
          j.pos.y = Math.max(j.r * 0.7, j.pos.y - dt * 0.3);
          j.prevPos.y = j.pos.y;
        }
        // mientras haya alguien clavado, los pinches no bajan
        const target = pad.victims.size || st === 'up' ? PAD_UP : st === 'warn' ? ((t + pad.off) % PAD_PERIOD > 5.0 ? PAD_PEEK : PAD_HIDDEN) : PAD_HIDDEN;
        pad.y += Math.sign(target - pad.y) * Math.min(Math.abs(target - pad.y), (target > pad.y ? 14 : 4) * dt);
        if (st !== pad.prev) {
          const vol = me && !me.dead ? Math.max(0.2, 1 - Math.hypot(me.pos.x - pad.x, me.pos.z - pad.z) / 80) : 0.5;
          if (st === 'warn') sfx.spikesWarn(vol);
          if (st === 'up') { sfx.spikesUp(vol); game.shake(0.2 * vol); fx.burst(new THREE.Vector3(pad.x, 0.3, pad.z), ORANGE, 10, 5, UP, 0.05, true); }
          pad.prev = st;
        }
        if (pad.y < -0.55) continue; // todavía no asoman lo suficiente
        for (const j of game.jellies) {
          if (j.dead || j.impaled || j.pos.y - j.r > 1.1 || !onPad(pad, j.pos.x, j.pos.z, j.r * 0.3)) continue;
          // clavado desde abajo: queda pataleando arriba de las púas y revienta
          game.impale(j, new THREE.Vector3(j.pos.x, j.r + 0.4, j.pos.z), UP, 1.7);
          pad.victims.add(j);
        }
      }
      // pinches del borde: si te tiran contra ellos (o te tirás corriendo) quedás clavado
      for (const j of game.jellies) {
        if (j.dead || j.impaled || j.pos.y > 2.4) continue;
        const rc = Math.hypot(j.pos.x, j.pos.z);
        if (rc + j.r < curbIn - 1.1) continue; // las puntas sobresalen ~1.3 del cordón
        if (rc > curbIn) continue; // ya pasó por encima del borde: cae al vacío, no se clava
        const ang = Math.atan2(j.pos.z, j.pos.x);
        for (const sa of SPIKE_ANGLES) {
          const d = Math.atan2(Math.sin(ang - sa), Math.cos(ang - sa));
          if (Math.abs(d) > SPIKE_HALF + 0.01) continue;
          const inward = new THREE.Vector3(-j.pos.x / rc, 0, -j.pos.z / rc);
          const towardWall = j.contact.dot(inward) > j.impact * 0.4; // el golpe vino de la pared
          const outV = -j.vBefore.dot(inward); // velocidad yendo hacia los pinches
          if ((towardWall && ((j.stunned && j.impact > 2) || j.impact > 4)) || outV > 1.5) {
            // queda aplastado contra el cordón y las púas lo atraviesan
            const center = new THREE.Vector3(j.pos.x, Math.max(j.r, Math.min(j.pos.y, 1.2)), j.pos.z);
            const rr = curbIn - 0.05 - j.pinnedDepth;
            center.x = (-inward.x) * rr; center.z = (-inward.z) * rr;
            game.impale(j, center, inward);
            pinned.add(j);
          }
          break;
        }
      }
      // botones rojos → abren su pozo
      for (const h of HOLES) {
        h.btnCd = Math.max(0, h.btnCd - dt);
        if (h.state === 'closed' && h.btnCd <= 0) {
          for (const j of game.jellies) {
            if (j.dead || j.impaled) continue;
            const d = Math.hypot(j.pos.x - h.button.point.x, j.pos.z - h.button.point.z);
            if (d < j.r + 1.0 && (j.dashing || j.impact > 7)) { pressButton(h, j, game); break; }
          }
        } else if (h.state === 'warn') {
          h.timer -= dt;
          if (h.timer <= 0) { h.state = 'open'; h.timer = 6; h.open = true; h.col.setEnabled(false); sfx.whoosh(); }
        } else if (h.state === 'open') {
          h.timer -= dt;
          // si alguien cae, el KO es de quien apretó el botón (y se reparte con quien lo empujó)
          for (const j of game.jellies) {
            if (j.dead || j === h.presser) continue;
            if ((j.pos.x - h.x) ** 2 + (j.pos.z - h.z) ** 2 < (h.r + 0.5) ** 2 && j.pos.y < 1.5) { j.trapBy = h.presser; j.trapTime = t; } // el que apretó el botón (se reparte con quien lo empujó)
          }
          if (h.timer <= 0) { h.state = 'closed'; h.open = false; h.col.setEnabled(true); }
        }
      }
      for (const j of game.jellies) {
        if (j.dead || j.impaled || j.hazardCd > 0) continue;
        for (const v of vents) {
          if (v.state === 'blast' && Math.hypot(j.pos.x - v.x, j.pos.z - v.z) < 1.5 * VS + j.r * 0.4 && j.pos.y < 5) {
            const vel = j.body.linvel();
            game.hazardHit(j, { vx: vel.x * 0.5, vy: 21, vz: vel.z * 0.5, stun: 0.25, dmg: 3, color: new THREE.Color('#ffffff'), sound: null, point: null });
            j.hazardCd = 0.5;
          }
        }
      }
      for (const v of vents) {
        const st = ventState(v, t);
        if (st === 'blast' && v.state !== 'blast') sfx.steam();
        v.state = st;
      }
    },
    update(t, dt) {
      updateSpikes(dt);
      for (const g of gearsFloor) g.m.rotation.z = t * g.w;
      for (const g of bigGears) g.g.rotateZ(g.w * dt);
      for (let i = 0; i < beacons.length; i++) {
        const on = Math.sin(t * 6 + (i % 2) * Math.PI) > 0;
        beacons[i].material.color.copy(BEACON).multiplyScalar(on ? 1 : 0.12);
      }

      // la luz del centro titila cuando va a salir una de las sierras grandes
      const bigWarn = BIG_SAWS.some((sw) => sw.state(t).st === 'warn');
      centerLight.intensity = bigWarn ? 40 + Math.sin(t * 22) * 10 : 11 + Math.sin(t * 5) * 2;
      g2.needle.rotation.z = Math.sin(t * 0.7) * 0.9 + Math.sin(t * 13) * 0.04;

      for (const pad of PADS) {
        pad.spikes.position.y = pad.y;
        updatePadSpikes(pad, dt);
        const st = padState(pad, t);
        pad.plate.material.emissiveIntensity = st === 'warn' ? (Math.sin(t * 24) > 0 ? 2.2 : 0.4) : pad.y > PAD_HIDDEN + 0.05 ? 1.2 : 0;
      }
      for (const sw of SAWS) {
        const ss = sw.state(t);
        sw.pivot.position.set(ss.u, ss.y, 0);
        sw.pivot.visible = ss.st === 'rise' || ss.st === 'out' || ss.st === 'sink'; // guardada no se ve (bajo el vidrio del centro se vería)
        const spinning = ss.st !== 'idle';
        if (spinning) sw.blade.rotation.z -= dt * 32;
        sw.blur.material.opacity = spinning && ss.st !== 'warn' ? 0.22 : 0;
        sw.slotGlow.material.opacity = ss.st === 'warn' ? (Math.sin(t * 24) > 0 ? 0.95 : 0.25) : ss.st === 'idle' ? 0.15 : 0.7;
      }
      for (const v of vents) {
        v.glow.material.opacity = v.state === 'blast' ? 0.95 : v.state === 'warn' ? 0.5 + Math.sin(t * 20) * 0.3 : 0.3;
        const rate = v.state === 'blast' ? 45 : v.state === 'warn' ? 12 : 6;
        if (Math.random() < rate * dt) {
          const strong = v.state === 'blast';
          fx.puff(new THREE.Vector3(v.x + (Math.random() - 0.5) * VS, 0.3, v.z + (Math.random() - 0.5) * VS),
            new THREE.Vector3((Math.random() - 0.5) * 0.8 + 0.4, strong ? 13 + Math.random() * 6 : 3 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8),
            { size: (strong ? 2.2 : 1.2) * VS, life: strong ? 1.1 : 2.2, alpha: strong ? 0.75 : 0.45, grow: strong ? 2 : 2.6 });
        }
      }
      for (let i = 0; i < spikeLights.length; i++) spikeLights[i].material.color.setRGB(Math.sin(t * 4 + i) > 0 ? 2 : 0.3, 0.15, 0.15);
      for (const h of HOLES) {
        const target = h.open ? 1 : 0;
        h.amount += (target - h.amount) * (1 - Math.exp(-(target ? 9 : 5) * dt));
        for (const d of h.doors) d.rotation.z = d.userData.side * h.amount * Math.PI * 0.5;
        const warn = h.state === 'warn';
        h.band.material.emissiveIntensity = warn ? 0.25 + 0.25 * Math.sin(t * 14) : h.open ? 0.3 : 0;
        h.edge.visible = warn || h.amount > 0.02;
        if (h.edge.visible) h.edge.material.opacity = warn ? 0.55 + 0.45 * Math.sin(t * 14) : 0.85 * h.amount;
        const b = h.button;
        b.press = Math.max(0, b.press - dt);
        b.dome.position.z = 0.45 - (b.press > 0 ? 0.25 : 0);
        const ready = h.state === 'closed' && h.btnCd <= 0;
        b.dome.material.emissiveIntensity = ready ? 0.9 + Math.sin(t * 5) * 0.6 : 0.15;
        b.lamp.material.color.setRGB(ready ? 2 : h.open ? (Math.sin(t * 12) > 0 ? 2 : 0.3) : 0.25, 0.2, 0.2);
        if (!h.open) continue;
        if (Math.random() < dt * 2.5) fx.puff(new THREE.Vector3(h.x + (Math.random() - 0.5) * h.r, -1.5, h.z + (Math.random() - 0.5) * h.r), new THREE.Vector3(0, 2.5 + Math.random() * 1.5, 0), { size: h.r * 0.8, life: 2.2, color: '#ffd9f0', alpha: 0.3, grow: 2.2 });
      }
      for (const p of smokeTops) {
        if (Math.random() < dt * 2) fx.puff(p.clone().add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)), new THREE.Vector3(0.8, 3, 0.3), { size: 4, life: 4, color: '#ecdcf4', grow: 3, alpha: 0.35 });
      }
      boilerLight.intensity = 46 + Math.sin(t * 7) * 5 + Math.random() * 4;
      for (const c of clouds) {
        c.userData.a += c.userData.w * dt;
        c.position.x = Math.cos(c.userData.a) * c.userData.r;
        c.position.z = Math.sin(c.userData.a) * c.userData.r;
      }
      chains.forEach((l, i) => { l.rotation.z = Math.sin(t * 1.3 + i) * 0.05; });
    },
    dispose: () => ctx.dispose(),
  };
}
