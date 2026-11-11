import {
  carregarAmbienteIntegracao,
  validarBancoDaExecucao,
} from "./ambiente.js";
import mongoose from "mongoose";
import { conectarAposValidarSrv, executarAposValidarTopologia } from "./topologia.js";

function campoSeguro(valor) {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(valor)) return valor;
  return undefined;
}

function identificarTipoFalha(erro) {
  const nome = String(erro?.name || "").toLowerCase();
  const code = String(erro?.code || "").toUpperCase();
  const codeName = String(erro?.codeName || "").toLowerCase();

  if (Number(erro?.code) === 18 || /authentication|authfailed/.test(codeName) || /authentication/.test(nome)) {
    return "autenticacao";
  }
  if (/tls|ssl|certificate|cert_/.test(`${nome} ${code} ${codeName}`)) {
    return "tls_certificado";
  }
  if (/^(ENOTFOUND|EAI_AGAIN|EAI_FAIL|DNS_)/.test(code) || /dns/.test(nome)) {
    return "dns";
  }
  if (/TIMEOUT|TIMEDOUT/.test(code) || /timeout/.test(nome)) {
    return "timeout";
  }
  if (/^(ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE)$/.test(code) || /network/.test(nome)) {
    return "rede";
  }
  if (/serverselection/.test(nome)) {
    return "selecao_servidor";
  }
  return "outro";
}

function coletarFalhasRelacionadas(erro) {
  const falhas = [];
  const visitados = new Set();
  const limiteFalhas = 32;

  function visitar(erroAtual, profundidade = 0) {
    if (
      !erroAtual ||
      typeof erroAtual !== "object" ||
      visitados.has(erroAtual) ||
      profundidade > 8 ||
      falhas.length >= limiteFalhas
    ) {
      return;
    }
    visitados.add(erroAtual);

    const falha = {
      name: campoSeguro(erroAtual.name) || "Error",
      tipoFalha: identificarTipoFalha(erroAtual),
    };
    const code = campoSeguro(erroAtual.code);
    const codeName = campoSeguro(erroAtual.codeName);
    if (code !== undefined) falha.code = code;
    if (codeName !== undefined) falha.codeName = codeName;
    falhas.push(falha);

    visitar(erroAtual.cause, profundidade + 1);

    const servidores = erroAtual.reason?.servers;
    if (servidores && typeof servidores.values === "function") {
      for (const servidor of servidores.values()) {
        visitar(servidor?.error, profundidade + 1);
        if (falhas.length >= limiteFalhas) break;
      }
    }
  }

  visitar(erro);
  return falhas;
}

function registrarDiagnostico(etapa, erro) {
  const diagnostico = {
    etapa,
    name: campoSeguro(erro?.name) || "Error",
  };
  const code = campoSeguro(erro?.code);
  const codeName = campoSeguro(erro?.codeName);
  if (code !== undefined) diagnostico.code = code;
  if (codeName !== undefined) diagnostico.codeName = codeName;
  const tipoFalha = identificarTipoFalha(erro);
  if (tipoFalha !== "outro") diagnostico.tipoFalha = tipoFalha;

  const falhasRelacionadas = coletarFalhasRelacionadas(erro);
  if (falhasRelacionadas.length > 1) diagnostico.falhasRelacionadas = falhasRelacionadas;

  try {
    console.error(JSON.stringify(diagnostico));
  } catch {
    // Uma falha de logging não deve substituir o erro que interrompeu o setup.
  }
}

export default async function globalSetup() {
  const config = carregarAmbienteIntegracao();
  const banco = validarBancoDaExecucao(process.env);
  let etapa = "preflight e validação SRV";
  let erroOriginal;
  let ocorreuErroOriginal = false;
  let erroDesconexao;

  try {
    await conectarAposValidarSrv(
      config.uri,
      config.hostsPermitidos,
      () => {
        etapa = "conexão MongoDB";
        return mongoose.connect(config.uri, { dbName: banco });
      },
    );
    const db = mongoose.connection.db;
    etapa = "validação da topologia";
    await executarAposValidarTopologia(db, config.hostsPermitidos, async () => {
      etapa = "verificação de banco vazio";
      const colecoes = (await db.listCollections().toArray())
        .map(({ name }) => name)
        .filter((name) => !name.startsWith("system."));
      if (colecoes.length) {
        throw new Error("A base aleatória da execução não está vazia.");
      }

      etapa = "criação do marcador";
      await db.createCollection("__integration_run");
      await db.collection("__integration_run").insertOne({
        _id: process.env.TEST_RUN_ID,
        environment: "integration",
        createdAt: new Date(),
      });
    });
  } catch (erro) {
    erroOriginal = erro;
    ocorreuErroOriginal = true;
    registrarDiagnostico(etapa, erro);
  } finally {
    try {
      await mongoose.disconnect();
    } catch (erro) {
      erroDesconexao = erro;
      registrarDiagnostico("desconexão MongoDB", erro);
    }
  }

  if (ocorreuErroOriginal || erroDesconexao) {
    const causa = ocorreuErroOriginal ? erroOriginal : erroDesconexao;
    const etapaFalha = ocorreuErroOriginal ? etapa : "desconexão MongoDB";
    throw new Error(
      `Não foi possível validar e reservar a base isolada de integração. Banco: ${banco}. Etapa: ${etapaFalha}.`,
      { cause: causa },
    );
  }
}
