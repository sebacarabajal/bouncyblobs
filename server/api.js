// API del juego: /api/t (eventos de analíticas), /api/records (récords públicos) y /api/admin/* (panel).
// Se usa igual en desarrollo (montada dentro de Vite, ver vite.config.js) y en producción (server/index.js).
import { adminUser } from './auth.js';
import { adminStats, liveNow } from './stats.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v, max = 60) => (typeof v === 'string' ? v.slice(0, max).replace(/[\u0000-\u001f]/g, '') : null);
const num = (v, min, max) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : null);
const int = (v, min, max) => { const n = num(v, min, max); return n == null ? null : Math.round(n); };
const MODES = new Set(['ffa', 'teams']);
const ARENAS = new Set(['steam', 'cyber', 'crystal', 'tutorial']);

function parseUA(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Otro';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  return { browser, os, device: /Mobi|iPhone|iPad|Android/.test(ua) ? 'mobile' : 'desktop' };
}

// límite simple por IP (en memoria): un navegador manda ~2 pedidos por minuto; esto frena abusos
const hits = new Map();
function limited(ip, max = 60) {
  const now = Date.now(), k = ip || '?';
  const h = hits.get(k);
  if (!h || now - h.t > 60e3) { hits.set(k, { t: now, n: 1 }); return false; }
  return ++h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 60e3) hits.delete(k); }, 60e3).unref();

function readBody(req, max = 32768) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const send = (res, code, obj, cache = 'no-store') => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(obj));
};

