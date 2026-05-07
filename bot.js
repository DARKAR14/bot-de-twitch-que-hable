// ============================================
//   bot.js - Servidor principal del Bot TTS
// ============================================

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("ws");
const https = require("https");

// Importación de módulos internos (según tu estructura de carpetas)
const CONFIG = require("./src/config");
const { createLogger } = require("./src/logger");
const twitch = require("./src/twitch");
const mongoQueue = require("./src/mongoQueue"); // O el gestor de cola que uses
const websocket = require("./src/websocket");

// ── Inicialización ─────────────────────────────────────────────
CONFIG.validate(); // Valida variables de entorno al arrancar
const log = createLogger("SERVER");
const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// ── Configuración de WebSocket (Para OBS y Panel) ─────────────
const wss = new Server({ server });
websocket.init(wss);

// ── Endpoints de la API ────────────────────────────────────────

// Obtener cola actual y stats
app.get("/cola", async (req, res) => {
  try {
    const mensajes = await mongoQueue.getCola();
    const stats = await mongoQueue.getStats();
    res.json({ status: "ok", mensajes, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats del Bot (Uptime, clientes conectados, etc)
app.get("/stats", (req, res) => {
  res.json({
    uptime: process.uptime(),
    websocket: websocket.getStats(),
    memoria: process.memoryUsage(),
  });
});

// Limpiar cola (Desde el panel)
app.delete("/cola", async (req, res) => {
  try {
    await mongoQueue.limpiarCola();
    websocket.broadcast({ tipo: "limpiar" });
    res.json({ status: "ok", message: "Cola vaciada" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Marcar como reproducido (Desde OBS)
app.put("/tts/:id/play", async (req, res) => {
  try {
    await mongoQueue.marcarReproducido(req.params.id);
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Endpoint Administrativo para Render ────────────────────────
app.post("/admin/servicio/:accion", async (req, res) => {
  const { accion } = req.params;
  const { API_KEY, SERVICE_ID } = CONFIG.RENDER;

  if (!API_KEY || !SERVICE_ID) {
    log.warn("Intento de control de servicio sin API KEY configurada.");
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
      log.info(`Orden de ${accion.toUpperCase()} enviada a Render API.`);
      res.json({ status: "success", message: `Acción ${accion} procesada` });
    } else {
      const errorData = await response.json();
      log.error(`Render API falló: ${JSON.stringify(errorData)}`);
      res.status(response.status).json({ error: "Render API Error", details: errorData });
    }
  } catch (err) {
    log.error(`Error de red con Render: ${err.message}`);
    res.status(500).json({ error: "Network Error", details: err.message });
  }
});

// ── Lógica de Inicio ───────────────────────────────────────────

(async () => {
  try {
    // 1. Conectar a Base de Datos
    await mongoQueue.conectar();
    log.info("Conexión a base de datos establecida.");

    // 2. Iniciar Servidor HTTP
    let portToTry = CONFIG.PUERTO;
    server.listen(portToTry, () => {
      const urlPublica = CONFIG.APP_URL || `http://localhost:${portToTry}`;
      console.log("\n-------------------------------------------");
      console.log(" 🎙️   BOT !habla arriba y corriendo");
      console.log("-------------------------------------------");
      console.log(` 🌐  Servidor:  ${urlPublica}`);
      console.log(` 📋  Cola:      ${urlPublica}/cola`);
      console.log(` 📊  Stats:     ${urlPublica}/stats`);
      console.log(` 🔌  WS URL:    ${urlPublica.replace("http", "ws")}`);
      console.log("-------------------------------------------\n");
    });

    // 3. Ping propio (Solo en producción para evitar que Render duerma el bot)
    if (CONFIG.APP_URL) {
      setInterval(() => {
        https.get(CONFIG.APP_URL, (res) => {
          log.debug(`Ping de mantenimiento: ${res.statusCode}`);
        }).on("error", (err) => {
          log.warn(`Ping fallido: ${err.message}`);
        });
      }, 4 * 60 * 1000); // Cada 4 minutos
    }

    // 4. Conectar a Twitch
    twitch.conectar();

  } catch (err) {
    log.error(`Error en inicialización: ${err.message}`);
    process.exit(1);
  }
})();

// Manejo de errores no capturados
process.on("unhandledRejection", (reason, promise) => {
  log.error("Rechazo no manejado en:", promise, "razón:", reason);
});
