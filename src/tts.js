// ============================================
//  tts.js - Gemini TTS con respaldo Google Translate
// ============================================

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");
const CONFIG = require("./config");
const { createLogger } = require("./logger");

const log = createLogger("TTS");
const AUDIO_DIR = path.join(__dirname, "../data/audio");
const GOOGLE_MAX_CHARS = 100;
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;

let trabajosActivos = 0;
const trabajosPendientes = [];
const cacheFish = new Map();
let fishBloqueadoHasta = 0;
let geminiBloqueadoHasta = 0;

function inicializar() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function errorDesdeSenal(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Generacion TTS cancelada");
  error.code = "TTS_CANCELLED";
  error.retryable = false;
  return error;
}

function verificarSenal(signal) {
  if (signal?.aborted) throw errorDesdeSenal(signal);
}

function esperar(ms, signal) {
  verificarSenal(signal);
  return new Promise((resolve, reject) => {
    let timer;
    const cancelar = () => {
      clearTimeout(timer);
      reject(errorDesdeSenal(signal));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancelar);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancelar, { once: true });
  });
}

function verificarContinuacion(debeContinuar) {
  if (typeof debeContinuar !== "function" || debeContinuar()) return;
  const error = new Error("Generacion TTS cancelada porque el mensaje ya no esta en cola");
  error.code = "TTS_CANCELLED";
  error.retryable = false;
  throw error;
}

async function conRetry(fn, intentos = CONFIG.TTS_RETRIES, signal) {
  let ultimoError;
  for (let intento = 1; intento <= intentos; intento += 1) {
    verificarSenal(signal);
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      if (intento === intentos || err.retryable === false) break;
      const pausa = 500 * 2 ** (intento - 1);
      log.warn(`TTS intento ${intento}/${intentos} fallo; retry en ${pausa}ms`, err.message);
      await esperar(pausa, signal);
    }
  }
  throw ultimoError;
}

function ejecutarLimitado(fn) {
  return new Promise((resolve, reject) => {
    const ejecutar = async () => {
      trabajosActivos += 1;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        trabajosActivos -= 1;
        trabajosPendientes.shift()?.();
      }
    };

    if (trabajosActivos < CONFIG.TTS_CONCURRENCY) ejecutar();
    else trabajosPendientes.push(ejecutar);
  });
}

function peticionBuffer(
  url,
  { method = "GET", headers = {}, body = null, signal } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(errorDesdeSenal(signal));
      return;
    }

    let finalizada = false;
    let onAbort;
    const completar = (callback, valor) => {
      if (finalizada) return;
      finalizada = true;
      signal?.removeEventListener("abort", onAbort);
      callback(valor);
    };
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      let total = 0;

      res.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_RESPONSE_BYTES) {
          const error = new Error("Respuesta TTS demasiado grande");
          error.retryable = false;
          req.destroy(error);
          completar(reject, error);
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detalle = buffer.toString("utf8").slice(0, 300);
          const error = new Error(`HTTP ${res.statusCode}: ${detalle}`);
          error.statusCode = res.statusCode;
          error.retryable = res.statusCode === 429 || res.statusCode >= 500;
          const retryAfter = Number.parseInt(res.headers["retry-after"], 10);
          error.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : null;
          completar(reject, error);
          return;
        }
        completar(resolve, { buffer, headers: res.headers });
      });

      res.on("aborted", () => {
        const error = new Error("Respuesta TTS interrumpida antes de completarse");
        error.code = "TTS_RESPONSE_ABORTED";
        error.retryable = true;
        completar(reject, error);
      });
      res.on("error", (err) => completar(reject, err));
      res.on("close", () => {
        if (res.complete) return;
        const error = new Error("Conexion TTS cerrada con una respuesta incompleta");
        error.code = "TTS_RESPONSE_INCOMPLETE";
        error.retryable = true;
        completar(reject, error);
      });
    });

    req.setTimeout(CONFIG.TTS_REQUEST_TIMEOUT_MS, () => {
      const error = new Error("Timeout solicitando audio TTS");
      error.code = "TTS_REQUEST_TIMEOUT";
      error.retryable = true;
      req.destroy(error);
    });
    req.on("error", (err) => completar(reject, err));
    onAbort = () => {
      const error = errorDesdeSenal(signal);
      req.destroy(error);
      completar(reject, error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (body) req.write(body);
    req.end();
  });
}

