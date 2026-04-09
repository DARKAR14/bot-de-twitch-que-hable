// ============================================
//  twitch.js - Conexión y lógica del bot
// ============================================

const tmi = require("tmi.js");
const CONFIG = require("./config");
const queue = require("./queue");
const ws = require("./websocket");
const tts = require("./tts");
const antibot = require("./antibot");

const cooldowns = new Map();
let client = null;

function crearCliente() {
  return new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    identity: {
      username: CONFIG.BOT_USERNAME,
      password: CONFIG.BOT_TOKEN,
    },
    channels: [CONFIG.CANAL],
  });
}

async function manejarMensaje(channel, tags, message, self) {
  if (self) return;

  const msg = message.trim();
  const usuario = tags["display-name"] || tags.username;
  const esMod = tags.mod || tags.badges?.broadcaster;
  const esSub = tags.subscriber || esMod;

  // ── Antibot: revisar TODOS los mensajes del chat ────────────
  if (CONFIG.MONGODB_URI) {
    const esSpam = await antibot.esBot(msg);
    if (esSpam) {
      console.log(`🚫 Bot detectado: ${usuario} — "${msg.slice(0, 60)}"`);
      await antibot.registrarBaneo(usuario, msg, "patrón detectado");
      client
        .say(channel, `/ban ${usuario} Bot de spam detectado automáticamente`)
        .catch(() => {});
      return;
    }
  }

  // ── Comando !addbot (solo mods) ─────────────────────────────
  if (msg.toLowerCase().startsWith("!addbot ") && esMod) {
    const patron = msg.slice(8).trim();
    if (patron) {
      const ok = await antibot.agregarPatron(patron);
      if (ok)
        client
          .say(channel, `✅ Patrón "${patron}" agregado a la lista antibot`)
          .catch(() => {});
    }
    return;
  }

  // ── Detectar qué comando se usó ─────────────────────────────
  const msgLower = msg.toLowerCase();
  const esHabla = msgLower.startsWith(CONFIG.PREFIJO_COMANDO);
  const esSpeak = msgLower.startsWith(CONFIG.PREFIJO_COMANDO_EN);

  if (!esHabla && !esSpeak) return;

  const idioma = esSpeak ? "en" : "es";
  const prefijo = esSpeak ? CONFIG.PREFIJO_COMANDO_EN : CONFIG.PREFIJO_COMANDO;
  const flag = idioma === "es" ? "🇪🇸" : "🇺🇸";

  // Permiso de sub
  if (CONFIG.SOLO_SUBS && !esSub) {
    client
      .say(
        channel,
        `@${usuario} ¡Solo los suscriptores pueden usar ${prefijo}!`,
      )
      .catch(() => {});
    return;
  }

  // Cooldown (mods sin cooldown)
  if (!esMod) {
    const ahora = Date.now();
    const ultimoUso = cooldowns.get(usuario) || 0;
    const restante = Math.ceil(
      (CONFIG.COOLDOWN_SEGUNDOS * 1000 - (ahora - ultimoUso)) / 1000,
    );
    if (restante > 0) {
      client
        .say(
          channel,
          `@${usuario} espera ${restante}s para usar el comando de nuevo.`,
        )
        .catch(() => {});
      return;
    }
    cooldowns.set(usuario, ahora);
  }

  // Extraer y limpiar texto
  let texto = msg.slice(prefijo.length).trim();

  if (!texto) {
    client
      .say(channel, `@${usuario} escribe algo después de ${prefijo} 😅`)
      .catch(() => {});
    return;
  }

  // Limpiar letras repetidas (AAAAAAA → AAAA)
  texto = antibot.limpiarRepeticiones(texto, 4);

  // Cortar si excede el máximo
  if (texto.length > CONFIG.MAX_CARACTERES) {
    texto = texto.slice(0, CONFIG.MAX_CARACTERES);
  }

  // Límite de cola
  if (queue.total() >= CONFIG.MAX_COLA) {
    client
      .say(channel, `@${usuario} la cola está llena. Espera un momento.`)
      .catch(() => {});
    return;
  }

  // Agregar a cola y generar audio
  console.log(`${flag} ${prefijo} | ${usuario}: "${texto}"`);
  const esPrimero = queue.total() === 0;
  const entrada = queue.agregar({ usuario, mensaje: texto });

  tts
    .generarAudio(texto, idioma)
    .then((rutaAudio) => {
      const audioBase64 = tts.audioABase64(rutaAudio);
      queue.actualizarAudio(entrada.id, rutaAudio);
      if (esPrimero) ws.enviar({ tipo: "nuevo", ...entrada, audioBase64 });
    })
    .catch((err) => {
      console.error("❌ Error generando TTS:", err.message);
      if (esPrimero)
        ws.enviar({ tipo: "nuevo", ...entrada, audioBase64: null });
    });
}

function conectar() {
  client = crearCliente();
  client.on("message", manejarMensaje);

  client.on("connected", (addr, port) => {
    console.log(`✅ Bot conectado a Twitch — ${addr}:${port}`);
    console.log(`📺 Canal: #${CONFIG.CANAL}`);
    console.log(
      `🎙️  Comandos: ${CONFIG.PREFIJO_COMANDO} (español) | ${CONFIG.PREFIJO_COMANDO_EN} (inglés)`,
    );
  });

  client.on("disconnected", (reason) => {
    console.warn(`⚠️  Bot desconectado: ${reason}`);
  });

  client.connect().catch((err) => {
    console.error("❌ Error conectando bot:", err.message);
    setTimeout(conectar, 10000);
  });
}

module.exports = { conectar };
