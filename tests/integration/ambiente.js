import { randomBytes } from "node:crypto";
import { lerArquivoAmbiente } from "../../src/config/ambientes.js";
import { obterCloudinaryHomologacao } from "../../src/config/isolamentoCloudinary.js";
import {
  HOST_ATLAS_TESTES,
  alteraDestinoMongo,
  lerUriMongo,
  normalizarHostMongo,
  pertenceAoAtlas,
} from "../../src/config/isolamentoMongo.js";

const MARCADOR_BANCO_TESTE = /(?:^|[_-])(?:test|testing|integration|ci)(?:[_-]|$)/i;
const PREFIXO_BANCO_EXECUCAO = "tst_";
const LIMITE_BANCO_BYTES = 38;
const ID_EXECUCAO_VALIDO = /^[a-f0-9]{32}$/;

export function validarAmbienteIntegracao(ambiente) {
  if (ambiente.TEST_ENVIRONMENT !== "integration") {
    throw new Error("Defina TEST_ENVIRONMENT=integration para executar esta suíte.");
  }

  const uri = ambiente.TEST_MONGO_URI?.trim();
  if (!uri) {
    throw new Error("A variável TEST_MONGO_URI é obrigatória.");
  }

  const url = lerUriMongo(uri, "TEST_MONGO_URI");
  const hostMongo = normalizarHostMongo(url.hostname);
  if (url.protocol !== "mongodb+srv:" || url.port || alteraDestinoMongo(url) || hostMongo !== HOST_ATLAS_TESTES) {
    throw new Error("TEST_MONGO_URI deve apontar para o seed SRV do Atlas de testes autorizado.");
  }

  let bancoBase;
  try {
    bancoBase = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("O nome do banco em TEST_MONGO_URI é inválido.");
  }
  if (
    !bancoBase ||
    !MARCADOR_BANCO_TESTE.test(bancoBase) ||
    !/^[A-Za-z0-9_-]+$/.test(bancoBase)
  ) {
    throw new Error("O nome do banco em TEST_MONGO_URI precisa conter um marcador de teste válido.");
  }

  const hostsPermitidos = (ambiente.TEST_MONGO_ALLOWED_HOSTS || "")
    .split(",")
    .map(normalizarHostMongo)
    .filter(Boolean);

  if (!hostsPermitidos.length || hostsPermitidos.some((host) => !/^[a-z0-9.-]+$/.test(host)
    || !pertenceAoAtlas(host, HOST_ATLAS_TESTES))) {
    throw new Error("TEST_MONGO_ALLOWED_HOSTS deve conter somente hosts explícitos do Atlas de testes.");
  }
  if (!hostsPermitidos.includes(hostMongo)) {
    throw new Error("O host de TEST_MONGO_URI não está na allowlist.");
  }

  return { uri, bancoBase, hostMongo, hostsPermitidos };
}

export function carregarAmbienteIntegracao(ambiente = process.env, destinosCloudinary = []) {
  const arquivo = lerArquivoAmbiente(".env.integration");
  for (const nome of ["TEST_ENVIRONMENT", "TEST_MONGO_URI", "TEST_MONGO_ALLOWED_HOSTS", "TEST_CLOUDINARY_REAL"]) {
    if (arquivo[nome] !== undefined) ambiente[nome] ??= arquivo[nome];
  }
  const config = validarAmbienteIntegracao(ambiente);
  if (ambiente.TEST_CLOUDINARY_REAL === "1") {
    const homologacao = { ...lerArquivoAmbiente(".env.homologation"), ...ambiente };
    config.cloudinary = obterCloudinaryHomologacao(homologacao, destinosCloudinary);
  }
  return config;
}

export function validarBancoDaExecucao(ambiente) {
  const idExecucao = ambiente.TEST_RUN_ID || "";
  const bancoExecucao = ambiente.TEST_RUN_DB_NAME || "";
  let bancoEsperado;
  try {
    bancoEsperado = criarNomeBancoDaExecucao(idExecucao);
  } catch {
    throw new Error("A base isolada da execução de integração é inválida.");
  }

  if (
    Buffer.byteLength(bancoExecucao, "utf8") > LIMITE_BANCO_BYTES ||
    bancoExecucao !== bancoEsperado
  ) {
    throw new Error("A base isolada da execução de integração é inválida.");
  }

  return bancoExecucao;
}

export function validarBancoConectado(db, bancoEsperado) {
  if (db?.databaseName !== bancoEsperado) {
    throw new Error("A conexão MongoDB não selecionou o banco isolado da execução.");
  }
}

export function criarNomeBancoDaExecucao(runId) {
  if (!ID_EXECUCAO_VALIDO.test(runId || "")) {
    throw new Error("O identificador da execução de integração é inválido.");
  }

  const nomeBanco = `${PREFIXO_BANCO_EXECUCAO}${runId}`;
  if (Buffer.byteLength(nomeBanco, "utf8") > LIMITE_BANCO_BYTES) {
    throw new Error("O nome do banco da execução excede o limite permitido.");
  }

  return nomeBanco;
}

export function prepararAmbienteAplicacao(ambiente, config) {
  ambiente.NODE_ENV = "test";
  delete ambiente.APP_ENV;
  delete ambiente.MONGO_URI;
  delete ambiente.MONGO_URI_DEVELOPMENT;
  delete ambiente.MONGO_URI_PRODUCTION;
  delete ambiente.MONGO_URI_HOMOLOGATION;
  delete ambiente.MONGO_HOST_HOMOLOGATION;
  delete ambiente.JWT_SECRET;
  delete ambiente.CSRF_SECRET;
  delete ambiente.CLOUDINARY_CLOUD_NAME;
  delete ambiente.CLOUDINARY_API_KEY;
  delete ambiente.CLOUDINARY_API_SECRET;
  delete ambiente.CLOUDINARY_URL;
  delete ambiente.CLOUDINARY_DIAGNOSTICO_403;
  delete ambiente.CLOUDINARY_HOMOLOGACAO_RUN_ID;

  if (config.cloudinary) {
    validarBancoDaExecucao(ambiente);
    Object.assign(ambiente, config.cloudinary);
    ambiente.CLOUDINARY_HOMOLOGACAO_RUN_ID = ambiente.TEST_RUN_ID;
  }
  ambiente.TEST_RUN_JWT_SECRET ??= randomBytes(32).toString("base64");
  ambiente.TEST_RUN_CSRF_SECRET ??= randomBytes(32).toString("base64");
  ambiente.JWT_SECRET = ambiente.TEST_RUN_JWT_SECRET;
  ambiente.CSRF_SECRET = ambiente.TEST_RUN_CSRF_SECRET;
}
