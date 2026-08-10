const assert = require("node:assert/strict");
const test = require("node:test");
const puterTts = require("../src/puter-tts");

test("Puter configura OpenAI con una voz femenina y estilo natural", () => {
  const opciones = puterTts.crearOpciones("Hola, mi gente", "es", {
    provider: "openai",
    style: "Habla con alegria y naturalidad.",
  });
  assert.deepEqual(opciones, {
    provider: "openai",
    model: "gpt-4o-mini-tts",
    voice: "coral",
    instructions: "Habla con alegria y naturalidad.",
    response_format: "mp3",
  });
});

test("Puter adapta idioma, voz y motor cuando se selecciona AWS Polly", () => {
  const opciones = puterTts.crearOpciones("Oi, pessoal", "pt", {
    provider: "aws-polly",
  });
  assert.equal(opciones.voice, "Camila");
  assert.equal(opciones.language, "pt-BR");
  assert.equal(opciones.engine, "neural");
  assert.equal(opciones.instructions, undefined);
});

test("Puter convierte el data URI del SDK en un buffer de audio", () => {
  const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 1)]);
  const resultado = puterTts.decodificarAudio({
    src: `data:audio/mpeg;base64,${mp3.toString("base64")}`,
  });
  assert.deepEqual(resultado.buffer, mp3);
  assert.equal(resultado.mimeType, "audio/mpeg");
});

test("Puter rechaza fuentes remotas inesperadas en vez de hacer SSRF", () => {
  assert.throws(
    () => puterTts.decodificarAudio({ src: "https://example.com/audio.mp3" }),
    (error) => error.code === "PUTER_TTS_INVALID_AUDIO_SOURCE",
  );
});

test("el adaptador Puter genera la solicitud oficial y procesa audio HTTP", async () => {
  const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 2)]);
  let recibidas;
  const resultado = await puterTts.sintetizar(
    "Buenas noches",
    "es",
    { provider: "gemini", voice: "Aoede" },
    {
      authToken: "token-solo-para-la-prueba",
      solicitar: async (solicitud) => {
        recibidas = solicitud;
        return {
          buffer: mp3,
          headers: { "content-type": "audio/mpeg" },
        };
      },
    },
  );
  assert.equal(recibidas.interface, "puter-tts");
  assert.equal(recibidas.driver, "gemini-tts");
  assert.equal(recibidas.method, "synthesize");
  assert.equal(recibidas.args.text, "Buenas noches");
  assert.equal(recibidas.args.provider, "gemini");
  assert.equal(recibidas.args.model, "gemini-2.5-flash-preview-tts");
  assert.equal(recibidas.args.voice, "Aoede");
  assert.equal(recibidas.auth_token, "token-solo-para-la-prueba");
  assert.deepEqual(resultado.buffer, mp3);
});

test("Puter convierte errores JSON de saldo en errores no reintentables", () => {
  assert.throws(
    () =>
      puterTts.procesarRespuesta({
        buffer: Buffer.from(
          JSON.stringify({
            success: false,
            error: {
              status: 402,
              code: "insufficient_funds",
              message: "Sin saldo",
            },
          }),
        ),
        headers: { "content-type": "application/json" },
      }),
    (error) =>
      error.statusCode === 402 &&
      error.code === "insufficient_funds" &&
      error.retryable === false,
  );
});

test("Puter conserva la clasificacion de timeouts del transporte compartido", () => {
  const timeout = new Error("Timeout solicitando audio TTS");
  timeout.code = "TTS_REQUEST_TIMEOUT";
  timeout.retryable = true;
  assert.equal(puterTts.normalizarError(timeout), timeout);
});

test("una cancelacion libera la cola aunque el SDK Puter no responda", async () => {
  const controlador = new AbortController();
  const pendiente = puterTts.conCancelacion(new Promise(() => {}), controlador.signal);
  const motivo = new Error("trabajo agotado");
  motivo.code = "TTS_JOB_TIMEOUT";
  motivo.retryable = false;
  controlador.abort(motivo);
  await assert.rejects(pendiente, (error) => error === motivo);
});
