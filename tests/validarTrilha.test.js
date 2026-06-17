import { jest } from "@jest/globals";
import { validarTrilha } from "../src/middlewares/validarTrilha.js";

describe("validarTrilha", () => {
  test("deve chamar next quando os dados forem válidos", () => {
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

  test("deve retornar erro quando faltar título", () => {
    const req = {
      body: {
        descricao: "Teste",
        endereco: "Teste",
      },
    };

    const json = jest.fn();

    const res = {
      status: jest.fn(() => ({
        json,
      })),
    };

    validarTrilha(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
