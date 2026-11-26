// Las páginas del panel. Cada una pide sus datos (con los filtros de arriba) y devuelve lo que se dibuja.
import {
  el, fmt, fmt1, pct, ms, dur, ago, dayLabel, shortId, country, gpuName, osName, deviceName,
  card, empty, tile, table, tableView, pager, columns, hbars, legend, facts, badge,
} from './ui.js';

const modeName = { ffa: 'Todos contra todos', teams: 'Equipos' };
const endName = { leave: 'cerró la pestaña', lobby: 'volvió al menú', new: 'empezó otra', lost: 'se cortó', arena: 'cambió de arena' };
const who = (name, id) => el('span', { class: 'who2' }, el('b', {}, name || 'Blob'), el('small', {}, ` #${shortId(id)}`));
const place = (cc, city) => el('span', {}, country(cc), city ? el('small', {}, ` · ${city}`) : null);
const browserName = (b, v) => (b ? `${b}${v ? ' ' + v : ''}` : '—');
const perMin = (v, minutes) => (minutes > 0.5 && v != null ? fmt1(v / minutes) : '—');
const kpiRow = (...t) => el('div', { class: 'kpis' }, t);

// ================================================================ resumen
async function overview({ api, filters, go }) {
  const D = await api('overview', filters);
  const c = D.kpis.cur, p = D.kpis.prev;
  const T = (label, key, f2 = fmt, o = {}) => tile(label, f2(c[key]), { cur: c[key], prev: p[key], ...o });
  const kpis = kpiRow(
    T('Visitantes únicos', 'visitors', fmt, { hint: 'Navegadores distintos que entraron (cada navegador tiene un id al azar).' }),
    T('Visitas', 'visits', fmt, { hint: 'Cada vez que alguien abrió el juego. Un visitante puede tener muchas.' }),
    T('Nuevos', 'new_visitors', fmt, { hint: 'Entraron por primera vez en este período.' }),
    T('Volvieron', 'returning', fmt, { hint: 'Ya habían entrado antes de este período.' }),
    T('IPs distintas', 'ips', fmt, { hint: 'Conexiones distintas. Varios navegadores de una misma casa comparten IP.' }),
    T('Partidas', 'matches'),
    T('Tiempo jugado', 'play_s', dur),
    T('Visita promedio', 'avg_session_s', dur),
    T('fps promedio', 'fps', (v) => (v == null ? '—' : fmt(v))),
    T('Ping promedio', 'rtt', (v) => (v == null ? '—' : ms(v)), { up: false, hint: 'Ida y vuelta al servidor de las salas, en las visitas que jugaron en línea.' }),
  );

  const daily = D.daily, labels = daily.map((d) => dayLabel(d.day)), every = Math.ceil(daily.length / 12);
  const visHost = el('div'), mHost = el('div'), hHost = el('div');
  const visCard = card('Visitantes por día', 'Navegadores distintos que entraron cada día: nuevos y los que vuelven.', 'c8',
    legend([{ name: 'Nuevos', color: 'var(--series-1)' }, { name: 'Vuelven', color: 'var(--series-2)' }]), visHost,
    tableView([{ h: 'Día', v: (d) => d.day }, { h: 'Nuevos', num: true, v: (d) => fmt(d.new) }, { h: 'Vuelven', num: true, v: (d) => fmt(d.returning) }, { h: 'Visitantes', num: true, v: (d) => fmt(d.visitors) }, { h: 'Visitas', num: true, v: (d) => fmt(d.visits) }], [...daily].reverse()));

  const R = D.retention;
  const retCard = card('¿Vuelven?', 'De los que entraron por primera vez, cuántos volvieron otro día (sólo cuentan los que ya tuvieron tiempo).', 'c4',
    el('div', { class: 'hero' }, [['Al día siguiente', R.d1], ['En la semana', R.d7], ['En el mes', R.d30]].map(([l, r]) =>
      el('div', {}, el('div', { class: 'v' }, pct(r.rate)), el('div', { class: 'l' }, l), el('div', { class: 's' }, r.base ? `de ${fmt(r.base)} jugadores` : 'todavía no hay base')))),
    tableView([{ h: 'Llegaron el', v: (r) => r.cohort }, { h: 'Jugadores', num: true, v: (r) => fmt(r.n) }, { h: 'Día sig.', num: true, v: (r) => (r.age >= 1 ? pct(r.d1 / r.n) : '—') },
      { h: 'Semana', num: true, v: (r) => (r.age >= 7 ? pct(r.d7 / r.n) : '—') }, { h: 'Mes', num: true, v: (r) => (r.age >= 30 ? pct(r.d30 / r.n) : '—') }], R.cohorts.slice(-30).reverse()));

  const mCard = card('Partidas por día', 'Cada vez que alguien entra a jugar (el tutorial no cuenta).', 'c6', mHost,
    tableView([{ h: 'Día', v: (d) => d.day }, { h: 'Partidas', num: true, v: (d) => fmt(d.matches) }, { h: 'Minutos jugados', num: true, v: (d) => fmt(d.minutes) }], [...daily].reverse()));
  const hCard = card('¿A qué hora juegan?', `Partidas según la hora en que empezaron (${D.tz}).`, 'c6', hHost);

  const F = D.funnel, f0 = Math.max(1, F.visited);
  const seq = ['var(--seq-5)', 'var(--seq-4)', 'var(--seq-3)', 'var(--seq-2)', 'var(--seq-1)'];
  const funnel = card('Embudo', 'De todos los que entraron, cuántos llegaron a cada paso.', 'c6',
    hbars([{ k: 'Entraron', v: F.visited }, { k: 'Jugaron una partida', v: F.played }, { k: 'Jugaron 2+ min', v: F.played2 }, { k: 'Jugaron 10+ min', v: F.played10 }, { k: 'Volvieron otro día', v: F.returned }]
      .map((x, i) => ({ ...x, color: seq[i] })), { max: f0, subFmt: (x) => pct(x.v / f0) }));

  const Tt = D.tutorial;
  const steps = Object.entries(Tt.steps).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10)).map(([k, v]) => ({ k: `Paso ${k}`, v }));
  const t0 = Math.max(1, Tt.offered, Tt.start);
  const tut = card('Tutorial', `Se ofreció a ${fmt(Tt.offered)} · lo rechazaron ${fmt(Tt.declined)} · lo dejaron a mitad ${fmt(Tt.skip)}`, 'c6',
    Tt.start ? hbars([{ k: 'Lo empezaron', v: Tt.start }, ...steps, { k: 'Lo terminaron', v: Tt.done }], { max: t0, subFmt: (x) => pct(x.v / Math.max(1, Tt.start)) }) : empty());

  const modes = card('Modos de juego', 'Partidas, duración y puntaje promedio por modo.', 'c6',
    hbars(D.modes.map((m) => ({ k: modeName[m.mode] || m.mode, v: m.matches, m })), { subFmt: (x) => `${dur(x.m.avg_s)} · ${fmt(x.m.avg_score)} pts` }),
    ...D.modes.filter((m) => m.mode === 'teams' && m.won + m.lost > 0).map((m) => el('p', { class: 'sub', style: 'margin-top:10px' }, `En equipos, el equipo del jugador ganó ${pct(m.won / (m.won + m.lost))} de las rondas (${fmt(m.won)} de ${fmt(m.won + m.lost)}).`)));

  const recs = card('Mejores partidas del período', 'Haz clic en una fila para ver al jugador.', 'c6',
    table([{ h: '#', v: (r) => String(r.i) }, { h: 'Jugador', v: (r) => who(r.name, r.pid) }, { h: 'Modo', v: (r) => modeName[r.mode] || r.mode }, { h: 'Puntos', num: true, v: (r) => fmt(r.score) }, { h: 'KO', num: true, v: (r) => fmt(r.kos) }, { h: 'Cuándo', v: (r) => r.at }],
      D.records.map((r, i) => ({ ...r, i: i + 1 })), { onRow: (r) => go('jugador', r.pid) }));

  return {
    nodes: [kpis, visCard, retCard, mCard, hCard, funnel, tut, modes, recs],
    after() {
      columns(visHost, { labels, every, tipTitle: (i) => `${daily[i].day} · ${fmt(daily[i].visits)} visitas`, series: [
        { name: 'Nuevos', color: 'var(--series-1)', values: daily.map((d) => d.new) },
        { name: 'Vuelven', color: 'var(--series-2)', values: daily.map((d) => d.returning) },
      ] });
      columns(mHost, { labels, every, tipTitle: (i) => `${daily[i].day} · ${fmt(daily[i].minutes)} min jugados`, series: [{ name: 'partidas', color: 'var(--series-1)', values: daily.map((d) => d.matches) }] });
      columns(hHost, { labels: D.hours.map((_, h) => String(h)), every: 2, tipTitle: (i) => `${i}:00 a ${i}:59`, series: [{ name: 'partidas', color: 'var(--series-1)', values: D.hours }] });
    },
  };
}

