const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
      obtenerOrden: () => ["gemini", "fish", "puter", "google"],
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
    "fish",
    "puter",
    "google",
  ]);
  assert.equal(resultado.voice, "auto");
  assert.equal(notificaciones, 1);
});

test("/chat aplica Naruto por identificador sin incluir comandos en el mensaje", () => {
  let entradaAgregada;
  let generacion;
  let reglasReservadas;
  let controlCreado;
  const items = [];
  const resultado = twitch.encolarDesdeWeb(
    {
      name: "Oculto",
      message: "Bienvenidos al stream",
      voice: "naruto",
      clientKey: "198.51.100.10",
    },
    {
      colaServicio: {
        total: () => items.length,
        agregar: (entrada) => {
          entradaAgregada = { id: "chat-naruto", ...entrada };
          items.push(entradaAgregada);
          return entradaAgregada;
        },
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
      crearControl: (usuario, esMod, preautorizados) => {
        controlCreado = { usuario, esMod, preautorizados };
        return () => true;
      },
      fishDisponible: true,
    },
  );

  assert.equal(resultado.ok, true);
  assert.equal(resultado.voice, "naruto");
  assert.equal(entradaAgregada.vozSeleccionada, "naruto");
  assert.equal(entradaAgregada.mensaje, "Bienvenidos al stream");
  assert.deepEqual(reglasReservadas.map(({ tipo }) => tipo), ["web_chat", "fish"]);
  assert.deepEqual(generacion.opciones.providerOrder, [
    "fish",
    "gemini",
    "puter",
    "google",
  ]);
  assert.equal(
    generacion.opciones.fishReferenceId,
    "1412b58e859448d284f8f62391e82bd9",
  );
  assert.equal(generacion.texto, "Bienvenidos al stream");
  assert.doesNotMatch(generacion.texto, /!naruto/i);
  assert.deepEqual(controlCreado.preautorizados, ["fish"]);
});

test("el selector publica IDs estables y resuelve todos los perfiles", () => {
  const voces = twitch.vocesWeb();
  assert.deepEqual(
    voces.map(({ id }) => id),
    ["auto", "gemini", "diomedes", "naruto", "google"],
  );

  const ordenAuto = ["gemini", "fish", "puter", "google"];
  const perfiles = Object.fromEntries(
    voces.map(({ id }) => [
      id,
      twitch._internals.resolverPerfilVozWeb(id, () => ordenAuto),
    ]),
  );
  assert.deepEqual(perfiles.auto.providerOrder, ordenAuto);
  assert.deepEqual(perfiles.gemini.providerOrder, ["gemini", "puter", "google"]);
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
  assert.equal(
    twitch._internals.resolverPerfilVozWeb("naruto").fishReferenceId,
    "1412b58e859448d284f8f62391e82bd9",
  );
});

test("la pagina /chat envia name, message y el identificador de voz", () => {
  const html = fs.readFileSync(path.join(__dirname, "../chat.html"), "utf8");
  assert.match(html, /fetch\('\/api\/chat'/);
  assert.match(html, /JSON\.stringify\(\{ name, message, voice \}\)/);
  assert.match(html, /id="name"/);
  assert.match(html, /id="message"/);
  assert.match(html, /id="voice"/);
  assert.match(html, /escribe solamente el mensaje/i);
});
