// Reportes del panel de analíticas (admin). Todo sale de 4 tablas: players, sessions, matches, events.
// "Visitante" = un navegador (id anónimo al azar). "Visita" = una sesión (cada vez que abre el juego).
// Los días se cuentan en la zona horaria de REPORT_TZ. Los filtros (país, sistema, navegador…) se aplican sobre
// las sesiones; partidas y eventos se filtran por la sesión a la que pertenecen.

const rows = async (pool, sql, params) => (await pool.query(sql, params)).rows;
const n = (v) => (v == null ? 0 : Number(v));
const nn = (v) => (v == null ? null : Number(v));
const PAGE = 50;

// ---------------------------------------------------------------- filtros
export function parseFilters(sp) {
  const s = (k, max = 40) => { const v = sp.get(k); return v ? String(v).slice(0, max) : null; };
  const d = sp.get('days');
  const days = d === 'all' ? 3650 : Math.max(1, Math.min(3650, parseInt(d || '30', 10) || 30));
  const kind = sp.get('kind');
  return {
    days, country: s('country', 2), os: s('os'), browser: s('browser'), device: s('device', 10), gpu: s('gpu', 20), ver: s('ver', 24),
    bots: sp.get('bots') === '1', kind: kind === 'new' || kind === 'ret' ? kind : null,
  };
}

// condiciones sobre las sesiones (alias s) entre from y to; los valores van a params (nunca en el texto del SQL)
function where(f, params, from, to = null, a = 's') {
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const c = [`${a}.started_at >= ${p(from)}`];
  if (to) c.push(`${a}.started_at < ${p(to)}`);
  if (!f.bots) c.push(`not ${a}.is_bot`);
  if (f.country) c.push(`${a}.country = ${p(f.country)}`);
  if (f.os) c.push(`${a}.os = ${p(f.os)}`);
  if (f.browser) c.push(`${a}.browser = ${p(f.browser)}`);
  if (f.device) c.push(`${a}.device = ${p(f.device)}`);
  if (f.gpu) c.push(`${a}.gpu_vendor = ${p(f.gpu)}`);
  if (f.ver) c.push(`${a}.ver = ${p(f.ver)}`);
  if (f.kind) c.push(`${a}.player_id in (select id from players where first_seen ${f.kind === 'new' ? '>=' : '<'} ${p(from)})`);
  return c.join(' and ');
}
const range = (f) => { const now = new Date(); return { now, from: new Date(now - f.days * 864e5), prevFrom: new Date(now - 2 * f.days * 864e5) }; };

// promedios ponderados que se repiten en varios reportes
const FPS = 'sum(s.fps_avg * s.fps_n) / nullif(sum(s.fps_n) filter (where s.fps_avg is not null), 0)';
const RTT = 'sum(s.rtt_avg * s.net_s) / nullif(sum(s.net_s) filter (where s.rtt_avg is not null), 0)';

// valores posibles de cada filtro (en el período, sin los demás filtros)
export async function options(pool, f) {
  const { from } = range(f);
  const dims = { country: 's.country', os: 's.os', browser: 's.browser', device: 's.device', gpu: 's.gpu_vendor', ver: 's.ver' };
  const out = {};
  for (const [k, col] of Object.entries(dims)) {
    out[k] = (await rows(pool, `select ${col} as k, count(distinct s.player_id) as v from sessions s
      where s.started_at >= $1 and ${col} is not null ${f.bots ? '' : 'and not s.is_bot'} group by 1 order by 2 desc limit 60`, [from]))
      .map((r) => ({ k: r.k, v: n(r.v) }));
  }
  out.bots = n((await rows(pool, 'select count(distinct player_id) as v from sessions where started_at >= $1 and is_bot', [from]))[0]?.v);
  return out;
}