// ================================================================ jugadores
const SORT_OPTS = [['last', 'Última visita'], ['first', 'Primera visita'], ['visits', 'Más visitas'], ['play', 'Más tiempo jugado'], ['matches', 'Más partidas'],
  ['best', 'Mejor puntaje'], ['fps', 'Peores fps'], ['rtt', 'Más ping'], ['ghost', 'Más golpes fantasma']];

async function playersPage({ api, filters, params, go, setParams }) {
  const q = params.get('q') || '', sort = params.get('sort') || 'last', page = +params.get('page') || 0;
  const D = await api('players', { ...filters, q, sort, page });
  const search = el('input', { type: 'search', placeholder: 'Buscar por nombre o id…', value: q, 'aria-label': 'Buscar jugador',
    onkeydown: (e) => { if (e.key === 'Enter') setParams({ q: e.target.value.trim() || null, page: null }); },
    onsearch: (e) => { if (!e.target.value) setParams({ q: null, page: null }); } });
  const sortSel = el('label', { class: 'fsel' }, el('span', {}, 'Ordenar por'),
    el('select', { onchange: (e) => setParams({ sort: e.target.value === 'last' ? null : e.target.value, page: null }) }, SORT_OPTS.map(([v, t]) => el('option', { value: v, selected: v === sort }, t))));
  const cols = [
    { h: 'Jugador', v: (r) => who(r.name, r.id) },
    { h: 'País', v: (r) => place(r.country, r.city) },
    { h: 'Primera vez', v: (r) => r.first_seen },
    { h: 'Última vez', v: (r) => r.last_seen },
    { h: 'Visitas', num: true, v: (r) => fmt(r.visits) },
    { h: 'Partidas', num: true, v: (r) => fmt(r.matches) },
    { h: 'Jugó', num: true, v: (r) => dur(r.play_s) },
    { h: 'Mejor', num: true, v: (r) => (r.best == null ? '—' : fmt(r.best)) },
    { h: 'KO', num: true, v: (r) => fmt(r.kos) },
    { h: 'fps', num: true, v: (r) => fmt(r.fps) },
    { h: 'Ping', num: true, v: (r) => ms(r.rtt) },
    { h: 'Sistema · navegador', v: (r) => `${osName(r.os, r.os_ver)} · ${browserName(r.browser, r.browser_ver)}` },
    { h: 'Placa', v: (r) => el('span', { class: 'gpu', title: gpuName(r.gpu) }, r.gpu_vendor || '—') },
  ];
  return [card('Jugadores', 'Cada navegador cuenta como un jugador. Haz clic en uno para ver todo lo que se sabe de él.', '',
    el('div', { class: 'toolbar' }, search, sortSel),
    table(cols, D.list, { onRow: (r) => go('jugador', r.id) }),
    pager(D.total, D.page, D.pageSize, (pg) => setParams({ page: pg || null })))];
}

