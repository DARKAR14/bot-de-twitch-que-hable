const { getAuthToken } = require("@heyputer/puter.js/src/init.cjs");

console.log("Abriendo Puter en el navegador para autorizar esta cuenta...");
console.log("El token se mostrara una sola vez en esta terminal.");

getAuthToken()
  .then((token) => {
    if (!token) throw new Error("Puter no devolvio un token");
    process.stdout.write(`\nPUTER_AUTH_TOKEN=${token}\n`, () => process.exit(0));
  })
  .catch((error) => {
    console.error("No se pudo obtener el token Puter:", error.message || error);
    process.exit(1);
  });
