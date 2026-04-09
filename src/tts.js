// ============================================
//  tts.js - Google Translate TTS (gratis, sin API key).
// ============================================

const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const AUDIO_DIR = path.join(__dirname, "../data/audio");
const MAX_CHARS = 100;

function inicializar() {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function nombreArchivo(texto) {
  const hash = crypto.createHash("md5").update(texto).digest("hex").slice(0, 8);
  return `tts_${hash}.mp3`;
}

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

function descargarChunk(texto, idioma = "es") {
  return new Promise((resolve, reject) => {
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
        if (res.statusCode !== 200)
          return reject(new Error(`Status ${res.statusCode}`));
        const stream = fs.createWriteStream(archivo);
        res.pipe(stream);
        stream.on("finish", () => resolve(archivo));
        stream.on("error", reject);
      },
    );

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

// idioma: 'es' para !habla | 'en' para !speak
async function generarAudio(texto, idioma = "es") {
  inicializar();

  const archivoFinal = path.join(
    AUDIO_DIR,
    nombreArchivo(`FULL:${idioma}:${texto}`),
  );
  if (fs.existsSync(archivoFinal)) {
    console.log(`🎵 TTS desde caché (${idioma})`);
    return archivoFinal;
  }

  const chunks = dividirEnChunks(texto);
  const flag = idioma === "es" ? "🇪🇸" : "🇺🇸";
  console.log(
    `🔪 Dividido en ${chunks.length} chunk(s) | ${flag} ${idioma === "es" ? "Español" : "Inglés"}`,
  );

  if (chunks.length === 1) {
    const archivo = await descargarChunk(chunks[0], idioma);
    console.log(`✅ Audio generado (1 chunk, ${idioma})`);
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

  console.log(`✅ Audio generado (${chunks.length} chunks, ${idioma})`);
  return archivoFinal;
}

function audioABase64(rutaArchivo) {
  try {
    return fs.readFileSync(rutaArchivo).toString("base64");
  } catch (err) {
    console.error("⚠️  Error leyendo audio:", err.message);
    return null;
  }
}

function eliminarAudio(rutaArchivo) {
  try {
    if (fs.existsSync(rutaArchivo)) {
      fs.unlinkSync(rutaArchivo);
      console.log(`🗑️  Audio eliminado: ${path.basename(rutaArchivo)}`);
    }
  } catch (err) {
    console.error("⚠️  Error eliminando audio:", err.message);
  }
}

function limpiarAudiosViejos() {
  try {
    const ahora = Date.now();
    fs.readdirSync(AUDIO_DIR).forEach((archivo) => {
      const ruta = path.join(AUDIO_DIR, archivo);
      if (ahora - fs.statSync(ruta).mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(ruta);
        console.log(`🧹 Audio viejo eliminado: ${archivo}`);
      }
    });
  } catch {}
}

setInterval(limpiarAudiosViejos, 10 * 60 * 1000);

module.exports = { generarAudio, eliminarAudio, audioABase64, AUDIO_DIR };
