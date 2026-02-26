// ============================================
//  queue.js - Manejo de cola de peticiones TTS
// ============================================

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, '../data/queue.json');

// Asegura que el archivo existe
function inicializar() {
  const dir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) guardar([]);
}

function leer() {
  try {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    console.warn('⚠️  Error leyendo queue.json, reseteando...');
    guardar([]);
    return [];
  }
}

function guardar(data) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Error guardando queue.json:', err.message);
  }
}

function agregar(entrada) {
  const queue = leer();
  const nueva = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    usuario: entrada.usuario,
    mensaje: entrada.mensaje,
    timestamp: new Date().toISOString(),
  };
  queue.push(nueva);
  guardar(queue);
  console.log(`📥 Cola: +1 (total: ${queue.length}) | ${nueva.usuario}: "${nueva.mensaje}"`);
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
  console.log(`🗑️  Cola: -1 (total: ${nueva.length}) | ID eliminado: ${id}`);
}

function obtenerPrimero() {
  const queue = leer();
  return queue[0] || null;
}

function total() {
  return leer().length;
}

function limpiar() {
  guardar([]);
  console.log('🧹 Cola limpiada completamente');
}

module.exports = { inicializar, agregar, eliminar, actualizarAudio, obtenerPrimero, total, limpiar, leer };