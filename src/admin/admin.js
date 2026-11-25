// Panel de analíticas (admin.html). Lee /api/admin/stats y dibuja todo con SVG/HTML propio (sin librerías).
// Los textos que vienen de la base (nombres, GPUs, referencias, países) se insertan siempre como texto, nunca como HTML.

const $ = (s) => document.querySelector(s);
const app = $('#app'), tip = $('#tip');
let days = 30, data = null;

if (import.meta.env?.DEV) $('#play').href = '/';

// ---------------------------------------------------------------- utilidades
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const nf = new Intl.NumberFormat('es-AR');
const fmt = (v) => nf.format(Math.round(v));
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)} %`);
function dur(s) {
  s = Math.round(s || 0);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}
const dayLabel = (d) => { const [, m, dd] = d.split('-'); return `${+dd}/${+m}`; };
const card = (title, sub, cls = '', ...body) => el('section', { class: `card ${cls}` }, el('h2', {}, title), sub ? el('p', { class: 'sub' }, sub) : null, ...body);
const empty = (txt = 'Todavía no hay datos.') => el('div', { class: 'empty' }, txt);

// tooltip (valor primero, nombre después; clave = rayita del color)
function showTip(e, title, rowsArr) {
  tip.replaceChildren(el('div', { class: 't' }, title), ...rowsArr.map((r) => el('div', { class: 'r' }, r.color ? el('i', { style: `background:${r.color}` }) : null, el('b', {}, r.value), el('span', {}, r.name))));
  tip.style.display = 'block';
  const b = e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : null;
  const x = e.clientX ?? (b ? b.left + b.width / 2 : 0), y = e.clientY ?? (b ? b.top : 0);
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, x + 14))}px`;
  tip.style.top = `${Math.max(8, y - h - 12)}px`;
}
const hideTip = () => { tip.style.display = 'none'; };

// ---------------------------------------------------------------- columnas (simples o apiladas)
// series: [{ name, color (var css), values }] · labels: texto del eje x · tipTitle(i)
function columns(host, { labels, series, tipTitle = (i) => labels[i], every = 1, height = 200, valueFmt = fmt }) {
  const draw = () => {
    const W = Math.max(280, host.clientWidth), H = height, padL = 34, padB = 22, padT = 8;
    const n = labels.length;
    const totals = labels.map((_, i) => series.reduce((s, se) => s + se.values[i], 0));
    const max = Math.max(1, ...totals);
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const y = (v) => padT + (H - padT - padB) * (1 - v / top);
    const cw = (W - padL) / n, bw = Math.max(2, Math.min(36, cw * 0.72));
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.append(svgEl('line', { class: 'grid', x1: padL, x2: W, y1: y(v), y2: y(v) }));
      const tx = svgEl('text', { x: padL - 6, y: y(v) + 3.5, 'text-anchor': 'end' }); tx.textContent = fmt(v); svg.append(tx);
    }
    labels.forEach((lab, i) => {
      const cx = padL + cw * i + cw / 2;
      const g = svgEl('g', { class: 'col', tabindex: 0 });
      let acc = 0;
      const segs = series.map((se) => ({ se, v: se.values[i] })).filter((s) => s.v > 0);
      segs.forEach((s, k) => {
        const y0 = y(acc), y1 = y(acc + s.v);
        const isTop = k === segs.length - 1;
        const gap = k > 0 ? 2 : 0; // 2px entre segmentos apilados
        const hgt = Math.max(0, y0 - y1 - gap);
        const r = isTop ? Math.min(4, hgt, bw / 2) : 0;
        const x0 = cx - bw / 2, yt = y1;
        const d = `M${x0},${yt + hgt + (k > 0 ? 0 : 0)} V${yt + r} Q${x0},${yt} ${x0 + r},${yt} H${x0 + bw - r} Q${x0 + bw},${yt} ${x0 + bw},${yt + r} V${yt + hgt} Z`;
        g.append(svgEl('path', { class: 'bar', d, fill: s.se.color }));
        acc += s.v;
      });
      const hit = svgEl('rect', { class: 'hit', x: padL + cw * i, y: padT, width: cw, height: H - padT - padB });
      g.append(hit);
      const rowsFor = () => [
        ...series.map((se) => ({ color: se.color, value: valueFmt(se.values[i]), name: se.name })),
        ...(series.length > 1 ? [{ value: valueFmt(totals[i]), name: 'total' }] : []),
      ];
      g.addEventListener('pointermove', (e) => showTip(e, tipTitle(i), rowsFor()));
      g.addEventListener('pointerleave', hideTip);
      g.addEventListener('focus', (e) => showTip(e, tipTitle(i), rowsFor()));
      g.addEventListener('blur', hideTip);
      svg.append(g);
      if (i % every === 0) { const tx = svgEl('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }); tx.textContent = lab; svg.append(tx); }
    });
    host.replaceChildren(svg);
  };
  draw();
  new ResizeObserver(() => draw()).observe(host);
}
function niceStep(v) {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9))), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

