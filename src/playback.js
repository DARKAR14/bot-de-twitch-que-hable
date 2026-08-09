// ============================================
//  playback.js - Estado unico de reproduccion
// ============================================

const CONFIG = require("./config");
const queue = require("./queue");
const ws = require("./websocket");
const tts = require("./tts");
const { createLogger } = require("./logger");

const log = createLogger("PLAYBACK");

function crearControlador({
  cola = queue,
  socket = ws,
  audio = tts,
  logger = log,
  timeoutMs = CONFIG.PLAYBACK_TIMEOUT_MS,
  advanceDelayMs = 150,
} = {}) {
  let activoId = null;
  let timeout = null;
  let programado = false;
  let inicializado = false;

  function limpiarTimeout() {
    if (timeout) clearTimeout(timeout);
    timeout = null;
  }

  function payloadDe(entrada) {
    const audioBase64 = entrada.rutaAudio
      ? audio.audioABase64(entrada.rutaAudio)
      : null;
    return {
      tipo: "nuevo",
      id: entrada.id,
      usuario: entrada.usuario,
      mensaje: entrada.mensaje,
      idioma: entrada.idioma,
      audioBase64,
      audioMime: audioBase64 ? entrada.audioMime || "audio/mpeg" : null,
      proveedorTts: entrada.proveedorTts || "navegador",
    };
  }

  function armarTimeout() {
    limpiarTimeout();
    timeout = setTimeout(() => {
      logger.warn(`Timeout de reproduccion para ${activoId}; avanzando la cola`);
      completar(activoId, "timeout");
    }, timeoutMs);
    timeout.unref?.();
  }

  function enviarActivo(motivo) {
    if (!activoId) return false;
    const entrada = cola.buscar(activoId);
    if (!entrada) {
      activoId = null;
      notificarCambio();
      return false;
    }

    const enviado = socket.enviar(payloadDe(entrada));
    if (enviado) {
      logger.info(`Reproduciendo ${entrada.id} (${motivo})`);
      armarTimeout();
    }
    return enviado;
  }

  function procesar() {
    programado = false;
    if (activoId) return;

    const primero = cola.obtenerPrimero();
    if (!primero || primero.estado !== "listo") return;

    activoId = primero.id;
    enviarActivo("nuevo");
  }

  function notificarCambio() {
    if (programado) return;
    programado = true;
    queueMicrotask(procesar);
  }

  function completar(id, motivo = "confirmado") {
    if (!activoId || id !== activoId) {
      logger.debug(`Confirmacion obsoleta ignorada: ${id}`);
      return false;
    }

    limpiarTimeout();
    const eliminada = cola.eliminar(id);
    activoId = null;
    if (eliminada?.rutaAudio) audio.eliminarAudio(eliminada.rutaAudio);
    logger.info(`TTS ${motivo}: ${id}`);
    setTimeout(notificarCambio, advanceDelayMs).unref?.();
    return true;
  }

  function alConectar() {
    if (activoId) enviarActivo("reconexion");
    else notificarCambio();
  }

  function inicializar() {
    if (inicializado) return;
    inicializado = true;
    socket.alTerminar((id) => completar(id));
    socket.alConectar(alConectar);
    notificarCambio();
  }

  function limpiar() {
    const activoAnterior = activoId;
    if (activoAnterior) socket.enviar({ tipo: "cancelar", id: activoAnterior });
    limpiarTimeout();
    activoId = null;
    const eliminadas = cola.limpiar();
    for (const entrada of eliminadas) {
      if (entrada.rutaAudio) audio.eliminarAudio(entrada.rutaAudio);
    }
    return eliminadas.length;
  }

  function estado() {
    return { activoId, esperandoAudio: cola.obtenerPrimero()?.estado === "generando" };
  }

  function detener() {
    limpiarTimeout();
  }

  return { inicializar, notificarCambio, completar, limpiar, estado, detener };
}

const controlador = crearControlador();
module.exports = { ...controlador, crearControlador };
