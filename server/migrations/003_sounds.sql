-- Sonidos reemplazados desde el panel del admin (página Sonidos): el archivo y/o el volumen de cada uno.
-- Viven en la base (no en la imagen del servidor) para que no se pierdan al actualizar el juego.
create table sounds (
  key        text primary key,      -- la clave del sonido (ver SOUNDS en src/sfx.js)
  ext        text,                  -- mp3, wav, ogg… (null = sin archivo: suena el original)
  mime       text,
  data       bytea,
  vol        real,                  -- volumen (1 = normal; null = normal)
  updated_at timestamptz not null default now()
);
