// ============================================
//  usage.js - Presupuesto diario y control de rafagas
// ============================================

const fs = require("fs");
const path = require("path");
const CONFIG = require("./config");
const { createLogger } = require("./logger");

const log = createLogger("USAGE");
const DEFAULT_USAGE_FILE = path.join(__dirname, "../data/usage.json");

function crearFormateador(zonaHoraria) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zonaHoraria,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
}

function crearControlUso(
  usageFile = DEFAULT_USAGE_FILE,
  logger = log,
  { ahora = () => Date.now(), zonaHoraria = CONFIG.USAGE_TIMEZONE } = {},
) {
  const formateador = crearFormateador(zonaHoraria);
  const cooldownsUsuario = new Map();
  const ultimoUsoGlobal = new Map();
  let datos = null;

  function claveDia(timestamp = ahora()) {
    const partes = Object.fromEntries(
      formateador
        .formatToParts(new Date(timestamp))
        .filter((parte) => parte.type !== "literal")
        .map((parte) => [parte.type, parte.value]),
    );
    return `${partes.year}-${partes.month}-${partes.day}`;
  }

  function persistir() {
    try {
      fs.mkdirSync(path.dirname(usageFile), { recursive: true });
      const temporal = `${usageFile}.${process.pid}.tmp`;
      fs.writeFileSync(temporal, JSON.stringify(datos, null, 2), "utf8");
      fs.renameSync(temporal, usageFile);
    } catch (err) {
      logger.warn("No se pudo persistir el presupuesto diario", err.message);
    }
  }

  function cargar() {
    if (datos) return;
    try {
      const contenido = JSON.parse(fs.readFileSync(usageFile, "utf8"));
      datos =
        contenido && typeof contenido === "object"
          ? contenido
          : { dia: claveDia(), categorias: {} };
    } catch (err) {
      if (err.code !== "ENOENT") {
        logger.warn("usage.json no era valido; se reinicia el presupuesto", err.message);
      }
      datos = { dia: claveDia(), categorias: {} };
    }
  }

  function asegurarDia() {
    cargar();
    const hoy = claveDia();
    if (datos.dia === hoy) return;
    datos = { dia: hoy, categorias: {} };
    cooldownsUsuario.clear();
    ultimoUsoGlobal.clear();
    persistir();
  }

  function contador(tipo) {
    datos.categorias ||= {};
    datos.categorias[tipo] ||= { total: 0, usuarios: {} };
    return datos.categorias[tipo];
  }

  function rechazo(tipo, motivo, extra = {}) {
    return { ok: false, tipo, motivo, ...extra };
  }

  function reservarVarios(solicitudes, { usuario, bypassUsuario = false } = {}) {
    asegurarDia();
    const ahoraMs = ahora();
    const claveUsuario = String(usuario || "anonimo").toLowerCase();

    for (const solicitud of solicitudes) {
      const {
        tipo,
        cooldownMs = 0,
        globalCooldownMs = 0,
        limiteDiario = Number.MAX_SAFE_INTEGER,
        limiteUsuario = Number.MAX_SAFE_INTEGER,
      } = solicitud;
      const actual = contador(tipo);

      if (actual.total >= limiteDiario) {
        return rechazo(tipo, "limite_diario");
      }
      if (!bypassUsuario && (actual.usuarios[claveUsuario] || 0) >= limiteUsuario) {
        return rechazo(tipo, "limite_usuario");
      }

      if (!bypassUsuario && cooldownMs > 0) {
        const ultimo = cooldownsUsuario.get(`${tipo}:${claveUsuario}`) || 0;
        const restanteMs = cooldownMs - (ahoraMs - ultimo);
        if (restanteMs > 0) {
          return rechazo(tipo, "cooldown_usuario", {
            restante: Math.max(1, Math.ceil(restanteMs / 1000)),
          });
        }
      }

      if (globalCooldownMs > 0) {
        const ultimo = ultimoUsoGlobal.get(tipo) || 0;
        const restanteMs = globalCooldownMs - (ahoraMs - ultimo);
        if (restanteMs > 0) {
          return rechazo(tipo, "cooldown_global", {
            restante: Math.max(1, Math.ceil(restanteMs / 1000)),
          });
        }
      }
    }

    for (const solicitud of solicitudes) {
      const actual = contador(solicitud.tipo);
      actual.total += 1;
      actual.usuarios[claveUsuario] = (actual.usuarios[claveUsuario] || 0) + 1;
      cooldownsUsuario.set(`${solicitud.tipo}:${claveUsuario}`, ahoraMs);
      ultimoUsoGlobal.set(solicitud.tipo, ahoraMs);
    }
    persistir();
    return { ok: true, dia: datos.dia };
  }

  function stats() {
    asegurarDia();
    return JSON.parse(JSON.stringify(datos));
  }

  function resumen() {
    const estado = stats();
    return {
      dia: estado.dia,
      categorias: Object.fromEntries(
        Object.entries(estado.categorias || {}).map(([tipo, categoria]) => [
          tipo,
          {
            total: categoria.total || 0,
            usuariosUnicos: Object.keys(categoria.usuarios || {}).length,
          },
        ]),
      ),
    };
  }

  return { reservarVarios, stats, resumen, claveDia };
}

const control = crearControlUso();
module.exports = { ...control, crearControlUso, DEFAULT_USAGE_FILE };
