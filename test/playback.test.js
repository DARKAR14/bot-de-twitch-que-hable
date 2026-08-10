const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { crearCola } = require("../src/queue");
const { crearControlador } = require("../src/playback");

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const pausa = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("un ACK duplicado no elimina ni salta el siguiente audio", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttsbot-playback-"));
  const cola = crearCola(path.join(dir, "queue.json"), logger);
  cola.inicializar();

  const enviados = [];
  let onTerminado;
  let onConectado;
  const socket = {
    enviar(data) { enviados.push(data); return true; },
    alTerminar(cb) { onTerminado = cb; },
    alConectar(cb) { onConectado = cb; },
  };
  const eliminados = [];
  const audio = {
    audioABase64() { return "YXVkaW8="; },
    eliminarAudio(ruta) { eliminados.push(ruta); },
  };
  const controlador = crearControlador({
    cola,
    socket,
    audio,
    logger,
    timeoutMs: 5000,
  });
  controlador.inicializar();

  const primero = cola.agregar({ usuario: "uno", mensaje: "primero" });
  const segundo = cola.agregar({ usuario: "dos", mensaje: "segundo" });
  cola.actualizarAudio(primero.id, { rutaAudio: "uno.mp3", mimeType: "audio/mpeg" });
  cola.actualizarAudio(segundo.id, { rutaAudio: "dos.mp3", mimeType: "audio/mpeg" });
  controlador.notificarCambio();
  await pausa();

  assert.deepEqual(enviados.map((x) => x.id), [primero.id]);
  assert.equal(controlador.completar("id-falso"), false);
  assert.equal(onTerminado(primero.id), true);
  assert.equal(onTerminado(primero.id), false);
  await pausa(180);

  assert.deepEqual(enviados.map((x) => x.id), [primero.id, segundo.id]);
  assert.equal(cola.total(), 1);
  assert.equal(cola.obtenerPrimero().id, segundo.id);
  assert.deepEqual(eliminados, ["uno.mp3"]);

  // Una conexion adicional solo reenvia el elemento realmente activo.
  onConectado();
  assert.deepEqual(enviados.map((x) => x.id), [primero.id, segundo.id, segundo.id]);

  controlador.detener();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("una rafaga mantiene FIFO y cada ID avanza exactamente una vez", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttsbot-playback-"));
  const cola = crearCola(path.join(dir, "queue.json"), logger);
  cola.inicializar();

  const enviados = [];
  let onTerminado;
  const socket = {
    enviar(data) { enviados.push(data); return true; },
    alTerminar(cb) { onTerminado = cb; },
    alConectar() {},
  };
  const controlador = crearControlador({
    cola,
    socket,
    audio: { audioABase64() { return "YQ=="; }, eliminarAudio() {} },
    logger,
    timeoutMs: 5000,
    advanceDelayMs: 0,
  });
  controlador.inicializar();

  const ids = [];
  for (let i = 0; i < 100; i += 1) {
    const entrada = cola.agregar({ usuario: `u${i}`, mensaje: `m${i}` });
    cola.actualizarAudio(entrada.id, { rutaAudio: `${i}.mp3` });
    ids.push(entrada.id);
  }
  controlador.notificarCambio();
  await pausa();

  for (const id of ids) {
    assert.equal(enviados.at(-1).id, id);
    assert.equal(onTerminado(id), true);
    assert.equal(onTerminado(id), false);
    await pausa(3);
  }

  assert.deepEqual(enviados.map((item) => item.id), ids);
  assert.equal(cola.total(), 0);
  controlador.detener();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("una generacion atascada usa fallback y deja avanzar el siguiente audio", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttsbot-playback-"));
  const cola = crearCola(path.join(dir, "queue.json"), logger);
  cola.inicializar();

  const enviados = [];
  let onTerminado;
  const controlador = crearControlador({
    cola,
    socket: {
      enviar(data) { enviados.push(data); return true; },
      alTerminar(cb) { onTerminado = cb; },
      alConectar() {},
    },
    audio: { audioABase64() { return "YQ=="; }, eliminarAudio() {} },
    logger,
    timeoutMs: 5000,
    generationTimeoutMs: 25,
    advanceDelayMs: 0,
  });
  controlador.inicializar();

  const atascado = cola.agregar({ usuario: "uno", mensaje: "sin terminar" });
  const siguiente = cola.agregar({ usuario: "dos", mensaje: "listo" });
  cola.actualizarAudio(siguiente.id, { rutaAudio: "dos.mp3" });
  controlador.notificarCambio();
  await pausa(50);

  assert.equal(enviados[0].id, atascado.id);
  assert.equal(enviados[0].proveedorTts, "navegador");
  assert.equal(cola.buscar(atascado.id).fallbackNavegador, true);
  assert.equal(onTerminado(atascado.id), true);
  await pausa(10);
  assert.equal(enviados[1].id, siguiente.id);
  assert.equal(onTerminado(siguiente.id), true);

  controlador.detener();
  fs.rmSync(dir, { recursive: true, force: true });
});
