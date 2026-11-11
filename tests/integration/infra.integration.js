import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import cloudinary, { configurarCloudinary } from "../../src/config/cloudinary.js";
import {
  criarPublicIdFotoPerfil,
  enviarImagem,
  excluirImagem,
} from "../../src/services/cloudinaryService.js";
import {
  carregarAmbienteIntegracao,
  validarBancoDaExecucao,
} from "./ambiente.js";
import { conectarComGateDeInfra } from "./infraGate.js";
import { registrarAssetDaExecucao } from "./registroAssets.js";

const config = carregarAmbienteIntegracao();
const bancoExecucao = validarBancoDaExecucao(process.env);
const idExecucao = process.env.TEST_RUN_ID;

function criarResposta() {
  return {
    codigo: undefined,
    corpo: undefined,
    status(codigo) {
      this.codigo = codigo;
      return this;
    },
    json(corpo) {
      this.corpo = corpo;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
  };
}

async function registrarOperacoesDaExecucao(db, OperacaoImagem, desde) {
  const operacoes = await OperacaoImagem.find({ createdAt: { $gte: desde } }).lean();
  for (const operacao of operacoes) {
    if (["completed", "cleanup_pending"].includes(operacao.estado)) {
      await registrarAssetDaExecucao(db, idExecucao, operacao.publicId);
    }
  }
}

describe("infraestrutura MongoDB de integração", () => {
  let db;
  let topologia;
  let marcador;
  let conectado = false;

  beforeAll(async () => {
    const infraestrutura = await conectarComGateDeInfra({
      uri: config.uri,
      hostsPermitidos: config.hostsPermitidos,
      runId: idExecucao,
      conectar: async () => {
        await mongoose.connect(config.uri, { dbName: bancoExecucao });
        return mongoose.connection.db;
      },
      desconectar: () => mongoose.disconnect(),
    });

    db = infraestrutura.db;
    topologia = infraestrutura.topologia;
    marcador = infraestrutura.marcador;
    conectado = true;
  });

  afterAll(async () => {
    if (conectado) {
      await mongoose.disconnect();
    }
  });

  test("conecta somente à base isolada e confirma replica set ou mongos", async () => {
    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toBe(bancoExecucao);

    expect(topologia.setName).toBeTruthy();
    expect(marcador).toMatchObject({ _id: idExecucao, environment: "integration" });

    const colecoesExistentes = (await db.listCollections().toArray())
      .map(({ name }) => name)
      .filter((name) => !name.startsWith("system."));
    expect(colecoesExistentes).toEqual(["__integration_run"]);
    expect(marcador.createdAt).toBeInstanceOf(Date);
  });

  test("persiste commit e confirma rollback consultando o estado no banco", async () => {
    const nomeColecao = `integration_probe_${idExecucao}`;
    await db.createCollection(nomeColecao);
    const colecao = db.collection(nomeColecao);
    const idCommit = new mongoose.Types.ObjectId();
    const idRollback = new mongoose.Types.ObjectId();
    const sessao = await mongoose.startSession();

    try {
      await sessao.withTransaction(async () => {
        await colecao.insertOne({ _id: idCommit, runId: idExecucao }, { session: sessao });
      });

      expect(await colecao.findOne({ _id: idCommit })).toMatchObject({
        _id: idCommit,
        runId: idExecucao,
      });

      const erroRollback = new Error("rollback esperado");
      await expect(
        sessao.withTransaction(async () => {
          await colecao.insertOne({ _id: idRollback, runId: idExecucao }, { session: sessao });
          throw erroRollback;
        }),
      ).rejects.toBe(erroRollback);

      expect(await colecao.findOne({ _id: idRollback })).toBeNull();
      await colecao.deleteOne({ _id: idCommit, runId: idExecucao });
      expect(await colecao.findOne({ _id: idCommit })).toBeNull();
    } finally {
      await sessao.endSession();
    }
  });

  test("envia e exclui uma imagem real no Cloudinary com limpeza registrada", async () => {
    expect(configurarCloudinary()).toBe(true);

    const { default: OperacaoImagem } = await import("../../src/models/OperacaoImagem.js");
    await OperacaoImagem.init();

    const publicId = criarPublicIdFotoPerfil();
    const imagemPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzN8AAAAASUVORK5CYII=",
      "base64",
    );
    const operacao = await OperacaoImagem.create({
      publicId,
      estado: "cleanup_pending",
      nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    // Registre antes do upload: se o teste falhar ou for interrompido, o teardown
    // ainda terá autorização persistente para excluir exatamente este publicId.
    await registrarAssetDaExecucao(db, idExecucao, publicId);

    let tentativaUpload = false;
    let exclusaoConfirmada = false;
    try {
      tentativaUpload = true;
      const resultadoUpload = await enviarImagem(imagemPng, publicId);
      expect(resultadoUpload).toMatchObject({ publicId });
      expect(resultadoUpload.secureUrl).toMatch(/^https:\/\/res\.cloudinary\.com\//);

      const recursoCriado = await cloudinary.api.resource(publicId, { resource_type: "image" });
      expect(recursoCriado.public_id).toBe(publicId);

      await excluirImagem(publicId);

      let erroConsulta;
      try {
        await cloudinary.api.resource(publicId, { resource_type: "image" });
      } catch (erro) {
        erroConsulta = erro;
      }
      expect(erroConsulta).toBeDefined();
      expect(erroConsulta.error?.http_code).toBe(404);

      await OperacaoImagem.updateOne(
        { _id: operacao._id, publicId, estado: "cleanup_pending" },
        { $set: { estado: "completed", concluidoEm: new Date(), nextAttemptAt: null } },
      );
      exclusaoConfirmada = true;
    } finally {
      if (tentativaUpload && !exclusaoConfirmada) {
        try {
          await excluirImagem(publicId);
        } catch {
          // A operação e o registro permanecem pendentes para nova tentativa no teardown.
        }
      }
    }
  }, 120000);

  test("executa fluxos reais de perfil e concorrência/remoção de fotos de trilha", async () => {
    expect(configurarCloudinary()).toBe(true);
    const { default: Usuario } = await import("../../src/models/Usuario.js");
    const { default: Trilha } = await import("../../src/models/Trilha.js");
    const { default: OperacaoImagem } = await import("../../src/models/OperacaoImagem.js");
    const { removerFotoPerfil, substituirFotoPerfil } = await import(
      "../../src/controllers/fotoPerfilController.js"
    );
    const { adicionarFotoTrilha, removerFotoTrilha } = await import(
      "../../src/controllers/fotoTrilhaController.js"
    );
    await OperacaoImagem.init();

    const iniciouEm = new Date();
    const imagemPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzN8AAAAASUVORK5CYII=",
      "base64",
    );
    let usuario;
    let trilha;

    try {
      usuario = await Usuario.create({
        nomeCompleto: "Usuário Integração Imagens",
        nomeUsuario: randomUUID()
          .replaceAll("-", "")
          .split("")
          .map((caractere) => String.fromCharCode(97 + Number.parseInt(caractere, 16)))
          .join(""),
        email: `${randomUUID()}@example.test`,
        senha: "Trilha@123Ab",
      });

      const primeiraFotoPerfil = criarResposta();
      await substituirFotoPerfil(
        { usuario: { _id: usuario._id }, imagemValidada: imagemPng },
        primeiraFotoPerfil,
        (erro) => { throw erro; },
      );
      await registrarOperacoesDaExecucao(db, OperacaoImagem, iniciouEm);
      expect(primeiraFotoPerfil.codigo).toBe(200);
      expect(primeiraFotoPerfil.corpo).toHaveProperty("fotoPerfil");

      const segundaFotoPerfil = criarResposta();
      await substituirFotoPerfil(
        { usuario: { _id: usuario._id }, imagemValidada: imagemPng },
        segundaFotoPerfil,
        (erro) => { throw erro; },
      );
      await registrarOperacoesDaExecucao(db, OperacaoImagem, iniciouEm);
      expect(segundaFotoPerfil.codigo).toBe(200);

      const fotoPerfilRemovida = criarResposta();
      await removerFotoPerfil(
        { usuario: { _id: usuario._id } },
        fotoPerfilRemovida,
        (erro) => { throw erro; },
      );
      await registrarOperacoesDaExecucao(db, OperacaoImagem, iniciouEm);
      expect(fotoPerfilRemovida.codigo).toBe(200);
      expect((await Usuario.findById(usuario._id)).fotoPerfil).toBeNull();

      trilha = await Trilha.create({
        titulo: "Trilha integração de imagens",
        descricao: "Fixture isolada para concorrência de fotos.",
        endereco: "Ambiente de teste",
        proprietario: usuario._id,
        fotos: Array.from({ length: 4 }, (_, indice) => ({
          url: `https://example.test/fixture-${indice}.jpg`,
          publicId: `fixture/${idExecucao}/${indice}`,
        })),
      });

      const respostasAdicao = [criarResposta(), criarResposta()];
      await Promise.all(respostasAdicao.map((res) => adicionarFotoTrilha(
        {
          params: { id: trilha._id.toString() },
          usuario: { _id: usuario._id },
          imagemValidada: imagemPng,
        },
        res,
        (erro) => { throw erro; },
      )));
      await registrarOperacoesDaExecucao(db, OperacaoImagem, iniciouEm);

      expect(respostasAdicao.map((res) => res.codigo).sort()).toEqual([201, 409]);
      const respostaVencedora = respostasAdicao.find((res) => res.codigo === 201);
      const trilhaComCincoFotos = await Trilha.findById(trilha._id);
      expect(trilhaComCincoFotos.fotos).toHaveLength(5);

      const respostaRemocao = criarResposta();
      await removerFotoTrilha(
        {
          params: { id: trilha._id.toString(), fotoId: respostaVencedora.corpo._id.toString() },
          usuario: { _id: usuario._id },
        },
        respostaRemocao,
        (erro) => { throw erro; },
      );
      await registrarOperacoesDaExecucao(db, OperacaoImagem, iniciouEm);
      expect(respostaRemocao.codigo).toBe(204);
      expect((await Trilha.findById(trilha._id)).fotos).toHaveLength(4);
    } finally {
      await registrarOperacoesDaExecucao(db, OperacaoImagem, iniciouEm);
    }
  }, 180000);
});