// ================================================================ un jugador
async function playerPage({ api, arg, go, href }) {
  if (!arg) { go('jugadores'); return []; }
  const D = await api('player', { id: arg });
  const P = D.player, T = D.totals, S = D.sessions;
  const back = el('a', { href: href('jugadores'), class: 'back' }, '← Jugadores');
  const head = el('section', { class: 'card phead' },
    back,
    el('div', { class: 'ptitle' }, el('h1', {}, P.name || 'Blob'), badge(country(P.country)), badge(`visto ${ago(P.ago_s)}`, P.ago_s < 120 ? 'live' : '')),
    facts([
      ['Id', el('code', {}, P.id)], ['Primera visita', P.first_seen], ['Última visita', P.last_seen], ['Idioma', P.lang],
      ['Visitas', fmt(T.visits)], ['Tiempo en línea', T.net_min ? `${fmt1(T.net_min)} min` : null],
    ]));
  const kpis = kpiRow(
    tile('Partidas', fmt(T.matches)), tile('Tiempo jugado', dur(T.play_s)), tile('Mejor puntaje', fmt(T.best)),
    tile('KOs', fmt(T.kos)), tile('Caídas', fmt(T.falls)), tile('fps promedio', T.fps == null ? '—' : fmt(T.fps)),
    tile('Ping promedio', ms(T.rtt)), tile('Golpes fantasma por min', T.ghost_min == null ? '—' : fmt1(T.ghost_min), { hint: 'Golpes que su pantalla mostró y el servidor no contó.' }),
    tile('Golpes vistos a tiempo', pct(T.seen), { hint: 'Los que su pantalla mostró antes de que confirmara el servidor.' }),
    tile('Le pegaron y lo vio venir', pct(T.me_seen)),
  );

  // por visita, de la más vieja a la más nueva (las últimas 40)
  const chron = [...S].reverse().slice(-40);
  const fpsHost = el('div'), rttHost = el('div');
  const withFps = chron.filter((s) => s.fps_avg != null), withRtt = chron.filter((s) => s.rtt_avg != null);
  const fpsCard = card('fps por visita', 'Promedio de cada visita (las últimas 40).', 'c6', withFps.length ? fpsHost : empty('No hay datos de rendimiento.'));
  const rttCard = card('Ping por visita', 'Promedio de cada visita en línea (las últimas 40).', 'c6', withRtt.length ? rttHost : empty('No jugó en línea.'));

  // equipos usados (combinaciones distintas)
  const devMap = new Map();
  for (const s of S) {
    const k = [s.os, s.os_ver, s.browser, s.browser_ver, s.gpu, s.screen, s.device].join('|');
    const d = devMap.get(k) || { ...s, visits: 0 };
    d.visits++; if (!devMap.has(k)) devMap.set(k, d);
  }
  const devices = card('Equipos que usó', null, '',
    table([
      { h: 'Dispositivo', v: (d) => deviceName(d.device) }, { h: 'Sistema', v: (d) => osName(d.os, d.os_ver) }, { h: 'Navegador', v: (d) => browserName(d.browser, d.browser_ver) },
      { h: 'Placa', v: (d) => gpuName(d.gpu) }, { h: 'Pantalla', v: (d) => d.screen || '—' }, { h: 'Monitor', num: true, v: (d) => (d.hz ? `${fmt(d.hz)} Hz` : '—') },
      { h: 'Núcleos', num: true, v: (d) => fmt(d.cores) }, { h: 'Memoria', num: true, v: (d) => (d.ram ? `${fmt1(d.ram)} GB` : '—') }, { h: 'Visitas', num: true, v: (d) => fmt(d.visits) }, { h: 'Última', v: (d) => d.at },
    ], [...devMap.values()]));

  const ips = card('IPs', 'Se guardan unos días y después se borran solas.', 'c6',
    table([{ h: 'IP', v: (r) => el('code', {}, r.ip) }, { h: 'Lugar', v: (r) => place(r.country, [r.city, r.region].filter(Boolean).join(', ')) }, { h: 'Visitas', num: true, v: (r) => fmt(r.visits) }, { h: 'Última', v: (r) => r.last }], D.ips));
  const related = card('Otros jugadores desde las mismas IPs', 'Otro navegador de la misma persona, o alguien de la misma casa o red.', 'c6',
    D.related.length ? table([{ h: 'Jugador', v: (r) => who(r.name, r.id) }, { h: 'IPs en común', num: true, v: (r) => fmt(r.shared) }, { h: 'Última', v: (r) => r.last }], D.related, { onRow: (r) => go('jugador', r.id) }) : empty('Ninguno.'));

  const visits = card('Visitas', null, '',
    table([
      { h: 'Inicio', v: (s) => s.at }, { h: 'Duración', num: true, v: (s) => dur(s.dur_s) },
      { h: 'Lugar', v: (s) => place(s.country, s.city) }, { h: 'IP', v: (s) => (s.ip ? el('code', {}, s.ip) : '—') },
      { h: 'Sistema', v: (s) => osName(s.os, s.os_ver) }, { h: 'Navegador', v: (s) => browserName(s.browser, s.browser_ver) },
      { h: 'Ventana', v: (s) => s.win || '—' }, { h: 'Monitor', num: true, v: (s) => (s.hz ? `${fmt(s.hz)} Hz` : '—') },
      { h: 'fps', num: true, v: (s) => fmt(s.fps_avg) }, { h: 'Cálculo · placa', num: true, title: 'Milisegundos por frame: lo que tarda el juego y lo que tarda la placa de video.', v: (s) => (s.cpu_ms == null ? '—' : `${fmt1(s.cpu_ms)} · ${fmt1(s.gpu_ms)} ms`) },
      { h: 'Ping', num: true, v: (s) => ms(s.rtt_avg) }, { h: 'Fantasma/min', num: true, v: (s) => perMin(s.ghost, s.net_s / 60) },
      { h: 'Partidas', num: true, v: (s) => fmt(s.matches) }, { h: 'Versión', v: (s) => s.ver || '—' },
      { h: '', v: (s) => [s.is_new ? badge('primera') : null, s.is_bot ? badge('robot', 'warn') : null] },
    ], S));

  const matches = card('Partidas', null, '',
    table([
      { h: 'Inicio', v: (m) => m.at }, { h: 'Modo', v: (m) => modeName[m.mode] || m.mode }, { h: 'Duración', num: true, v: (m) => dur(m.duration_s) },
      { h: 'Puntos', num: true, v: (m) => fmt(m.score) }, { h: 'KO', num: true, v: (m) => fmt(m.kos) }, { h: 'Caídas', num: true, v: (m) => fmt(m.falls) },
      { h: 'Masa máx.', num: true, v: (m) => (m.max_mass == null ? '—' : `x${fmt1(m.max_mass)}`) },
      { h: 'Rondas', num: true, v: (m) => (m.mode === 'teams' && m.rounds_won != null ? `${m.rounds_won}–${m.rounds_lost}` : '—') },
      { h: 'Terminó', v: (m) => endName[m.end_reason] || m.end_reason || 'jugando' },
    ], D.matches));

  return {
    nodes: [head, kpis, fpsCard, rttCard, devices, ips, related, visits, matches],
    after() {
      const lab = (s) => s.at.slice(5);
      if (withFps.length) columns(fpsHost, { labels: withFps.map(lab), every: Math.ceil(withFps.length / 8), height: 170, tipTitle: (i) => withFps[i].at, series: [{ name: 'fps', color: 'var(--series-1)', values: withFps.map((s) => s.fps_avg) }] });
      if (withRtt.length) columns(rttHost, { labels: withRtt.map(lab), every: Math.ceil(withRtt.length / 8), height: 170, tipTitle: (i) => withRtt[i].at, valueFmt: ms, series: [{ name: 'ping', color: 'var(--series-1)', values: withRtt.map((s) => s.rtt_avg) }] });
    },
  };
}

