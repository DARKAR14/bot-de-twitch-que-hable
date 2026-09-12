// ============================================
// panel-api.js - Autenticacion e idempotencia para el panel externo
// ============================================

const crypto = require("crypto");

function comparacionSegura(a, b) {
  const izquierda = Buffer.from(String(a || ""));
  const derecha = Buffer.from(String(b || ""));
  return izquierda.length === derecha.length && crypto.timingSafeEqual(izquierda, derecha);
}

function tokenDeSolicitud(req) {
  const bearer = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return bearer || req.headers?.["x-panel-token"] || "";
}

function normalizarIdActor(valor) {
  const actorId = String(valor || "").trim();
  if (!actorId || actorId.length > 100 || /[\u0000-\u001f\u007f]/.test(actorId)) return null;
  return actorId;
}

function normalizarClaveIdempotencia(valor) {
  const clave = String(valor || "").trim();
  if (clave.length < 8 || clave.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(clave)) return null;
  return clave;
}

function crearApiPanel(config, { ahora = () => Date.now() } = {}) {
  const porClave = new Map();
  const porTrabajo = new Map();
  const ttlMs = config.PANEL_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000;
  const maximo = config.PANEL_IDEMPOTENCY_MAX;

  function autenticacion(req) {
    if (!config.PANEL_API_TOKEN) {
      return {
        ok: false,
        status: 503,
        code: "PANEL_API_NOT_CONFIGURED",
        error: "La API del panel no está configurada en el bot.",
      };
    }
    if (!comparacionSegura(tokenDeSolicitud(req), config.PANEL_API_TOKEN)) {
      return {
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
        error: "La credencial del panel no es válida.",
      };
    }
    return { ok: true };
  }

  function limpiar() {
    const limite = ahora() - ttlMs;
    for (const [clave, registro] of porClave) {
      if (registro.createdAt <= limite) {
        porClave.delete(clave);
        porTrabajo.delete(registro.body.id);
      }
    }
    while (porClave.size > maximo) {
      const primera = porClave.keys().next().value;
      if (primera === undefined) break;
      const registro = porClave.get(primera);
      porClave.delete(primera);
      if (registro) porTrabajo.delete(registro.body.id);
    }
  }

  function huella(payload) {
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  function buscarRepetida(clave, fingerprint) {
    limpiar();
    const registro = porClave.get(clave);
    if (!registro) return null;
    if (registro.fingerprint !== fingerprint) {
      return {
        conflict: true,
        status: 409,
        body: {
          ok: false,
          code: "IDEMPOTENCY_KEY_REUSED",
          error: "Esa Idempotency-Key ya fue usada con otro contenido.",
        },
      };
    }
    return {
      conflict: false,
      status: registro.status,
      body: { ...registro.body, replayed: true },
    };
  }

  function registrar(clave, fingerprint, status, body) {
    limpiar();
    const registro = {
      fingerprint,
      status,
      body: { ...body, replayed: false },
      createdAt: ahora(),
    };
    porClave.set(clave, registro);
    porTrabajo.set(body.id, registro);
    limpiar();
    return { ...registro.body };
  }

  function trabajo(id) {
    limpiar();
    return porTrabajo.get(String(id || "")) || null;
  }

  return {
    autenticacion,
    buscarRepetida,
    huella,
    registrar,
    trabajo,
  };
}

module.exports = {
  crearApiPanel,
  _internals: {
    comparacionSegura,
    normalizarClaveIdempotencia,
    normalizarIdActor,
    tokenDeSolicitud,
  },
};
