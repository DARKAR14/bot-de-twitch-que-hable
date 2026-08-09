// ============================================
//  config.js - Configuracion central del bot
// ============================================

require("dotenv").config({ quiet: true });

const { createLogger } = require("./logger");
const log = createLogger("CONFIG");

function numeroEntero(nombre, fallback, minimo, maximo) {
  const valor = Number.parseInt(process.env[nombre], 10);
  if (!Number.isFinite(valor)) return fallback;
  return Math.min(maximo, Math.max(minimo, valor));
}

function numeroDecimal(nombre, fallback, minimo, maximo) {
  const valor = Number.parseFloat(process.env[nombre]);
  if (!Number.isFinite(valor)) return fallback;
  return Math.min(maximo, Math.max(minimo, valor));
}

const proveedorSolicitado = (process.env.TTS_PROVIDER || "auto").toLowerCase();
const proveedorValido = ["auto", "gemini", "google"].includes(proveedorSolicitado)
  ? proveedorSolicitado
  : "auto";

const CONFIG = {
  // Twitch
  BOT_USERNAME: process.env.BOT_USERNAME || "",
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  CANAL: process.env.CANAL || "",

  // Servidor
  PUERTO: numeroEntero("PORT", numeroEntero("PUERTO", 3000, 1, 65535), 1, 65535),
  APP_URL: process.env.APP_URL || null,
  DASHBOARD_ORIGIN:
    process.env.DASHBOARD_ORIGIN || "https://darkops-dasboard.netlify.app",
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || null,
  WS_TOKEN: process.env.WS_TOKEN || null,
  WS_MAX_PAYLOAD: numeroEntero("WS_MAX_PAYLOAD", 64 * 1024, 1024, 1024 * 1024),
  PLAYBACK_TIMEOUT_MS: numeroEntero(
    "PLAYBACK_TIMEOUT_MS",
    90_000,
    10_000,
    300_000,
  ),

  // Control opcional de Render
  RENDER: {
    API_KEY: process.env.RENDER_API_KEY || null,
    SERVICE_ID: process.env.RENDER_SERVICE_ID || null,
  },

  // Comandos TTS por idioma
  PREFIJO_COMANDO: "!habla",
  PREFIJO_COMANDO_EN: "!speak",
  PREFIJO_COMANDO_JP: "!onichan",
  PREFIJO_COMANDO_RU: "!sukablad",
  PREFIJO_COMANDO_PT: "!cr7",

  // Comportamiento
  COOLDOWN_SEGUNDOS: numeroEntero("COOLDOWN_SEGUNDOS", 10, 0, 3600),
  SOLO_SUBS: process.env.SOLO_SUBS === "true",
  MAX_CARACTERES: numeroEntero("MAX_CARACTERES", 150, 1, 500),
  MAX_COLA: numeroEntero("MAX_COLA", 20, 1, 100),

  // Voz
  TTS_PROVIDER: proveedorValido,
  TTS_CONCURRENCY: numeroEntero("TTS_CONCURRENCY", 2, 1, 5),
  TTS_REQUEST_TIMEOUT_MS: numeroEntero(
    "TTS_REQUEST_TIMEOUT_MS",
    25_000,
    5_000,
    60_000,
  ),
  TTS_RETRIES: numeroEntero("TTS_RETRIES", 2, 1, 4),
  TTS_RATE: numeroDecimal("TTS_RATE", 1.05, 0.5, 2),
  TTS_PITCH: numeroDecimal("TTS_PITCH", 1, 0, 2),
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || null,
  GEMINI_TTS_MODEL:
    process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts",
  GEMINI_TTS_VOICE: process.env.GEMINI_TTS_VOICE || "Aoede",
  GEMINI_TTS_STYLE:
    process.env.GEMINI_TTS_STYLE ||
    "cheerful, warm, spontaneous and natural Colombian woman from the Caribbean coast, with a subtle costeño accent, expressive conversational intonation, a lively medium pace and clear diction; sound human rather than robotic or like an announcer, and never caricature or exaggerate the accent",
};

function validate() {
  const requeridas = ["BOT_USERNAME", "BOT_TOKEN", "CANAL"];
  const faltantes = requeridas.filter((clave) => !CONFIG[clave]);

  if (faltantes.length > 0) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${faltantes.join(", ")}`,
    );
  }

  if (CONFIG.TTS_PROVIDER === "gemini" && !CONFIG.GEMINI_API_KEY) {
    log.warn(
      "TTS_PROVIDER=gemini sin GEMINI_API_KEY; se usara Google Translate como respaldo",
    );
  }

  const proveedorEfectivo =
    CONFIG.TTS_PROVIDER === "google" || !CONFIG.GEMINI_API_KEY
      ? "google"
      : "gemini";

  log.info(`Canal: #${CONFIG.CANAL} | Puerto: ${CONFIG.PUERTO}`);
  log.info(
    `TTS: ${proveedorEfectivo}${proveedorEfectivo === "gemini" ? ` (${CONFIG.GEMINI_TTS_VOICE})` : ""}`,
  );
}

module.exports = { ...CONFIG, validate };
