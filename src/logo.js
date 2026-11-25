// Logo "BOUNCY BLOBS": letras de caramelo (cada una de un color, borde grueso y sombra dura) que rebotan
// en cadena aplastándose como un blob. La O de BLOBS es un blob con ojitos.
// Se usa en la pantalla de inicio, en la de carga y en la de "sólo para computadora" (estilos en index.html).
const COLORS = ['#ff4fa3', '#ffd21a', '#2fc8ff', '#7be22a', '#ff7a1a', '#a24dff'];

export function logoHTML() {
  let i = 0;
  const letter = (c) => {
    const k = i++;
    const style = `--i:${k};--c:${COLORS[k % COLORS.length]};--r:${k % 2 ? 4 : -4}deg`;
    if (c === '@') return `<span class="bb-l bb-o" style="${style}"><i></i><i></i></span>`; // la O-blob
    return `<span class="bb-l" style="${style}">${c}</span>`;
  };
  const word = (w) => `<span class="bb-w">${[...w].map(letter).join('')}</span>`;
  return `<span class="bb-logo" role="img" aria-label="Bouncy Blobs">${word('BOUNCY')}${word('BL@BS')}</span>`;
}