// ================================================================ visitas
async function sessionsPage({ api, filters, params, go, setParams }) {
  const q = params.get('q') || '', page = +params.get('page') || 0;
  const D = await api('sessions', { ...filters, q, page });
  const search = el('input', { type: 'search', placeholder: 'Buscar por nombre, IP o ciudad…', value: q, 'aria-label': 'Buscar visita',
    onkeydown: (e) => { if (e.key === 'Enter') setParams({ q: e.target.value.trim() || null, page: null }); },
    onsearch: (e) => { if (!e.target.value) setParams({ q: null, page: null }); } });
  const cols = [
    { h: 'Inicio', v: (s) => s.at }, { h: 'Jugador', v: (s) => who(s.name, s.pid) }, { h: 'Duración', num: true, v: (s) => dur(s.dur_s) },
    { h: 'Lugar', v: (s) => place(s.country, s.city) }, { h: 'IP', v: (s) => (s.ip ? el('code', {}, s.ip) : '—') },
    { h: 'Sistema', v: (s) => osName(s.os, s.os_ver) }, { h: 'Navegador', v: (s) => browserName(s.browser, s.browser_ver) },
    { h: 'Placa', v: (s) => el('span', { class: 'gpu', title: gpuName(s.gpu) }, s.gpu_vendor || '—') }, { h: 'Pantalla', v: (s) => s.screen || '—' },
    { h: 'Monitor', num: true, v: (s) => (s.hz ? `${fmt(s.hz)} Hz` : '—') }, { h: 'fps', num: true, v: (s) => fmt(s.fps_avg) },
    { h: 'Ping', num: true, v: (s) => ms(s.rtt_avg) }, { h: 'Partidas', num: true, v: (s) => fmt(s.matches) },
    { h: '', v: (s) => [s.is_new ? badge('primera') : null, s.is_bot ? badge('robot', 'warn') : null] },
  ];
  return [card('Visitas', 'Cada vez que alguien abrió el juego, de la más nueva a la más vieja. Haz clic para ver al jugador.', '',
    el('div', { class: 'toolbar' }, search),
    table(cols, D.list, { onRow: (s) => go('jugador', s.pid) }),
    pager(D.total, D.page, D.pageSize, (pg) => setParams({ page: pg || null })))];
}