// ---------------------------------------------------------------- resumen
async function kpis(pool, f, from, to) {
  const P = [];
  const w = where(f, P, from, to);
  const [s] = await rows(pool, `
    select count(distinct s.player_id) as visitors, count(*) as visits,
      count(distinct s.player_id) filter (where pl.first_seen >= $1) as new_visitors,
      count(distinct s.ip) as ips,
      coalesce(avg(extract(epoch from s.last_seen - s.started_at)), 0) as avg_session_s,
      ${FPS} as fps, ${RTT} as rtt
    from sessions s join players pl on pl.id = s.player_id where ${w}`, P);
  const [m] = await rows(pool, `
    select count(*) as matches, count(distinct m.player_id) as players, coalesce(sum(m.duration_s), 0) as play_s
    from matches m join sessions s on s.id = m.session_id where ${w} and m.arena <> 'tutorial'`, P);
  const visitors = n(s.visitors), news = n(s.new_visitors);
  return {
    visitors, visits: n(s.visits), new_visitors: news, returning: Math.max(0, visitors - news), ips: n(s.ips),
    avg_session_s: n(s.avg_session_s), fps: nn(s.fps), rtt: nn(s.rtt),
    matches: n(m.matches), players: n(m.players), play_s: n(m.play_s),
  };
}

export async function overview(pool, f, tz) {
  const { now, from, prevFrom } = range(f);
  const P = [];
  const w = where(f, P, from);
  const Pw = [...P]; // (las consultas que no usan la zona horaria no pueden recibirla: Postgres exige la cantidad justa)
  const T = `$${P.push(tz)}`;
  const [cur, prev, daily, dailyM, retention, funnel, tutorial, modes, hours, records] = await Promise.all([
    kpis(pool, f, from, now),
    kpis(pool, f, prevFrom, from),
    rows(pool, `select to_char((s.started_at at time zone ${T})::date, 'YYYY-MM-DD') as day, count(distinct s.player_id) as v, count(*) as visits,
        count(distinct s.player_id) filter (where (pl.first_seen at time zone ${T})::date = (s.started_at at time zone ${T})::date) as new
      from sessions s join players pl on pl.id = s.player_id where ${w} group by 1`, P),
    rows(pool, `select to_char((m.started_at at time zone ${T})::date, 'YYYY-MM-DD') as day, count(*) as v, coalesce(sum(m.duration_s), 0) / 60.0 as minutes
      from matches m join sessions s on s.id = m.session_id where ${w} and m.arena <> 'tutorial' group by 1`, P),
    // retención: de los que llegaron cada día (con una sesión que pasa los filtros), cuántos volvieron otro día
    rows(pool, `with c as (select pl.id, (pl.first_seen at time zone ${T})::date as d0 from players pl
                  where pl.first_seen >= $1 and exists (select 1 from sessions s where s.player_id = pl.id and ${w})),
                 v as (select distinct s.player_id, (s.started_at at time zone ${T})::date as d from sessions s where s.started_at >= $1)
      select to_char(c.d0, 'YYYY-MM-DD') as cohort, count(*) as n,
        count(*) filter (where exists (select 1 from v where v.player_id = c.id and v.d = c.d0 + 1)) as d1,
        count(*) filter (where exists (select 1 from v where v.player_id = c.id and v.d between c.d0 + 1 and c.d0 + 7)) as d7,
        count(*) filter (where exists (select 1 from v where v.player_id = c.id and v.d between c.d0 + 1 and c.d0 + 30)) as d30
      from c group by c.d0 order by c.d0`, P),
    rows(pool, `with fs as (select s.* from sessions s where ${w}),
                 m as (select m.player_id, sum(coalesce(m.duration_s, 0)) as t from matches m join fs on fs.id = m.session_id where m.arena <> 'tutorial' group by 1),
                 r as (select player_id from fs group by 1 having count(distinct (started_at at time zone ${T})::date) > 1)
      select (select count(distinct player_id) from fs) as visited, (select count(*) from m) as played,
        (select count(*) from m where t >= 120) as played2, (select count(*) from m where t >= 600) as played10, (select count(*) from r) as returned`, P),
    rows(pool, `select e.data->>'state' as state, e.data->>'step' as step, count(distinct e.player_id) as players
      from events e join sessions s on s.id = e.session_id where e.type = 'tutorial' and ${w} group by 1, 2`, Pw),
    rows(pool, `select m.mode, count(*) as matches, count(distinct m.player_id) as players, coalesce(avg(m.duration_s), 0) as avg_s,
        coalesce(avg(m.score), 0) as avg_score, coalesce(sum(m.rounds_won), 0) as won, coalesce(sum(m.rounds_lost), 0) as lost
      from matches m join sessions s on s.id = m.session_id where ${w} and m.arena <> 'tutorial' group by m.mode order by 2 desc`, Pw),
    rows(pool, `select extract(hour from m.started_at at time zone ${T})::int as h, count(*) as v
      from matches m join sessions s on s.id = m.session_id where ${w} and m.arena <> 'tutorial' group by 1`, P),
    rows(pool, `select m.mode, coalesce(p.name, '?') as name, m.player_id as pid, m.score, m.kos, to_char(m.ended_at at time zone ${T}, 'YYYY-MM-DD HH24:MI') as at
      from matches m join players p on p.id = m.player_id join sessions s on s.id = m.session_id
      where ${w} and m.ended_at is not null and m.score > 0 order by m.score desc limit 15`, P),
  ]);

  // serie diaria completa (días sin datos = 0; como mucho los últimos 120)
  const dayList = [];
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (let i = Math.min(f.days, 120) - 1; i >= 0; i--) dayList.push(fmt.format(new Date(now - i * 864e5)));
  const by = (list, key = 'v') => Object.fromEntries(list.map((r) => [r.day, n(r[key])]));
  const vis = by(daily), nw = by(daily, 'new'), vv = by(daily, 'visits'), mt = by(dailyM), mm = by(dailyM, 'minutes');
  const days = dayList.map((day) => ({ day, visitors: vis[day] || 0, new: nw[day] || 0, returning: Math.max(0, (vis[day] || 0) - (nw[day] || 0)), visits: vv[day] || 0, matches: mt[day] || 0, minutes: Math.round(mm[day] || 0) }));

  const today = dayList[dayList.length - 1];
  const age = (d) => Math.round((new Date(today) - new Date(d)) / 864e5);
  const rate = (k, minAge) => {
    const g = retention.filter((r) => age(r.cohort) >= minAge);
    const tot = g.reduce((s, r) => s + n(r.n), 0);
    return tot ? { rate: g.reduce((s, r) => s + n(r[k]), 0) / tot, base: tot } : { rate: null, base: 0 };
  };
  const fu = funnel[0] || {};
  const tut = { offered: 0, start: 0, done: 0, declined: 0, skip: 0, steps: {} };
  for (const r of tutorial) {
    if (r.state === 'step') tut.steps[r.step] = n(r.players);
    else if (r.state in tut) tut[r.state] = n(r.players);
  }
  return {
    days: f.days, tz, kpis: { cur, prev }, daily: days,
    retention: { d1: rate('d1', 1), d7: rate('d7', 7), d30: rate('d30', 30), cohorts: retention.map((r) => ({ cohort: r.cohort, n: n(r.n), d1: n(r.d1), d7: n(r.d7), d30: n(r.d30), age: age(r.cohort) })) },
    funnel: { visited: n(fu.visited), played: n(fu.played), played2: n(fu.played2), played10: n(fu.played10), returned: n(fu.returned) },
    tutorial: tut,
    modes: modes.map((r) => ({ mode: r.mode, matches: n(r.matches), players: n(r.players), avg_s: n(r.avg_s), avg_score: n(r.avg_score), won: n(r.won), lost: n(r.lost) })),
    hours: Array.from({ length: 24 }, (_, h) => n(hours.find((r) => r.h === h)?.v)),
    records: records.map((r) => ({ ...r, score: n(r.score), kos: n(r.kos) })),
  };
}

