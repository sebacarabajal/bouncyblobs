-- Música de fondo subida desde el panel del admin (página Sonidos). El juego toca las activas en orden al azar.
create table music (
  id         serial primary key,
  title      text not null,
  ext        text not null,
  mime       text not null,
  data       bytea not null,
  size       integer not null,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
