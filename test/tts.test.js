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
