-- Bouncy Blobs: jugadores anónimos, sesiones, partidas y eventos (analíticas + récords).
-- Sin registro: cada navegador tiene un id al azar (localStorage). No se guardan IPs: el país sale del
-- encabezado CF-IPCountry de Cloudflare.

create table players (
  id          uuid primary key,
  name        text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  country     text,
  lang        text,
  best_score  integer not null default 0
);
create index players_first_seen on players (first_seen);

create table sessions (
  id          uuid primary key,
  player_id   uuid not null references players (id) on delete cascade,
  started_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  is_new      boolean not null default false,
  country     text,
  lang        text,
  browser     text,
  os          text,
  device      text,           -- 'desktop' | 'mobile'
  gpu         text,
  screen      text,
  referrer    text,
  fps_avg     real,           -- promedio de los resúmenes de rendimiento de la sesión
  fps_n       integer not null default 0
);
create index sessions_started on sessions (started_at);
create index sessions_player on sessions (player_id);
create index sessions_last_seen on sessions (last_seen);

create table matches (
  id           uuid primary key,
  session_id   uuid not null references sessions (id) on delete cascade,
  player_id    uuid not null references players (id) on delete cascade,
  mode         text not null,        -- 'ffa' | 'teams'
  arena        text not null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  duration_s   integer,
  score        integer,
  kos          integer,
  falls        integer,
  max_mass     real,
  team         smallint,
  rounds_won   integer,
  rounds_lost  integer,
  end_reason   text                  -- 'lobby' | 'leave' | 'arena' | …
);
create index matches_started on matches (started_at);
create index matches_player on matches (player_id);
create index matches_score on matches (mode, score desc);

create table events (
  id          bigserial primary key,
  session_id  uuid references sessions (id) on delete cascade,
  player_id   uuid,
  at          timestamptz not null default now(),
  type        text not null,          -- 'tutorial' | 'round' | 'perf' | …
  data        jsonb
);
create index events_type_at on events (type, at);
