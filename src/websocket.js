// ============================================
//  websocket.js - Gestión de clientes OBS
//  Mejoras: detección de clientes zombie,
//           estadísticas de uptime, logger
// ============================================

const WebSocket = require("ws");
const { createLogger } = require("./logger");

const log = createLogger("WS");

let wss = null;
let clients = new Map(); // Map<ws, { connectedAt, lastPong, ip }>

function inicializar(server) {
  wss = new WebSocket.Server({ server });

  wss.on("connection", (ws, req) => {
    const ip =
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      "desconocida";

    // Registrar cliente con metadata
    clients.set(ws, {
      connectedAt: Date.now(),
      lastPong: Date.now(),
      ip,
      isAlive: true,
    });

    log.info(`OBS conectado desde ${ip} | Clientes activos: ${clients.size}`);

    if (typeof onConectado === "function") onConectado();

    // ── Heartbeat: ping cada 30s ───────────────────────────────
    // Si el cliente no responde al ping en 30s más, se considera zombie y se cierra
    const pingInterval = setInterval(() => {
      const meta = clients.get(ws);
      if (!meta) return clearInterval(pingInterval);

      if (!meta.isAlive) {
        // No respondió al último ping → cliente zombie, cerrar
        log.warn(`Cliente zombie detectado (${ip}), cerrando conexión...`);
        clients.delete(ws);
        clearInterval(pingInterval);
        return ws.terminate();
      }

      meta.isAlive = false; // Lo marcamos como "pendiente de pong"
      ws.ping();
    }, 30000);

    ws.on("pong", () => {
      const meta = clients.get(ws);
      if (meta) {
        meta.isAlive = true;
        meta.lastPong = Date.now();
      }
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.tipo === "terminado") {
          if (typeof onTerminado === "function") onTerminado(msg.id);
        }
      } catch {
        // mensaje no JSON, ignorar
      }
    });

    ws.on("close", () => {
      const meta = clients.get(ws);
      const uptime = meta
        ? Math.round((Date.now() - meta.connectedAt) / 1000)
        : 0;
      clients.delete(ws);
      clearInterval(pingInterval);
      log.info(
        `OBS desconectado (uptime: ${uptime}s) | Clientes activos: ${clients.size}`,
      );
    });

    ws.on("error", (err) => {
      log.warn(`Error en cliente WS (${ip})`, err.message);
      clients.delete(ws);
      clearInterval(pingInterval);
    });
  });
}

let onTerminado = null;
let onConectado = null;

function alTerminar(callback) {
  onTerminado = callback;
}
function alConectar(callback) {
  onConectado = callback;
}

function enviar(data) {
  if (clients.size === 0) {
    log.warn("No hay clientes OBS conectados — mensaje descartado");
    return false;
  }

  const payload = JSON.stringify(data);
  let enviado = 0;

  clients.forEach((meta, client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      enviado++;
    }
  });

  log.info(`Enviado a ${enviado}/${clients.size} clientes OBS`);
  return enviado > 0;
}

// ── Estadísticas de conexión ───────────────────────────────────
function estadisticas() {
  const ahora = Date.now();
  return {
    total: clients.size,
    clientes: [...clients.values()].map((meta) => ({
      ip: meta.ip,
      uptimeSegundos: Math.round((ahora - meta.connectedAt) / 1000),
      ultimoPong: Math.round((ahora - meta.lastPong) / 1000),
    })),
  };
}

function clientesActivos() {
  return clients.size;
}

module.exports = {
  inicializar,
  enviar,
  alTerminar,
  alConectar,
  clientesActivos,
  estadisticas,
};
