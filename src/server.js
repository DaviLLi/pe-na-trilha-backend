import "./config/carregarAmbiente.js";
import app from "./app.js";
import { conectarBanco, obterUriMongo, verificarConexaoBanco } from "./config/database.js";
import { obterChaveJwt } from "./config/jwt.js";
import { obterSegredoCsrf } from "./config/csrf.js";
import { validarConfiguracaoCookies } from "./config/authCookies.js";
import { obterCloudinaryHomologacao } from "./config/isolamentoCloudinary.js";
import { cloudinaryDisponivel } from "./config/cloudinary.js";
import mongoose from "mongoose";
import TentativaLogin from "./models/TentativaLogin.js";
import {
  iniciarProcessadorOperacoesImagem,
  pararProcessadorOperacoesImagem,
} from "./services/processarOperacoesImagem.js";

const local = process.argv.includes("--local");
const homologacao = process.env.APP_ENV === "homologation";
const host = local ? (homologacao ? "127.0.0.1" : "localhost") : "0.0.0.0";
const PORT = local ? (homologacao ? 3001 : 3000) : Number(process.env.PORT || 3000);
let servidor;
let encerramento;

async function iniciarServidor() {
  try {
    obterUriMongo();
    if (local) process.env.FRONTEND_ORIGINS = homologacao ? "http://127.0.0.1:5174" : "http://localhost:5173";
    if (homologacao) {
      Object.assign(process.env, obterCloudinaryHomologacao(process.env, [process.env]));
      delete process.env.CLOUDINARY_HOMOLOGACAO_RUN_ID;
    }
    if (!cloudinaryDisponivel()) throw new Error("Configure Cloud Name, API Key e API Secret do ambiente selecionado.");
    obterChaveJwt();
    obterSegredoCsrf();
    validarConfiguracaoCookies();
  } catch (erro) {
    console.error("Configuração da API recusada.", erro.message);
    process.exitCode = 1;
    return;
  }

  try {
    if (process.argv.includes("--check-connection")) {
      const destino = await verificarConexaoBanco();
      console.log(`MongoDB conferido em leitura: ${destino.host} / ${destino.banco}.`);
      return;
    }
    await conectarBanco();
    await TentativaLogin.createIndexes();
    iniciarProcessadorOperacoesImagem();

    servidor = app.listen(PORT, host, () => {
      console.log(`API executando em http://${host}:${PORT}`);
    });

    process.on("SIGINT", encerrarServidor);
    process.on("SIGTERM", encerrarServidor);
  } catch (erro) {
    console.error("Não foi possível iniciar a API.", {
      codigo: Number.isInteger(erro.code) ? erro.code : undefined,
    });
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
