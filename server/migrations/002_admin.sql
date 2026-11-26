-- Panel del admin completo: más datos de cada sesión (equipo, versiones, ventana, IP…) y resúmenes de rendimiento
-- y de red guardados en la sesión, para poder filtrar y comparar rápido (por país, sistema, navegador, placa…).
-- La IP se borra sola a los IP_RETENTION_DAYS días (ver server/index.js); los demás datos no identifican a nadie.

alter table sessions
  add column ip           text,
  add column region       text,      -- provincia/estado (encabezados de ubicación de Cloudflare, si están activados)
  add column city         text,
  add column ua           text,      -- el "user agent" completo (por si hace falta volver a leerlo)
  add column browser_ver  text,
  add column os_ver       text,
  add column model        text,      -- modelo del equipo (sólo algunos navegadores lo dicen)
  add column is_bot       boolean not null default false, -- robots y navegadores automáticos (sin placa de video real)
  add column gpu_vendor   text,
  add column cores        smallint,
  add column ram          real,      -- GB (el navegador lo redondea y tiene tope 8)
  add column dpr          real,
  add column win          text,      -- tamaño de la ventana del juego
  add column tz           text,
  add column langs        text,
  add column touch        boolean,
  add column conn         text,      -- tipo de conexión que informa el navegador (4g, wifi…)
  add column ver          text,      -- versión del juego (fecha de la compilación)
  add column utm_source   text,
  add column utm_medium   text,
  add column utm_campaign text,
  -- rendimiento (promedios de los resúmenes de cada minuto; fps_avg y fps_n ya existían)
  add column fps_target   real,
  add column cpu_ms       real,
  add column gpu_ms       real,
  add column hz           real,
  -- red en línea (sumas de los resúmenes de cada minuto)
  add column net_s        real not null default 0,
  add column rtt_avg      real,
  add column hits         integer not null default 0,
  add column seen         integer not null default 0,
  add column ghost        integer not null default 0,
  add column me_hit       integer not null default 0,
  add column me_late      integer not null default 0,
  add column me_vis       integer not null default 0,
  add column ot_vis       integer not null default 0;

create index sessions_country on sessions (country);
create index sessions_ip on sessions (ip) where ip is not null;
create index matches_session on matches (session_id);
create index events_session on events (session_id);

-- lo que ya había: marca de placa, robots y resúmenes de rendimiento y de red
update sessions set gpu_vendor = case
  when gpu is null then null
  when gpu ~* 'swiftshader|llvmpipe|softpipe|microsoft basic render' then 'Software'
  when gpu ~* 'nvidia|geforce|quadro|rtx|gtx' then 'NVIDIA'
  when gpu ~* 'amd|radeon|ati ' then 'AMD'
  when gpu ~* 'intel|iris|uhd graphics|hd graphics' then 'Intel'
  when gpu ~* 'apple' then 'Apple'
  when gpu ~* 'adreno|qualcomm' then 'Qualcomm'
  when gpu ~* 'mali|arm' then 'ARM'
  else 'Otra' end;
update sessions set is_bot = true where gpu_vendor = 'Software';

update sessions s set fps_target = p.target, cpu_ms = p.cpu, gpu_ms = p.gpu, hz = p.hz, win = coalesce(s.win, p.win)
from (
  select session_id, avg((data->>'target')::float) as target, avg((data->>'cpu')::float) as cpu, avg((data->>'gpu')::float) as gpu,
         max((data->>'hz')::float) as hz, max(data->>'win') as win
  from events where type = 'perf' group by session_id
) p where p.session_id = s.id;

update sessions s set net_s = n.dur, rtt_avg = n.rtt, hits = n.hits, seen = n.seen, ghost = n.ghost,
  me_hit = n.mehit, me_late = n.melate, me_vis = n.mevis, ot_vis = n.otvis
from (
  select session_id, sum((data->>'dur')::float) as dur,
         sum((data->>'rtt')::float * (data->>'dur')::float) / nullif(sum((data->>'dur')::float), 0) as rtt,
         sum((data->>'hits')::int) as hits, sum((data->>'seen')::int) as seen, sum((data->>'ghost')::int) as ghost,
         sum((data->>'meHit')::int) as mehit, sum((data->>'meLate')::int) as melate,
         sum((data->>'meVis')::int) as mevis, sum((data->>'otVis')::int) as otvis
  from events where type = 'net' group by session_id
) n where n.session_id = s.id;
