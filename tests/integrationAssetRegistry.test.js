import { jest } from "@jest/globals";
import {
  limparAssetsRegistrados,
  registrarAssetDaExecucao,
  validarCoberturaAssetsOperacao,
  validarRegistrosAssets,
} from "./integration/registroAssets.js";

const runId = "a".repeat(32);
const outroRunId = "b".repeat(32);
const publicIdRegistrado = "pe-na-trilha/perfis/123e4567-e89b-12d3-a456-426614174000";
const publicIdNaoRegistrado = "pe-na-trilha/perfis/123e4567-e89b-12d3-a456-426614174001";

describe("registro explícito de assets da execução", () => {
  let runIdAnterior;

  beforeEach(() => {
    runIdAnterior = process.env.TEST_RUN_ID;
    process.env.TEST_RUN_ID = runId;
  });

  afterEach(() => {
    if (runIdAnterior === undefined) delete process.env.TEST_RUN_ID;
    else process.env.TEST_RUN_ID = runIdAnterior;
  });

  test("registra somente o asset associado ao run atual", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const markerFindOne = jest.fn().mockResolvedValue({
      _id: runId,
      environment: "integration",
      createdAt,
    });
    const operationFindOne = jest.fn().mockResolvedValue({
      publicId: publicIdRegistrado,
      estado: "completed",
      createdAt: new Date(createdAt.getTime() + 1),
      concluidoEm: new Date(createdAt.getTime() + 2),
    });
    const updateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    const db = {
      collection: jest.fn((name) => {
        if (name === "__integration_run") return { findOne: markerFindOne };
        if (name === "operacaoimagems") return { findOne: operationFindOne };
        return { updateOne };
      }),
    };

    await registrarAssetDaExecucao(db, runId, publicIdRegistrado);

    expect(markerFindOne).toHaveBeenCalledWith({ _id: runId, environment: "integration" });
    expect(operationFindOne).toHaveBeenCalledWith({
      publicId: publicIdRegistrado,
      estado: "completed",
      createdAt: { $gte: createdAt },
      concluidoEm: { $type: "date" },
    });
    expect(updateOne).toHaveBeenCalledWith(
      { runId, publicId: publicIdRegistrado },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ estado: "pending" }) }),
      { upsert: true },
    );
  });

  test("rejeita runId diferente do TEST_RUN_ID ativo sem consultar ou registrar asset", async () => {
    const collection = jest.fn();
    const db = { collection };

    await expect(registrarAssetDaExecucao(db, outroRunId, publicIdRegistrado))
      .rejects.toThrow("O identificador do asset não corresponde à execução de integração ativa.");

    expect(collection).not.toHaveBeenCalled();
  });

  test("rejeita a ausência do marcador antes de consultar operações ou registrar asset", async () => {
    const markerFindOne = jest.fn().mockResolvedValue(null);
    const collection = jest.fn((name) => name === "__integration_run"
      ? { findOne: markerFindOne }
      : { findOne: jest.fn(), updateOne: jest.fn() });
    const db = { collection };

    await expect(registrarAssetDaExecucao(db, runId, publicIdRegistrado))
      .rejects.toThrow("O marcador da execução de integração não foi encontrado.");

    expect(markerFindOne).toHaveBeenCalledTimes(1);
    expect(collection).toHaveBeenCalledTimes(1);
  });

  test("rejeita publicId antigo sem operação de upload concluída nesta execução", async () => {
    const markerFindOne = jest.fn().mockResolvedValue({
      _id: runId,
      environment: "integration",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const operationFindOne = jest.fn().mockResolvedValue(null);
    const updateOne = jest.fn();
    const db = {
      collection: jest.fn((name) => {
        if (name === "__integration_run") return { findOne: markerFindOne };
        if (name === "operacaoimagems") return { findOne: operationFindOne };
        return { updateOne };
      }),
    };

    await expect(registrarAssetDaExecucao(db, runId, publicIdRegistrado))
      .rejects.toThrow("O asset não foi criado por um upload concluído nesta execução.");
    expect(updateOne).not.toHaveBeenCalled();
  });

  test("não exclui IDs de operações que não foram registrados", async () => {
    const registros = [{ _id: "registro-1", runId, publicId: publicIdRegistrado, estado: "pending" }];
    const find = jest.fn(() => ({ toArray: async () => registros }));
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const excluirImagem = jest.fn().mockResolvedValue(undefined);
    const db = { collection: jest.fn(() => ({ find, updateOne })) };

    expect(() => validarCoberturaAssetsOperacao(
      [publicIdRegistrado, publicIdNaoRegistrado],
      registros,
      runId,
    )).toThrow("Há operações de imagem sem registro explícito de asset nesta execução.");

    await limparAssetsRegistrados(db, runId, excluirImagem);

    expect(excluirImagem).toHaveBeenCalledTimes(1);
    expect(excluirImagem).toHaveBeenCalledWith(publicIdRegistrado);
    expect(excluirImagem).not.toHaveBeenCalledWith(publicIdNaoRegistrado);
  });

  test("mantém o registro quando a exclusão falha para permitir nova tentativa", async () => {
    const registros = [{ _id: "registro-1", runId, publicId: publicIdRegistrado, estado: "pending" }];
    const find = jest.fn(() => ({ toArray: async () => registros }));
    const updateOne = jest.fn();
    const db = { collection: jest.fn(() => ({ find, updateOne })) };
    const excluirImagem = jest.fn().mockRejectedValue(new Error("falha remota"));

    await expect(limparAssetsRegistrados(db, runId, excluirImagem)).rejects.toThrow("falha remota");
    expect(updateOne).not.toHaveBeenCalled();
    expect(registros[0].estado).toBe("pending");
  });

  test("retoma após falha no terceiro asset sem excluir novamente os dois já confirmados", async () => {
    const registros = [1, 2, 3].map((numero) => ({
      _id: `registro-${numero}`,
      runId,
      publicId: `pe-na-trilha/perfis/123e4567-e89b-12d3-a456-42661417400${numero}`,
      estado: "pending",
    }));
    const find = jest.fn(() => ({ toArray: async () => registros }));
    const updateOne = jest.fn(async (filtro, atualizacao) => {
      const registro = registros.find(({ _id }) => _id === filtro._id);
      if (registro?.estado !== filtro.estado) return { modifiedCount: 0 };
      registro.estado = atualizacao.$set.estado;
      return { modifiedCount: 1 };
    });
    const db = { collection: jest.fn(() => ({ find, updateOne })) };
    const chamadas = [];
    let falharTerceiro = true;
    const excluirImagem = jest.fn(async (publicId) => {
      chamadas.push(publicId);
      if (publicId === registros[2].publicId && falharTerceiro) {
        falharTerceiro = false;
        throw new Error("falha remota intermediária");
      }
    });

    await expect(limparAssetsRegistrados(db, runId, excluirImagem))
      .rejects.toThrow("falha remota intermediária");
    expect(registros.map(({ estado }) => estado)).toEqual(["deleted", "deleted", "pending"]);

    await limparAssetsRegistrados(db, runId, excluirImagem);

    expect(chamadas).toEqual([
      registros[0].publicId,
      registros[1].publicId,
      registros[2].publicId,
      registros[2].publicId,
    ]);
    expect(registros.map(({ estado }) => estado)).toEqual(["deleted", "deleted", "deleted"]);
  });

  test("não chama Cloudinary novamente para asset já confirmado como excluído", async () => {
    const registros = [{ _id: "registro-1", runId, publicId: publicIdRegistrado, estado: "deleted" }];
    const find = jest.fn(() => ({ toArray: async () => registros }));
    const updateOne = jest.fn();
    const db = { collection: jest.fn(() => ({ find, updateOne })) };
    const excluirImagem = jest.fn();

    await limparAssetsRegistrados(db, runId, excluirImagem);

    expect(excluirImagem).not.toHaveBeenCalled();
  });

  test("rejeita registro de outra execução antes de iniciar a limpeza", () => {
    expect(() => validarRegistrosAssets([{
      runId: "b".repeat(32),
      publicId: publicIdRegistrado,
      estado: "pending",
    }], runId)).toThrow("O registro de assets contém dados de outra execução.");
  });
});
