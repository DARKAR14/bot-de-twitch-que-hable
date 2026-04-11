// ============================================
//  tts.js - Google Translate TTS
//  Mejoras: retry con backoff, límite de caché,
//           logger centralizado
// ============================================

const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createLogger } = require("./logger");

const log = createLogger("TTS");
const AUDIO_DIR = path.join(__dirname, "../data/audio");
const MAX_CHARS = 100;

// Caché: si supera 50MB se eliminan los archivos más viejos
const MAX_CACHE_MB = 50;

function inicializar() {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function nombreArchivo(texto) {
  const hash = crypto.createHash("md5").update(texto).digest("hex").slice(0, 8);
  return `tts_${hash}.mp3`;
}

// ── Retry con backoff exponencial ─────────────────────────────
// Antes: si Google TTS fallaba 1 vez → el mensaje se perdía
// Ahora: reintenta hasta 3 veces esperando 1s, 2s, 4s entre intentos
async function conRetry(fn, intentos = 3, delayMs = 1000) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      if (i < intentos - 1) {
        const espera = delayMs * Math.pow(2, i); // 1s → 2s → 4s
        log.warn(
          `Intento ${i + 1}/${intentos} fallido: ${err.message}. Reintentando en ${espera}ms...`,
        );
        await new Promise((r) => setTimeout(r, espera));
      }
    }
  }
  throw ultimoError;
}

// ── Límite de tamaño de caché ──────────────────────────────────
// Si la carpeta de audio supera MAX_CACHE_MB, elimina los archivos
// más viejos hasta bajar del límite
function limpiarCacheSiNecesario() {
  try {
    const archivos = fs
      .readdirSync(AUDIO_DIR)
      .map((f) => {
        const ruta = path.join(AUDIO_DIR, f);
        const stat = fs.statSync(ruta);
        return { ruta, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime); // más viejos primero

    const totalBytes = archivos.reduce((acc, f) => acc + f.size, 0);
    const totalMB = totalBytes / (1024 * 1024);

    if (totalMB <= MAX_CACHE_MB) return;

    log.warn(
      `Caché de audio: ${totalMB.toFixed(1)}MB — límite ${MAX_CACHE_MB}MB. Limpiando...`,
    );

    let liberado = 0;
    for (const archivo of archivos) {
      try {
        fs.unlinkSync(archivo.ruta);
        liberado += archivo.size;
        log.debug(`Caché: eliminado ${path.basename(archivo.ruta)}`);
      } catch {}
      // Parar cuando hayamos liberado suficiente
      if ((totalBytes - liberado) / (1024 * 1024) <= MAX_CACHE_MB * 0.8) break;
    }
  } catch (err) {
    log.warn("Error limpiando caché", err.message);
  }
}

// ── División en chunks ─────────────────────────────────────────

function dividirEnChunks(texto) {
  if (texto.length <= MAX_CHARS) return [texto];

  const chunks = [];
  const frases = texto.split(/(?<=[.!?,;])\s+/);
  let actual = "";

  for (const frase of frases) {
    if ((actual + " " + frase).trim().length <= MAX_CHARS) {
      actual = (actual + " " + frase).trim();
    } else {
      if (actual) chunks.push(actual);
      if (frase.length > MAX_CHARS) {
        const palabras = frase.split(" ");
        actual = "";
        for (const palabra of palabras) {
          if ((actual + " " + palabra).trim().length <= MAX_CHARS) {
            actual = (actual + " " + palabra).trim();
          } else {
            if (actual) chunks.push(actual);
            actual = palabra;
          }
        }
      } else {
        actual = frase;
      }
    }
  }
  if (actual) chunks.push(actual);
  return chunks.filter(Boolean);
}

// ── Descarga de un chunk (con retry) ──────────────────────────

function descargarChunk(texto, idioma = "es") {
  return conRetry(
    () =>
      new Promise((resolve, reject) => {
        const cacheKey = `${idioma}:${texto}`;
        const archivo = path.join(AUDIO_DIR, nombreArchivo(cacheKey));

        if (fs.existsSync(archivo)) return resolve(archivo);

        const textoCodificado = encodeURIComponent(texto);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${textoCodificado}&tl=${idioma}&client=tw-ob`;

        const req = https.get(
          url,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: "https://translate.google.com/",
            },
          },
          (res) => {
            if (res.statusCode !== 200) {
              return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const stream = fs.createWriteStream(archivo);
            res.pipe(stream);
            stream.on("finish", () => resolve(archivo));
            stream.on("error", reject);
          },
        );

        req.on("error", reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error("Timeout al descargar audio"));
        });
      }),
  );
}

// ── Generación del audio completo ─────────────────────────────

async function generarAudio(texto, idioma = "es") {
  inicializar();
  limpiarCacheSiNecesario();

  const archivoFinal = path.join(
    AUDIO_DIR,
    nombreArchivo(`FULL:${idioma}:${texto}`),
  );
  if (fs.existsSync(archivoFinal)) {
    log.debug(`TTS desde caché (${idioma})`);
    return archivoFinal;
  }

  const chunks = dividirEnChunks(texto);
  const flag = idioma === "es" ? "🇪🇸" : "🇺🇸";
  log.info(
    `${flag} Generando audio | ${chunks.length} chunk(s) | "${texto.slice(0, 40)}${texto.length > 40 ? "..." : ""}"`,
  );

  if (chunks.length === 1) {
    const archivo = await descargarChunk(chunks[0], idioma);
    log.info("Audio generado correctamente (1 chunk)");
    return archivo;
  }

  const archivos = await Promise.all(
    chunks.map((c) => descargarChunk(c, idioma)),
  );
  const buffers = archivos.map((f) => fs.readFileSync(f));
  const combinado = Buffer.concat(buffers);
  fs.writeFileSync(archivoFinal, combinado);

  archivos.forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch {}
  });

  log.info(`Audio generado correctamente (${chunks.length} chunks combinados)`);
  return archivoFinal;
}

// ── Utilidades ─────────────────────────────────────────────────

function audioABase64(rutaArchivo) {
  try {
    return fs.readFileSync(rutaArchivo).toString("base64");
  } catch (err) {
    log.error("Error leyendo audio", err.message);
    return null;
  }
}

function eliminarAudio(rutaArchivo) {
  try {
    if (fs.existsSync(rutaArchivo)) {
      fs.unlinkSync(rutaArchivo);
      log.debug(`Audio eliminado: ${path.basename(rutaArchivo)}`);
    }
  } catch (err) {
    log.warn("Error eliminando audio", err.message);
  }
}

// Limpia audios con más de 10 minutos (archivos huérfanos)
function limpiarAudiosViejos() {
  try {
    const ahora = Date.now();
    fs.readdirSync(AUDIO_DIR).forEach((archivo) => {
      const ruta = path.join(AUDIO_DIR, archivo);
      if (ahora - fs.statSync(ruta).mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(ruta);
        log.debug(`Audio viejo eliminado: ${archivo}`);
      }
    });
  } catch {}
}

setInterval(limpiarAudiosViejos, 10 * 60 * 1000);

module.exports = { generarAudio, eliminarAudio, audioABase64, AUDIO_DIR };
