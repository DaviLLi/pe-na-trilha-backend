import mongoose from "mongoose";
import {
  carregarAmbienteIntegracao,
  validarBancoDaExecucao,
} from "./ambiente.js";
import { conectarComGateDeInfra } from "./infraGate.js";

const config = carregarAmbienteIntegracao();
const bancoExecucao = validarBancoDaExecucao(process.env);
const idExecucao = process.env.TEST_RUN_ID;

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
});