// ================================================================ rendimiento
const SEGS = [
  ['os', 'Por sistema'], ['browser', 'Por navegador'], ['gpu_vendor', 'Por marca de placa', 'gpu'], ['gpu', 'Por placa de video'],
  ['country', 'Por país', 'country'], ['hz', 'Por monitor'], ['screen', 'Por pantalla'], ['cores', 'Por núcleos'], ['ram', 'Por memoria'], ['device', 'Por dispositivo', 'device'],
];
async function perfPage({ api, filters, setParams }) {
  const D = await api('perf', filters);
  const K = D.kpis;
  const kpis = kpiRow(
    tile('Visitas con datos', fmt(K.n)), tile('Jugadores', fmt(K.players)), tile('fps promedio', K.fps == null ? '—' : fmt(K.fps)),
    tile('Visitas fluidas', pct(K.fluid), { hint: 'Visitas con 55 fps o más en promedio.' }),
    tile('Llegan a lo que pide su monitor', pct(K.reach), { hint: 'fps logrados sobre los fps que buscaba el juego en ese monitor (100 % = siempre).' }),
    tile('Cálculo por frame', K.cpu == null ? '—' : `${fmt1(K.cpu)} ms`, { hint: 'Lo que tarda el juego en calcular cada frame (física, blobs, efectos y dibujo).' }),
    tile('Placa por frame', K.gpu == null ? '—' : `${fmt1(K.gpu)} ms`, { hint: 'Lo que tarda la placa de video en dibujar cada frame.' }),
  );
  const status = { '58+': ['var(--good)', '✅', 'Fluido'], '45–58': ['var(--warning)', '🟡', 'Aceptable'], '30–45': ['var(--serious)', '🟠', 'Justo'], '<30': ['var(--critical)', '🔴', 'Malo'] };
  const buckets = card('¿Qué tan fluido anda?', 'Visitas según los fps promedio que tuvieron.', 'c6',
    hbars(D.buckets.map((b) => ({ k: `${status[b.b][1]} ${status[b.b][2]} (${b.b} fps)`, v: b.v, color: status[b.b][0] }))));
  const segCols = [
    { h: 'Segmento', v: (r) => r.label }, { h: 'Visitas', num: true, v: (r) => fmt(r.n) }, { h: 'Jugadores', num: true, v: (r) => fmt(r.players) },
    { h: 'fps', num: true, v: (r) => fmt(r.fps) }, { h: 'Fluidas', num: true, v: (r) => pct(r.fluid) }, { h: 'Llegan al monitor', num: true, v: (r) => pct(r.reach) },
    { h: 'Cálculo', num: true, v: (r) => (r.cpu == null ? '—' : `${fmt1(r.cpu)} ms`) }, { h: 'Placa', num: true, v: (r) => (r.gpu == null ? '—' : `${fmt1(r.gpu)} ms`) },
  ];
  const label = (key, k) => (key === 'country' ? country(k) : key === 'device' ? deviceName(k) : key === 'gpu' ? gpuName(k) : k);
  const segCards = SEGS.map(([key, title, filterKey]) => {
    const list = (D.seg[key] || []).map((r) => ({ ...r, label: label(key, r.k) }));
    return card(title, 'La barra es la parte de visitas fluidas (55 fps o más).', key === 'gpu' ? '' : 'c6',
      hbars(list.map((r) => ({ k: r.label, v: r.fluid ?? 0, r, title: typeof r.label === 'string' ? r.label : null })), {
        max: 1, valueFmt: pct, subFmt: (x) => `${fmt(x.r.fps)} fps · ${fmt(x.r.n)} visitas`,
        onPick: filterKey ? (x) => setParams({ [filterKey]: x.r.k, page: null }) : null,
      }),
      list.length ? tableView(segCols, list) : null);
  });
  return [kpis, buckets, ...segCards];
}

