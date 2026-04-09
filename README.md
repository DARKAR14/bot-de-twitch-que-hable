# 🎙️ BOT !habla — TTS para Twitch + OBS

Bot de Text-to-Speech para Twitch que convierte mensajes del chat en audio y los muestra como overlay animado en OBS Studio.

---

## ✨ ¿Qué hace?

Cuando un espectador escribe `!habla <mensaje>` en el chat de Twitch, el bot:
1. Genera el audio con Google Translate TTS (gratis, sin API key)
2. Muestra un overlay animado en OBS con el nombre del usuario y el mensaje
3. Reproduce el audio en tiempo real
4. Gestiona una cola para que los mensajes se reproduzcan en orden

---

## 📁 Estructura del proyecto

```
BOT-DE-TWITCH-QUE-HABLE/
├── bot.js                  # Punto de entrada principal
├── obs.html                # Overlay para OBS (browser source)
├── package.json
├── discloud.config         # Config para deploy en Discloud
├── .gitignore
│
├── src/
│   ├── config.js           # Configuración central (variables de entorno)
│   ├── twitch.js           # Conexión al chat de Twitch (tmi.js)
│   ├── tts.js              # Generación de audio con Google Translate
│   ├── queue.js            # Cola de mensajes (persistida en JSON)
│   ├── websocket.js        # Comunicación en tiempo real con OBS
│   └── antibot.js          # Detección de bots y spam (requiere MongoDB)
│
├── font/
│   └── njnaruto.ttf        # Fuente personalizada del overlay
│
└── svg/
    ├── image.svg
    └── svgviewer-output.svg  # Ícono animado del overlay
```

---

## ⚙️ Configuración

Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:

```env
# Twitch
BOT_USERNAME=nombre_de_tu_bot
BOT_TOKEN=oauth:xxxxxxxxxxxxxxxxxxxx   # Obtén en twitchapps.com/tmi
CANAL=tu_canal_sin_hash

# Servidor (opcional, para deploy en la nube)
APP_URL=https://tu-app.onrender.com

# MongoDB (opcional, para el sistema antibot)
MONGODB_URI=mongodb+srv://...
MONGODB_DB=hablabot
```

> El token del bot se obtiene en [twitchapps.com/tmi](https://twitchapps.com/tmi) iniciando sesión con la cuenta del bot.

### Opciones adicionales en `src/config.js`

| Variable | Por defecto | Descripción |
|---|---|---|
| `PREFIJO_COMANDO` | `!habla` | Comando que activa el TTS |
| `COOLDOWN_SEGUNDOS` | `10` | Segundos de espera entre usos por usuario |
| `SOLO_SUBS` | `false` | Restringir el comando solo a suscriptores |
| `MAX_CARACTERES` | `150` | Límite de caracteres por mensaje |
| `MAX_COLA` | `20` | Máximo de mensajes en cola simultáneos |
| `TTS_LANG` | `es-ES` | Idioma de la voz |

---

## 🚀 Instalación y uso

### Requisitos

- Node.js v18 o superior
- npm

### Pasos

```bash
# 1. Clona el repositorio
git clone <url-del-repo>
cd BOT-DE-TWITCH-QUE-HABLE

# 2. Instala las dependencias
npm install

# 3. Crea y configura el archivo .env (ver sección anterior)

# 4. Inicia el bot
npm start

# O en modo desarrollo (con auto-reinicio)
npm run dev
```

El servidor arrancará en el puerto `3000`.

---

## 📺 Configurar OBS

1. En OBS, agrega una nueva fuente del tipo **Browser Source**
2. Usa la siguiente URL:
   ```
   http://localhost:3000
   ```
   *(Si el bot está en la nube, usa la URL pública)*
3. Configura el tamaño recomendado: **1920 × 1080**
4. Activa la opción **"Control audio via OBS"** si quieres controlar el volumen desde OBS

El overlay aparecerá en la esquina inferior izquierda con animación de entrada/salida.

---

## 🤖 Comandos disponibles

| Comando | Quién puede usarlo | Descripción |
|---|---|---|
| `!habla <mensaje>` | Todos (o solo subs si `SOLO_SUBS=true`) | Añade un mensaje a la cola TTS |
| `!addbot <patrón>` | Solo moderadores | Agrega un patrón al filtro antibot |

---

## 🛡️ Sistema Antibot (opcional)

Si configuras `MONGODB_URI`, el bot activa protección automática contra spam:

- **Detección por patrones**: filtra mensajes que contengan frases comunes de bots (venta de viewers, spam de follows, etc.)
- **Baneo automático**: ejecuta `/ban` al detectar un bot
- **Limpieza de repeticiones**: convierte `AAAAAAA` en `AAAA` para evitar spam sonoro
- **Patrones editables**: los mods pueden agregar nuevos patrones con `!addbot`

Sin MongoDB configurado, el antibot simplemente se desactiva sin afectar el funcionamiento del bot.

---

## 🌐 Deploy en la nube

### Discloud

El proyecto incluye `discloud.config` listo para usar:

```ini
TYPE=bot
MAIN=bot.js
RAM=100
AUTORESTART=true
START=npm start
BUILD=npm install
```

Sube el proyecto a [discloud.app](https://discloud.app) y configura las variables de entorno en el panel.

### Render / Railway

1. Conecta tu repositorio
2. Configura las variables de entorno en el panel
3. Establece `APP_URL` con la URL pública de tu servicio (el bot se hará ping cada 4 minutos para no dormir en planes gratuitos de Render)

---

## 🔌 Endpoints HTTP

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Sirve el overlay de OBS |
| `GET` | `/cola` | Muestra el estado actual de la cola (JSON) |
| `DELETE` | `/cola` | Limpia toda la cola manualmente |
| `GET` | `/audio/:archivo` | Sirve los archivos de audio generados |

---

## 🧰 Tecnologías usadas

- **[tmi.js](https://tmijs.com/)** — Conexión al chat de Twitch
- **[ws](https://github.com/websockets/ws)** — WebSocket para comunicación con OBS
- **[express](https://expressjs.com/)** — Servidor HTTP
- **[mongoose](https://mongoosejs.com/) / MongoDB** — Persistencia del sistema antibot
- **Google Translate TTS** — Síntesis de voz gratuita sin API key

---

## 📝 Notas

- Los archivos de audio se eliminan automáticamente después de reproducirse y también se limpian los que tienen más de 10 minutos de antigüedad.
- La cola se persiste en `data/queue.json` y se limpia al reiniciar el bot para evitar reproducir mensajes de sesiones anteriores.
- Si OBS no está conectado cuando llega un mensaje, el mensaje queda en cola y se envía automáticamente cuando OBS se reconecte.
