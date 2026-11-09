import "dotenv/config";
import app from "./app.js";
import { conectarBanco } from "./config/database.js";
import { obterChaveJwt } from "./config/jwt.js";

const PORT = process.env.PORT || 3000;

async function iniciarServidor() {
  try {
    obterChaveJwt();
    await conectarBanco();

    app.listen(PORT, () => {
      console.log(`API executando em http://localhost:${PORT}`);
    });
  } catch (erro) {
    console.error("Não foi possível iniciar a API:", erro.message);
    process.exit(1);
  }
}

iniciarServidor();
