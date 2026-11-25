// Parámetros de "feel" del juego. Todos se pueden tunear en vivo desde el panel (tecla H).
export const CONFIG = {
  arena: 'steam',

  // Movimiento
  moveSpeed: 10,
  groundAccel: 75,
  airAccel: 28,
  gravity: -30,
  jumpVel: 12,
  sprintMul: 1.5, // Shift

  // Energía (barra aparte de la masa): la gastan correr y embestir, se recarga sola
  sprintEnergy: 22, // energía por segundo corriendo
  dashEnergy: 50, // energía por embestida (media barra)
  energyRegen: 18, // energía que recupera por segundo (cuando no corrés)

  // Masa / tamaño (tipo agar.io)
  massMin: 0.6, // masa mínima (al perder masa por golpes)
  pickupMass: 0.15,
  pickupInterval: 0.9, // segundos entre gelatinitas que caen (con cantidad 100%)
  pickupMax: 50, // máximo en el piso (con cantidad 100%)
  pickupAmount: 110, // % de gelatinitas: multiplica cuántas caen y el máximo en el piso (110 = 10% más)
  speedMassExp: 0.18, // velocidad = base / masa^exp (masa 4 → ~78%)

  // Embestida
  dashSpeed: 22,
  dashTime: 0.2,
  dashCooldown: 1.2,
  airDashBonus: 1.45, // salto + embestida pega más fuerte

  // Golpes
  // fuerza = (knockBase + velocidadDeChoque × knockScale) × (masaAtacante / masaVíctima)^massExp
  //         × inestabilidad × picada × fuerza extra   (con tope knockMax)
  knockBase: 5,
  knockScale: 0.42,
  massExp: 0.6, // 0 = la masa no importa · 1 = x4 contra x1 pega 4 veces más
  knockMax: 45, // tope de fuerza de un golpe (evita que salgan volando a la luna)
  knockLift: 0.2, // cuánto del golpe va hacia arriba
  // Estabilidad: arranca en 100 y baja con cada golpe. Menos estabilidad = volás más lejos.
  // (internamente se guarda la "inestabilidad" 0..100 en jelly.damage)
  instPerHit: 13, // cuánto baja la estabilidad un golpe normal
  instKnock: 1.2, // con estabilidad 0 volás (1 + instKnock) veces más lejos
  instMassExp: 0.5, // cuánto pesa la diferencia de masa en la estabilidad que saca un golpe
  stabRegenDelay: 3, // segundos sin recibir golpes antes de empezar a recuperar
  stabRegenTime: 60, // segundos para recuperar la estabilidad completa (de 0 a 100)

  // Mareo: golpes fuertes (y siempre el escupitajo) marean
  dazeForce: 15, // fuerza de golpe a partir de la cual hay chance
  dazeMin: 2,
  dazeMax: 3.5,
  stunBase: 0.22,
  stunPerForce: 0.03,
  stunFriction: 9,
  wallSplat: false, // false = los muros solo rebotan (para morir: huecos, pinches, sierras)
  splatImpulse: 21,
  impaleTime: 2.5, // segundos clavado en los pinches antes de reventar

  // Piel gelatinosa
  skinStiffness: 170,
  skinDamping: 5.5,
  skinCoupling: 70,
  skinInertia: 0.4,
  dentDepth: 0.03,
  squashAmount: 0.05,

  // Juice
  shake: 0.35,

  // Armas / power-ups (bolitas amarillas)
  powerChance: 0.1, // probabilidad de que una bolita que cae sea amarilla
  buffTime: 30, // duración de recarga x2 / turbo / fuerza (se activan al agarrarlas)
  strengthMul: 1.6,
  oilLife: 30,
  oilRadius: 2.4,
  oilCharges: 1, // manchas por bolita
  oilThrowDist: 3.5, // a cuántos metros detrás tuyo cae la mancha
  spitCharges: 1, // chorros por bolita (el arma de la F; en el código se llama "spit")
  spitSpeed: 34,
  spitRange: 30, // hasta dónde apunta solo
  spitKnock: 5, // empujón del chorro (además de marear)

  // Puntaje
  koPoints: 100, // por cada enemigo que eliminás (base, a igual tamaño)
  koSizeExp: 0.75, // cuánto pesa la diferencia de tamaño en los puntos por KO
  alivePoints: 1, // por segundo vivo

  // Cámara con la que arranca la partida (tecla C vuelve a esta)
  camCenter: 1, // 1 = la cámara apunta a tu gelatina · 0.75 (antes) = a medio camino del centro: lejos del centro quedabas corrida
  camFollow: 8, // qué tan rápido te sigue la cámara (antes 4: al correr o embestir quedabas fuera del centro)
  camDist: 41, // distancia = zoom (más grande = más lejos). Antes 37.
  camPitch: 0.75, // inclinación en radianes (0 = al ras del piso, 1.57 = desde arriba)
  camFov: 45, // campo visual en grados (más grande = gran angular)
  // ritmo de fps (ver adaptive.js): 'auto' = arranca a la frecuencia del monitor y baja a una fracción pareja
  // si la PC no llega (144 Hz → 144 o 72), y vuelve a subir cuando sobra; '60' = 60 fijos; 'off' = lo que dé el monitor
  fpsCap: 'auto',

  botsAggressive: true,
  bloom: true,
};
