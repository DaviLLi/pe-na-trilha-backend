import mongoose from "mongoose";
import { obterAmbienteAplicacao } from "./ambientes.js";
import {
  BANCO_HOMOLOGACAO,
  HOST_ATLAS_TESTES,
  alteraDestinoMongo,
  lerUriMongo,
  normalizarHostMongo,
} from "./isolamentoMongo.js";

const HOSTS_LOCAIS = new Set(["127.0.0.1", "::1"]);

export function obterUriMongo(ambiente = process.env) {
  const configuracaoPorAmbiente = {
    development: {
      variavel: "MONGO_URI_DEVELOPMENT",
      descricao: "desenvolvimento",
    },
    production: {
      variavel: "MONGO_URI_PRODUCTION",
      descricao: "produção",
    },
    homologation: {
      variavel: "MONGO_URI_HOMOLOGATION",
      descricao: "homologação",
    },
  };
  const alvo = obterAmbienteAplicacao(ambiente);
  const configuracao = configuracaoPorAmbiente[alvo];
  const uri = ambiente[configuracao.variavel];
  if (typeof uri !== "string" || !uri.trim()) {
    throw new Error(
      `A variável ${configuracao.variavel} não foi definida para ${configuracao.descricao}.`,
    );
  }

  if (alvo !== "production") {
    const url = lerUriMongo(uri.trim(), configuracao.variavel);
    const host = normalizarHostMongo(url.hostname);
    if (alvo === "development" && (url.protocol !== "mongodb:" || !HOSTS_LOCAIS.has(host)
      || !url.pathname.slice(1) || alteraDestinoMongo(url))) {
      throw new Error("MONGO_URI_DEVELOPMENT deve usar um único MongoDB local de loopback.");
    }
    if (alvo === "homologation" && (url.protocol !== "mongodb+srv:" || url.port || alteraDestinoMongo(url)
      || host !== normalizarHostMongo(ambiente.MONGO_HOST_HOMOLOGATION ?? "")
      || host !== HOST_ATLAS_TESTES || url.pathname !== `/${BANCO_HOMOLOGACAO}` || url.hash)) {
      throw new Error(`Homologação exige o seed SRV do Atlas de testes e o banco ${BANCO_HOMOLOGACAO}.`);
    }
  }
  return uri.trim();
}

export async function conectarBanco(ambiente = process.env, opcoes = {}) {
  const uri = obterUriMongo(ambiente);
  const alvo = obterAmbienteAplicacao(ambiente);
  if (alvo === "development") opcoes = { ...opcoes, directConnection: true };
  if (alvo === "homologation") opcoes = { ...opcoes, dbName: BANCO_HOMOLOGACAO };
  await mongoose.connect(uri, opcoes);
  console.log("MongoDB conectado.");
}
