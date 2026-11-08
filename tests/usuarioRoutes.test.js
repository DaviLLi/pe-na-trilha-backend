import { jest } from "@jest/globals";
import request from "supertest";
import app from "../src/app.js";
import Usuario from "../src/models/Usuario.js";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /usuarios", () => {
  test("cria usuário com perfil user e retorna somente campos públicos", async () => {
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    const dados = {
      nomeCompleto: " Ana da Silva ",
      nomeUsuario: "ÁNA",
      email: " ANA@EXEMPLO.COM ",
      senha: "Trilha123!",
      perfil: "admin",
    };
    const criarUsuario = jest.spyOn(Usuario, "create").mockImplementation(
      async (entrada) => ({
        ...entrada,
        _id: "usuario-id",
        createdAt,
        senhaHash: "$2b$12$hash-privado",
      }),
    );

    const resposta = await request(app).post("/usuarios").send(dados);

    expect(resposta.status).toBe(201);
    expect(criarUsuario).toHaveBeenCalledWith({
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ána",
      email: "ana@exemplo.com",
      senha: "Trilha123!",
      fotoPerfil: null,
      perfil: "user",
    });
    expect(resposta.body).toEqual({
      _id: "usuario-id",
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ána",
      email: "ana@exemplo.com",
      perfil: "user",
      createdAt: createdAt.toISOString(),
    });
    expect(resposta.body).not.toHaveProperty("senha");
    expect(JSON.stringify(resposta.body)).not.toContain("hash-privado");
  });

  test("retorna 400 sem chamar o model quando os dados são inválidos", async () => {
    const criarUsuario = jest.spyOn(Usuario, "create");

    const resposta = await request(app)
      .post("/usuarios")
      .send({ nomeCompleto: "Ana", nomeUsuario: "Ana 1" });

    expect(resposta.status).toBe(400);
    expect(criarUsuario).not.toHaveBeenCalled();
  });

  test.each([
    ["email", "Este e-mail já está cadastrado."],
    ["nomeUsuario", "Este nome de usuário já está em uso."],
  ])("retorna 409 seguro para duplicidade de %s", async (campo, mensagem) => {
    const erroDuplicado = Object.assign(new Error("E11000 duplicate key"), {
      code: 11000,
      keyPattern: { [campo]: 1 },
      keyValue: { [campo]: "valor-privado" },
      errmsg: "detalhes internos do MongoDB",
    });
    jest.spyOn(Usuario, "create").mockRejectedValue(erroDuplicado);

    const resposta = await request(app)
      .post("/usuarios")
      .send({
        nomeCompleto: "Ana da Silva",
        nomeUsuario: "Ana",
        email: "ana@exemplo.com",
        senha: "Trilha123!",
      });

    expect(resposta.status).toBe(409);
    expect(resposta.body).toEqual({ mensagem });
    expect(JSON.stringify(resposta.body)).not.toContain("valor-privado");
    expect(JSON.stringify(resposta.body)).not.toContain("detalhes internos");
  });

  test("encaminha erros inesperados ao errorHandler", async () => {
    const erro = new Error("Falha interna de teste");
    jest.spyOn(Usuario, "create").mockRejectedValue(erro);
    const logErro = jest.spyOn(console, "error").mockImplementation(() => {});

    const resposta = await request(app)
      .post("/usuarios")
      .send({
        nomeCompleto: "Ana da Silva",
        nomeUsuario: "Ana",
        email: "ana@exemplo.com",
        senha: "Trilha123!",
      });

    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({ mensagem: "Erro interno do servidor." });
    expect(logErro).toHaveBeenCalledWith(erro);
  });
});
