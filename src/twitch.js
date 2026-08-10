// ============================================
//  twitch.js - Conexion y comandos del bot
// ============================================

const crypto = require("crypto");
const tmi = require("tmi.js");
const CONFIG = require("./config");
const queue = require("./queue");
const playback = require("./playback");
const tts = require("./tts");
const ai = require("./ai");
const usage = require("./usage");
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
let siguienteVozHabla = "fish";

const comandosTts = [
  {
    prefijo: CONFIG.PREFIJO_COMANDO,
    idioma: "es",
    flag: "🇪🇸",
    provider: "balanced",
    voice: CONFIG.GEMINI_COAST_VOICE,
    style: CONFIG.GEMINI_COAST_STYLE,
  },
  { prefijo: CONFIG.PREFIJO_COMANDO_EN, idioma: "en", flag: "🇺🇸" },
  { prefijo: CONFIG.PREFIJO_COMANDO_JP, idioma: "ja", flag: "🇯🇵" },
  { prefijo: CONFIG.PREFIJO_COMANDO_RU, idioma: "ru", flag: "🇷🇺" },
  { prefijo: CONFIG.PREFIJO_COMANDO_PT, idioma: "pt", flag: "🇧🇷" },
  {
    prefijo: CONFIG.PREFIJO_COMANDO_NARUTO,
    idioma: "es",
    flag: "🍥",
    provider: "fish",
    tipo: "naruto",
    fishReferenceId: CONFIG.FISH_NARUTO_REFERENCE_ID,
    fishAttribution: CONFIG.FISH_NARUTO_ATTRIBUTION,
  },
  {
    prefijo: CONFIG.PREFIJO_COMANDO_PRUEBA,
    idioma: "es",
    flag: "🧪",
    provider: "gemini",
    soloMods: true,
    voice: CONFIG.GEMINI_COAST_VOICE,
    style: CONFIG.GEMINI_COAST_STYLE,
  },
];

const VOCES_WEB = Object.freeze([
  { id: "auto", label: "Automática (Fish / Gemini / Puter)" },
  { id: "gemini", label: "Gemini costeña" },
  { id: "diomedes", label: "Diomedes · Fish Audio" },
  { id: "naruto", label: "Naruto · Fish Audio" },
  { id: "google", label: "Google · respaldo" },
]);

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

function parsearComandoIa(mensaje) {
  const lower = mensaje.toLowerCase();
  const prefijo = CONFIG.PREFIJO_COMANDO_IA;
  if (lower !== prefijo && !lower.startsWith(`${prefijo} `)) return null;

  let pregunta = mensaje.slice(prefijo.length).trim();
  let modoVoz = "gemini";
  const [selector = ""] = pregunta.split(/\s+/, 1);
  const selectorLower = selector.toLowerCase();
  if (selectorLower === "naruto") {
    modoVoz = "naruto";
    pregunta = pregunta.slice(selector.length).trim();
  } else if (["diomedes", "diomedez", "fish"].includes(selectorLower)) {
    modoVoz = "fish";
    pregunta = pregunta.slice(selector.length).trim();
  } else if (selectorLower === "gemini") {
    pregunta = pregunta.slice(selector.length).trim();
  }
  return { pregunta, modoVoz };
}

function construirNarracionIa({ usuario, pregunta, respuesta, modoVoz }) {
  const respuestaLimpia = String(respuesta || "").trim();
  if (modoVoz !== "fish") return respuestaLimpia;

  const usuarioLimpio = String(usuario || "mi llave").trim();
  const preguntaLimpia = String(pregunta || "").trim();
  const cierre = /[.!?…]$/u.test(preguntaLimpia) ? "" : ".";
  return `Aquí mi compae ${usuarioLimpio} me pregunta: ${preguntaLimpia}${cierre} ${respuestaLimpia}`;
}

function tomarOrdenHabla() {
  const principal = siguienteVozHabla;
  siguienteVozHabla = principal === "fish" ? "gemini" : "fish";
  return principal === "fish"
    ? ["fish", "gemini", "puter", "google"]
    : ["gemini", "fish", "puter", "google"];
}

function normalizarIdVozWeb(valor) {
  let id = String(valor || "auto").trim().toLowerCase();
  if (id === "fish") id = "diomedes";
  return VOCES_WEB.some((voz) => voz.id === id) ? id : null;
}

