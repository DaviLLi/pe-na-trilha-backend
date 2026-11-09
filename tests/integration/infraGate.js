import {
  validarDestinosSrvEstaveis,
  verificarTopologiaMongo,
} from "./topologia.js";

export async function conectarComGateDeInfra({
  uri,
  hostsPermitidos,
  runId,
  conectar,
  desconectar,
  resolver,
}) {
  let conexaoTentada = false;

  try {
    await validarDestinosSrvEstaveis(uri, hostsPermitidos, resolver);
    conexaoTentada = true;
    const db = await conectar();
    const topologia = await verificarTopologiaMongo(db, hostsPermitidos);
    const marcador = await db.collection("__integration_run").findOne({
      _id: runId,
      environment: "integration",
    });

    if (
      !marcador ||
      marcador._id !== runId ||
      marcador.environment !== "integration" ||
      !(marcador.createdAt instanceof Date)
    ) {
      throw new Error("O marcador da execução de integração não foi encontrado.");
    }

    return { db, topologia, marcador };
  } catch (erro) {
    if (conexaoTentada) {
      try {
        await desconectar();
      } catch {
        throw new Error("Não foi possível encerrar a conexão após falha no gate de integração.");
      }
    }

    throw erro;
  }
}
