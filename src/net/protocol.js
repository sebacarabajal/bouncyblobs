// Protocolo de las salas (lo comparten el servidor y el navegador). WebSocket en /ws.
//
// navegador → servidor (JSON)
//   {t:'join', v:PROTO, mode:'ffa'|'teams', look:{name,color,shape,brow,tattoo}, room?:id}   entrar (room: el admin elige sala)
//   {t:'in', l:[[paso, mx, mz, flags, golpe?]…], n}   una tecla por paso de física (flags: 1 saltar · 2 correr · 4 saltó · 8 embistió · 16 aceite · 32 chorro)
//     golpe (opcional, 4 valores más): [bot, nx, nz, choque] = en ese paso tu navegador vio que tu embestida le pegó a ese bot
//     (el servidor lo acepta si es creíble: ver Sim.applyClaims) · n = cuántos pasos va adelantado tu navegador
//   {t:'ping', c}
// servidor → navegador
//   JSON: {t:'welcome', …} · {t:'roster', list} · {t:'x', step, ev, tm, ar} (eventos y estado de equipos/arena) · {t:'pong'} · {t:'full'}
//         · {t:'old'} (la página es de otra versión: recargar)
//   BINARIO (30 por segundo): la foto de la sala → ver encodeSnap / decodeSnap
//
// Bots: deciden con anticipación (sim.botLead pasos antes de hacerlo). Cada foto trae sus 2 últimas decisiones
// con el paso del servidor en que se ejecutan: el navegador las aplica en ese mismo paso (ver online.js).
//
// Línea de tiempo: el servidor numera sus pasos (step). Con cada foto dice qué tecla tuya fue la última que aplicó
// (ack) y cuántos pasos lleva sin teclas nuevas (since): así el navegador sabe EXACTAMENTE a qué paso suyo
// corresponde la foto (ack + since) y cuántos pasos va adelantado (los que todavía no llegaron al servidor).
// versión del protocolo: si el navegador tiene una página vieja (cambió el formato de las fotos), el servidor le
// contesta {t:'old'} y la página se recarga sola
export const PROTO = 2;
export const F = { dead: 1, dashing: 2, airDash: 4, sprint: 8, grounded: 16, impaled: 32, out: 64, human: 128 };
export const SNAP_HZ = 30;

const HEAD = 16; // tipo(1) cant(1) cola(1) repetidas(1) paso(4) ack(4) since(2) reservado(2)
const BLOB = 53;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const i16 = (v) => clamp(Math.round(v), -32768, 32767);
const u8 = (v) => clamp(Math.round(v), 0, 255);
const u16 = (v) => clamp(Math.round(v), 0, 65535);
const normYaw = (y) => Math.atan2(Math.sin(y), Math.cos(y));

// la parte de la foto que es igual para todos (los blobs). La cabecera (ack, since, cola) se completa por jugador.
export function encodeSnap(jellies, step) {
  const list = jellies.filter((j) => !j.benched);
  const buf = new ArrayBuffer(HEAD + list.length * BLOB);
  const dv = new DataView(buf);
  dv.setUint8(0, 1);
  dv.setUint8(1, list.length);
  dv.setUint32(4, step, true);
  let o = HEAD;
  for (const j of list) {
    const v = j.dead ? { x: 0, y: 0, z: 0 } : j.body.linvel();
    const c = j.lastCmd || {};
    const flags = (j.dead ? F.dead : 0) | (j.dashing ? F.dashing : 0) | (j.airDash ? F.airDash : 0) | (j.sprinting ? F.sprint : 0)
      | (j.grounded ? F.grounded : 0) | (j.impaled ? F.impaled : 0) | (j.benched || j.away ? F.out : 0) | (j.human ? F.human : 0);
    dv.setUint8(o, j.id);
    dv.setUint8(o + 1, flags);
    dv.setInt16(o + 2, i16(j.pos.x * 100), true); dv.setInt16(o + 4, i16(j.pos.y * 100), true); dv.setInt16(o + 6, i16(j.pos.z * 100), true);
    dv.setInt16(o + 8, i16(v.x * 100), true); dv.setInt16(o + 10, i16(v.y * 100), true); dv.setInt16(o + 12, i16(v.z * 100), true);
    dv.setInt16(o + 14, i16(normYaw(j.yaw) * 10000), true);
    dv.setUint16(o + 16, u16(j.mass * 100), true);
    dv.setUint8(o + 18, u8(j.damage));
    dv.setUint8(o + 19, u8(j.energy * 2)); // (de a medio punto: el umbral para embestir es exacto)
    dv.setUint8(o + 20, u8(j.daze * 50)); // (máx 5,1 s)
    dv.setUint8(o + 21, u8(j.stun * 100)); // (máx 2,55 s; el golpe más fuerte aturde 1,6 s)
    dv.setUint8(o + 22, u8(j.dashTimer * 500));
    dv.setUint8(o + 23, u8(j.buffs.turbo * 4));
    dv.setUint8(o + 24, u8(j.buffs.strength * 4));
    dv.setUint8(o + 25, u8(j.ammo.oil));
    dv.setUint8(o + 26, u8(j.ammo.spit));
    dv.setInt8(o + 27, j.team == null ? -1 : j.team);
    dv.setUint32(o + 28, Math.max(0, Math.floor(j.score)), true);
    dv.setUint16(o + 32, u16(j.kos), true);
    dv.setUint16(o + 34, u16(j.falls), true);
    dv.setUint8(o + 36, u8(j.oilT * 100));
    dv.setUint8(o + 37, u8((j.impaledT || 0) * 50));
    dv.setInt8(o + 38, clamp(Math.round((c.mx || 0) * 127), -127, 127));
    dv.setInt8(o + 39, clamp(Math.round((c.mz || 0) * 127), -127, 127));
    dv.setUint8(o + 40, (c.jumpHeld ? 1 : 0) | (c.sprint ? 2 : 0));
    dv.setUint8(o + 41, u8((j.size || 1) * 50));
    dv.setUint8(o + 42, u8((j.windup || 0) * 500));
    dv.setUint8(o + 43, u8((j.daze > 0 ? j.dazeT : 0) * 50)); // hace cuánto está mareado (para caminar igual)
    // 44-51: las 2 últimas decisiones del bot (la más nueva primero)
    const pl = !j.human && j.plan;
    putPlan(dv, o + 44, pl && pl.length ? pl[pl.length - 1] : null, step);
    putPlan(dv, o + 48, pl && pl.length > 1 ? pl[pl.length - 2] : null, step);
    dv.setUint8(o + 52, u8((j.dashCd || 0) * 100)); // cuánto le falta para poder volver a embestir
    o += BLOB;
  }
  return buf;
}

