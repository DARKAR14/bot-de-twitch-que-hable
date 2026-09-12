# TTS Bot para Twitch + OBS

Bot de Twitch que convierte comandos del chat en audio, mantiene una cola ordenada y reproduce cada mensaje una sola vez en un Browser Source de OBS.

## Caracteristicas

- Un unico cliente OBS principal reproduce audio; conexiones adicionales quedan en espera.
- Confirmaciones idempotentes: un ACK repetido no puede avanzar dos veces la cola.
- Deduplicacion por ID real del mensaje de Twitch.
- Cola local en memoria con escritura atomica a `data/queue.json`.
- `!habla` usa Gemini, luego Puter, un endpoint opcional de Hugging Face y Google.
- `!ia` responde preguntas breves, interpreta errores ortograficos y habla la respuesta.
- Los mensajes normales se corrigen antes de generar el audio (tildes, puntuacion y abreviaturas), pero OBS conserva el texto original. Si el corrector falla o alcanza su limite, la cola sigue con el mensaje original.
- Fish (Diomedes/Naruto) queda reservado para alertas especiales y solicitudes autorizadas del panel.
- API privada para que tu panel envíe TTS a OBS sin escribir en Twitch.
- Limites diarios persistentes, enfriamiento por usuario, control de rafagas y cache.
- Respaldos automaticos con Puter, Hugging Face opcional, Google Translate TTS y, si todo falla, voz del navegador.
- Espanol, ingles, japones, ruso y portugues.
- La cola funciona sin base de datos; MongoDB es opcional únicamente para obtener/renovar el token de follows por EventSub.

## Requisitos

- Node.js 20.19 o posterior.
- Una cuenta de Twitch para el bot.
- OBS Studio.
- API key de Gemini para la voz natural y `!ia`.
- API key de Fish Audio para alertas especiales de subs, regalos, raids, follows y bits.
- Opcional: una cuenta de Puter para habilitar un respaldo TTS adicional.

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

`auto` usa Gemini cuando existe una clave. Si falla, prueba Puter, un endpoint de Hugging Face cuando esté configurado y finalmente Google Translate. Fish no participa en mensajes normales del chat.

La voz, modelo y estilo se pueden cambiar con `GEMINI_TTS_VOICE`, `GEMINI_TTS_MODEL` y `GEMINI_TTS_STYLE`.

Para evitar que una respuesta lenta bloquee toda la cola, `TTS_JOB_TIMEOUT_MS` limita el tiempo total de cada audio (45 segundos por defecto) y `QUEUE_GENERATION_TIMEOUT_MS` actua como watchdog final de la primera entrada (100 segundos, suficiente para el flujo combinado de `!ia` + TTS). Si se agotan, la entrada pasa a la voz de respaldo del navegador y la cola continua. `TTS_CONCURRENCY=2` mantiene dos generaciones simultaneas sin disparar demasiadas peticiones durante una rafaga.

Para `!habla`, `!ia` y `!pruebavoz`, el bot usa una configuracion costena femenina separada: `GEMINI_COAST_VOICE=Kore` y `GEMINI_COAST_STYLE`. Esto evita que un valor general como `Sadachbia` cambie la prueba a un timbre masculino. El perfil busca una mujer adulta de registro medio-grave, firme, expresiva y natural; no representa ni clona la voz de una persona real.

## Fish Audio y respuestas IA

Configura Fish Audio sin guardar la clave en Git:

```env
FISH_API_KEY=tu_api_key
FISH_REFERENCE_ID=c23b3ac076b44c07918ed2c54addc2c5
FISH_TTS_MODEL=s2.1-pro-free
FISH_NARUTO_REFERENCE_ID=1412b58e859448d284f8f62391e82bd9
```

El backend identifica esta salida como una voz IA no oficial y entrega la atribucion al dashboard mediante WebSocket, sin mostrarla dentro del overlay de OBS. Diomedes se usa para subs, resubs, regalos y bits; Naruto para raids y follows. Una proteccion global agrupa rafagas de regalos para no consumir la cuota de golpe. Si Fish falla, la alerta prueba los respaldos generales.

`!ia` usa `gemini-3.5-flash-lite` para entender la pregunta y genera una respuesta corta con escritura correcta. Los selectores antiguos `diomedes` y `naruto` conservan el estilo de respuesta, pero el audio se genera con la cadena normal y no consume Fish.

