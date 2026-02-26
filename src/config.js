// ============================================
//  config.js - Configuración central del bot
// ============================================

module.exports = {
  // --- Twitch ---
  BOT_USERNAME:      process.env.BOT_USERNAME || 'nombre_de_tu_bot',     // Cuenta Twitch del bot
  BOT_TOKEN:         process.env.BOT_TOKEN    || '',  // twitchapps.com/tmi
  CANAL:             process.env.CANAL        || '',     // Sin el #

  // --- Servidor ---
  PUERTO:            3000,
  APP_URL:           process.env.APP_URL || null,
  // --- Comportamiento ---
  PREFIJO_COMANDO:   '!habla',
  COOLDOWN_SEGUNDOS: 10,       // Tiempo entre usos por usuario
  SOLO_SUBS:         false,    // true = solo subs pueden usar el comando
  MAX_CARACTERES:    150,      // Máximo de caracteres por mensaje
  MAX_COLA:          20,       // Máximo de mensajes en cola a la vez

    // --- MongoDB (antibot) ---
  MONGODB_URI:       process.env.MONGODB_URI || '',  // MongoDB Atlas connection string
  MONGODB_DB:        process.env.MONGODB_DB  || '',
  TTS_LANG:          'es-ES',  // Idioma de la voz
  TTS_RATE:          1.05,     // Velocidad (0.5 - 2)
  TTS_PITCH:         1,        // Tono (0 - 2)
};