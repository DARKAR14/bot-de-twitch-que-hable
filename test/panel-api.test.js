const assert = require("node:assert/strict");
const test = require("node:test");
const { crearApiPanel, _internals } = require("../src/panel-api");

function config() {
  return {
    PANEL_API_TOKEN: "token-muy-largo-del-panel",
    PANEL_IDEMPOTENCY_TTL_HOURS: 1,
    PANEL_IDEMPOTENCY_MAX: 100,
  };
}

test("la API del panel acepta Bearer o X-Panel-Token con comparación segura", () => {
  const api = crearApiPanel(config());
  assert.equal(api.autenticacion({ headers: { authorization: "Bearer token-muy-largo-del-panel" } }).ok, true);
  assert.equal(api.autenticacion({ headers: { "x-panel-token": "token-muy-largo-del-panel" } }).ok, true);
  assert.equal(api.autenticacion({ headers: { authorization: "Bearer incorrecto" } }).status, 401);
  assert.equal(crearApiPanel({ ...config(), PANEL_API_TOKEN: null }).autenticacion({ headers: {} }).status, 503);
});

test("una Idempotency-Key repetida devuelve el mismo trabajo sin duplicarlo", () => {
  let timestamp = 1000;
  const api = crearApiPanel(config(), { ahora: () => timestamp });
  const payload = { actorId: "123", message: "hola" };
  const fingerprint = api.huella(payload);
  assert.equal(api.buscarRepetida("solicitud-123", fingerprint), null);

  const guardada = api.registrar("solicitud-123", fingerprint, 202, {
    ok: true,
    id: "trabajo-1",
    voice: "auto",
    action: "speak",
  });
  assert.equal(guardada.replayed, false);
  const repetida = api.buscarRepetida("solicitud-123", fingerprint);
  assert.equal(repetida.status, 202);
  assert.equal(repetida.body.id, "trabajo-1");
  assert.equal(repetida.body.replayed, true);
  assert.equal(api.trabajo("trabajo-1").body.id, "trabajo-1");

  const conflicto = api.buscarRepetida("solicitud-123", api.huella({ ...payload, message: "otro" }));
  assert.equal(conflicto.status, 409);
  timestamp += 60 * 60 * 1000 + 1;
  assert.equal(api.buscarRepetida("solicitud-123", fingerprint), null);
});

test("valida el actor y la clave de idempotencia", () => {
  assert.equal(_internals.normalizarIdActor("  twitch:123  "), "twitch:123");
  assert.equal(_internals.normalizarIdActor(""), null);
  assert.equal(_internals.normalizarIdActor("a\nmal"), null);
  assert.equal(_internals.normalizarClaveIdempotencia("550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(_internals.normalizarClaveIdempotencia("corta"), null);
  assert.equal(_internals.normalizarClaveIdempotencia("no valida /"), null);
});
