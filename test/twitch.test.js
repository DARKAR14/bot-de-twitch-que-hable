const assert = require("node:assert/strict");
const test = require("node:test");
const { _internals } = require("../src/twitch");
const twitch = require("../src/twitch");

test("los comandos TTS exigen limite de palabra", () => {
  const habla = _internals.detectarComando("!habla hola");
  const prueba = _internals.detectarComando("!pruebavoz hola");
  assert.equal(habla.idioma, "es");
  assert.equal(habla.provider, "balanced");
  assert.equal(_internals.detectarComando("!speak hello").idioma, "en");
  assert.equal(_internals.detectarComando("!diomedes hola"), undefined);
  assert.equal(prueba.soloMods, true);
  assert.equal(prueba.voice, habla.voice);
  assert.equal(prueba.style, habla.style);
  assert.match(prueba.style, /feminine/i);
  assert.equal(_internals.detectarComando("!naruto hola"), undefined);
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

test("!habla reserva Fish y usa respaldos generales en orden estable", () => {
  const primera = _internals.tomarOrdenHabla();
  const segunda = _internals.tomarOrdenHabla();
  assert.deepEqual(primera, ["gemini", "puter", "huggingface", "google"]);
  assert.deepEqual(segunda, primera);
  assert.equal(primera.includes("fish"), false);
  assert.equal(primera.at(-1), "google");
});

test("Gemini, Puter y Hugging Face tienen presupuestos independientes", () => {
  assert.equal(_internals.reglaUso("gemini_tts").tipo, "gemini_tts");
  assert.ok(_internals.reglaUso("gemini_tts").limiteDiario > 0);
  assert.equal(_internals.reglaUso("puter_tts").tipo, "puter_tts");
  assert.ok(_internals.reglaUso("puter_tts").limiteDiario > 0);
  assert.equal(_internals.reglaUso("huggingface_tts").tipo, "huggingface_tts");
  assert.ok(_internals.reglaUso("huggingface_tts").limiteDiario > 0);
  assert.equal(_internals.reglaUso("ai").tipo, "ai");
});

test("las alertas asignan Naruto a raids/follows y Diomedes al apoyo", () => {
  assert.equal(_internals.perfilAlertaEspecial("raid").nombre, "Naruto");
  assert.equal(_internals.perfilAlertaEspecial("follow").nombre, "Naruto");
  assert.equal(_internals.perfilAlertaEspecial("sub").nombre, "Diomedes");
  assert.match(
    _internals.construirAlertaEspecial({ tipo: "raid", usuario: "Ana", cantidad: 20 }),
    /Ana.+20 personas/i,
  );
});

test("una alerta usa Fish primero y agrupa una rafaga inmediata", () => {
  const items = [];
  let generacion;
  let reglaReservada;
  const base = Date.now() + 60_000;
  const servicios = {
    colaServicio: {
      total: () => items.length,
      agregar: (entrada) => {
        const guardada = { id: `alerta-${items.length + 1}`, ...entrada };
        items.push(guardada);
        return guardada;
      },
    },
    usoServicio: {
      reservarVarios: (reglas) => {
        [reglaReservada] = reglas;
        return { ok: true };
      },
    },
    generarTts: (entrada, texto, idioma, opciones) => {
      generacion = { entrada, texto, idioma, opciones };
    },
    notificarCambio: () => {},
    ahora: () => base,
  };
  const primera = twitch.encolarAlertaEspecial(
    { tipo: "raid", usuario: "Streamer", cantidad: 50, tags: { id: "raid-prueba" } },
    servicios,
  );
  assert.equal(primera.ok, true);
  assert.equal(primera.voz, "Naruto");
  assert.equal(items[0].tipo, "alerta");
  assert.deepEqual(generacion.opciones.providerOrder, [
    "fish",
    "gemini",
    "puter",
    "huggingface",
    "google",
  ]);
  assert.equal(generacion.opciones.puedeUsarProveedor("fish"), true);
  assert.equal(reglaReservada.tipo, "fish");

  const segunda = twitch.encolarAlertaEspecial(
    { tipo: "sub", usuario: "Ana", tags: { id: "sub-prueba" } },
    { ...servicios, ahora: () => base + 1_000 },
  );
  assert.equal(segunda.ok, false);
  assert.equal(segunda.motivo, "rafaga");
  assert.equal(items.length, 1);
});