// ================================================================ red en línea
async function netPage({ api, filters, go, setParams }) {
  const D = await api('net', filters);
  const K = D.kpis;
  const kpis = kpiRow(
    tile('Minutos en línea', fmt(K.minutes)), tile('Jugadores', fmt(K.players)), tile('Ping promedio', ms(K.rtt)),
    tile('Golpes vistos a tiempo', pct(K.seen), { hint: 'Los que la pantalla mostró antes de que confirmara el servidor.' }),
    tile('Les pegaron y lo vieron venir', pct(K.me_seen)),
    tile('Golpes fantasma por min', K.ghost_min == null ? '—' : fmt1(K.ghost_min), { hint: 'Golpes que la pantalla mostró y el servidor no contó.' }),
    tile('Correcciones visibles de su blob por min', K.me_vis_min == null ? '—' : fmt1(K.me_vis_min), { hint: 'Veces por minuto que su propio blob se corrigió más de medio metro.' }),
    tile('De los demás blobs por min', K.ot_vis_min == null ? '—' : fmt1(K.ot_vis_min), { hint: 'Lo mismo, sumando todos los otros blobs de la sala.' }),
  );
  const netCols = (first) => [
    { h: first, v: (r) => r.label }, { h: 'Visitas', num: true, v: (r) => fmt(r.n) }, { h: 'Minutos', num: true, v: (r) => fmt(r.minutes) }, { h: 'Ping', num: true, v: (r) => ms(r.rtt) },
    { h: 'Golpes vistos', num: true, v: (r) => pct(r.seen) }, { h: 'Les pegaron (vistos)', num: true, v: (r) => pct(r.me_seen) },
    { h: 'Fantasma/min', num: true, v: (r) => fmt1(r.ghost_min) }, { h: 'Su blob/min', num: true, v: (r) => fmt1(r.me_vis_min) }, { h: 'Los demás/min', num: true, v: (r) => fmt1(r.ot_vis_min) },
  ];
  const byPing = D.byPing.map((r) => ({ ...r, label: r.k }));
  const pingCard = card('Según el ping', 'La barra es la parte de golpes que se vieron antes de que confirmara el servidor.', 'c6',
    hbars(byPing.map((r) => ({ k: r.label, v: r.seen ?? 0, r })), { max: 1, valueFmt: pct, subFmt: (x) => `${fmt1(x.r.ghost_min)} fantasma/min · ${fmt(x.r.n)} visitas` }),
    byPing.length ? tableView(netCols('Ping'), byPing) : null);
  const byCountry = D.byCountry.map((r) => ({ ...r, label: country(r.k) }));
  const countryCard = card('Ping por país', 'Ida y vuelta al servidor de las salas (Alemania). Haz clic en un país para filtrar.', 'c6',
    hbars(byCountry.map((r) => ({ k: r.label, v: r.rtt ?? 0, r })), { valueFmt: ms, subFmt: (x) => `${fmt(x.r.n)} visitas`, onPick: (x) => setParams({ country: x.r.k === '—' ? null : x.r.k }) }),
    byCountry.length ? tableView(netCols('País'), byCountry) : null);
  const list = card('Últimas visitas en línea', 'Haz clic para ver al jugador.', '',
    table([
      { h: 'Cuándo', v: (r) => r.at }, { h: 'Jugador', v: (r) => who(r.name, r.pid) }, { h: 'Lugar', v: (r) => place(r.country, r.city) },
      { h: 'Min', num: true, v: (r) => fmt1(r.net_s / 60) }, { h: 'Ping', num: true, v: (r) => ms(r.rtt_avg) },
      { h: 'Golpes vistos', num: true, v: (r) => (r.hits ? pct(r.seen / r.hits) : '—') },
      { h: 'Le pegaron: vistos', num: true, v: (r) => (r.me_hit ? `${pct(1 - r.me_late / r.me_hit)} de ${fmt(r.me_hit)}` : '—') },
      { h: 'Fantasma/min', num: true, v: (r) => perMin(r.ghost, r.net_s / 60) }, { h: 'Su blob/min', num: true, v: (r) => perMin(r.me_vis, r.net_s / 60) },
      { h: 'Los demás/min', num: true, v: (r) => perMin(r.ot_vis, r.net_s / 60) }, { h: 'fps', num: true, v: (r) => fmt(r.fps_avg) },
    ], D.list, { onRow: (r) => go('jugador', r.pid) }));
  return [kpis, pingCard, countryCard, list];
}

