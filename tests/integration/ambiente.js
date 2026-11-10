import { randomBytes } from "node:crypto";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

const VARIAVEIS_CLOUDINARY = [
  "TEST_CLOUDINARY_CLOUD_NAME",
  "TEST_CLOUDINARY_API_KEY",
  "TEST_CLOUDINARY_API_SECRET",
];
const MARCADOR_BANCO_TESTE = /(?:^|[_-])(?:test|testing|integration|ci)(?:[_-]|$)/i;
const PREFIXO_BANCO_EXECUCAO = "tst_";
const LIMITE_BANCO_BYTES = 38;
const ID_EXECUCAO_VALIDO = /^[a-f0-9]{32}$/;

function normalizarHost(host) {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function validarAmbienteIntegracao(ambiente) {
  if (ambiente.TEST_ENVIRONMENT !== "integration") {
    throw new Error("Defina TEST_ENVIRONMENT=integration para executar esta suíte.");
  }

  const uri = ambiente.TEST_MONGO_URI?.trim();
  if (!uri) {
    throw new Error("A variável TEST_MONGO_URI é obrigatória.");
  }

  let url;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("TEST_MONGO_URI precisa ser um URI MongoDB válido.");
  }

  if (!new Set(["mongodb:", "mongodb+srv:"]).has(url.protocol)) {
    throw new Error("TEST_MONGO_URI precisa usar o protocolo MongoDB.");
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
    .map(normalizarHost)
    .filter(Boolean);
  const hostMongo = normalizarHost(url.hostname);

  if (!hostsPermitidos.length || hostsPermitidos.includes("*")) {
    throw new Error("TEST_MONGO_ALLOWED_HOSTS deve conter hosts explícitos.");
  }
  if (!hostMongo || !hostsPermitidos.includes(hostMongo)) {
    throw new Error("O host de TEST_MONGO_URI não está na allowlist.");
  }

  const cloudinary = {};
  for (const nome of VARIAVEIS_CLOUDINARY) {
    const valor = ambiente[nome]?.trim();
    if (!valor) {
      throw new Error(`A variável ${nome} é obrigatória para a suíte de integração.`);
    }
    cloudinary[nome] = valor;
  }

  return { uri, bancoBase, hostMongo, hostsPermitidos, cloudinary };
}

export function carregarAmbienteIntegracao(ambiente = process.env) {
  dotenvConfig({
    path: resolve(process.cwd(), ".env.integration"),
    override: false,
    quiet: true,
  });

  return validarAmbienteIntegracao(ambiente);
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
  delete ambiente.MONGO_URI;
  delete ambiente.JWT_SECRET;
  delete ambiente.CLOUDINARY_CLOUD_NAME;
  delete ambiente.CLOUDINARY_API_KEY;
  delete ambiente.CLOUDINARY_API_SECRET;

  ambiente.CLOUDINARY_CLOUD_NAME = config.cloudinary.TEST_CLOUDINARY_CLOUD_NAME;
  ambiente.CLOUDINARY_API_KEY = config.cloudinary.TEST_CLOUDINARY_API_KEY;
  ambiente.CLOUDINARY_API_SECRET = config.cloudinary.TEST_CLOUDINARY_API_SECRET;
  ambiente.TEST_RUN_JWT_SECRET ??= randomBytes(32).toString("base64");
  ambiente.JWT_SECRET = ambiente.TEST_RUN_JWT_SECRET;
}
