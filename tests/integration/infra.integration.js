import mongoose from "mongoose";
import {
  carregarAmbienteIntegracao,
  validarBancoDaExecucao,
} from "./ambiente.js";
import { verificarTopologiaMongo } from "./topologia.js";

const config = carregarAmbienteIntegracao();
const bancoExecucao = validarBancoDaExecucao(process.env, config);
const idExecucao = process.env.TEST_RUN_ID;

describe("infraestrutura MongoDB de integração", () => {
  let db;

  beforeAll(async () => {
    await mongoose.connect(config.uri, { dbName: bancoExecucao });
    db = mongoose.connection.db;
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  test("conecta somente à base isolada e confirma replica set ou mongos", async () => {
    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toBe(bancoExecucao);

    const hello = await verificarTopologiaMongo(db, config.hostsPermitidos);
    expect(hello.setName).toBeTruthy();

    const colecoesExistentes = (await db.listCollections().toArray())
      .map(({ name }) => name)
      .filter((name) => !name.startsWith("system."));
    expect(colecoesExistentes).toEqual(["__integration_run"]);
    expect(await db.collection("__integration_run").findOne({
      _id: idExecucao,
      environment: "integration",
    })).not.toBeNull();
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
