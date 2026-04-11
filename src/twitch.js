// ============================================
//  twitch.js - Conexión y lógica del bot
// ============================================

const tmi = require("tmi.js");
const CONFIG = require("./config");
const queue = require("./queue");
const ws = require("./websocket");
const tts = require("./tts");
const antibot = require("./antibot");
const { createLogger } = require("./logger");

const log = createLogger("TWITCH");

// Cooldown compartido entre todos los comandos TTS por usuario
const cooldowns = new Map();

// Contador de pajas por usuario (se resetea al reiniciar el bot)
const pajas = new Map();

let client = null;
let intentoReconexion = 0;

function crearCliente() {
  return new tmi.Client({
    options: { debug: false },
    connection: { reconnect: false, secure: true },
    identity: {
      username: CONFIG.BOT_USERNAME,
      password: CONFIG.BOT_TOKEN,
    },
    channels: [CONFIG.CANAL],
  });
}

// Backoff exponencial: 3s → 6s → 12s → 24s → máx 60s
function calcularDelayReconexion() {
  const delay = Math.min(3000 * Math.pow(2, intentoReconexion), 60000);
  intentoReconexion++;
  return delay;
}

// ── Manejador de mensajes ──────────────────────────────────────

async function manejarMensaje(channel, tags, message, self) {
  if (self) return;

  const msg = message.trim();
  const usuario = tags["display-name"] || tags.username;
  const esMod = tags.mod || tags.badges?.broadcaster;
  const esSub = tags.subscriber || esMod;

  // ── Antibot ──────────────────────────────────────────────────
  if (CONFIG.MONGODB_URI) {
    const esSpam = await antibot.esBot(msg);
    if (esSpam) {
      log.warn(`Bot detectado: ${usuario} — "${msg.slice(0, 60)}"`);
      await antibot.registrarBaneo(usuario, msg, "patrón detectado");
      client
        .say(channel, `/ban ${usuario} Bot de spam detectado automáticamente`)
        .catch(() => {});
      return;
    }
  }

  // ── Comandos de moderación ────────────────────────────────────
  if (msg.toLowerCase().startsWith("!addbot ") && esMod) {
    const patron = msg.slice(8).trim();
    if (patron) {
      const ok = await antibot.agregarPatron(patron);
      if (ok)
        client
          .say(channel, `✅ Patrón "${patron}" agregado al antibot`)
          .catch(() => {});
    }
    return;
  }

  if (msg.toLowerCase() === "!cola" && esMod) {
    const { total, usuariosUnicos, porIdioma } = queue.stats();
    const resumen =
      total === 0
        ? "📭 La cola está vacía"
        : `📋 Cola: ${total} msg | ${usuariosUnicos} usuarios | 🇪🇸${porIdioma.es || 0} 🇺🇸${porIdioma.en || 0} 🇯🇵${porIdioma.ja || 0} 🇷🇺${porIdioma.ru || 0} 🇧🇷${porIdioma.pt || 0}`;
    client.say(channel, resumen).catch(() => {});
    return;
  }

  if (msg.toLowerCase() === "!limpiar" && esMod) {
    queue.limpiar();
    client.say(channel, "🧹 Cola limpiada").catch(() => {});
    return;
  }

  // ── !paja — número aleatorio de pajas entre 0 y 99 ───────────
  if (msg.toLowerCase() === "!paja") {
    const cantidad = Math.floor(Math.random() * 100); // 0 a 99
    const anterior = pajas.get(usuario) || 0;
    pajas.set(usuario, cantidad);

    let texto;
    if (cantidad === 0) {
      texto = `@${usuario} hoy está en modo monje, 0 pajas 🧘`;
    } else if (cantidad === 99) {
      texto = `@${usuario} se hizo 99 pajas hoy... busca ayuda 💀`;
    } else if (cantidad > anterior) {
      texto = `@${usuario} se hizo ${cantidad} pajas hoy 🥴`;
    } else {
      texto = `@${usuario} se hizo ${cantidad} pajas hoy, menos que antes 😐`;
    }

    client.say(channel, texto).catch(() => {});
    log.info(`!paja | ${usuario}: ${cantidad}`);
    return;
  }

  // ── Detectar comando TTS ──────────────────────────────────────
  const msgLower = msg.toLowerCase();
  const esES = msgLower.startsWith(CONFIG.PREFIJO_COMANDO);
  const esEN = msgLower.startsWith(CONFIG.PREFIJO_COMANDO_EN);
  const esJP = msgLower.startsWith(CONFIG.PREFIJO_COMANDO_JP);
  const esRU = msgLower.startsWith(CONFIG.PREFIJO_COMANDO_RU);
  const esPT = msgLower.startsWith(CONFIG.PREFIJO_COMANDO_PT);

  if (!esES && !esEN && !esJP && !esRU && !esPT) return;

  const idioma = esEN ? "en" : esJP ? "ja" : esRU ? "ru" : esPT ? "pt" : "es";

  const prefijo = esEN
    ? CONFIG.PREFIJO_COMANDO_EN
    : esJP
      ? CONFIG.PREFIJO_COMANDO_JP
      : esRU
        ? CONFIG.PREFIJO_COMANDO_RU
        : esPT
          ? CONFIG.PREFIJO_COMANDO_PT
          : CONFIG.PREFIJO_COMANDO;

  const flags = { es: "🇪🇸", en: "🇺🇸", ja: "🇯🇵", ru: "🇷🇺", pt: "🇧🇷" };

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

  // Cooldown compartido entre TODOS los comandos TTS
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

  texto = antibot.limpiarRepeticiones(texto, 4);
  if (texto.length > CONFIG.MAX_CARACTERES)
    texto = texto.slice(0, CONFIG.MAX_CARACTERES);

  if (queue.total() >= CONFIG.MAX_COLA) {
    client
      .say(channel, `@${usuario} la cola está llena. Espera un momento.`)
      .catch(() => {});
    return;
  }

  const esPrimero = queue.total() === 0;
  const entrada = queue.agregar({ usuario, mensaje: texto, idioma });

  log.info(`${flags[idioma]} ${prefijo} | ${usuario}: "${texto}"`);

  tts
    .generarAudio(texto, idioma)
    .then((rutaAudio) => {
      const audioBase64 = tts.audioABase64(rutaAudio);
      queue.actualizarAudio(entrada.id, rutaAudio);
      if (esPrimero) ws.enviar({ tipo: "nuevo", ...entrada, audioBase64 });
    })
    .catch((err) => {
      log.error(`Error generando TTS para ${usuario}`, err.message);
      if (esPrimero)
        ws.enviar({ tipo: "nuevo", ...entrada, audioBase64: null });
    });
}

// ── Conexión con backoff exponencial ──────────────────────────

function conectar() {
  client = crearCliente();
  client.on("message", manejarMensaje);

  client.on("connected", (addr, port) => {
    intentoReconexion = 0;
    log.info(`Bot conectado a Twitch — ${addr}:${port}`);
    log.info(`Canal: #${CONFIG.CANAL}`);
  });

  client.on("disconnected", (reason) => {
    const delay = calcularDelayReconexion();
    log.warn(
      `Bot desconectado: ${reason}. Reintentando en ${delay / 1000}s...`,
    );
    setTimeout(conectar, delay);
  });

  client.connect().catch((err) => {
    const delay = calcularDelayReconexion();
    log.error(
      `Error conectando: ${err.message}. Reintentando en ${delay / 1000}s...`,
    );
    setTimeout(conectar, delay);
  });
}

module.exports = { conectar };
