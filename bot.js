// ============================================
//  bot.js - Punto de entrada principal
// ============================================

const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { createLogger } = require("./src/logger");

const log = createLogger("BOT");
const CONFIG = require("./src/config");
const queue = require("./src/queue");
const ws = require("./src/websocket");
const playback = require("./src/playback");
const twitch = require("./src/twitch");
const tts = require("./src/tts");
const ai = require("./src/ai");
const usage = require("./src/usage");

CONFIG.validate();
queue.inicializar({ limpiarAlArrancar: true });
fs.mkdirSync(tts.AUDIO_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const INSTANCE_ID = `${process.pid}-${Date.now()}`;
let pingInterval = null;
let cerrando = false;

log.info(`Arrancando instancia ${INSTANCE_ID}`);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin === CONFIG.DASHBOARD_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Admin-Token, X-Chat-Token",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const apiConfig = {
  textColor: "#eb8352",
  messageColor: "#f0f0f0",
  background: "rgba(10, 10, 20, 0.92)",
  borderColor: "#ea8352",
  barGradient: "linear-gradient(90deg, #eb8352, #ea8352)",
  voiceLang: "es-ES",
  voiceRate: CONFIG.TTS_RATE,
  voicePitch: CONFIG.TTS_PITCH,
  ttsProvider:
    CONFIG.TTS_PROVIDER === "fish" && CONFIG.FISH_API_KEY
      ? "fish"
      : CONFIG.TTS_PROVIDER === "google" || !CONFIG.GEMINI_API_KEY
        ? "google"
        : "gemini",
  ttsVoice: CONFIG.GEMINI_API_KEY ? CONFIG.GEMINI_COAST_VOICE : null,
};

function colaPublica() {
  return queue.leer().map(({ rutaAudio, errorTts, ...entrada }) => entrada);
}

function tokenAdministrativoValido(req) {
  if (!CONFIG.ADMIN_TOKEN) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return bearer === CONFIG.ADMIN_TOKEN || req.headers["x-admin-token"] === CONFIG.ADMIN_TOKEN;
}

function validarColor(valor) {
  return typeof valor === "string" && /^#[0-9a-f]{6}$/i.test(valor);
}

app.get("/", (req, res) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  res.sendFile(path.join(__dirname, "obs.html"));
});

app.get("/chat", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "chat.html"));
});

app.get("/api/chat/config", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    authRequired: Boolean(CONFIG.CHAT_TOKEN),
    maxName: CONFIG.CHAT_MAX_NAME,
    maxMessage: CONFIG.MAX_CARACTERES,
    cooldownSeconds: CONFIG.CHAT_COOLDOWN_SEGUNDOS,
    voices: twitch.vocesWeb(),
  });
});

function tokenChatValido(req) {
  if (!CONFIG.CHAT_TOKEN) return true;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return (
    bearer === CONFIG.CHAT_TOKEN ||
    req.headers["x-chat-token"] === CONFIG.CHAT_TOKEN
  );
}

app.post("/api/chat", (req, res) => {
  if (!tokenChatValido(req)) {
    return res.status(401).json({
      ok: false,
      code: "UNAUTHORIZED",
      error: "Token del chat incorrecto.",
    });
  }

  const resultado = twitch.encolarDesdeWeb({
    name: req.body?.name,
    message: req.body?.message,
    voice: req.body?.voice,
    clientKey: req.ip,
  });
  const { status, ...body } = resultado;
  if (resultado.retryAfter) {
    res.setHeader("Retry-After", String(resultado.retryAfter));
  }
  return res.status(status || 500).json(body);
});

app.get("/config", (req, res) => res.sendFile(path.join(__dirname, "config.html")));
app.use("/font", express.static(path.join(__dirname, "font"), { maxAge: "7d" }));
app.use("/svg", express.static(path.join(__dirname, "svg"), { maxAge: "7d" }));

app.get(["/cola", "/api/cola"], (req, res) => {
  const mensajes = colaPublica();
  res.json({ total: mensajes.length, mensajes });
});

app.delete("/cola", (req, res) => {
  const eliminados = playback.limpiar();
  res.json({ ok: true, eliminados });
});

