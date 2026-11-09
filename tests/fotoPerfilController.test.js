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
const { substituirFotoPerfil } = await import("../src/controllers/fotoPerfilController.js");

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
      { new: true, session: sessao },
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

    const next = jest.fn();
    await substituirFotoPerfil(
      { usuario: { _id: "usuario-1" }, imagemValidada: Buffer.from("img") },
      { status: jest.fn(), json: jest.fn() },
      next,
    );

    expect(salvarUsuario).not.toHaveBeenCalled();
    expect(disputarLease).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "uploading", uploadLeaseUntil: { $gt: expect.any(Date) } }),
      expect.any(Object),
      { new: true, session: sessao },
    );
    expect(buscarUsuario).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
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
});
