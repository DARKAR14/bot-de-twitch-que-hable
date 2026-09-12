// ============================================
// eventsub.js - Follows de Twitch por EventSub WebSocket
// ============================================

const WebSocket = require("ws");
const CONFIG = require("./config");
const { createLogger } = require("./logger");
const tokenStore = require("./twitch-token-store");

const log = createLogger("EVENTSUB");
const URL_EVENTSUB = "wss://eventsub.wss.twitch.tv/ws";
const idsProcesados = new Map();

let socket = null;
let timerReconexion = null;
let timerKeepalive = null;
let intentoReconexion = 0;
let deteniendo = false;
let onFollow = null;
let estado = "desactivado";
let followActivo = false;
let tokenSource = "ninguno";

function limpiarToken(token) {
  return String(token || "").trim().replace(/^oauth:/i, "");
}

function mensajeYaProcesado(id) {
  if (!id) return false;
  const ahora = Date.now();
  if (idsProcesados.has(id)) return true;
  idsProcesados.set(id, ahora);
  for (const [clave, timestamp] of idsProcesados) {
    if (ahora - timestamp > 10 * 60 * 1000) idsProcesados.delete(clave);
  }
  return false;
}

async function solicitarJson(url, { method = "GET", headers = {}, body } = {}) {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 10_000);
  timeout.unref?.();
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controlador.signal,
    });
    const detalle = await response.text();
    let data;
    try {
      data = JSON.parse(detalle);
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error(`Twitch HTTP ${response.status}: ${detalle.slice(0, 240)}`);
      error.statusCode = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function obtenerContextoAutorizacion() {
  const guardado = await tokenStore.obtenerTokenEventSub();
  const token = limpiarToken(guardado?.accessToken);
  if (!token) throw new Error("No hay token EventSub en MongoDB ni en el entorno");
  tokenSource = guardado.source;
  const identidad = await solicitarJson("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!identidad?.user_id || !identidad?.client_id) {
    throw new Error("El token EventSub no pertenece a un usuario de Twitch");
  }
  if (CONFIG.TWITCH_CLIENT_ID && CONFIG.TWITCH_CLIENT_ID !== identidad.client_id) {
    throw new Error("TWITCH_CLIENT_ID no corresponde al token EventSub");
  }
  if (!identidad.scopes?.includes("moderator:read:followers")) {
    throw new Error("El token EventSub necesita el scope moderator:read:followers");
  }

  let broadcasterId = CONFIG.TWITCH_BROADCASTER_ID;
  if (!broadcasterId) {
    const canal = String(CONFIG.CANAL || "").replace(/^#/, "");
    const usuarios = await solicitarJson(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(canal)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": identidad.client_id,
        },
      },
    );
    broadcasterId = usuarios?.data?.[0]?.id;
  }
  if (!broadcasterId) throw new Error("No se pudo resolver TWITCH_BROADCASTER_ID");
  return {
    token,
    clientId: identidad.client_id,
    broadcasterId: String(broadcasterId),
    moderatorId: String(identidad.user_id),
  };
}

function crearSolicitudFollow(sessionId, contexto) {
  return {
    type: "channel.follow",
    version: "2",
    condition: {
      broadcaster_user_id: contexto.broadcasterId,
      moderator_user_id: contexto.moderatorId,
    },
    transport: { method: "websocket", session_id: sessionId },
  };
}

async function suscribirFollow(sessionId) {
  const contexto = await obtenerContextoAutorizacion();
  await solicitarJson("https://api.twitch.tv/helix/eventsub/subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${contexto.token}`,
      "Client-Id": contexto.clientId,
      "Content-Type": "application/json",
    },
    body: crearSolicitudFollow(sessionId, contexto),
  });
  followActivo = true;
  log.info("Alertas de follows activadas por EventSub");
}

