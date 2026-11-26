// API del juego: /api/t (eventos de analíticas), /api/records (récords públicos) y /api/admin/* (panel).
// Se usa igual en desarrollo (montada dentro de Vite, ver vite.config.js) y en producción (server/index.js).
import { adminUser } from './auth.js';
import * as stats from './stats.js';
import { parseUA, refineUA, gpuVendor, clientIP } from './ua.js';
import * as sounds from './sounds.js';
import * as music from './music.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v, max = 60) => (typeof v === 'string' ? v.slice(0, max).replace(/[\u0000-\u001f]/g, '') : null);
const num = (v, min, max) => (v == null || v === '' || !Number.isFinite(+v) ? null : Math.min(max, Math.max(min, +v))); // (sin dato = null, no 0)
const int = (v, min, max) => { const n = num(v, min, max); return n == null ? null : Math.round(n); };
const MODES = new Set(['ffa', 'teams']);
const ARENAS = new Set(['steam', 'cyber', 'crystal', 'tutorial']);

// límite simple por IP (en memoria): un navegador manda ~2 pedidos por minuto; esto frena abusos
const hits = new Map();
function limited(ip, max = 60) {
  const now = Date.now(), k = ip || '?';
  const h = hits.get(k);
  if (!h || now - h.t > 60e3) { hits.set(k, { t: now, n: 1 }); return false; }
  return ++h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 60e3) hits.delete(k); }, 60e3).unref();

function readRaw(req, max = 32768) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readBody = async (req, max) => (await readRaw(req, max)).toString('utf8');

const send = (res, code, obj, cache = 'no-store') => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(obj));
};

// ---------------------------------------------------------------- eventos del juego
const bool = (v) => (v == null ? null : !!v);
// encabezados de ubicación de Cloudflare (sólo llegan si están activados en Cloudflare; vienen con %xx)
const head = (req, k, max = 60) => { const v = req.headers[k]; if (!v) return null; try { return str(decodeURIComponent(String(v)), max); } catch { return str(String(v), max); } };

