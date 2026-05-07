// ============================================
//  bot.js - Punto de entrada principal
// ============================================

const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const cors = require("cors"); // Agregado para el panel

// ── Logger antes que todo ──────────────────────────────────────
const { createLogger } = require("./src/logger");
const log = createLogger("BOT");

// ── Crear carpetas necesarias ──────────────────────────────────
const dirs = [path.join(__dirname, "data"), path.join(__dirname, "data/audio")];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log.info(`Carpeta creada: ${dir}`);
  }
});

// ── Config — valida variables antes de continuar ──────────────
const CONFIG = require("./src/config");
CONFIG.validate();

const mongoQueue = require("./src/mongoQueue");
const ws = require("./src/websocket");
const twitch = require("./src/twitch");
const tts = require("./src/tts");
const antibot = require("./src/antibot");

// ── Captura errores globales ───────────────────────────────────
process.on("uncaughtException", (err) => {
  log.error("Error no capturado", err.message);
});

process.on("unhandledRejection", (reason) => {
  log.error("Promesa rechazada", reason);
});

// ── Servidor HTTP ──────────────────────────────────────────────
const app = express();
app.use(express.json()); // Necesario para el panel
const server = http.createServer(app);

// ── CORS ───────────────────────────────────────────────────────
// Usamos tu configuración original pero permitimos express.json
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "https://darkops-dasboard.netlify.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, POST, OPTIONS"); // Agregado POST
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.get("/", (req, res) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  res.sendFile(path.join(__dirname, "obs.html"));
});

app.use("/audio", express.static(path.join(__dirname, "data/audio")));
app.use("/font", express.static(path.join(__dirname, "font")));
app.use("/svg", express.static(path.join(__dirname, "svg")));

app.get("/cola", (req, res) => {
  res.json({ total: mongoQueue.total(), mensajes: mongoQueue.leer() });
});

app.delete("/cola", (req, res) => {
  mongoQueue.limpiar();
  res.json({ ok: true });
});

app.get("/stats", (req, res) => {
  res.json({
    cola: mongoQueue.stats(),
    websocket: ws.estadisticas(),
  });
});

// ── NUEVO: Endpoint Administrativo para Render ─────────────────
app.post("/admin/servicio/:accion", async (req, res) => {
  const { accion } = req.params;
  const { API_KEY, SERVICE_ID } = CONFIG.RENDER;

  if (!API_KEY || !SERVICE_ID) {
    log.warn("RENDER_API_KEY o SERVICE_ID no definidos.");
    return res.status(503).json({ error: "Servicio de Render no configurado" });
  }

  const endpoints = {
    restart: `https://api.render.com/v1/services/${SERVICE_ID}/deploys`,
    suspend: `https://api.render.com/v1/services/${SERVICE_ID}/suspend`,
    resume: `https://api.render.com/v1/services/${SERVICE_ID}/resume`,
  };

  if (!endpoints[accion]) return res.status(400).json({ error: "Acción inválida" });

  try {
    const response = await fetch(endpoints[accion], {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      log.info(`Comando ${accion.toUpperCase()} enviado a Render API.`);
      res.json({ status: "success", message: `Acción ${accion} procesada` });
    } else {
      const errorData = await response.json();
      res.status(response.status).json({ error: "Render API Error", details: errorData });
    }
  } catch (err) {
    res.status(500).json({ error: "Network Error", details: err.message });
  }
});

// ── WebSocket ──────────────────────────────────────────────────
// Usamos el nombre 'inicializar' que es el que tienes en websocket.js
ws.inicializar(server);

ws.alTerminar((id) => {
  log.info(`TTS terminado, eliminando ID: ${id}`);
  mongoQueue.eliminar(id);

  setTimeout(async () => {
    const siguiente = await mongoQueue.obtenerPrimero();
    if (!siguiente) return log.info("Cola vacía");

    log.info(`Enviando siguiente: ${siguiente.usuario}`);

    if (siguiente.rutaAudio) {
      const audioBase64 = tts.audioABase64(siguiente.rutaAudio);
      await mongoQueue.marcarComoeproduciendo(siguiente.id);
      ws.enviar({ tipo: "nuevo", ...siguiente, audioBase64 });
    } else {
      log.info("Esperando audio del siguiente...");
      const esperar = setInterval(async () => {
        const actualizado = await mongoQueue.obtenerPrimero();
        if (actualizado?.rutaAudio) {
          clearInterval(esperar);
          const audioBase64 = tts.audioABase64(actualizado.rutaAudio);
          await mongoQueue.marcarComoeproduciendo(actualizado.id);
          ws.enviar({ tipo: "nuevo", ...actualizado, audioBase64 });
        }
      }, 200);
      setTimeout(() => clearInterval(esperar), 10000);
    }
  }, 300);
});

ws.alConectar(async () => {
  const primero = await mongoQueue.obtenerPrimero();
  if (primero) {
    log.info(`OBS conectó, enviando mensaje pendiente: ${primero.usuario}`);
    const audioBase64 = primero.rutaAudio
      ? tts.audioABase64(primero.rutaAudio)
      : null;
    if (primero.rutaAudio) {
      await mongoQueue.marcarComoeproduciendo(primero.id);
    }
    ws.enviar({ tipo: "nuevo", ...primero, audioBase64 });
  }
});

// ── Inicializar ────────────────────────────────────────────────
(async () => {
  try {
    await mongoQueue.conectar();
    antibot.conectar();

    const pendientes = await mongoQueue.total();
    if (pendientes > 0) {
      log.warn(`${pendientes} mensajes pendientes de la sesión anterior — limpiando...`);
      await mongoQueue.limpiar();
    }

    // ── Arrancar servidor con comprobación de puerto libre ─────
    const net = require("net");
    let portToTry = CONFIG.PUERTO || 3000;
    const maxAttempts = 5;

    for (let i = 0; i < maxAttempts; i++) {
      const free = await new Promise((resolve) => {
        const tester = net
          .createServer()
          .once("error", () => resolve(false))
          .once("listening", () => tester.close(() => resolve(true)))
          .listen(portToTry);
      });

      if (free) break;
      log.warn(`Puerto ${portToTry} en uso, intentando ${portToTry + 1}...`);
      portToTry += 1;
    }

    server.listen(portToTry, () => {
      const urlPublica = CONFIG.APP_URL || `http://localhost:${portToTry}`;
      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("  🎙️  BOT !habla arriba y corriendo");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`  🌐  Servidor:  ${urlPublica}`);
      console.log(`  📋  Cola:      ${urlPublica}/cola`);
      console.log(`  📊  Stats:     ${urlPublica}/stats`);
      console.log(`  📺  OBS URL:   ${urlPublica}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    });
  } catch (err) {
    log.error("Error en inicialización", err.message);
    process.exit(1);
  }
})();

// ── Ping propio (solo en producción en la nube) ────────────────
if (CONFIG.APP_URL) {
  setInterval(() => {
    https.get(CONFIG.APP_URL, (res) => {
      log.debug(`Ping propio: ${res.statusCode}`);
    }).on("error", (err) => {
      log.warn("Ping fallido", err.message);
    });
  }, 4 * 60 * 1000);
}

twitch.conectar();