// ---------------------------------------------------------------- eventos del juego
async function ingest(pool, req, body) {
  const pid = body.pid, sid = body.sid;
  if (!UUID.test(pid) || !UUID.test(sid) || !Array.isArray(body.ev)) return 400;
  const country = str(req.headers['cf-ipcountry'], 2);
  const ua = parseUA(String(req.headers['user-agent'] || ''));
  const c = await pool.connect();
  try {
    await c.query('begin');
    for (const e of body.ev.slice(0, 40)) {
      const d = e && typeof e.d === 'object' && e.d ? e.d : {};
      switch (e?.k) {
        case 'session': {
          const p = await c.query(
            `insert into players (id, name, country, lang) values ($1, $2, $3, $4)
             on conflict (id) do update set name = coalesce($2, players.name), last_seen = now(), country = coalesce($3, players.country), lang = coalesce($4, players.lang)
             returning (xmax = 0) as is_new`,
            [pid, str(d.name, 16), country, str(d.lang, 5)],
          );
          await c.query(
            `insert into sessions (id, player_id, is_new, country, lang, browser, os, device, gpu, screen, referrer)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do nothing`,
            [sid, pid, p.rows[0].is_new, country, str(d.lang, 5), ua.browser, ua.os, ua.device, str(d.gpu, 90), str(d.screen, 12), str(d.ref, 80)],
          );
          break;
        }
        case 'match_start': {
          if (!UUID.test(d.mid)) break;
          await c.query(
            `insert into matches (id, session_id, player_id, mode, arena, team) select $1, $2, $3, $4, $5, $6
             where exists (select 1 from sessions where id = $2) on conflict (id) do nothing`,
            [d.mid, sid, pid, MODES.has(d.mode) ? d.mode : 'ffa', ARENAS.has(d.arena) ? d.arena : 'steam', int(d.team, 0, 1)],
          );
          if (str(d.name, 16)) await c.query('update players set name = $2 where id = $1', [pid, str(d.name, 16)]);
          break;
        }
        case 'match_end': {
          if (!UUID.test(d.mid)) break;
          const score = int(d.score, 0, 1e7) ?? 0;
          await c.query(
            `update matches set ended_at = now(), duration_s = $3, score = $4, kos = $5, falls = $6, max_mass = $7,
               rounds_won = $8, rounds_lost = $9, end_reason = $10
             where id = $1 and player_id = $2 and ended_at is null`,
            [d.mid, pid, int(d.dur, 0, 86400), score, int(d.kos, 0, 1e5), int(d.falls, 0, 1e5), num(d.maxMass, 0, 1e4),
              int(d.won, 0, 1e4), int(d.lost, 0, 1e4), str(d.reason, 12)],
          );
          await c.query('update players set best_score = greatest(best_score, $2) where id = $1', [pid, score]);
          break;
        }
        case 'perf': {
          const fps = num(d.fps, 0, 500);
          if (fps == null) break;
          await c.query('update sessions set fps_avg = (coalesce(fps_avg, 0) * fps_n + $2) / (fps_n + 1), fps_n = fps_n + 1 where id = $1', [sid, fps]);
          await c.query('insert into events (session_id, player_id, type, data) select $1, $2, $3, $4 where exists (select 1 from sessions where id = $1)', [sid, pid, 'perf', JSON.stringify({ fps, p95: num(d.p95, 0, 1000), target: num(d.target, 0, 500), res: num(d.res, 0, 2) })]);
          break;
        }
        case 'tutorial': case 'round': case 'mode_pick': case 'net_fail': {
          const data = {};
          for (const [k, v] of Object.entries(d).slice(0, 8)) data[str(k, 20)] = typeof v === 'number' ? v : str(String(v), 40);
          await c.query('insert into events (session_id, player_id, type, data) select $1, $2, $3, $4 where exists (select 1 from sessions where id = $1)', [sid, pid, e.k, JSON.stringify(data)]);
          break;
        }
        default: break; // 'beat' y desconocidos: sólo actualizan "visto por última vez"
      }
    }
    await c.query('update sessions set last_seen = now() where id = $1', [sid]);
    await c.query('update players set last_seen = now() where id = $1', [pid]);
    await c.query('commit');
    return 204;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ---------------------------------------------------------------- récords (mejor partida de cada jugador)
async function records(pool, mode, period) {
  const since = period === 'week' ? "now() - interval '7 days'" : period === 'day' ? "now() - interval '1 day'" : "'-infinity'::timestamptz";
  const r = await pool.query(
    `select distinct on (m.player_id) coalesce(p.name, '?') as name, m.score, m.kos, m.ended_at
     from matches m join players p on p.id = m.player_id
     where m.mode = $1 and m.ended_at is not null and m.ended_at > ${since} and m.score > 0
     order by m.player_id, m.score desc`,
    [mode],
  );
  return r.rows.sort((a, b) => b.score - a.score).slice(0, 10);
}

// devuelve true si atendió el pedido (si no, sigue el resto: archivos estáticos, Vite…)
export function createApi({ pool, env, realtime = null }) {
  return async function api(req, res) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return false;
    const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');
    try {
      // salas en tiempo real (panel del admin): no necesitan la base
      if (url.pathname === '/api/admin/rooms') {
        if (!(await adminUser(req, env))) return send(res, 403, { error: 'sin permiso' }), true;
        return send(res, 200, { rooms: realtime ? realtime.rooms() : [] }), true;
      }
      if (!pool) return send(res, 503, { error: 'sin base de datos' }), true;
      if (url.pathname === '/api/t' && req.method === 'POST') {
        if (limited(ip)) return send(res, 429, { error: 'despacio' }), true;
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'json' }), true; }
        const code = await ingest(pool, req, body);
        res.statusCode = code; res.end();
        return true;
      }
      if (url.pathname === '/api/records' && req.method === 'GET') {
        const mode = MODES.has(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'ffa';
        const period = ['day', 'week', 'all'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'week';
        send(res, 200, await records(pool, mode, period), 'public, max-age=30');
        return true;
      }
      if (url.pathname.startsWith('/api/admin/')) {
        const who = await adminUser(req, env);
        if (!who) return send(res, 403, { error: 'sin permiso' }), true;
        if (url.pathname === '/api/admin/stats') {
          const days = int(url.searchParams.get('days'), 1, 365) ?? 30;
          send(res, 200, { user: who.email, ...(await adminStats(pool, days, env.REPORT_TZ || 'America/Argentina/Buenos_Aires')) });
          return true;
        }
        if (url.pathname === '/api/admin/live') { send(res, 200, await liveNow(pool)); return true; }
      }
      send(res, 404, { error: 'no existe' });
      return true;
    } catch (e) {
      console.error('[api]', url.pathname, e.message);
      send(res, 500, { error: 'error del servidor' });
      return true;
    }
  };
}
