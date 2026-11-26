// Idiomas. Se elige solo según el navegador (si no es ninguno de estos, inglés) y se cambia en la pantalla de inicio.
// Textos fijos de la página: atributos data-i18n (texto), data-i18n-html (con etiquetas) y data-i18n-title.
// Textos que arma el código: t('clave', { variables }).
// Para agregar un idioma: sumar su bloque abajo con las mismas claves (lo que falte sale en español).
// El panel de admin (H) y el contador de FPS quedan en español: son herramientas de desarrollo.

export const LANGS = { es: 'Español', en: 'English', pt: 'Português' };

const DICT = {
  es: {
    'net.offline': 'Sin conexión con el servidor: juegas contra bots',
    'net.connecting': 'Buscando una sala…', 'net.lost': 'Se perdió la conexión con el servidor', 'net.full': 'Esa sala está llena', 'net.fail': 'No se pudo conectar con el servidor. Prueba de nuevo en un momento.',
    'tm.go': '¡YA!',
    'lb.records': '🏆 Mejores de la semana',
    'rk.all': 'Ver ranking completo →', 'rk.empty': 'Todavía nadie esta semana. ¡Sé el primero!', 'rk.you': 'Tu mejor puesto: #{rank} ({value})', 'rk.byPts': '🏆 Puntos', 'rk.bySize': '🫧 Tamaño', 'rk.size': 'Tamaño',
    'rk.title': '🏆 Ranking', 'rk.week': 'Semana', 'rk.month': 'Mes', 'rk.ever': 'Siempre', 'rk.ffa': 'Todos contra todos', 'rk.teams': 'Equipos',
    'rk.player': 'Jugador', 'rk.pts': 'Puntos', 'rk.kos': 'KOs', 'rk.games': 'Partidas', 'rk.when': 'Cuándo', 'rk.close': 'Cerrar', 'rk.anon': 'Blob sin nombre #{tag}', 'rk.mine': '(tú)', 'rk.nameHint': '✏️ Ponte un nombre para aparecer en el ranking',
    'rk.none': 'Todavía no hay partidas en este período.', 'rk.note': 'Cuenta la mejor partida de cada jugador (en Tamaño, lo más grande que llegó a ser). Semana y mes: los últimos 7 y 30 días.',
    'mode.title': '¿Cómo quieres jugar?', 'mode.back': 'Volver',
    'mode.ffa': 'Todos contra todos', 'mode.ffaD': 'Cada uno por su cuenta. Si te sacan, vuelves enseguida. Suma puntos sacando a los demás.',
    'mode.teams': 'Equipos', 'mode.teamsD': 'Azul contra Rojo, 8 contra 8, al mejor de 5 rondas. Si te sacan, esperas a la ronda siguiente. Gana la ronda el equipo que deja al otro sin nadie.',
    'team.0': 'Azul', 'team.1': 'Rojo', 'tm.round': 'Ronda {n}', 'tm.youAre': 'Juegas en el equipo', 'tm.bestOf': 'al mejor de 5 rondas', 'tm.youWinMatch': '🏆 ¡Tu equipo ganó la partida!', 'tm.wonMatch': 'El equipo {team} ganó la partida', 'tm.youWin': '🏆 ¡Ganó tu equipo!', 'tm.won': 'Ganó el equipo {team}', 'tm.draw': 'Empate',
    'tm.waiting': '👀 Miras a {name} · vuelves en la próxima ronda',
    you: 'Tú',
    loading: 'Cargando…', loadingQuality: 'Ajustando la calidad…', loadingGpu: 'Recuperando la tarjeta de video…',
    'do.msg': 'Es un juego para <strong>computadora</strong>',
    'do.sub': 'Se juega con teclado (o control) y necesita una máquina potente.<br />Entra desde una PC o una computadora portátil.',
    'do.anyway': 'Probar de todos modos',
    'rotate.title': 'Gira el teléfono', 'rotate.sub': 'Bouncy Blobs se juega con el teléfono en horizontal',
    help: `Come los <span class="white">blobcitos blancos</span> para crecer<br />
Muros: rebotas · <span style="color:#ffb000">Huecos</span>: caes · <span style="color:#ff5a5a">Pinchos</span>: quedas clavado<br />
Embiste los <span style="color:#ff5a5a">botones rojos</span> para abrir los pozos<br />
Bolitas <span style="color:#ffd21a">amarillas</span>: poderes y armas (aceite y chorro)`,
    'op.otherKeys': `<kbd>Arrastrar</kbd> girar la cámara · <kbd>Rueda</kbd> zoom · <kbd>V</kbd> vistas · <kbd>C</kbd> cámara inicial<br />
<kbd>P</kbd> cambiar forma, color y tatuaje · <kbd>M</kbd> sonido · <kbd>Esc</kbd> opciones`,
    'op.dev': `Pruebas: <kbd>8</kbd><kbd>9</kbd><kbd>0</kbd> arenas · <kbd>+</kbd>/<kbd>-</kbd> crecer/encoger · <kbd>B</kbd> bots · <kbd>R</kbd> reiniciar · <kbd>H</kbd> admin · <kbd>I</kbd> FPS`,
    'key.space': 'Espacio',
    'k.oil': '{key:oil}', 'k.spit': '{key:spit}', // teclas de las armas en el HUD (valen para todos los idiomas)
    'op.title': 'Opciones', 'op.gear': 'Opciones (Esc)', 'op.close': 'Volver al juego', 'op.lobby': '🎨 Cambiar mi blob',
    'op.tab.controls': '🎮 Controles', 'op.tab.graphics': '🖥️ Gráficos', 'op.tab.sound': '🔊 Sonido', 'op.tab.lang': '🌐 Idioma',
    'op.preset': 'Distribución', 'op.preset.arrows': 'Flechas', 'op.preset.wasd': 'WASD + J K L', 'op.preset.custom': 'Personalizada',
    'op.rebind': 'Haz clic en una tecla para cambiarla', 'op.press': 'Presiona una tecla…', 'op.reset': '↺ Restaurar',
    'act.up': 'Adelante', 'act.left': 'Izquierda', 'act.down': 'Atrás', 'act.right': 'Derecha', 'act.jump': 'Saltar', 'act.sprint': 'Correr (mantener)',
    'act.dash': 'Embestir (en el aire: picada)', 'act.oil': 'Tirar aceite 🛢️', 'act.spit': 'Lanzar chorro 💦',
    'op.howto': 'Cómo se juega', 'op.other': 'Otros atajos',
    'op.quality': 'Calidad gráfica', 'op.fps': 'Fluidez', 'op.fps.auto': 'Automática', 'op.fps.60': '60 fijos', 'op.fps.off': 'Máxima',
    'op.fpsHint': 'Automática = se adapta a tu monitor y a tu computadora', 'op.now': 'Monitor de {hz} Hz · ahora {fps} fps · resolución {res} %',
    'op.sound': 'Sonido', 'op.on': 'Activado', 'op.off': 'Silenciado', 'op.volume': 'Volumen', 'op.music': 'Música', 'op.musicNext': '⏭ Otra canción',
    'bots.aggr': 'Bots: AGRESIVOS', 'bots.passive': 'Bots: pasivos',
    'arena.cyber': 'Cyberpunk', 'arena.steam': 'Steampunk', 'arena.crystal': 'Cristal', 'arena.tutorial': 'Tutorial',
    // pantalla de inicio
    'lb.sub': 'Crea tu blob y entra a la arena',
    'lb.lang': 'Idioma', 'lb.name': 'Nombre', 'lb.shape': 'Forma',
    'lb.color': 'Color', 'lb.colorHint': 'arrastra el gotero', 'lb.random': '🎲 Al azar', 'lb.randomTitle': 'Color al azar',
    'lb.tattoo': 'Tatuaje', 'lb.tattooHint': 'dibuja con el mouse · se ve en la espalda',
    'lb.thickness': 'Grosor', 'lb.eraser': '🧽 Borrador', 'lb.eraserTitle': 'Borrador',
    'lb.undo': '↶ Deshacer', 'lb.undoTitle': 'Deshacer (Ctrl+Z)', 'lb.clear': '🗑️ Borrar', 'lb.clearTitle': 'Borrar todo',
    'lb.quality': 'Calidad gráfica', 'lb.qualityHint': 'automática = baja sola si va lento',
    'lb.go': '¡A JUGAR!', 'lb.foot': 'Enter = jugar · <kbd>P</kbd> durante el juego vuelve a esta pantalla',
    'lb.tip': 'arrastra para girarlo · clic = pínchalo',
    'shape.round': 'Redonda', 'shape.tall': 'Alta', 'shape.drop': 'Gota', 'shape.box': 'Cuadrada', 'shape.bean': 'Frijol',
    'q.auto': 'Auto', 'q.alta': 'Alta', 'q.media': 'Media', 'q.baja': 'Baja', 'q.minima': 'Mínima',
    // ventanita "¿primera vez?"
    'tm.title': '¿Es tu primera vez?', 'tm.text': 'Hay un tutorial corto que enseña a moverse, embestir, crecer y usar los poderes. Toma unos 3 minutos.',
    'tm.yes': '🎓 Hacer el tutorial', 'tm.no': 'Jugar directamente',
    // HUD
    pts: 'PTS', ko: 'KO', falls: 'caídas', ranking: 'POSICIONES',
    stab: 'FIRMEZA', mass: 'MASA', energy: 'ENERGÍA',
    stabTip: 'Baja con cada golpe: cuanto más baja, más lejos sales volando',
    massTip: 'Come blobcitos blancos para crecer',
    energyTip: 'Correr ({key:sprint}) y embestir ({key:dash}) la gastan; se recarga sola',
    dazed: '💫 ¡Presiona teclas rápido para recuperarte!', slip: '¡Patinando!',
    'power.oil': 'Aceite', 'power.spit': 'Chorro', 'power.turbo': 'Turbo', 'power.strength': 'Fuerza', 'power.heal': 'Firmeza', 'power.feast': 'Banquete',
    'pdesc.turbo': 'el doble de velocidad durante 30 s', 'pdesc.strength': 'tus golpes pegan más fuerte durante 30 s',
    'pdesc.heal': 'vuelves a estar firme como recién hecho', 'pdesc.feast': 'como comer 10 blobcitos de una vez',
    'toast.quality': 'Calidad: {q}', 'toast.cam': 'Cámara: {n}', 'toast.mass': 'Masa: x{m}', 'toast.welcome': '¡Adelante, {name}!',
    'cam.game': 'Juego', 'cam.ref': 'Referencia', 'cam.far': 'Lejos', 'cam.top': 'Cenital',
    // celular
    'tc.jump': 'SALTAR', 'tc.dash': 'EMBESTIR', 'tc.menu': 'Menú',
    // tutorial
    'tut.btn': '🎓 Tutorial: aprende a jugar',
    'tut.head': 'TUTORIAL · {n}/{total}', 'tut.skip': 'Salir ✕', 'tut.ok': '✓ ¡Bien!',
    'tut.move.t': 'Moverse', 'tut.move.d': 'Usa <kbd>{key:move}</kbd> para moverte por la arena.',
    'tut.sprint.t': 'Ir rápido', 'tut.sprint.d': 'Mantén <kbd>{key:sprint}</kbd> mientras te mueves para correr. Gasta <b>energía</b> (la barra de abajo), que se recarga sola cuando lo sueltas.',
    'tut.jump.t': 'Saltar', 'tut.jump.d': 'Presiona <kbd>{key:jump}</kbd> para saltar. Si lo mantienes presionado, saltas más alto.',
    'tut.eat.t': 'Crecer', 'tut.eat.d': 'Pasa por encima de los <b>blobcitos blancos</b> para comerlos. Cada uno te hace un poco más grande: pegas más fuerte y cuesta más empujarte, pero te mueves más lento.',
    'tut.dash.t': 'Embestir', 'tut.dash.d': 'Acércate al otro blob y presiona <kbd>{key:dash}</kbd> para embestirlo. Cuanto más rápido vas, más fuerte pega.',
    'tut.dive.t': 'Saltar y embestir', 'tut.dive.d': 'Salta con <kbd>{key:jump}</kbd> y, en el aire, presiona <kbd>{key:dash}</kbd>: te lanzas en <b>picada</b>, que pega más fuerte.',
    'tut.powers.t': 'Poderes', 'tut.powers.d': 'Las <b>bolitas amarillas</b> dan poderes. Al tocarlas se activan solas. Agarra las cuatro:',
    'tut.oil.t': 'Aceite', 'tut.oil.d': 'Algunas bolitas amarillas traen un arma que guardas para usar cuando quieras.',
    'tut.oil.a': 'Agarra la bolita amarilla: trae <b>aceite</b> 🛢️', 'tut.oil.b': 'Presiona <kbd>{key:oil}</kbd> para tirarlo hacia atrás: quien lo pisa sale patinando',
    'tut.spit.t': 'Chorro', 'tut.spit.d': 'Otra arma: el <b>chorro</b> pegajoso deja mareado a quien recibe el impacto.',
    'tut.spit.a': 'Agarra la bolita amarilla: trae un <b>chorro</b> 💦', 'tut.spit.b': 'Mira hacia el otro blob y presiona <kbd>{key:spit}</kbd> para lanzárselo',
    'tut.end.t': '¡Listo!', 'tut.end.d': 'Ya conoces lo básico. En la partida, saca a los demás de la arena (huecos, pozos, pinchos, sierras) para sumar puntos, y come <b>blobcitos blancos</b> para crecer.',
    'tut.play': '¡A JUGAR!', 'tut.again': 'Repetir', 'tut.menu': 'Volver al menú',
  },
  en: {
    'net.offline': 'No server connection: playing against bots',
    'net.connecting': 'Finding a room…', 'net.lost': 'Lost connection to the server', 'net.full': 'That room is full', 'net.fail': 'Could not connect to the server. Try again in a moment.',
    'tm.go': 'GO!',
    'lb.records': "🏆 This week's best",
    'rk.all': 'See full ranking →', 'rk.empty': 'Nobody yet this week. Be the first!', 'rk.you': 'Your best spot: #{rank} ({value})', 'rk.byPts': '🏆 Points', 'rk.bySize': '🫧 Size', 'rk.size': 'Size',
    'rk.title': '🏆 Ranking', 'rk.week': 'Week', 'rk.month': 'Month', 'rk.ever': 'All time', 'rk.ffa': 'Free for all', 'rk.teams': 'Teams',
    'rk.player': 'Player', 'rk.pts': 'Points', 'rk.kos': 'KOs', 'rk.games': 'Matches', 'rk.when': 'When', 'rk.close': 'Close', 'rk.anon': 'Nameless blob #{tag}', 'rk.mine': '(you)', 'rk.nameHint': '✏️ Pick a name to show up in the ranking',
    'rk.none': 'No matches in this period yet.', 'rk.note': "Each player's best match counts (for Size, the biggest they got). Week and month: the last 7 and 30 days.",
    'mode.title': 'How do you want to play?', 'mode.back': 'Back',
    'mode.ffa': 'Free for all', 'mode.ffaD': 'Everyone for themselves. If you get knocked out, you are back right away. Score by knocking others out.',
    'mode.teams': 'Teams', 'mode.teamsD': 'Blue vs Red, 8 vs 8, best of 5 rounds. If you get knocked out, you wait for the next round. The team that wipes out the other wins the round.',
    'team.0': 'Blue', 'team.1': 'Red', 'tm.round': 'Round {n}', 'tm.youAre': 'You play for team', 'tm.bestOf': 'best of 5 rounds', 'tm.youWinMatch': '🏆 Your team won the match!', 'tm.wonMatch': '{team} team won the match', 'tm.youWin': '🏆 Your team won!', 'tm.won': '{team} team won', 'tm.draw': 'Draw',
    'tm.waiting': '👀 Watching {name} · you are back next round',
    you: 'You',
    loading: 'Loading…', loadingQuality: 'Adjusting quality…', loadingGpu: 'Recovering the graphics card…',
    'do.msg': 'This game is for <strong>computers</strong>',
    'do.sub': 'It is played with a keyboard (or gamepad) and needs a fairly powerful machine.<br />Open it on a PC or a laptop.',
    'do.anyway': 'Try anyway',
    'rotate.title': 'Rotate your phone', 'rotate.sub': 'Bouncy Blobs is played in landscape',
    help: `Eat the <span class="white">little white blobs</span> to grow<br />
Walls: you bounce · <span style="color:#ffb000">Holes</span>: you fall · <span style="color:#ff5a5a">Spikes</span>: you get stuck<br />
Ram the <span style="color:#ff5a5a">red buttons</span> to open the pits<br />
<span style="color:#ffd21a">Yellow</span> orbs: powers and weapons (oil and jet)`,
    'op.otherKeys': `<kbd>Drag</kbd> rotate camera · <kbd>Wheel</kbd> zoom · <kbd>V</kbd> views · <kbd>C</kbd> default camera<br />
<kbd>P</kbd> change shape, color and tattoo · <kbd>M</kbd> sound · <kbd>Esc</kbd> options`,
    'op.dev': `Testing: <kbd>8</kbd><kbd>9</kbd><kbd>0</kbd> arenas · <kbd>+</kbd>/<kbd>-</kbd> grow/shrink · <kbd>B</kbd> bots · <kbd>R</kbd> restart · <kbd>H</kbd> admin · <kbd>I</kbd> FPS`,
    'key.space': 'Space',
    'op.title': 'Options', 'op.gear': 'Options (Esc)', 'op.close': 'Back to the game', 'op.lobby': '🎨 Change my blob',
    'op.tab.controls': '🎮 Controls', 'op.tab.graphics': '🖥️ Graphics', 'op.tab.sound': '🔊 Sound', 'op.tab.lang': '🌐 Language',
    'op.preset': 'Layout', 'op.preset.arrows': 'Arrows', 'op.preset.wasd': 'WASD + J K L', 'op.preset.custom': 'Custom',
    'op.rebind': 'Click a key to change it', 'op.press': 'Press a key…', 'op.reset': '↺ Reset',
    'act.up': 'Forward', 'act.left': 'Left', 'act.down': 'Back', 'act.right': 'Right', 'act.jump': 'Jump', 'act.sprint': 'Sprint (hold)',
    'act.dash': 'Ram (in the air: dive)', 'act.oil': 'Throw oil 🛢️', 'act.spit': 'Shoot jet 💦',
    'op.howto': 'How to play', 'op.other': 'Other shortcuts',
    'op.quality': 'Graphics quality', 'op.fps': 'Smoothness', 'op.fps.auto': 'Automatic', 'op.fps.60': 'Fixed 60', 'op.fps.off': 'Maximum',
    'op.fpsHint': 'Automatic = adapts to your monitor and your computer', 'op.now': '{hz} Hz monitor · now {fps} fps · resolution {res} %',
    'op.sound': 'Sound', 'op.on': 'On', 'op.off': 'Muted', 'op.volume': 'Volume', 'op.music': 'Music', 'op.musicNext': '⏭ Next song',
    'bots.aggr': 'Bots: AGGRESSIVE', 'bots.passive': 'Bots: passive',
    'arena.cyber': 'Cyberpunk', 'arena.steam': 'Steampunk', 'arena.crystal': 'Crystal',
    'lb.sub': 'Make your blob and jump into the arena',
    'lb.lang': 'Language', 'lb.name': 'Name', 'lb.shape': 'Shape',
    'lb.color': 'Color', 'lb.colorHint': 'drag the dropper', 'lb.random': '🎲 Random', 'lb.randomTitle': 'Random color',
    'lb.tattoo': 'Tattoo', 'lb.tattooHint': 'draw with the mouse · it shows on the back',
    'lb.thickness': 'Size', 'lb.eraser': '🧽 Eraser', 'lb.eraserTitle': 'Eraser',
    'lb.undo': '↶ Undo', 'lb.undoTitle': 'Undo (Ctrl+Z)', 'lb.clear': '🗑️ Clear', 'lb.clearTitle': 'Clear all',
    'lb.quality': 'Graphics quality', 'lb.qualityHint': 'auto = lowers itself if it runs slow',
    'lb.go': 'PLAY!', 'lb.foot': 'Enter = play · <kbd>P</kbd> in game brings you back here',
    'lb.tip': 'drag to spin it · click = poke it',
    'shape.round': 'Round', 'shape.tall': 'Tall', 'shape.drop': 'Drop', 'shape.box': 'Square', 'shape.bean': 'Bean',
    'q.auto': 'Auto', 'q.alta': 'High', 'q.media': 'Medium', 'q.baja': 'Low', 'q.minima': 'Minimum',
    pts: 'PTS', ko: 'KO', falls: 'falls', ranking: 'STANDINGS',
    stab: 'FIRMNESS', mass: 'MASS', energy: 'ENERGY',
    stabTip: 'Drops with every hit: the lower it is, the farther you fly',
    massTip: 'Eat little white blobs to grow',
    energyTip: 'Sprinting ({key:sprint}) and ramming ({key:dash}) use it; it refills by itself',
    dazed: '💫 Mash any keys to recover!', slip: 'Slipping!',
    'power.oil': 'Oil', 'power.spit': 'Jet', 'power.turbo': 'Turbo', 'power.strength': 'Strength', 'power.heal': 'Firmness', 'power.feast': 'Feast',
    'toast.quality': 'Quality: {q}', 'toast.cam': 'Camera: {n}', 'toast.mass': 'Mass: x{m}', 'toast.welcome': "You're in, {name}!",
    'cam.game': 'Game', 'cam.ref': 'Reference', 'cam.far': 'Far', 'cam.top': 'Top-down',
    'tc.jump': 'JUMP', 'tc.dash': 'RAM', 'tc.menu': 'Menu',
    'arena.tutorial': 'Tutorial',
    'tut.btn': '🎓 Tutorial: learn to play',
    'tut.head': 'TUTORIAL · {n}/{total}', 'tut.skip': 'Exit ✕', 'tut.ok': '✓ Nice!',
    'tut.move.t': 'Move', 'tut.move.d': 'Use <kbd>{key:move}</kbd> to move around the arena.',
    'tut.sprint.t': 'Go fast', 'tut.sprint.d': 'Hold <kbd>{key:sprint}</kbd> while moving to sprint. It uses <b>energy</b> (the bar at the bottom), which refills by itself when you let go.',
    'tut.jump.t': 'Jump', 'tut.jump.d': 'Press <kbd>{key:jump}</kbd> to jump. Hold it down to jump higher.',
    'tut.dash.t': 'Ram', 'tut.dash.d': 'Get close to the other blob and press <kbd>{key:dash}</kbd> to ram it. The faster you go, the harder it hits.',
    'tut.dive.t': 'Jump and ram', 'tut.dive.d': 'Jump with <kbd>{key:jump}</kbd> and press <kbd>{key:dash}</kbd> in the air: you <b>dive</b>, which hits harder.',
    'tut.oil.t': 'Oil', 'tut.oil.d': 'Some yellow orbs carry a weapon that you keep and use whenever you want.',
    'tut.spit.t': 'Jet', 'tut.spit.d': 'Another weapon: the sticky <b>jet</b> leaves whoever it hits dizzy.',
    'tut.end.t': 'Done!', 'tut.end.d': 'You know the basics. In a match, knock the others out of the arena (gaps, pits, spikes, saws) to score, and eat <b>little white blobs</b> to grow.',
    'tut.play': 'PLAY!', 'tut.again': 'Again', 'tut.menu': 'Back to menu',
    'tut.eat.t': 'Grow', 'tut.eat.d': 'Roll over the <b>little white blobs</b> to eat them. Each one makes you a bit bigger: you hit harder and are harder to push, but you move slower.',
    'tut.powers.t': 'Powers', 'tut.powers.d': '<b>Yellow orbs</b> give powers. They activate as soon as you touch them. Grab all four:',
    'tut.oil.a': 'Grab the yellow orb: it carries <b>oil</b> 🛢️', 'tut.oil.b': 'Press <kbd>{key:oil}</kbd> to throw it behind you: whoever steps on it slips away',
    'tut.spit.a': 'Grab the yellow orb: it carries a <b>jet</b> 💦', 'tut.spit.b': 'Face the other blob and press <kbd>{key:spit}</kbd> to shoot it',
    'pdesc.turbo': 'double speed for 30 s', 'pdesc.strength': 'your hits are stronger for 30 s',
    'pdesc.heal': 'you are firm again, like freshly made', 'pdesc.feast': 'like eating 10 little blobs at once',
    'tm.title': 'First time here?', 'tm.text': 'There is a short tutorial that teaches you to move, ram, grow and use powers. It takes about 3 minutes.',
    'tm.yes': '🎓 Do the tutorial', 'tm.no': 'Just play',
  },
  pt: {
    'net.offline': 'Sem conexão com o servidor: você joga contra bots',
    'net.connecting': 'Procurando uma sala…', 'net.lost': 'A conexão com o servidor caiu', 'net.full': 'Essa sala está cheia', 'net.fail': 'Não foi possível conectar ao servidor. Tente de novo em instantes.',
    'tm.go': 'JÁ!',
    'lb.records': '🏆 Melhores da semana',
    'rk.all': 'Ver ranking completo →', 'rk.empty': 'Ninguém ainda nesta semana. Seja o primeiro!', 'rk.you': 'Sua melhor posição: #{rank} ({value})', 'rk.byPts': '🏆 Pontos', 'rk.bySize': '🫧 Tamanho', 'rk.size': 'Tamanho',
    'rk.title': '🏆 Ranking', 'rk.week': 'Semana', 'rk.month': 'Mês', 'rk.ever': 'Sempre', 'rk.ffa': 'Todos contra todos', 'rk.teams': 'Equipes',
    'rk.player': 'Jogador', 'rk.pts': 'Pontos', 'rk.kos': 'KOs', 'rk.games': 'Partidas', 'rk.when': 'Quando', 'rk.close': 'Fechar', 'rk.anon': 'Blob sem nome #{tag}', 'rk.mine': '(você)', 'rk.nameHint': '✏️ Escolha um nome para aparecer no ranking',
    'rk.none': 'Ainda não há partidas neste período.', 'rk.note': 'Conta a melhor partida de cada jogador (em Tamanho, o maior que chegou a ficar). Semana e mês: os últimos 7 e 30 dias.',
    'mode.title': 'Como você quer jogar?', 'mode.back': 'Voltar',
    'mode.ffa': 'Todos contra todos', 'mode.ffaD': 'Cada um por si. Se te tirarem, você volta na hora. Ganhe pontos tirando os outros.',
    'mode.teams': 'Equipes', 'mode.teamsD': 'Azul contra Vermelho, 8 contra 8, melhor de 5 rodadas. Se te tirarem, você espera a próxima rodada. Vence a rodada a equipe que deixar a outra sem ninguém.',
    'team.0': 'Azul', 'team.1': 'Vermelho', 'tm.round': 'Rodada {n}', 'tm.youAre': 'Você joga na equipe', 'tm.bestOf': 'melhor de 5 rodadas', 'tm.youWinMatch': '🏆 Sua equipe venceu a partida!', 'tm.wonMatch': 'A equipe {team} venceu a partida', 'tm.youWin': '🏆 Sua equipe venceu!', 'tm.won': 'A equipe {team} venceu', 'tm.draw': 'Empate',
    'tm.waiting': '👀 Assistindo {name} · você volta na próxima rodada',
    you: 'Você',
    loading: 'Carregando…', loadingQuality: 'Ajustando a qualidade…', loadingGpu: 'Recuperando a placa de vídeo…',
    'do.msg': 'É um jogo para <strong>computador</strong>',
    'do.sub': 'Se joga com teclado (ou controle) e exige bastante da máquina.<br />Entre por um PC ou notebook.',
    'do.anyway': 'Testar mesmo assim',
    'rotate.title': 'Gire o celular', 'rotate.sub': 'Bouncy Blobs se joga com o celular deitado',
    help: `Coma os <span class="white">blobzinhos brancos</span> para crescer<br />
Paredes: você quica · <span style="color:#ffb000">Buracos</span>: você cai · <span style="color:#ff5a5a">Espinhos</span>: você fica preso<br />
Dê uma investida nos <span style="color:#ff5a5a">botões vermelhos</span> para abrir os poços<br />
Bolinhas <span style="color:#ffd21a">amarelas</span>: poderes e armas (óleo e jato)`,
    'op.otherKeys': `<kbd>Arrastar</kbd> girar a câmera · <kbd>Roda</kbd> zoom · <kbd>V</kbd> vistas · <kbd>C</kbd> câmera inicial<br />
<kbd>P</kbd> mudar forma, cor e tatuagem · <kbd>M</kbd> som · <kbd>Esc</kbd> opções`,
    'op.dev': `Testes: <kbd>8</kbd><kbd>9</kbd><kbd>0</kbd> arenas · <kbd>+</kbd>/<kbd>-</kbd> crescer/encolher · <kbd>B</kbd> bots · <kbd>R</kbd> reiniciar · <kbd>H</kbd> admin · <kbd>I</kbd> FPS`,
    'key.space': 'Espaço',
    'op.title': 'Opções', 'op.gear': 'Opções (Esc)', 'op.close': 'Voltar ao jogo', 'op.lobby': '🎨 Mudar meu blob',
    'op.tab.controls': '🎮 Controles', 'op.tab.graphics': '🖥️ Gráficos', 'op.tab.sound': '🔊 Som', 'op.tab.lang': '🌐 Idioma',
    'op.preset': 'Layout', 'op.preset.arrows': 'Setas', 'op.preset.wasd': 'WASD + J K L', 'op.preset.custom': 'Personalizado',
    'op.rebind': 'Clique numa tecla para trocá-la', 'op.press': 'Aperte uma tecla…', 'op.reset': '↺ Restaurar',
    'act.up': 'Frente', 'act.left': 'Esquerda', 'act.down': 'Trás', 'act.right': 'Direita', 'act.jump': 'Pular', 'act.sprint': 'Correr (segurar)',
    'act.dash': 'Investida (no ar: mergulho)', 'act.oil': 'Jogar óleo 🛢️', 'act.spit': 'Lançar jato 💦',
    'op.howto': 'Como jogar', 'op.other': 'Outros atalhos',
    'op.quality': 'Qualidade gráfica', 'op.fps': 'Fluidez', 'op.fps.auto': 'Automática', 'op.fps.60': '60 fixos', 'op.fps.off': 'Máxima',
    'op.fpsHint': 'Automática = se adapta ao seu monitor e ao seu computador', 'op.now': 'Monitor de {hz} Hz · agora {fps} fps · resolução {res} %',
    'op.sound': 'Som', 'op.on': 'Ligado', 'op.off': 'Mudo', 'op.volume': 'Volume', 'op.music': 'Música', 'op.musicNext': '⏭ Outra música',
    'bots.aggr': 'Bots: AGRESSIVOS', 'bots.passive': 'Bots: passivos',
    'arena.cyber': 'Cyberpunk', 'arena.steam': 'Steampunk', 'arena.crystal': 'Cristal',
    'lb.sub': 'Monte seu blob e entre na arena',
    'lb.lang': 'Idioma', 'lb.name': 'Nome', 'lb.shape': 'Forma',
    'lb.color': 'Cor', 'lb.colorHint': 'arraste o conta-gotas', 'lb.random': '🎲 Aleatória', 'lb.randomTitle': 'Cor aleatória',
    'lb.tattoo': 'Tatuagem', 'lb.tattooHint': 'desenhe com o mouse · aparece nas costas',
    'lb.thickness': 'Espessura', 'lb.eraser': '🧽 Borracha', 'lb.eraserTitle': 'Borracha',
    'lb.undo': '↶ Desfazer', 'lb.undoTitle': 'Desfazer (Ctrl+Z)', 'lb.clear': '🗑️ Apagar', 'lb.clearTitle': 'Apagar tudo',
    'lb.quality': 'Qualidade gráfica', 'lb.qualityHint': 'automática = baixa sozinha se ficar lento',
    'lb.go': 'JOGAR!', 'lb.foot': 'Enter = jogar · <kbd>P</kbd> no jogo volta para esta tela',
    'lb.tip': 'arraste para girar · clique = cutuque',
    'shape.round': 'Redonda', 'shape.tall': 'Alta', 'shape.drop': 'Gota', 'shape.box': 'Quadrada', 'shape.bean': 'Feijão',
    'q.auto': 'Auto', 'q.alta': 'Alta', 'q.media': 'Média', 'q.baja': 'Baixa', 'q.minima': 'Mínima',
    pts: 'PTS', ko: 'KO', falls: 'quedas', ranking: 'CLASSIFICAÇÃO',
    stab: 'FIRMEZA', mass: 'MASSA', energy: 'ENERGIA',
    stabTip: 'Cai a cada golpe: quanto mais baixa, mais longe você voa',
    massTip: 'Coma blobzinhos brancos para crescer',
    energyTip: 'Correr ({key:sprint}) e dar investidas ({key:dash}) gastam; recarrega sozinha',
    dazed: '💫 Aperte teclas rápido para se recuperar!', slip: 'Escorregando!',
    'power.oil': 'Óleo', 'power.spit': 'Jato', 'power.turbo': 'Turbo', 'power.strength': 'Força', 'power.heal': 'Firmeza', 'power.feast': 'Banquete',
    'toast.quality': 'Qualidade: {q}', 'toast.cam': 'Câmera: {n}', 'toast.mass': 'Massa: x{m}', 'toast.welcome': 'Você entrou, {name}!',
    'cam.game': 'Jogo', 'cam.ref': 'Referência', 'cam.far': 'Longe', 'cam.top': 'De cima',
    'tc.jump': 'PULAR', 'tc.dash': 'INVESTIR', 'tc.menu': 'Menu',
    'arena.tutorial': 'Tutorial',
    'tut.btn': '🎓 Tutorial: aprenda a jogar',
    'tut.head': 'TUTORIAL · {n}/{total}', 'tut.skip': 'Sair ✕', 'tut.ok': '✓ Boa!',
    'tut.move.t': 'Mover', 'tut.move.d': 'Use <kbd>{key:move}</kbd> para se mover pela arena.',
    'tut.sprint.t': 'Ir rápido', 'tut.sprint.d': 'Segure <kbd>{key:sprint}</kbd> enquanto se move para correr. Gasta <b>energia</b> (a barra de baixo), que recarrega sozinha quando você solta.',
    'tut.jump.t': 'Pular', 'tut.jump.d': 'Aperte <kbd>{key:jump}</kbd> para pular. Segurando, você pula mais alto.',
    'tut.dash.t': 'Investida', 'tut.dash.d': 'Chegue perto do outro blob e aperte <kbd>{key:dash}</kbd> para dar uma investida. Quanto mais rápido, mais forte.',
    'tut.dive.t': 'Pular e investir', 'tut.dive.d': 'Pule com <kbd>{key:jump}</kbd> e, no ar, aperte <kbd>{key:dash}</kbd>: você dá um <b>mergulho</b>, que bate mais forte.',
    'tut.oil.t': 'Óleo', 'tut.oil.d': 'Algumas bolinhas amarelas trazem uma arma que você guarda para usar quando quiser.',
    'tut.spit.t': 'Jato', 'tut.spit.d': 'Outra arma: o <b>jato</b> grudento deixa tonto quem é atingido.',
    'tut.end.t': 'Pronto!', 'tut.end.d': 'Você já sabe o básico. Na partida, jogue os outros para fora da arena (buracos, poços, espinhos, serras) para marcar pontos, e coma <b>blobzinhos brancos</b> para crescer.',
    'tut.play': 'JOGAR!', 'tut.again': 'Repetir', 'tut.menu': 'Voltar ao menu',
    'tut.eat.t': 'Crescer', 'tut.eat.d': 'Passe por cima dos <b>blobzinhos brancos</b> para comê-los. Cada um te deixa um pouco maior: você bate mais forte e é mais difícil de empurrar, mas fica mais lento.',
    'tut.powers.t': 'Poderes', 'tut.powers.d': 'As <b>bolinhas amarelas</b> dão poderes. Elas ativam sozinhas quando você encosta. Pegue as quatro:',
    'tut.oil.a': 'Pegue a bolinha amarela: ela traz <b>óleo</b> 🛢️', 'tut.oil.b': 'Aperte <kbd>{key:oil}</kbd> para jogar para trás: quem pisa sai escorregando',
    'tut.spit.a': 'Pegue a bolinha amarela: ela traz um <b>jato</b> 💦', 'tut.spit.b': 'Olhe para o outro blob e aperte <kbd>{key:spit}</kbd> para lançar',
    'pdesc.turbo': 'o dobro de velocidade por 30 s', 'pdesc.strength': 'seus golpes ficam mais fortes por 30 s',
    'pdesc.heal': 'você fica firme de novo, como recém-feito', 'pdesc.feast': 'como comer 10 blobzinhos de uma vez',
    'tm.title': 'É sua primeira vez?', 'tm.text': 'Tem um tutorial curto que ensina a se mover, dar investidas, crescer e usar os poderes. Leva uns 3 minutos.',
    'tm.yes': '🎓 Fazer o tutorial', 'tm.no': 'Jogar direto',
  },
};