// ================================================================ audiencia
let langNames = null;
try { langNames = new Intl.DisplayNames(['es'], { type: 'language' }); } catch { /* viejo */ }
const langName = (l) => { try { return langNames?.of(l) || l; } catch { return l; } };
const AUD = [
  ['country', 'Países', 'country', (k) => country(k)], ['city', 'Ciudades', null, (k) => k], ['lang', 'Idioma del juego', null, langName], ['tz', 'Zona horaria', null, (k) => k],
  ['browser', 'Navegadores', null, (k) => k], ['os', 'Sistemas', null, (k) => k], ['device', 'Dispositivos', 'device', deviceName], ['gpu_vendor', 'Marca de placa', 'gpu', (k) => k],
  ['screen', 'Pantallas', null, (k) => k], ['referrer', 'De dónde llegan', null, (k) => k], ['utm', 'Campañas (utm)', null, (k) => k],
  ['ver', 'Versión del juego', 'ver', (k) => (k === 'dev' ? 'desarrollo' : k)], ['conn', 'Conexión que informa el navegador', null, (k) => k],
];
async function audiencePage({ api, filters, setParams }) {
  const D = await api('audience', filters);
  return AUD.map(([key, title, filterKey, name]) => {
    const list = D[key] || [];
    const sub = key === 'city' && !list.length ? 'Para ver ciudades hay que activar en Cloudflare: Reglas → Transform Rules → Managed Transforms → "Add visitor location headers".' : null;
    return card(title, sub, 'c4', list.length ? hbars(list.map((r) => ({ k: name(r.k), v: r.v, r })), {
      subFmt: (x) => `${fmt(x.r.visits)} visitas`, onPick: filterKey ? (x) => setParams({ [filterKey]: x.r.k, page: null }) : null,
    }) : empty('Sin datos todavía.'));
  });
}