async function ingest(pool, req, body, env = {}) {
  const pid = body.pid, sid = body.sid;
  if (!UUID.test(pid) || !UUID.test(sid) || !Array.isArray(body.ev)) return 400;
  const country = str(req.headers['cf-ipcountry'], 2);
  const uaText = String(req.headers['user-agent'] || '');
  const ua = parseUA(uaText);
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
          // la IP se guarda (y se borra sola a los IP_RETENTION_DAYS días; con 0 no se guarda): ver server/index.js
          const keepIP = env.IP_RETENTION_DAYS !== '0';
          const gpu = str(d.gpu, 90), vendor = gpuVendor(gpu);
          await c.query(
            `insert into sessions (id, player_id, is_new, country, lang, browser, os, device, gpu, screen, referrer,
               ip, region, city, ua, browser_ver, os_ver, is_bot, gpu_vendor, cores, ram, dpr, win, tz, langs, touch, conn, ver,
               utm_source, utm_medium, utm_campaign)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
               $25, $26, $27, $28, $29, $30, $31) on conflict (id) do nothing`,
            [sid, pid, p.rows[0].is_new, country, str(d.lang, 5), ua.browser, ua.os, ua.device, gpu, str(d.screen, 12), str(d.ref, 80),
              keepIP ? clientIP(req) : null, head(req, 'cf-region'), head(req, 'cf-ipcity'), str(uaText, 300), ua.browserVer, ua.osVer,
              ua.bot || vendor === 'Software', vendor, int(d.cores, 1, 512), num(d.ram, 0, 1024), num(d.dpr, 0.5, 8), str(d.win, 12),
              str(d.tz, 40), str(d.langs, 60), bool(d.touch), str(d.conn, 12), str(d.ver, 24),
              str(d.utm_source, 40), str(d.utm_medium, 40), str(d.utm_campaign, 60)],
          );
          break;
        }
        case 'device': { // client hints (llegan un instante después): versiones exactas de sistema y navegador
          const browsers = Array.isArray(d.browsers)
            ? d.browsers.slice(0, 8).filter((b) => Array.isArray(b)).map((b) => [str(String(b[0]), 40), str(String(b[1]), 20)])
            : null;
          const r = refineUA(ua, { platformVersion: str(d.platformVersion, 20), model: str(d.model, 40), browsers });
          await c.query('update sessions set os_ver = coalesce($2, os_ver), browser_ver = coalesce($3, browser_ver), model = coalesce($4, model) where id = $1',
            [sid, r.osVer ?? null, r.browserVer ?? null, r.model || null]);
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
          // promedios de la sesión: fps_n cuenta los resúmenes y sirve para todos los promedios
          await c.query(`update sessions set
              fps_target = case when $3::real is null then fps_target else (coalesce(fps_target, $3) * fps_n + $3) / (fps_n + 1) end,
              cpu_ms = case when $4::real is null then cpu_ms else (coalesce(cpu_ms, $4) * fps_n + $4) / (fps_n + 1) end,
              gpu_ms = case when $5::real is null then gpu_ms else (coalesce(gpu_ms, $5) * fps_n + $5) / (fps_n + 1) end,
              hz = coalesce($6, hz), win = coalesce(win, $7),
              fps_avg = (coalesce(fps_avg, 0) * fps_n + $2) / (fps_n + 1), fps_n = fps_n + 1 where id = $1`,
          [sid, fps, num(d.target, 0, 500), num(d.cpu, 0, 1000), num(d.gpu, 0, 1000), num(d.hz, 0, 1000), str(d.win, 20)]);
          await c.query('insert into events (session_id, player_id, type, data) select $1, $2, $3, $4 where exists (select 1 from sessions where id = $1)', [sid, pid, 'perf', JSON.stringify({
            fps, p95: num(d.p95, 0, 1000), target: num(d.target, 0, 500), res: num(d.res, 0, 2),
            hz: num(d.hz, 0, 1000), late: num(d.late, 0, 1), cpu: num(d.cpu, 0, 1000), gpu: num(d.gpu, 0, 1000), win: str(d.win, 20),
          })]);
          break;
        }
        case 'net': { // en línea, cada minuto: ping, correcciones, golpes predichos/fantasma… (ver online.js auditReport)
          const data = {};
          for (const [k, v] of Object.entries(d).slice(0, 40)) if (/^[a-zA-Z0-9]{1,12}$/.test(k)) { const n = num(v, -1e7, 1e7); if (n != null) data[k] = n; }
          await c.query('insert into events (session_id, player_id, type, data) select $1, $2, $3, $4 where exists (select 1 from sessions where id = $1)', [sid, pid, 'net', JSON.stringify(data)]);
          // sumas de la sesión (el ping, promediado por tiempo)
          const dur = num(data.dur, 0, 3600) || 0, I = (k) => int(data[k], 0, 1e6) || 0;
          if (dur > 0) {
            await c.query(`update sessions set
                rtt_avg = case when $3::real is null then rtt_avg else (coalesce(rtt_avg, $3) * net_s + $3 * $2) / (net_s + $2) end,
                net_s = net_s + $2, hits = hits + $4, seen = seen + $5, ghost = ghost + $6, me_hit = me_hit + $7,
                me_late = me_late + $8, me_vis = me_vis + $9, ot_vis = ot_vis + $10 where id = $1`,
            [sid, dur, num(data.rtt, 0, 10000), I('hits'), I('seen'), I('ghost'), I('meHit'), I('meLate'), I('meVis'), I('otVis')]);
          }
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

// los nombres que pone el juego si no escribes uno: esos jugadores no entran a ningún ranking
const DEFAULT_NAMES = new Set(['', 'Tú', 'You', 'Você', 'Vos', 'Blob', '?']);
const NAMED = `p.name is not null and btrim(p.name) <> all (array['${[...DEFAULT_NAMES].map((x) => x.replace(/'/g, "''")).join("','")}'])`;

// ---------------------------------------------------------------- ranking (mejor partida de cada jugador en el período)
// me: el id del navegador que pregunta (así se marca su fila y se le dice su puesto, sin mostrar ids ajenos)
async function ranking(pool, mode, period, limit, me) {
  const since = { week: "now() - interval '7 days'", month: "now() - interval '30 days'", all: "'-infinity'::timestamptz" }[period];
  const r = await pool.query(`
    with games as (
      select m.player_id, m.score, m.kos, m.ended_at from matches m join sessions s on s.id = m.session_id join players p on p.id = m.player_id
      where m.mode = $1 and m.ended_at is not null and m.ended_at > ${since} and m.score > 0 and not s.is_bot and ${NAMED}
    ),
    best as (select distinct on (player_id) player_id, score, kos, ended_at from games order by player_id, score desc, ended_at),
    n as (select player_id, count(*) as games from games group by 1),
    ranked as (select b.*, n.games, rank() over (order by b.score desc) as rank from best b join n using (player_id))
    select r.rank, r.player_id = $3 as mine, p.name, upper(substr(md5(r.player_id::text), 1, 4)) as tag, p.country, r.score, r.kos, r.games, r.ended_at as at
    from ranked r join players p on p.id = r.player_id
    where r.rank <= $2 or r.player_id = $3 order by r.rank, r.ended_at limit $2 + 1`, [mode, limit, me || null]);
  // sin nombre propio (el que pone el juego: Tú, You, Você…): "anon" + una marca corta y fija por jugador, así no
  // parecen todos la misma persona (la marca sale de un hash del id: no lo revela)
  const rows = r.rows.map((x) => ({ rank: Number(x.rank), mine: !!x.mine, name: DEFAULT_NAMES.has((x.name || '').trim()) ? null : x.name, anon: DEFAULT_NAMES.has((x.name || '').trim()), tag: x.tag, country: x.country, score: Number(x.score), kos: Number(x.kos) || 0, games: Number(x.games), at: x.at }));
  const list = rows.filter((x) => x.rank <= limit).slice(0, limit);
  const mine = rows.find((x) => x.mine) || null;
  return { list, me: mine ? { rank: mine.rank, score: mine.score } : null };
}

// (versión vieja, la usan las páginas abiertas antes de actualizar)
async function records(pool, mode, period) {
  const since = period === 'week' ? "now() - interval '7 days'" : period === 'day' ? "now() - interval '1 day'" : "'-infinity'::timestamptz";
  const r = await pool.query(
    `select distinct on (m.player_id) coalesce(p.name, '?') as name, m.score, m.kos, m.ended_at
     from matches m join players p on p.id = m.player_id
     where m.mode = $1 and m.ended_at is not null and m.ended_at > ${since} and m.score > 0 and ${NAMED}
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
        const code = await ingest(pool, req, body, env);
        res.statusCode = code; res.end();
        return true;
      }
      // sonidos reemplazados desde el panel (los pide el juego al abrir)
      if (url.pathname === '/api/sfx/sounds.json' && req.method === 'GET') { send(res, 200, await sounds.manifest(pool)); return true; }
      if (url.pathname.startsWith('/api/sfx/') && req.method === 'GET') {
        const f = await sounds.file(pool, url.pathname.slice('/api/sfx/'.length));
        if (!f) return send(res, 404, { error: 'no existe' }), true;
        res.setHeader('Content-Type', f.mime || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // (cada reemplazo tiene otro nombre)
        res.end(f.data);
        return true;
      }
      // música de fondo: la lista (sólo las activas) y cada canción (por partes, como piden los reproductores)
      if (url.pathname === '/api/music' && req.method === 'GET') { send(res, 200, await music.publicList(pool)); return true; }
      if (url.pathname.startsWith('/api/music/') && req.method === 'GET') {
        const f = await music.file(pool, url.pathname.slice('/api/music/'.length));
        if (!f) return send(res, 404, { error: 'no existe' }), true;
        const data = f.data, total = data.length;
        res.setHeader('Content-Type', f.mime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
        if (m && (m[1] || m[2])) {
          let a = m[1] ? Number(m[1]) : total - Number(m[2]), b = m[1] && m[2] ? Number(m[2]) : total - 1;
          a = Math.max(0, a); b = Math.min(total - 1, b);
          if (a > b) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${total}`); res.end(); return true; }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${a}-${b}/${total}`);
          res.setHeader('Content-Length', b - a + 1);
          res.end(data.subarray(a, b + 1));
          return true;
        }
        res.setHeader('Content-Length', total);
        res.end(data);
        return true;
      }
      if (url.pathname === '/api/records' && req.method === 'GET') {
        const mode = MODES.has(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'ffa';
        const sp = url.searchParams;
        if (sp.get('v') === '2') {
          const period = ['week', 'month', 'all'].includes(sp.get('period')) ? sp.get('period') : 'week';
          const me = UUID.test(sp.get('me') || '') ? sp.get('me') : null;
          send(res, 200, await ranking(pool, mode, period, int(sp.get('limit'), 1, 100) ?? 10, me), me ? 'private, max-age=20' : 'public, max-age=30');
          return true;
        }
        const period = ['day', 'week', 'all'].includes(sp.get('period')) ? sp.get('period') : 'week';
        send(res, 200, await records(pool, mode, period), 'public, max-age=30');
        return true;
      }
      if (url.pathname.startsWith('/api/admin/')) {
        const who = await adminUser(req, env);
        if (!who) return send(res, 403, { error: 'sin permiso' }), true;
        // sonidos: subir un reemplazo, volver al original, volumen
        if (url.pathname.startsWith('/api/admin/sounds')) {
          const key = url.searchParams.get('key') || '';
          if (url.pathname === '/api/admin/sounds' && req.method === 'GET') { send(res, 200, await sounds.list(pool)); return true; }
          if (!sounds.SOUND_KEY.test(key)) return send(res, 400, { error: 'clave' }), true;
          if (url.pathname === '/api/admin/sounds/file' && req.method === 'POST') {
            const ext = String(url.searchParams.get('ext') || '').toLowerCase();
            if (!sounds.SOUND_EXT[ext]) return send(res, 400, { error: 'formato' }), true;
            if (Number(req.headers['content-length']) > sounds.SOUND_MAX) return send(res, 413, { error: 'muy grande' }), true;
            let data;
            try { data = await readRaw(req, sounds.SOUND_MAX); } catch { return send(res, 413, { error: 'muy grande' }), true; }
            if (!data.length) return send(res, 400, { error: 'vacío' }), true;
            await sounds.upload(pool, key, ext, data);
            send(res, 200, { ok: true });
            return true;
          }
          if (url.pathname === '/api/admin/sounds/file' && req.method === 'DELETE') { await sounds.remove(pool, key); send(res, 200, { ok: true }); return true; }
          if (url.pathname === '/api/admin/sounds/vol' && req.method === 'POST') {
            const v = num(url.searchParams.get('vol'), 0, 3);
            if (v == null) return send(res, 400, { error: 'volumen' }), true;
            await sounds.setVol(pool, key, Math.round(v * 100) / 100);
            send(res, 200, { ok: true });
            return true;
          }
        }
        // música: subir (una por pedido), renombrar, activar/desactivar, borrar
        if (url.pathname === '/api/admin/music') {
          if (req.method === 'GET') { send(res, 200, await music.adminList(pool)); return true; }
          if (req.method === 'POST') {
            const ext = String(url.searchParams.get('ext') || '').toLowerCase();
            const title = String(url.searchParams.get('title') || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Sin nombre';
            if (!music.MUSIC_EXT[ext]) return send(res, 400, { error: 'formato' }), true;
            if (Number(req.headers['content-length']) > music.MUSIC_MAX) return send(res, 413, { error: 'muy grande' }), true;
            let data;
            try { data = await readRaw(req, music.MUSIC_MAX); } catch { return send(res, 413, { error: 'muy grande' }), true; }
            if (!data.length) return send(res, 400, { error: 'vacío' }), true;
            send(res, 200, { id: await music.upload(pool, title, ext, data) });
            return true;
          }
          const id = int(url.searchParams.get('id'), 1, 1e9);
          if (!id) return send(res, 400, { error: 'id' }), true;
          if (req.method === 'PATCH') {
            const t = url.searchParams.get('title'), en = url.searchParams.get('enabled');
            await music.update(pool, id, { title: t == null ? null : t.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Sin nombre', enabled: en == null ? null : en === '1' });
            send(res, 200, { ok: true });
            return true;
          }
          if (req.method === 'DELETE') { await music.remove(pool, id); send(res, 200, { ok: true }); return true; }
        }
        // panel: una ruta por página; todas aceptan los mismos filtros (ver stats.parseFilters)
        const sp = url.searchParams, f = stats.parseFilters(sp), tz = env.REPORT_TZ || 'America/Argentina/Buenos_Aires';
        const q = sp.get('q') ? String(sp.get('q')).trim().slice(0, 60) || null : null;
        const page = int(sp.get('page'), 0, 10000) ?? 0;
        const routes = {
          '/api/admin/me': async () => ({ user: who.email, ipDays: env.IP_RETENTION_DAYS === '0' ? 0 : Number(env.IP_RETENTION_DAYS) || 90 }),
          '/api/admin/options': () => stats.options(pool, f),
          '/api/admin/overview': () => stats.overview(pool, f, tz),
          '/api/admin/players': () => stats.players(pool, f, { q, sort: sp.get('sort') || 'last', page }, tz),
          '/api/admin/sessions': () => stats.sessions(pool, f, { q, page }, tz),
          '/api/admin/perf': () => stats.perf(pool, f),
          '/api/admin/net': () => stats.net(pool, f, tz),
          '/api/admin/audience': () => stats.audience(pool, f),
          '/api/admin/live': () => stats.liveNow(pool),
          '/api/admin/player': async () => {
            const id = sp.get('id');
            if (!UUID.test(id || '')) return null;
            return stats.player(pool, id, tz);
          },
        };
        const fn = routes[url.pathname];
        if (fn) {
          const out = await fn();
          if (out == null) send(res, 404, { error: 'no existe' }); else send(res, 200, out);
          return true;
        }
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
