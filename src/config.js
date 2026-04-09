// ============================================
//  config.js - Configuración central del bot.
// ============================================

module.exports = {
  // --- Twitch ---
  BOT_USERNAME: process.env.BOT_USERNAME || "nombre_de_tu_bot", // Cuenta Twitch del bot
  BOT_TOKEN: process.env.BOT_TOKEN || "", // twitchapps.com/tmi
  CANAL: process.env.CANAL || "", // Sin el #

  // --- Servidor ---
  PUERTO: 3000,
  APP_URL: process.env.APP_URL || null,

  // --- Comandos ---
  PREFIJO_COMANDO: "!habla", // Voz en español
  PREFIJO_COMANDO_EN: "!speak", // Voz en inglés

  // --- Comportamiento ---
  COOLDOWN_SEGUNDOS: 10,
  SOLO_SUBS: false,
  MAX_CARACTERES: 150,
  MAX_COLA: 20,

  // --- MongoDB (antibot) ---
  MONGODB_URI: process.env.MONGODB_URI || "",
  MONGODB_DB: process.env.MONGODB_DB || "",

  // --- TTS ---
  TTS_RATE: 1.05,
  TTS_PITCH: 1,
};
