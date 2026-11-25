// Admin → 🔊 Sonidos: cada sonido del juego con ▶ Probar, 📂 Reemplazar (archivo de audio),
// ↺ Volver al original, volumen y 📋 Copiar prompt (para generarlo con una IA de efectos de sonido).
// En modo desarrollo (npm run dev) los cambios se guardan en public/sfx/ (ver vite.config.js) y quedan en el juego.
import { sfx, SOUNDS, sfxVol, sfxFiles, unlockAudio, setSoundOverride, clearSoundOverride } from './sfx.js';

// un valor de ejemplo para probar los que cambian según la situación (fuerza del golpe, distancia…)
const SAMPLE = { hit: 18, land: 8, bump: 14 };

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* http por la red de la casa: sin clipboard */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* nada */ }
  ta.remove();
  return ok;
}

export function buildSoundFolder(gui, toast) {
  const root = gui.addFolder('🔊 Sonidos');
  root.close();
  const info = document.createElement('div');
  info.className = 'sfx-help';
  info.innerHTML = 'Cada sonido: <b>▶ Probar</b>, <b>📋 Copiar prompt</b> (pégalo en una IA de efectos de sonido, por ejemplo ElevenLabs → Sound Effects, y descarga el MP3), '
    + 'y <b>📂 Reemplazar</b> para elegir ese archivo. Se guarda en <code>public/sfx/</code>.';
  info.style.cssText = 'padding:6px 8px;font-size:11px;line-height:1.45;opacity:.85;white-space:normal';
  root.$children.prepend(info);

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm';
  picker.style.display = 'none';
  document.body.appendChild(picker);

  for (const s of SOUNDS) {
    const f = root.addFolder('');
    const title = () => f.title(`${sfxFiles[s.key] ? '🎵' : '🎹'} ${s.name}`);
    title();
    f.close();
    const when = document.createElement('div');
    when.textContent = `Suena cuando ${s.when}.`;
    when.style.cssText = 'padding:4px 8px;font-size:11px;opacity:.75;white-space:normal';
    f.$children.prepend(when);

    const st = { vol: sfxVol[s.key] ?? 1 };
    const actions = {
      play() { unlockAudio(); sfx[s.key](SAMPLE[s.key] ?? 1); },
      async copy() { toast((await copyText(s.prompt)) ? '📋 Prompt copiado' : 'No se pudo copiar'); },
      replace() {
        picker.value = '';
        picker.onchange = async () => {
          const file = picker.files[0];
          if (!file) return;
          unlockAudio();
          const ext = (file.name.split('.').pop() || '').toLowerCase();
          const ab = await file.arrayBuffer();
          await setSoundOverride(s.key, ab.slice(0), `${s.key}.${ext}`);
          title(); orig.show();
          actions.play();
          try {
            const r = await fetch(`/__sfx/file?key=${s.key}&ext=${encodeURIComponent(ext)}`, { method: 'POST', body: ab });
            if (!r.ok) throw new Error();
            toast(`🎵 ${s.name}: reemplazado y guardado`);
          } catch {
            toast(`🎵 ${s.name}: suena hasta recargar la página (para guardarlo, abre el juego con npm run dev)`);
          }
        };
        picker.click();
      },
      async original() {
        clearSoundOverride(s.key);
        title(); orig.hide();
        actions.play();
        try { await fetch(`/__sfx/file?key=${s.key}`, { method: 'DELETE' }); } catch { /* sin servidor */ }
        toast(`🎹 ${s.name}: volvió al original`);
      },
    };
    f.add(actions, 'play').name('▶ Probar');
    f.add(actions, 'copy').name('📋 Copiar prompt');
    f.add(actions, 'replace').name('📂 Reemplazar…');
    const orig = f.add(actions, 'original').name('↺ Volver al original');
    if (!sfxFiles[s.key]) orig.hide();
    f.add(st, 'vol', 0, 2, 0.05).name('Volumen')
      .onChange((v) => { sfxVol[s.key] = v; })
      .onFinishChange((v) => { actions.play(); fetch(`/__sfx/vol?key=${s.key}&vol=${v}`, { method: 'POST' }).catch(() => {}); });
  }
  // los reemplazos se cargan apenas abre el juego: cuando llegan, se actualizan los títulos y volúmenes
  return {
    refresh() {
      root.folders.forEach((f, i) => {
        const s = SOUNDS[i];
        f.title(`${sfxFiles[s.key] ? '🎵' : '🎹'} ${s.name}`);
        const [, , , orig, vol] = f.controllers;
        if (sfxFiles[s.key]) orig.show(); else orig.hide();
        vol.setValue(sfxVol[s.key] ?? 1);
      });
    },
  };
}
