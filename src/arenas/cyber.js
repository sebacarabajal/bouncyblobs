import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createCtx, buildFloor, canvasTex, stripesTex, rectPts, wall, skyDome, backdrop } from './common.js';
import { fx } from '../fx.js';
import { sfx } from '../sfx.js';

const PINK = new THREE.Color('#ff3df2');
const CYAN = new THREE.Color('#33e6ff');

// Azotea cyberpunk octogonal: cerco eléctrico, trampillas que se abren, bumpers con flechas.
export function buildCyber(scene, world) {
  const ctx = createCtx(scene, world);
  const A = 20; // apotema
  const VR = A / Math.cos(Math.PI / 8);
  const outline = Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    return [Math.cos(a) * VR, Math.sin(a) * VR];
  });
  const normals = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.cos((i * Math.PI) / 4), 0, Math.sin((i * Math.PI) / 4)));

  skyDome(ctx, '#0a0218', '#3d1366', '#14042a');

  // ---------------------------------------------------------- piso
  const floorTex = canvasTex(1024, 1024, (g, w) => {
    g.fillStyle = '#17121f';
    g.fillRect(0, 0, w, w);
    const n = 14, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = `hsl(${262 + Math.random() * 10}, 16%, ${15 + Math.random() * 7}%)`;
      g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      for (const [bx, by] of [[6, 6], [s - 9, 6], [6, s - 9], [s - 9, s - 9]]) g.fillRect(i * s + bx, j * s + by, 3, 3);
    }
    // charcos / reflejos de neón
    for (let k = 0; k < 70; k++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,60,230,0.07)' : 'rgba(60,220,255,0.06)';
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * w, 10 + Math.random() * 60, 4 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  const top = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.22, metalness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: '#221b30', roughness: 0.4, metalness: 0.8 });
  const PITS = [{ x: -10, z: 6 }, { x: 10.5, z: -7 }];
  const PH = 2.2;
  buildFloor(ctx, { outline, holes: PITS.map((p) => rectPts(p.x, p.z, PH, PH)), top, side: metal, uvScale: VR });

  // anillos de neón en el piso
  const neon = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6), transparent: true, opacity: o, toneMapped: false });
  const flat = (geo, mat, y = 0.015) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; return ctx.add(m); };
  for (let i = 0; i < 6; i++) {
    flat(new THREE.RingGeometry(7.8, 8.05, 48, 1, (i / 6) * Math.PI * 2 + 0.12, Math.PI / 3 - 0.24), neon(i % 2 ? PINK : CYAN, 0.8));
  }
  flat(new THREE.RingGeometry(13.6, 14.4, 96), new THREE.MeshStandardMaterial({ color: '#0d0a14', roughness: 0.5, metalness: 0.6 }), 0.01);
  for (let i = 0; i < 24; i++) {
    flat(new THREE.RingGeometry(13.9, 14.1, 8, 1, (i / 24) * Math.PI * 2, 0.08), neon(i % 3 ? CYAN : PINK), 0.02);
  }
  // plataforma central que pulsa
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.2, 48), metal);
  pad.position.y = 0.0;
  ctx.add(pad);
  const padCore = flat(new THREE.CircleGeometry(1.1, 40), neon(PINK), 0.11);
  const pulses = [0, 1, 2].map(() => flat(new THREE.RingGeometry(0.95, 1.0, 64), neon(PINK, 0.6), 0.03));

  // ---------------------------------------------------------- trampillas
  const stripe = stripesTex('#ffb300', '#16121c', 10);
  const doorTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#2b2436'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3d3450'; g.lineWidth = 4;
    for (let y = 16; y < h; y += 32) { g.beginPath(); g.moveTo(8, y); g.lineTo(w - 8, y); g.stroke(); }
  });
  const doorMat = new THREE.MeshStandardMaterial({ map: doorTex, metalness: 0.7, roughness: 0.35 });
  const shaftTex = canvasTex(64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#120a1c'); grd.addColorStop(0.6, '#5a1070'); grd.addColorStop(1, '#ff40e0');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const pits = PITS.map((p, idx) => {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(PH * 2, 7, PH * 2), new THREE.MeshBasicMaterial({ map: shaftTex, side: THREE.BackSide }));
    shaft.position.set(p.x, -3.5, p.z);
    ctx.add(shaft);
    // borde con rayas de peligro
    const borders = [];
    for (const [ox, oz, rot] of [[0, -PH - 0.2, 0], [0, PH + 0.2, 0], [-PH - 0.2, 0, Math.PI / 2], [PH + 0.2, 0, Math.PI / 2]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(PH * 2 + 0.8, 0.06, 0.4), new THREE.MeshStandardMaterial({ map: stripe, emissive: '#ff8800', emissiveIntensity: 0, roughness: 0.5 }));
      b.position.set(p.x + ox, 0.03, p.z + oz);
      b.rotation.y = rot;
      ctx.add(b);
      borders.push(b);
    }
    // dos hojas con bisagra
    const doors = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(p.x + s * PH, -0.09, p.z);
      const d = new THREE.Mesh(new THREE.BoxGeometry(PH, 0.16, PH * 2), doorMat);
      d.position.x = -s * PH / 2;
      d.receiveShadow = true;
      pivot.add(d);
      pivot.userData.s = s;
      ctx.add(pivot);
      return pivot;
    });
    const col = ctx.collider(RAPIER.ColliderDesc.cuboid(PH, 0.1, PH).setTranslation(p.x, -0.1, p.z).setFriction(0.5));
    return { ...p, doors, borders, col, open: false, amount: 0, offset: idx * 7 };
  });
  const PIT_PERIOD = 14;
  const pitPhase = (pit, t) => (t + pit.offset) % PIT_PERIOD; // 0-8 cerrada, 8-10 aviso, 10-14 abierta

  // ---------------------------------------------------------- cerco eléctrico
  const postMat = new THREE.MeshStandardMaterial({ color: '#2a2338', metalness: 0.8, roughness: 0.35 });
  const capMat = new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.8), toneMapped: false });
  const FR = A - 0.35;
  const postPts = [];
  for (let i = 0; i < 8; i++) {
    const a0 = Math.PI / 8 + (i * Math.PI) / 4, a1 = a0 + Math.PI / 4;
    const p0 = [Math.cos(a0) * FR / Math.cos(Math.PI / 8), Math.sin(a0) * FR / Math.cos(Math.PI / 8)];
    const p1 = [Math.cos(a1) * FR / Math.cos(Math.PI / 8), Math.sin(a1) * FR / Math.cos(Math.PI / 8)];
    wall(ctx, p0[0], p0[1], p1[0], p1[1], { height: 1.3, thick: 0.3, visual: false, restitution: 0.4 });
    postPts.push(p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]);
  }
  for (const [x, z] of postPts) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.5, 0.55), postMat);
    post.position.set(x, 0.75, z);
    post.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.6), capMat);
    cap.position.set(x, 1.55, z);
    ctx.add(post, cap);
  }
  const tubeMat = new THREE.MeshBasicMaterial({ color: PINK.clone().multiplyScalar(2.2), toneMapped: false });
  const arcMat = new THREE.LineBasicMaterial({ color: new THREE.Color(2.5, 0.8, 2.5), toneMapped: false, transparent: true });
  const arcs = [];
  for (let i = 0; i < postPts.length; i++) {
    const [x0, z0] = postPts[i], [x1, z1] = postPts[(i + 1) % postPts.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (const h of [0.45, 1.05]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), tubeMat);
      tube.position.set((x0 + x1) / 2, h, (z0 + z1) / 2);
      tube.rotation.set(0, Math.atan2(-(z1 - z0), x1 - x0), Math.PI / 2);
      ctx.add(tube);
      const N = 14;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const line = new THREE.Line(geo, arcMat);
      ctx.add(line);
      arcs.push({ line, x0, z0, x1, z1, h, N });
    }
  }
  const updateArcs = () => {
    for (const a of arcs) {
      const arr = a.line.geometry.attributes.position.array;
      for (let k = 0; k < a.N; k++) {
        const t = k / (a.N - 1), j = k === 0 || k === a.N - 1 ? 0 : 1;
        arr[k * 3] = a.x0 + (a.x1 - a.x0) * t + (Math.random() - 0.5) * 0.25 * j;
        arr[k * 3 + 1] = a.h + (Math.random() - 0.5) * 0.35 * j;
        arr[k * 3 + 2] = a.z0 + (a.z1 - a.z0) * t + (Math.random() - 0.5) * 0.25 * j;
      }
      a.line.geometry.attributes.position.needsUpdate = true;
    }
  };
  updateArcs();

  // ---------------------------------------------------------- bumpers con flechas
  const chevTex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#1a1524'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4dfcff'; g.lineWidth = 22; g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = '#4dfcff'; g.shadowBlur = 20;
    for (let i = 0; i < 3; i++) {
      const x = w * 0.3 + i * 80;
      g.beginPath(); g.moveTo(x, 24); g.lineTo(x + 40, h / 2); g.lineTo(x, h - 24); g.stroke();
    }
  });
  const chevMat = new THREE.MeshStandardMaterial({ map: chevTex, emissiveMap: chevTex, emissive: '#ffffff', emissiveIntensity: 1.4, metalness: 0.5, roughness: 0.4 });
  const BUMPERS = [{ x: -6, z: -10.5, rot: 0.35 }, { x: 6.5, z: 10.5, rot: Math.PI + 0.35 }];
  const bumpers = BUMPERS.map((b) => {
    const g = new THREE.Group();
    g.position.set(b.x, 0.6, b.z);
    g.rotation.y = b.rot;
    const cm = chevMat.clone();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 1.3), [metal, metal, metal, metal, cm, cm]);
    body.castShadow = true;
    const capL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.3, 1.4), new THREE.MeshBasicMaterial({ color: PINK.clone().multiplyScalar(1.6), toneMapped: false }));
    capL.position.x = -2.15;
    const capR = capL.clone();
    capR.position.x = 2.15;
    g.add(body, capL, capR);
    ctx.add(g);
    const q = g.quaternion;
    ctx.collider(RAPIER.ColliderDesc.cuboid(2.1, 0.6, 0.65).setTranslation(b.x, 0.6, b.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setRestitution(0.9).setFriction(0));
    return { g, body, ax: new THREE.Vector3(1, 0, 0).applyQuaternion(q), az: new THREE.Vector3(0, 0, 1).applyQuaternion(q), flash: 0 };
  });

  // ---------------------------------------------------------- estructura inferior y borde
  const under = new THREE.Mesh(new THREE.CylinderGeometry(A * 0.85, A * 0.4, 9, 8), metal);
  under.rotation.y = Math.PI / 8;
  under.position.y = -6.1;
  ctx.add(under);
  const edgeGlow = new THREE.MeshBasicMaterial({ color: PINK.clone().multiplyScalar(1.5), toneMapped: false });
  const edgeCyan = new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.4), toneMapped: false });
  const sideLen = 2 * A * Math.tan(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const n = normals[i];
    const strip = new THREE.Mesh(new THREE.BoxGeometry(sideLen * 0.35, 0.3, 0.1), i % 2 ? edgeCyan : edgeGlow);
    strip.position.set(n.x * (A + 0.02), -0.8, n.z * (A + 0.02));
    strip.rotation.y = Math.atan2(n.x, n.z);
    const st = new THREE.Mesh(new THREE.BoxGeometry(sideLen * 0.2, 0.3, 0.1), new THREE.MeshStandardMaterial({ map: stripe }));
    st.position.copy(strip.position).addScaledVector(new THREE.Vector3(-n.z, 0, n.x), sideLen * 0.33);
    st.rotation.y = strip.rotation.y;
    ctx.add(strip, st);
  }
  // cables colgando
  const cableMat = new THREE.MeshStandardMaterial({ color: '#0f0c16', roughness: 0.6 });
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, r0 = A * 0.7;
    const p0 = new THREE.Vector3(Math.cos(a) * r0, -2, Math.sin(a) * r0);
    const p2 = new THREE.Vector3(Math.cos(a + 0.4) * (r0 - 4), -6, Math.sin(a + 0.4) * (r0 - 4));
    const p1 = p0.clone().lerp(p2, 0.5).add(new THREE.Vector3(0, -4 - Math.random() * 3, 0));
    ctx.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 16, 0.12, 5), cableMat));
  }

  // ---------------------------------------------------------- ciudad
  const winTex = (hue) => canvasTex(64, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 10) {
      if (Math.random() < 0.45) continue;
      const l = 40 + Math.random() * 40;
      g.fillStyle = Math.random() < 0.15 ? `hsl(${hue + 150},90%,${l}%)` : `hsl(${hue},85%,${l}%)`;
      g.fillRect(x, y, 6, 4);
    }
  });
  const cityMats = [300, 190, 270].map((hue) => new THREE.MeshStandardMaterial({ color: '#120d1c', emissive: '#ffffff', emissiveMap: winTex(hue), emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.3 }));
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const roofNeon = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), 80);
  let rn = 0;
  for (const mat of cityMats) {
    const COUNT = 75;
    const im = new THREE.InstancedMesh(box, mat, COUNT);
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2, r = 36 + Math.pow(Math.random(), 0.7) * 110;
      const w = 6 + Math.random() * 10, d = 6 + Math.random() * 10, h = 40 + Math.random() * 110;
      const y0 = -110 + Math.random() * 20;
      _p.set(Math.cos(a) * r, y0, Math.sin(a) * r);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      _s.set(w, h, d);
      im.setMatrixAt(i, _m.compose(_p, _q, _s));
      if (rn < 80 && Math.random() < 0.35) {
        _p.y = y0 + h;
        _s.set(w * 1.02, 0.4, d * 1.02);
        roofNeon.setMatrixAt(rn, _m.compose(_p, _q, _s));
        roofNeon.setColorAt(rn, (Math.random() < 0.5 ? PINK : CYAN).clone().multiplyScalar(1.5));
        rn++;
      }
    }
    ctx.add(im);
  }
  roofNeon.count = rn;
  ctx.add(roofNeon);

  // carteles holográficos con gelatina-fantasma
  const ghostTex = (color) => canvasTex(512, 512, (g, w, h) => {
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 10; g.shadowColor = color; g.shadowBlur = 30;
    g.strokeRect(20, 20, w - 40, h - 40);
    g.globalAlpha = 0.18; g.fillRect(20, 20, w - 40, h - 40); g.globalAlpha = 1;
    g.beginPath();
    g.moveTo(130, 400);
    g.bezierCurveTo(110, 150, 400, 150, 380, 400);
    for (let i = 0; i < 4; i++) { const x = 380 - i * 62; g.quadraticCurveTo(x - 15, 450, x - 31, 400); g.quadraticCurveTo(x - 46, 360, x - 62, 400); }
    g.lineWidth = 14; g.stroke();
    g.lineWidth = 16;
    g.beginPath(); g.moveTo(190, 250); g.lineTo(240, 275); g.stroke();
    g.beginPath(); g.moveTo(320, 250); g.lineTo(270, 275); g.stroke();
    g.beginPath(); g.ellipse(225, 300, 14, 20, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(285, 300, 14, 20, 0, 0, Math.PI * 2); g.fill();
  });
  const signs = [];
  for (const [a, y, c] of [[-2.3, 14, '#ff4df5'], [-0.75, 18, '#4df0ff'], [2.6, 12, '#b56bff']]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: ghostTex(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(Math.cos(a) * 52, y, Math.sin(a) * 52);
    m.lookAt(0, y, 0);
    ctx.add(m);
    signs.push(m);
  }
  const holoRing = new THREE.Mesh(new THREE.TorusGeometry(7, 0.18, 8, 64), new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.6), toneMapped: false }));
  holoRing.position.set(18, 24, -48);
  ctx.add(holoRing);

  const cars = [];
  for (let i = 0; i < 12; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 2), new THREE.MeshBasicMaterial({ color: (i % 2 ? PINK : CYAN).clone().multiplyScalar(1.5), toneMapped: false }));
    c.userData = { r: 45 + Math.random() * 50, y: 6 + Math.random() * 30, w: (0.05 + Math.random() * 0.08) * (Math.random() < 0.5 ? -1 : 1), a: Math.random() * 7 };
    ctx.add(c);
    cars.push(c);
  }

  // luces de color
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const l = new THREE.PointLight(i % 2 ? '#33e6ff' : '#ff3df2', 45, 30, 1.6);
    l.position.set(Math.cos(a) * 15, 4, Math.sin(a) * 15);
    ctx.add(l);
  }

  // ---------------------------------------------------------- lógica
  const inOct = (x, z) => normals.every((n) => x * n.x + z * n.z < A);
  const inPit = (pit, x, z) => Math.abs(x - pit.x) < PH && Math.abs(z - pit.z) < PH;
  let arcT = 0;
  const _d = new THREE.Vector3();

  backdrop(ctx, ['cyber.jpg', 'cyber.png', 'cyber.webp']);

  return {
    name: 'Cyberpunk',
    R: A,
    fog: ['#2a0d48', 45, 190],
    floorAt(x, z) {
      if (!inOct(x, z)) return false;
      for (const p of pits) if (p.open && inPit(p, x, z)) return false;
      return true;
    },
    preStep(dt, t) {
      for (const p of pits) {
        const ph = pitPhase(p, t);
        const open = ph >= 10;
        if (open !== p.open) {
          p.open = open;
          p.col.setEnabled(!open);
          if (open) sfx.whoosh();
        }
      }
    },
    postStep(dt, game) {
      for (const j of game.jellies) {
        if (j.dead || j.hazardCd > 0) continue;
        // cerco eléctrico
        let best = -1e9, bn = null;
        for (const n of normals) { const d = j.pos.x * n.x + j.pos.z * n.z; if (d > best) { best = d; bn = n; } }
        if (best + j.r > FR - 0.25 && j.pos.y < 2.2) {
          const inward = _d.copy(bn).negate();
          game.hazardHit(j, { vx: inward.x * 14, vy: 6, vz: inward.z * 14, stun: 0.5, dmg: 7, color: CYAN, sound: 'zap', point: j.pos.clone().addScaledVector(bn, j.r) });
          j.hazardCd = 0.4;
          continue;
        }
        // bumpers
        for (const b of bumpers) {
          _d.set(j.pos.x - b.g.position.x, 0, j.pos.z - b.g.position.z);
          const lx = _d.dot(b.ax), lz = _d.dot(b.az);
          if (Math.abs(lx) < 2.1 + j.r * 0.7 + 0.15 && Math.abs(lz) < 0.65 + j.r + 0.15 && j.pos.y < 2.3) {
            // las flechas de cada cara apuntan en sentidos opuestos
            const sd = Math.sign(lz) || 1;
            const dir = b.ax.clone().multiplyScalar(sd).addScaledVector(b.az, sd * 0.6).normalize();
            game.hazardHit(j, { vx: dir.x * 24, vy: 5, vz: dir.z * 24, stun: 0.35, dmg: 0, color: CYAN, sound: 'boing', point: j.pos.clone() });
            j.hazardCd = 0.35;
            b.flash = 0.3;
            break;
          }
        }
      }
    },
    update(t, dt) {
      arcT -= dt;
      if (arcT <= 0) { updateArcs(); arcT = 0.05; arcMat.opacity = 0.5 + Math.random() * 0.5; }
      for (const p of pits) {
        const ph = pitPhase(p, t);
        const target = ph >= 10 ? 1 : 0;
        p.amount += (target - p.amount) * (1 - Math.exp(-(target ? 10 : 4) * dt));
        for (const d of p.doors) d.rotation.z = -d.userData.s * p.amount * Math.PI * 0.5;
        const warn = ph >= 8 && ph < 10;
        for (const b of p.borders) b.material.emissiveIntensity = warn ? (Math.sin(t * 25) > 0 ? 2 : 0) : p.open ? 0.6 : 0;
        if (p.open && Math.random() < dt * 14) {
          fx.puff(new THREE.Vector3(p.x + (Math.random() - 0.5) * 3, -2, p.z + (Math.random() - 0.5) * 3), new THREE.Vector3(0, 3 + Math.random() * 2, 0), { size: 1.6, life: 1.4, color: '#ff4de8', alpha: 0.35 });
        }
      }
      for (const b of bumpers) {
        b.flash = Math.max(0, b.flash - dt);
        b.body.material[4].emissiveIntensity = 1.4 + b.flash * 8;
        b.g.scale.setScalar(1 + b.flash * 0.4);
      }
      pulses.forEach((r, i) => {
        const k = ((t * 0.6 + i / 3) % 1);
        r.scale.setScalar(1 + k * 4.5);
        r.material.opacity = (1 - k) * 0.6;
      });
      padCore.material.opacity = 0.75 + Math.sin(t * 4) * 0.25;
      for (const s of signs) s.material.opacity = Math.random() < 0.02 ? 0.3 : 0.9;
      holoRing.rotation.x = t * 0.3; holoRing.rotation.y = t * 0.5;
      for (const c of cars) {
        const u = c.userData, a = u.a + t * u.w;
        c.position.set(Math.cos(a) * u.r, u.y, Math.sin(a) * u.r);
        c.rotation.y = -a + (u.w > 0 ? Math.PI : 0);
      }
    },
    dispose: () => ctx.dispose(),
  };
}