function resolverPerfilVozWeb(valor, obtenerOrden = tomarOrdenHabla) {
  const id = normalizarIdVozWeb(valor);
  if (!id) return null;

  const baseGemini = {
    voice: CONFIG.GEMINI_COAST_VOICE,
    style: CONFIG.GEMINI_COAST_STYLE,
  };
  if (id === "auto") {
    return {
      id,
      provider: "balanced",
      providerOrder: obtenerOrden(),
      ...baseGemini,
    };
  }
  if (id === "gemini") {
    return {
      id,
      provider: "gemini",
      providerOrder: ["gemini", "puter", "google"],
      reserva: "gemini_tts",
      preautorizado: "gemini",
      ...baseGemini,
    };
  }
  if (id === "diomedes") {
    return {
      id,
      provider: "fish",
      providerOrder: ["fish", "gemini", "puter", "google"],
      reserva: "fish",
      preautorizado: "fish",
      fishReferenceId: CONFIG.FISH_REFERENCE_ID,
      fishAttribution: CONFIG.FISH_ATTRIBUTION,
      ...baseGemini,
    };
  }
  if (id === "naruto") {
    return {
      id,
      provider: "fish",
      providerOrder: ["fish", "gemini", "puter", "google"],
      reserva: "fish",
      preautorizado: "fish",
      fishReferenceId: CONFIG.FISH_NARUTO_REFERENCE_ID,
      fishAttribution: CONFIG.FISH_NARUTO_ATTRIBUTION,
      ...baseGemini,
    };
  }
  return { id: "google", provider: "google", providerOrder: ["google"] };
}

function vocesWeb() {
  return VOCES_WEB.map((voz) => ({ ...voz }));
}

function decir(channel, mensaje) {
  return client?.say(channel, mensaje).catch((err) => {
    log.warn("No se pudo responder en Twitch", err.message);
  });
}

function reglaUso(tipo) {
  if (tipo === "fish") {
    return {
      tipo,
      cooldownMs: CONFIG.FISH_COOLDOWN_SEGUNDOS * 1000,
      globalCooldownMs: CONFIG.FISH_GLOBAL_COOLDOWN_SEGUNDOS * 1000,
      limiteDiario: CONFIG.FISH_LIMITE_DIARIO,
      limiteUsuario: CONFIG.FISH_LIMITE_USUARIO_DIARIO,
    };
  }
  if (tipo === "gemini_tts") {
    return {
      tipo,
      cooldownMs: CONFIG.GEMINI_TTS_COOLDOWN_SEGUNDOS * 1000,
      globalCooldownMs: CONFIG.GEMINI_TTS_GLOBAL_COOLDOWN_SEGUNDOS * 1000,
      limiteDiario: CONFIG.GEMINI_TTS_LIMITE_DIARIO,
      limiteUsuario: CONFIG.GEMINI_TTS_LIMITE_USUARIO_DIARIO,
    };
  }
  if (tipo === "puter_tts") {
    return {
      tipo,
      cooldownMs: CONFIG.PUTER_TTS_COOLDOWN_SEGUNDOS * 1000,
      globalCooldownMs: CONFIG.PUTER_TTS_GLOBAL_COOLDOWN_SEGUNDOS * 1000,
      limiteDiario: CONFIG.PUTER_TTS_LIMITE_DIARIO,
      limiteUsuario: CONFIG.PUTER_TTS_LIMITE_USUARIO_DIARIO,
    };
  }
  if (tipo === "web_chat") {
    return {
      tipo,
      cooldownMs: CONFIG.CHAT_COOLDOWN_SEGUNDOS * 1000,
      globalCooldownMs: CONFIG.CHAT_GLOBAL_COOLDOWN_SEGUNDOS * 1000,
      limiteDiario: CONFIG.CHAT_LIMITE_DIARIO,
      limiteUsuario: CONFIG.CHAT_LIMITE_USUARIO_DIARIO,
    };
  }
  return {
    tipo: "ai",
    cooldownMs: CONFIG.AI_COOLDOWN_SEGUNDOS * 1000,
    globalCooldownMs: CONFIG.AI_GLOBAL_COOLDOWN_SEGUNDOS * 1000,
    limiteDiario: CONFIG.AI_LIMITE_DIARIO,
    limiteUsuario: CONFIG.AI_LIMITE_USUARIO_DIARIO,
  };
}

