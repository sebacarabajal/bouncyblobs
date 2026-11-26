// Música de fondo (tabla music): la sube el admin (página Sonidos) y el juego la toca de fondo.
//   público:  GET /api/music?v=2 → { base, list: [{ id, title, file, vol }] } (sólo las activas)
//             GET /api/music/<file> (admite pedidos por partes)
//   admin:    lista, subir, renombrar, activar/desactivar, volumen y borrar (ver api.js)
// Volumen en el juego = base (el general, lo elige el admin) × vol de la canción × el que elige cada jugador.
export const MUSIC_EXT = { mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm', opus: 'audio/ogg' };
export const MUSIC_MAX = 20 * 1024 * 1024; // 20 MB por canción (un mp3 de 4 minutos pesa ~5–9 MB)

const fileName = (r) => `m${r.id}-${Math.floor(new Date(r.created_at).getTime() / 1000)}.${r.ext}`;

export async function getBase(pool) {
  const { rows } = await pool.query("select value from settings where key = 'musicBase'");
  const v = Number(rows[0]?.value);
  return Number.isFinite(v) ? v : 0.4;
}
export async function setBase(pool, v) {
  await pool.query("insert into settings (key, value) values ('musicBase', $1) on conflict (key) do update set value = $1", [JSON.stringify(v)]);
}

export async function publicList(pool) {
  const { rows } = await pool.query('select id, title, ext, vol, created_at from music where enabled order by id');
  return { base: await getBase(pool), list: rows.map((r) => ({ id: r.id, title: r.title, file: fileName(r), vol: Number(r.vol) })) };
}

export async function adminList(pool) {
  const { rows } = await pool.query('select id, title, ext, size, enabled, vol, created_at from music order by id');
  return { base: await getBase(pool), list: rows.map((r) => ({ id: r.id, title: r.title, ext: r.ext, size: r.size, enabled: r.enabled, vol: Number(r.vol), created: r.created_at, file: fileName(r) })) };
}

export async function file(pool, name) {
  const m = /^m(\d+)-\d+\.([a-z0-9]{2,5})$/.exec(name || '');
  if (!m) return null;
  const { rows } = await pool.query('select data, mime from music where id = $1 and ext = $2', [Number(m[1]), m[2]]);
  return rows[0] || null;
}

export async function upload(pool, title, ext, data) {
  const { rows } = await pool.query('insert into music (title, ext, mime, data, size) values ($1, $2, $3, $4, $5) returning id',
    [title, ext, MUSIC_EXT[ext], data, data.length]);
  return rows[0].id;
}

export async function update(pool, id, { title, enabled, vol }) {
  if (title != null) await pool.query('update music set title = $2 where id = $1', [id, title]);
  if (enabled != null) await pool.query('update music set enabled = $2 where id = $1', [id, enabled]);
  if (vol != null) await pool.query('update music set vol = $2 where id = $1', [id, vol]);
}

export async function remove(pool, id) { await pool.query('delete from music where id = $1', [id]); }
