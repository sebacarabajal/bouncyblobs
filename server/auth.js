// ¿Quién puede ver el panel de analíticas?
// En producción, el subdominio admin.* está detrás de Cloudflare Access (Zero Trust): Cloudflare pide el
// email, manda un código, y recién ahí deja pasar el pedido con un "pase" firmado en el encabezado
// Cf-Access-Jwt-Assertion. Acá se verifica ese pase con las claves públicas de Cloudflare: aunque alguien
// llegara al servidor sin pasar por Cloudflare, sin un pase válido no ve nada.
// En desarrollo (ADMIN_DEV=1) alcanza con entrar desde esta misma PC.
import crypto from 'node:crypto';

let certs = { at: 0, keys: new Map() };

async function getKey(team, kid) {
  if (!certs.keys.has(kid) || Date.now() - certs.at > 3600e3) {
    const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
    if (!r.ok) throw new Error('no se pudieron leer las claves de Cloudflare Access');
    const { keys = [] } = await r.json();
    certs = { at: Date.now(), keys: new Map(keys.map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })])) };
  }
  return certs.keys.get(kid);
}

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export async function verifyAccess(token, env) {
  const team = env.CF_ACCESS_TEAM_DOMAIN; // ej. "tuequipo.cloudflareaccess.com"
  const aud = env.CF_ACCESS_AUD; // "Application Audience (AUD) Tag" de la app en Cloudflare
  if (!token || !team || !aud) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let head, body;
  try { head = JSON.parse(b64(parts[0])); body = JSON.parse(b64(parts[1])); } catch { return null; }
  if (head.alg !== 'RS256') return null;
  const key = await getKey(team, head.kid).catch(() => null);
  if (!key) return null;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]));
  if (!ok) return null;
  const now = Date.now() / 1000;
  const auds = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!auds.includes(aud) || body.iss !== `https://${team}` || !(body.exp > now) || (body.nbf && body.nbf > now + 60)) return null;
  // lista opcional de emails permitidos (además de la regla de Cloudflare)
  const allow = (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(String(body.email || '').toLowerCase())) return null;
  return { email: body.email };
}

const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

export async function adminUser(req, env) {
  if (env.ADMIN_DEV === '1' && isLoopback(req) && !req.headers['cf-connecting-ip']) return { email: 'dev@localhost' };
  const host = String(req.headers.host || '');
  if (!/^admin\./.test(host)) return null; // el panel sólo existe en el subdominio admin.*
  return verifyAccess(req.headers['cf-access-jwt-assertion'], env);
}
