import * as THREE from 'three';

// Caras de todas las gelatinas en pocos dibujos.
// Cada gelatina tiene ~10 piezas chiquitas (pupilas, brillos, cejas, boca, cachetes; y estrellitas, casco y
// lata cuando hacen falta). Dibujadas sueltas eran ~10 dibujos por gelatina en pantalla: con la cámara más
// lejos (más gelatinas a la vista) se iban 100-150 dibujos por frame sólo en caras.
// Las piezas siguen existiendo (se mueven y se esconden igual que antes), pero en la capa 1, que la cámara
// no dibuja; acá se copian sus posiciones a una malla instanciada por tipo de pieza (una para todas las pupilas, otra para
// todas las cejas…). Las piezas comparten material y forma (ver faceAssets en jelly.js).
const HIDDEN = 1;
const _hideM = new THREE.Matrix4().makeScale(0, 0, 0);

export class FaceBatch {
  constructor(scene, jellies) {
    this.scene = scene;
    this.jellies = jellies;
    this.kinds = new Map();
    this.ver = -1;
  }

  _version() { let v = 0; for (const j of this.jellies) v += j.visualVer * 1000 + 1; return v; }

  // arma una malla instanciada por cada (forma, material); se rehace si alguna gelatina cambió de forma
  _rebuild() {
    for (const k of this.kinds.values()) { this.scene.remove(k.im); k.im.dispose(); }
    this.kinds.clear();
    for (const j of this.jellies) {
      for (const m of j.faceMeshes()) {
        m.layers.set(HIDDEN);
        const key = m.geometry.uuid + m.material.uuid;
        let k = this.kinds.get(key);
        if (!k) this.kinds.set(key, (k = { geo: m.geometry, mat: m.material, items: [], shadow: false, order: m.renderOrder }));
        // cadena de padres hasta la raíz de la gelatina: si alguno está escondido, la pieza no se ve
        const chain = [];
        for (let o = m; o && o !== j.root; o = o.parent) chain.push(o);
        k.items.push({ j, m, chain });
        k.shadow ||= m.castShadow;
      }
    }
    for (const k of this.kinds.values()) {
      const im = new THREE.InstancedMesh(k.geo, k.mat, k.items.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; // las gelatinas fuera de cámara ya se saltean acá
      im.castShadow = k.shadow;
      // transparentes (cachetes, espiral): después de los cuerpos translúcidos, para que no queden tapados
      im.renderOrder = k.mat.transparent ? 3 : k.order;
      im.count = 0;
      this.scene.add(im);
      k.im = im;
    }
    this.ver = this._version();
  }

  // cada frame, después de jelly.render()
  sync() {
    if (this.ver !== this._version()) this._rebuild();
    for (const j of this.jellies) if (!j.dead && !j.offscreen && j.root.visible) j.root.updateMatrixWorld(true);
    for (const k of this.kinds.values()) {
      let n = 0;
      for (const it of k.items) {
        const j = it.j;
        if (j.dead || j.offscreen || !j.root.visible) continue;
        let vis = true;
        for (const o of it.chain) if (!o.visible) { vis = false; break; }
        if (!vis) continue;
        k.im.setMatrixAt(n++, it.m.matrixWorld);
      }
      k.im.count = n;
      k.im.visible = n > 0;
      if (n) k.im.instanceMatrix.needsUpdate = true;
    }
  }

  // precalentado (ver warmAll en main.js): un ejemplar escondido de cada tipo, así se compila su material
  warmBegin() {
    if (this.ver !== this._version()) this._rebuild();
    for (const k of this.kinds.values()) {
      if (k.im.count === 0) { k.im.setMatrixAt(0, _hideM); k.im.count = 1; k.im.instanceMatrix.needsUpdate = true; }
      k.im.visible = true;
    }
  }

  warmEnd() { this.sync(); }
}