## Puter como respaldo

Puter se ejecuta en el backend de Render y queda después de Gemini pero antes de Hugging Face y Google. De forma predeterminada utiliza xAI con la voz femenina `ara`, cálida y conversacional, mediante la cuenta Puter.

Obtiene el token una sola vez desde tu computador:

```bash
npm run puter:token
```

Se abrira el navegador para iniciar sesion en Puter. Copia la linea resultante al `.env` local y a las variables secretas de Render:

```env
PUTER_AUTH_TOKEN=tu_token_secreto
PUTER_TTS_ENDPOINT=https://api.puter.com/drivers/call
PUTER_TTS_PROVIDER=xai
PUTER_TTS_MODEL=
PUTER_TTS_VOICE=ara
PUTER_TTS_STYLE="Speak as a cheerful, warm and spontaneous adult Colombian woman from the Caribbean coast, with natural conversational rhythm, expressive intonation and clear diction."
PUTER_TTS_FORMAT=mp3
```

Solo `PUTER_AUTH_TOKEN` es necesario. xAI no necesita un modelo explicito y, si la voz queda vacia, el adaptador usa `ara`. Tambien puedes usar `eve` para un tono más alegre y energético. El token concede acceso a tu cuenta: no lo publiques, no lo envies por Twitch y no lo guardes en Git.

La asignacion gratuita de Puter no es ilimitada. Para evitar otra rafaga de consumo, el respaldo tiene circuito por errores 401/402/403/429 y un presupuesto conservador configurable:

```env
PUTER_TTS_COOLDOWN_SEGUNDOS=60
PUTER_TTS_GLOBAL_COOLDOWN_SEGUNDOS=10
PUTER_TTS_LIMITE_DIARIO=30
PUTER_TTS_LIMITE_USUARIO_DIARIO=3
```

Si Puter no tiene saldo, su token expiro o la solicitud se cuelga, el trabajo se cancela dentro del timeout general y la cola continua inmediatamente con Google. Se recomienda conservar `TTS_PROVIDER=auto` para mantener toda la cadena de respaldo.

## Hugging Face como respaldo opcional

Hugging Face solo se activa si tienes un Endpoint o Space TTS propio que acepte JSON con `inputs` y devuelva audio. Fish S1 no dispone actualmente de inferencia serverless directa, por lo que un token de Hugging Face por sí solo no habilita esta ruta:

```env
HUGGINGFACE_TOKEN=hf_token_privado
HUGGINGFACE_TTS_ENDPOINT=https://tu-endpoint.example
```

Si el endpoint tiene arranque en frío, límite o un error, el bot continúa con Google sin bloquear la cola.

## Alertas especiales y follows

Subs, resubs, regalos, raids y bits llegan por el cliente de chat existente. Para follows, usa un token de usuario del broadcaster o de un moderador con `moderator:read:followers`. Puede venir directamente del entorno:

```env
TWITCH_EVENTSUB_TOKEN=token_sin_publicar
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_BROADCASTER_ID=
```

