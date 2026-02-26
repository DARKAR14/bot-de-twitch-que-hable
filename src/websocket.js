// ============================================
//  websocket.js - Gestión de clientes OBS
// ============================================

const WebSocket = require('ws');

let wss = null;
let clients = new Set();

function inicializar(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    clients.add(ws);
    console.log(`✅ OBS conectado | Clientes activos: ${clients.size}`);

    // Si hay algo en cola pendiente, enviarlo al conectar
    if (typeof onConectado === 'function') onConectado();

    // Ping cada 30s para mantener conexión viva
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on('pong', () => {
      // Conexión sigue viva
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        // OBS confirma que terminó de hablar
        if (msg.tipo === 'terminado') {
          if (typeof onTerminado === 'function') onTerminado(msg.id);
        }
      } catch {
        // mensaje no JSON, ignorar
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      clearInterval(pingInterval);
      console.log(`❌ OBS desconectado | Clientes activos: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('⚠️  Error en cliente WS:', err.message);
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
    console.warn('⚠️  No hay clientes OBS conectados');
    return false;
  }
  const payload = JSON.stringify(data);
  let enviado = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      enviado++;
    }
  });
  console.log(`📡 Enviado a ${enviado}/${clients.size} clientes OBS`);
  return enviado > 0;
}

function clientesActivos() {
  return clients.size;
}

module.exports = { inicializar, enviar, alTerminar, alConectar, clientesActivos };