const assert = require("node:assert/strict");
const test = require("node:test");
const { _internals } = require("../src/ai");

test("la cache de IA normaliza mayusculas, tildes y puntuacion", () => {
  assert.equal(_internals.normalizarClave("¿HÓLA, cómo estás!!!"), "hola como estas");
});

test("la respuesta se limpia y nunca supera el maximo", () => {
  const respuesta = _internals.limitarRespuesta(
    "**Primera frase correcta.** Segunda frase demasiado larga para una alerta de stream.",
    45,
  );
  assert.ok(respuesta.length <= 45);
  assert.doesNotMatch(respuesta, /\*/);
});

test("el prompt exige ortografia correcta y una personalidad original", () => {
  const prompt = _internals.promptSistema("gemini");
  assert.match(prompt, /ortografía y puntuación correctas/i);
  assert.match(prompt, /personalidad original/i);
  assert.match(prompt, /no imites ni afirmes ser una persona real/i);
});

test("!ia naruto usa una personalidad anime original sin suplantar al personaje", () => {
  const prompt = _internals.promptSistema("naruto");
  assert.match(prompt, /joven ninja/i);
  assert.match(prompt, /No afirmes ser Naruto/i);
  assert.match(prompt, /no repitas frases distintivas/i);
});
