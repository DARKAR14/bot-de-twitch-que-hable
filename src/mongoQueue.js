// ============================================
//  mongoQueue.js - Cola de TTS en MongoDB
//  Conexión LAZY - solo intenta cuando se necesita
//  Fallback a queue.js si MongoDB no está disponible
// ============================================

const { MongoClient } = require("mongodb");
const { createLogger } = require("./logger");
const localQueue = require("./queue");

const log = createLogger("MONGO_QUEUE");

const MONGO_URL =
  process.env.MONGO_URL || "mongodb://localhost:27017/twitchbot";
let _db = null;
let client = null;
let mongoDisponible = null; // null = no probado, true/false = resultado

// ── Inicializar cola local ─────────────────────────────────────
localQueue.inicializar();

// ── Conexión LAZY a MongoDB ────────────────────────────────────
async function conectar() {
  if (_db) return _db;
  if (mongoDisponible === false) return null; // Ya intentamos y falló

  try {
    const c = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 });
    await c.connect();
    _db = c.db("twitchbot");
    client = c;
    mongoDisponible = true;
    log.info("✓ MongoDB conectado");
    return _db;
  } catch (err) {
    mongoDisponible = false;
    log.warn(`⚠️  MongoDB no disponible (${err.message}). Usando cola local.`);
    return null;
  }
}

async function obtenerColeccion(nombre) {
  if (mongoDisponible === null) await conectar();
  if (!_db) return null; // MongoDB no disponible
  return _db.collection(nombre);
}

// ── Operaciones de Cola ────────────────────────────────────────

async function agregarMensaje(entrada) {
  try {
    if (mongoDisponible === null) await conectar();

    if (_db) {
      const col = await obtenerColeccion("tts_messages");
      if (col) {
        const nueva = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          usuario: entrada.usuario,
          mensaje: entrada.mensaje,
          idioma: entrada.idioma || "es",
          audioHash: entrada.audioHash || null,
          audioBase64: entrada.audioBase64 || null,
          reproduccion: false,
          rutaAudio: entrada.rutaAudio || null,
          createdAt: new Date().toISOString(),
        };

        await col.insertOne(nueva);
        log.debug(`[MONGO] +1 en cola (${nueva.usuario})`);
        return nueva;
      }
    }
  } catch (err) {
    log.warn(`[MONGO FALLBACK] Error agregando: ${err.message}`);
  }

  // Fallback: usar cola local
  const localEntry = localQueue.agregar(entrada);
  log.info(`[LOCAL] +1 en cola (${localEntry.usuario})`);
  return localEntry;
}

async function actualizarAudio(id, rutaAudio, audioBase64 = null) {
  try {
    if (mongoDisponible === null) await conectar();

    if (_db) {
      const col = await obtenerColeccion("tts_messages");
      if (col) {
        await col.updateOne({ id }, { $set: { rutaAudio, audioBase64 } });
        log.debug(`[MONGO] Audio actualizado para ID: ${id}`);
        return;
      }
    }
  } catch (err) {
    log.warn(`[MONGO FALLBACK] Error actualizando audio: ${err.message}`);
  }

  // Fallback: usar cola local
  localQueue.actualizarAudio(id, rutaAudio);
}

async function obtenerPrimero() {
  try {
    if (mongoDisponible === null) await conectar();

    if (_db) {
      const col = await obtenerColeccion("tts_messages");
      if (col) {
        return await col.findOne(
          { reproduccion: false },
          { sort: { createdAt: 1 } },
        );
      }
    }
  } catch (err) {
    log.warn(
      `[MONGO FALLBACK] Error obteniendo primer mensaje: ${err.message}`,
    );
  }

  // Fallback: usar cola local
  return localQueue.obtenerPrimero();
}

async function marcarComoeproduciendo(id) {
  try {
    if (mongoDisponible === null) await conectar();

    if (_db) {
      const col = await obtenerColeccion("tts_messages");
      if (col) {
        await col.updateOne(
          { id },
          { $set: { reproduccion: true, playedAt: new Date().toISOString() } },
        );
        log.debug(`[MONGO] Marcado como reproduciendo: ${id}`);
        return;
      }
    }
  } catch (err) {
    log.warn(
      `[MONGO FALLBACK] Error marcando como reproduciendo: ${err.message}`,
    );
  }
}

async function eliminar(id) {
  try {
    if (mongoDisponible === null) await conectar();

    if (_db) {
      const col = await obtenerColeccion("tts_messages");
      if (col) {
        const result = await col.deleteOne({ id });
        if (result.deletedCount > 0) {
          log.debug(`[MONGO] -1 de cola: ${id}`);
          return true;
        }
      }
    }
  } catch (err) {
    log.warn(`[MONGO FALLBACK] Error eliminando: ${err.message}`);
  }

  // Fallback: usar cola local
  localQueue.eliminar(id);
  return true;
}

async function total() {
  try {
    if (mongoDisponible === null) await conectar();

    if (_db) {
      const col = await obtenerColeccion("tts_messages");
      if (col) {
        return await col.countDocuments({ reproduccion: false });
      }
    }
  } catch (err) {
    log.warn(`[MONGO FALLBACK] Error contando mensajes: ${err.message}`);
  }

  // Fallback: usar cola local
  return localQueue.total();
}

async function leer(limit = 100) {
  try {
    if (mongoDisponible === null) await conectar();

    if (_db) {
      const col = await obtenerColeccion("tts_messages");
      if (col) {
        return await col
          .find({ reproduccion: false })
          .sort({ createdAt: 1 })
          .limit(limit)
          .toArray();
      }
    }
  } catch (err) {
    log.warn(`[MONGO FALLBACK] Error leyendo cola: ${err.message}`);
  }

  // Fallback: usar cola local
  return localQueue.leer();
}

async function limpiar() {
  try {
    const col = await obtenerColeccion("tts_messages");
    const result = await col.deleteMany({ reproduccion: false });
    log.info(`Cola limpiada (${result.deletedCount} mensajes)`);
  } catch (err) {
    log.error("Error limpiando cola", err.message);
  }
}

async function stats() {
  try {
    const col = await obtenerColeccion("tts_messages");

    const queue = await col.find({ reproduccion: false }).toArray();

    const usuariosUnicos = new Set(queue.map((e) => e.usuario)).size;

    const porIdioma = queue.reduce((acc, e) => {
      acc[e.idioma || "es"] = (acc[e.idioma || "es"] || 0) + 1;
      return acc;
    }, {});

    return {
      total: queue.length,
      usuariosUnicos,
      porIdioma,
      masAntiguo: queue[0]?.createdAt || null,
    };
  } catch (err) {
    log.error("Error obteniendo stats", err.message);
    return { total: 0, usuariosUnicos: 0, porIdioma: {}, masAntiguo: null };
  }
}

async function limpiarViejos(daysOld = 7) {
  try {
    const col = await obtenerColeccion("tts_messages");
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await col.deleteMany({
      createdAt: { $lt: cutoffDate.toISOString() },
      reproduccion: true,
    });

    log.info(
      `Limpieza de antiguos: ${result.deletedCount} mensajes eliminados`,
    );
    return result.deletedCount;
  } catch (err) {
    log.error("Error limpiando antiguos", err.message);
    return 0;
  }
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