O puede leerse desde MongoDB usando un documento con `_id`, `access_token`, `refresh_token`, `expires_at` y `updated_at`:

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=nombre_db
TWITCH_TOKEN_COLLECTION=twitch_tokens
TWITCH_TOKEN_DOCUMENT_ID=broadcaster
TWITCH_CLIENT_ID=client_id_de_la_app
TWITCH_CLIENT_SECRET=client_secret_de_la_app
```

MongoDB se abre únicamente al preparar EventSub y se cierra después. Si el token está próximo a vencer, el bot usa `refresh_token` y actualiza el mismo documento. El ID del canal se resuelve desde `CANAL` cuando `TWITCH_BROADCASTER_ID` está vacío. Las raids y follows usan Naruto; las demás alertas usan Diomedes.

## Comandos

| Comando | Idioma |
|---|---|
| `!habla texto` | Español; Gemini, Puter, Hugging Face opcional y Google |
| `!speak text` | Ingles |
| `!onichan texto` | Japones |
| `!sukablad texto` | Ruso |
| `!cr7 texto` | Portugues |
| `!ia pregunta` | Respuesta IA con voz Gemini |
| `!ia gemini pregunta` | Respuesta IA con voz Gemini |
| `!ia diomedes pregunta` | Estilo parrandero, reproducido por la cadena normal (`diomedez` también se acepta) |
| `!ia naruto pregunta` | Estilo anime original, reproducido por la cadena normal |
| `!pruebavoz texto` | Fuerza la voz Gemini costena; solo mods |
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

## Integración con el panel

El bot no inicia sesión contra tu backend ni necesita conocer sus usuarios o permisos. Tu panel autentica al usuario y su **backend** llama a esta API privada. El secreto nunca debe enviarse desde el navegador.

Configura en Render:

```env
DASHBOARD_ORIGIN=https://tu-panel.example
DASHBOARD_CHAT_URL=https://tu-panel.example/tts
PANEL_API_TOKEN=un_secreto_aleatorio_largo_y_exclusivo
PANEL_IDEMPOTENCY_TTL_HOURS=24
```

Puedes generar el secreto con `openssl rand -hex 32` o cualquier generador criptográfico equivalente. Debe existir con el mismo valor en Render y en las variables privadas del backend de tu panel.

El backend del panel consulta `GET /api/v1/chat/capabilities` para construir los selectores. Para enviar usa `POST /api/v1/chat/messages` con `Authorization: Bearer <PANEL_API_TOKEN>` y una `Idempotency-Key` nueva por cada clic (se recomienda un UUID). Si el panel reintenta la misma solicitud con la misma clave, el bot devuelve el trabajo original con `replayed: true` y no duplica el audio.

Ejemplo de cuerpo:

```json
{
  "actorId": "twitch:123456789",
  "name": "Darkar",
  "message": "Buenas noches, mi gente",
  "voice": "diomedes",
  "action": "speak"
}
```

`actorId` es el identificador interno o de Twitch del usuario ya autenticado por tu panel; se usa únicamente para límites y auditoría local. `action` acepta `speak` o `ask`. Las voces se obtienen dinámicamente desde capabilities. El estado se consulta en la URL `statusUrl` devuelta por el POST.

Ejemplo desde el **servidor** del panel:

```js
const response = await fetch(`${process.env.TTS_BOT_URL}/api/v1/chat/messages`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.TTS_BOT_PANEL_TOKEN}`,
    "Idempotency-Key": crypto.randomUUID(),
  },
  body: JSON.stringify({ actorId, name, message, voice, action }),
});
```

No uses `PANEL_API_TOKEN` dentro de React, Vue, Angular ni cualquier bundle público. `/chat` redirige a `DASHBOARD_CHAT_URL`; si no se configura, responde `410` para indicar que la interfaz vive en el panel.

## Endpoints

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/` | Overlay OBS |
| GET | `/config` | Panel visual |
| GET | `/chat` | Redirige al chat del panel configurado |
| GET | `/api/v1/chat/capabilities` | Límites, acciones y voces disponibles; requiere token del panel |
| POST | `/api/v1/chat/messages` | Recibe `{ actorId, name, message, voice, action }`; requiere token e idempotencia |
| GET | `/api/v1/chat/messages/:id` | Estado de un envío reciente; requiere token del panel |
| GET | `/cola` o `/api/cola` | Cola sin rutas internas |
| DELETE | `/cola` | Cancela y limpia la cola |
| GET | `/stats` | Estado de cola, playback y WebSocket |
| GET/POST | `/api/config` | Apariencia y fallback del navegador |
| POST | `/admin/servicio/:accion` | Control Render; requiere `ADMIN_TOKEN` |

La API del panel acepta `Authorization: Bearer <PANEL_API_TOKEN>` o `X-Panel-Token`. Los alias anteriores `/api/chat/config` y `/api/chat` siguen disponibles durante la migración, pero aplican la misma autenticación e idempotencia. Las acciones administrativas aceptan `Authorization: Bearer <ADMIN_TOKEN>` o `X-Admin-Token`.

`/stats` tambien informa cache, circuitos temporales y consumo diario. Los valores `FISH_*_LIMITE_*`, `GEMINI_TTS_*_LIMITE_*`, `PUTER_TTS_*_LIMITE_*` y `AI_*_LIMITE_*` permiten ajustar el presupuesto. Los moderadores omiten el limite individual, pero no el limite diario ni el control global de rafagas.

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