const STORE = 'gelatinas.lang';

function detect() {
  try { const s = localStorage.getItem(STORE); if (DICT[s]) return s; } catch { /* sin storage */ }
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  for (const l of nav.languages || [nav.language || '']) {
    const k = String(l).slice(0, 2).toLowerCase();
    if (DICT[k]) return k;
  }
  return 'en';
}

let lang = detect();
export const getLang = () => lang;

// {key:acción} → la tecla elegida para esa acción (la pone keys.js, así cambia si el jugador las cambia)
let keyTok = null;
export const setKeyTokens = (fn) => { keyTok = fn; };

export function t(key, vars) {
  let s = DICT[lang][key] ?? DICT.es[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  if (keyTok) s = s.replace(/\{key:(\w+)\}/g, (m, a) => keyTok(a));
  return s;
}

// el nombre por defecto ("Vos", "You"…) en cualquier idioma: al cambiar de idioma se traduce también
export const isDefaultName = (n) => n === 'Vos' || Object.values(DICT).some((d) => d.you === n); // 'Vos' = el de antes

export function translate(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  if (root === document) document.documentElement.lang = lang;
}

const subs = new Set();
export const onLang = (fn) => subs.add(fn);

export function setLang(l) {
  if (!DICT[l] || l === lang) return;
  lang = l;
  try { localStorage.setItem(STORE, l); } catch { /* sin storage */ }
  refreshTexts();
}

// vuelve a escribir todos los textos (cambio de idioma o de teclas)
export function refreshTexts() {
  translate();
  for (const fn of subs) fn(lang);
}
