import * as THREE from 'three';
import {
  createCtx, buildFloor, canvasTex, stripesTex, circlePts, wall, skyDome, gearGeometry,
  arcBand, arcCurb, arcTube, lantern, backdrop,
} from './common.js';

// Arena del tutorial: un Steampunk chiquito (radio 16 en vez de 60) y sin peligros.
// Cerrada con baranda (no te podés caer), una diana donde espera la gelatina de práctica,
// engranajes que giran afuera y el mismo fondo pintado que el Steampunk.
export const DUMMY_HOME = new THREE.Vector3(0, 0, -5);
const PLAYER_HOME = new THREE.Vector3(0, 0, 6);

export function buildTutorial(scene, world) {
  const ctx = createCtx(scene, world);
  const R = 16;

  skyDome(ctx, '#1c0a38', '#7a3c7a', '#2a0f44');

  const brass = new THREE.MeshStandardMaterial({ color: '#a8783a', metalness: 0.75, roughness: 0.45, envMapIntensity: 0.6 });
  const brassDark = new THREE.MeshStandardMaterial({ color: '#6e4f28', metalness: 0.7, roughness: 0.5, envMapIntensity: 0.5 });
  const copper = new THREE.MeshStandardMaterial({ color: '#8e5234', metalness: 0.7, roughness: 0.48, envMapIntensity: 0.5 });
  const iron = new THREE.MeshStandardMaterial({ color: '#33283f', metalness: 0.7, roughness: 0.55, envMapIntensity: 0.5 });
  const neonPink = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5ae8').multiplyScalar(1.5), toneMapped: false });
  const lampGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.95, 0.4), toneMapped: false });

  // ---------------------------------------------------------- piso: chapas violetas con remaches (como el Steampunk)
  const floorTex = canvasTex(1024, 1024, (g, w) => {
    const c = w / 2, px = c / R;
    g.fillStyle = '#3a2a66';
    g.fillRect(0, 0, w, w);
    const plate = (r0, r1, a0, a1) => {
      const l = 19 + Math.random() * 8;
      g.fillStyle = `hsl(${264 + Math.random() * 8}, 40%, ${l}%)`;
      g.beginPath(); g.arc(c, c, r1, a0, a1); g.arc(c, c, r0, a1, a0, true); g.closePath(); g.fill();
    };
    const r1 = 6 * px, r2 = 11 * px;
    for (let i = 0; i < 8; i++) plate(0, r1, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2);
    for (let i = 0; i < 12; i++) plate(r1, r2, ((i + 0.5) / 12) * Math.PI * 2, ((i + 1.5) / 12) * Math.PI * 2);
    for (let i = 0; i < 16; i++) plate(r2, c, (i / 16) * Math.PI * 2, ((i + 1) / 16) * Math.PI * 2);
    g.strokeStyle = '#21183a'; g.lineWidth = 4;
    const seam = (a, ra, rb) => { g.beginPath(); g.moveTo(c + Math.cos(a) * ra, c + Math.sin(a) * ra); g.lineTo(c + Math.cos(a) * rb, c + Math.sin(a) * rb); g.stroke(); };
    for (let i = 0; i < 8; i++) seam((i / 8) * Math.PI * 2, 0, r1);
    for (let i = 0; i < 12; i++) seam(((i + 0.5) / 12) * Math.PI * 2, r1, r2);
    for (let i = 0; i < 16; i++) seam((i / 16) * Math.PI * 2, r2, c);
    for (const rr of [r1, r2]) { g.beginPath(); g.arc(c, c, rr, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#9586bd';
    for (const rr of [r1 - 7, r1 + 7, r2 - 7, r2 + 7, c - 22]) {
      const n = Math.round(rr * 0.3);
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; g.beginPath(); g.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 2.5, 0, Math.PI * 2); g.fill(); }
    }
  });
  const top = new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.6, roughness: 0.28, envMapIntensity: 0.7 });
  buildFloor(ctx, { outline: circlePts(R, 128), top, side: copper, uvScale: R });

  // cuenco de cobre debajo de la plataforma
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.3, 3, 7, 32, 1, true), copper);
  bowl.position.y = -1.6 - 3.5;
  const bowlRing = new THREE.Mesh(new THREE.TorusGeometry(R - 0.2, 0.25, 8, 96), brass);
  bowlRing.rotation.x = Math.PI / 2;
  bowlRing.position.y = -1.6;
  ctx.add(bowl, bowlRing);

  // engranaje grande incrustado en el centro del piso (gira despacio, sólo de adorno)
  const floorGear = ctx.dynamic(new THREE.Mesh(gearGeometry(3.2, 18, 0.35, 0.04, 0.9), brassDark));
  floorGear.rotation.x = -Math.PI / 2;
  floorGear.position.y = 0.02;
  floorGear.receiveShadow = true;
  ctx.add(floorGear);

  // diana donde espera la gelatina de práctica
  const stripe = stripesTex('#e8a000', '#1d1418', 10);
  const hazard = new THREE.MeshStandardMaterial({ map: stripe, metalness: 0.3, roughness: 0.55 });
  const target = new THREE.Mesh(arcBand(2.1, 2.5, 0, Math.PI * 2, 64, 10), hazard);
  target.position.set(DUMMY_HOME.x, 0.015, DUMMY_HOME.z);
  const targetIn = new THREE.Mesh(arcBand(0.9, 1.05, 0, Math.PI * 2, 48, 1), brass);
  targetIn.position.set(DUMMY_HOME.x, 0.016, DUMMY_HOME.z);
  ctx.add(target, targetIn);

  // ---------------------------------------------------------- borde: cordón con neón + baranda (no hay por dónde caerse)
  const curbIn = R - 0.6, curbOut = R + 0.35, curbH = 0.55;
  const curb = new THREE.Mesh(arcCurb(curbIn, curbOut, 0, Math.PI * 2, curbH, 160), copper);
  curb.castShadow = curb.receiveShadow = true;
  const band = new THREE.Mesh(arcBand(R - 1.5, curbIn - 0.02, 0, Math.PI * 2, 160, 14), hazard);
  band.position.y = 0.013;
  const tube = new THREE.Mesh(arcTube(curbIn + 0.12, 0.2, 0, Math.PI * 2, 160), neonPink);
  tube.position.y = curbH + 0.12;
  ctx.add(curb, band, tube);
  for (const y of [1.25, 2.0]) {
    const rail = new THREE.Mesh(arcTube(curbOut - 0.15, 0.07, 0, Math.PI * 2, 160), brass);
    rail.position.y = y;
    ctx.add(rail);
  }
  const POSTS = 24;
  const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.5, 8);
  for (let i = 0; i < POSTS; i++) {
    const a = (i / POSTS) * Math.PI * 2;
    const p = new THREE.Mesh(postGeo, brass);
    p.position.set(Math.cos(a) * (curbOut - 0.15), curbH + 0.75, Math.sin(a) * (curbOut - 0.15));
    ctx.add(p);
  }
  // colisión: pared alta e invisible siguiendo el borde (aunque saltes, no salís)
  const rc = (curbIn + curbOut) / 2, SEG = 40;
  for (let i = 0; i < SEG; i++) {
    const b0 = (i / SEG) * Math.PI * 2, b1 = ((i + 1) / SEG) * Math.PI * 2;
    wall(ctx, Math.cos(b0) * rc, Math.sin(b0) * rc, Math.cos(b1) * rc, Math.sin(b1) * rc, { height: 6, thick: curbOut - curbIn, visual: false, restitution: 0.5 });
  }

  // faroles sobre el borde
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const l = lantern(brass, lampGlow, 1.4);
    l.position.set(Math.cos(a) * (R - 0.1), curbH + 0.05, Math.sin(a) * (R - 0.1));
    ctx.add(l);
  }
  for (const a of [Math.PI * 0.25, Math.PI * 1.25]) {
    const l = new THREE.PointLight('#ff4ee0', 8, 12, 1.8);
    l.position.set(Math.cos(a) * (R - 2), 1.6, Math.sin(a) * (R - 2));
    ctx.add(l);
  }

  // ---------------------------------------------------------- afuera: dos torres de fondo con engranajes gigantes
  const gears = [];
  for (const [a, gr, sp] of [[-Math.PI / 2 - 0.55, 5.5, 0.25], [-Math.PI / 2 + 0.6, 4, -0.35]]) {
    const d = R + 7;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 26, 12), iron);
    tower.position.set(x, -4, z);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.2, 3, 12), copper);
    cap.position.set(x, 10.5, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.75, 0.2, 8, 24), brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 6, z);
    ctx.add(tower, cap, ring);
    const g = ctx.dynamic(new THREE.Mesh(gearGeometry(gr, Math.round(gr * 4), 0.6, 0.7, gr * 0.3), brass));
    g.position.set(x * 0.86, 5, z * 0.86);
    g.lookAt(0, 5, 0);
    g.castShadow = true;
    ctx.add(g);
    gears.push({ g, sp });
  }

  backdrop(ctx, ['steam.jpg', 'steam.png', 'steam.webp']);
  ctx.freeze();

  return {
    name: 'Steampunk (tutorial)',
    R,
    tutorial: true,
    players: 2, // vos + la gelatina de práctica
    pickupScale: 0, // no cae nada: las armas te las da el tutorial
    fog: ['#4e2462', 60, 260],
    bloom: [0.28, 0.5, 0.95],
    floorAt: (x, z) => x * x + z * z < R * R,
    // siempre en el mismo lugar: vos de este lado, la de práctica en la diana
    spawnAt: (j) => (j.isPlayer ? PLAYER_HOME : DUMMY_HOME).clone().setY(R_SPAWN),
    preStep() {},
    postStep() {},
    update(t, dt) {
      floorGear.rotation.z = t * 0.08;
      for (const { g, sp } of gears) g.rotateZ(sp * dt);
    },
    dispose: () => ctx.dispose(),
  };
}

const R_SPAWN = 2; // altura desde la que aparecen (caen un poquito)
