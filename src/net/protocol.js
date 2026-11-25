// Protocolo de las salas (lo comparten el servidor y el navegador). Mensajes JSON por WebSocket (/ws).
//
// navegador → servidor
//   {t:'join', mode:'ffa'|'teams', look:{name,color,shape,brow,tattoo}, room?:id}   entrar (room: el admin elige sala)
//   {t:'in', l:[[paso, mx, mz, flags]…]}      una tecla por paso de física (flags: 1 saltar · 2 correr · 4 saltó · 8 embistió · 16 aceite · 32 chorro)
//   {t:'ping', c}                              para medir la latencia
// servidor → navegador
//   {t:'welcome', you, room:{id,mode,arena}, roster, pickups, time, tm}
//   {t:'roster', list}                         alguien entró o salió
//   {t:'s', time, ack, b:[blob…], tm, ar, ev:[[t, tipo, …]…]}   foto de la sala (20 por segundo) + eventos
//   {t:'pong', c, time}
//   {t:'full'} · {t:'error', msg}
//
// Cada blob en la foto: [id, x, y, z, vx, vy, vz, yaw, masa, daño, flags, energía, mareo, aturdido,
//                        turbo, fuerza, aceite, chorro, puntos, kos, caídas, equipo(-1), aceiteT, empalado]
export const F = { dead: 1, dashing: 2, airDash: 4, sprint: 8, grounded: 16, impaled: 32, out: 64, human: 128 };
export const SNAP_HZ = 20;
export const INTERP_DELAY = 0.1; // los demás se ven 100 ms "atrás", así siempre hay dos fotos entre las que moverse

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function encodeBlob(j) {
  const v = j.body?.linvel?.() ?? { x: 0, y: 0, z: 0 };
  const dead = j.dead;
  const flags = (dead ? F.dead : 0) | (j.dashing ? F.dashing : 0) | (j.airDash ? F.airDash : 0) | (j.sprinting ? F.sprint : 0)
    | (j.grounded ? F.grounded : 0) | (j.impaled ? F.impaled : 0) | (j.benched || j.away ? F.out : 0) | (j.human ? F.human : 0);
  return [
    j.id, r3(j.pos.x), r3(j.pos.y), r3(j.pos.z), r2(dead ? 0 : v.x), r2(dead ? 0 : v.y), r2(dead ? 0 : v.z), r3(j.yaw),
    r2(j.mass), Math.round(j.damage), flags, Math.round(j.energy), r2(j.daze), r2(j.stun),
    r2(j.buffs.turbo), r2(j.buffs.strength), j.ammo.oil, j.ammo.spit, Math.floor(j.score), j.kos, j.falls,
    j.team ?? -1, r2(j.oilT), r2(j.impaledT || 0),
  ];
}

// valores sueltos para los eventos (vectores y colores de three.js → algo que viaja en JSON)
export function encArg(a) {
  if (a == null) return a;
  if (a.isVector3) return ['V', r3(a.x), r3(a.y), r3(a.z)];
  if (a.isColor) return ['C', a.getHex()];
  if (typeof a === 'number') return r3(a);
  return a;
}