// una decisión de bot: en qué paso (relativo a la foto), dirección y botones (bit 7: hay decisión)
function putPlan(dv, o, e, step) {
  if (!e) { dv.setUint32(o, 0); return; }
  dv.setInt8(o, clamp(e.at - step, -128, 127));
  dv.setInt8(o + 1, clamp(Math.round(e.mx * 127), -127, 127));
  dv.setInt8(o + 2, clamp(Math.round(e.mz * 127), -127, 127));
  dv.setUint8(o + 3, 128 | (e.jumpHeld ? 1 : 0) | (e.sprint ? 2 : 0) | (e.jump ? 4 : 0) | (e.dash ? 8 : 0) | (e.throw === 'oil' ? 16 : e.throw === 'spit' ? 32 : 0));
}
function getPlan(dv, o, step) {
  const f = dv.getUint8(o + 3);
  return f & 128 ? { at: step + dv.getInt8(o), mx: dv.getInt8(o + 1) / 127, mz: dv.getInt8(o + 2) / 127, f } : null;
}

// la foto para UN jugador: copia la parte común y completa su cabecera
export function snapFor(common, { ack = 0, since = 0, queue = 0, reps = 0 }) {
  const buf = common.slice(0);
  const dv = new DataView(buf);
  dv.setUint8(2, u8(queue));
  dv.setUint8(3, reps & 255);
  dv.setUint32(8, ack >>> 0, true);
  dv.setUint16(12, u16(since), true);
  return buf;
}

export function decodeSnap(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint8(1);
  const out = { queue: dv.getUint8(2), reps: dv.getUint8(3), step: dv.getUint32(4, true), ack: dv.getUint32(8, true), since: dv.getUint16(12, true), b: new Map() };
  let o = HEAD;
  for (let k = 0; k < n; k++) {
    const id = dv.getUint8(o);
    out.b.set(id, {
      id, flags: dv.getUint8(o + 1),
      x: dv.getInt16(o + 2, true) / 100, y: dv.getInt16(o + 4, true) / 100, z: dv.getInt16(o + 6, true) / 100,
      vx: dv.getInt16(o + 8, true) / 100, vy: dv.getInt16(o + 10, true) / 100, vz: dv.getInt16(o + 12, true) / 100,
      yaw: dv.getInt16(o + 14, true) / 10000, mass: dv.getUint16(o + 16, true) / 100, damage: dv.getUint8(o + 18),
      energy: dv.getUint8(o + 19) / 2, daze: dv.getUint8(o + 20) / 50, stun: dv.getUint8(o + 21) / 100, dashTimer: dv.getUint8(o + 22) / 500,
      turbo: dv.getUint8(o + 23) / 4, strength: dv.getUint8(o + 24) / 4, oil: dv.getUint8(o + 25), spit: dv.getUint8(o + 26),
      team: dv.getInt8(o + 27), score: dv.getUint32(o + 28, true), kos: dv.getUint16(o + 32, true), falls: dv.getUint16(o + 34, true),
      oilT: dv.getUint8(o + 36) / 100, impaledT: dv.getUint8(o + 37) / 50,
      mx: dv.getInt8(o + 38) / 127, mz: dv.getInt8(o + 39) / 127, cmdFlags: dv.getUint8(o + 40), size: dv.getUint8(o + 41) / 50, windup: dv.getUint8(o + 42) / 500, dazeT: dv.getUint8(o + 43) / 50,
      p1: getPlan(dv, o + 44, out.step), p2: getPlan(dv, o + 48, out.step), dashCd: dv.getUint8(o + 52) / 100,
    });
    o += BLOB;
  }
  return out;
}

// valores sueltos para los eventos (vectores y colores de three.js → algo que viaja en JSON)
const r3 = (v) => Math.round(v * 1000) / 1000;
export function encArg(a) {
  if (a == null) return a;
  if (a.isVector3) return ['V', r3(a.x), r3(a.y), r3(a.z)];
  if (a.isColor) return ['C', a.getHex()];
  if (typeof a === 'number') return r3(a);
  return a;
}
