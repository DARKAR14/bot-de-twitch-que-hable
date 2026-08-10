const assert = require("node:assert/strict");
const test = require("node:test");
const { _internals } = require("../src/twitch");

test("los comandos TTS exigen limite de palabra", () => {
  const habla = _internals.detectarComando("!habla hola");
  const prueba = _internals.detectarComando("!pruebavoz hola");
  const naruto = _internals.detectarComando("!naruto hola");
  assert.equal(habla.idioma, "es");
  assert.equal(habla.provider, "balanced");
  assert.equal(_internals.detectarComando("!speak hello").idioma, "en");
  assert.equal(_internals.detectarComando("!diomedes hola"), undefined);
  assert.equal(prueba.soloMods, true);
  assert.equal(prueba.voice, habla.voice);
  assert.equal(prueba.style, habla.style);
  assert.match(prueba.style, /feminine/i);
  assert.equal(naruto.provider, "fish");
  assert.equal(naruto.tipo, "naruto");
  assert.match(naruto.fishReferenceId, /^[a-f0-9]{32}$/);
  assert.equal(_internals.detectarComando("!hablado esto no es comando"), undefined);
});

test("la limpieza limita repeticiones sin alterar texto normal", () => {
  assert.equal(_internals.limpiarRepeticiones("holaaaaaaa", 4), "holaaaa");
  assert.equal(_internals.limpiarRepeticiones("hola", 4), "hola");
});

test("!ia selecciona Gemini por defecto y Fish de forma explicita", () => {
  assert.deepEqual(_internals.parsearComandoIa("!IA que es un acordeon"), {
    pregunta: "que es un acordeon",
    modoVoz: "gemini",
  });
  assert.deepEqual(_internals.parsearComandoIa("!ia diomedes echate un cuento"), {
    pregunta: "echate un cuento",
    modoVoz: "fish",
  });
  assert.deepEqual(_internals.parsearComandoIa("!ia diomedez como vamos"), {
    pregunta: "como vamos",
    modoVoz: "fish",
  });
  assert.deepEqual(_internals.parsearComandoIa("!ia naruto dame un consejo"), {
    pregunta: "dame un consejo",
    modoVoz: "naruto",
  });
  assert.equal(_internals.parsearComandoIa("!imagen gato"), null);
});

test("!ia Diomedes presenta al usuario y su pregunta antes de responder", () => {
  assert.equal(
    _internals.construirNarracionIa({
      usuario: "DARKAR",
      pregunta: "como va la parranda",
      respuesta: "Va sabrosa y apenas está comenzando.",
      modoVoz: "fish",
    }),
    "Aquí mi compae DARKAR me pregunta: como va la parranda. Va sabrosa y apenas está comenzando.",
  );
  assert.equal(
    _internals.construirNarracionIa({
      usuario: "Ana",
      pregunta: "todo bien?",
      respuesta: "Todo firme.",
      modoVoz: "fish",
    }),
    "Aquí mi compae Ana me pregunta: todo bien? Todo firme.",
  );
  assert.equal(
    _internals.construirNarracionIa({
      usuario: "Ana",
      pregunta: "todo bien",
      respuesta: "Todo firme.",
      modoVoz: "gemini",
    }),
    "Todo firme.",
  );
});

test("!habla alterna Fish y Gemini, luego usa Puter y deja Google al final", () => {
  const primera = _internals.tomarOrdenHabla();
  const segunda = _internals.tomarOrdenHabla();
  assert.notEqual(primera[0], segunda[0]);
  assert.deepEqual(new Set(primera.slice(0, 2)), new Set(["fish", "gemini"]));
  assert.equal(primera.at(-2), "puter");
  assert.equal(segunda.at(-2), "puter");
  assert.equal(primera.at(-1), "google");
  assert.equal(segunda.at(-1), "google");
});

test("Gemini y Puter TTS tienen presupuestos independientes de las respuestas IA", () => {
  assert.equal(_internals.reglaUso("gemini_tts").tipo, "gemini_tts");
  assert.ok(_internals.reglaUso("gemini_tts").limiteDiario > 0);
  assert.equal(_internals.reglaUso("puter_tts").tipo, "puter_tts");
  assert.ok(_internals.reglaUso("puter_tts").limiteDiario > 0);
  assert.equal(_internals.reglaUso("ai").tipo, "ai");
});
