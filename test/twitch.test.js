const assert = require("node:assert/strict");
const test = require("node:test");
const { _internals } = require("../src/twitch");

test("los comandos TTS exigen limite de palabra", () => {
  assert.equal(_internals.detectarComando("!habla hola").idioma, "es");
  assert.equal(_internals.detectarComando("!speak hello").idioma, "en");
  assert.equal(_internals.detectarComando("!hablado esto no es comando"), undefined);
});

test("la limpieza limita repeticiones sin alterar texto normal", () => {
  assert.equal(_internals.limpiarRepeticiones("holaaaaaaa", 4), "holaaaa");
  assert.equal(_internals.limpiarRepeticiones("hola", 4), "hola");
});
