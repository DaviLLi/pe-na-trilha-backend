const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PUBLIC_ID_GERADO = new RegExp(
  `^pe-na-trilha/(?:perfis/${UUID}|trilhas/[0-9a-f]{24}/${UUID})$`,
  "i",
);
const ID_EXECUCAO_VALIDO = /^[a-f0-9]{32}$/;
const NOME_COLECAO_OPERACOES = "operacaoimagems";

export function validarPublicIdDaExecucao(publicId) {
  if (typeof publicId !== "string" || !PUBLIC_ID_GERADO.test(publicId)) {
    throw new Error("O asset não possui publicId gerado pela aplicação.");
  }
  return publicId;
}

export async function registrarAssetDaExecucao(db, runId, publicId) {
  const runIdAtivo = process.env.TEST_RUN_ID || "";
  if (!ID_EXECUCAO_VALIDO.test(runId || "") || runId !== runIdAtivo) {
    throw new Error("O identificador do asset não corresponde à execução de integração ativa.");
  }

  validarPublicIdDaExecucao(publicId);
  const marcador = await db.collection("__integration_run").findOne({
    _id: runIdAtivo,
    environment: "integration",
  });
  if (!marcador || !(marcador.createdAt instanceof Date)) {
    throw new Error("O marcador da execução de integração não foi encontrado.");
  }

  const operacaoUpload = await db.collection(NOME_COLECAO_OPERACOES).findOne({
    publicId,
    estado: "completed",
    createdAt: { $gte: marcador.createdAt },
    concluidoEm: { $type: "date" },
  });
  if (!operacaoUpload) {
    throw new Error("O asset não foi criado por um upload concluído nesta execução.");
  }

  await db.collection("__integration_assets").updateOne(
    { runId: runIdAtivo, publicId },
    {
      $setOnInsert: {
        runId: runIdAtivo,
        publicId,
        estado: "pending",
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export function validarCoberturaAssetsOperacao(publicIdsOperacao, registros, runId) {
  const registrados = new Set(
    registros
      .filter((registro) => registro.runId === runId)
      .map((registro) => registro.publicId),
  );
  const semRegistro = publicIdsOperacao.filter((publicId) => !registrados.has(publicId));

  if (semRegistro.length) {
    throw new Error("Há operações de imagem sem registro explícito de asset nesta execução.");
  }
}

export function validarRegistrosAssets(registros, runId) {
  if (registros.some((registro) => registro.runId !== runId)) {
    throw new Error("O registro de assets contém dados de outra execução.");
  }
  for (const registro of registros) {
    validarPublicIdDaExecucao(registro.publicId);
    if (!["pending", "deleted"].includes(registro.estado)) {
      throw new Error("O registro de assets contém um estado inválido.");
    }
  }
}

export async function limparAssetsRegistrados(db, runId, excluirImagem) {
  const colecao = db.collection("__integration_assets");
  const registros = await colecao.find({ runId }).toArray();
  validarRegistrosAssets(registros, runId);

  for (const registro of registros) {
    if (registro.estado === "deleted") continue;

    await excluirImagem(registro.publicId);
    const resultado = await colecao.updateOne(
      { _id: registro._id, runId, publicId: registro.publicId, estado: "pending" },
      { $set: { estado: "deleted", deletedAt: new Date() } },
    );
    if (resultado.modifiedCount !== 1) {
      throw new Error("Não foi possível confirmar o estado de limpeza do asset registrado.");
    }
  }
}