function dividirEnChunks(texto) {
  if (texto.length <= GOOGLE_MAX_CHARS) return [texto];
  const resultado = [];
  const frases = texto.split(/(?<=[.!?,;])\s+/);
  let actual = "";

  for (const frase of frases) {
    const candidata = `${actual} ${frase}`.trim();
    if (candidata.length <= GOOGLE_MAX_CHARS) {
      actual = candidata;
      continue;
    }
    if (actual) resultado.push(actual);
    actual = "";
    for (const palabra of frase.split(/\s+/)) {
      const parte = `${actual} ${palabra}`.trim();
      if (parte.length <= GOOGLE_MAX_CHARS) actual = parte;
      else {
        if (actual) resultado.push(actual);
        if (palabra.length <= GOOGLE_MAX_CHARS) actual = palabra;
        else {
          for (let i = 0; i < palabra.length; i += GOOGLE_MAX_CHARS) {
            resultado.push(palabra.slice(i, i + GOOGLE_MAX_CHARS));
          }
          actual = "";
        }
      }
    }
  }
  if (actual) resultado.push(actual);
  return resultado.filter(Boolean);
}

function nombreSeguro(id) {
  if (id) return String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return crypto.randomUUID();
}

function escribirAtomico(ruta, buffer) {
  const temporal = `${ruta}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporal, buffer);
  fs.renameSync(temporal, ruta);
}

function pcmAFormatoWav(pcm, sampleRate = 24_000, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const nombresIdioma = {
  es: "Spanish",
  en: "English",
  ja: "Japanese",
  ru: "Russian",
  pt: "Brazilian Portuguese",
};

function errorProveedorOmitido(provider) {
  const error = new Error(`Proveedor ${provider} omitido por presupuesto o cooldown`);
  error.code = "TTS_PROVIDER_SKIPPED";
  error.retryable = false;
  return error;
}

async function generarGemini(
  texto,
  idioma,
  id,
  { style, voice, puedeUsarProveedor, signal } = {},
) {
  verificarSenal(signal);
  if (!CONFIG.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurada");
  if (Date.now() < geminiBloqueadoHasta) {
    const error = new Error("Gemini TTS esta descansando temporalmente por limite de API");
    error.code = "GEMINI_TTS_CIRCUIT_OPEN";
    error.retryable = false;
    throw error;
  }
  if (
    typeof puedeUsarProveedor === "function" &&
    !(await puedeUsarProveedor("gemini"))
  ) {
    throw errorProveedorOmitido("gemini");
  }

  const estilo = style || CONFIG.GEMINI_TTS_STYLE;
  const nombreVoz = voice || CONFIG.GEMINI_TTS_VOICE;

  const prompt = [
    "Generate speech only.",
    `Read the transcript exactly as written in ${nombresIdioma[idioma] || "Spanish"}.`,
    `Use a ${estilo} voice.`,
    "Do not add, remove, translate, or explain any words.",
    "TRANSCRIPT:",
    texto,
  ].join("\n");

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: nombreVoz },
        },
      },
    },
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(CONFIG.GEMINI_TTS_MODEL)}:generateContent`;
  const { buffer } = await conRetry(() =>
    peticionBuffer(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "x-goog-api-key": CONFIG.GEMINI_API_KEY,
      },
      body,
      signal,
    }),
    CONFIG.TTS_RETRIES,
    signal,
  );

  let respuesta;
  try {
    respuesta = JSON.parse(buffer.toString("utf8"));
  } catch {
    const error = new Error("Gemini devolvio JSON invalido");
    error.retryable = true;
    throw error;
  }

  const data = respuesta.candidates?.[0]?.content?.parts?.find(
    (parte) => parte.inlineData?.data,
  )?.inlineData?.data;
  if (!data) {
    const motivo = respuesta.promptFeedback?.blockReason || "respuesta sin audio";
    const error = new Error(`Gemini TTS: ${motivo}`);
    error.retryable = true;
    throw error;
  }

  const pcm = Buffer.from(data, "base64");
  const wav = pcmAFormatoWav(pcm);
  verificarSenal(signal);
  const rutaAudio = path.join(AUDIO_DIR, `tts_${nombreSeguro(id)}.wav`);
  escribirAtomico(rutaAudio, wav);
  return {
    rutaAudio,
    mimeType: "audio/wav",
    provider: "gemini",
    attribution: `Voz Gemini · ${nombreVoz}`,
  };
}

