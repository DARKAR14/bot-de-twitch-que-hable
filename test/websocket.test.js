const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const WebSocket = require("ws");
const { crearHub } = require("../src/websocket");

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const pausa = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const abrir = (client) => new Promise((resolve, reject) => {
  client.once("open", resolve);
  client.once("error", reject);
});

test("solo el OBS principal recibe audio y el secundario no puede confirmar", async () => {
  const server = http.createServer();
  const hub = crearHub({ logger, maxPayload: 1024 });
  const confirmados = [];
  hub.alTerminar((id) => confirmados.push(id));
  hub.inicializar(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const principal = new WebSocket(url);
  const mensajesPrincipal = [];
  principal.on("message", (raw) => mensajesPrincipal.push(JSON.parse(raw)));
  await abrir(principal);

  const secundario = new WebSocket(url);
  const mensajesSecundario = [];
  secundario.on("message", (raw) => mensajesSecundario.push(JSON.parse(raw)));
  await abrir(secundario);
  await pausa(30);

  assert.equal(hub.enviar({ tipo: "nuevo", id: "audio-1" }), true);
  await pausa(30);
  assert.equal(mensajesPrincipal.some((m) => m.tipo === "nuevo"), true);
  assert.equal(mensajesSecundario.some((m) => m.tipo === "nuevo"), false);

  secundario.send(JSON.stringify({ tipo: "terminado", id: "audio-1" }));
  await pausa(20);
  assert.deepEqual(confirmados, []);
  principal.send(JSON.stringify({ tipo: "terminado", id: "audio-1" }));
  await pausa(20);
  assert.deepEqual(confirmados, ["audio-1"]);
  assert.equal(
    mensajesPrincipal.some((m) => m.tipo === "confirmado" && m.id === "audio-1"),
    true,
  );
  assert.equal(mensajesSecundario.some((m) => m.tipo === "confirmado"), false);

  principal.close();
  await new Promise((resolve) => principal.once("close", resolve));
  await pausa(20);
  assert.equal(hub.enviar({ tipo: "nuevo", id: "audio-2" }), true);
  await pausa(20);
  assert.equal(
    mensajesSecundario.some((m) => m.tipo === "nuevo" && m.id === "audio-2"),
    true,
  );

  secundario.close();
  hub.cerrar();
  await new Promise((resolve) => server.close(resolve));
});
