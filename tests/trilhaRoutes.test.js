import AuthSession from "../src/models/AuthSession.js";
import { jest } from "@jest/globals";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { obterChaveJwt } from "../src/config/jwt.js";
import OperacaoImagem from "../src/models/OperacaoImagem.js";
import Trilha from "../src/models/Trilha.js";
import Usuario from "../src/models/Usuario.js";

const segredoAnterior = process.env.JWT_SECRET;
const segredoTeste = randomBytes(32).toString("base64");
const idProprietario = "507f1f77bcf86cd799439011";
const idOutroUsuario = "507f191e810c19729de860ea";
const idTrilha = "507f1f77bcf86cd799439012";

async function criarToken(idUsuario) {
  return new SignJWT({ sid: "507f1f77bcf86cd799439099" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(idUsuario)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(obterChaveJwt());
}

function autenticarUsuario(id = idProprietario, perfil = "user") {
  const usuario = {
    _id: id,
    nomeCompleto: "Ana da Silva",
    nomeUsuario: "ana",
    email: "ana@exemplo.com",
    perfil,
  };
  const query = { select: jest.fn().mockResolvedValue(usuario) };

  jest.spyOn(Usuario, "findById").mockReturnValue(query);

  return criarToken(id);
}

function iniciarTransacaoMock() {
  const sessao = {
    withTransaction: jest.fn((callback) => callback()),
    endSession: jest.fn(),
  };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(sessao);
  return sessao;
}

beforeAll(() => {
  process.env.JWT_SECRET = segredoTeste;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (segredoAnterior === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = segredoAnterior;
  }
});

describe("rotas de trilhas", () => {
  test.each([
    ["post", "/trilhas"],
    ["put", `/trilhas/${idTrilha}`],
    ["delete", `/trilhas/${idTrilha}`],
    ["post", `/trilhas/${idTrilha}/fotos`],
    ["put", `/trilhas/${idTrilha}/fotos/507f1f77bcf86cd799439013`],
    ["delete", `/trilhas/${idTrilha}/fotos/507f1f77bcf86cd799439013`],
  ])("exige autenticação para %s %s antes de executar operações", async (metodo, rota) => {
    const criar = jest.spyOn(Trilha, "create");
    const atualizar = jest.spyOn(Trilha, "findOneAndUpdate");
    const excluir = jest.spyOn(Trilha, "findOneAndDelete");
    const verificarProprietario = jest.spyOn(Trilha, "exists");
    const buscarUsuario = jest.spyOn(Usuario, "findById");

    const resposta = await request(app)[metodo](rota).send({});

    expect(resposta.status).toBe(401);
    expect(criar).not.toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();
    expect(excluir).not.toHaveBeenCalled();
    expect(verificarProprietario).not.toHaveBeenCalled();
    expect(buscarUsuario).not.toHaveBeenCalled();
  });

  test("mantém GET público restrito a aprovadas", async () => {
    const trilhas = [{ _id: idTrilha, titulo: "Trilha antiga", fotos: [] }];
    const ordenar = jest.fn().mockResolvedValue(trilhas);
    jest.spyOn(Trilha, "find").mockReturnValue({ sort: ordenar });
    const buscar = jest.spyOn(Trilha, "findOne").mockResolvedValue(trilhas[0]);

    const respostaLista = await request(app).get("/trilhas");
    const respostaDetalhe = await request(app).get(`/trilhas/${idTrilha}`);

    expect(Trilha.find).toHaveBeenCalledWith({ status: "approved" });
    expect(buscar).toHaveBeenCalledWith({ _id: idTrilha, status: "approved" });
    expect(respostaLista.status).toBe(200);
    expect(respostaLista.body).toEqual(trilhas);
    expect(respostaDetalhe.status).toBe(200);
    expect(respostaDetalhe.body).toEqual(trilhas[0]);
  });

  test("cria trilha com o usuário autenticado e ignora proprietário enviado", async () => {
    const token = await autenticarUsuario();
    const trilha = {
      _id: idTrilha,
      titulo: "Trilha nova",
      descricao: "Vista bonita",
      endereco: "Florianópolis",
      proprietario: idProprietario,
    };
    const criar = jest.spyOn(Trilha, "create").mockResolvedValue(trilha);

    const resposta = await request(app)
      .post("/trilhas")
      .set("Authorization", `Bearer ${token}`)
      .send({
        titulo: trilha.titulo,
        descricao: trilha.descricao,
        endereco: trilha.endereco,
        proprietario: idOutroUsuario,
      });

    expect(resposta.status).toBe(201);
    expect(criar).toHaveBeenCalledWith({
      titulo: trilha.titulo,
      descricao: trilha.descricao,
      endereco: trilha.endereco,
      proprietario: idProprietario,
      status: "pending",
    });
    expect(resposta.body.proprietario).toBe(idProprietario);
  });

  test.each([
    ["outro usuário", idOutroUsuario],
    ["trilha inexistente", idProprietario],
  ])("retorna 404 ao excluir trilha de %s", async (_caso, idUsuario) => {
    const token = await autenticarUsuario(idUsuario);
    iniciarTransacaoMock();
    const excluir = jest
      .spyOn(Trilha, "findOneAndDelete")
      .mockReturnValue({ session: jest.fn().mockResolvedValue(null) });

    const resposta = await request(app)
      .delete(`/trilhas/${idTrilha}`)
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ mensagem: "Trilha não encontrada." });
    expect(excluir).toHaveBeenCalledWith({
      _id: idTrilha,
      proprietario: idUsuario,
    });
  });

  test("permite ao proprietário excluir sua trilha", async () => {
    const token = await autenticarUsuario();
    const sessao = iniciarTransacaoMock();
    const trilha = { _id: idTrilha, proprietario: idProprietario, fotos: [] };
    const excluir = jest
      .spyOn(Trilha, "findOneAndDelete")
      .mockReturnValue({ session: jest.fn().mockResolvedValue(trilha) });

    const resposta = await request(app)
      .delete(`/trilhas/${idTrilha}`)
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(204);
    expect(excluir).toHaveBeenCalledWith({
      _id: idTrilha,
      proprietario: idProprietario,
    });
    expect(excluir.mock.results[0].value.session).toHaveBeenCalledWith(sessao);
  });

  test("exclui a trilha e agenda todas as fotos na mesma transação", async () => {
    const token = await autenticarUsuario();
    const sessao = iniciarTransacaoMock();
    const trilha = {
      _id: idTrilha,
      proprietario: idProprietario,
      fotos: [{ publicId: "trilhas/a" }, { publicId: "trilhas/b" }],
    };
    const remover = jest.spyOn(Trilha, "findOneAndDelete").mockReturnValue({
      session: jest.fn().mockResolvedValue(trilha),
    });
    const agendar = jest.spyOn(OperacaoImagem, "create").mockResolvedValue([]);

    const resposta = await request(app)
      .delete(`/trilhas/${idTrilha}`)
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(204);
    expect(agendar).toHaveBeenCalledWith(
      [
        { publicId: "trilhas/a", resourceType: "image", deliveryType: "upload", estado: "cleanup_pending", nextAttemptAt: expect.any(Date) },
        { publicId: "trilhas/b", resourceType: "image", deliveryType: "upload", estado: "cleanup_pending", nextAttemptAt: expect.any(Date) },
      ],
      { session: sessao },
    );
    expect(remover.mock.results[0].value.session).toHaveBeenCalledWith(sessao);
  });

  test("verifica propriedade antes de receber multipart", async () => {
    const token = await autenticarUsuario(idOutroUsuario);
    const verificarTrilha = jest.spyOn(Trilha, "exists").mockResolvedValue(null);
    const criarOperacao = jest.spyOn(OperacaoImagem, "create");

    const resposta = await request(app)
      .post(`/trilhas/${idTrilha}/fotos`)
      .set("Authorization", `Bearer ${token}`)
      .attach("imagem", Buffer.from("não enviado"), { filename: "foto.png" });

    expect(resposta.status).toBe(404);
    expect(verificarTrilha).toHaveBeenCalledWith({
      _id: idTrilha,
      proprietario: idOutroUsuario,
    });
    expect(criarOperacao).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  jest.spyOn(AuthSession, "findOne").mockResolvedValue({ _id: "507f1f77bcf86cd799439099" });
});
