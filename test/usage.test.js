const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { crearControlUso } = require("../src/usage");

const logger = { info() {}, warn() {}, error() {}, debug() {} };

test("el presupuesto diario limita tanto al usuario como al total", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttsbot-usage-"));
  let ahora = Date.UTC(2026, 7, 10, 15);
  const control = crearControlUso(path.join(dir, "usage.json"), logger, {
    ahora: () => ahora,
    zonaHoraria: "UTC",
  });
  const regla = {
    tipo: "ai",
    limiteDiario: 2,
    limiteUsuario: 1,
  };

  assert.equal(control.reservarVarios([regla], { usuario: "ana" }).ok, true);
  assert.equal(
    control.reservarVarios([regla], { usuario: "ana" }).motivo,
    "limite_usuario",
  );
  assert.equal(control.reservarVarios([regla], { usuario: "luis" }).ok, true);
  assert.equal(
    control.reservarVarios([regla], { usuario: "maria" }).motivo,
    "limite_diario",
  );
  assert.equal(control.stats().categorias.ai.total, 2);
  assert.deepEqual(control.resumen().categorias.ai, {
    total: 2,
    usuariosUnicos: 2,
  });
  assert.equal("usuarios" in control.resumen().categorias.ai, false);

  ahora += 24 * 60 * 60 * 1000;
  assert.equal(control.reservarVarios([regla], { usuario: "ana" }).ok, true);
  assert.equal(control.stats().categorias.ai.total, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("una reserva combinada de IA y Fish se acepta de forma atomica", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttsbot-usage-"));
  const control = crearControlUso(path.join(dir, "usage.json"), logger, {
    ahora: () => Date.UTC(2026, 7, 10, 15),
    zonaHoraria: "UTC",
  });
  const ai = { tipo: "ai", limiteDiario: 10, limiteUsuario: 10 };
  const fishAgotado = { tipo: "fish", limiteDiario: 0, limiteUsuario: 10 };
  const resultado = control.reservarVarios([ai, fishAgotado], { usuario: "ana" });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.tipo, "fish");
  assert.equal(control.stats().categorias.ai.total, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
