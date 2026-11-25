// Reportes del panel de analíticas (admin). Todo sale de 4 tablas: players, sessions, matches, events.
// "Visitante" = un navegador (id anónimo). Los días se cuentan en la zona horaria de REPORT_TZ.

const rows = async (pool, sql, params) => (await pool.query(sql, params)).rows;
const n = (v) => (v == null ? 0 : Number(v));

async function kpis(pool, from, to) {
  const [r] = await rows(pool, `
    select
      (select count(distinct player_id) from sessions where started_at >= $1 and started_at < $2) as visitors,
      (select count(*) from players where first_seen >= $1 and first_seen < $2) as new_players,
      (select count(*) from sessions where started_at >= $1 and started_at < $2) as sessions,
      (select count(*) from matches where started_at >= $1 and started_at < $2) as matches,
      (select count(distinct player_id) from matches where started_at >= $1 and started_at < $2) as players,
      (select coalesce(avg(extract(epoch from last_seen - started_at)), 0) from sessions where started_at >= $1 and started_at < $2) as avg_session_s,
      (select coalesce(sum(duration_s), 0) from matches where started_at >= $1 and started_at < $2) as play_s`, [from, to]);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, n(v)]));
}

export async function adminStats(pool, days, tz) {
  const now = new Date();
  const from = new Date(now - days * 864e5), prevFrom = new Date(now - 2 * days * 864e5);
  const P = [from, tz];

  const [cur, prev, visitorsByDay, newByDay, matchesByDay, retention, funnel, tutorial, modes, arenas, hours, perfBuckets, gpus, records] = await Promise.all([
    kpis(pool, from, now),
    kpis(pool, prevFrom, from),
    rows(pool, `select to_char((started_at at time zone $2)::date, 'YYYY-MM-DD') as day, count(distinct player_id) as v
                from sessions where started_at >= $1 group by 1`, P),
    rows(pool, `select to_char((first_seen at time zone $2)::date, 'YYYY-MM-DD') as day, count(*) as v
                from players where first_seen >= $1 group by 1`, P),
    rows(pool, `select to_char((started_at at time zone $2)::date, 'YYYY-MM-DD') as day, count(*) as v, coalesce(sum(duration_s), 0) / 60.0 as minutes
                from matches where started_at >= $1 group by 1`, P),
    // retención: de los que llegaron cada día, cuántos volvieron al día siguiente / en la semana / en el mes
    rows(pool, `with c as (select id, (first_seen at time zone $2)::date as d0 from players where first_seen >= $1),
                     s as (select distinct player_id, (started_at at time zone $2)::date as d from sessions where started_at >= $1)
                select to_char(c.d0, 'YYYY-MM-DD') as cohort, count(*) as n,
                  count(*) filter (where exists (select 1 from s where s.player_id = c.id and s.d = c.d0 + 1)) as d1,
                  count(*) filter (where exists (select 1 from s where s.player_id = c.id and s.d between c.d0 + 1 and c.d0 + 7)) as d7,
                  count(*) filter (where exists (select 1 from s where s.player_id = c.id and s.d between c.d0 + 1 and c.d0 + 30)) as d30
                from c group by c.d0 order by c.d0`, P),
    rows(pool, `with v as (select distinct player_id from sessions where started_at >= $1),
                     m as (select player_id, sum(coalesce(duration_s, 0)) as s from matches where started_at >= $1 group by 1),
                     r as (select player_id from sessions where started_at >= $1 group by 1 having count(distinct (started_at at time zone $2)::date) > 1)
                select (select count(*) from v) as visited, (select count(*) from m) as played,
                       (select count(*) from m where s >= 120) as played2, (select count(*) from m where s >= 600) as played10,
                       (select count(*) from r) as returned`, P),
    rows(pool, `select data->>'state' as state, data->>'step' as step, count(distinct player_id) as players
                from events where type = 'tutorial' and at >= $1 group by 1, 2`, [from]),
    rows(pool, `select mode, count(*) as matches, count(distinct player_id) as players, coalesce(avg(duration_s), 0) as avg_s,
                       coalesce(avg(score), 0) as avg_score, coalesce(sum(rounds_won), 0) as won, coalesce(sum(rounds_lost), 0) as lost
                from matches where started_at >= $1 and arena <> 'tutorial' group by mode order by 2 desc`, [from]),
    rows(pool, `select arena, count(*) as matches, coalesce(avg(duration_s), 0) as avg_s from matches where started_at >= $1 group by 1 order by 2 desc`, [from]),
    rows(pool, `select extract(hour from started_at at time zone $2)::int as h, count(*) as v from matches where started_at >= $1 group by 1`, P),
    rows(pool, `select case when fps_avg < 30 then '<30' when fps_avg < 45 then '30–45' when fps_avg < 58 then '45–58' else '58+' end as b,
                       count(*) as v from sessions where started_at >= $1 and fps_avg is not null group by 1`, [from]),
    rows(pool, `select coalesce(gpu, '?') as gpu, count(*) as sessions, avg(fps_avg) as fps from sessions
                where started_at >= $1 and fps_avg is not null group by 1 order by 2 desc limit 12`, [from]),
    rows(pool, `select m.mode, coalesce(p.name, '?') as name, m.score, m.kos, to_char(m.ended_at at time zone $1, 'YYYY-MM-DD HH24:MI') as at
                from matches m join players p on p.id = m.player_id
                where m.ended_at is not null and m.score > 0 order by m.score desc limit 20`, [tz]),
  ]);

  const dims = {};
  for (const col of ['country', 'lang', 'browser', 'os', 'device', 'referrer']) {
    dims[col] = (await rows(pool, `select coalesce(${col}, '—') as k, count(distinct player_id) as v from sessions
                                   where started_at >= $1 group by 1 order by 2 desc limit 10`, [from])).map((r) => ({ k: r.k, v: n(r.v) }));
  }

  // serie diaria completa (días sin datos = 0)
  const dayList = [];
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (let i = days - 1; i >= 0; i--) dayList.push(fmt.format(new Date(now - i * 864e5)));
  const idx = (list, key = 'v') => Object.fromEntries(list.map((r) => [r.day, n(r[key])]));
  const vis = idx(visitorsByDay), nw = idx(newByDay), mt = idx(matchesByDay), mm = idx(matchesByDay, 'minutes');
  const daily = dayList.map((day) => ({ day, visitors: vis[day] || 0, new: nw[day] || 0, returning: Math.max(0, (vis[day] || 0) - (nw[day] || 0)), matches: mt[day] || 0, minutes: Math.round(mm[day] || 0) }));

  // retención resumida: sólo cuentan los grupos que ya tuvieron tiempo de volver
  const today = dayList[dayList.length - 1];
  const age = (d) => Math.round((new Date(today) - new Date(d)) / 864e5);
  const rate = (k, minAge) => {
    const g = retention.filter((r) => age(r.cohort) >= minAge);
    const tot = g.reduce((s, r) => s + n(r.n), 0);
    return tot ? { rate: g.reduce((s, r) => s + n(r[k]), 0) / tot, base: tot } : { rate: null, base: 0 };
  };

  const f = funnel[0] || {};
  const tut = { offered: 0, start: 0, done: 0, declined: 0, skip: 0, steps: {} };
  for (const r of tutorial) {
    if (r.state === 'step') tut.steps[r.step] = n(r.players);
    else if (r.state in tut) tut[r.state] = n(r.players);
  }
  const hourArr = Array.from({ length: 24 }, (_, h) => n(hours.find((r) => r.h === h)?.v));

  return {
    days, tz,
    kpis: { cur, prev },
    daily,
    retention: { d1: rate('d1', 1), d7: rate('d7', 7), d30: rate('d30', 30), cohorts: retention.map((r) => ({ cohort: r.cohort, n: n(r.n), d1: n(r.d1), d7: n(r.d7), d30: n(r.d30), age: age(r.cohort) })) },
    funnel: { visited: n(f.visited), played: n(f.played), played2: n(f.played2), played10: n(f.played10), returned: n(f.returned) },
    tutorial: tut,
    modes: modes.map((r) => ({ mode: r.mode, matches: n(r.matches), players: n(r.players), avg_s: n(r.avg_s), avg_score: n(r.avg_score), won: n(r.won), lost: n(r.lost) })),
    arenas: arenas.map((r) => ({ arena: r.arena, matches: n(r.matches), avg_s: n(r.avg_s) })),
    hours: hourArr,
    perf: { buckets: ['<30', '30–45', '45–58', '58+'].map((b) => ({ b, v: n(perfBuckets.find((r) => r.b === b)?.v) })), gpus: gpus.map((r) => ({ gpu: r.gpu, sessions: n(r.sessions), fps: Math.round(n(r.fps)) })) },
    records,
    dims,
    live: await liveNow(pool),
  };
}

export async function liveNow(pool) {
  const [r] = await rows(pool, `
    select (select count(*) from sessions where last_seen > now() - interval '90 seconds') as online,
           (select count(*) from matches m join sessions s on s.id = m.session_id
              where m.ended_at is null and s.last_seen > now() - interval '90 seconds') as playing`);
  return { online: n(r.online), playing: n(r.playing) };
}
