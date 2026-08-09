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

function inicializar() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function verificarContinuacion(debeContinuar) {
  if (typeof debeContinuar !== "function" || debeContinuar()) return;
  const error = new Error("Generacion TTS cancelada porque el mensaje ya no esta en cola");
  error.code = "TTS_CANCELLED";
  error.retryable = false;
  throw error;
}

async function conRetry(fn, intentos = CONFIG.TTS_RETRIES) {
  let ultimoError;
  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      if (intento === intentos || err.retryable === false) break;
      const pausa = 500 * 2 ** (intento - 1);
      log.warn(`TTS intento ${intento}/${intentos} fallo; retry en ${pausa}ms`, err.message);
      await esperar(pausa);
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

function peticionBuffer(url, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      let total = 0;

      res.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_RESPONSE_BYTES) {
          const error = new Error("Respuesta TTS demasiado grande");
          error.retryable = false;
          req.destroy(error);
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detalle = buffer.toString("utf8").slice(0, 300);
          const error = new Error(`HTTP ${res.statusCode}: ${detalle}`);
          error.retryable = res.statusCode === 429 || res.statusCode >= 500;
          reject(error);
          return;
        }
        resolve({ buffer, headers: res.headers });
      });
    });

    req.setTimeout(CONFIG.TTS_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("Timeout solicitando audio TTS"));
    });
    req.on("error", reject);
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

async function generarGemini(texto, idioma, id) {
  if (!CONFIG.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurada");

  const prompt = [
    "Generate speech only.",
    `Read the transcript exactly as written in ${nombresIdioma[idioma] || "Spanish"}.`,
    `Use a ${CONFIG.GEMINI_TTS_STYLE} voice.`,
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
          prebuiltVoiceConfig: { voiceName: CONFIG.GEMINI_TTS_VOICE },
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
    }),
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
  const rutaAudio = path.join(AUDIO_DIR, `tts_${nombreSeguro(id)}.wav`);
  escribirAtomico(rutaAudio, wav);
  return { rutaAudio, mimeType: "audio/wav", provider: "gemini" };
}

async function descargarGoogle(texto, idioma) {
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
  });
  return buffer;
}

async function generarGoogle(texto, idioma, id, debeContinuar) {
  const chunks = dividirEnChunks(texto);
  const buffers = [];
  for (const chunk of chunks) {
    verificarContinuacion(debeContinuar);
    buffers.push(await conRetry(() => descargarGoogle(chunk, idioma)));
  }
  const rutaAudio = path.join(AUDIO_DIR, `tts_${nombreSeguro(id)}.mp3`);
  escribirAtomico(rutaAudio, Buffer.concat(buffers));
  return { rutaAudio, mimeType: "audio/mpeg", provider: "google" };
}

async function generarAudio(texto, idioma = "es", { id, debeContinuar } = {}) {
  inicializar();
  return ejecutarLimitado(async () => {
    verificarContinuacion(debeContinuar);
    const usarGemini =
      CONFIG.TTS_PROVIDER !== "google" && Boolean(CONFIG.GEMINI_API_KEY);

    if (usarGemini) {
      try {
        log.info(`Generando voz Gemini (${CONFIG.GEMINI_TTS_VOICE}) para ${id || "mensaje"}`);
        return await generarGemini(texto, idioma, id);
      } catch (err) {
        log.warn("Gemini TTS fallo; usando respaldo Google", err.message);
      }
    }

    verificarContinuacion(debeContinuar);
    log.info(`Generando voz Google (${idioma}) para ${id || "mensaje"}`);
    return generarGoogle(texto, idioma, id, debeContinuar);
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

const limpieza = setInterval(limpiarAudiosViejos, 10 * 60 * 1000);
limpieza.unref?.();

module.exports = {
  generarAudio,
  eliminarAudio,
  audioABase64,
  limpiarAudiosViejos,
  AUDIO_DIR,
  _internals: { dividirEnChunks, pcmAFormatoWav, conRetry, verificarContinuacion },
};