function crearPayloadFish(texto, referenceId = CONFIG.FISH_REFERENCE_ID) {
  return {
    text: texto,
    reference_id: referenceId,
    format: "mp3",
    latency: "balanced",
    temperature: 0.7,
    top_p: 0.7,
    repetition_penalty: 1.2,
    condition_on_previous_chunks: true,
    prosody: { speed: 1, volume: 0, normalize_loudness: true },
  };
}

function claveCacheFish(texto, referenceId) {
  return crypto
    .createHash("sha256")
    .update(`${CONFIG.FISH_TTS_MODEL}\0${referenceId}\0${texto}`)
    .digest("hex");
}

function obtenerCacheFish(clave) {
  const guardado = cacheFish.get(clave);
  if (!guardado) return null;
  if (guardado.expira <= Date.now()) {
    cacheFish.delete(clave);
    return null;
  }
  cacheFish.delete(clave);
  cacheFish.set(clave, guardado);
  return guardado.buffer;
}

function guardarCacheFish(clave, buffer) {
  if (CONFIG.FISH_CACHE_MAX <= 0 || CONFIG.FISH_CACHE_TTL_MS <= 0) return;
  cacheFish.set(clave, {
    buffer,
    expira: Date.now() + CONFIG.FISH_CACHE_TTL_MS,
  });
  while (cacheFish.size > CONFIG.FISH_CACHE_MAX) {
    cacheFish.delete(cacheFish.keys().next().value);
  }
}

function abrirCircuitoFish(error) {
  if (error.statusCode === 429) {
    fishBloqueadoHasta = Date.now() + Math.max(error.retryAfterMs || 0, 5 * 60 * 1000);
  } else if (error.statusCode === 402) {
    fishBloqueadoHasta = Date.now() + 60 * 60 * 1000;
  } else if ([401, 403].includes(error.statusCode)) {
    fishBloqueadoHasta = Date.now() + 15 * 60 * 1000;
  }
}

function abrirCircuitoGemini(error) {
  if (error.statusCode === 429) {
    geminiBloqueadoHasta =
      Date.now() + Math.max(error.retryAfterMs || 0, 5 * 60 * 1000);
  } else if ([401, 403].includes(error.statusCode)) {
    geminiBloqueadoHasta = Date.now() + 15 * 60 * 1000;
  }
}

async function generarFish(
  texto,
  id,
  debeContinuar,
  puedeUsarProveedor,
  {
    referenceId = CONFIG.FISH_REFERENCE_ID,
    attribution = CONFIG.FISH_ATTRIBUTION,
    signal,
  } = {},
) {
  verificarSenal(signal);
  if (!CONFIG.FISH_API_KEY) throw new Error("FISH_API_KEY no configurada");
  if (!referenceId) throw new Error("Reference ID de Fish no configurado");

  const clave = claveCacheFish(texto, referenceId);
  let audio = obtenerCacheFish(clave);
  if (audio) {
    log.info(`Reutilizando voz Fish desde cache para ${id || "mensaje"}`);
  } else {
    if (Date.now() < fishBloqueadoHasta) {
      const error = new Error("Fish Audio esta descansando temporalmente por limite de API");
      error.code = "FISH_CIRCUIT_OPEN";
      error.retryable = false;
      throw error;
    }
    if (
      typeof puedeUsarProveedor === "function" &&
      !(await puedeUsarProveedor("fish"))
    ) {
      throw errorProveedorOmitido("fish");
    }

    const body = JSON.stringify(crearPayloadFish(texto, referenceId));
    try {
      const respuesta = await conRetry(() => {
        verificarContinuacion(debeContinuar);
        return peticionBuffer(CONFIG.FISH_TTS_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${CONFIG.FISH_API_KEY}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            model: CONFIG.FISH_TTS_MODEL,
          },
          body,
          signal,
        });
      }, CONFIG.TTS_RETRIES, signal);
      audio = respuesta.buffer;
      if (audio.length < 100) {
        const error = new Error("Fish Audio devolvio un archivo vacio o invalido");
        error.retryable = true;
        throw error;
      }
      guardarCacheFish(clave, audio);
    } catch (err) {
      abrirCircuitoFish(err);
      throw err;
    }
  }

  verificarSenal(signal);
  verificarContinuacion(debeContinuar);
  const rutaAudio = path.join(AUDIO_DIR, `tts_${nombreSeguro(id)}.mp3`);
  escribirAtomico(rutaAudio, audio);
  return {
    rutaAudio,
    mimeType: "audio/mpeg",
    provider: "fish",
    attribution,
  };
}

