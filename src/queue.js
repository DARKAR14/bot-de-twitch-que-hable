// ============================================
//  queue.js - Cola de peticiones TTS
//  Mejoras: escritura atómica, límite de edad,
//           método stats(), logger centralizado
// ============================================

const fs = require("fs");
const path = require("path");
const { createLogger } = require("./logger");

const log = createLogger("QUEUE");
const QUEUE_FILE = path.join(__dirname, "../data/queue.json");
const TEMP_FILE = QUEUE_FILE + ".tmp";

// Mensajes con más de 30 minutos se descartan automáticamente
const MAX_EDAD_MS = 30 * 60 * 1000;

// ── Persistencia ───────────────────────────────────────────────

function inicializar() {
  const dir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Siempre se arranca con la cola vacía, incluso si ya existía un
  // queue.json de una sesión anterior. Antes solo se creaba el archivo
  // si no existía, así que un crash a mitad de proceso dejaba mensajes
  // viejos (o duplicados) esperando en disco y el bot los volvía a
  // procesar al reiniciar. Un reinicio del bot es un buen punto para
  // empezar la cola desde cero.
  if (fs.existsSync(QUEUE_FILE)) {
    const previo = leer();
    if (previo.length > 0) {
      log.warn(`Descartando ${previo.length} mensaje(s) pendiente(s) de la sesión anterior`);
    }
  }
  guardar([]);
}

function leer() {
  try {
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    log.warn("Error leyendo queue.json, reseteando...");
    guardar([]);
    return [];
  }
}

// Escritura atómica: escribe en .tmp y luego renombra
// Así si el proceso muere a mitad de escritura, el archivo original queda intacto
function guardar(data) {
  try {
    fs.writeFileSync(TEMP_FILE, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(TEMP_FILE, QUEUE_FILE);
  } catch (err) {
    log.error("Error guardando queue.json", err.message);
  }
}

// ── Limpieza por edad ──────────────────────────────────────────
// Descarta mensajes que llevan más de MAX_EDAD_MS esperando
// (por ejemplo, si OBS estuvo desconectado mucho tiempo)
function limpiarViejos() {
  const queue = leer();
  const ahora = Date.now();
  const validos = queue.filter((e) => {
    const edad = ahora - new Date(e.timestamp).getTime();
    if (edad > MAX_EDAD_MS) {
      log.warn(
        `Mensaje descartado por antigüedad (${Math.round(edad / 60000)} min): ${e.usuario}`,
      );
      return false;
    }
    return true;
  });

  if (validos.length !== queue.length) {
    guardar(validos);
    log.info(
      `Limpieza por edad: ${queue.length - validos.length} mensajes descartados`,
    );
  }

  return validos;
}

// ── Operaciones ────────────────────────────────────────────────

function agregar(entrada) {
  const queue = leer();
  const nueva = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    usuario: entrada.usuario,
    mensaje: entrada.mensaje,
    idioma: entrada.idioma || "es",
    timestamp: new Date().toISOString(),
  };
  queue.push(nueva);
  guardar(queue);
  log.info(
    `+1 en cola (total: ${queue.length}) | ${nueva.usuario}: "${nueva.mensaje}"`,
  );
  return nueva;
}

function actualizarAudio(id, rutaAudio) {
  const queue = leer();
  const entry = queue.find((e) => e.id === id);
  if (entry) {
    entry.rutaAudio = rutaAudio;
    guardar(queue);
  }
}

function eliminar(id) {
  const queue = leer();
  const nueva = queue.filter((e) => e.id !== id);
  guardar(nueva);
  log.info(`-1 de cola (total: ${nueva.length}) | ID: ${id}`);
}

function obtenerPrimero() {
  const queue = limpiarViejos(); // Aprovecha cada consulta para limpiar viejos
  return queue[0] || null;
}

function total() {
  return leer().length;
}

function limpiar() {
  guardar([]);
  log.info("Cola limpiada completamente");
}

// ── Estadísticas ───────────────────────────────────────────────
// Útil para el dashboard o para el comando !stats en chat
function stats() {
  const queue = leer();

  const usuariosUnicos = new Set(queue.map((e) => e.usuario)).size;

  const porIdioma = queue.reduce((acc, e) => {
    acc[e.idioma || "es"] = (acc[e.idioma || "es"] || 0) + 1;
    return acc;
  }, {});

  return {
    total: queue.length,
    usuariosUnicos,
    porIdioma,
    masAntiguo: queue[0]?.timestamp || null,
  };
}

module.exports = {
  inicializar,
  agregar,
  eliminar,
  actualizarAudio,
  obtenerPrimero,
  total,
  limpiar,
  leer,
  stats,
};
