// ============================================
//  mongoQueue.js - Cola de TTS
//  NOTA: Mongo quedó descartado como backend de la cola (decisión de
//  arquitectura). Este módulo ahora es un wrapper delgado sobre
//  src/queue.js (cola local persistida en data/queue.json), para que
//  el resto del proyecto (bot.js, twitch.js) no tenga que cambiar sus
//  llamadas. Si en el futuro se quiere volver a una cola en base de
//  datos, este es el único archivo que habría que tocar.
// ============================================

const localQueue = require("./queue");
const { createLogger } = require("./logger");

const log = createLogger("QUEUE");

localQueue.inicializar();

async function agregarMensaje(entrada) {
  return localQueue.agregar(entrada);
}

async function actualizarAudio(id, rutaAudio) {
  localQueue.actualizarAudio(id, rutaAudio);
}

async function obtenerPrimero() {
  return localQueue.obtenerPrimero();
}

async function marcarComoeproduciendo(id) {
  // La cola local no distingue "en reproducción" de "pendiente": el
  // mensaje se elimina cuando termina de sonar (ver bot.js -> ws.alTerminar).
  // Se deja esta función vacía únicamente para no romper la interfaz que
  // ya usan bot.js y twitch.js.
}

async function eliminar(id) {
  localQueue.eliminar(id);
  return true;
}

async function total() {
  return localQueue.total();
}

async function leer(limit = 100) {
  return localQueue.leer().slice(0, limit);
}

async function limpiar() {
  localQueue.limpiar();
  log.info("Cola limpiada");
}

async function stats() {
  return localQueue.stats();
}

async function limpiarViejos() {
  const antes = localQueue.total();
  const restante = localQueue.obtenerPrimero() ? localQueue.total() : 0;
  return antes - restante;
}

// Se mantiene por compatibilidad con bot.js (await mongoQueue.conectar()),
// pero ya no conecta a nada: la cola local no necesita conexión.
async function conectar() {
  log.info("Cola en memoria local activa (sin base de datos externa)");
  return true;
}

module.exports = {
  conectar,
  agregarMensaje,
  actualizarAudio,
  obtenerPrimero,
  marcarComoeproduciendo,
  eliminar,
  total,
  leer,
  limpiar,
  stats,
  limpiarViejos,
};
