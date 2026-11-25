import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Contexto de construcción: registra todo lo que crea para poder destruir la arena al cambiarla.
export function createCtx(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const bodies = [];
  const disposers = [];
  return {
    scene,
    world,
    group,
    add(...objs) { group.add(...objs); return objs[0]; },
    collider(desc, body) {
      const c = world.createCollider(desc, body);
      if (!body) colliders.push(c);
      return c;
    },
    body(desc) {
      const b = world.createRigidBody(desc);
      bodies.push(b);
      return b;
    },
    onDispose(fn) { disposers.push(fn); },
    // marca objetos que se mueven/rotan/aparecen (no se juntan en freeze)
    dynamic(...objs) { for (const o of objs) o.userData.dynamic = true; return objs[0]; },
    // Junta todo lo que nunca se mueve en UNA malla por material. Cada malla es un "dibujo" que la placa
    // de video hace por separado (y varias veces por frame: sombras, transparencia de las gelatinas…);
    // una arena con cientos de piezas sueltas (ventanas, barrotes, abrazaderas…) se vuelve cara de dibujar.
    freeze() {
      group.updateMatrixWorld(true);
      const skip = (o) => { for (let p = o; p && p !== group; p = p.parent) if (p.userData.dynamic || !p.visible) return true; return false; };
      const buckets = new Map();
      group.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.renderOrder) return;
        const m = o.material, g = o.geometry;
        if (m.transparent || skip(o) || o.matrixWorld.determinant() < 0) return;
        if (g.morphAttributes && Object.keys(g.morphAttributes).length) return;
        // por sector (6 porciones de torta + el centro): así lo que queda fuera de cámara no se dibuja
        const e = o.matrixWorld.elements, px = e[12], pz = e[14];
        const sector = Math.hypot(px, pz) < 20 ? 'c' : Math.floor((((Math.atan2(pz, px) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 6);
        const key = `${m.uuid}|${o.castShadow}|${o.receiveShadow}|${g.index ? 1 : 0}|${Object.keys(g.attributes).sort().join(',')}|${sector}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(o);
      });
      let before = 0, after = 0;
      for (const list of buckets.values()) {
        if (list.length < 2) continue;
        const geos = list.map((o) => o.geometry.clone().applyMatrix4(o.matrixWorld));
        const merged = mergeGeometries(geos, false);
        for (const gg of geos) gg.dispose();
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, list[0].material);
        mesh.castShadow = list[0].castShadow;
        mesh.receiveShadow = list[0].receiveShadow;
        for (const o of list) o.parent.remove(o);
        group.add(mesh);
        before += list.length; after++;
      }
      return { before, after };
    },
    dispose() {
      for (const fn of disposers) fn();
      for (const c of colliders) world.removeCollider(c, false);
      for (const b of bodies) world.removeRigidBody(b);
      scene.remove(group);
      const mats = new Set();
      group.traverse((o) => {
        o.geometry?.dispose();
        const m = o.material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => mats.add(x));
      });
      for (const m of mats) {
        for (const k of ['map', 'emissiveMap', 'roughnessMap', 'alphaMap']) m[k]?.dispose();
        m.dispose();
      }
    },
  };
}

export function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

export function stripesTex(a = '#ffb300', b = '#1b1420', reps = 8) {
  return canvasTex(256, 32, (g, w, h) => {
    g.fillStyle = b;
    g.fillRect(0, 0, w, h);
    g.fillStyle = a;
    const step = w / reps;
    for (let x = -h; x < w + h; x += step) {
      g.beginPath();
      g.moveTo(x, h); g.lineTo(x + step / 2, h); g.lineTo(x + step / 2 + h, 0); g.lineTo(x + h, 0);
      g.fill();
    }
  }, { repeat: [1, 1] });
}

export const circlePts = (r, n = 96) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
});

export const rectPts = (cx, cz, hx, hz) => [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]];

// Piso extruido (top en y=0) con agujeros opcionales + collider trimesh.
export function buildFloor(ctx, { outline, holes = [], depth = 1.6, top, side, uvScale }) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -depth, 0);
  if (uvScale) {
    // mapear la textura del piso: coords de mundo [-uvScale, uvScale] → [0,1]
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2 * uvScale) + 0.5, uv.getY(i) / (2 * uvScale) + 0.5);
  }
  const mesh = new THREE.Mesh(geo, [top, side]);
  mesh.receiveShadow = true;
  ctx.add(mesh);

  const pg = geo.clone();
  pg.deleteAttribute('normal');
  pg.deleteAttribute('uv');
  const merged = mergeVertices(pg, 1e-4);
  ctx.collider(
    RAPIER.ColliderDesc.trimesh(new Float32Array(merged.attributes.position.array), new Uint32Array(merged.index.array), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.5),
  );
  pg.dispose();
  merged.dispose();
  return mesh;
}

// Muro recto de (x1,z1) a (x2,z2). Devuelve el grupo visual (eje x local = a lo largo del muro).
export function wall(ctx, x1, z1, x2, z2, { height = 0.9, thick = 0.8, mat, restitution = 0.55, visual = true } = {}) {
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
  const g = new THREE.Group();
  g.position.set((x1 + x2) / 2, height / 2, (z1 + z2) / 2);
  g.rotation.y = Math.atan2(-dz, dx);
  if (visual) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, height, thick), mat);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  ctx.add(g);
  const q = g.quaternion;
  ctx.collider(
    RAPIER.ColliderDesc.cuboid(len / 2, height / 2, thick / 2)
      .setTranslation(g.position.x, g.position.y, g.position.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setRestitution(restitution)
      .setFriction(0),
  );
  g.userData.len = len;
  return g;
}

// Cielo con gradiente vertical (no le afecta la niebla).
export function skyDome(ctx, top, mid, bottom) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bottom, pow(-h, 0.45));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), mat);
  m.renderOrder = -10;
  ctx.add(m);
  return m;
}

// Engranaje extruido (plano XY, eje Z)
export function gearGeometry(r, teeth, toothH, thick, holeR = 0) {
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = i % 4 === 1 || i % 4 === 2 ? r + toothH : r;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  if (holeR) {
    const h = new THREE.Path();
    h.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 24 });
  g.translate(0, 0, -thick / 2);
  return g;
}

// Punto dentro de polígono convexo/simple (lista [[x,z]])
export function inPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Anillo plano (y=0, normal +y) entre ángulos de mundo a0..a1 (atan2(z,x)), con UV u a lo largo del arco.
export function arcBand(r0, r1, a0 = 0, a1 = Math.PI * 2, seg = 96, repeats = 40) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg, c = Math.cos(a), s = Math.sin(a), u = (i / seg) * repeats;
    pos.push(c * r0, 0, s * r0, c * r1, 0, s * r1);
    uv.push(u, 0, u, 1);
  }
  for (let i = 0; i < seg; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Sector de corona extruido hacia arriba (y de 0 a h) entre ángulos de mundo a0..a1.
export function arcCurb(r0, r1, a0, a1, h, seg = 48) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, -a1, -a0, false);
  s.absarc(0, 0, r0, -a0, -a1, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: seg });
  g.rotateX(-Math.PI / 2);
  return g;
}

// Tubo (toro) horizontal de radio r entre ángulos de mundo a0..a1.
export function arcTube(r, tube, a0, a1, seg = 64) {
  const g = new THREE.TorusGeometry(r, tube, 10, seg, a1 - a0);
  g.rotateX(Math.PI / 2);
  g.rotateY(-a0);
  return g;
}

// Farol victoriano (~0.8 de alto, base en y=0)
export function lantern(brassMat, glowMat, s = 1) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 8), brassMat);
  base.position.y = 0.05;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), glowMat);
  glass.position.y = 0.31;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.24, 4), brassMat);
  cap.rotation.y = Math.PI / 4;
  cap.position.y = 0.64;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), brassMat);
  ring.position.y = 0.8;
  g.add(base, glass, cap, ring);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.46, 0.04), brassMat);
    bar.position.set(x * 0.16, 0.31, z * 0.16);
    g.add(bar);
  }
  g.scale.setScalar(s);
  return g;
}

// Manómetro con aguja (cara mirando a +z). Devuelve { group, needle }.
export function gauge(brassMat, r = 0.5) {
  const g = new THREE.Group();
  const face = canvasTex(128, 128, (c, w) => {
    c.fillStyle = '#f2e8cf'; c.beginPath(); c.arc(64, 64, 62, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#c0392b'; c.lineWidth = 10; c.beginPath(); c.arc(64, 64, 48, -0.3, 0.7); c.stroke();
    c.strokeStyle = '#2b2118'; c.lineWidth = 3;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      c.beginPath(); c.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44); c.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); c.stroke();
    }
  });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.16, 28), brassMat);
  rim.rotation.x = Math.PI / 2;
  const f = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshStandardMaterial({ map: face, roughness: 0.4 }));
  f.position.z = 0.081;
  const needle = new THREE.Mesh(new THREE.BoxGeometry(r * 0.08, r * 0.85, 0.02), new THREE.MeshBasicMaterial({ color: '#b01010' }));
  needle.geometry.translate(0, r * 0.38, 0);
  needle.position.z = 0.095;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.15, roughness: 0, clearcoat: 1 }));
  glass.position.z = 0.1;
  g.add(rim, f, needle, glass);
  return { group: g, needle };
}

// Fondo pintado 2D envolviendo la escena (cilindro gigante). Busca en public/fondos/ el primer archivo que exista.
// La imagen cubre `arc` radianes detrás de la plataforma y se espeja para el resto (sin costuras al girar la cámara).
// Fondos pintados: se precargan al abrir el juego y quedan en memoria. Así, al armar la arena, el fondo
// se crea en el momento y se prepara junto con todo lo demás (si llegara tarde, subir la imagen y compilar
// su material trabaría el juego en plena partida).
const BACKDROP_BASE = `${import.meta.env?.BASE_URL ?? '/'}fondos/`;
const backdropCache = new Map(); // url → textura
const backdropMissing = new Set();
const backdropLoader = new THREE.TextureLoader();
let lateHook = null;
// fn() se llama si algo de la arena terminó de cargar después de armarla (hay que volver a precalentar)
export const onLateAsset = (fn) => { lateHook = fn; };

function loadBackdrop(names, cb) {
  const tryNext = (i) => {
    if (i >= names.length) { cb(null); return; }
    const url = BACKDROP_BASE + names[i];
    if (backdropCache.has(url)) { cb(backdropCache.get(url)); return; }
    if (backdropMissing.has(url)) { tryNext(i + 1); return; }
    backdropLoader.load(url, (tex) => { backdropCache.set(url, tex); cb(tex); }, undefined, () => { backdropMissing.add(url); tryNext(i + 1); });
  };
  tryNext(0);
}

export function preloadBackdrops(lists) {
  for (const names of lists) loadBackdrop(names, () => {});
}

export function backdrop(ctx, names, { radius = 320, arc = Math.PI, yCenter = 0, yShift = 0, onLoad } = {}) {
  let disposed = false, late = false;
  const build = (tex) => {
    if (!tex || disposed) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.MirroredRepeatWrapping;
    tex.repeat.x = (Math.PI * 2) / arc;
    tex.offset.x = 0.5; // centro de la imagen detrás de la plataforma (-z)
    tex.anisotropy = 8;
    const aspect = tex.image.width / tex.image.height;
    const height = (arc * radius) / aspect;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 128, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, fog: false, depthWrite: false }),
    );
    mesh.scale.x = -1; // visto desde adentro, sin espejar
    mesh.position.y = yCenter + yShift * height;
    mesh.renderOrder = -9;
    ctx.add(mesh);
    onLoad?.(mesh);
    if (late) lateHook?.();
  };
  loadBackdrop(names, build); // si ya estaba precargado, se arma ahora mismo
  late = true;
  ctx.onDispose(() => { disposed = true; });
}