const legend = (items) => el('div', { class: 'legend' }, items.map((it) => el('span', {}, el('i', { style: `background:${it.color}` }), it.name)));

// barras horizontales: [{ k, v, sub?, color? }]
function hbars(list, { color = 'var(--series-1)', max = null, valueFmt = fmt, subFmt = null } = {}) {
  if (!list.length) return empty();
  const m = max ?? Math.max(1, ...list.map((x) => x.v));
  return el('div', { class: 'hb' }, list.flatMap((x) => [
    el('span', { class: 'k', title: x.k }, x.k),
    el('span', { class: 'track' }, el('i', { style: `width:${(x.v / m) * 100}%;background:${x.color || color}` })),
    el('span', { class: 'n' }, valueFmt(x.v), subFmt ? el('small', {}, subFmt(x)) : null),
  ]));
}

function table(head, rowsArr, numCols = []) {
  if (!rowsArr.length) return empty();
  return el('table', {}, el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: numCols.includes(i) ? 'num' : null }, h)))),
    el('tbody', {}, rowsArr.map((r) => el('tr', {}, r.map((c, i) => el('td', { class: numCols.includes(i) ? 'num' : null }, c))))));
}
const tableView = (head, rowsArr, numCols) => el('details', {}, el('summary', {}, 'Ver como tabla'), table(head, rowsArr, numCols));

// ---------------------------------------------------------------- armar el panel
function kpi(label, cur, prev, f = fmt) {
  let d = 'sin datos del período anterior';
  if (prev > 0) { const ch = (cur - prev) / prev; d = el('span', {}, el('b', {}, `${ch >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(ch * 100))} %`), ` vs. ${days === 1 ? 'ayer' : `los ${days} días anteriores`}`); }
  return el('div', { class: 'kpi' }, el('div', { class: 'l' }, label), el('div', { class: 'v' }, f(cur)), el('div', { class: 'd' }, d));
}

