import { jest } from "@jest/globals";

const enviarImagem = jest.fn();
const criarPublicIdFotoTrilha = jest.fn(() => "pe-na-trilha/trilhas/t1/novo");
jest.unstable_mockModule("../src/services/cloudinaryService.js", () => ({
  enviarImagem,
  criarPublicIdFotoTrilha,
  criarPublicIdFotoPerfil: jest.fn(),
  excluirImagem: jest.fn(),
}));

const metadados = { assetId: "asset-verificado", resourceType: "image", deliveryType: "authenticated", version: 1, format: "webp", width: 800, height: 600, bytes: 100, storageState: "ready" };
const mongoose = (await import("mongoose")).default;
const { default: Trilha } = await import("../src/models/Trilha.js");
const { default: OperacaoImagem } = await import("../src/models/OperacaoImagem.js");
const {
  adicionarFotoTrilha,
  substituirFotoTrilha,
  removerFotoTrilha,
} = await import("../src/controllers/fotoTrilhaController.js");

function criarResposta() {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(),
    send: jest.fn(() => res),
  };
  return res;
}

describe("controller de fotos da trilha", () => {
  let sessao;

  beforeEach(() => {
    jest.restoreAllMocks();
    enviarImagem.mockReset();
    criarPublicIdFotoTrilha.mockReturnValue("pe-na-trilha/trilhas/t1/novo");
    sessao = {
      withTransaction: jest.fn((callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, "startSession").mockResolvedValue(sessao);
  });

  test("adiciona foto com filtro atômico de proprietário e limite e conclui operação", async () => {
    const idFoto = new mongoose.Types.ObjectId();
    const foto = {
      ...metadados,
      _id: idFoto,
      url: "https://res.cloudinary.com/demo/nova.webp",
      publicId: "pe-na-trilha/trilhas/t1/novo",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const trilha = { fotos: { id: jest.fn(() => foto) } };
    jest.spyOn(OperacaoImagem, "create").mockResolvedValue({ _id: "op-upload" });
    const renovar = jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue({ _id: "op-upload" });
    const atualizarOperacao = jest
      .spyOn(OperacaoImagem, "updateOne")
      .mockResolvedValue({ modifiedCount: 1 });
    const adicionar = jest.spyOn(Trilha, "findOneAndUpdate").mockResolvedValue(trilha);
    enviarImagem.mockResolvedValue({ ...metadados, publicId: foto.publicId });

    const req = {
      params: { id: "507f1f77bcf86cd799439011" },
      usuario: { _id: "507f1f77bcf86cd799439012" },
      imagemValidada: Buffer.from("imagem"),
    };
    const res = criarResposta();
    const next = jest.fn();
    await adicionarFotoTrilha(req, res, next);

    expect(adicionar).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: req.params.id,
        proprietario: req.usuario._id,
        status: { $in: ["pending", "rejected"] },
        $expr: { $lt: [{ $size: { $ifNull: ["$fotos", []] } }, 5] },
      }),
      { $push: { fotos: expect.objectContaining({ _id: expect.any(mongoose.Types.ObjectId) }) } },
      { returnDocument: "after", session: sessao },
    );
    expect(renovar).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "uploading", uploadLeaseToken: expect.any(String) }),
      expect.any(Object),
      { returnDocument: "after", session: sessao },
    );
    expect(atualizarOperacao).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "op-upload", estado: "uploading" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "completed" }) }),
      { session: sessao },
    );
    expect(enviarImagem).toHaveBeenCalledWith(req.imagemValidada, expect.any(String), { deliveryType: "authenticated" });
    expect(OperacaoImagem.create).toHaveBeenCalledWith(expect.objectContaining({ deliveryType: "authenticated", resourceType: "image" }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      _id: idFoto,
      url: `/trilhas/minhas/${req.params.id}/fotos/${idFoto}/conteudo`,
      width: 800, height: 600, storageState: "ready",
      createdAt: foto.createdAt,
      updatedAt: foto.updatedAt,
    });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(foto.publicId);
    expect(next).not.toHaveBeenCalled();
  });

  test("retorna 409 e agenda cleanup se perder a disputa pela quinta vaga", async () => {
    jest.spyOn(OperacaoImagem, "create").mockResolvedValue({ _id: "op-upload" });
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue({ _id: "op-upload" });
    jest.spyOn(OperacaoImagem, "updateOne").mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(Trilha, "findOneAndUpdate").mockResolvedValue(null);
    jest.spyOn(Trilha, "findOne").mockReturnValue({
      session: jest.fn().mockResolvedValue({ _id: "trilha-1" }),
    });
    enviarImagem.mockResolvedValue({
      ...metadados,
      publicId: "pe-na-trilha/trilhas/t1/novo",
    });

    const res = criarResposta();
    await adicionarFotoTrilha(
      {
        params: { id: "507f1f77bcf86cd799439011" },
        usuario: { _id: "507f1f77bcf86cd799439012" },
        imagemValidada: Buffer.from("imagem"),
      },
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "A trilha já possui o limite de 5 fotos." });
    expect(OperacaoImagem.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "op-upload", estado: "uploading" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "cleanup_pending" }) }),
    );
  });

  test("falha no upload sem consultar ou alterar a foto existente", async () => {
    jest.spyOn(OperacaoImagem, "create").mockResolvedValue({ _id: "op-upload" });
    const agendarLimpeza = jest
      .spyOn(OperacaoImagem, "updateOne")
      .mockResolvedValue({ modifiedCount: 1 });
    const buscarTrilha = jest.spyOn(Trilha, "findOne");
    enviarImagem.mockRejectedValue(new Error("erro privado do Cloudinary"));

    const res = criarResposta();
    await substituirFotoTrilha(
      {
        params: { id: "507f1f77bcf86cd799439011", fotoId: "507f1f77bcf86cd799439013" },
        usuario: { _id: "507f1f77bcf86cd799439012" },
        imagemValidada: Buffer.from("imagem"),
      },
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Não foi possível enviar a imagem." });
    expect(buscarTrilha).not.toHaveBeenCalled();
    expect(agendarLimpeza).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "op-upload", estado: "uploading" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "cleanup_pending" }) }),
    );
  });

  test("agenda limpeza se a transação falhar depois que o Cloudinary concluiu o upload", async () => {
    jest.spyOn(OperacaoImagem, "create").mockResolvedValue({ _id: "op-upload" });
    const agendarLimpeza = jest
      .spyOn(OperacaoImagem, "updateOne")
      .mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue({ _id: "op-upload" });
    sessao.withTransaction.mockRejectedValue(new Error("falha transacional interna"));
    enviarImagem.mockResolvedValue({
      ...metadados,
      publicId: "pe-na-trilha/trilhas/t1/novo",
    });
    const next = jest.fn();

    await adicionarFotoTrilha(
      {
        params: { id: "507f1f77bcf86cd799439011" },
        usuario: { _id: "507f1f77bcf86cd799439012" },
        imagemValidada: Buffer.from("imagem"),
      },
      criarResposta(),
      next,
    );

    expect(agendarLimpeza).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "op-upload", estado: "uploading" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "cleanup_pending" }) }),
    );
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test("substitui a foto sem trocar seu ID e agenda o public ID anterior na transação", async () => {
    const foto = {
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439013"),
      url: "https://res.cloudinary.com/demo/antiga.jpg",
      publicId: "pe-na-trilha/trilhas/t1/antiga",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const trilha = {
      fotos: { id: jest.fn(() => foto) },
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(OperacaoImagem, "create")
      .mockResolvedValueOnce({ _id: "op-upload" })
      .mockResolvedValueOnce([]);
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue({ _id: "op-upload" });
    jest.spyOn(OperacaoImagem, "updateOne").mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(Trilha, "findOne").mockReturnValue({ session: jest.fn().mockResolvedValue(trilha) });
    enviarImagem.mockResolvedValue({
      ...metadados,
      publicId: "pe-na-trilha/trilhas/t1/nova",
    });

    const res = criarResposta();
    await substituirFotoTrilha(
      {
        params: { id: "507f1f77bcf86cd799439011", fotoId: foto._id.toString() },
        usuario: { _id: "507f1f77bcf86cd799439012" },
        imagemValidada: Buffer.from("imagem"),
      },
      res,
      jest.fn(),
    );

    expect(foto._id.toString()).toBe("507f1f77bcf86cd799439013");
    expect(foto.url).toBeUndefined();
    expect(foto.deliveryType).toBe("authenticated");
    expect(foto.publicId).toBe("pe-na-trilha/trilhas/t1/nova");
    expect(trilha.save).toHaveBeenCalledWith({ session: sessao });
    expect(OperacaoImagem.create).toHaveBeenNthCalledWith(
      2,
      [{ publicId: "pe-na-trilha/trilhas/t1/antiga", resourceType: "image", deliveryType: "upload", estado: "cleanup_pending", nextAttemptAt: expect.any(Date) }],
      { session: sessao },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]._id).toBe(foto._id);
    expect(res.json.mock.calls[0][0]).not.toHaveProperty("publicId");
  });

  test("remove a foto e agenda sua limpeza na mesma transação", async () => {
    const foto = { publicId: "pe-na-trilha/trilhas/t1/foto" };
    const trilha = {
      fotos: { id: jest.fn(() => foto), pull: jest.fn() },
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(Trilha, "findOne").mockReturnValue({ session: jest.fn().mockResolvedValue(trilha) });
    const agendar = jest.spyOn(OperacaoImagem, "create").mockResolvedValue([]);
    const res = criarResposta();

    await removerFotoTrilha(
      {
        params: { id: "507f1f77bcf86cd799439011", fotoId: "507f1f77bcf86cd799439013" },
        usuario: { _id: "507f1f77bcf86cd799439012" },
      },
      res,
      jest.fn(),
    );

    expect(trilha.fotos.pull).toHaveBeenCalledWith({ _id: "507f1f77bcf86cd799439013" });
    expect(trilha.save).toHaveBeenCalledWith({ session: sessao });
    expect(agendar).toHaveBeenCalledWith(
      [{ publicId: foto.publicId, resourceType: "image", deliveryType: "upload", estado: "cleanup_pending", nextAttemptAt: expect.any(Date) }],
      { session: sessao },
    );
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

describe("aprovação concorrente durante operação de fotos", () => {
  afterEach(() => jest.restoreAllMocks());
  test.each(["adicionar", "substituir", "remover"])("%s revalida status no banco antes de persistir", async (acao) => {
    const sessao = { withTransaction: jest.fn((callback) => callback()), endSession: jest.fn() };
    jest.spyOn(mongoose, "startSession").mockResolvedValue(sessao);
    const filtros = [];
    const buscar = jest.spyOn(Trilha, "findOne").mockImplementation((filtro) => {
      filtros.push(filtro);
      return { session: jest.fn().mockResolvedValue(null) };
    });
    const alterar = jest.spyOn(Trilha, "findOneAndUpdate").mockImplementation(async (filtro) => {
      filtros.push(filtro);
      return null;
    });
    jest.spyOn(OperacaoImagem, "create").mockResolvedValue({ _id: "op-upload" });
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue({ _id: "op-upload" });
    const limpar = jest.spyOn(OperacaoImagem, "updateOne").mockResolvedValue({ modifiedCount: 1 });
    enviarImagem.mockResolvedValue({ secureUrl: "https://example.test/foto.webp", publicId: "novo" });
    const req = { params: { id: "507f1f77bcf86cd799439011", fotoId: "507f1f77bcf86cd799439013" }, usuario: { _id: "507f1f77bcf86cd799439012" }, imagemValidada: Buffer.from("foto") };
    const res = criarResposta();
    const next = jest.fn();
    await ({ adicionar: adicionarFotoTrilha, substituir: substituirFotoTrilha, remover: removerFotoTrilha })[acao](req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
    expect(filtros.length).toBeGreaterThan(0);
    for (const filtro of filtros) expect(filtro).toMatchObject({ proprietario: req.usuario._id, status: { $in: ["pending", "rejected"] } });
    if (acao === "adicionar") expect(alterar).toHaveBeenCalled();
    else expect(buscar).toHaveBeenCalled();
    if (acao !== "remover") expect(limpar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ estado: "cleanup_pending" }) }));
  });
});
