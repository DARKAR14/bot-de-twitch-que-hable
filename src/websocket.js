// ============================================
//  websocket.js - Un unico reproductor OBS activo
// ============================================

const WebSocket = require("ws");
const CONFIG = require("./config");
const { createLogger } = require("./logger");

const log = createLogger("WS");

function crearHub({ logger = log, maxPayload = CONFIG.WS_MAX_PAYLOAD } = {}) {
  let wss = null;
  const clients = new Map();
  let principal = null;
  let heartbeat = null;
  let onTerminado = null;
  let onConectado = null;

  function enviarA(client, data) {
    if (!client || client.readyState !== WebSocket.OPEN) return false;
    try {
      client.send(JSON.stringify(data));
      return true;
    } catch (err) {
      logger.warn("No se pudo enviar por WebSocket", err.message);
      return false;
    }
  }

  function ejecutarCallback(callback, ...args) {
    if (typeof callback !== "function") return;
    Promise.resolve(callback(...args)).catch((err) => {
      logger.error("Error en callback WebSocket", err.message);
    });
  }

  function confirmarTerminado(client, id) {
    Promise.resolve()
      .then(() => (typeof onTerminado === "function" ? onTerminado(id) : false))
      .catch((err) => {
        logger.error("Error confirmando reproduccion WebSocket", err.message);
      })
      .finally(() => {
        // Confirma la recepcion incluso si el ACK era duplicado. Asi el navegador
        // puede dejar de reenviarlo sin arriesgar que la cola quede bloqueada.
        enviarA(client, { tipo: "confirmado", id });
      });
  }

  function promover(client) {
    if (!client || !clients.has(client) || client.readyState !== WebSocket.OPEN) {
      return false;
    }
    principal = client;
    enviarA(client, { tipo: "rol", rol: "principal" });
    logger.info(`OBS principal asignado | Clientes: ${clients.size}`);
    ejecutarCallback(onConectado);
    return true;
  }

  function promoverSiguiente() {
    principal = null;
    for (const client of clients.keys()) {
      if (promover(client)) return;
    }
  }

  function inicializar(server) {
    if (wss) return wss;
    wss = new WebSocket.Server({
      server,
      path: "/ws",
      maxPayload,
      perMessageDeflate: false,
    });

    wss.on("connection", (client, req) => {
      const requestUrl = new URL(req.url, "http://localhost");
      if (
        CONFIG.WS_TOKEN &&
        requestUrl.searchParams.get("token") !== CONFIG.WS_TOKEN
      ) {
        logger.warn("Conexion WS rechazada por token invalido");
        client.close(1008, "No autorizado");
        return;
      }

      const ip = String(
        req.headers["x-forwarded-for"] || req.socket.remoteAddress || "desconocida",
      ).split(",")[0].trim();

      clients.set(client, {
        connectedAt: Date.now(),
        lastPong: Date.now(),
        isAlive: true,
        ip,
      });

      logger.info(`OBS conectado desde ${ip} | Clientes: ${clients.size}`);
      if (!principal) promover(client);
      else enviarA(client, { tipo: "rol", rol: "espera" });

      client.on("pong", () => {
        const meta = clients.get(client);
        if (meta) {
          meta.isAlive = true;
          meta.lastPong = Date.now();
        }
      });

      client.on("message", (raw) => {
        if (client !== principal) return;
        try {
          const msg = JSON.parse(raw.toString("utf8"));
          if (
            msg.tipo === "terminado" &&
            typeof msg.id === "string" &&
            msg.id.length <= 100
          ) {
            confirmarTerminado(client, msg.id);
          }
        } catch {
          logger.debug("Mensaje WebSocket invalido ignorado");
        }
      });

      const quitar = () => {
        const eraPrincipal = client === principal;
        clients.delete(client);
        if (eraPrincipal) promoverSiguiente();
        logger.info(`OBS desconectado | Clientes: ${clients.size}`);
      };

      client.once("close", quitar);
      client.once("error", (err) => {
        logger.warn(`Error WS de ${ip}`, err.message);
      });
    });

    wss.on("error", (err) => logger.error("Error en servidor WS", err.message));

    heartbeat = setInterval(() => {
      for (const [client, meta] of clients) {
        if (!meta.isAlive) {
          logger.warn(`Cerrando cliente WS sin respuesta: ${meta.ip}`);
          client.terminate();
          continue;
        }
        meta.isAlive = false;
        client.ping();
      }
    }, 30_000);
    heartbeat.unref?.();

    return wss;
  }

  function enviar(data) {
    if (!principal) {
      logger.debug("No hay OBS principal conectado");
      return false;
    }
    return enviarA(principal, data);
  }

  function alTerminar(callback) {
    onTerminado = callback;
  }

  function alConectar(callback) {
    onConectado = callback;
  }

  function estadisticas() {
    const ahora = Date.now();
    return {
      total: clients.size,
      principal: principal ? clients.get(principal)?.ip || true : null,
      clientes: [...clients.entries()].map(([client, meta]) => ({
        ip: meta.ip,
        rol: client === principal ? "principal" : "espera",
        uptimeSegundos: Math.round((ahora - meta.connectedAt) / 1000),
        ultimoPongSegundos: Math.round((ahora - meta.lastPong) / 1000),
      })),
    };
  }

  function clientesActivos() {
    return clients.size;
  }

  function cerrar() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    for (const client of clients.keys()) client.terminate();
    clients.clear();
    principal = null;
    if (wss) wss.close();
    wss = null;
  }

  return {
    inicializar,
    enviar,
    alTerminar,
    alConectar,
    clientesActivos,
    estadisticas,
    cerrar,
  };
}

const hub = crearHub();
module.exports = { ...hub, crearHub };