function render() {
  const D = data, c = D.kpis.cur, p = D.kpis.prev;
  $('#who').textContent = D.user || '';
  const perPlayer = (k) => (k.players ? k.matches / k.players : 0);
  const kpis = el('div', { class: 'kpis' },
    kpi('Visitantes', c.visitors, p.visitors),
    kpi('Jugadores nuevos', c.new_players, p.new_players),
    kpi('Partidas', c.matches, p.matches),
    kpi('Tiempo jugado', c.play_s, p.play_s, dur),
    kpi('Sesión promedio', c.avg_session_s, p.avg_session_s, dur),
    kpi('Partidas por jugador', perPlayer(c), perPlayer(p), (v) => v.toFixed(1)),
  );

  const daily = D.daily, labels = daily.map((d) => dayLabel(d.day)), every = Math.ceil(daily.length / 12);
  const visHost = el('div'), mHost = el('div'), hHost = el('div');
  const visCard = card('Visitantes por día', 'Navegadores distintos que entraron cada día: nuevos y que vuelven.', 'c8',
    legend([{ name: 'Nuevos', color: 'var(--series-1)' }, { name: 'Vuelven', color: 'var(--series-2)' }]), visHost,
    tableView(['Día', 'Nuevos', 'Vuelven', 'Total'], daily.map((d) => [d.day, fmt(d.new), fmt(d.returning), fmt(d.visitors)]), [1, 2, 3]));

  const R = D.retention;
  const retCard = card('¿Vuelven?', 'De los que entraron por primera vez, cuántos volvieron otro día (sólo cuentan los que ya tuvieron tiempo).', 'c4',
    el('div', { class: 'hero' },
      ...[['Al día siguiente', R.d1], ['En la semana', R.d7], ['En el mes', R.d30]].map(([l, r]) => el('div', {}, el('div', { class: 'v' }, pct(r.rate)), el('div', { class: 'l' }, l), el('div', { class: 's' }, r.base ? `de ${fmt(r.base)} jugadores` : 'todavía no hay base')))),
    tableView(['Llegaron el', 'Jugadores', 'Día sig.', 'Semana', 'Mes'], R.cohorts.slice(-30).reverse().map((r) => [r.cohort, fmt(r.n), r.age >= 1 ? pct(r.d1 / r.n) : '—', r.age >= 7 ? pct(r.d7 / r.n) : '—', r.age >= 30 ? pct(r.d30 / r.n) : '—']), [1, 2, 3, 4]));

  const mCard = card('Partidas por día', 'Cada vez que alguien entra a jugar una arena (el tutorial no cuenta).', 'c6', mHost,
    tableView(['Día', 'Partidas', 'Minutos jugados'], daily.map((d) => [d.day, fmt(d.matches), fmt(d.minutes)]), [1, 2]));
  const hCard = card('¿A qué hora juegan?', `Partidas según la hora de inicio (${D.tz}).`, 'c6', hHost);

  const F = D.funnel, f0 = Math.max(1, F.visited);
  const seq = ['var(--seq-5)', 'var(--seq-4)', 'var(--seq-3)', 'var(--seq-2)', 'var(--seq-1)'];
  const funnel = card('Embudo', 'De todos los que entraron, cuántos llegaron a cada paso.', 'c6',
    hbars([
      { k: 'Entraron', v: F.visited }, { k: 'Jugaron una partida', v: F.played }, { k: 'Jugaron 2+ min', v: F.played2 },
      { k: 'Jugaron 10+ min', v: F.played10 }, { k: 'Volvieron otro día', v: F.returned },
    ].map((x, i) => ({ ...x, color: seq[i] })), { max: f0, subFmt: (x) => pct(x.v / f0) }));

  const T = D.tutorial;
  const steps = Object.entries(T.steps).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10)).map(([k, v]) => ({ k: `Paso ${k}`, v }));
  const t0 = Math.max(1, T.offered + (T.start > T.offered ? T.start - T.offered : 0), T.start);
  const tut = card('Tutorial', `Se ofreció a ${fmt(T.offered)} · lo rechazaron ${fmt(T.declined)} · lo dejaron a mitad ${fmt(T.skip)}`, 'c6',
    T.start ? hbars([{ k: 'Lo empezaron', v: T.start }, ...steps, { k: 'Lo terminaron', v: T.done }], { max: t0, subFmt: (x) => pct(x.v / Math.max(1, T.start)) }) : empty());

  const modeName = { ffa: 'Todos contra todos', teams: 'Equipos' };
  const modes = card('Modos de juego', 'Partidas, duración y puntaje promedio por modo.', 'c6',
    hbars(D.modes.map((m) => ({ k: modeName[m.mode] || m.mode, v: m.matches, m })), { subFmt: (x) => `${dur(x.m.avg_s)} · ${fmt(x.m.avg_score)} pts` }),
    ...D.modes.filter((m) => m.mode === 'teams' && m.won + m.lost > 0).map((m) => el('p', { class: 'sub', style: 'margin-top:10px' }, `En equipos, el equipo del jugador ganó ${pct(m.won / (m.won + m.lost))} de las rondas (${fmt(m.won)} de ${fmt(m.won + m.lost)}).`)));
  const arenaName = { steam: 'Steampunk', cyber: 'Cyberpunk', crystal: 'Cristal', tutorial: 'Tutorial' };
  const arenas = card('Arenas', null, 'c6', hbars(D.arenas.map((a) => ({ k: arenaName[a.arena] || a.arena, v: a.matches, a })), { subFmt: (x) => dur(x.a.avg_s) }));

  const status = { '58+': ['var(--good)', '✅', 'Fluido'], '45–58': ['var(--warning)', '🟡', 'Aceptable'], '30–45': ['var(--serious)', '🟠', 'Justo'], '<30': ['var(--critical)', '🔴', 'Malo'] };
  const perf = card('Rendimiento', 'Sesiones según los fps promedio que tuvieron (para saber en qué PCs anda mal).', 'c6',
    hbars(['58+', '45–58', '30–45', '<30'].map((b) => ({ k: `${status[b][1]} ${status[b][2]} (${b} fps)`, v: D.perf.buckets.find((x) => x.b === b)?.v || 0, color: status[b][0] }))),
    el('h2', { style: 'margin-top:16px' }, 'Placas de video más comunes'),
    table(['Placa', 'Sesiones', 'fps prom.'], D.perf.gpus.map((g) => [g.gpu.replace(/^ANGLE \((.*)\)$/, '$1'), fmt(g.sessions), fmt(g.fps)]), [1, 2]));

  const recs = card('Récords', 'Mejores partidas de todos los tiempos.', 'c6',
    table(['#', 'Blob', 'Modo', 'Puntos', 'KO', 'Cuándo'], D.records.map((r, i) => [String(i + 1), r.name, modeName[r.mode] || r.mode, fmt(r.score), fmt(r.kos || 0), r.at]), [3, 4]));

  const dimName = { country: 'Países', lang: 'Idiomas', browser: 'Navegadores', os: 'Sistemas', device: 'Dispositivo', referrer: 'De dónde llegan' };
  const dims = Object.entries(D.dims).map(([k, list]) => card(dimName[k] || k, null, 'c4', hbars(list.map((x) => ({ k: x.k, v: x.v })))));

  app.replaceChildren(kpis, visCard, retCard, mCard, hCard, funnel, tut, modes, arenas, perf, recs, ...dims);

  columns(visHost, { labels, every, tipTitle: (i) => daily[i].day, series: [
    { name: 'Nuevos', color: 'var(--series-1)', values: daily.map((d) => d.new) },
    { name: 'Vuelven', color: 'var(--series-2)', values: daily.map((d) => d.returning) },
  ] });
  columns(mHost, { labels, every, tipTitle: (i) => `${daily[i].day} · ${fmt(daily[i].minutes)} min jugados`, series: [{ name: 'partidas', color: 'var(--series-1)', values: daily.map((d) => d.matches) }] });
  columns(hHost, { labels: D.hours.map((_, h) => String(h)), every: 2, tipTitle: (i) => `${i}:00 a ${i}:59`, series: [{ name: 'partidas', color: 'var(--series-1)', values: D.hours }] });
  showLive(D.live);
}

