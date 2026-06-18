import { jest } from "@jest/globals";
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
  test("deve retornar erro 400 para JSON inválido", () => {
    const erro = {
      type: "entity.parse.failed",
    };

    const res = criarRespostaMock();

    tratarErros(erro, {}, res);

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

    tratarErros(erro, {}, res);

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

    tratarErros(erro, {}, res);

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

    tratarErros(erro, {}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Erro interno do servidor.",
    });
    expect(spyConsoleError).toHaveBeenCalledWith(erro);

    spyConsoleError.mockRestore();
  });
});
