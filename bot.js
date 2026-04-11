// ============================================
//  bot.js - Punto de entrada principal
// ============================================

const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");

// ── Logger antes que todo ──────────────────────────────────────
const { createLogger } = require("./src/logger");
const log = createLogger("BOT");

// ── Crear carpetas necesarias ──────────────────────────────────
const dirs = [path.join(__dirname, "data"), path.join(__dirname, "data/audio")];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log.info(`Carpeta creada: ${dir}`);
  }
});

// ── Config — valida variables antes de continuar ──────────────
const CONFIG = require("./src/config");
CONFIG.validate();

const queue = require("./src/queue");
const ws = require("./src/websocket");
const twitch = require("./src/twitch");
const tts = require("./src/tts");
const antibot = require("./src/antibot");

// ── Captura errores globales ───────────────────────────────────
process.on("uncaughtException", (err) => {
  log.error("Error no capturado", err.message);
});

process.on("unhandledRejection", (reason) => {
  log.error("Promesa rechazada", reason);
});

// ── Servidor HTTP ──────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.get("/", (req, res) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  res.sendFile(path.join(__dirname, "obs.html"));
});

app.use("/audio", express.static(path.join(__dirname, "data/audio")));
app.use("/font", express.static(path.join(__dirname, "font")));
app.use("/svg", express.static(path.join(__dirname, "svg")));

app.get("/cola", (req, res) => {
  res.json({ total: queue.total(), mensajes: queue.leer() });
});

app.delete("/cola", (req, res) => {
  queue.limpiar();
  res.json({ ok: true });
});

app.get("/stats", (req, res) => {
  res.json({
    cola: queue.stats(),
    websocket: ws.estadisticas(),
  });
});

// ── WebSocket ──────────────────────────────────────────────────
ws.inicializar(server);

ws.alTerminar((id) => {
  log.info(`TTS terminado, eliminando ID: ${id}`);
  const entrada = queue.leer().find((e) => e.id === id);
  queue.eliminar(id);

  setTimeout(() => {
    const siguiente = queue.obtenerPrimero();
    if (!siguiente) return log.info("Cola vacía");

    log.info(`Enviando siguiente: ${siguiente.usuario}`);

    if (siguiente.rutaAudio) {
      const audioBase64 = tts.audioABase64(siguiente.rutaAudio);
      ws.enviar({ tipo: "nuevo", ...siguiente, audioBase64 });
    } else {
      log.info("Esperando audio del siguiente...");
      const esperar = setInterval(() => {
        const actualizado = queue.leer().find((e) => e.id === siguiente.id);
        if (actualizado?.rutaAudio) {
          clearInterval(esperar);
          const audioBase64 = tts.audioABase64(actualizado.rutaAudio);
          ws.enviar({ tipo: "nuevo", ...actualizado, audioBase64 });
        }
      }, 200);
      setTimeout(() => clearInterval(esperar), 10000);
    }

    // Borrar el audio DESPUÉS de enviar el siguiente
    // Si otro mensaje en cola usa el mismo archivo (mensajes idénticos),
    // no lo borramos para evitar el error ENOENT
    if (entrada?.rutaAudio) {
      const colaActual = queue.leer();
      const enUso = colaActual.some(
        (e) => e.id !== id && e.rutaAudio === entrada.rutaAudio,
      );
      if (!enUso) tts.eliminarAudio(entrada.rutaAudio);
    }
  }, 300);
});

ws.alConectar(() => {
  const primero = queue.obtenerPrimero();
  if (primero) {
    log.info(`OBS conectó, enviando mensaje pendiente: ${primero.usuario}`);
    const audioBase64 = primero.rutaAudio
      ? tts.audioABase64(primero.rutaAudio)
      : null;
    ws.enviar({ tipo: "nuevo", ...primero, audioBase64 });
  }
});

// ── Inicializar ────────────────────────────────────────────────
queue.inicializar();
antibot.conectar();

const pendientes = queue.total();
if (pendientes > 0) {
  log.warn(
    `${pendientes} mensajes pendientes de la sesión anterior — limpiando...`,
  );
  queue.limpiar();
}

// ── Arrancar servidor ──────────────────────────────────────────
server.listen(CONFIG.PUERTO, () => {
  const urlPublica = CONFIG.APP_URL || `http://localhost:${CONFIG.PUERTO}`;
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🎙️  BOT !habla arriba y corriendo");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  🌐  Servidor:  ${urlPublica}`);
  console.log(`  📋  Cola:      ${urlPublica}/cola`);
  console.log(`  📊  Stats:     ${urlPublica}/stats`);
  console.log(`  📺  OBS URL:   ${urlPublica}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
});

// ── Ping propio (solo en producción en la nube) ────────────────
if (CONFIG.APP_URL) {
  setInterval(
    () => {
      https
        .get(CONFIG.APP_URL, (res) => {
          log.debug(`Ping propio: ${res.statusCode}`);
        })
        .on("error", (err) => {
          log.warn("Ping fallido", err.message);
        });
    },
    4 * 60 * 1000,
  );
}

twitch.conectar();
