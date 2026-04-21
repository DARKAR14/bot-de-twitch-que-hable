// ============================================
//  config.js - Configuración central del bot.
// ============================================

require("dotenv").config();

const { createLogger } = require("./logger");
const log = createLogger("CONFIG");

const CONFIG = {
  // --- Twitch ---

  BOT_USERNAME: process.env.BOT_USERNAME || "nombre_de_tu_bot", // Cuenta Twitch del bot
  BOT_TOKEN: process.env.BOT_TOKEN || "", // twitchapps.com/tmi
  CANAL: process.env.CANAL || "", // Sin el #
  MONGODB_URI: process.env.MONGODB_URI || "",
  MONGODB_DB: process.env.MONGODB_DB || "hablabot",

  // --- Servidor ---
  PUERTO: parseInt(process.env.PUERTO) || 3000,
  APP_URL: process.env.APP_URL || null,

  // --- Comandos TTS por idioma ---
  PREFIJO_COMANDO: "!habla", // 🇪🇸 Español
  PREFIJO_COMANDO_EN: "!speak", // 🇺🇸 Inglés
  PREFIJO_COMANDO_JP: "!onichan", // 🇯🇵 Japonés
  PREFIJO_COMANDO_RU: "!sukablad", // 🇷🇺 Ruso
  PREFIJO_COMANDO_PT: "!cr7", // 🇧🇷 Portugués

  // --- Comportamiento ---
  COOLDOWN_SEGUNDOS: parseInt(process.env.COOLDOWN_SEGUNDOS) || 10,
  SOLO_SUBS: process.env.SOLO_SUBS === "true",
  MAX_CARACTERES: parseInt(process.env.MAX_CARACTERES) || 150,
  MAX_COLA: parseInt(process.env.MAX_COLA) || 20,

  // --- MongoDB (antibot) ---
  MONGODB_URI: process.env.MONGODB_URI || "",
  MONGODB_DB: process.env.MONGODB_DB || "hablabot",

  // --- TTS ---
  TTS_RATE: parseFloat(process.env.TTS_RATE) || 1.05,
  TTS_PITCH: parseFloat(process.env.TTS_PITCH) || 1,
};

// ── Validación al arrancar ─────────────────────────────────────
const REQUERIDAS = ["BOT_USERNAME", "BOT_TOKEN", "CANAL"];

function validate() {
  const faltantes = REQUERIDAS.filter((k) => !CONFIG[k]);

  if (faltantes.length > 0) {
    log.error("Faltan variables de entorno obligatorias:");
    faltantes.forEach((k) => log.error(`  → ${k} no está definida`));
    log.error("Crea un archivo .env en la raíz con esas variables y reinicia.");
    process.exit(1);
  }

  if (!CONFIG.MONGODB_URI)
    log.warn("MONGODB_URI no configurado — antibot desactivado");
  if (!CONFIG.APP_URL)
    log.warn("APP_URL no configurado — ping propio desactivado");

  log.info(`Canal: #${CONFIG.CANAL} | Puerto: ${CONFIG.PUERTO}`);
  log.info(
    `Comandos: ${CONFIG.PREFIJO_COMANDO} (ES) | ${CONFIG.PREFIJO_COMANDO_EN} (EN) | ${CONFIG.PREFIJO_COMANDO_JP} (JP) | ${CONFIG.PREFIJO_COMANDO_RU} (RU) | ${CONFIG.PREFIJO_COMANDO_PT} (PT)`,
  );
  log.info(
    `Cooldown: ${CONFIG.COOLDOWN_SEGUNDOS}s | Max chars: ${CONFIG.MAX_CARACTERES} | Max cola: ${CONFIG.MAX_COLA}`,
  );
}

module.exports = { ...CONFIG, validate };
