import * as THREE from 'three';
import { createCtx, buildFloor, circlePts, wall, skyDome, backdrop } from './common.js';

// Arena original: plataforma de piedra flotante con muretes y huecos.
export function buildCrystal(scene, world) {
  const ctx = createCtx(scene, world);
  const R = 20;

  skyDome(ctx, '#0c0420', '#2a1050', '#12052a');

  const stone = new THREE.MeshStandardMaterial({ color: '#5c4a8c', roughness: 0.8 });
  const side = new THREE.MeshStandardMaterial({ color: '#463670', roughness: 0.9 });
  buildFloor(ctx, { outline: circlePts(R, 96), top: stone, side });

  const glowLine = new THREE.MeshBasicMaterial({ color: '#b98cff', transparent: true, opacity: 0.5 });
  for (const [a, b] of [[12, 12.25], [4.3, 4.5], [17.6, 17.75]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(a, b, 128), glowLine);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    ctx.add(ring);
  }

  const rock = new THREE.MeshStandardMaterial({ color: '#4b2d7a', roughness: 0.6, flatShading: true, emissive: '#6a1fd0', emissiveIntensity: 0.25 });
  const base = new THREE.Mesh(new THREE.ConeGeometry(R - 0.6, 11, 16, 3), rock);
  base.rotation.x = Math.PI;
  base.position.y = -1.6 - 5.5;
  ctx.add(base);
  const crystal = new THREE.MeshStandardMaterial({ color: '#c48bff', emissive: '#9b4dff', emissiveIntensity: 1.2, roughness: 0.2, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
    const r = 9 + Math.random() * 8;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.8 + Math.random() * 0.8, 3 + Math.random() * 4, 5), crystal);
    c.position.set(Math.cos(a) * r, -3 - Math.random() * 2, Math.sin(a) * r);
    c.rotation.set(Math.PI + (Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
    ctx.add(c);
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: '#7a68ad', roughness: 0.7 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#ffc27a', emissive: '#ff9a3c', emissiveIntensity: 2.5 });
  const SEG = 12, span = 0.36, rr = R - 0.45;
  for (let i = 0; i < SEG; i++) {
    const th = (i / SEG) * Math.PI * 2 + 0.2;
    const a0 = th - span / 2, a1 = th + span / 2;
    const g = wall(ctx, Math.cos(a0) * rr, Math.sin(a0) * rr, Math.cos(a1) * rr, Math.sin(a1) * rr, { mat: wallMat });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(g.userData.len * 0.55, 0.18, 0.05), lamp);
    // lado interior: hacia el centro
    const inward = new THREE.Vector3(-g.position.x, 0, -g.position.z).normalize();
    const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
    strip.position.set(0, 0.15, localZ.dot(inward) > 0 ? 0.42 : -0.42);
    g.add(strip);
  }

  const rocks = [];
  const fl = new THREE.MeshStandardMaterial({ color: '#5a4590', roughness: 0.7, flatShading: true, emissive: '#3b1a7a', emissiveIntensity: 0.3 });
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7 + Math.random() * 2.2, 0), fl);
    const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 40;
    m.position.set(Math.cos(a) * r, -16 + Math.random() * 34, Math.sin(a) * r);
    m.userData = { y: m.position.y, s: Math.random() * 10, r: (Math.random() - 0.5) * 0.4 };
    ctx.add(m);
    rocks.push(m);
  }

  const N = 600, pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 80;
    pts.set([Math.cos(a) * r, -40 + Math.random() * 80, Math.sin(a) * r], i * 3);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#c9a6ff', size: 0.25, transparent: true, opacity: 0.7 }));
  ctx.add(dust);

  backdrop(ctx, ['crystal.jpg', 'crystal.png', 'crystal.webp']);

  return {
    name: 'Cristal',
    R,
    fog: ['#2a1050', 45, 160],
    floorAt: (x, z) => x * x + z * z < R * R,
    preStep() {},
    postStep() {},
    update(t) {
      for (const m of rocks) {
        m.position.y = m.userData.y + Math.sin(t * 0.5 + m.userData.s) * 0.6;
        m.rotation.y += m.userData.r * 0.01;
        m.rotation.x += m.userData.r * 0.006;
      }
      dust.rotation.y = t * 0.01;
    },
    dispose: () => ctx.dispose(),
  };
}
