// Panel de analíticas (admin.html): varias páginas con su dirección (#/jugadores?country=AR…), una fila de filtros
// que vale para todas y datos de /api/admin/*. Las páginas están en pages.js; las piezas de dibujo, en ui.js.
import { $, el, fmt, country, deviceName } from './ui.js';
import { PAGES } from './pages.js';

const app = $('#app'), nav = $('#nav'), filtersEl = $('#filters');
if (import.meta.env?.DEV) $('#play').href = '/';

// ---------------------------------------------------------------- direcciones
// filtros: valen en todas las páginas y viajan en la dirección (así se puede compartir o volver atrás)
export const FILTER_KEYS = ['days', 'country', 'os', 'browser', 'device', 'gpu', 'ver', 'kind', 'bots'];
const TABS = [
  ['resumen', 'Resumen'], ['jugadores', 'Jugadores'], ['sesiones', 'Visitas'], ['rendimiento', 'Rendimiento'],
  ['red', 'Red en línea'], ['audiencia', 'Audiencia'], ['salas', 'Salas en vivo'],
];

export function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const [page = 'resumen', arg = null] = path.split('/');
  return { page: PAGES[page] ? page : 'resumen', arg: arg ? decodeURIComponent(arg) : null, params: new URLSearchParams(query) };
}

// arma una dirección: la página, y los filtros de ahora más lo que se cambie (null borra)
export function href(page, arg = null, change = {}, keepPageParams = false) {
  const cur = route().params, p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (cur.get(k)) p.set(k, cur.get(k));
  if (keepPageParams) for (const [k, v] of cur) if (!FILTER_KEYS.includes(k)) p.set(k, v);
  for (const [k, v] of Object.entries(change)) { if (v == null || v === '') p.delete(k); else p.set(k, String(v)); }
  const q = p.toString();
  return `#/${page}${arg ? '/' + encodeURIComponent(arg) : ''}${q ? '?' + q : ''}`;
}
export const go = (page, arg = null, change = {}, keep = false) => { location.hash = href(page, arg, change, keep); };
export const setParams = (change) => { const r = route(); go(r.page, r.arg, change, true); };

// ---------------------------------------------------------------- pedir datos (con permiso de Cloudflare Access)
export async function api(path, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, v);
  const r = await fetch(`/api/admin/${path}?${p}`, { cache: 'no-store' });
  if (r.status === 403) throw new Error('Sin permiso. El panel sólo se ve entrando por admin.bouncyblobs.com (Cloudflare Access).');
  if (r.status === 503) throw new Error('El servidor no tiene base de datos conectada.');
  if (r.status === 404) throw new Error('No existe.');
  if (!r.ok) throw new Error(`Error ${r.status} del servidor.`);
  return r.json();
}
export function filterParams() {
  const p = route().params, out = {};
  for (const k of FILTER_KEYS) if (p.get(k)) out[k] = p.get(k);
  return out;
}

