// ============================================
//  logger.js - Logger centralizado
// ============================================

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const COLORS = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // verde
  warn: "\x1b[33m", // amarillo
  error: "\x1b[31m", // rojo
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

const ICONS = {
  debug: "🔍",
  info: "✅",
  warn: "⚠️ ",
  error: "❌",
};

// Nivel mínimo — en producción usa 'info', en dev usa 'debug'
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || "info"];

function timestamp() {
  return new Date().toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function log(level, modulo, mensaje, extra) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const color = COLORS[level];
  const ts = `${COLORS.dim}[${timestamp()}]${COLORS.reset}`;
  const mod = `${COLORS.bold}${COLORS.dim}[${modulo}]${COLORS.reset}`;
  const icon = ICONS[level];
  const msg = `${color}${mensaje}${COLORS.reset}`;

  if (extra !== undefined) {
    console.log(`${ts} ${icon} ${mod} ${msg}`, extra);
  } else {
    console.log(`${ts} ${icon} ${mod} ${msg}`);
  }
}

// ── API pública ────────────────────────────────────────────────
const createLogger = (modulo) => ({
  debug: (msg, extra) => log("debug", modulo, msg, extra),
  info: (msg, extra) => log("info", modulo, msg, extra),
  warn: (msg, extra) => log("warn", modulo, msg, extra),
  error: (msg, extra) => log("error", modulo, msg, extra),
});

module.exports = { createLogger };
