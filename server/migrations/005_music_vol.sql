-- Volumen de la música elegido en el admin: uno general (settings 'musicBase') y un ajuste por canción.
alter table music add column vol real not null default 1;
create table settings (key text primary key, value jsonb not null);
insert into settings (key, value) values ('musicBase', '0.4');
