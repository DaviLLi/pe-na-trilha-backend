import {
  carregarAmbienteIntegracao,
  validarBancoDaExecucao,
} from "./ambiente.js";
import mongoose from "mongoose";
import { conectarAposValidarSrv, executarAposValidarTopologia } from "./topologia.js";

export default async function globalSetup() {
  const config = carregarAmbienteIntegracao();
  const banco = validarBancoDaExecucao(process.env, config);

  try {
    await conectarAposValidarSrv(
      config.uri,
      config.hostsPermitidos,
      () => mongoose.connect(config.uri, { dbName: banco }),
    );
    const db = mongoose.connection.db;
    await executarAposValidarTopologia(db, config.hostsPermitidos, async () => {
      const colecoes = (await db.listCollections().toArray())
        .map(({ name }) => name)
        .filter((name) => !name.startsWith("system."));
      if (colecoes.length) {
        throw new Error("A base aleatória da execução não está vazia.");
      }

      await db.createCollection("__integration_run");
      await db.collection("__integration_run").insertOne({
        _id: process.env.TEST_RUN_ID,
        environment: "integration",
        createdAt: new Date(),
      });
    });
  } catch {
    throw new Error("Não foi possível validar e reservar a base isolada de integração.");
  } finally {
    await mongoose.disconnect();
  }
}
