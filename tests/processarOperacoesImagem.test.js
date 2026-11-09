import { jest } from "@jest/globals";

const excluirImagem = jest.fn();
jest.unstable_mockModule("../src/services/cloudinaryService.js", () => ({
  excluirImagem,
  criarPublicIdFotoPerfil: jest.fn(),
  enviarImagem: jest.fn(),
}));

const { default: OperacaoImagem } = await import("../src/models/OperacaoImagem.js");
const {
  processarUmaOperacao,
  recuperarOperacoesExpiradas,
  reenfileirarOperacaoImagem,
  iniciarProcessadorOperacoesImagem,
  pararProcessadorOperacoesImagem,
} = await import("../src/services/processarOperacoesImagem.js");

describe("processador de operações de imagem", () => {
  const nomesEnv = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];
  let envAnterior;

  beforeEach(() => {
    envAnterior = Object.fromEntries(nomesEnv.map((nome) => [nome, process.env[nome]]));
    for (const nome of nomesEnv) process.env[nome] = "teste";
    excluirImagem.mockReset();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    for (const nome of nomesEnv) {
      if (envAnterior[nome] === undefined) delete process.env[nome];
      else process.env[nome] = envAnterior[nome];
    }
  });

  test("só reivindica cleanup_pending e conclui com token de lease", async () => {
    const operacao = { _id: "op1", publicId: "server/asset", tentativas: 0 };
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue(operacao);
    const atualizar = jest.spyOn(OperacaoImagem, "updateOne").mockResolvedValue({ modifiedCount: 1 });
    excluirImagem.mockResolvedValue(undefined);

    await expect(processarUmaOperacao(new Date("2026-01-01T00:00:00Z"))).resolves.toBe(true);

    expect(OperacaoImagem.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "cleanup_pending" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "processing" }) }),
      { new: true },
    );
    expect(excluirImagem).toHaveBeenCalledWith("server/asset");
    expect(atualizar).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "op1", estado: "processing" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "completed" }) }),
    );
  });

  test("não processa upload nem outra operação quando não há cleanup pendente", async () => {
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue(null);
    await expect(processarUmaOperacao()).resolves.toBe(false);
    expect(excluirImagem).not.toHaveBeenCalled();
  });

  test("uma única reivindicação vence quando dois ciclos concorrem", async () => {
    const operacao = { _id: "op-unica", publicId: "server/asset", tentativas: 0 };
    const reivindicar = jest
      .spyOn(OperacaoImagem, "findOneAndUpdate")
      .mockResolvedValueOnce(operacao)
      .mockResolvedValueOnce(null);
    jest.spyOn(OperacaoImagem, "updateOne").mockResolvedValue({ modifiedCount: 1 });
    excluirImagem.mockResolvedValue(undefined);

    await expect(Promise.all([processarUmaOperacao(), processarUmaOperacao()])).resolves.toEqual([
      true,
      false,
    ]);

    expect(reivindicar).toHaveBeenCalledTimes(2);
    expect(excluirImagem).toHaveBeenCalledTimes(1);
  });

  test("mantém operação como failed após esgotar tentativas e registra erro", async () => {
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue({
      _id: "op-final",
      publicId: "server/asset",
      tentativas: 8,
    });
    const atualizar = jest.spyOn(OperacaoImagem, "updateOne").mockResolvedValue({ modifiedCount: 1 });
    excluirImagem.mockRejectedValue(new Error("detalhe remoto confidencial"));

    await processarUmaOperacao();

    expect(atualizar).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "op-final", estado: "processing" }),
      expect.objectContaining({
        $set: expect.objectContaining({ estado: "failed", ultimoErro: expect.any(String) }),
        $push: expect.objectContaining({ historicoTentativas: expect.any(Object) }),
      }),
    );
    expect(JSON.stringify(atualizar.mock.calls)).not.toContain("detalhe remoto confidencial");
  });

  test("recupera leases expirados de upload e processamento para cleanup_pending", async () => {
    const atualizar = jest.spyOn(OperacaoImagem, "updateMany").mockResolvedValue({ modifiedCount: 1 });
    const agora = new Date("2026-01-01T00:00:00Z");

    await recuperarOperacoesExpiradas(agora);

    expect(atualizar).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ estado: "uploading" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "cleanup_pending" }) }),
    );
    expect(atualizar).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ estado: "processing" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "cleanup_pending" }) }),
    );
  });

  test("permite reenfileirar uma operação falha sem apagá-la", async () => {
    const atualizar = jest
      .spyOn(OperacaoImagem, "findOneAndUpdate")
      .mockResolvedValue({ _id: "op-falha", estado: "cleanup_pending" });

    await reenfileirarOperacaoImagem("op-falha");

    expect(atualizar).toHaveBeenCalledWith(
      { _id: "op-falha", estado: "failed" },
      expect.objectContaining({ $set: expect.objectContaining({ estado: "cleanup_pending" }) }),
      { new: true },
    );
  });

  test("parar encerra o timer, aguarda o ciclo ativo e é idempotente", async () => {
    jest.useFakeTimers();
    let liberarRecuperacao;
    const recuperacaoPendente = new Promise((resolve) => {
      liberarRecuperacao = resolve;
    });
    jest
      .spyOn(OperacaoImagem, "updateMany")
      .mockReturnValueOnce(recuperacaoPendente)
      .mockResolvedValue({ modifiedCount: 0 });
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue(null);

    iniciarProcessadorOperacoesImagem();
    expect(jest.getTimerCount()).toBe(1);

    let finalizado = false;
    const parada = pararProcessadorOperacoesImagem().then(() => {
      finalizado = true;
    });
    const chamadaRepetida = pararProcessadorOperacoesImagem();
    expect(jest.getTimerCount()).toBe(0);
    expect(finalizado).toBe(false);

    liberarRecuperacao({ modifiedCount: 0 });
    await Promise.all([parada, chamadaRepetida]);
    expect(finalizado).toBe(true);
    expect(excluirImagem).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