function showLive(l) { $('#live').textContent = `${fmt(l.online)} en línea · ${fmt(l.playing)} jugando`; }

async function load() {
  try {
    const r = await fetch(`/api/admin/stats?days=${days}`, { cache: 'no-store' });
    if (r.status === 403) throw new Error('Sin permiso. El panel sólo se ve entrando por el subdominio admin (Cloudflare Access).');
    if (r.status === 503) throw new Error('El servidor no tiene base de datos conectada.');
    if (!r.ok) throw new Error(`Error ${r.status}`);
    data = await r.json();
    render();
  } catch (e) {
    app.replaceChildren(el('div', { class: 'err' }, e.message));
  }
}

$('#range').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  days = +b.dataset.d;
  for (const x of $('#range').children) x.classList.toggle('on', x === b);
  load();
});
setInterval(async () => { try { const r = await fetch('/api/admin/live'); if (r.ok) showLive(await r.json()); } catch { /* nada */ } }, 15000);
setInterval(load, 5 * 60000);
load();

// ---------------------------------------------------------------- salas en tiempo real (no necesitan la base)
const modeLabel = { ffa: 'Todos contra todos', teams: 'Equipos' };
const ago = (ms) => { const m = Math.floor((Date.now() - ms) / 60000); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`; };
function gameURL(roomId) { return (import.meta.env?.DEV ? '/' : '/juego') + '?room=' + encodeURIComponent(roomId); }

async function loadRooms() {
  const body = $('#roomsBody');
  try {
    const r = await fetch('/api/admin/rooms', { cache: 'no-store' });
    if (r.status === 403) { body.replaceChildren(empty('Sin permiso.')); return; }
    const { rooms } = await r.json();
    if (!rooms.length) { body.replaceChildren(empty('No hay salas abiertas. Se abre una cuando alguien entra a jugar.')); return; }
    rooms.sort((a, b) => b.humans - a.humans);
    body.replaceChildren(el('div', { class: 'rooms' }, rooms.map((rm) => {
      const full = rm.humans >= rm.capacity;
      const ts = rm.team;
      const bar = el('div', { class: 'bar', title: `${rm.humans} personas · ${rm.bots} bots` },
        el('i', { style: `width:${(rm.humans / rm.capacity) * 100}%;background:var(--series-1)` }),
        el('i', { style: `width:${(rm.bots / rm.capacity) * 100}%;background:var(--series-2);margin-left:2px` }));
      const btn = el('button', { type: 'button' }, full ? 'Sala llena' : '🎮 Entrar a jugar');
      btn.disabled = full;
      btn.addEventListener('click', () => window.open(gameURL(rm.id), '_blank'));
      return el('div', { class: 'room' },
        el('div', { class: 'top' }, el('b', {}, `Sala ${rm.id}`), el('span', { class: 'pill' }, modeLabel[rm.mode] || rm.mode)),
        el('div', { class: 'meta' }, `${rm.humans} personas · ${rm.bots} bots · ${rm.alive} vivos · abierta ${ago(rm.created)}`,
          ts ? ` · ronda ${ts.round} (${ts.wins[0]}–${ts.wins[1]})` : ''),
        bar,
        rm.players.length ? el('ul', {}, rm.players.map((p) => el('li', {}, p.name, el('span', {}, ` · ${fmt(p.score)} pts · ${p.kos} KO${p.team != null ? (p.team ? ' · Rojo' : ' · Azul') : ''}`)))) : el('div', { class: 'empty' }, 'Sólo bots (nadie jugando).'),
        btn);
    })));
  } catch {
    body.replaceChildren(empty('No se pudo leer el estado de las salas.'));
  }
}
loadRooms();
setInterval(loadRooms, 2000);
