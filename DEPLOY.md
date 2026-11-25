# Bouncy Blobs: cómo se sube al VPS

Todavía no está desplegado (falta el dominio). Esto es lo que hay preparado y los pasos, siguiendo las
reglas de `instrucciones_vps.md` (VPS compartido: no tocar los otros proyectos, Caddy compartido, red `edge`).

## Qué es cada parte

| Parte | Qué hace |
| --- | --- |
| `server/index.js` | Servidor Node: sirve el juego compilado (`dist/`), la API y el panel del admin. Puerto interno 8080. |
| `server/api.js` | `POST /api/t` (eventos de analíticas), `GET /api/records`, `GET /api/admin/*` (sólo admin). |
| `server/auth.js` | Verifica el pase de Cloudflare Access en cada pedido del admin (no alcanza con conocer la URL). |
| `server/migrations/` | Esquema de la base; se aplica solo al arrancar. |
| `compose.yaml` | Producción: `web` (juego + API) y `db` (PostgreSQL 17 propio, red privada `bouncyblobs_internal`). |
| `compose.dev.yml` | Base para desarrollo en esta PC (127.0.0.1:5440). |

Dos direcciones (el mismo contenedor):

- `<dominio>` (y `www.<dominio>`) → el juego, público. Sin panel de ajustes (H) ni atajos de prueba.
- `admin.<dominio>` → el panel de analíticas (`/`) y el juego con las herramientas de admin (`/juego`).
  Protegido con **Cloudflare Access**: Cloudflare pide tu email y manda un código antes de dejarte pasar.

## Desarrollo (esta PC)

```bash
npm run db:up     # base en Docker (una vez; queda corriendo)
npm run dev       # juego + API + panel: http://localhost:5173 y http://localhost:5173/admin.html
```

En desarrollo el panel abre sin login (sólo desde esta PC). Si la base no está levantada, el juego anda igual
(sin analíticas ni récords).

## Primer despliegue

1. **Cloudflare** (cuando tengas el dominio):
   - DNS: `A` de `@` y de `admin` a la IP del VPS, *proxied* (nube naranja). SSL/TLS **Full (strict)**.
   - Zero Trust → Access → Applications → *Add* → *Self-hosted*: dominio `admin.<dominio>`, política
     *Allow* con tu email (método: código por email o Google). Copiar el **AUD tag**.
2. **VPS**: crear `/srv/bouncyblobs` y copiar el proyecto (sin `node_modules`, `dist`, `perf`).
3. Crear `/srv/bouncyblobs/.env` a partir de `.env.example` (modo 600): contraseña de la base, `CF_ACCESS_TEAM_DOMAIN`,
   `CF_ACCESS_AUD` y, si querés doble control, `ADMIN_EMAILS`.
4. Construir y levantar **sólo este proyecto**:
   ```bash
   cd /srv/bouncyblobs
   sudo docker compose -p bouncyblobs build
   sudo docker compose -p bouncyblobs up -d
   sudo docker compose -p bouncyblobs ps          # web y db "healthy"
   sudo docker compose -p bouncyblobs logs --tail 50 web
   ```
5. **Caddy compartido** (`/srv/chronopolis/Caddyfile`): respaldar el archivo y agregar dos bloques **copiando el
   patrón de los sitios existentes** (la restricción a IPs de Cloudflare incluida), con
   `reverse_proxy bouncyblobs_web:8080`. Validar y recargar en caliente (nunca reiniciar Caddy):
   ```bash
   sudo docker exec chronopolis-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   sudo docker exec chronopolis-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
   ```
6. Verificar desde internet: el juego carga, `/healthz` responde `ok`, `admin.<dominio>` pide login, después de
   jugar una partida aparece en el panel, y los otros sitios del VPS siguen andando.

## Actualizar

```bash
cd /srv/bouncyblobs && sudo docker compose -p bouncyblobs build web && sudo docker compose -p bouncyblobs up -d web
```

Las migraciones nuevas se aplican solas al arrancar. Más adelante conviene replicar el patrón de PoreChecker
(GitHub Actions + cuenta de deploy propia + script con releases y vuelta atrás).

## Backups de la base

Diario, con `cron` en el VPS (guarda 14 días):

```bash
0 4 * * * docker exec bouncyblobs-db-1 pg_dump -U bouncyblobs bouncyblobs | gzip > /srv/bouncyblobs/backups/$(date +\%F).sql.gz && find /srv/bouncyblobs/backups -name '*.sql.gz' -mtime +14 -delete
```

## Privacidad (a decidir antes de abrirlo al público)

- No se guardan IPs ni datos personales: cada navegador tiene un id al azar; el país sale de Cloudflare.
- Ese id se guarda en el navegador (localStorage). Para jugadores de la Unión Europea, guardar un id para
  analíticas pide consentimiento. Opciones: un aviso simple de cookies, o no guardar id (contar visitas sin
  saber si vuelven, como hace Umami). Lo vemos cuando esté por salir.

## Pendiente para el multijugador

El juego hoy corre todo en el navegador. Cuando haya partidas online, el servidor va a necesitar WebSockets
(Caddy y Cloudflare los soportan en el mismo dominio) y la física pasa a correr en el servidor.

## Estado actual (25/11/2026)

- Desplegado en `/srv/bouncyblobs` (proyecto Compose `bouncyblobs`): `bouncyblobs-web-1` y `bouncyblobs-db-1`, sanos.
- Red privada `bouncyblobs_internal`; `web` en `edge` con alias `bouncyblobs_web` (puerto 8080). Volumen de datos `bouncyblobs_db`.
- Secretos: `/srv/bouncyblobs/.env` (600). Contraseña de la base generada en el servidor.
- Caddy: bloque agregado al final de `/srv/chronopolis/Caddyfile` (respaldo `Caddyfile.bak-20261125-230858`).
  `www` → redirige a `bouncyblobs.com`; `bouncyblobs.com` y `admin.bouncyblobs.com` → `bouncyblobs_web:8080`.
- Verificado: `https://bouncyblobs.com` (juego, `/healthz`, `/api/records`), `admin.html` y `/api/admin/*` bloqueados en el sitio
  público, y los demás sitios del VPS respondiendo como antes.
- Falta: registro DNS de `admin`, Cloudflare Access (y cargar `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` en el `.env`), backups diarios.

Actualizar desde esta PC:

```bash
rsync -az -e "ssh -i <clave-ssh>" --exclude node_modules --exclude dist --exclude perf \
  --exclude escenarios --exclude .env --exclude instrucciones_vps.md ./ <usuario>@<vps>:/srv/bouncyblobs/
ssh -i <clave-ssh> <usuario>@<vps> \
  'cd /srv/bouncyblobs && sudo docker compose -p bouncyblobs build web && sudo docker compose -p bouncyblobs up -d web'
```
