const assert = require("node:assert/strict");
const test = require("node:test");
const { _internals } = require("../src/twitch-token-store");

test("el almacén interpreta fechas Mongo y cadenas ISO", () => {
  const fecha = new Date("2026-08-10T12:00:00.000Z");
  assert.equal(_internals.fechaMs(fecha), fecha.getTime());
  assert.equal(_internals.fechaMs(fecha.toISOString()), fecha.getTime());
  assert.equal(_internals.fechaMs("invalida"), 0);
});