function crearControlProveedor(claveUsuario, esMod, preautorizados = []) {
  const autorizados = new Set(preautorizados);
  return (provider) => {
    if (autorizados.delete(provider)) return true;
    const tipo = provider === "fish"
      ? "fish"
      : provider === "puter"
        ? "puter_tts"
        : "gemini_tts";
    const reserva = usage.reservarVarios([reglaUso(tipo)], {
      usuario: claveUsuario,
      bypassUsuario: esMod,
    });
    if (!reserva.ok) {
      log.info(
        `${provider} omitido para ${claveUsuario}: ${reserva.motivo}${reserva.restante ? ` (${reserva.restante}s)` : ""}`,
      );
    }
    return reserva.ok;
  };
}

function textoRechazoUso(resultado, usuario) {
  const servicio = resultado.tipo === "fish" ? "la voz Fish" : "!ia";
  if (resultado.motivo === "limite_diario") {
    return `@${usuario} el presupuesto diario de ${servicio} ya se agotó. Vuelve mañana.`;
  }
  if (resultado.motivo === "limite_usuario") {
    return `@${usuario} ya usaste tu cupo diario de ${servicio}. Dale oportunidad a los demás.`;
  }
  if (resultado.motivo === "cooldown_global") {
    return `@${usuario} ${servicio} está ocupado; intenta otra vez en ${resultado.restante}s.`;
  }
  return `@${usuario} espera ${resultado.restante || 1}s para volver a usar ${servicio}.`;
}

function iniciarGeneracionTts(entrada, texto, idioma, opciones = {}) {
  tts
    .generarAudio(texto, idioma, {
      id: entrada.id,
      debeContinuar: () => Boolean(queue.buscar(entrada.id)),
      ...opciones,
    })
    .then((resultado) => {
      const attribution = entrada.tipo === "ia"
        ? `Respuesta IA · ${resultado.attribution}`
        : resultado.attribution;
      if (!queue.actualizarAudio(entrada.id, { ...resultado, attribution })) {
        tts.eliminarAudio(resultado.rutaAudio);
        return;
      }
      playback.notificarCambio();
    })
    .catch((err) => {
      if (err.code === "TTS_CANCELLED") return;
      log.error(`Todos los proveedores TTS fallaron para ${entrada.usuario}`, err.message);
      if (queue.marcarFallback(entrada.id, err.message)) playback.notificarCambio();
    });
}

async function procesarIa({
  channel,
  usuario,
  pregunta,
  modoVoz,
  entrada,
  puedeUsarProveedor,
}) {
  try {
    const respuesta = await ai.generarRespuesta(pregunta, { modoVoz });
    const narracion = construirNarracionIa({
      usuario,
      pregunta,
      respuesta: respuesta.texto,
      modoVoz,
    });
    if (!queue.actualizarMensaje(entrada.id, narracion, { pregunta })) return;
    log.info(
      `🧠 !ia ${modoVoz} | ${usuario}${respuesta.cache ? " (cache)" : ""}: "${respuesta.texto}"`,
    );
    const usarFish = modoVoz === "fish" || modoVoz === "naruto";
    iniciarGeneracionTts(entrada, narracion, "es", {
      providerOrder: usarFish
        ? ["fish", "gemini", "puter", "google"]
        : ["gemini", "fish", "puter", "google"],
      puedeUsarProveedor,
      fishReferenceId:
        modoVoz === "naruto" ? CONFIG.FISH_NARUTO_REFERENCE_ID : undefined,
      fishAttribution:
        modoVoz === "naruto" ? CONFIG.FISH_NARUTO_ATTRIBUTION : undefined,
      voice: CONFIG.GEMINI_COAST_VOICE,
      style: CONFIG.GEMINI_COAST_STYLE,
    });
  } catch (err) {
    if (queue.eliminar(entrada.id)) playback.notificarCambio();
    log.warn(`No se pudo responder !ia para ${usuario}`, err.message);
    await decir(
      channel,
      `@${usuario} la IA no pudo responder ahora. Intenta de nuevo más tarde.`,
    );
  }
}

function limpiarCampoWeb(valor, maximo) {
  if (typeof valor !== "string") return "";
  return valor
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximo);
}

function mensajeReservaWeb(reserva) {
  if (reserva.tipo === "fish") {
    return "La voz Fish seleccionada no está disponible por límite o cooldown.";
  }
  if (reserva.tipo === "gemini_tts") {
    return "La voz Gemini seleccionada no está disponible por límite o cooldown.";
  }
  if (reserva.motivo === "limite_diario") {
    return "El chat privado alcanzó su límite diario.";
  }
  if (reserva.motivo === "limite_usuario") {
    return "Este dispositivo alcanzó su límite diario.";
  }
  return `Espera ${reserva.restante || 1}s antes de enviar otro mensaje.`;
}

