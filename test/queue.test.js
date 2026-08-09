const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { crearCola } = require("../src/queue");

const logger = { info() {}, warn() {}, error() {}, debug() {} };

test("la cola mantiene estado en memoria y persiste atomically", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttsbot-queue-"));
  const archivo = path.join(dir, "queue.json");
  const cola = crearCola(archivo, logger);
  cola.inicializar();

  const entrada = cola.agregar({ usuario: "ana", mensaje: "hola", idioma: "es" });
  assert.equal(cola.total(), 1);
  assert.equal(cola.obtenerPrimero().estado, "generando");

  assert.equal(
    cola.actualizarAudio(entrada.id, {
      rutaAudio: "audio.wav",
      mimeType: "audio/wav",
      provider: "gemini",
    }),
    true,
  );
  assert.deepEqual(
    {
      estado: cola.buscar(entrada.id).estado,
      mime: cola.buscar(entrada.id).audioMime,
      provider: cola.buscar(entrada.id).proveedorTts,
    },
    { estado: "listo", mime: "audio/wav", provider: "gemini" },
  );
  assert.equal(JSON.parse(fs.readFileSync(archivo, "utf8")).length, 1);
  assert.equal(cola.eliminar(entrada.id).id, entrada.id);
  assert.equal(cola.total(), 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("un TTS fallido queda listo para fallback y no bloquea", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttsbot-queue-"));
  const cola = crearCola(path.join(dir, "queue.json"), logger);
  cola.inicializar();
  const entrada = cola.agregar({ usuario: "luis", mensaje: "prueba" });
  assert.equal(cola.marcarFallback(entrada.id, "timeout"), true);
  assert.equal(cola.obtenerPrimero().estado, "listo");
  assert.equal(cola.obtenerPrimero().fallbackNavegador, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
