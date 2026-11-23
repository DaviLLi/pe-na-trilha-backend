import mongoose from "mongoose";
import { obterAmbienteAplicacao } from "./ambientes.js";
import {
  BANCO_HOMOLOGACAO,
  BANCO_PRODUCAO,
  HOST_ATLAS_PRODUCAO,
  HOST_ATLAS_TESTES,
  alteraDestinoMongo,
  lerUriMongo,
  normalizarHostMongo,
  pertenceAoAtlas,
} from "./isolamentoMongo.js";

const destinos = {
  production: { variavel: "MONGO_URI_PRODUCTION", host: HOST_ATLAS_PRODUCAO, banco: BANCO_PRODUCAO },
  homologation: { variavel: "MONGO_URI_HOMOLOGATION", host: HOST_ATLAS_TESTES, banco: BANCO_HOMOLOGACAO },
};

export function obterUriMongo(ambiente = process.env) {
  const alvo = obterAmbienteAplicacao(ambiente);
  const { variavel, host, banco } = destinos[alvo];
  const uri = ambiente[variavel]?.trim();
  if (!uri) throw new Error(`A variável ${variavel} não foi definida.`);

  const url = lerUriMongo(uri, variavel);
  if (url.protocol !== "mongodb+srv:" || url.port || alteraDestinoMongo(url)
    || normalizarHostMongo(url.hostname) !== host || url.pathname !== `/${banco}` || url.hash
    || (alvo === "homologation" && normalizarHostMongo(ambiente.MONGO_HOST_HOMOLOGATION ?? "") !== host)) {
    throw new Error(`${variavel} deve usar o seed SRV e o banco ${banco} de ${alvo}.`);
  }
  return uri;
}

function opcoesDoDestino(ambiente) {
  const { banco, host } = destinos[obterAmbienteAplicacao(ambiente)];
  return { dbName: banco, tls: true, tlsInsecure: false, srvAllowedHostsSuffix: host.slice(host.indexOf(".")) };
}

export async function conectarBanco(ambiente = process.env, opcoes = {}) {
  await mongoose.connect(obterUriMongo(ambiente), { ...opcoes, ...opcoesDoDestino(ambiente) });
  console.log("MongoDB conectado.");
}

export async function verificarConexaoBanco(ambiente = process.env) {
  const { banco, host } = destinos[obterAmbienteAplicacao(ambiente)];
  const cliente = new mongoose.mongo.MongoClient(obterUriMongo(ambiente), opcoesDoDestino(ambiente));
  try {
    await cliente.connect();
    const db = cliente.db();
    const { me } = await db.command({ hello: 1 });
    const membro = normalizarHostMongo(me?.split(":")[0] ?? "");
    if (db.databaseName !== banco || !pertenceAoAtlas(membro, host)) {
      throw new Error("A conexão não corresponde ao cluster e banco esperados.");
    }
    await db.listCollections({}, { nameOnly: true }).hasNext();
    return { host, banco };
  } finally {
    await cliente.close();
  }
}
