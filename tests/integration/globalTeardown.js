import mongoose from "mongoose";
import {
  carregarAmbienteIntegracao,
  prepararAmbienteAplicacao,
  validarBancoDaExecucao,
} from "./ambiente.js";
import { excluirImagem } from "../../src/services/cloudinaryService.js";
import { conectarAposValidarSrv, executarAposValidarTopologia } from "./topologia.js";
import {
  limparAssetsRegistrados,
  validarMarcadorDaExecucao,
  validarCoberturaAssetsOperacao,
  validarRegistrosAssets,
} from "./registroAssets.js";
import { mensagemRecuperacaoIntegracao } from "./mensagemRecuperacao.js";

const COLECOES_SISTEMA = /^system\./;

export default async function globalTeardown() {
  let conectado = false;
  let erroLimpeza;
  let bancoExecucao;

  try {
    const config = carregarAmbienteIntegracao();
    bancoExecucao = validarBancoDaExecucao(process.env, config);
    prepararAmbienteAplicacao(process.env, config);

    await conectarAposValidarSrv(
      config.uri,
      config.hostsPermitidos,
      () => mongoose.connect(config.uri, { dbName: bancoExecucao }),
    );
    conectado = true;
    const db = mongoose.connection.db;
    await executarAposValidarTopologia(db, config.hostsPermitidos, async () => {
      await validarMarcadorDaExecucao(db, process.env.TEST_RUN_ID);

      // Só carregue o model após validar a topologia e o marcador completo: `autoIndex` pode escrever.
      const { default: OperacaoImagem } = await import("../../src/models/OperacaoImagem.js");
      await OperacaoImagem.init();

      const nomesColecoes = (await db.listCollections().toArray())
        .map(({ name }) => name)
        .filter((nome) => !COLECOES_SISTEMA.test(nome));
      const nomeColecaoOperacoes = nomesColecoes.find(
        (nome) => nome === OperacaoImagem.collection.name,
      );
      const publicIds = nomeColecaoOperacoes
        ? await db.collection(nomeColecaoOperacoes).distinct("publicId")
        : [];
      const nomeColecaoRegistro = "__integration_assets";
      const registrosAssets = nomesColecoes.includes(nomeColecaoRegistro)
        ? await db.collection(nomeColecaoRegistro).find({}).toArray()
        : [];
      validarRegistrosAssets(registrosAssets, process.env.TEST_RUN_ID);
      validarCoberturaAssetsOperacao(publicIds, registrosAssets, process.env.TEST_RUN_ID);

      // A base aleatória começou vazia; remova primeiro as referências criadas pelo run.
      for (const nome of nomesColecoes.filter(
        (item) => ![
          nomeColecaoOperacoes,
          nomeColecaoRegistro,
          "__integration_run",
        ].includes(item),
      )) {
        await db.collection(nome).deleteMany({});
      }

      await limparAssetsRegistrados(db, process.env.TEST_RUN_ID, excluirImagem);

      if (nomeColecaoOperacoes) {
        await db.collection(nomeColecaoOperacoes).deleteMany({});
      }
      if (nomesColecoes.includes(nomeColecaoRegistro)) {
        await db.collection(nomeColecaoRegistro).deleteMany({ runId: process.env.TEST_RUN_ID });
      }
      await db.collection("__integration_run").deleteOne({
        _id: process.env.TEST_RUN_ID,
        environment: "integration",
      });
    });
  } catch {
    erroLimpeza = new Error(mensagemRecuperacaoIntegracao(bancoExecucao));
  } finally {
    if (conectado) {
      try {
        await mongoose.disconnect();
      } catch {
        erroLimpeza ||= new Error(mensagemRecuperacaoIntegracao(bancoExecucao));
      }
    }
  }

  if (erroLimpeza) {
    console.error(erroLimpeza.message);
    throw erroLimpeza;
  }
}
