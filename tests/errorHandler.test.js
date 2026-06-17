import { jest } from "@jest/globals";
import {
  rotaNaoEncontrada,
  tratarErros,
} from "../src/middlewares/errorHandler.js";

describe("rotaNaoEncontrada", () => {
  test("deve retornar 404", () => {
    const req = {
      method: "GET",
      originalUrl: "/teste",
    };

    const json = jest.fn();

    const res = {
      status: jest.fn(() => ({
        json,
      })),
    };

    rotaNaoEncontrada(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("tratarErros", () => {
  test("deve retornar erro 400 para JSON inválido", () => {
    const erro = {
      type: "entity.parse.failed",
    };

    const json = jest.fn();

    const res = {
      status: jest.fn(() => ({
        json,
      })),
    };

    tratarErros(erro, {}, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("deve retornar erro 500 para erro genérico", () => {
    const erro = new Error("Falha");

    const json = jest.fn();

    const res = {
      status: jest.fn(() => ({
        json,
      })),
    };

    tratarErros(erro, {}, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
