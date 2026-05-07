// ============================================
//   bot.js - Servidor principal del Bot TTS
// ============================================

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("ws");
const https = require("https");

// Importación de módulos internos
const CONFIG = require("./src/config");
const { createLogger } = require("./src/logger");
const twitch = require("./src/twitch");
const mongoQueue = require("./src/mongoQueue");
const websocket = require("./src/websocket");

// ── Inicialización ─────────────────────────────────────────────
CONFIG.validate();
const log = createLogger("SERVER");
const app = express();

// Middlewares críticos
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// ── Configuración de WebSocket (Para OBS y Panel) ─────────────
const wss = new Server({ server });
websocket.init(wss);

// ── Endpoints de la API ────────────────────────────────────────

// 1. Obtener cola actual y stats
app.get("/cola", async (req, res) => {
  try {
    const mensajes = await mongoQueue.getCola();
    const stats = await mongoQueue.getStats();
    res.json({ status: "ok", mensajes, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Stats del Bot (Uptime, clientes conectados, etc)
app.get("/stats", (req, res) => {
  res.json({
    uptime: process.uptime(),
    websocket: websocket.getStats(),
    memoria: process.memoryUsage(),
  });
});

// 3. Limpiar cola (Desde el panel)
app.delete("/cola", async (req, res) => {
  try {
    await mongoQueue.limpiarCola();
    websocket.broadcast({ tipo: "limpiar" });
    res.json({ status: "ok", message: "Cola vaciada" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Marcar como reproducido (Desde OBS)
app.put("/tts/:id/play", async (req, res) => {
  try {
    await mongoQueue.marcarReproducido(req.params.id);
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

  if (!endpoints[accion])
    return res.status(400).json({ error: "Acción inválida" });

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
      res
        .status(response.status)
        .json({ error: "Render API Error", details: errorData });
    }
  } catch (err) {
    res.status(500).json({ error: "Network Error", details: err.message });
  }
});

// ── Lógica de Inicio del Bot ───────────────────────────────────

(async () => {
  try {
    // 1. Conectar a MongoDB
    await mongoQueue.conectar();
    log.info("MongoDB conectado correctamente.");

    // 2. Iniciar Servidor HTTP
    server.listen(CONFIG.PUERTO, () => {
      const urlPublica = CONFIG.APP_URL || `http://localhost:${CONFIG.PUERTO}`;
      console.log("\n-------------------------------------------");
      console.log(" 🎙️   BOT !habla arriba y corriendo");
      console.log("-------------------------------------------");
      console.log(` 🌐  Servidor:  ${urlPublica}`);
      console.log(` 📋  Cola:      ${urlPublica}/cola`);
      console.log(` 📊  Stats:     ${urlPublica}/stats`);
      console.log("-------------------------------------------\n");
    });

    // 3. Ping propio (Mantiene vivo el bot en Render Plan Gratuito)
    if (CONFIG.APP_URL) {
      setInterval(
        () => {
          https
            .get(CONFIG.APP_URL, (res) => {
              log.debug(`Ping de mantenimiento: ${res.statusCode}`);
            })
            .on("error", (err) => {
              log.warn(`Ping fallido: ${err.message}`);
            });
        },
        4 * 60 * 1000,
      ); // 4 minutos
    }

    // 4. Conectar a Twitch TMI
    twitch.conectar();
  } catch (err) {
    log.error(`Error fatal en el arranque: ${err.message}`);
    process.exit(1);
  }
})();

// Captura de errores globales para que el proceso no muera
process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled Rejection at:", promise, "reason:", reason);
});
