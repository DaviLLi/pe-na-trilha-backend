import "dotenv/config";
import app from "./app.js";
import { conectarBanco } from "./config/database.js";
import { obterChaveJwt } from "./config/jwt.js";
import mongoose from "mongoose";
import {
  iniciarProcessadorOperacoesImagem,
  pararProcessadorOperacoesImagem,
} from "./services/processarOperacoesImagem.js";

const PORT = process.env.PORT || 3000;
let servidor;
let encerramento;

async function iniciarServidor() {
  try {
    obterChaveJwt();
    await conectarBanco();
    iniciarProcessadorOperacoesImagem();

    servidor = app.listen(PORT, () => {
      console.log(`API executando em http://localhost:${PORT}`);
    });

    process.on("SIGINT", encerrarServidor);
    process.on("SIGTERM", encerrarServidor);
  } catch (erro) {
    console.error("Não foi possível iniciar a API:", erro.message);
    process.exit(1);
  }
}

function encerrarServidor(sinal) {
  if (encerramento) {
    return encerramento;
  }

  console.log(`Sinal ${sinal}; encerrando a API.`);
  encerramento = (async () => {
    const paradaDoProcessador = pararProcessadorOperacoesImagem();
    try {
      if (servidor?.listening) {
        await new Promise((resolve, reject) => {
          servidor.close((erro) => (erro ? reject(erro) : resolve()));
        });
      }
    } finally {
      await paradaDoProcessador;
      await mongoose.disconnect();
    }
  })().catch((erro) => {
    console.error("Falha durante o encerramento da API:", erro.message);
    process.exitCode = 1;
  });

  return encerramento;
}

iniciarServidor();
