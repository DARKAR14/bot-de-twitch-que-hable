const assert = require("node:assert/strict");
const test = require("node:test");
const twitch = require("../src/twitch");

test("/chat separa el nombre visual del mensaje que recibe el TTS", () => {
  let entradaAgregada;
  let generacion;
  let notificaciones = 0;
  let reglasReservadas;
  const items = [];
  const resultado = twitch.encolarDesdeWeb(
    {
      name: "  Incógnito  ",
      message: "Holaaaaaa\nsolo lee este mensaje",
      clientKey: "203.0.113.50",
    },
    {
      colaServicio: {
        total: () => items.length,
        agregar: (entrada) => {
          entradaAgregada = { id: "chat-1", ...entrada };
          items.push(entradaAgregada);
          return entradaAgregada;
        },
      },
      usoServicio: {
        reservarVarios: (reglas, contexto) => {
          reglasReservadas = reglas;
          assert.match(contexto.usuario, /^web:[a-f0-9]{16}$/);
          assert.doesNotMatch(contexto.usuario, /203\.0\.113\.50/);
          return { ok: true };
        },
      },
      notificarCambio: () => { notificaciones += 1; },
      generarTts: (entrada, texto, idioma, opciones) => {
        generacion = { entrada, texto, idioma, opciones };
      },
      obtenerOrden: () => ["gemini", "puter", "huggingface", "google"],
      crearControl: () => () => true,
    },
  );

  assert.equal(resultado.ok, true);
  assert.equal(entradaAgregada.usuario, "Incógnito");
  assert.equal(entradaAgregada.mensaje, "Holaaaa solo lee este mensaje");
  assert.equal(entradaAgregada.origen, "chat");
  assert.equal(entradaAgregada.tipo, "chat");
  assert.equal(entradaAgregada.vozSeleccionada, "auto");
  assert.deepEqual(reglasReservadas.map(({ tipo }) => tipo), ["web_chat"]);
  assert.equal(generacion.texto, entradaAgregada.mensaje);
  assert.doesNotMatch(generacion.texto, /Incógnito/);
  assert.equal(generacion.idioma, "es");
  assert.deepEqual(generacion.opciones.providerOrder, [
    "gemini",
    "puter",
    "huggingface",
    "google",
  ]);
  assert.equal(resultado.voice, "auto");
  assert.equal(resultado.action, "speak");
  assert.equal(notificaciones, 1);
});

test("/chat permite Diomedes y Naruto con presupuesto Fish", () => {
  for (const voice of ["diomedes", "naruto"]) {
    let reglasReservadas;
    let generacion;
    const resultado = twitch.encolarDesdeWeb(
      { name: "Oculto", message: "Bienvenidos", voice },
      {
        colaServicio: {
          total: () => 0,
          agregar: (entrada) => ({ id: `chat-${voice}`, ...entrada }),
        },
        usoServicio: {
          reservarVarios: (reglas) => {
            reglasReservadas = reglas;
            return { ok: true };
          },
        },
        notificarCambio: () => {},
        generarTts: (entrada, texto, idioma, opciones) => {
          generacion = { entrada, texto, idioma, opciones };
        },
        crearControl: () => () => true,
        fishDisponible: true,
      },
    );
    assert.equal(resultado.ok, true);
    assert.equal(resultado.voice, voice);
    assert.deepEqual(reglasReservadas.map(({ tipo }) => tipo), ["web_chat", "fish"]);
    assert.equal(generacion.opciones.providerOrder[0], "fish");
  }
});

test("/chat puede preguntar a la IA con la voz seleccionada", () => {
  const items = [];
  let solicitudIa;
  let reglasReservadas;
  const resultado = twitch.encolarDesdeWeb(
    {
      name: "Darkar",
      message: "por que el vallenato tiene acordeon",
      voice: "diomedes",
      action: "ask",
    },
    {
      colaServicio: {
        total: () => items.length,
        agregar: (entrada) => {
          const guardada = { id: "pregunta-1", ...entrada };
          items.push(guardada);
          return guardada;
        },
      },
      usoServicio: {
        reservarVarios: (reglas) => {
          reglasReservadas = reglas;
          return { ok: true };
        },
      },
      notificarCambio: () => {},
      crearControl: () => () => true,
      procesarPregunta: (solicitud) => { solicitudIa = solicitud; },
      geminiDisponible: true,
      fishDisponible: true,
    },
  );
  assert.equal(resultado.ok, true);
  assert.equal(resultado.action, "ask");
  assert.equal(items[0].tipo, "ia");
  assert.equal(items[0].mensaje, "Preparando respuesta…");
  assert.equal(solicitudIa.modoVoz, "fish");
  assert.equal(solicitudIa.perfilVoz.providerOrder[0], "fish");
  assert.deepEqual(reglasReservadas.map(({ tipo }) => tipo), [
    "web_chat",
    "ai",
    "fish",
  ]);
});

test("el selector publica IDs estables y resuelve todos los perfiles", () => {
  const voces = twitch.vocesWeb();
  assert.deepEqual(
    voces.map(({ id }) => id),
    ["auto", "gemini", "diomedes", "naruto", "google"],
  );

  const ordenAuto = ["gemini", "puter", "huggingface", "google"];
  const perfiles = Object.fromEntries(
    voces.map(({ id }) => [
      id,
      twitch._internals.resolverPerfilVozWeb(id, () => ordenAuto),
    ]),
  );
  assert.deepEqual(perfiles.auto.providerOrder, ordenAuto);
  assert.deepEqual(perfiles.gemini.providerOrder, ordenAuto);
  assert.equal(perfiles.diomedes.providerOrder[0], "fish");
  assert.equal(perfiles.naruto.providerOrder[0], "fish");
  assert.deepEqual(perfiles.google.providerOrder, ["google"]);
  assert.equal(twitch._internals.resolverPerfilVozWeb("desconocida"), null);
});

test("/chat rechaza campos vacios y limpia controles invisibles", () => {
  assert.equal(
    twitch.encolarDesdeWeb({ name: "", message: "hola" }).code,
    "INVALID_NAME",
  );
  assert.equal(
    twitch.encolarDesdeWeb({ name: "ana", message: "" }).code,
    "INVALID_MESSAGE",
  );
  assert.equal(
    twitch.encolarDesdeWeb({ name: "ana", message: "hola", voice: "inventada" }).code,
    "INVALID_VOICE",
  );
  assert.equal(
    twitch._internals.limpiarCampoWeb(" A\u202e\nna ", 30),
    "A na",
  );
  assert.equal(twitch._internals.normalizarIdVozWeb("fish"), "diomedes");
  assert.equal(twitch._internals.normalizarAccionWeb("ask"), "ask");
  assert.equal(twitch._internals.normalizarAccionWeb("inventada"), null);
  assert.match(
    twitch._internals.resolverPerfilVozWeb("naruto").fishReferenceId,
    /^[a-f0-9]{32}$/,
  );
});
