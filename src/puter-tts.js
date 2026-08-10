// ============================================
//  puter-tts.js - Adaptador TTS de Puter para Node.js
// ============================================

const MAX_INPUT_CHARS = 3000;
const DEFAULT_MAX_RESPONSE_BYTES = 15 * 1024 * 1024;

const idiomas = Object.freeze({
  es: { bcp47: "es-US", corto: "es" },
  en: { bcp47: "en-US", corto: "en" },
  ja: { bcp47: "ja-JP", corto: "ja" },
  ru: { bcp47: "ru-RU", corto: "ru" },
  pt: { bcp47: "pt-BR", corto: "pt" },
});

const vocesPredeterminadas = Object.freeze({
  openai: "coral",
  gemini: "Kore",
  xai: "ara",
  elevenlabs: "21m00Tcm4TlvDq8ikWAM",
});

const modelosPredeterminados = Object.freeze({
  openai: "gpt-4o-mini-tts",
  gemini: "gemini-2.5-flash-preview-tts",
  elevenlabs: "eleven_multilingual_v2",
});

const vocesPolly = Object.freeze({
  es: "Lupe",
  en: "Joanna",
  ja: "Mizuki",
  ru: "Tatyana",
  pt: "Camila",
});

const drivers = Object.freeze({
  openai: "openai-tts",
  gemini: "gemini-tts",
  xai: "xai-tts",
  elevenlabs: "elevenlabs-tts",
  "aws-polly": "aws-polly",
});

function errorDesdeSenal(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Generacion Puter TTS cancelada");
  error.code = "TTS_CANCELLED";
  error.retryable = false;
  return error;
}

function conCancelacion(promesa, signal) {
  if (signal?.aborted) return Promise.reject(errorDesdeSenal(signal));
  return new Promise((resolve, reject) => {
    let finalizada = false;
    const terminar = (callback, valor) => {
      if (finalizada) return;
      finalizada = true;
      signal?.removeEventListener("abort", cancelar);
      callback(valor);
    };
    const cancelar = () => terminar(reject, errorDesdeSenal(signal));
    signal?.addEventListener("abort", cancelar, { once: true });
    Promise.resolve(promesa).then(
      (valor) => terminar(resolve, valor),
      (error) => terminar(reject, error),
    );
  });
}

function normalizarError(error) {
  if (error instanceof Error && typeof error.retryable === "boolean") return error;

  const detalle = error?.error && typeof error.error === "object"
    ? error.error
    : error;
  const mensaje =
    detalle?.message ||
    detalle?.msg ||
    error?.message ||
    "Puter TTS devolvio un error desconocido";
  const normalizado = new Error(String(mensaje));
  const estado = Number(
    detalle?.status ??
      detalle?.statusCode ??
      error?.status ??
      error?.statusCode,
  );
  const codigo = detalle?.code || error?.code;

  if (Number.isFinite(estado)) normalizado.statusCode = estado;
  if (codigo) normalizado.code = String(codigo);
  normalizado.retryable =
    [408, 425, 429].includes(estado) ||
    estado >= 500 ||
    ["network_error", "request_timeout", "service_unavailable"].includes(
      String(codigo || "").toLowerCase(),
    );
  return normalizado;
}

function crearOpciones(
  texto,
  idioma = "es",
  {
    provider = "openai",
    model,
    voice,
    style,
    format = "mp3",
    engine = "neural",
  } = {},
) {
  const proveedor = String(provider || "openai").toLowerCase();
  const perfilIdioma = idiomas[idioma] || idiomas.es;
  const opciones = { provider: proveedor };

  if (model || modelosPredeterminados[proveedor]) {
    opciones.model = model || modelosPredeterminados[proveedor];
  }
  if (proveedor === "aws-polly") {
    opciones.voice = voice || vocesPolly[idioma] || vocesPolly.es;
    opciones.language = perfilIdioma.bcp47;
    opciones.engine = engine || "neural";
  } else {
    opciones.voice = voice || vocesPredeterminadas[proveedor];
  }

  if (["openai", "gemini"].includes(proveedor) && style) {
    opciones.instructions = style;
  }
  if (proveedor === "openai") opciones.response_format = format || "mp3";
  if (proveedor === "elevenlabs") {
    opciones.output_format =
      format && format.includes("_") ? format : "mp3_44100_128";
  }
  if (proveedor === "xai") {
    opciones.language = perfilIdioma.corto;
    opciones.output_format = format || "mp3";
  }

  if (!texto || typeof texto !== "string") {
    const error = new Error("Puter TTS requiere texto");
    error.code = "PUTER_TTS_TEXT_REQUIRED";
    error.retryable = false;
    throw error;
  }
  if (texto.length > MAX_INPUT_CHARS) {
    const error = new Error(`Puter TTS acepta maximo ${MAX_INPUT_CHARS} caracteres`);
    error.code = "PUTER_TTS_TEXT_TOO_LONG";
    error.retryable = false;
    throw error;
  }
  return opciones;
}

