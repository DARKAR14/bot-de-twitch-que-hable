const assert = require("node:assert/strict");
const test = require("node:test");
const { _internals } = require("../src/eventsub");

test("EventSub acepta tokens con o sin prefijo oauth", () => {
  assert.equal(_internals.limpiarToken("oauth:abc123"), "abc123");
  assert.equal(_internals.limpiarToken("abc123"), "abc123");
});

test("la suscripcion de follow usa broadcaster y moderador", () => {
  assert.deepEqual(
    _internals.crearSolicitudFollow("sesion-1", {
      broadcasterId: "100",
      moderatorId: "200",
    }),
    {
      type: "channel.follow",
      version: "2",
      condition: {
        broadcaster_user_id: "100",
        moderator_user_id: "200",
      },
      transport: { method: "websocket", session_id: "sesion-1" },
    },
  );
});

test("EventSub ignora IDs duplicados", () => {
  const id = `evento-${Date.now()}`;
  assert.equal(_internals.mensajeYaProcesado(id), false);
  assert.equal(_internals.mensajeYaProcesado(id), true);
});