// ---------------------------------------------------------------- fila de filtros
const PERIODS = [['1', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['all', 'Todo']];
const SELECTS = [
  ['country', 'País', 'Todos los países', (k) => country(k)],
  ['os', 'Sistema', 'Todos los sistemas', (k) => k],
  ['browser', 'Navegador', 'Todos los navegadores', (k) => k],
  ['device', 'Dispositivo', 'Todos', deviceName],
  ['gpu', 'Placa', 'Todas las placas', (k) => k],
  ['ver', 'Versión', 'Todas las versiones', (k) => (k === 'dev' ? 'desarrollo' : k)],
];
let optCache = { key: null, data: null };

async function renderFilters(show) {
  filtersEl.hidden = !show;
  if (!show) return;
  const p = route().params, days = p.get('days') || '30';
  const key = `${days}|${p.get('bots') || ''}`;
  if (optCache.key !== key) {
    try { optCache = { key, data: await api('options', { days, bots: p.get('bots') }) }; } catch { optCache = { key, data: {} }; }
  }
  const O = optCache.data || {};
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Período' }, PERIODS.map(([v, t]) =>
    el('button', { type: 'button', class: days === v ? 'on' : null, 'aria-pressed': days === v ? 'true' : 'false', onclick: () => setParams({ days: v === '30' ? null : v, page: null }) }, t)));
  const selects = SELECTS.map(([k, label, all, name]) => {
    const cur = p.get(k) || '';
    const list = [...(O[k] || [])];
    if (cur && !list.some((o) => o.k === cur)) list.unshift({ k: cur, v: 0 });
    const s = el('select', { 'aria-label': label, class: cur ? 'on' : null, onchange: (e) => setParams({ [k]: e.target.value || null, page: null }) },
      el('option', { value: '' }, all), list.map((o) => el('option', { value: o.k, selected: o.k === cur }, `${name(o.k)}${o.v ? ` (${fmt(o.v)})` : ''}`)));
    return el('label', { class: 'fsel' }, el('span', {}, label), s);
  });
  const kind = p.get('kind') || '';
  const kindSel = el('label', { class: 'fsel' }, el('span', {}, 'Visitantes'),
    el('select', { 'aria-label': 'Visitantes', class: kind ? 'on' : null, onchange: (e) => setParams({ kind: e.target.value || null, page: null }) },
      el('option', { value: '' }, 'Todos'), el('option', { value: 'new', selected: kind === 'new' }, 'Sólo nuevos'), el('option', { value: 'ret', selected: kind === 'ret' }, 'Sólo los que vuelven')));
  const bots = el('label', { class: 'chk', title: 'Robots y navegadores automáticos (buscadores, vistas previas de links…). No cuentan salvo que los incluyas.' },
    el('input', { type: 'checkbox', checked: p.get('bots') === '1', onchange: (e) => setParams({ bots: e.target.checked ? '1' : null, page: null }) }),
    `Incluir robots${O.bots ? ` (${fmt(O.bots)})` : ''}`);
  const any = FILTER_KEYS.some((k) => k !== 'days' && p.get(k));
  const clear = any ? el('button', { type: 'button', class: 'clear', onclick: () => { const ch = {}; for (const k of FILTER_KEYS) if (k !== 'days') ch[k] = null; setParams({ ...ch, page: null }); } }, 'Limpiar filtros') : null;
  filtersEl.replaceChildren(seg, ...selects, kindSel, bots, clear);
}

// ---------------------------------------------------------------- dibujar la página
let seq = 0, cleanup = null;
async function render() {
  const r = route(), my = ++seq;
  const def = PAGES[r.page];
  for (const a of nav.querySelectorAll('a')) a.classList.toggle('on', a.dataset.p === (def.tab || r.page));
  cleanup?.(); cleanup = null;
  renderFilters(!def.noFilters);
  app.classList.add('loading');
  try {
    const out = await def.render({ arg: r.arg, params: r.params, filters: filterParams(), api, href, go, setParams, isCurrent: () => my === seq });
    if (my !== seq) return; // ya se pidió otra página
    app.replaceChildren(...[].concat(out.nodes || out));
    out.after?.();
    cleanup = out.cleanup || null;
    document.title = `${def.title || 'Panel'} · Bouncy Blobs`;
  } catch (e) {
    if (my !== seq) return;
    app.replaceChildren(el('div', { class: 'err' }, e.message || String(e)));
  } finally {
    if (my === seq) app.classList.remove('loading');
  }
}

nav.replaceChildren(...TABS.map(([p, t]) => el('a', { href: `#/${p}`, 'data-p': p, onclick: (e) => { e.preventDefault(); go(p, null, { page: null, q: null, sort: null }); } }, t)));
addEventListener('hashchange', () => { render(); scrollTo({ top: 0 }); });
render();

// arriba: quién entró y cuántos hay jugando ahora
api('me').then((m) => { $('#who').textContent = m.user || ''; }).catch(() => {});
const live = () => api('live').then((l) => { $('#live').textContent = `${fmt(l.online)} en línea · ${fmt(l.playing)} jugando`; }).catch(() => {});
live();
setInterval(live, 15000);