async function descargarGoogle(texto, idioma, signal) {
  const query = new URLSearchParams({
    ie: "UTF-8",
    q: texto,
    tl: idioma,
    client: "tw-ob",
  });
  const url = `https://translate.google.com/translate_tts?${query}`;
  const { buffer } = await peticionBuffer(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Referer: "https://translate.google.com/",
    },
    signal,
  });
  return buffer;
}

async function generarGoogle(texto, idioma, id, debeContinuar, signal) {
  const chunks = dividirEnChunks(texto);
  const buffers = [];
  for (const chunk of chunks) {
    verificarSenal(signal);
    verificarContinuacion(debeContinuar);
    buffers.push(
      await conRetry(
        () => descargarGoogle(chunk, idioma, signal),
        CONFIG.TTS_RETRIES,
        signal,
      ),
    );
  }
  verificarSenal(signal);
  verificarContinuacion(debeContinuar);
  const rutaAudio = path.join(AUDIO_DIR, `tts_${nombreSeguro(id)}.mp3`);
  escribirAtomico(rutaAudio, Buffer.concat(buffers));
  return {
    rutaAudio,
    mimeType: "audio/mpeg",
    provider: "google",
    attribution: "Voz de respaldo · Google TTS",
  };
}

function crearOrdenProveedores(provider = "auto", providerOrder) {
  const validos = new Set(["fish", "gemini", "google"]);
  let orden;
  if (Array.isArray(providerOrder) && providerOrder.length > 0) {
    orden = providerOrder;
  } else {
    const efectivo = provider === "auto" ? CONFIG.TTS_PROVIDER : provider;
    if (efectivo === "fish" || efectivo === "balanced") {
      orden = ["fish", "gemini", "google"];
    } else if (efectivo === "google") {
      orden = ["google"];
    } else {
      orden = ["gemini", "google"];
    }
  }

  const resultado = [...new Set(orden.filter((item) => validos.has(item)))];
  if (!resultado.includes("google")) resultado.push("google");
  return resultado;
}

function crearErrorTimeoutTrabajo() {
  const error = new Error("Tiempo máximo total de generación TTS agotado");
  error.code = "TTS_JOB_TIMEOUT";
  error.retryable = false;
  return error;
}

function crearErrorCancelacion() {
  const error = new Error("Generacion TTS cancelada porque el mensaje salio de la cola");
  error.code = "TTS_CANCELLED";
  error.retryable = false;
  return error;
}

