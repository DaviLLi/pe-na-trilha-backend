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

function registrarDiagnostico(etapa, erro) {
  const diagnostico = {
    etapa,
    name: campoSeguro(erro?.name) || "Error",
  };
  const code = campoSeguro(erro?.code);
  const codeName = campoSeguro(erro?.codeName);
  if (code !== undefined) diagnostico.code = code;
  if (codeName !== undefined) diagnostico.codeName = codeName;

  try {
    console.error(JSON.stringify(diagnostico));
  } catch {
    // Uma falha de logging não deve substituir o erro que interrompeu o setup.
  }
}

export default async function globalSetup() {
  const config = carregarAmbienteIntegracao();
  const banco = validarBancoDaExecucao(process.env, config);
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