// ---------------------------------------------------------------- jugadores
const SORTS = {
  last: 'agg.last_in desc', first: 'p.first_seen desc', visits: 'agg.visits desc, agg.last_in desc', play: 'play_s desc nulls last',
  matches: 'matches desc nulls last', best: 'best desc nulls last', fps: 'agg.fps asc nulls last', rtt: 'agg.rtt desc nulls last',
  ghost: 'ghost_min desc nulls last',
};
const like = (q) => `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;

export async function players(pool, f, { q = null, sort = 'last', page = 0 } = {}, tz) {
  const { from } = range(f);
  const P = [];
  const w = where(f, P, from);
  let qc = 'true';
  if (q) qc = `(p.name ilike $${P.push(like(q))} or p.id::text like $${P.length})`;
  const nBase = P.length;
  const T = `$${P.push(tz)}`;
  const pg = Math.max(0, page | 0);
  const base = `
    with fs as (select s.* from sessions s where ${w}),
    agg as (select fs.player_id, count(*) as visits, max(fs.last_seen) as last_in,
              sum(fs.fps_avg * fs.fps_n) / nullif(sum(fs.fps_n) filter (where fs.fps_avg is not null), 0) as fps,
              sum(fs.rtt_avg * fs.net_s) / nullif(sum(fs.net_s) filter (where fs.rtt_avg is not null), 0) as rtt,
              sum(fs.net_s) as net_s, sum(fs.ghost) as ghost, count(distinct fs.ip) as ips
            from fs group by fs.player_id),
    m as (select m.player_id, count(*) as matches, coalesce(sum(m.duration_s), 0) as play_s, max(m.score) as best, coalesce(sum(m.kos), 0) as kos
          from matches m join fs on fs.id = m.session_id where m.arena <> 'tutorial' group by m.player_id),
    lastd as (select distinct on (fs.player_id) fs.player_id, fs.country, fs.city, fs.os, fs.os_ver, fs.browser, fs.browser_ver, fs.gpu, fs.gpu_vendor, fs.device
              from fs order by fs.player_id, fs.started_at desc)`;
  const [list, [{ total }]] = await Promise.all([
    rows(pool, `${base}
      select p.id, p.name, to_char(p.first_seen at time zone ${T}, 'YYYY-MM-DD HH24:MI') as first_seen, to_char(agg.last_in at time zone ${T}, 'YYYY-MM-DD HH24:MI') as last_seen,
        agg.visits, agg.fps, agg.rtt, agg.ips, agg.net_s, case when agg.net_s > 30 then agg.ghost / (agg.net_s / 60) end as ghost_min,
        m.matches, m.play_s, m.best, m.kos, lastd.country, lastd.city, lastd.os, lastd.os_ver, lastd.browser, lastd.browser_ver, lastd.gpu, lastd.gpu_vendor, lastd.device
      from agg join players p on p.id = agg.player_id left join m on m.player_id = agg.player_id left join lastd on lastd.player_id = agg.player_id
      where ${qc} order by ${SORTS[sort] || SORTS.last} limit ${PAGE} offset ${pg * PAGE}`, P),
    rows(pool, `${base} select count(*) as total from agg join players p on p.id = agg.player_id where ${qc}`, P.slice(0, nBase)),
  ]);
  return {
    total: n(total), page: pg, pageSize: PAGE,
    list: list.map((r) => ({ ...r, visits: n(r.visits), fps: nn(r.fps), rtt: nn(r.rtt), ips: n(r.ips), ghost_min: nn(r.ghost_min), matches: n(r.matches), play_s: n(r.play_s), best: nn(r.best), kos: n(r.kos) })),
  };
}

// un jugador: todo lo que se sabe de él (sin filtros: su historia completa)
export async function player(pool, id, tz) {
  const [p] = await rows(pool, `select id, name, country, lang, best_score, to_char(first_seen at time zone $2, 'YYYY-MM-DD HH24:MI') as first_seen,
      to_char(last_seen at time zone $2, 'YYYY-MM-DD HH24:MI') as last_seen, extract(epoch from now() - last_seen) as ago_s from players where id = $1`, [id, tz]);
  if (!p) return null;
  const [sess, matches, ips, related] = await Promise.all([
    rows(pool, `select s.id, to_char(s.started_at at time zone $2, 'YYYY-MM-DD HH24:MI') as at, extract(epoch from s.last_seen - s.started_at) as dur_s,
        s.country, s.region, s.city, s.ip, s.browser, s.browser_ver, s.os, s.os_ver, s.device, s.model, s.gpu, s.gpu_vendor, s.screen, s.win, s.dpr, s.hz,
        s.cores, s.ram, s.tz, s.langs, s.conn, s.touch, s.ver, s.referrer, s.utm_source, s.utm_campaign, s.is_bot, s.is_new,
        s.fps_avg, s.fps_target, s.fps_n, s.cpu_ms, s.gpu_ms, s.net_s, s.rtt_avg, s.hits, s.seen, s.ghost, s.me_hit, s.me_late, s.me_vis, s.ot_vis,
        (select count(*) from matches m where m.session_id = s.id and m.arena <> 'tutorial') as matches
      from sessions s where s.player_id = $1 order by s.started_at desc limit 200`, [id, tz]),
    rows(pool, `select to_char(m.started_at at time zone $2, 'YYYY-MM-DD HH24:MI') as at, m.mode, m.arena, m.duration_s, m.score, m.kos, m.falls,
        m.max_mass, m.team, m.rounds_won, m.rounds_lost, m.end_reason
      from matches m where m.player_id = $1 order by m.started_at desc limit 200`, [id, tz]),
    rows(pool, `select s.ip, max(s.country) as country, max(s.city) as city, max(s.region) as region, count(*) as visits,
        to_char(max(s.started_at) at time zone $2, 'YYYY-MM-DD HH24:MI') as last
      from sessions s where s.player_id = $1 and s.ip is not null group by s.ip order by max(s.started_at) desc limit 50`, [id, tz]),
    // otros navegadores que entraron desde las mismas IPs (puede ser la misma persona, o la misma casa)
    rows(pool, `select p2.id, p2.name, count(distinct s2.ip) as shared, to_char(max(s2.started_at) at time zone $2, 'YYYY-MM-DD HH24:MI') as last
      from sessions s1 join sessions s2 on s2.ip = s1.ip and s2.player_id <> s1.player_id join players p2 on p2.id = s2.player_id
      where s1.player_id = $1 and s1.ip is not null group by p2.id, p2.name order by max(s2.started_at) desc limit 20`, [id, tz]),
  ]);
  const toNum = (r, ks) => { for (const k of ks) r[k] = nn(r[k]); return r; };
  const S = sess.map((r) => toNum(r, ['dur_s', 'dpr', 'hz', 'cores', 'ram', 'fps_avg', 'fps_target', 'fps_n', 'cpu_ms', 'gpu_ms', 'net_s', 'rtt_avg', 'hits', 'seen', 'ghost', 'me_hit', 'me_late', 'me_vis', 'ot_vis', 'matches']));
  const M = matches.map((r) => toNum(r, ['duration_s', 'score', 'kos', 'falls', 'max_mass', 'team', 'rounds_won', 'rounds_lost']));
  const sum = (a, f2) => a.reduce((s, r) => s + (f2(r) || 0), 0);
  const fpsW = S.filter((s) => s.fps_avg != null && s.fps_n);
  const netW = S.filter((s) => s.rtt_avg != null && s.net_s > 0);
  const netMin = sum(S, (s) => s.net_s) / 60;
  const hits = sum(S, (s) => s.hits), meHit = sum(S, (s) => s.me_hit);
  return {
    player: { ...p, best_score: n(p.best_score), ago_s: n(p.ago_s) },
    totals: {
      visits: S.length, matches: M.length, play_s: sum(M, (m) => m.duration_s), kos: sum(M, (m) => m.kos), falls: sum(M, (m) => m.falls),
      best: Math.max(0, ...M.map((m) => m.score || 0)),
      fps: fpsW.length ? sum(fpsW, (s) => s.fps_avg * s.fps_n) / sum(fpsW, (s) => s.fps_n) : null,
      rtt: netW.length ? sum(netW, (s) => s.rtt_avg * s.net_s) / sum(netW, (s) => s.net_s) : null,
      net_min: netMin, ghost_min: netMin > 0.5 ? sum(S, (s) => s.ghost) / netMin : null,
      seen: hits ? sum(S, (s) => s.seen) / hits : null, me_seen: meHit ? 1 - sum(S, (s) => s.me_late) / meHit : null,
    },
    sessions: S, matches: M, ips: ips.map((r) => ({ ...r, visits: n(r.visits) })), related: related.map((r) => ({ ...r, shared: n(r.shared) })),
  };
}

// ---------------------------------------------------------------- sesiones (visitas)
export async function sessions(pool, f, { q = null, page = 0 } = {}, tz) {
  const { from } = range(f);
  const P = [];
  const w = where(f, P, from);
  let qc = 'true';
  if (q) qc = `(p.name ilike $${P.push(like(q))} or s.ip like $${P.length} or s.city ilike $${P.length})`;
  const nBase = P.length;
  const T = `$${P.push(tz)}`;
  const pg = Math.max(0, page | 0);
  const [list, [{ total }]] = await Promise.all([
    rows(pool, `
      select s.id, s.player_id as pid, p.name, to_char(s.started_at at time zone ${T}, 'YYYY-MM-DD HH24:MI') as at, extract(epoch from s.last_seen - s.started_at) as dur_s,
        s.is_new, s.is_bot, s.country, s.city, s.ip, s.browser, s.browser_ver, s.os, s.os_ver, s.device, s.gpu, s.gpu_vendor, s.screen, s.win, s.hz,
        s.fps_avg, s.rtt_avg, s.net_s, s.ghost, s.ver,
        (select count(*) from matches m where m.session_id = s.id and m.arena <> 'tutorial') as matches
      from sessions s join players p on p.id = s.player_id where ${w} and ${qc}
      order by s.started_at desc limit ${PAGE} offset ${pg * PAGE}`, P),
    rows(pool, `select count(*) as total from sessions s join players p on p.id = s.player_id where ${w} and ${qc}`, P.slice(0, nBase)),
  ]);
  return {
    total: n(total), page: pg, pageSize: PAGE,
    list: list.map((r) => ({ ...r, dur_s: n(r.dur_s), hz: nn(r.hz), fps_avg: nn(r.fps_avg), rtt_avg: nn(r.rtt_avg), net_s: n(r.net_s), ghost: n(r.ghost), matches: n(r.matches) })),
  };
}

// ---------------------------------------------------------------- rendimiento por segmento
// reach: qué parte de los fps que pedía su monitor logró (1 = todos). Sirve más que los fps solos: 60 en un monitor
// de 60 Hz es perfecto, y 72 en uno de 144 es la mitad.
const PERF_DIMS = {
  os: "s.os || coalesce(' ' || s.os_ver, '')", browser: "s.browser || coalesce(' ' || s.browser_ver, '')", gpu_vendor: 's.gpu_vendor',
  gpu: "regexp_replace(coalesce(s.gpu, '?'), '^ANGLE \\((.*)\\)$', '\\1')", country: 's.country', screen: 's.screen', device: 's.device',
  cores: "s.cores::text || ' núcleos'", ram: "s.ram::text || ' GB'",
  // la frecuencia medida (143, 144,7…) al valor de monitor más cercano
  hz: `(case when s.hz is null then null when s.hz < 65 then 60 when s.hz < 82 then 75 when s.hz < 95 then 90 when s.hz < 110 then 100 when s.hz < 132 then 120
         when s.hz < 155 then 144 when s.hz < 200 then 165 when s.hz < 270 then 240 else 360 end)::text || ' Hz'`,
};
const PERF_AGG = `count(*) as n, count(distinct s.player_id) as players, ${FPS} as fps, avg((s.fps_avg >= 55)::int) as fluid,
  avg(s.cpu_ms) as cpu, avg(s.gpu_ms) as gpu, avg(least(1, s.fps_avg / nullif(s.fps_target, 0))) as reach`;
const perfRow = (r) => ({ k: r.k, n: n(r.n), players: n(r.players), fps: nn(r.fps), fluid: nn(r.fluid), cpu: nn(r.cpu), gpu: nn(r.gpu), reach: nn(r.reach) });

export async function perf(pool, f) {
  const { from } = range(f);
  const P = [];
  const w = `${where(f, P, from)} and s.fps_n > 0`;
  const [[k], buckets] = await Promise.all([
    rows(pool, `select ${PERF_AGG} from sessions s where ${w}`, P),
    rows(pool, `select case when s.fps_avg < 30 then '<30' when s.fps_avg < 45 then '30–45' when s.fps_avg < 58 then '45–58' else '58+' end as b,
        count(*) as v from sessions s where ${w} group by 1`, P),
  ]);
  const seg = {};
  await Promise.all(Object.entries(PERF_DIMS).map(async ([key, expr]) => {
    seg[key] = (await rows(pool, `select ${expr} as k, ${PERF_AGG} from sessions s where ${w} and ${expr} is not null
      group by 1 order by 2 desc limit ${key === 'gpu' ? 15 : 12}`, P)).map(perfRow);
  }));
  return {
    kpis: perfRow(k),
    buckets: ['58+', '45–58', '30–45', '<30'].map((b) => ({ b, v: n(buckets.find((r) => r.b === b)?.v) })),
    seg,
  };
}

// ---------------------------------------------------------------- red en línea
const NET_AGG = `count(*) as n, count(distinct s.player_id) as players, sum(s.net_s) / 60 as minutes, ${RTT} as rtt,
  sum(s.seen)::float / nullif(sum(s.hits), 0) as seen, 1 - sum(s.me_late)::float / nullif(sum(s.me_hit), 0) as me_seen,
  sum(s.ghost) / nullif(sum(s.net_s) / 60, 0) as ghost_min, sum(s.me_vis) / nullif(sum(s.net_s) / 60, 0) as me_vis_min,
  sum(s.ot_vis) / nullif(sum(s.net_s) / 60, 0) as ot_vis_min`;
const netRow = (r) => ({ k: r.k, n: n(r.n), players: n(r.players), minutes: n(r.minutes), rtt: nn(r.rtt), seen: nn(r.seen), me_seen: nn(r.me_seen), ghost_min: nn(r.ghost_min), me_vis_min: nn(r.me_vis_min), ot_vis_min: nn(r.ot_vis_min) });

export async function net(pool, f, tz) {
  const { from } = range(f);
  const P = [];
  const w = `${where(f, P, from)} and s.net_s > 0`;
  const nBase = P.length;
  const T = `$${P.push(tz)}`;
  const Pb = P.slice(0, nBase);
  const [[k], byCountry, byPing, list] = await Promise.all([
    rows(pool, `select ${NET_AGG} from sessions s where ${w}`, Pb),
    rows(pool, `select coalesce(s.country, '—') as k, ${NET_AGG} from sessions s where ${w} group by 1 order by 2 desc limit 20`, Pb),
    rows(pool, `select case when s.rtt_avg < 60 then 'menos de 60 ms' when s.rtt_avg < 120 then '60 a 120 ms' when s.rtt_avg < 200 then '120 a 200 ms' else '200 ms o más' end as k,
        ${NET_AGG} from sessions s where ${w} and s.rtt_avg is not null group by 1 order by min(s.rtt_avg)`, Pb),
    rows(pool, `select s.id, s.player_id as pid, p.name, to_char(s.started_at at time zone ${T}, 'MM-DD HH24:MI') as at, coalesce(s.country, '—') as country, s.city,
        s.net_s, s.rtt_avg, s.hits, s.seen, s.ghost, s.me_hit, s.me_late, s.me_vis, s.ot_vis, s.fps_avg
      from sessions s join players p on p.id = s.player_id where ${w} order by s.started_at desc limit 40`, P),
  ]);
  return {
    kpis: netRow(k), byCountry: byCountry.map(netRow), byPing: byPing.map(netRow),
    list: list.map((r) => ({ ...r, net_s: n(r.net_s), rtt_avg: nn(r.rtt_avg), hits: n(r.hits), seen: n(r.seen), ghost: n(r.ghost), me_hit: n(r.me_hit), me_late: n(r.me_late), me_vis: n(r.me_vis), ot_vis: n(r.ot_vis), fps_avg: nn(r.fps_avg) })),
  };
}

// ---------------------------------------------------------------- audiencia (de dónde son y con qué juegan)
const AUD_DIMS = {
  country: 's.country', city: "nullif(concat_ws(', ', s.city, s.region, s.country), coalesce(s.country, ''))", lang: 's.lang', tz: 's.tz',
  browser: "s.browser || coalesce(' ' || s.browser_ver, '')", os: "s.os || coalesce(' ' || s.os_ver, '')", device: 's.device', gpu_vendor: 's.gpu_vendor',
  screen: 's.screen', referrer: "coalesce(s.referrer, '(directo)')", utm: "nullif(concat_ws(' / ', s.utm_source, s.utm_medium, s.utm_campaign), '')",
  ver: 's.ver', conn: 's.conn',
};
export async function audience(pool, f) {
  const { from } = range(f);
  const P = [];
  const w = where(f, P, from);
  const out = {};
  await Promise.all(Object.entries(AUD_DIMS).map(async ([key, expr]) => {
    out[key] = (await rows(pool, `select ${expr} as k, count(distinct s.player_id) as v, count(*) as visits from sessions s
      where ${w} and ${expr} is not null group by 1 order by 2 desc, 3 desc limit 15`, P)).map((r) => ({ k: r.k, v: n(r.v), visits: n(r.visits) }));
  }));
  return out;
}

// ---------------------------------------------------------------- en vivo
export async function liveNow(pool) {
  const [r] = await rows(pool, `
    select (select count(*) from sessions where last_seen > now() - interval '90 seconds' and not is_bot) as online,
           (select count(*) from matches m join sessions s on s.id = m.session_id
              where m.ended_at is null and s.last_seen > now() - interval '90 seconds') as playing`);
  return { online: n(r.online), playing: n(r.playing) };
}

// la IP se guarda sólo IP_RETENTION_DAYS días (por defecto 90): después se borra (lo demás queda)
export async function forgetIPs(pool, days) {
  const r = await pool.query('update sessions set ip = null where ip is not null and started_at < now() - make_interval(days => $1)', [days]);
  return r.rowCount;
}
