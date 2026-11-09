import { jest } from "@jest/globals";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import app from "../src/app.js";
import { obterChaveJwt } from "../src/config/jwt.js";
import Trilha from "../src/models/Trilha.js";
import Usuario from "../src/models/Usuario.js";

const segredoAnterior = process.env.JWT_SECRET;
const segredoTeste = randomBytes(32).toString("base64");
const idProprietario = "507f1f77bcf86cd799439011";
const idOutroUsuario = "507f191e810c19729de860ea";
const idTrilha = "507f1f77bcf86cd799439012";

async function criarToken(idUsuario) {
  return new SignJWT({})
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
  ])("exige autenticação para %s %s antes de executar operações", async (metodo, rota) => {
    const criar = jest.spyOn(Trilha, "create");
    const atualizar = jest.spyOn(Trilha, "findOneAndUpdate");
    const excluir = jest.spyOn(Trilha, "findOneAndDelete");
    const buscarUsuario = jest.spyOn(Usuario, "findById");

    const resposta = await request(app)[metodo](rota).send({});

    expect(resposta.status).toBe(401);
    expect(criar).not.toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();
    expect(excluir).not.toHaveBeenCalled();
    expect(buscarUsuario).not.toHaveBeenCalled();
  });

  test("mantém GET público para listagem e trilhas antigas sem proprietário", async () => {
    const trilhas = [{ _id: idTrilha, titulo: "Trilha antiga" }];
    const ordenar = jest.fn().mockResolvedValue(trilhas);
    jest.spyOn(Trilha, "find").mockReturnValue({ sort: ordenar });
    jest.spyOn(Trilha, "findById").mockResolvedValue(trilhas[0]);

    const respostaLista = await request(app).get("/trilhas");
    const respostaDetalhe = await request(app).get(`/trilhas/${idTrilha}`);

    expect(respostaLista.status).toBe(200);
    expect(respostaLista.body).toEqual(trilhas);
    expect(respostaDetalhe.status).toBe(200);
    expect(respostaDetalhe.body).toEqual(trilhas[0]);
  });

  test.each(["put", "delete"])(
    "não permite %s em trilhas antigas sem proprietário",
    async (metodo) => {
      const token = await autenticarUsuario();
      const atualizar = jest
        .spyOn(Trilha, "findOneAndUpdate")
        .mockResolvedValue(null);
      const excluir = jest
        .spyOn(Trilha, "findOneAndDelete")
        .mockResolvedValue(null);
      const requisicao = request(app)[metodo](`/trilhas/${idTrilha}`)
        .set("Authorization", `Bearer ${token}`);

      if (metodo === "put") {
        requisicao.send({
          titulo: "Título",
          descricao: "Descrição",
          endereco: "Endereço",
        });
      }

      const resposta = await requisicao;

      expect(resposta.status).toBe(404);
      expect(resposta.body).toEqual({ mensagem: "Trilha não encontrada." });

      if (metodo === "put") {
        expect(atualizar).toHaveBeenCalledWith(
          { _id: idTrilha, proprietario: idProprietario },
          { titulo: "Título", descricao: "Descrição", endereco: "Endereço" },
          { new: true, runValidators: true },
        );
      } else {
        expect(excluir).toHaveBeenCalledWith({
          _id: idTrilha,
          proprietario: idProprietario,
        });
      }
    },
  );

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
    });
    expect(resposta.body.proprietario).toBe(idProprietario);
  });

  test("permite ao proprietário editar somente os campos da trilha", async () => {
    const token = await autenticarUsuario();
    const trilha = {
      _id: idTrilha,
      titulo: "Título atualizado",
      descricao: "Descrição atualizada",
      endereco: "Novo endereço",
      proprietario: idProprietario,
    };
    const atualizar = jest
      .spyOn(Trilha, "findOneAndUpdate")
      .mockResolvedValue(trilha);

    const resposta = await request(app)
      .put(`/trilhas/${idTrilha}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        titulo: trilha.titulo,
        descricao: trilha.descricao,
        endereco: trilha.endereco,
        proprietario: idOutroUsuario,
      });

    expect(resposta.status).toBe(200);
    expect(atualizar).toHaveBeenCalledWith(
      { _id: idTrilha, proprietario: idProprietario },
      {
        titulo: trilha.titulo,
        descricao: trilha.descricao,
        endereco: trilha.endereco,
      },
      { new: true, runValidators: true },
    );
    expect(resposta.body.proprietario).toBe(idProprietario);
  });

  test("retorna 404 ao editar trilha de outro usuário, inclusive para admin", async () => {
    const token = await autenticarUsuario(idOutroUsuario, "admin");
    const atualizar = jest.spyOn(Trilha, "findOneAndUpdate").mockImplementation(
      async () => null,
    );

    const resposta = await request(app)
      .put(`/trilhas/${idTrilha}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        titulo: "Tentativa de alteração",
        descricao: "Descrição",
        endereco: "Endereço",
      });

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ mensagem: "Trilha não encontrada." });
    expect(atualizar).toHaveBeenCalledWith(
      { _id: idTrilha, proprietario: idOutroUsuario },
      {
        titulo: "Tentativa de alteração",
        descricao: "Descrição",
        endereco: "Endereço",
      },
      { new: true, runValidators: true },
    );
  });

  test("usuário comum não consegue editar trilha de outro usuário", async () => {
    const token = await autenticarUsuario(idOutroUsuario, "user");
    const trilhaOriginal = {
      _id: idTrilha,
      titulo: "Título original",
      descricao: "Descrição original",
      endereco: "Endereço original",
      proprietario: idProprietario,
    };
    const atualizar = jest.spyOn(Trilha, "findOneAndUpdate").mockImplementation(
      async (filtro, campos) => {
        if (filtro.proprietario !== trilhaOriginal.proprietario) {
          return null;
        }

        Object.assign(trilhaOriginal, campos);
        return trilhaOriginal;
      },
    );

    const resposta = await request(app)
      .put(`/trilhas/${idTrilha}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        titulo: "Título alterado indevidamente",
        descricao: "Descrição alterada",
        endereco: "Endereço alterado",
      });

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ mensagem: "Trilha não encontrada." });
    expect(atualizar).toHaveBeenCalledWith(
      { _id: idTrilha, proprietario: idOutroUsuario },
      {
        titulo: "Título alterado indevidamente",
        descricao: "Descrição alterada",
        endereco: "Endereço alterado",
      },
      { new: true, runValidators: true },
    );
    expect(trilhaOriginal).toEqual({
      _id: idTrilha,
      titulo: "Título original",
      descricao: "Descrição original",
      endereco: "Endereço original",
      proprietario: idProprietario,
    });
  });

  test.each([
    ["outro usuário", idOutroUsuario],
    ["trilha inexistente", idProprietario],
  ])("retorna 404 ao excluir trilha de %s", async (_caso, idUsuario) => {
    const token = await autenticarUsuario(idUsuario);
    const excluir = jest
      .spyOn(Trilha, "findOneAndDelete")
      .mockResolvedValue(null);

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
    const excluir = jest
      .spyOn(Trilha, "findOneAndDelete")
      .mockResolvedValue({ _id: idTrilha, proprietario: idProprietario });

    const resposta = await request(app)
      .delete(`/trilhas/${idTrilha}`)
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(204);
    expect(excluir).toHaveBeenCalledWith({
      _id: idTrilha,
      proprietario: idProprietario,
    });
  });
});
