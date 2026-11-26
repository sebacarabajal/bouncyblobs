// Piezas del panel: crear elementos, formatos, tarjetas, tablas y gráficos (SVG propio, sin librerías).
// Los textos que vienen de la base (nombres, GPUs, ciudades…) se insertan siempre como texto, nunca como HTML.

export const $ = (s, root = document) => root.querySelector(s);

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
export const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

// ---------------------------------------------------------------- formatos
const nf = new Intl.NumberFormat('es-AR'), nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
export const fmt = (v) => (v == null || Number.isNaN(v) ? '—' : nf.format(Math.round(v)));
export const fmt1 = (v) => (v == null || Number.isNaN(v) ? '—' : nf1.format(v));
export const pct = (v) => (v == null || Number.isNaN(v) ? '—' : `${Math.round(v * 100)} %`);
export const ms = (v) => (v == null ? '—' : `${fmt(v)} ms`);
export function dur(s) {
  if (s == null) return '—';
  s = Math.round(s);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}
export function ago(sec) {
  if (sec == null) return '—';
  if (sec < 90) return 'recién';
  if (sec < 3600) return `hace ${Math.round(sec / 60)} min`;
  if (sec < 86400) return `hace ${Math.round(sec / 3600)} h`;
  return `hace ${Math.round(sec / 86400)} días`;
}
export const dayLabel = (d) => { const [, m, dd] = d.split('-'); return `${+dd}/${+m}`; };
export const shortId = (id) => String(id || '').slice(0, 8);

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['es'], { type: 'region' }); } catch { /* navegador viejo */ }
export function flag(cc) {
  if (!cc || !/^[A-Z]{2}$/.test(cc) || cc === 'XX' || cc === 'T1') return '🏳️';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
export function countryName(cc) {
  if (!cc || cc === '—') return 'Sin dato';
  if (cc === 'T1') return 'Red Tor';
  try { return regionNames?.of(cc) || cc; } catch { return cc; }
}
export const country = (cc) => (cc && cc !== '—' ? `${flag(cc)} ${countryName(cc)}` : 'Sin dato');
// "ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3080/PCIe/SSE2, OpenGL 4.5.0)" → "NVIDIA GeForce RTX 3080"
export function gpuName(g) {
  if (!g) return '—';
  const s = String(g).replace(/^ANGLE \((.*)\)$/, '$1').replace(/\(0x[0-9a-f]+\)/gi, '').replace(/Direct3D\d+.*$/i, '').replace(/, D3D\d+.*$/i, '')
    .replace(/\/PCIe\/SSE2/, '').replace(/, OpenGL [\d.]+.*$/, '').replace(/ANGLE Metal Renderer: /, '').replace(/, Unspecified Version/, '');
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1 && parts[1].toLowerCase().startsWith(parts[0].toLowerCase().split(' ')[0])) parts.shift(); // marca repetida
  return parts.join(', ').replace(/\s+/g, ' ').trim() || '—';
}
export const osName = (os, ver) => (os ? `${os}${ver ? ' ' + ver : ''}` : '—');
export const deviceName = (d) => ({ desktop: 'Compu', mobile: 'Celular', tablet: 'Tablet' }[d] || d || '—');

// ---------------------------------------------------------------- tarjetas, figuras, tablas
export const card = (title, sub, cls = '', ...body) => el('section', { class: `card ${cls}` }, title ? el('h2', {}, title) : null, sub ? el('p', { class: 'sub' }, sub) : null, ...body);
export const empty = (txt = 'Todavía no hay datos para estos filtros.') => el('div', { class: 'empty' }, txt);

// stat tile: etiqueta, valor y (opcional) cambio contra el período anterior. up: true si subir es bueno
export function tile(label, value, { prev = null, cur = null, up = true, hint = null, note = null } = {}) {
  let d = null;
  if (cur != null && prev != null && prev > 0) {
    const ch = (cur - prev) / prev, good = ch === 0 ? null : (ch > 0) === up;
    d = el('div', { class: `d ${good == null ? '' : good ? 'good' : 'bad'}` }, el('b', {}, `${ch >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(ch * 100))} %`), ' vs. período anterior');
  } else if (note) d = el('div', { class: 'd' }, note);
  return el('div', { class: 'kpi', title: hint }, el('div', { class: 'l' }, label), el('div', { class: 'v' }, value), d);
}

// tabla: cols [{ h, num?, v: (row) => texto|nodo, cls? }] · onRow(row) hace la fila clicable
export function table(cols, list, { onRow = null, cls = '' } = {}) {
  if (!list.length) return empty();
  return el('div', { class: `scroll ${cls}` }, el('table', {},
    el('thead', {}, el('tr', {}, cols.map((c) => el('th', { class: c.num ? 'num' : null, title: c.title || null }, c.h)))),
    el('tbody', {}, list.map((r) => {
      const tr = el('tr', { class: onRow ? 'link' : null, tabindex: onRow ? 0 : null }, cols.map((c) => el('td', { class: [c.num ? 'num' : '', c.cls || ''].join(' ').trim() || null }, c.v(r))));
      if (onRow) { tr.addEventListener('click', () => onRow(r)); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRow(r); }); }
      return tr;
    }))));
}
export const tableView = (cols, list) => el('details', {}, el('summary', {}, 'Ver como tabla'), table(cols, list));

