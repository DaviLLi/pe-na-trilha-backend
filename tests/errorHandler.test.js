import { jest } from "@jest/globals";
import request from "supertest";
import app from "../src/app.js";
import {
  rotaNaoEncontrada,
  tratarErros,
} from "../src/middlewares/errorHandler.js";

function criarRespostaMock() {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(),
  };

  return res;
}

describe("rotaNaoEncontrada", () => {
  test("deve retornar 404", () => {
    const req = {
      method: "GET",
      originalUrl: "/teste",
    };

    const res = criarRespostaMock();

    rotaNaoEncontrada(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Rota GET /teste não encontrada.",
    });
  });
});

describe("tratarErros", () => {
  test("trata CastError HTTP da rota de trilhas pelo errorHandler global", async () => {
    const resposta = await request(app).get("/trilhas/id-invalido");

    expect(resposta.status).toBe(400);
    expect(resposta.headers["content-type"]).toMatch(/application\/json/);
    expect(resposta.body).toEqual({
      mensagem: "ID de trilha inválido.",
    });
  });

  test("deve retornar erro 400 para JSON inválido", () => {
    const erro = {
      type: "entity.parse.failed",
    };

    const res = criarRespostaMock();

    tratarErros(erro, { originalUrl: "/trilhas" }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "O JSON enviado é inválido.",
    });
  });

  test("deve retornar erro 400 para dados inválidos do mongoose", () => {
    const erro = {
      name: "ValidationError",
      errors: {
        titulo: {
          message: "O título é obrigatório.",
        },
        descricao: {
          message: "A descrição é obrigatória.",
        },
      },
    };

    const res = criarRespostaMock();

    tratarErros(erro, { originalUrl: "/trilhas/123" }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Dados da trilha inválidos.",
      erros: ["O título é obrigatório.", "A descrição é obrigatória."],
    });
  });

  test("deve retornar erro 400 para ID inválido", () => {
    const erro = {
      name: "CastError",
    };

    const res = criarRespostaMock();

    tratarErros(erro, { originalUrl: "/trilhas/nao-id" }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "ID de trilha inválido.",
    });
  });

  test("deve retornar erro 500 para erro genérico", () => {
    const erro = new Error("Falha");
    const spyConsoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const res = criarRespostaMock();

    tratarErros(erro, { originalUrl: "/trilhas" }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Erro interno do servidor.",
    });
    expect(spyConsoleError).toHaveBeenCalledWith(erro);

    spyConsoleError.mockRestore();
  });
});

describe("erros de usuário", () => {
  test("usa mensagem genérica para ValidationError de usuário", () => {
    const erro = {
      name: "ValidationError",
      errors: { senha: { message: "A senha não atende aos requisitos." } },
    };
    const res = criarRespostaMock();

    tratarErros(erro, { originalUrl: "/usuarios" }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Dados do usuário inválidos.",
      erros: ["A senha não atende aos requisitos."],
    });
  });

  test("retorna mensagem de ID inválido para usuário", () => {
    const res = criarRespostaMock();

    tratarErros({ name: "CastError" }, { originalUrl: "/usuarios/abc" }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "ID de usuário inválido." });
  });

  test.each([
    ["email", "Este e-mail já está cadastrado."],
    ["nomeUsuario", "Este nome de usuário já está em uso."],
  ])("retorna mensagem segura para duplicidade de %s", (campo, mensagem) => {
    const erro = {
      code: 11000,
      keyPattern: { [campo]: 1 },
      keyValue: { [campo]: "valor-privado" },
      errmsg: "detalhes internos do MongoDB",
    };
    const res = criarRespostaMock();

    tratarErros(erro, { originalUrl: "/usuarios" }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ mensagem });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("valor-privado");
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("detalhes internos");
  });
});
