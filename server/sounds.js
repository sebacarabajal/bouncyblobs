// Sonidos reemplazados desde el panel del admin (tabla sounds). El juego pide /api/sfx/sounds.json al abrir
// ({ files: { hit: 'hit-1764190000.mp3' }, vol: { hit: 0.8 } }) y después cada archivo en /api/sfx/<archivo>.
// El número en el nombre cambia con cada reemplazo: así el navegador nunca se queda con uno viejo.

export const SOUND_EXT = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', webm: 'audio/webm' };
export const SOUND_KEY = /^[a-zA-Z]{2,20}$/;
export const SOUND_MAX = 3 * 1024 * 1024; // 3 MB por archivo (un efecto de sonido pesa 20–200 KB)

const fileName = (r) => `${r.key}-${Math.floor(new Date(r.updated_at).getTime() / 1000)}.${r.ext}`;

export async function manifest(pool) {
  const { rows } = await pool.query('select key, ext, vol, updated_at from sounds');
  const out = { files: {}, vol: {} };
  for (const r of rows) {
    if (r.ext) out.files[r.key] = fileName(r);
    if (r.vol != null && Math.abs(r.vol - 1) > 1e-3) out.vol[r.key] = Number(r.vol);
  }
  return out;
}

// /api/sfx/<clave>-<versión>.<ext> → { data, mime } (o null)
export async function file(pool, name) {
  const m = /^([a-zA-Z]{2,20})-\d+\.([a-z0-9]{2,5})$/.exec(name || '');
  if (!m) return null;
  const { rows } = await pool.query('select data, mime from sounds where key = $1 and ext = $2 and data is not null', [m[1], m[2]]);
  return rows[0] || null;
}

// para el panel: qué tiene cada sonido reemplazado
export async function list(pool) {
  const { rows } = await pool.query(`select key, ext, vol, updated_at, octet_length(data) as size from sounds order by key`);
  return rows.map((r) => ({ key: r.key, ext: r.ext, file: r.ext ? fileName(r) : null, size: r.size == null ? null : Number(r.size), vol: r.vol == null ? 1 : Number(r.vol), updated: r.updated_at }));
}

export async function upload(pool, key, ext, data) {
  await pool.query(`insert into sounds (key, ext, mime, data, updated_at) values ($1, $2, $3, $4, now())
    on conflict (key) do update set ext = $2, mime = $3, data = $4, updated_at = now()`, [key, ext, SOUND_EXT[ext], data]);
}

export async function remove(pool, key) {
  await pool.query('update sounds set ext = null, mime = null, data = null, updated_at = now() where key = $1', [key]);
  await pool.query('delete from sounds where key = $1 and data is null and (vol is null or abs(vol - 1) < 0.001)', [key]);
}

export async function setVol(pool, key, vol) {
  await pool.query(`insert into sounds (key, vol, updated_at) values ($1, $2, now())
    on conflict (key) do update set vol = $2`, [key, vol]); // (sin cambiar la versión del archivo)
  await pool.query('delete from sounds where key = $1 and data is null and (vol is null or abs(vol - 1) < 0.001)', [key]);
}
