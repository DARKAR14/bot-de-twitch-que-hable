// ============================================
//  twitch.js - Conexion y comandos del bot
// ============================================

const tmi = require("tmi.js");
const CONFIG = require("./config");
const queue = require("./queue");
const playback = require("./playback");
const tts = require("./tts");
const { createLogger } = require("./logger");

const log = createLogger("TWITCH");
const cooldowns = new Map();
const idsProcesados = new Map();
const pajas = new Map();

let client = null;
let conectando = false;
let deteniendo = false;
let reconnectTimer = null;
let intentoReconexion = 0;

const comandosTts = [
  { prefijo: CONFIG.PREFIJO_COMANDO, idioma: "es", flag: "🇪🇸" },
  { prefijo: CONFIG.PREFIJO_COMANDO_EN, idioma: "en", flag: "🇺🇸" },
  { prefijo: CONFIG.PREFIJO_COMANDO_JP, idioma: "ja", flag: "🇯🇵" },
  { prefijo: CONFIG.PREFIJO_COMANDO_RU, idioma: "ru", flag: "🇷🇺" },
  { prefijo: CONFIG.PREFIJO_COMANDO_PT, idioma: "pt", flag: "🇧🇷" },
];

function crearCliente() {
  return new tmi.Client({
    options: { debug: false },
    connection: { reconnect: false, secure: true },
    identity: { username: CONFIG.BOT_USERNAME, password: CONFIG.BOT_TOKEN },
    channels: [CONFIG.CANAL],
  });
}

function mensajeYaProcesado(tags) {
  const id = tags.id;
  if (!id) return false;
  const ahora = Date.now();
  if (idsProcesados.has(id)) return true;
  idsProcesados.set(id, ahora);
  if (idsProcesados.size > 1000) {
    for (const [key, timestamp] of idsProcesados) {
      if (ahora - timestamp > 5 * 60 * 1000) idsProcesados.delete(key);
    }
  }
  return false;
}

function limpiarRepeticiones(texto, maximo = 4) {
  const minimoExtra = Math.max(1, maximo);
  const patron = new RegExp(`(.)\\1{${minimoExtra},}`, "gu");
  return texto.replace(patron, (_, caracter) => caracter.repeat(maximo));
}

function detectarComando(mensaje) {
  const lower = mensaje.toLowerCase();
  return comandosTts.find(
    ({ prefijo }) => lower === prefijo || lower.startsWith(`${prefijo} `),
  );
}

function decir(channel, mensaje) {
  return client?.say(channel, mensaje).catch((err) => {
    log.warn("No se pudo responder en Twitch", err.message);
  });
}

