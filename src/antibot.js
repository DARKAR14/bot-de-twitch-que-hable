// ============================================
//  antibot.js - Filtro de lenguaje y utilidades de chat
//  NOTA: la detección de bots de spam por patrones (esBot,
//  registrarBaneo, agregarPatron) dependía de MongoDB y quedó
//  descartada como decisión de arquitectura. Lo que queda aquí es
//  100% en memoria y no necesita ninguna base de datos.
// ============================================

const { palabrasProhibidas } = require('./prohibidas');

// Historial de faltas en memoria
const historialFaltas = new Map();

// ── Censurar palabras ofensivas ────────────────────────────────
function censurar(texto) {
  let resultado = texto;
  palabrasProhibidas.forEach(palabra => {
    const regex = new RegExp(palabra, 'gi');
    resultado = resultado.replace(regex, '***');
  });
  return resultado;
}

// ── Obtener siguiente castigo ──────────────────────────────────
function obtenerCastigo(usuario) {
  const faltas = (historialFaltas.get(usuario) || 0) + 1;
  historialFaltas.set(usuario, faltas);

  if (faltas === 1) return { tiempo: 60, razon: "Palabra prohibida (1ª falta)" };
  if (faltas === 2) return { tiempo: 300, razon: "Palabra prohibida (2ª falta)" };
  return { tiempo: 86400, razon: "Palabra prohibida (Reincidente)" }; // 1 día
}

// ── Limpiar letras repetidas (AAAAAAA → AAAA) ────────────────
function limpiarRepeticiones(texto, maxRepeticiones = 4) {
  // Reemplaza cualquier carácter repetido más de N veces
  return texto.replace(/(.)\1{4,}/g, (match, char) => char.repeat(maxRepeticiones));
}

module.exports = { limpiarRepeticiones, censurar, obtenerCastigo };
