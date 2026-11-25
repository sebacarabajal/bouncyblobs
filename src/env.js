// ¿Esta página es la del admin? Sólo entonces aparecen el panel de ajustes (H), los atajos de prueba
// (8/9/0 arenas, +/- masa, B bots, R reiniciar, I FPS) y los parámetros de la URL (?arena=, ?bots).
// - En desarrollo (npm run dev) siempre.
// - En producción, sólo en el subdominio admin.* (protegido con Cloudflare Access: sólo entra tu email).
// No es "seguridad": cualquiera podría activarlo en su navegador, pero sólo cambiaría su propia partida local.
// Lo que sí está protegido de verdad son los datos del panel de analíticas (ver server/auth.js).
export const IS_ADMIN = !!import.meta.env?.DEV
  || (typeof location !== 'undefined' && /^admin\./.test(location.hostname));
