const assert = require("node:assert/strict");
const test = require("node:test");
const { _internals } = require("../src/tts");

test("los chunks de Google nunca superan 100 caracteres", () => {
  const texto = "una palabra larga ".repeat(20).trim();
  const chunks = _internals.dividirEnChunks(texto);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.every((chunk) => chunk.length <= 100), true);
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), texto.replace(/\s+/g, " "));
});

test("Gemini PCM se convierte en un WAV reproducible", () => {
  const pcm = Buffer.alloc(4800, 1);
  const wav = _internals.pcmAFormatoWav(pcm);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.equal(wav.length, pcm.length + 44);
});

test("un trabajo eliminado de la cola se cancela antes de consumir TTS", () => {
  assert.throws(
    () => _internals.verificarContinuacion(() => false),
    (err) => err.code === "TTS_CANCELLED" && err.retryable === false,
  );
  assert.doesNotThrow(() => _internals.verificarContinuacion(() => true));
});

test("Fish recibe un payload estable con proteccion contra repeticiones", () => {
  const payload = _internals.crearPayloadFish("hola, mi gente");
  assert.equal(payload.text, "hola, mi gente");
  assert.equal(payload.format, "mp3");
  assert.equal(payload.repetition_penalty, 1.2);
  assert.equal(payload.condition_on_previous_chunks, true);
  assert.match(payload.reference_id, /^[a-f0-9]{32}$/);
  assert.equal(
    _internals.crearPayloadFish(
      "hola",
      "1412b58e859448d284f8f62391e82bd9",
    ).reference_id,
    "1412b58e859448d284f8f62391e82bd9",
  );
});

test("la cadena balanceada prueba las voces principales y Puter antes de Google", () => {
  assert.deepEqual(_internals.crearOrdenProveedores("balanced"), [
    "fish",
    "gemini",
    "puter",
    "google",
  ]);
  assert.deepEqual(
    _internals.crearOrdenProveedores("auto", ["gemini", "fish", "puter"]),
    ["gemini", "fish", "puter", "google"],
  );
});

test("un aborto interrumpe inmediatamente la espera entre reintentos", async () => {
  const controlador = new AbortController();
  let intentos = 0;
  const fallo = new Error("fallo temporal");
  fallo.retryable = true;
  const cancelado = new Error("trabajo cancelado");
  cancelado.code = "TTS_CANCELLED";
  cancelado.retryable = false;

  const trabajo = _internals.conRetry(
    async () => {
      intentos += 1;
      throw fallo;
    },
    4,
    controlador.signal,
  );
  setTimeout(() => controlador.abort(cancelado), 20);

  await assert.rejects(trabajo, (err) => err === cancelado);
  assert.equal(intentos, 1);
});
