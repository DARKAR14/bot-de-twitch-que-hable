// ============================================
//  queue.js - Cola local rapida y persistencia atomica
// ============================================

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createLogger } = require("./logger");

const log = createLogger("QUEUE");
const DEFAULT_QUEUE_FILE = path.join(__dirname, "../data/queue.json");

function crearCola(queueFile = DEFAULT_QUEUE_FILE, logger = log) {
  const tempFile = `${queueFile}.tmp`;
  let items = [];
  let inicializada = false;

  function persistir() {
    const dir = path.dirname(queueFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(items, null, 2), "utf8");
    fs.renameSync(tempFile, queueFile);
  }

  function inicializar({ limpiarAlArrancar = true } = {}) {
    fs.mkdirSync(path.dirname(queueFile), { recursive: true });

    if (!limpiarAlArrancar && fs.existsSync(queueFile)) {
      try {
        const contenido = JSON.parse(fs.readFileSync(queueFile, "utf8"));
        items = Array.isArray(contenido) ? contenido : [];
      } catch (err) {
        logger.warn("queue.json no era valido; se inicia una cola vacia", err.message);
        items = [];
      }
    } else {
      if (fs.existsSync(queueFile)) {
        try {
          const anterior = JSON.parse(fs.readFileSync(queueFile, "utf8"));
          if (Array.isArray(anterior) && anterior.length > 0) {
            logger.warn(
              `Descartando ${anterior.length} mensaje(s) de una sesion anterior`,
            );
          }
        } catch {}
      }
      items = [];
    }

    persistir();
    inicializada = true;
  }

  function asegurarInicializada() {
    if (!inicializada) inicializar();
  }

  function agregar(entrada) {
    asegurarInicializada();
    const nueva = {
      id: crypto.randomUUID(),
      usuario: entrada.usuario,
      mensaje: entrada.mensaje,
      idioma: entrada.idioma || "es",
      estado: "generando",
      timestamp: new Date().toISOString(),
    };
    items.push(nueva);
    persistir();
    logger.info(`+1 en cola (total: ${items.length}) | ${nueva.usuario}`);
    return { ...nueva };
  }

  function actualizarAudio(id, audio) {
    asegurarInicializada();
    const entrada = items.find((item) => item.id === id);
    if (!entrada) return false;
    entrada.rutaAudio = audio.rutaAudio;
    entrada.audioMime = audio.mimeType || "audio/mpeg";
    entrada.proveedorTts = audio.provider || "google";
    entrada.estado = "listo";
    delete entrada.errorTts;
    persistir();
    return true;
  }

  function marcarFallback(id, error) {
    asegurarInicializada();
    const entrada = items.find((item) => item.id === id);
    if (!entrada) return false;
    entrada.estado = "listo";
    entrada.fallbackNavegador = true;
    entrada.errorTts = String(error || "TTS no disponible").slice(0, 200);
    persistir();
    return true;
  }

  function buscar(id) {
    asegurarInicializada();
    const entrada = items.find((item) => item.id === id);
    return entrada ? { ...entrada } : null;
  }

  function obtenerPrimero() {
    asegurarInicializada();
    return items[0] ? { ...items[0] } : null;
  }

  function eliminar(id) {
    asegurarInicializada();
    const indice = items.findIndex((item) => item.id === id);
    if (indice === -1) return null;
    const [eliminada] = items.splice(indice, 1);
    persistir();
    logger.info(`-1 de cola (total: ${items.length}) | ID: ${id}`);
    return { ...eliminada };
  }

  function limpiar() {
    asegurarInicializada();
    const eliminadas = items.map((item) => ({ ...item }));
    items = [];
    persistir();
    logger.info("Cola limpiada completamente");
    return eliminadas;
  }

  function leer() {
    asegurarInicializada();
    return items.map((item) => ({ ...item }));
  }

  function total() {
    asegurarInicializada();
    return items.length;
  }

  function stats() {
    asegurarInicializada();
    const porIdioma = items.reduce((acc, item) => {
      acc[item.idioma] = (acc[item.idioma] || 0) + 1;
      return acc;
    }, {});
    return {
      total: items.length,
      usuariosUnicos: new Set(items.map((item) => item.usuario)).size,
      porIdioma,
      generando: items.filter((item) => item.estado === "generando").length,
      listo: items.filter((item) => item.estado === "listo").length,
      masAntiguo: items[0]?.timestamp || null,
    };
  }

  return {
    inicializar,
    agregar,
    actualizarAudio,
    marcarFallback,
    buscar,
    obtenerPrimero,
    eliminar,
    limpiar,
    leer,
    total,
    stats,
  };
}

const cola = crearCola();
module.exports = { ...cola, crearCola };
