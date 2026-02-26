// ============================================
//  antibot.js - Detección de bots y spam
// ============================================

const { MongoClient } = require('mongodb');
const CONFIG = require('./config');

let db = null;
let coleccionPatrones = null;
let coleccionBaneados = null;

// ── Conexión a MongoDB ─────────────────────────────────────────
async function conectar() {
  if (!CONFIG.MONGODB_URI) {
    console.warn('⚠️  MONGODB_URI no configurado, antibot desactivado');
    return false;
  }
  try {
    const client = new MongoClient(CONFIG.MONGODB_URI);
    await client.connect();
    db = client.db(CONFIG.MONGODB_DB || 'hablabot');
    coleccionPatrones  = db.collection('patrones_bot');
    coleccionBaneados  = db.collection('baneados');

    // Índices para búsqueda rápida
    await coleccionPatrones.createIndex({ patron: 1 });
    await coleccionBaneados.createIndex({ usuario: 1 }, { unique: true });

    // Insertar patrones por defecto si la colección está vacía
    const total = await coleccionPatrones.countDocuments();
    if (total === 0) await insertarPatronesIniciales();

    console.log('✅ MongoDB conectado — antibot activo');
    return true;
  } catch (err) {
    console.error('❌ Error conectando MongoDB:', err.message);
    return false;
  }
}

// Patrones comunes de bots de spam en Twitch
async function insertarPatronesIniciales() {
  const patrones = [
    { patron: 'nezhna',        descripcion: 'Bot de viewers falsos' },
    { patron: 'streamboo',     descripcion: 'Bot de viewers falsos' },
    { patron: 'we specialize in promoting',  descripcion: 'Spam promocional' },
    { patron: 'top viewers',   descripcion: 'Bot de viewers' },
    { patron: 'buy viewers',   descripcion: 'Venta de viewers' },
    { patron: 'cheap viewers', descripcion: 'Venta de viewers' },
    { patron: 'follow4follow',  descripcion: 'Spam de follows' },
    { patron: 'f4f',           descripcion: 'Spam de follows' },
    { patron: 'increase your', descripcion: 'Spam promocional' },
    { patron: 'boost your stream', descripcion: 'Spam promocional' },
    { patron: 'get more viewers', descripcion: 'Spam promocional' },
  ];
  await coleccionPatrones.insertMany(patrones);
  console.log(`📋 ${patrones.length} patrones de antibot insertados`);
}

// ── Detectar si un mensaje es de bot ──────────────────────────
async function esBot(mensaje) {
  if (!coleccionPatrones) return false;
  try {
    const msgLower = mensaje.toLowerCase();
    const patrones = await coleccionPatrones.find({}).toArray();
    return patrones.some((p) => msgLower.includes(p.patron.toLowerCase()));
  } catch {
    return false;
  }
}

// ── Registrar usuario baneado ─────────────────────────────────
async function registrarBaneo(usuario, mensaje, razon) {
  if (!coleccionBaneados) return;
  try {
    await coleccionBaneados.updateOne(
      { usuario },
      { $set: { usuario, ultimoMensaje: mensaje, razon, fecha: new Date() } },
      { upsert: true }
    );
    console.log(`🚫 Bot baneado registrado: ${usuario}`);
  } catch (err) {
    console.error('⚠️  Error registrando baneo:', err.message);
  }
}

// ── Agregar patrón manualmente (desde chat con !addbot) ───────
async function agregarPatron(patron, descripcion = 'Manual') {
  if (!coleccionPatrones) return false;
  try {
    await coleccionPatrones.updateOne(
      { patron: patron.toLowerCase() },
      { $set: { patron: patron.toLowerCase(), descripcion, fecha: new Date() } },
      { upsert: true }
    );
    return true;
  } catch {
    return false;
  }
}

// ── Limpiar letras repetidas (AAAAAAA → AAAA) ────────────────
function limpiarRepeticiones(texto, maxRepeticiones = 4) {
  // Reemplaza cualquier carácter repetido más de N veces
  return texto.replace(/(.)\1{4,}/g, (match, char) => char.repeat(maxRepeticiones));
}

module.exports = { conectar, esBot, registrarBaneo, agregarPatron, limpiarRepeticiones };