// ================================================================ salas en vivo (no necesitan la base)
function gameURL(roomId) { return (import.meta.env?.DEV ? '/' : '/juego') + '?room=' + encodeURIComponent(roomId); }
const since = (t) => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`; };
async function roomsPage() {
  const body = el('div', {}, el('div', { class: 'empty' }, 'Cargando…'));
  const load = async () => {
    try {
      const r = await fetch('/api/admin/rooms', { cache: 'no-store' });
      if (r.status === 403) { body.replaceChildren(empty('Sin permiso.')); return; }
      const { rooms } = await r.json();
      if (!rooms.length) { body.replaceChildren(empty('No hay salas abiertas. Se abre una cuando alguien entra a jugar.')); return; }
      rooms.sort((a, b) => b.humans - a.humans);
      body.replaceChildren(el('div', { class: 'rooms' }, rooms.map((rm) => {
        const full = rm.humans >= rm.capacity, ts = rm.team;
        const bar = el('div', { class: 'rbar', title: `${rm.humans} personas · ${rm.bots} bots` },
          el('i', { style: `width:${(rm.humans / rm.capacity) * 100}%;background:var(--series-1)` }),
          el('i', { style: `width:${(rm.bots / rm.capacity) * 100}%;background:var(--series-2);margin-left:2px` }));
        const btn = el('button', { type: 'button', disabled: full, onclick: () => window.open(gameURL(rm.id), '_blank') }, full ? 'Sala llena' : '🎮 Entrar a jugar');
        return el('div', { class: 'room' },
          el('div', { class: 'rtop' }, el('b', {}, `Sala ${rm.id}`), el('span', { class: 'pill' }, modeName[rm.mode] || rm.mode)),
          el('div', { class: 'meta' }, `${rm.humans} personas · ${rm.bots} bots · ${rm.alive} vivos · abierta ${since(rm.created)}`,
            ts ? ` · ronda ${ts.round} (${ts.wins[0]}–${ts.wins[1]})` : '',
            rm.botLeadMs != null ? el('span', { title: 'Los bots deciden con esta anticipación para que cada navegador reciba sus movimientos antes de que pasen (se ajusta al jugador con más retraso).' }, ` · bots anticipan ${rm.botLeadMs} ms`) : ''),
          bar,
          rm.players.length ? el('ul', {}, rm.players.map((p) => el('li', {}, p.name, el('span', {}, ` · ${fmt(p.score)} pts · ${p.kos} KO${p.team != null ? (p.team ? ' · Rojo' : ' · Azul') : ''}${p.lagMs != null ? ` · retraso ~${p.lagMs} ms` : ''}`)))) : el('div', { class: 'empty' }, 'Sólo bots (nadie jugando).'),
          btn);
      })));
    } catch {
      body.replaceChildren(empty('No se pudo leer el estado de las salas.'));
    }
  };
  await load();
  const iv = setInterval(load, 2000);
  return { nodes: [card('Salas en tiempo real', 'Se actualiza cada 2 segundos. Al entrar a jugar ocupas el lugar de un bot (sólo si la sala tiene lugar).', '', body)], cleanup: () => clearInterval(iv) };
}

export const PAGES = {
  resumen: { title: 'Resumen', render: overview },
  jugadores: { title: 'Jugadores', render: playersPage },
  jugador: { title: 'Jugador', tab: 'jugadores', noFilters: true, render: playerPage },
  sesiones: { title: 'Visitas', render: sessionsPage },
  rendimiento: { title: 'Rendimiento', render: perfPage },
  red: { title: 'Red en línea', render: netPage },
  audiencia: { title: 'Audiencia', render: audiencePage },
  salas: { title: 'Salas en vivo', noFilters: true, render: roomsPage },
};
