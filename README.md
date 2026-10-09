# MailForge

Cliente de correo de escritorio para **macOS y Windows** (Electron + React + TypeScript), con datos 100 % locales.

## Funciones (v0.1)
- Multicuenta IMAP/SMTP con bandeja unificada (presets Gmail, Outlook, iCloud, Yahoo)
- Contraseñas cifradas con el llavero del sistema (`safeStorage`)
- Hilos de conversación, búsqueda de texto completo (SQLite FTS5), destacados, leído/no leído sincronizado
- **Programar envíos** (cola local) y cancelar antes de la hora
- **Seguimiento de lectura** con píxel propio (tracker self-hosted en `tracker/`, Cloudflare Workers gratuito) + notificación al abrirse
- **Recordatorio de seguimiento** si no hay respuesta en N días; detección de respuesta
- **Posponer (snooze)** mensajes
- Plantillas, firmas por cuenta, atajos (`c` redactar, `/` buscar)
- Imágenes remotas bloqueadas al leer (anti-rastreo) y HTML saneado en iframe sandbox
- CI que genera instaladores `.dmg` y `.exe`

## Desarrollo
```bash
npm install
npm run dev
npm run dist:mac   # o dist:win
```

## Seguimiento de lectura
1. Despliega `tracker/worker.js` en Cloudflare Workers con un KV `OPENS` (y variable `KEY` opcional).
2. Pega la URL en Ajustes → Servidor de seguimiento.

Limitación honesta: Apple Mail Privacy Protection y Gmail precargan imágenes, así que algunas "aperturas" son falsas.

## Roadmap
- [ ] OAuth2 Gmail/Microsoft (sin contraseñas de aplicación)
- [ ] Editor enriquecido, adjuntos, deshacer envío
- [ ] Carpetas/etiquetas, archivar, borrar, mover; IDLE push en tiempo real
- [ ] Reglas y filtros, bandeja prioritaria
- [ ] Combinar correspondencia (mail merge) y secuencias de seguimiento
- [ ] Clasificación y resúmenes con IA, baja en bloque de newsletters, deduplicación
- [ ] Envío programado en servidor (sin app abierta), firma/cifrado PGP, calendario
- [ ] Autoactualización, firma de código

## Inspiración
Ideas de UX tomadas de proyectos abiertos como Mailspring (GPL-3), Mail0 e Inbox Zero. No se ha copiado código.

## Licencia
MIT