function crearSolicitud(texto, idioma, configuracion, authToken) {
  if (!authToken) {
    const error = new Error("PUTER_AUTH_TOKEN no configurado");
    error.code = "PUTER_AUTH_REQUIRED";
    error.retryable = false;
    throw error;
  }
  const opciones = crearOpciones(texto, idioma, configuracion);
  return {
    interface: "puter-tts",
    driver: drivers[opciones.provider] || drivers.openai,
    test_mode: false,
    method: "synthesize",
    args: { text: texto, ...opciones },
    auth_token: authToken,
  };
}

function detectarMime(buffer, declarado) {
  const mime = String(declarado || "").split(";", 1)[0].toLowerCase();
  if (mime.startsWith("audio/")) return mime;
  if (buffer.toString("ascii", 0, 4) === "RIFF") return "audio/wav";
  if (buffer.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  if (buffer.toString("ascii", 0, 4) === "fLaC") return "audio/flac";
  return "audio/mpeg";
}

function decodificarAudio(audio, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  const fuente = typeof audio?.src === "string" ? audio.src : String(audio || "");
  const coincidencia = /^data:([^,]*?),(.*)$/su.exec(fuente);
  if (!coincidencia) {
    const error = new Error("Puter TTS no devolvio el audio embebido esperado");
    error.code = "PUTER_TTS_INVALID_AUDIO_SOURCE";
    error.retryable = true;
    throw error;
  }

  const encabezado = coincidencia[1];
  const contenido = coincidencia[2];
  if (contenido.length > maxBytes * 2) {
    const error = new Error("Respuesta Puter TTS demasiado grande");
    error.code = "PUTER_TTS_RESPONSE_TOO_LARGE";
    error.retryable = false;
    throw error;
  }

  let buffer;
  try {
    buffer = /(?:^|;)base64(?:;|$)/iu.test(encabezado)
      ? Buffer.from(contenido, "base64")
      : Buffer.from(decodeURIComponent(contenido), "binary");
  } catch {
    const error = new Error("Puter TTS devolvio audio codificado de forma invalida");
    error.code = "PUTER_TTS_INVALID_AUDIO_DATA";
    error.retryable = true;
    throw error;
  }

  if (buffer.length < 100 || buffer.length > maxBytes) {
    const error = new Error("Puter TTS devolvio un archivo vacio o demasiado grande");
    error.code = "PUTER_TTS_INVALID_AUDIO_SIZE";
    error.retryable = buffer.length < 100;
    throw error;
  }
  return {
    buffer,
    mimeType: detectarMime(buffer, encabezado.split(";", 1)[0]),
  };
}

function procesarRespuesta(
  { buffer, headers = {} } = {},
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
) {
  if (!Buffer.isBuffer(buffer)) {
    const error = new Error("Puter TTS no devolvio un buffer de audio");
    error.code = "PUTER_TTS_INVALID_RESPONSE";
    error.retryable = true;
    throw error;
  }

  const contentType = String(headers["content-type"] || "")
    .split(";", 1)[0]
    .toLowerCase();
  if (
    contentType.includes("json") ||
    contentType === "text/plain"
  ) {
    let respuesta;
    try {
      respuesta = JSON.parse(buffer.toString("utf8"));
    } catch {
      const error = new Error("Puter TTS devolvio una respuesta JSON invalida");
      error.code = "PUTER_TTS_INVALID_JSON";
      error.retryable = true;
      throw error;
    }
    if (respuesta?.success === false || respuesta?.error) {
      throw normalizarError(respuesta);
    }
    const resultado = respuesta?.result ?? respuesta;
    if (typeof resultado === "string") {
      return decodificarAudio({ src: resultado }, maxBytes);
    }
    const error = new Error("Puter TTS respondio JSON sin audio");
    error.code = "PUTER_TTS_AUDIO_MISSING";
    error.retryable = true;
    throw error;
  }

  if (buffer.length < 100 || buffer.length > maxBytes) {
    const error = new Error("Puter TTS devolvio un archivo vacio o demasiado grande");
    error.code = "PUTER_TTS_INVALID_AUDIO_SIZE";
    error.retryable = buffer.length < 100;
    throw error;
  }
  return { buffer, mimeType: detectarMime(buffer, contentType) };
}

async function sintetizar(
  texto,
  idioma,
  configuracion,
  { authToken, signal, solicitar } = {},
) {
  if (typeof solicitar !== "function") {
    const error = new Error("El transporte HTTP de Puter TTS no esta disponible");
    error.code = "PUTER_TTS_TRANSPORT_REQUIRED";
    error.retryable = false;
    throw error;
  }
  const solicitud = crearSolicitud(texto, idioma, configuracion, authToken);
  try {
    const respuesta = await conCancelacion(
      Promise.resolve().then(() => solicitar(solicitud, signal)),
      signal,
    );
    if (signal?.aborted) throw errorDesdeSenal(signal);
    return procesarRespuesta(respuesta);
  } catch (error) {
    throw normalizarError(error);
  }
}

module.exports = {
  sintetizar,
  crearOpciones,
  crearSolicitud,
  decodificarAudio,
  procesarRespuesta,
  normalizarError,
  conCancelacion,
  MAX_INPUT_CHARS,
};
