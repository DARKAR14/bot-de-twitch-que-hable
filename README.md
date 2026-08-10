# TTS Bot para Twitch + OBS

Bot de Twitch que convierte comandos del chat en audio, mantiene una cola ordenada y reproduce cada mensaje una sola vez en un Browser Source de OBS.

## Caracteristicas

- Un unico cliente OBS principal reproduce audio; conexiones adicionales quedan en espera.
- Confirmaciones idempotentes: un ACK repetido no puede avanzar dos veces la cola.
- Deduplicacion por ID real del mensaje de Twitch.
- Cola local en memoria con escritura atomica a `data/queue.json`.
- `!habla` alterna entre Gemini TTS y Fish Audio, con Google como respaldo final.
- `!ia` responde preguntas breves, interpreta errores ortograficos y habla la respuesta.
- Perfil Naruto independiente para `!naruto` y `!ia naruto`.
- Chat privado en `/chat` para enviar TTS a OBS sin escribir en Twitch.
- Limites diarios persistentes, enfriamiento por usuario, control de rafagas y cache.
- Respaldo automatico con Google Translate TTS y, si ambos fallan, voz del navegador.
- Espanol, ingles, japones, ruso y portugues.
- Sin MongoDB, Mongoose ni servicios de persistencia externos.

## Requisitos

- Node.js 20.19 o posterior.
- Una cuenta de Twitch para el bot.
- OBS Studio.
- API key de Gemini para la voz natural y `!ia`.
- API key de Fish Audio para la rotacion de `!habla` y `!ia diomedes`.

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

El backend identifica esta salida como una voz IA no oficial y entrega la atribucion al dashboard mediante WebSocket, sin mostrarla dentro del overlay de OBS. Si Fish falla o alcanza su cuota, el circuito se pausa temporalmente y el audio prueba Gemini antes de usar Google.

`!ia` usa `gemini-3.5-flash-lite` para entender la pregunta, incluso con faltas de ortografia, y genera una respuesta corta con escritura correcta y un tono costeno natural. La personalidad de Gemini es original y no se presenta como una imitacion de una persona real. En el modo Diomedes, la narracion comienza con `Aqui mi compae {usuario} me pregunta: {pregunta}` y luego reproduce la respuesta.

## Comandos

| Comando | Idioma |
|---|---|
| `!habla texto` | Espanol; alterna Fish/Gemini y respalda con Google |
| `!speak text` | Ingles |
| `!onichan texto` | Japones |
| `!sukablad texto` | Ruso |
| `!cr7 texto` | Portugues |
| `!naruto texto` | Voz comunitaria Naruto mediante Fish Audio |
| `!ia pregunta` | Respuesta IA con voz Gemini |
| `!ia gemini pregunta` | Respuesta IA con voz Gemini |
| `!ia diomedes pregunta` | Presenta al usuario y la pregunta, luego responde con voz Fish (`diomedez` tambien se acepta) |
| `!ia naruto pregunta` | Respuesta IA con voz Naruto de Fish |
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

## Chat privado

Abre `http://localhost:3000/chat` o `https://tu-servidor.onrender.com/chat`. El formulario permite elegir `Automática`, `Gemini`, `Diomedes`, `Naruto` o `Google`, y envia un objeto con los campos `name`, `message` y `voice`. OBS muestra el nombre y el mensaje, pero el motor TTS recibe y reproduce solamente `message`. No escribas `!naruto` ni otro comando en el texto: el selector envia el identificador de voz (`auto`, `gemini`, `diomedes`, `naruto` o `google`) y el servidor aplica la configuracion interna. Este flujo no escribe nada en Twitch.

En Render es recomendable protegerlo:

```env
CHAT_TOKEN=un_secreto_largo_y_distinto
```

La pagina mostrara un campo para el token. Tambien se puede abrir una vez con `/chat?token=...`; el valor se copia al formulario y se retira inmediatamente de la barra de direcciones. Si `CHAT_TOKEN` queda vacio, la ruta funciona sin autenticacion pero conserva cooldown, limite por cliente, limite diario y cola maxima.

## Endpoints

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/` | Overlay OBS |
| GET | `/config` | Panel visual |
| GET | `/chat` | Formulario privado para enviar TTS sin Twitch |
| GET | `/api/chat/config` | Limites, voces disponibles y estado de autenticacion del chat |
| POST | `/api/chat` | Recibe `{ name, message, voice }` y lo agrega a la cola |
| GET | `/cola` o `/api/cola` | Cola sin rutas internas |
| DELETE | `/cola` | Cancela y limpia la cola |
| GET | `/stats` | Estado de cola, playback y WebSocket |
| GET/POST | `/api/config` | Apariencia y fallback del navegador |
| POST | `/admin/servicio/:accion` | Control Render; requiere `ADMIN_TOKEN` |

Las acciones administrativas aceptan `Authorization: Bearer <ADMIN_TOKEN>` o `X-Admin-Token`.

`/stats` tambien informa cache, circuitos temporales y consumo diario. Los valores `FISH_*_LIMITE_*`, `GEMINI_TTS_*_LIMITE_*` y `AI_*_LIMITE_*` permiten ajustar el presupuesto. Los moderadores omiten el limite individual, pero no el limite diario ni el control global de rafagas.

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
