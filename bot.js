// ============================================
//  bot.js - Punto de entrada principal
// ============================================

const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

// ── Crear carpetas necesarias al arrancar ──────────────────────
const dirs = [
  path.join(__dirname, 'data'),
  path.join(__dirname, 'data/audio'),
];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Carpeta creada: ${dir}`);
  }
});

const CONFIG  = require('./src/config');
const queue   = require('./src/queue');
const ws      = require('./src/websocket');
const twitch  = require('./src/twitch');
const tts     = require('./src/tts');
const antibot = require('./src/antibot');

// ── Captura errores globales para no crashear ──────────────────
process.on('uncaughtException', (err) => {
  console.error('💥 Error no capturado:', err.message);
  // No cerramos el proceso, solo logueamos
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Promesa rechazada:', reason);
});

// ── Servidor HTTP + WebSocket ──────────────────────────────────
const app    = express();
const server = http.createServer(app);

// Sirve obs.html
app.get('/', (req, res) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  res.sendFile(path.join(__dirname, 'obs.html'));
});

// Sirve los archivos de audio generados
app.use('/audio', express.static(require('path').join(__dirname, 'data/audio')));

app.use('/font', express.static(path.join(__dirname, 'font')))

app.use('/svg', express.static(path.join(__dirname, 'svg')));
// Endpoint para ver la cola actual (útil para debug)
app.get('/cola', (req, res) => {
  res.json({ total: queue.total(), mensajes: queue.leer() });
});

// Endpoint para limpiar la cola manualmente
app.delete('/cola', (req, res) => {
  queue.limpiar();
  res.json({ ok: true, mensaje: 'Cola limpiada' });
});

// ── WebSocket ──────────────────────────────────────────────────
ws.inicializar(server);

// Cuando OBS termina de reproducir un mensaje, lo eliminamos de la cola y borramos el audio
ws.alTerminar((id) => {
  console.log(`✅ TTS terminado, eliminando ID: ${id}`);
  const entrada = queue.leer().find((e) => e.id === id);
  if (entrada?.rutaAudio) tts.eliminarAudio(entrada.rutaAudio);
  queue.eliminar(id);

  // Esperar un frame antes de enviar el siguiente (evita superposición)
  setTimeout(() => {
    const siguiente = queue.obtenerPrimero();
    if (!siguiente) return console.log('📭 Cola vacía');

    console.log(`▶️  Enviando siguiente: ${siguiente.usuario}`);

    // Si el audio ya está listo, enviarlo directo
    if (siguiente.rutaAudio) {
      const audioBase64 = tts.audioABase64(siguiente.rutaAudio);
      ws.enviar({ tipo: 'nuevo', ...siguiente, audioBase64 });
    } else {
      // Aún generándose, esperar a que termine
      console.log('⏳ Esperando audio del siguiente...');
      const esperar = setInterval(() => {
        const actualizado = queue.leer().find((e) => e.id === siguiente.id);
        if (actualizado?.rutaAudio) {
          clearInterval(esperar);
          const audioBase64 = tts.audioABase64(actualizado.rutaAudio);
          ws.enviar({ tipo: 'nuevo', ...actualizado, audioBase64 });
        }
      }, 200);
      // Timeout de seguridad: 10s máximo esperando
      setTimeout(() => clearInterval(esperar), 10000);
    }
  }, 300);
});

// Cuando OBS conecta, enviar el primer mensaje pendiente si hay
ws.alConectar(() => {
  const primero = queue.obtenerPrimero();
  if (primero) {
    console.log(`▶️  OBS conectó, enviando mensaje pendiente: ${primero.usuario}`);
    const audioBase64 = primero.rutaAudio ? tts.audioABase64(primero.rutaAudio) : null;
    ws.enviar({ tipo: 'nuevo', ...primero, audioBase64 });
  }
});

// ── Inicializar ────────────────────────────────────────────────
queue.inicializar();
antibot.conectar(); // Conectar MongoDB antibot (no bloquea el arranque)

// Si quedaron mensajes de una sesión anterior, los limpiamos al arrancar
const pendientes = queue.total();
if (pendientes > 0) {
  console.log(`⚠️  Había ${pendientes} mensajes pendientes de la sesión anterior. Limpiando...`);
  queue.limpiar();
}


// ── Iniciar servidor y bot ─────────────────────────────────────
server.listen(CONFIG.PUERTO, () => {
  const urlPublica = CONFIG.APP_URL || `http://localhost:${CONFIG.PUERTO}`;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🎙️  BOT !habla arriba y corriendo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  🌐  Servidor:  ${urlPublica}`);
  console.log(`  📋  Cola:      ${urlPublica}/cola`);
  console.log(`  📺  OBS URL:   ${urlPublica}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// ── Mantener activo en Render ──────────────────────────────────
if (CONFIG.APP_URL) {
  setInterval(() => {
    https.get(CONFIG.APP_URL, (res) => {
      console.log(`🏓 Ping propio: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('❌ Ping fallido:', err.message);
    });
  }, 4 * 60 * 1000); // cada 4 minutos
}

twitch.conectar();