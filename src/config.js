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
const proveedorValido = ["auto", "fish", "gemini", "puter", "google"].includes(
  proveedorSolicitado,
)
  ? proveedorSolicitado
  : "auto";

const proveedorPuterSolicitado = (
  process.env.PUTER_TTS_PROVIDER || "xai"
).toLowerCase();
const proveedorPuterValido = [
  "openai",
  "gemini",
  "xai",
  "elevenlabs",
  "aws-polly",
].includes(proveedorPuterSolicitado)
  ? proveedorPuterSolicitado
  : "xai";

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
  CHAT_TOKEN: process.env.CHAT_TOKEN || null,
  WS_MAX_PAYLOAD: numeroEntero("WS_MAX_PAYLOAD", 64 * 1024, 1024, 1024 * 1024),
  PLAYBACK_TIMEOUT_MS: numeroEntero(
    "PLAYBACK_TIMEOUT_MS",
    90_000,
    10_000,
    300_000,
  ),
  QUEUE_GENERATION_TIMEOUT_MS: numeroEntero(
    "QUEUE_GENERATION_TIMEOUT_MS",
    100_000,
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
  PREFIJO_COMANDO_IA: "!ia",
  PREFIJO_COMANDO_PRUEBA: "!pruebavoz",
  PREFIJO_COMANDO_NARUTO: "!naruto",

  // Comportamiento
  COOLDOWN_SEGUNDOS: numeroEntero("COOLDOWN_SEGUNDOS", 10, 0, 3600),
  SOLO_SUBS: process.env.SOLO_SUBS === "true",
  MAX_CARACTERES: numeroEntero("MAX_CARACTERES", 150, 1, 500),
  MAX_COLA: numeroEntero("MAX_COLA", 20, 1, 100),
  CHAT_MAX_NAME: numeroEntero("CHAT_MAX_NAME", 30, 1, 60),
  CHAT_COOLDOWN_SEGUNDOS: numeroEntero("CHAT_COOLDOWN_SEGUNDOS", 5, 0, 3600),
  CHAT_GLOBAL_COOLDOWN_SEGUNDOS: numeroEntero(
    "CHAT_GLOBAL_COOLDOWN_SEGUNDOS",
    1,
    0,
    60,
  ),
  CHAT_LIMITE_DIARIO: numeroEntero("CHAT_LIMITE_DIARIO", 200, 1, 100_000),
  CHAT_LIMITE_USUARIO_DIARIO: numeroEntero(
    "CHAT_LIMITE_USUARIO_DIARIO",
    50,
    1,
    10_000,
  ),

  // Voz
  TTS_PROVIDER: proveedorValido,
  TTS_CONCURRENCY: numeroEntero("TTS_CONCURRENCY", 2, 1, 5),
  TTS_REQUEST_TIMEOUT_MS: numeroEntero(
    "TTS_REQUEST_TIMEOUT_MS",
    25_000,
    5_000,
    60_000,
  ),
  TTS_JOB_TIMEOUT_MS: numeroEntero(
    "TTS_JOB_TIMEOUT_MS",
    45_000,
    10_000,
    180_000,
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
  GEMINI_COAST_VOICE: process.env.GEMINI_COAST_VOICE || "Kore",
  GEMINI_COAST_STYLE:
    process.env.GEMINI_COAST_STYLE ||
    "an unmistakably feminine adult Colombian woman from Barranquilla, with a warm medium-low contralto register that never sounds masculine, confident and assertive yet playful, a slightly husky natural texture, quick conversational cadence, crisp articulation, expressive pitch movement and a subtle Caribbean Colombian accent; use natural pauses, never sound like an announcer, never caricature the accent, and never imitate or claim to be a real person",

  // Puter: respaldo adicional con consumo asociado a la cuenta del token
  PUTER_AUTH_TOKEN: process.env.PUTER_AUTH_TOKEN || null,
  PUTER_TTS_ENDPOINT:
    process.env.PUTER_TTS_ENDPOINT || "https://api.puter.com/drivers/call",
  PUTER_TTS_PROVIDER: proveedorPuterValido,
  PUTER_TTS_MODEL: process.env.PUTER_TTS_MODEL || null,
  PUTER_TTS_VOICE: process.env.PUTER_TTS_VOICE || null,
  PUTER_TTS_STYLE:
    process.env.PUTER_TTS_STYLE ||
    "Speak as a cheerful, warm and spontaneous adult Colombian woman from the Caribbean coast, with natural conversational rhythm, expressive intonation and clear diction. Sound human, never robotic or like an announcer, and do not imitate a real person.",
  PUTER_TTS_FORMAT: process.env.PUTER_TTS_FORMAT || "mp3",
  PUTER_TTS_ENGINE: process.env.PUTER_TTS_ENGINE || "neural",
  PUTER_TTS_ATTRIBUTION: process.env.PUTER_TTS_ATTRIBUTION || null,

  // Fish Audio (voz comunitaria; la atribucion se envia al dashboard)
  FISH_API_KEY: process.env.FISH_API_KEY || null,
  FISH_REFERENCE_ID:
    process.env.FISH_REFERENCE_ID || "c23b3ac076b44c07918ed2c54addc2c5",
  FISH_TTS_MODEL: process.env.FISH_TTS_MODEL || "s2.1-pro-free",
  FISH_TTS_ENDPOINT: process.env.FISH_TTS_ENDPOINT || "https://api.fish.audio/v1/tts",
  FISH_ATTRIBUTION:
    process.env.FISH_ATTRIBUTION ||
    "Voz IA no oficial inspirada en Diomedes Díaz · Fish Audio · modelo de saibormigue 369",
  FISH_NARUTO_REFERENCE_ID:
    process.env.FISH_NARUTO_REFERENCE_ID || "1412b58e859448d284f8f62391e82bd9",
  FISH_NARUTO_ATTRIBUTION:
    process.env.FISH_NARUTO_ATTRIBUTION ||
    "Voz IA no oficial inspirada en Naruto · Fish Audio · modelo de coach_frank1994",
  FISH_CACHE_TTL_MS: numeroEntero(
    "FISH_CACHE_TTL_MS",
    60 * 60 * 1000,
    0,
    24 * 60 * 60 * 1000,
  ),
  FISH_CACHE_MAX: numeroEntero("FISH_CACHE_MAX", 30, 0, 100),

  // Respuestas de !ia
  AI_MODEL: process.env.AI_MODEL || "gemini-3.5-flash-lite",
  AI_MAX_PREGUNTA: numeroEntero("AI_MAX_PREGUNTA", 220, 20, 500),
  AI_MAX_RESPUESTA: numeroEntero("AI_MAX_RESPUESTA", 280, 80, 500),
  AI_TIMEOUT_MS: numeroEntero("AI_TIMEOUT_MS", 20_000, 5_000, 60_000),
  AI_RETRIES: numeroEntero("AI_RETRIES", 2, 1, 4),
  AI_CACHE_TTL_MS: numeroEntero(
    "AI_CACHE_TTL_MS",
    30 * 60 * 1000,
    0,
    24 * 60 * 60 * 1000,
  ),
  AI_CACHE_MAX: numeroEntero("AI_CACHE_MAX", 100, 0, 500),
  // Presupuesto y proteccion antiabuso para comandos costosos
  FISH_COOLDOWN_SEGUNDOS: numeroEntero("FISH_COOLDOWN_SEGUNDOS", 45, 0, 3600),
  FISH_GLOBAL_COOLDOWN_SEGUNDOS: numeroEntero(
    "FISH_GLOBAL_COOLDOWN_SEGUNDOS",
    3,
    0,
    60,
  ),
  FISH_LIMITE_DIARIO: numeroEntero("FISH_LIMITE_DIARIO", 60, 1, 100_000),
  FISH_LIMITE_USUARIO_DIARIO: numeroEntero(
    "FISH_LIMITE_USUARIO_DIARIO",
    6,
    1,
    10_000,
  ),
  GEMINI_TTS_COOLDOWN_SEGUNDOS: numeroEntero(
    "GEMINI_TTS_COOLDOWN_SEGUNDOS",
    60,
    0,
    3600,
  ),
  GEMINI_TTS_GLOBAL_COOLDOWN_SEGUNDOS: numeroEntero(
    "GEMINI_TTS_GLOBAL_COOLDOWN_SEGUNDOS",
    22,
    0,
    60,
  ),
  GEMINI_TTS_LIMITE_DIARIO: numeroEntero(
    "GEMINI_TTS_LIMITE_DIARIO",
    9,
    1,
    100_000,
  ),
  GEMINI_TTS_LIMITE_USUARIO_DIARIO: numeroEntero(
    "GEMINI_TTS_LIMITE_USUARIO_DIARIO",
    2,
    1,
    10_000,
  ),
  PUTER_TTS_COOLDOWN_SEGUNDOS: numeroEntero(
    "PUTER_TTS_COOLDOWN_SEGUNDOS",
    60,
    0,
    3600,
  ),
  PUTER_TTS_GLOBAL_COOLDOWN_SEGUNDOS: numeroEntero(
    "PUTER_TTS_GLOBAL_COOLDOWN_SEGUNDOS",
    10,
    0,
    60,
  ),
  PUTER_TTS_LIMITE_DIARIO: numeroEntero(
    "PUTER_TTS_LIMITE_DIARIO",
    30,
    1,
    100_000,
  ),
  PUTER_TTS_LIMITE_USUARIO_DIARIO: numeroEntero(
    "PUTER_TTS_LIMITE_USUARIO_DIARIO",
    3,
    1,
    10_000,
  ),
  AI_COOLDOWN_SEGUNDOS: numeroEntero("AI_COOLDOWN_SEGUNDOS", 60, 0, 3600),
  AI_GLOBAL_COOLDOWN_SEGUNDOS: numeroEntero(
    "AI_GLOBAL_COOLDOWN_SEGUNDOS",
    4,
    0,
    60,
  ),
  AI_LIMITE_DIARIO: numeroEntero("AI_LIMITE_DIARIO", 60, 1, 100_000),
  AI_LIMITE_USUARIO_DIARIO: numeroEntero(
    "AI_LIMITE_USUARIO_DIARIO",
    5,
    1,
    10_000,
  ),
  USAGE_TIMEZONE: process.env.USAGE_TIMEZONE || "America/Bogota",
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

  if (CONFIG.TTS_PROVIDER === "fish" && !CONFIG.FISH_API_KEY) {
    log.warn(
      "TTS_PROVIDER=fish sin FISH_API_KEY; se usara Gemini o Google como respaldo",
    );
  }

  if (CONFIG.TTS_PROVIDER === "puter" && !CONFIG.PUTER_AUTH_TOKEN) {
    log.warn(
      "TTS_PROVIDER=puter sin PUTER_AUTH_TOKEN; se usara Google Translate como respaldo",
    );
  }

  let proveedorEfectivo = "google";
  if (CONFIG.TTS_PROVIDER === "fish" && CONFIG.FISH_API_KEY) {
    proveedorEfectivo = "fish";
  } else if (CONFIG.TTS_PROVIDER === "puter" && CONFIG.PUTER_AUTH_TOKEN) {
    proveedorEfectivo = "puter";
  } else if (CONFIG.TTS_PROVIDER === "gemini" && CONFIG.GEMINI_API_KEY) {
    proveedorEfectivo = "gemini";
  } else if (CONFIG.TTS_PROVIDER === "auto") {
    if (CONFIG.GEMINI_API_KEY) proveedorEfectivo = "gemini";
    else if (CONFIG.PUTER_AUTH_TOKEN) proveedorEfectivo = "puter";
  }

  log.info(`Canal: #${CONFIG.CANAL} | Puerto: ${CONFIG.PUERTO}`);
  log.info(
    `TTS: ${proveedorEfectivo}${proveedorEfectivo === "gemini" ? ` (${CONFIG.GEMINI_TTS_VOICE})` : ""} | !habla Gemini: ${CONFIG.GEMINI_COAST_VOICE} | Fish: ${CONFIG.FISH_API_KEY ? "configurado" : "sin API key"} | Puter: ${CONFIG.PUTER_AUTH_TOKEN ? `${CONFIG.PUTER_TTS_PROVIDER} configurado` : "sin token"}`,
  );
  if (!CONFIG.CHAT_TOKEN) {
    log.warn("CHAT_TOKEN no configurado; /chat quedara abierto con limites antiabuso");
  }
}

module.exports = { ...CONFIG, validate };
