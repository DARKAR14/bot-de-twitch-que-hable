# TTS Bot para Twitch + OBS

Bot de Twitch que convierte comandos del chat en audio, mantiene una cola ordenada y reproduce cada mensaje una sola vez en un Browser Source de OBS.

## Caracteristicas

- Un unico cliente OBS principal reproduce audio; conexiones adicionales quedan en espera.
- Confirmaciones idempotentes: un ACK repetido no puede avanzar dos veces la cola.
- Deduplicacion por ID real del mensaje de Twitch.
- Cola local en memoria con escritura atomica a `data/queue.json`.
- Gemini TTS opcional para una voz mas natural.
- Respaldo automatico con Google Translate TTS y, si ambos fallan, voz del navegador.
- Espanol, ingles, japones, ruso y portugues.
- Sin MongoDB, Mongoose ni servicios de persistencia externos.

## Requisitos

- Node.js 20.19 o posterior.
- Una cuenta de Twitch para el bot.
- OBS Studio.
- API key de Gemini opcional.

## Instalacion

```bash
npm install
copy .env.example .env
npm start
```

Configura al menos estas variables en `.env`:

```env
BOT_USERNAME=nombre_del_bot
BOT_TOKEN=oauth:token_de_twitch
CANAL=canal_sin_hash
```

No guardes tokens ni API keys en Git.

## Gemini TTS

Para usar una voz mas natural:

```env
TTS_PROVIDER=auto
GEMINI_API_KEY=tu_api_key
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Aoede
GEMINI_TTS_STYLE="cheerful, warm, spontaneous and natural Colombian woman from the Caribbean coast, with a subtle costeño accent"
```

`auto` usa Gemini cuando existe una clave. Si Gemini falla por cuota, timeout o un error temporal, el bot usa Google Translate. Sin clave, Google es el proveedor normal.

La voz, modelo y estilo se pueden cambiar con `GEMINI_TTS_VOICE`, `GEMINI_TTS_MODEL` y `GEMINI_TTS_STYLE`.

## Comandos

| Comando | Idioma |
|---|---|
| `!habla texto` | Espanol |
| `!speak text` | Ingles |
| `!onichan texto` | Japones |
| `!sukablad texto` | Ruso |
| `!cr7 texto` | Portugues |
| `!cola` | Estado de la cola, solo mods |
| `!limpiar` | Cancela el audio y limpia la cola, solo mods |

## OBS

Agrega un Browser Source con la URL del servidor, por ejemplo:

```text
http://localhost:3000/
```

El navegador abre internamente el WebSocket `/ws`. Si hay dos Browser Sources abiertos, solo el mas antiguo reproduce; si se desconecta, el siguiente toma el control.

En un servidor publico puedes definir `WS_TOKEN` y agregarlo a la URL de OBS:

```text
https://tu-servidor.example/?token=el_mismo_WS_TOKEN
```

## Endpoints

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/` | Overlay OBS |
| GET | `/config` | Panel visual |
| GET | `/cola` o `/api/cola` | Cola sin rutas internas |
| DELETE | `/cola` | Cancela y limpia la cola |
| GET | `/stats` | Estado de cola, playback y WebSocket |
| GET/POST | `/api/config` | Apariencia y fallback del navegador |
| POST | `/admin/servicio/:accion` | Control Render; requiere `ADMIN_TOKEN` |

Las acciones administrativas aceptan `Authorization: Bearer <ADMIN_TOKEN>` o `X-Admin-Token`.

## Verificacion

```bash
npm run check
npm test
npm audit --omit=dev
```

## Flujo de reproduccion

1. Twitch agrega una entrada en estado `generando`.
2. El proveedor TTS genera un archivo unico para ese ID.
3. El controlador envia solo la primera entrada lista al OBS principal.
4. OBS reproduce y envia un unico `terminado`.
5. El servidor acepta el ACK solo si coincide con el ID activo, elimina el audio y avanza.

Una reconexion puede reenviar solamente el elemento que seguia activo; no puede crear nuevas entradas ni saltar mensajes.