app.get("/stats", (req, res) => {
  res.json({
    instancia: INSTANCE_ID,
    cola: queue.stats(),
    playback: playback.estado(),
    websocket: ws.estadisticas(),
    tts: {
      provider: apiConfig.ttsProvider,
      voice: apiConfig.ttsVoice,
      fishConfigurado: Boolean(CONFIG.FISH_API_KEY && CONFIG.FISH_REFERENCE_ID),
      ...tts.stats(),
    },
    ia: ai.stats(),
    consumo: usage.resumen(),
  });
});

app.get("/api/config", (req, res) => res.json(apiConfig));
app.post("/api/config", (req, res) => {
  const body = req.body || {};
  for (const clave of ["textColor", "messageColor", "borderColor"]) {
    if (validarColor(body[clave])) apiConfig[clave] = body[clave];
  }
  if (validarColor(body.background)) apiConfig.background = body.background;
  if (
    typeof body.barGradient === "string" &&
    body.barGradient.length <= 150 &&
    /^(linear-gradient|#[0-9a-f]{6})/i.test(body.barGradient)
  ) {
    apiConfig.barGradient = body.barGradient;
  }
  if (Number.isFinite(body.voiceRate)) {
    apiConfig.voiceRate = Math.min(2, Math.max(0.5, body.voiceRate));
  }
  if (Number.isFinite(body.voicePitch)) {
    apiConfig.voicePitch = Math.min(2, Math.max(0, body.voicePitch));
  }
  res.json({ ok: true, config: apiConfig });
});

app.get("/swagger.json", (req, res) => {
  const archivo = path.join(__dirname, "swagger.json");
  if (!fs.existsSync(archivo)) return res.sendStatus(404);
  res.sendFile(archivo);
});

app.post("/admin/servicio/:accion", async (req, res) => {
  if (!tokenAdministrativoValido(req)) {
    return res.status(CONFIG.ADMIN_TOKEN ? 401 : 503).json({ error: "Administracion no configurada" });
  }

  const { API_KEY, SERVICE_ID } = CONFIG.RENDER;
  if (!API_KEY || !SERVICE_ID) {
    return res.status(503).json({ error: "Render API no configurada" });
  }

  const endpoints = {
    restart: `https://api.render.com/v1/services/${SERVICE_ID}/deploys`,
    suspend: `https://api.render.com/v1/services/${SERVICE_ID}/suspend`,
    resume: `https://api.render.com/v1/services/${SERVICE_ID}/resume`,
  };
  const endpoint = endpoints[req.params.accion];
  if (!endpoint) return res.status(400).json({ error: "Accion invalida" });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
    });
    const detalle = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: "Render API Error", detalle });
    }
    res.json({ ok: true, accion: req.params.accion });
  } catch (err) {
    res.status(502).json({ error: "No se pudo contactar Render", detalle: err.message });
  }
});

ws.inicializar(server);
playback.inicializar();

server.listen(CONFIG.PUERTO, () => {
  const url = CONFIG.APP_URL || `http://localhost:${CONFIG.PUERTO}`;
  log.info(`Servidor listo: ${url} | OBS WebSocket: ${url.replace(/^http/, "ws")}/ws`);
  twitch.conectar();
});

if (CONFIG.APP_URL) {
  pingInterval = setInterval(() => {
    try {
      const url = new URL(CONFIG.APP_URL);
      const cliente = url.protocol === "http:" ? http : https;
      cliente.get(url, (res) => res.resume()).on("error", (err) => {
        log.warn("Ping propio fallido", err.message);
      });
    } catch (err) {
      log.warn("APP_URL invalida", err.message);
    }
  }, 4 * 60 * 1000);
  pingInterval.unref?.();
}

async function apagar(senal, codigo = 0) {
  if (cerrando) return;
  cerrando = true;
  log.warn(`Apagando por ${senal}`);
  if (pingInterval) clearInterval(pingInterval);
  playback.detener();
  ws.cerrar();
  await twitch.desconectar();
  server.close(() => process.exit(codigo));
  setTimeout(() => process.exit(codigo || 1), 5000).unref?.();
}

process.once("SIGINT", () => apagar("SIGINT"));
process.once("SIGTERM", () => apagar("SIGTERM"));
process.on("uncaughtException", (err) => {
  log.error("Error no capturado", err);
  apagar("uncaughtException", 1);
});
process.on("unhandledRejection", (err) => {
  log.error("Promesa rechazada", err);
});
