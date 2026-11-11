import { jest } from "@jest/globals";

const enviarImagem = jest.fn();
const criarPublicIdFotoPerfil = jest.fn(() => "perfis/novo-id");
jest.unstable_mockModule("../src/services/cloudinaryService.js", () => ({
  enviarImagem,
  criarPublicIdFotoPerfil,
  excluirImagem: jest.fn(),
}));

const mongoose = (await import("mongoose")).default;
const { default: Usuario } = await import("../src/models/Usuario.js");
const { default: OperacaoImagem } = await import("../src/models/OperacaoImagem.js");
const {
  substituirFotoPerfil,
  removerFotoPerfil,
} = await import("../src/controllers/fotoPerfilController.js");

describe("controller de foto de perfil", () => {
  let sessao;

  beforeEach(() => {
    jest.restoreAllMocks();
    enviarImagem.mockReset();
    criarPublicIdFotoPerfil.mockReturnValue("perfis/novo-id");
    sessao = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, "startSession").mockResolvedValue(sessao);
  });

  test("associa URL e public ID do backend e agenda a foto anterior na transação", async () => {
    const usuario = {
      fotoPerfil: "https://res.cloudinary.com/demo/antiga.jpg",
      fotoPerfilPublicId: "perfis/antigo-id",
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(OperacaoImagem, "create")
      .mockResolvedValueOnce({ _id: "op-nova" })
      .mockResolvedValueOnce([{ publicId: "perfis/antigo-id" }]);
    const renovarReserva = jest
      .spyOn(OperacaoImagem, "findOneAndUpdate")
      .mockResolvedValue({ _id: "op-nova" });
    jest.spyOn(OperacaoImagem, "updateOne").mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(Usuario, "findById").mockReturnValue({
      select: jest.fn(() => ({ session: jest.fn(() => Promise.resolve(usuario)) })),
    });
    enviarImagem.mockResolvedValue({
      secureUrl: "https://res.cloudinary.com/demo/nova.webp",
      publicId: "perfis/novo-id",
    });

    const req = { usuario: { _id: "usuario-1" }, imagemValidada: Buffer.from("img") };
    const res = { status: jest.fn(() => res), json: jest.fn() };
    const next = jest.fn();
    await substituirFotoPerfil(req, res, next);

    expect(usuario.fotoPerfil).toBe("https://res.cloudinary.com/demo/nova.webp");
    expect(usuario.fotoPerfilPublicId).toBe("perfis/novo-id");
    expect(renovarReserva).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: "uploading",
        uploadLeaseToken: expect.any(String),
        uploadLeaseUntil: { $gt: expect.any(Date) },
      }),
      { $set: { uploadLeaseUntil: expect.any(Date) } },
      { returnDocument: "after", session: sessao },
    );
    expect(usuario.save).toHaveBeenCalledWith({ session: sessao });
    expect(OperacaoImagem.create).toHaveBeenNthCalledWith(
      2,
      [{ publicId: "perfis/antigo-id", estado: "cleanup_pending", nextAttemptAt: expect.any(Date) }],
      { session: sessao },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ fotoPerfil: "https://res.cloudinary.com/demo/nova.webp" });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("publicId");
    expect(next).not.toHaveBeenCalled();
    expect(sessao.endSession).toHaveBeenCalled();
  });

  test("não associa imagem quando o lease de upload já foi recuperado", async () => {
    jest.spyOn(OperacaoImagem, "create").mockResolvedValue({ _id: "op-expirada" });
    const disputarLease = jest
      .spyOn(OperacaoImagem, "findOneAndUpdate")
      .mockResolvedValue(null);
    jest.spyOn(OperacaoImagem, "updateOne").mockResolvedValue({ modifiedCount: 0 });
    const salvarUsuario = jest.fn();
    const buscarUsuario = jest.spyOn(Usuario, "findById");
    enviarImagem.mockResolvedValue({
      secureUrl: "https://res.cloudinary.com/demo/nova.webp",
      publicId: "perfis/novo-id",
    });

    const res = { status: jest.fn(() => res), json: jest.fn() };
    const next = jest.fn();
    await substituirFotoPerfil(
      { usuario: { _id: "usuario-1" }, imagemValidada: Buffer.from("img") },
      res,
      next,
    );

    expect(salvarUsuario).not.toHaveBeenCalled();
    expect(disputarLease).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "uploading", uploadLeaseUntil: { $gt: expect.any(Date) } }),
      expect.any(Object),
      { returnDocument: "after", session: sessao },
    );
    expect(buscarUsuario).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "A operação de upload expirou. Tente novamente.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("agenda limpeza e responde 502 quando o Cloudinary falha no upload do perfil", async () => {
    jest.spyOn(OperacaoImagem, "create").mockResolvedValue({ _id: "op-falha-upload" });
    const agendarLimpeza = jest
      .spyOn(OperacaoImagem, "updateOne")
      .mockResolvedValue({ modifiedCount: 1 });
    const buscarUsuario = jest.spyOn(Usuario, "findById");
    enviarImagem.mockRejectedValue(new Error("erro privado do Cloudinary"));
    const res = { status: jest.fn(() => res), json: jest.fn() };
    const next = jest.fn();

    await substituirFotoPerfil(
      { usuario: { _id: "usuario-1" }, imagemValidada: Buffer.from("img") },
      res,
      next,
    );

    expect(agendarLimpeza).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "op-falha-upload", estado: "uploading" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "cleanup_pending" }) }),
    );
    expect(buscarUsuario).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Não foi possível enviar a imagem." });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("erro privado do Cloudinary");
    expect(next).not.toHaveBeenCalled();
  });

  test("agenda limpeza se a associação do perfil falhar após upload concluído", async () => {
    jest.spyOn(OperacaoImagem, "create").mockResolvedValue({ _id: "op-falha-transacao" });
    const agendarLimpeza = jest
      .spyOn(OperacaoImagem, "updateOne")
      .mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockResolvedValue({ _id: "op-falha-transacao" });
    const erro = new Error("falha transacional");
    sessao.withTransaction.mockRejectedValue(erro);
    enviarImagem.mockResolvedValue({
      secureUrl: "https://res.cloudinary.com/demo/nova.webp",
      publicId: "perfis/novo-id",
    });
    const res = { status: jest.fn(() => res), json: jest.fn() };
    const next = jest.fn();

    await substituirFotoPerfil(
      { usuario: { _id: "usuario-1" }, imagemValidada: Buffer.from("img") },
      res,
      next,
    );

    expect(agendarLimpeza).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "op-falha-transacao", estado: "uploading" }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: "cleanup_pending" }) }),
    );
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(erro);
  });

  test("mantém heartbeat ativo enquanto a transação associa o usuário", async () => {
    jest.useFakeTimers();
    const usuario = {
      fotoPerfil: null,
      fotoPerfilPublicId: null,
      save: jest.fn().mockResolvedValue(undefined),
    };
    let resolverReserva;
    const reservaPendente = new Promise((resolve) => {
      resolverReserva = resolve;
    });
    jest.spyOn(OperacaoImagem, "create").mockResolvedValue({ _id: "op-heartbeat" });
    jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockReturnValue(reservaPendente);
    const atualizar = jest.spyOn(OperacaoImagem, "updateOne").mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(Usuario, "findById").mockReturnValue({
      select: jest.fn(() => ({ session: jest.fn(() => Promise.resolve(usuario)) })),
    });
    enviarImagem.mockResolvedValue({
      secureUrl: "https://res.cloudinary.com/demo/nova.webp",
      publicId: "perfis/novo-id",
    });

    const res = { status: jest.fn(() => res), json: jest.fn() };
    const chamada = substituirFotoPerfil(
      { usuario: { _id: "usuario-1" }, imagemValidada: Buffer.from("img") },
      res,
      jest.fn(),
    );
    for (let tentativa = 0; tentativa < 10 && !OperacaoImagem.findOneAndUpdate.mock.calls.length; tentativa += 1) {
      await Promise.resolve();
    }

    await jest.advanceTimersByTimeAsync(30000);
    expect(atualizar).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "op-heartbeat", estado: "uploading" }),
      { $set: { uploadLeaseUntil: expect.any(Date) } },
    );

    resolverReserva({ _id: "op-heartbeat" });
    await chamada;
    expect(usuario.fotoPerfil).toBe("https://res.cloudinary.com/demo/nova.webp");
    jest.useRealTimers();
  });

  test("remove a foto e agenda o asset anterior na mesma transação", async () => {
    const usuario = {
      fotoPerfil: "https://res.cloudinary.com/demo/antiga.jpg",
      fotoPerfilPublicId: "perfis/antigo-id",
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(Usuario, "findById").mockReturnValue({
      select: jest.fn(() => ({ session: jest.fn(() => Promise.resolve(usuario)) })),
    });
    const agendar = jest.spyOn(OperacaoImagem, "create").mockResolvedValue([]);
    const res = { status: jest.fn(() => res), json: jest.fn() };
    const next = jest.fn();

    await removerFotoPerfil({ usuario: { _id: "usuario-1" } }, res, next);

    expect(usuario.fotoPerfil).toBeNull();
    expect(usuario.fotoPerfilPublicId).toBeNull();
    expect(usuario.save).toHaveBeenCalledWith({ session: sessao });
    expect(agendar).toHaveBeenCalledWith(
      [{ publicId: "perfis/antigo-id", estado: "cleanup_pending", nextAttemptAt: expect.any(Date) }],
      { session: sessao },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ fotoPerfil: null });
    expect(next).not.toHaveBeenCalled();
    expect(sessao.endSession).toHaveBeenCalled();
  });

  test("encaminha falha transacional na remoção sem confirmar sucesso", async () => {
    const usuario = {
      fotoPerfil: "https://res.cloudinary.com/demo/antiga.jpg",
      fotoPerfilPublicId: "perfis/antigo-id",
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(Usuario, "findById").mockReturnValue({
      select: jest.fn(() => ({ session: jest.fn(() => Promise.resolve(usuario)) })),
    });
    const agendar = jest.spyOn(OperacaoImagem, "create");
    const erro = new Error("falha transacional");
    sessao.withTransaction.mockRejectedValue(erro);
    const res = { status: jest.fn(() => res), json: jest.fn() };
    const next = jest.fn();

    await removerFotoPerfil({ usuario: { _id: "usuario-1" } }, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(agendar).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(erro);
    expect(sessao.endSession).toHaveBeenCalled();
  });
});
