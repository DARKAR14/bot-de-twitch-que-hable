// ============================================
// twitch-token-store.js - Token EventSub desde MongoDB con refresh
// ============================================

const { MongoClient } = require("mongodb");
const CONFIG = require("./config");
const { createLogger } = require("./logger");

const log = createLogger("TWITCH_TOKEN");

function fechaMs(valor) {
  if (valor instanceof Date) return valor.getTime();
  const timestamp = new Date(valor || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function renovarToken(refreshToken) {
  if (!CONFIG.TWITCH_CLIENT_ID || !CONFIG.TWITCH_CLIENT_SECRET) {
    throw new Error(
      "El token Twitch expiró; configura TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET para renovarlo",
    );
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CONFIG.TWITCH_CLIENT_ID,
    client_secret: CONFIG.TWITCH_CLIENT_SECRET,
  });
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 10_000);
  timeout.unref?.();
  try {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controlador.signal,
    });
    const detalle = await response.text();
    let data;
    try {
      data = JSON.parse(detalle);
    } catch {
      data = null;
    }
    if (!response.ok || !data?.access_token) {
      throw new Error(`Twitch no pudo renovar el token: HTTP ${response.status}`);
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: new Date(Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function obtenerDesdeMongo() {
  if (!CONFIG.MONGODB_URI) return null;
  const cliente = new MongoClient(CONFIG.MONGODB_URI, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    maxPoolSize: 2,
  });
  try {
    await cliente.connect();
    const db = cliente.db(CONFIG.MONGODB_DB_NAME || undefined);
    const coleccion = db.collection(CONFIG.TWITCH_TOKEN_COLLECTION);
    const filtro = { _id: CONFIG.TWITCH_TOKEN_DOCUMENT_ID };
    const documento = await coleccion.findOne(filtro, {
      projection: {
        access_token: 1,
        refresh_token: 1,
        expires_at: 1,
      },
    });
    if (!documento?.access_token) {
      throw new Error(
        `No existe el token ${CONFIG.TWITCH_TOKEN_DOCUMENT_ID} en ${CONFIG.TWITCH_TOKEN_COLLECTION}`,
      );
    }

    const margenMs = 5 * 60 * 1000;
    if (fechaMs(documento.expires_at) > Date.now() + margenMs) {
      return { accessToken: documento.access_token, source: "mongodb" };
    }
    if (!documento.refresh_token) {
      throw new Error("El token Twitch expiró y no tiene refresh_token");
    }

    const renovado = await renovarToken(documento.refresh_token);
    await coleccion.updateOne(
      { ...filtro, refresh_token: documento.refresh_token },
      {
        $set: {
          access_token: renovado.accessToken,
          refresh_token: renovado.refreshToken,
          expires_at: renovado.expiresAt,
          updated_at: new Date(),
        },
      },
    );
    log.info("Token EventSub renovado y actualizado en MongoDB");
    return { accessToken: renovado.accessToken, source: "mongodb_refresh" };
  } finally {
    await cliente.close().catch(() => {});
  }
}

async function obtenerTokenEventSub() {
  if (CONFIG.MONGODB_URI) {
    try {
      const token = await obtenerDesdeMongo();
      if (token) return token;
    } catch (err) {
      log.warn("No se pudo obtener el token EventSub desde MongoDB", err.message);
      if (!CONFIG.TWITCH_EVENTSUB_TOKEN) throw err;
    }
  }
  const accessToken = String(CONFIG.TWITCH_EVENTSUB_TOKEN || "")
    .trim()
    .replace(/^oauth:/i, "");
  return accessToken ? { accessToken, source: "env" } : null;
}

module.exports = {
  obtenerTokenEventSub,
  _internals: { fechaMs },
};
