import { jest } from "@jest/globals";
import { validarTrilha } from "../src/middlewares/validarTrilha.js";

function criarRespostaMock() {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(),
  };

  return res;
}

describe("validarTrilha", () => {
  test("deve aceitar uma trilha com dados válidos", () => {
    const req = {
      body: {
        titulo: "Trilha da Lagoa",
        descricao: "Muito bonita",
        endereco: "Florianópolis",
      },
    };

    const res = {};
    const next = jest.fn();

    validarTrilha(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test("deve remover espaços extras antes de salvar os dados", () => {
    const req = {
      body: {
        titulo: "  Trilha da Lagoa  ",
        descricao: "  Muito bonita  ",
        endereco: "  Florianópolis  ",
      },
    };

    const res = criarRespostaMock();
    const next = jest.fn();

    validarTrilha(req, res, next);

    expect(req.body).toEqual({
      titulo: "Trilha da Lagoa",
      descricao: "Muito bonita",
      endereco: "Florianópolis",
    });
    expect(next).toHaveBeenCalled();
  });

  test("deve retornar erro quando algum campo obrigatório não for enviado", () => {
    const req = {
      body: {
        descricao: "Teste",
        endereco: "Teste",
      },
    };

    const res = criarRespostaMock();

    validarTrilha(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Título, descrição e endereço são obrigatórios.",
    });
  });

  test("deve retornar erro quando algum campo obrigatório estiver inválido", () => {
    const req = {
      body: {
        titulo: "Trilha da Lagoa",
        descricao: "   ",
        endereco: "Florianópolis",
      },
    };

    const res = criarRespostaMock();
    const next = jest.fn();

    validarTrilha(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Título, descrição e endereço são obrigatórios.",
    });
    expect(next).not.toHaveBeenCalled();
  });
});