async function generarAudio(
  texto,
  idioma = "es",
  {
    id,
    debeContinuar,
    provider = "auto",
    providerOrder,
    puedeUsarProveedor,
    fishReferenceId,
    fishAttribution,
    style,
    voice,
  } = {},
) {
  inicializar();
  return ejecutarLimitado(async () => {
    const controlador = new AbortController();
    const { signal } = controlador;
    const timeoutTrabajo = setTimeout(() => {
      if (!signal.aborted) controlador.abort(crearErrorTimeoutTrabajo());
    }, CONFIG.TTS_JOB_TIMEOUT_MS);
    timeoutTrabajo.unref?.();

    const monitorCola =
      typeof debeContinuar === "function"
        ? setInterval(() => {
            if (signal.aborted) return;
            try {
              if (!debeContinuar()) controlador.abort(crearErrorCancelacion());
            } catch {
              controlador.abort(crearErrorCancelacion());
            }
          }, 250)
        : null;
    monitorCola?.unref?.();

    try {
      const orden = crearOrdenProveedores(provider, providerOrder);
      for (const proveedor of orden) {
        verificarSenal(signal);
        verificarContinuacion(debeContinuar);

        if (proveedor === "fish") {
          if (!CONFIG.FISH_API_KEY) continue;
          try {
            log.info(
              `Generando voz Fish (${CONFIG.FISH_TTS_MODEL}) para ${id || "mensaje"}`,
            );
            return await generarFish(
              texto,
              id,
              debeContinuar,
              puedeUsarProveedor,
              {
                referenceId: fishReferenceId || CONFIG.FISH_REFERENCE_ID,
                attribution: fishAttribution || CONFIG.FISH_ATTRIBUTION,
                signal,
              },
            );
          } catch (err) {
            if (signal.aborted) throw errorDesdeSenal(signal);
            if (err.code === "TTS_CANCELLED") throw err;
            if (err.code === "TTS_PROVIDER_SKIPPED") {
              log.debug("Fish omitido por presupuesto o cooldown");
            } else {
              log.warn("Fish Audio fallo; probando otro proveedor", err.message);
            }
          }
          continue;
        }

        if (proveedor === "gemini") {
          if (!CONFIG.GEMINI_API_KEY) continue;
          try {
            log.info(
              `Generando voz Gemini (${voice || CONFIG.GEMINI_TTS_VOICE}) para ${id || "mensaje"}`,
            );
            return await generarGemini(texto, idioma, id, {
              style,
              voice,
              puedeUsarProveedor,
              signal,
            });
          } catch (err) {
            if (signal.aborted) throw errorDesdeSenal(signal);
            if (err.code === "TTS_CANCELLED") throw err;
            abrirCircuitoGemini(err);
            if (err.code === "TTS_PROVIDER_SKIPPED") {
              log.debug("Gemini omitido por presupuesto o cooldown");
            } else {
              log.warn("Gemini TTS fallo; probando otro proveedor", err.message);
            }
          }
          continue;
        }

        log.info(`Generando voz Google (${idioma}) para ${id || "mensaje"}`);
        return generarGoogle(texto, idioma, id, debeContinuar, signal);
      }

      throw new Error("No hay proveedores TTS disponibles");
    } finally {
      clearTimeout(timeoutTrabajo);
      if (monitorCola) clearInterval(monitorCola);
    }
  });
}

function audioABase64(rutaArchivo) {
  try {
    return fs.readFileSync(rutaArchivo).toString("base64");
  } catch (err) {
    log.warn("No se pudo leer el audio; se usara voz del navegador", err.message);
    return null;
  }
}

function eliminarAudio(rutaArchivo) {
  if (!rutaArchivo) return;
  try {
    fs.rmSync(rutaArchivo, { force: true });
  } catch (err) {
    log.warn("No se pudo eliminar un audio", err.message);
  }
}

function limpiarAudiosViejos() {
  try {
    inicializar();
    const ahora = Date.now();
    for (const archivo of fs.readdirSync(AUDIO_DIR)) {
      const ruta = path.join(AUDIO_DIR, archivo);
      if (ahora - fs.statSync(ruta).mtimeMs > 15 * 60 * 1000) {
        fs.rmSync(ruta, { force: true });
      }
    }
  } catch (err) {
    log.debug("No se pudo limpiar la cache TTS", err.message);
  }
}

function stats() {
  return {
    activos: trabajosActivos,
    pendientes: trabajosPendientes.length,
    timeoutTrabajoMs: CONFIG.TTS_JOB_TIMEOUT_MS,
    cacheFish: cacheFish.size,
    circuitoFishAbiertoSegundos: Math.max(
      0,
      Math.ceil((fishBloqueadoHasta - Date.now()) / 1000),
    ),
    circuitoGeminiAbiertoSegundos: Math.max(
      0,
      Math.ceil((geminiBloqueadoHasta - Date.now()) / 1000),
    ),
  };
}

const limpieza = setInterval(limpiarAudiosViejos, 10 * 60 * 1000);
limpieza.unref?.();

module.exports = {
  generarAudio,
  eliminarAudio,
  audioABase64,
  limpiarAudiosViejos,
  stats,
  AUDIO_DIR,
  _internals: {
    dividirEnChunks,
    pcmAFormatoWav,
    conRetry,
    verificarContinuacion,
    crearPayloadFish,
    crearOrdenProveedores,
  },
};
