// Arranque: en celulares y tablets (pantalla táctil sin mouse) el juego no da (anda a ~8 fps en un
// iPhone 13 Pro), así que primero se muestra un cartel de "solo para compu" y el juego ni se descarga.
// Igual hay un botón para entrar (y ?touch en la dirección lo saltea, para probar).
import { t, translate } from './i18n.js';
import { logoHTML } from './logo.js';

const mm = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
const params = new URLSearchParams(location.search);
const handheld = mm('(pointer: coarse)') && !mm('(any-pointer: fine)');

for (const el of document.querySelectorAll('.ld-title')) el.innerHTML = logoHTML(); // logo de la pantalla de carga
translate(); // textos fijos de la página (ayuda, pantalla de carga…) en el idioma del navegador
const start = () => import('./main.js');

if (handheld && !params.has('touch')) {
  document.getElementById('loading')?.classList.remove('show');
  const el = document.createElement('div');
  el.id = 'desktop-only';
  el.innerHTML = `
    <div class="do-blob"><i></i><b></b><b></b></div>
    <b class="do-title">${logoHTML()}</b>
    <p class="do-msg">${t('do.msg')}</p>
    <p class="do-sub">${t('do.sub')}</p>
    <button class="do-anyway">${t('do.anyway')}</button>`;
  document.body.appendChild(el);
  el.querySelector('.do-anyway').addEventListener('click', () => {
    el.remove();
    document.getElementById('loading')?.classList.add('show');
    start();
  }, { once: true });
} else {
  start();
}
