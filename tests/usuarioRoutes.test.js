import { jest } from "@jest/globals";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import request from "supertest";
import app from "../src/app.js";
import { obterChaveJwt } from "../src/config/jwt.js";
import Usuario from "../src/models/Usuario.js";

const segredoAnterior = process.env.JWT_SECRET;
const segredoTeste = randomBytes(32).toString("base64");
const idUsuario = "507f1f77bcf86cd799439011";

async function criarTokenUsuario() {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(idUsuario)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(obterChaveJwt());
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

describe("POST /usuarios", () => {
  test("cria usuário com perfil user e retorna somente campos públicos", async () => {
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    const updatedAt = new Date("2026-01-02T03:04:05.000Z");
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
        updatedAt,
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
      fotoPerfil: null,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
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

  test.each([
    [" ANA@EXEMPLO.COM ", "email", "ana@exemplo.com"],
    [" ÁNA ", "nomeUsuario", "ána"],
  ])(
    "autentica por identificador normalizado (%s) sem expor dados sensíveis",
    async (identificador, campo, valorNormalizado) => {
      const id = "507f1f77bcf86cd799439011";
      const hash = await bcrypt.hash("Trilha123!", 4);
      const usuario = {
        _id: id,
        nomeCompleto: "Ana da Silva",
        nomeUsuario: "ána",
        email: "ana@exemplo.com",
        perfil: "user",
        fotoPerfil: "https://res.cloudinary.com/demo/perfil.jpg",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        senha: hash,
      };
      const query = { select: jest.fn().mockResolvedValue(usuario) };
      const buscarUsuario = jest
        .spyOn(Usuario, "findOne")
        .mockReturnValue(query);

      const resposta = await request(app)
        .post("/usuarios/login")
        .send({ identificador, senha: "Trilha123!", perfil: "admin" });

      expect(resposta.status).toBe(200);
      expect(buscarUsuario).toHaveBeenCalledWith({ [campo]: valorNormalizado });
      expect(query.select).toHaveBeenCalledWith("+senha");
      expect(resposta.body.usuario).toEqual({
        _id: id,
        nomeCompleto: "Ana da Silva",
        nomeUsuario: "ána",
        email: "ana@exemplo.com",
        perfil: "user",
        fotoPerfil: "https://res.cloudinary.com/demo/perfil.jpg",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
      expect(resposta.body).not.toHaveProperty("senha");
      expect(JSON.stringify(resposta.body)).not.toContain(hash);
      expect(JSON.stringify(resposta.body)).not.toContain("Trilha123!");

      const { payload, protectedHeader } = await jwtVerify(
        resposta.body.token,
        obterChaveJwt(),
        { algorithms: ["HS256"] },
      );
      expect(protectedHeader.alg).toBe("HS256");
      expect(payload).toMatchObject({ sub: id });
      expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
      expect(payload.exp - payload.iat).toBe(15 * 60);
    },
  );

  test.each([
    ["usuário inexistente", null],
    ["senha incorreta", "OutraSenha123!"],
  ])("retorna a mesma resposta genérica para %s", async (_caso, senhaDaConta) => {
    const hash = senhaDaConta
      ? await bcrypt.hash(senhaDaConta, 4)
      : undefined;
    const usuario = senhaDaConta
      ? { senha: hash }
      : null;
    jest.spyOn(Usuario, "findOne").mockReturnValue({
      select: jest.fn().mockResolvedValue(usuario),
    });

    const resposta = await request(app).post("/usuarios/login").send({
      identificador: "ana@exemplo.com",
      senha: "Trilha123!",
    });

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({ mensagem: "Credenciais inválidas." });
  });

  test("valida entrada do login antes de consultar o model", async () => {
    const buscarUsuario = jest.spyOn(Usuario, "findOne");

    const resposta = await request(app)
      .post("/usuarios/login")
      .send({ identificador: "ana@exemplo.com" });

    expect(resposta.status).toBe(400);
    expect(buscarUsuario).not.toHaveBeenCalled();
  });

  test("encaminha falhas inesperadas da consulta de login ao errorHandler", async () => {
    const erro = new Error("Falha de consulta");
    const query = { select: jest.fn().mockRejectedValue(erro) };
    jest.spyOn(Usuario, "findOne").mockReturnValue(query);
    const logErro = jest.spyOn(console, "error").mockImplementation(() => {});

    const resposta = await request(app).post("/usuarios/login").send({
      identificador: "ana@exemplo.com",
      senha: "Trilha123!",
    });

    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({ mensagem: "Erro interno do servidor." });
    expect(logErro).toHaveBeenCalledWith(erro);
  });
});

describe("perfil do usuário autenticado", () => {
  test.each(["get", "patch"])("%s /usuarios/me exige autenticação", async (metodo) => {
    const buscar = jest.spyOn(Usuario, "findById");
    const requisicao = request(app)[metodo]("/usuarios/me");
    if (metodo === "patch") requisicao.send({ nomeCompleto: "Novo nome" });

    const resposta = await requisicao;

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({ mensagem: "Autenticação inválida ou expirada." });
    expect(buscar).not.toHaveBeenCalled();
  });

  test("GET /usuarios/me retorna os dados públicos do usuário atual", async () => {
    const token = await criarTokenUsuario();
    const usuario = {
      _id: idUsuario,
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ána",
      email: "ana@example.com",
      perfil: "user",
      fotoPerfil: "https://res.cloudinary.com/demo/perfil.jpg",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const queryAutenticacao = { select: jest.fn().mockResolvedValue(usuario) };
    const queryPerfil = { select: jest.fn().mockResolvedValue(usuario) };
    jest.spyOn(Usuario, "findById")
      .mockReturnValueOnce(queryAutenticacao)
      .mockReturnValueOnce(queryPerfil);

    const resposta = await request(app)
      .get("/usuarios/me")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      _id: idUsuario,
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ána",
      email: "ana@example.com",
      perfil: "user",
      fotoPerfil: "https://res.cloudinary.com/demo/perfil.jpg",
      createdAt: usuario.createdAt.toISOString(),
      updatedAt: usuario.updatedAt.toISOString(),
    });
    expect(JSON.stringify(resposta.body)).not.toMatch(/senha|publicId|hash/i);
    expect(queryAutenticacao.select).toHaveBeenCalledWith(
      "_id nomeCompleto nomeUsuario email perfil",
    );
    expect(queryPerfil.select).toHaveBeenCalledWith(
      "_id nomeCompleto nomeUsuario email perfil fotoPerfil createdAt updatedAt",
    );
  });

  test("PATCH /usuarios/me normaliza e persiste somente campos de perfil permitidos", async () => {
    const token = await criarTokenUsuario();
    const usuario = {
      _id: idUsuario,
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ana",
      email: "ana@example.com",
      perfil: "user",
      fotoPerfil: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const usuarioAutenticado = {
      _id: idUsuario,
      nomeCompleto: usuario.nomeCompleto,
      nomeUsuario: usuario.nomeUsuario,
      email: usuario.email,
      perfil: "user",
    };
    jest.spyOn(Usuario, "findById")
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(usuarioAutenticado) })
      .mockResolvedValueOnce(usuario);

    const resposta = await request(app)
      .patch("/usuarios/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ nomeCompleto: "  Ana Nova  ", nomeUsuario: " ÁNA " });

    expect(resposta.status).toBe(200);
    expect(usuario.nomeCompleto).toBe("Ana Nova");
    expect(usuario.nomeUsuario).toBe("ána");
    expect(usuario.save).toHaveBeenCalledTimes(1);
    expect(resposta.body).toMatchObject({
      _id: idUsuario,
      nomeCompleto: "Ana Nova",
      nomeUsuario: "ána",
      email: "ana@example.com",
      perfil: "user",
      fotoPerfil: null,
    });
    expect(resposta.body).not.toHaveProperty("senha");
  });

  test("rejeita alteração de perfil, senha e campos desconhecidos", async () => {
    const token = await criarTokenUsuario();
    const usuarioAutenticado = {
      _id: idUsuario,
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ana",
      email: "ana@example.com",
      perfil: "user",
    };
    const buscar = jest.spyOn(Usuario, "findById").mockReturnValue({
      select: jest.fn().mockResolvedValue(usuarioAutenticado),
    });

    const resposta = await request(app)
      .patch("/usuarios/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ perfil: "admin", senha: "NovaSenha123!", campoExtra: true });

    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ mensagem: "Dados do usuário inválidos." });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  test("rejeita PATCH vazio ou com valor inválido antes de salvar", async () => {
    const token = await criarTokenUsuario();
    const usuarioAutenticado = {
      _id: idUsuario,
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ana",
      email: "ana@example.com",
      perfil: "user",
    };

    for (const body of [{}, { email: "invalido" }, { nomeUsuario: "Ana 1" }]) {
      const buscar = jest.spyOn(Usuario, "findById").mockReturnValue({
        select: jest.fn().mockResolvedValue(usuarioAutenticado),
      });
      const resposta = await request(app)
        .patch("/usuarios/me")
        .set("Authorization", `Bearer ${token}`)
        .send(body);

      expect(resposta.status).toBe(400);
      expect(buscar).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();
    }
  });

  test("retorna conflito seguro quando o e-mail atualizado já existe", async () => {
    const token = await criarTokenUsuario();
    const usuarioAutenticado = {
      _id: idUsuario,
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ana",
      email: "ana@example.com",
      perfil: "user",
    };
    const usuario = {
      ...usuarioAutenticado,
      fotoPerfil: null,
      save: jest.fn().mockRejectedValue(Object.assign(new Error("duplicate"), {
        code: 11000,
        keyPattern: { email: 1 },
        keyValue: { email: "privado@example.com" },
      })),
    };
    jest.spyOn(Usuario, "findById")
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(usuarioAutenticado) })
      .mockResolvedValueOnce(usuario);

    const resposta = await request(app)
      .patch("/usuarios/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "novo@example.com" });

    expect(resposta.status).toBe(409);
    expect(resposta.body).toEqual({ mensagem: "Este e-mail já está cadastrado." });
    expect(JSON.stringify(resposta.body)).not.toContain("privado@example.com");
  });
});