function reiniciarKeepalive(segundos, ws) {
  if (timerKeepalive) clearTimeout(timerKeepalive);
  if (!Number.isFinite(segundos) || segundos <= 0) return;
  timerKeepalive = setTimeout(() => {
    if (ws !== socket || deteniendo) return;
    log.warn("EventSub no envió keepalive; se reconectará");
    ws.terminate();
  }, (segundos + 5) * 1000);
  timerKeepalive.unref?.();
}

function programarReconexion() {
  if (deteniendo || timerReconexion) return;
  estado = "reconectando";
  followActivo = false;
  const espera = Math.min(3_000 * 2 ** intentoReconexion, 60_000);
  intentoReconexion += 1;
  timerReconexion = setTimeout(() => {
    timerReconexion = null;
    abrirSocket(URL_EVENTSUB, false);
  }, espera);
  timerReconexion.unref?.();
}

function procesarNotificacion(mensaje) {
  if (mensaje.metadata?.subscription_type !== "channel.follow") return;
  if (mensajeYaProcesado(mensaje.metadata?.message_id)) return;
  const evento = mensaje.payload?.event;
  if (!evento) return;
  onFollow?.({
    tipo: "follow",
    usuario: evento.user_name || evento.user_login,
    tags: { id: mensaje.metadata?.message_id },
  });
}

function abrirSocket(url, reutilizarSuscripciones) {
  if (deteniendo) return;
  estado = "conectando";
  const ws = new WebSocket(url);
  if (!socket) socket = ws;
  ws.on("message", (raw) => {
    let mensaje;
    try {
      mensaje = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const tipo = mensaje.metadata?.message_type;
    const keepalive = mensaje.payload?.session?.keepalive_timeout_seconds;
    if (ws === socket || tipo === "session_welcome") {
      reiniciarKeepalive(keepalive || 10, ws);
    }
    if (tipo === "session_welcome") {
      const anterior = socket;
      socket = ws;
      estado = "conectado";
      intentoReconexion = 0;
      if (anterior && anterior !== ws) anterior.close();
      if (!reutilizarSuscripciones) {
        suscribirFollow(mensaje.payload?.session?.id).catch((err) => {
          estado = "sin_autorizacion";
          followActivo = false;
          log.warn("No se pudieron activar los follows", err.message);
        });
      }
      return;
    }
    if (tipo === "session_reconnect") {
      const nuevaUrl = mensaje.payload?.session?.reconnect_url;
      if (nuevaUrl) abrirSocket(nuevaUrl, true);
      return;
    }
    if (tipo === "notification") procesarNotificacion(mensaje);
    if (tipo === "revocation") {
      followActivo = false;
      log.warn("Twitch revocó la suscripción de follows");
    }
  });
  ws.on("error", (err) => log.warn("EventSub WebSocket", err.message));
  ws.on("close", () => {
    if (ws !== socket || deteniendo) return;
    socket = null;
    programarReconexion();
  });
}

function conectar({ alSeguir } = {}) {
  onFollow = alSeguir;
  deteniendo = false;
  if (!CONFIG.TWITCH_EVENTSUB_TOKEN && !CONFIG.MONGODB_URI) {
    estado = "desactivado";
    log.info("Follows desactivados: configura TWITCH_EVENTSUB_TOKEN para habilitarlos");
    return false;
  }
  abrirSocket(URL_EVENTSUB, false);
  return true;
}

function desconectar() {
  deteniendo = true;
  if (timerReconexion) clearTimeout(timerReconexion);
  if (timerKeepalive) clearTimeout(timerKeepalive);
  timerReconexion = null;
  timerKeepalive = null;
  followActivo = false;
  estado = "detenido";
  const actual = socket;
  socket = null;
  actual?.close();
}

function stats() {
  return { estado, followActivo, tokenSource };
}

module.exports = {
  conectar,
  desconectar,
  stats,
  _internals: { limpiarToken, crearSolicitudFollow, mensajeYaProcesado },
};