export function pager(total, page, size, go) {
  const pages = Math.max(1, Math.ceil(total / size));
  const prev = el('button', { type: 'button', disabled: page <= 0, onclick: () => go(page - 1) }, '← Anteriores');
  const next = el('button', { type: 'button', disabled: page >= pages - 1, onclick: () => go(page + 1) }, 'Siguientes →');
  return el('div', { class: 'pager' }, prev, el('span', {}, `Página ${page + 1} de ${pages} · ${fmt(total)} en total`), next);
}

// ---------------------------------------------------------------- tooltip (valor primero, nombre después; clave = rayita del color)
const tip = () => document.getElementById('tip');
export function showTip(e, title, rowsArr) {
  const t = tip();
  t.replaceChildren(el('div', { class: 't' }, title), ...rowsArr.map((r) => el('div', { class: 'r' }, r.color ? el('i', { style: `background:${r.color}` }) : null, el('b', {}, r.value), el('span', {}, r.name))));
  t.style.display = 'block';
  const b = e.currentTarget?.getBoundingClientRect?.() || e.target?.getBoundingClientRect?.();
  const x = e.clientX || (b ? b.left + b.width / 2 : 0), y = e.clientY || (b ? b.top : 0);
  t.style.left = `${Math.min(innerWidth - t.offsetWidth - 8, Math.max(8, x + 14))}px`;
  t.style.top = `${Math.max(8, y - t.offsetHeight - 12)}px`;
}
export const hideTip = () => { const t = tip(); if (t) t.style.display = 'none'; };

export const legend = (items) => el('div', { class: 'legend' }, items.map((it) => el('span', {}, el('i', { style: `background:${it.color}` }), it.name)));

// ---------------------------------------------------------------- columnas (simples o apiladas)
// series: [{ name, color (var css), values }] · labels: texto del eje x · tipTitle(i)
function niceStep(v) {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9))), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
export function columns(host, { labels, series, tipTitle = (i) => labels[i], every = 1, height = 200, valueFmt = fmt, tickFmt = fmt }) {
  const draw = () => {
    const W = Math.max(280, host.clientWidth), H = height, padL = 40, padB = 22, padT = 8;
    const nCols = labels.length;
    const totals = labels.map((_, i) => series.reduce((s, se) => s + (se.values[i] || 0), 0));
    const max = Math.max(1e-9, ...totals);
    const step = niceStep(max / 4), top = Math.max(step, Math.ceil(max / step) * step);
    const y = (v) => padT + (H - padT - padB) * (1 - v / top);
    const cw = (W - padL) / Math.max(1, nCols), bw = Math.max(2, Math.min(24, cw * 0.7));
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg.append(svgEl('line', { class: v === 0 ? 'axis' : 'grid', x1: padL, x2: W, y1: y(v), y2: y(v) }));
      const tx = svgEl('text', { x: padL - 6, y: y(v) + 3.5, 'text-anchor': 'end' }); tx.textContent = tickFmt(v); svg.append(tx);
    }
    labels.forEach((lab, i) => {
      const cx = padL + cw * i + cw / 2;
      const g = svgEl('g', { class: 'col', tabindex: 0 });
      let acc = 0;
      const segs = series.map((se) => ({ se, v: se.values[i] || 0 })).filter((s) => s.v > 0);
      segs.forEach((s, k) => {
        const y0 = y(acc), y1 = y(acc + s.v), isTop = k === segs.length - 1, gap = k > 0 ? 2 : 0;
        const hgt = Math.max(0, y0 - y1 - gap), r = isTop ? Math.min(4, hgt, bw / 2) : 0, x0 = cx - bw / 2;
        const d = `M${x0},${y1 + hgt} V${y1 + r} Q${x0},${y1} ${x0 + r},${y1} H${x0 + bw - r} Q${x0 + bw},${y1} ${x0 + bw},${y1 + r} V${y1 + hgt} Z`;
        g.append(svgEl('path', { class: 'bar', d, fill: s.se.color }));
        acc += s.v;
      });
      g.append(svgEl('rect', { class: 'hit', x: padL + cw * i, y: padT, width: cw, height: H - padT - padB }));
      const rowsFor = () => [
        ...series.map((se) => ({ color: series.length > 1 ? se.color : null, value: valueFmt(se.values[i] || 0), name: se.name })),
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
  return host;
}

// barras horizontales (ranking o medidores): [{ k (texto o nodo), v, sub?, color?, title? }] · max: tope de la escala
export function hbars(list, { color = 'var(--series-1)', max = null, valueFmt = fmt, subFmt = null, onPick = null } = {}) {
  if (!list.length) return empty();
  const m = max ?? Math.max(1e-9, ...list.map((x) => x.v || 0));
  return el('div', { class: 'hb' }, list.flatMap((x) => {
    const k = el('span', { class: `k ${onPick ? 'pick' : ''}`, title: x.title || (typeof x.k === 'string' ? x.k : null) }, x.k);
    if (onPick) { k.tabIndex = 0; k.addEventListener('click', () => onPick(x)); k.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPick(x); }); }
    return [
      k,
      el('span', { class: 'track' }, el('i', { style: `width:${Math.max(0, Math.min(1, (x.v || 0) / m)) * 100}%;background:${x.color || color}` })),
      el('span', { class: 'n' }, valueFmt(x.v), subFmt ? el('small', {}, subFmt(x)) : null),
    ];
  }));
}

// lista de datos "nombre: valor" (ficha del jugador)
export const facts = (pairs) => el('dl', { class: 'facts' }, pairs.filter((p) => p && p[1] != null && p[1] !== '').flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
export const badge = (txt, kind = '') => el('span', { class: `badge ${kind}` }, txt);