function encolarDesdeWeb(
  { name, message, voice = "auto", clientKey = "anonimo" } = {},
  {
    colaServicio = queue,
    usoServicio = usage,
    notificarCambio = () => playback.notificarCambio(),
    generarTts = iniciarGeneracionTts,
    obtenerOrden = tomarOrdenHabla,
    crearControl = crearControlProveedor,
    geminiDisponible = Boolean(CONFIG.GEMINI_API_KEY),
    fishDisponible = Boolean(CONFIG.FISH_API_KEY),
  } = {},
) {
  const usuario = limpiarCampoWeb(name, CONFIG.CHAT_MAX_NAME);
  const texto = limpiarRepeticiones(
    limpiarCampoWeb(message, CONFIG.MAX_CARACTERES),
    4,
  );
  const vozId = normalizarIdVozWeb(voice);
  if (!usuario) {
    return { ok: false, status: 400, code: "INVALID_NAME", error: "Escribe un nombre." };
  }
  if (!texto) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_MESSAGE",
      error: "Escribe un mensaje.",
    };
  }
  if (!vozId) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_VOICE",
      error: "Selecciona una voz válida.",
    };
  }
  if (vozId === "gemini" && !geminiDisponible) {
    return {
      ok: false,
      status: 503,
      code: "VOICE_UNAVAILABLE",
      error: "La voz Gemini no está configurada en este momento.",
    };
  }
  if (["diomedes", "naruto"].includes(vozId) && !fishDisponible) {
    return {
      ok: false,
      status: 503,
      code: "VOICE_UNAVAILABLE",
      error: "La voz Fish seleccionada no está configurada en este momento.",
    };
  }
  if (colaServicio.total() >= CONFIG.MAX_COLA) {
    return {
      ok: false,
      status: 429,
      code: "QUEUE_FULL",
      error: "La cola está llena. Espera un momento.",
    };
  }

  const claveUsuario = `web:${crypto
    .createHash("sha256")
    .update(String(clientKey))
    .digest("hex")
    .slice(0, 16)}`;
  const reglas = [reglaUso("web_chat")];
  if (vozId === "gemini") reglas.push(reglaUso("gemini_tts"));
  if (["diomedes", "naruto"].includes(vozId)) reglas.push(reglaUso("fish"));
  const reserva = usoServicio.reservarVarios(reglas, {
    usuario: claveUsuario,
  });
  if (!reserva.ok) {
    return {
      ok: false,
      status: 429,
      code: reserva.motivo.toUpperCase(),
      error: mensajeReservaWeb(reserva),
      retryAfter: reserva.restante || null,
    };
  }

  const perfil = resolverPerfilVozWeb(vozId, obtenerOrden);
  const entrada = colaServicio.agregar({
    usuario,
    mensaje: texto,
    idioma: "es",
    tipo: "chat",
    origen: "chat",
    vozSeleccionada: perfil.id,
  });
  notificarCambio();
  log.info(
    `💬 /chat | ${usuario}: "${texto}" | voz: ${perfil.id} | preferida: ${perfil.providerOrder[0]}`,
  );
  generarTts(entrada, texto, "es", {
    provider: perfil.provider,
    providerOrder: perfil.providerOrder,
    puedeUsarProveedor: crearControl(
      claveUsuario,
      false,
      perfil.preautorizado ? [perfil.preautorizado] : [],
    ),
    fishReferenceId: perfil.fishReferenceId,
    fishAttribution: perfil.fishAttribution,
    voice: perfil.voice,
    style: perfil.style,
  });

  return {
    ok: true,
    status: 202,
    id: entrada.id,
    position: colaServicio.total(),
    name: usuario,
    message: texto,
    voice: perfil.id,
  };
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

  const comandoIa = parsearComandoIa(msg);
  if (comandoIa) {
    if (CONFIG.SOLO_SUBS && !esSub) {
      await decir(channel, `@${usuario} solo los suscriptores pueden usar !ia.`);
      return;
    }
    if (!CONFIG.GEMINI_API_KEY) {
      await decir(channel, `@${usuario} !ia no está configurado en este momento.`);
      return;
    }

    let pregunta = limpiarRepeticiones(comandoIa.pregunta, 4).slice(
      0,
      CONFIG.AI_MAX_PREGUNTA,
    );
    if (!pregunta) {
      await decir(
        channel,
        `@${usuario} usa !ia pregunta, !ia gemini pregunta, !ia diomedes pregunta o !ia naruto pregunta.`,
      );
      return;
    }
    if (queue.total() >= CONFIG.MAX_COLA) {
      await decir(channel, `@${usuario} la cola está llena. Espera un momento.`);
      return;
    }

    const requiereFish =
      comandoIa.modoVoz === "fish" || comandoIa.modoVoz === "naruto";
    if (requiereFish && !CONFIG.FISH_API_KEY) {
      await decir(channel, `@${usuario} la voz Fish todavía no está configurada.`);
      return;
    }
    const reglas = [reglaUso("ai")];
    if (requiereFish) reglas.push(reglaUso("fish"));
    const reserva = usage.reservarVarios(reglas, {
      usuario: claveUsuario,
      bypassUsuario: esMod,
    });
    if (!reserva.ok) {
      await decir(channel, textoRechazoUso(reserva, usuario));
      return;
    }

    const entrada = queue.agregar({
      usuario: `${usuario} · IA`,
      mensaje: "Preparando respuesta…",
      pregunta,
      idioma: "es",
      tipo: "ia",
    });
    playback.notificarCambio();
    log.info(`🧠 !ia ${comandoIa.modoVoz} | ${usuario}: "${pregunta}"`);
    void procesarIa({
      channel,
      usuario,
      pregunta,
      modoVoz: comandoIa.modoVoz,
      entrada,
      puedeUsarProveedor: crearControlProveedor(
        claveUsuario,
        esMod,
        requiereFish ? ["fish"] : [],
      ),
    });
    return;
  }

  const comando = detectarComando(msg);
  if (!comando) return;

  if (comando.soloMods && !esMod) {
    await decir(channel, `@${usuario} ${comando.prefijo} es solo para moderadores.`);
    return;
  }

  if (CONFIG.SOLO_SUBS && !esSub) {
    await decir(channel, `@${usuario} solo los suscriptores pueden usar ${comando.prefijo}.`);
    return;
  }

  let texto = msg.slice(comando.prefijo.length).trim();
  if (!texto) {
    await decir(channel, `@${usuario} escribe algo después de ${comando.prefijo}.`);
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
    await decir(channel, `@${usuario} la cola está llena. Espera un momento.`);
    return;
  }

  const preautorizados = [];
  if (comando.provider === "fish") {
    if (!CONFIG.FISH_API_KEY) {
      await decir(channel, `@${usuario} la voz Fish todavía no está configurada.`);
      return;
    }
    const reserva = usage.reservarVarios([reglaUso("fish")], {
      usuario: claveUsuario,
      bypassUsuario: esMod,
    });
    if (!reserva.ok) {
      await decir(channel, textoRechazoUso(reserva, usuario));
      return;
    }
    preautorizados.push("fish");
  }

  const entrada = queue.agregar({
    usuario,
    mensaje: texto,
    idioma: comando.idioma,
    tipo: comando.tipo || "tts",
  });
  if (!esMod) cooldowns.set(claveUsuario, Date.now());
  playback.notificarCambio();
  const providerOrder =
    comando.provider === "balanced" ? tomarOrdenHabla() : undefined;
  log.info(
    `${comando.flag} ${comando.prefijo} | ${usuario}: "${texto}"${providerOrder ? ` | preferida: ${providerOrder[0]}` : ""}`,
  );
  iniciarGeneracionTts(entrada, texto, comando.idioma, {
    provider: comando.provider || "auto",
    providerOrder,
    puedeUsarProveedor: crearControlProveedor(
      claveUsuario,
      esMod,
      preautorizados,
    ),
    fishReferenceId: comando.fishReferenceId,
    fishAttribution: comando.fishAttribution,
    voice: comando.voice,
    style: comando.style,
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
  encolarDesdeWeb,
  vocesWeb,
  _internals: {
    detectarComando,
    parsearComandoIa,
    construirNarracionIa,
    tomarOrdenHabla,
    limpiarRepeticiones,
    mensajeYaProcesado,
    reglaUso,
    crearControlProveedor,
    limpiarCampoWeb,
    mensajeReservaWeb,
    normalizarIdVozWeb,
    resolverPerfilVozWeb,
  },
};
