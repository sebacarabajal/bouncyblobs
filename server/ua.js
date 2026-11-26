// Qué navegador, sistema y equipo usa cada visitante (para el panel del admin).
// Sale del "user agent" que manda el navegador y, si existe, de los "client hints" (navigator.userAgentData),
// que dicen más: por ejemplo Windows 10 y 11 tienen el mismo user agent, pero los hints los distinguen.

const ver = (s) => (s ? String(s).split('.').slice(0, 2).join('.').replace(/\.0$/, '') : null);

export function parseUA(ua = '') {
  ua = String(ua);
  let browser = 'Otro', browserVer = null;
  const m = (re) => ua.match(re);
  let r;
  if ((r = m(/Edg(?:e|A|iOS)?\/([\d.]+)/))) { browser = 'Edge'; browserVer = r[1]; }
  else if ((r = m(/OPR\/([\d.]+)/))) { browser = 'Opera'; browserVer = r[1]; }
  else if ((r = m(/SamsungBrowser\/([\d.]+)/))) { browser = 'Samsung Internet'; browserVer = r[1]; }
  else if ((r = m(/(?:Firefox|FxiOS)\/([\d.]+)/))) { browser = 'Firefox'; browserVer = r[1]; }
  else if ((r = m(/(?:Chrome|CriOS)\/([\d.]+)/))) { browser = 'Chrome'; browserVer = r[1]; }
  else if (/Safari\//.test(ua) && (r = m(/Version\/([\d.]+)/))) { browser = 'Safari'; browserVer = r[1]; }

  let os = 'Otro', osVer = null;
  if ((r = m(/Windows NT ([\d.]+)/))) { os = 'Windows'; osVer = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' }[r[1]] || r[1]; }
  else if ((r = m(/(?:iPhone|iPad|iPod).*? OS ([\d_]+)/))) { os = 'iOS'; osVer = ver(r[1].replace(/_/g, '.')); }
  else if ((r = m(/Android ([\d.]+)/))) { os = 'Android'; osVer = ver(r[1]); }
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if ((r = m(/Mac OS X ([\d_.]+)/))) { os = 'macOS'; osVer = ver(r[1].replace(/_/g, '.')); if (osVer === '10.15') osVer = null; } // (los navegadores dicen 10.15 siempre)
  else if (/Linux/.test(ua)) os = 'Linux';

  const tablet = /iPad|Tablet|Android(?!.*Mobile)/.test(ua);
  const device = tablet ? 'tablet' : /Mobi|iPhone|iPod|Android/.test(ua) ? 'mobile' : 'desktop';
  const bot = /bot\b|crawl|spider|slurp|Headless|Lighthouse|PageSpeed|facebookexternalhit|preview/i.test(ua);
  return { browser, browserVer: browserVer ? browserVer.split('.')[0] : null, os, osVer, device, bot };
}

// los client hints: { platform, platformVersion, model, browsers: [[marca, versión]…] } → versiones más precisas
export function refineUA(base, hints = {}) {
  const out = {};
  const pv = String(hints.platformVersion || '');
  const major = parseInt(pv, 10);
  if (base.os === 'Windows' && Number.isFinite(major)) out.osVer = major >= 13 ? '11' : major > 0 ? '10' : base.osVer;
  else if (base.os === 'macOS' && Number.isFinite(major) && major > 10) out.osVer = ver(pv);
  else if ((base.os === 'Android' || base.os === 'ChromeOS') && pv) out.osVer = ver(pv);
  if (Array.isArray(hints.browsers)) {
    const name = { Chrome: 'Google Chrome', Edge: 'Microsoft Edge', Opera: 'Opera' }[base.browser];
    const hit = name && hints.browsers.find((b) => Array.isArray(b) && b[0] === name);
    if (hit) out.browserVer = String(hit[1]).split('.')[0];
  }
  if (hints.model) out.model = String(hints.model).slice(0, 40);
  return out;
}

// marca de la placa de video (del texto que da WebGL)
export function gpuVendor(gpu) {
  if (!gpu) return null;
  const g = String(gpu);
  if (/swiftshader|llvmpipe|softpipe|microsoft basic render/i.test(g)) return 'Software';
  if (/nvidia|geforce|quadro|rtx|gtx/i.test(g)) return 'NVIDIA';
  if (/amd|radeon|ati /i.test(g)) return 'AMD';
  if (/intel|iris|uhd graphics|hd graphics/i.test(g)) return 'Intel';
  if (/apple/i.test(g)) return 'Apple';
  if (/adreno|qualcomm/i.test(g)) return 'Qualcomm';
  if (/mali|arm/i.test(g)) return 'ARM';
  return 'Otra';
}

// la IP real del visitante (Cloudflare la pasa en CF-Connecting-IP; Caddy sólo acepta tráfico de Cloudflare)
export function clientIP(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).slice(0, 45);
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim().slice(0, 45);
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 45) || null;
}