async function manejarMensaje(channel, tags, message, self) {
  if (self || mensajeYaProcesado(tags)) return;

  const msg = message.trim();
  const usuario = tags["display-name"] || tags.username || "usuario";
  const claveUsuario = (tags.username || usuario).toLowerCase();
  const esMod = Boolean(tags.mod || tags.badges?.broadcaster);
  const esSub = Boolean(tags.subscriber || esMod);

  if (msg.toLowerCase() === "!cola" && esMod) {
    const stats = queue.stats();
    const resumen =
      stats.total === 0
        ? "📭 La cola esta vacia"
        : `📋 Cola: ${stats.total} | listos: ${stats.listo} | generando: ${stats.generando}`;
    await decir(channel, resumen);
    return;
  }

  if (msg.toLowerCase() === "!limpiar" && esMod) {
    const eliminados = playback.limpiar();
    await decir(channel, `🧹 Cola limpiada (${eliminados} mensajes)`);
    return;
  }

  if (msg.toLowerCase() === "!paja") {
    const cantidad = Math.floor(Math.random() * 100);
    const anterior = pajas.get(claveUsuario) || 0;
    pajas.set(claveUsuario, cantidad);
    const respuesta =
      cantidad === 0
        ? `@${usuario} hoy esta en modo monje, 0 pajas 🧘`
        : cantidad === 99
          ? `@${usuario} se hizo 99 pajas hoy... busca ayuda 💀`
          : cantidad > anterior
            ? `@${usuario} se hizo ${cantidad} pajas hoy 🥴`
            : `@${usuario} se hizo ${cantidad} pajas hoy, menos que antes 😐`;
    await decir(channel, respuesta);
    return;
  }

  const comando = detectarComando(msg);
  if (!comando) return;

  if (CONFIG.SOLO_SUBS && !esSub) {
    await decir(channel, `@${usuario} solo los suscriptores pueden usar ${comando.prefijo}.`);
    return;
  }

  let texto = msg.slice(comando.prefijo.length).trim();
  if (!texto) {
    await decir(channel, `@${usuario} escribe algo despues de ${comando.prefijo}.`);
    return;
  }

  texto = limpiarRepeticiones(texto, 4).slice(0, CONFIG.MAX_CARACTERES);

  if (!esMod) {
    const ahora = Date.now();
    const ultimoUso = cooldowns.get(claveUsuario) || 0;
    const restante = Math.ceil(
      (CONFIG.COOLDOWN_SEGUNDOS * 1000 - (ahora - ultimoUso)) / 1000,
    );
    if (restante > 0) {
      await decir(channel, `@${usuario} espera ${restante}s para usar el TTS de nuevo.`);
      return;
    }
  }

  if (queue.total() >= CONFIG.MAX_COLA) {
    await decir(channel, `@${usuario} la cola esta llena. Espera un momento.`);
    return;
  }

  const entrada = queue.agregar({ usuario, mensaje: texto, idioma: comando.idioma });
  if (!esMod) cooldowns.set(claveUsuario, Date.now());
  playback.notificarCambio();
  log.info(`${comando.flag} ${comando.prefijo} | ${usuario}: "${texto}"`);

  tts
    .generarAudio(texto, comando.idioma, {
      id: entrada.id,
      debeContinuar: () => Boolean(queue.buscar(entrada.id)),
    })
    .then((resultado) => {
      if (!queue.actualizarAudio(entrada.id, resultado)) {
        tts.eliminarAudio(resultado.rutaAudio);
        return;
      }
      playback.notificarCambio();
    })
    .catch((err) => {
      if (err.code === "TTS_CANCELLED") return;
      log.error(`Todos los proveedores TTS fallaron para ${usuario}`, err.message);
      if (queue.marcarFallback(entrada.id, err.message)) playback.notificarCambio();
    });
}

function programarReconexion(razon) {
  if (deteniendo || reconnectTimer) return;
  const delay = Math.min(3000 * 2 ** intentoReconexion, 60_000);
  intentoReconexion += 1;
  log.warn(`${razon}. Reintentando Twitch en ${delay / 1000}s`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    conectar();
  }, delay);
  reconnectTimer.unref?.();
}

async function conectar() {
  if (deteniendo || conectando) return;
  conectando = true;

  if (client) {
    const anterior = client;
    client = null;
    anterior.removeAllListeners();
    try {
      await anterior.disconnect();
    } catch {}
  }

  const nuevo = crearCliente();
  client = nuevo;
  nuevo.on("message", manejarMensaje);
  nuevo.on("connected", (addr, port) => {
    intentoReconexion = 0;
    log.info(`Bot conectado a Twitch ${addr}:${port} | #${CONFIG.CANAL}`);
  });
  nuevo.on("disconnected", (reason) => {
    if (client === nuevo) programarReconexion(`Twitch desconectado: ${reason}`);
  });

  try {
    await nuevo.connect();
  } catch (err) {
    if (client === nuevo) programarReconexion(`Error conectando Twitch: ${err.message}`);
  } finally {
    conectando = false;
  }
}

async function desconectar() {
  deteniendo = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const actual = client;
  client = null;
  if (actual) {
    actual.removeAllListeners();
    try {
      await actual.disconnect();
    } catch {}
  }
}

module.exports = {
  conectar,
  desconectar,
  _internals: { detectarComando, limpiarRepeticiones, mensajeYaProcesado },
};
