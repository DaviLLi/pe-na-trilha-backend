import AuthSession from "../src/models/AuthSession.js";
import { jest } from "@jest/globals";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { obterChaveJwt } from "../src/config/jwt.js";
import { autenticarToken } from "../src/middlewares/autenticarToken.js";
import Usuario from "../src/models/Usuario.js";

const segredoAnterior = process.env.JWT_SECRET;
const segredoTeste = randomBytes(32).toString("base64");
const idUsuario = "507f1f77bcf86cd799439011";

function criarRespostaMock() {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(),
  };

  return res;
}

async function criarToken({ segredo = segredoTeste, expiracao = "15m" } = {}) {
  return new SignJWT({ sid: "507f1f77bcf86cd799439099" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(idUsuario)
    .setIssuedAt()
    .setExpirationTime(expiracao)
    .sign(new TextEncoder().encode(segredo));
}

async function criarTokenComClaims({
  algoritmo = "HS256",
  sub = idUsuario,
  incluirSub = true,
  incluirIat = true,
  incluirExp = true,
} = {}) {
  const token = new SignJWT({ sid: "507f1f77bcf86cd799439099" }).setProtectedHeader({ alg: algoritmo, typ: "JWT" });

  if (incluirSub) token.setSubject(sub);
  if (incluirIat) token.setIssuedAt();
  if (incluirExp) token.setExpirationTime("15m");

  return token.sign(obterChaveJwt());
}

beforeEach(() => {
  jest.spyOn(AuthSession, "findOne").mockResolvedValue({ _id: "507f1f77bcf86cd799439099" });
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

describe("autenticarToken", () => {
  test.each(["", "segredo-curto"])(
    "rejeita JWT_SECRET menor que 256 bits",
    (segredo) => {
      process.env.JWT_SECRET = segredo;

      expect(() => obterChaveJwt()).toThrow(/32 bytes/);
    },
  );

  test.each([undefined, "Basic token", "Bearer token inválido"])(
    "rejeita cabeçalho ausente ou malformado (%s)",
    async (autorizacao) => {
      const req = { get: jest.fn(() => autorizacao) };
      const res = criarRespostaMock();
      const next = jest.fn();
      const buscarUsuario = jest.spyOn(Usuario, "findById");

      await autenticarToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        mensagem: "Autenticação inválida ou expirada.",
      });
      expect(buscarUsuario).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    },
  );

  test("rejeita token expirado com resposta genérica", async () => {
    const agora = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sid: "507f1f77bcf86cd799439099" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(idUsuario)
      .setIssuedAt(agora - 120)
      .setExpirationTime(agora - 60)
      .sign(new TextEncoder().encode(segredoTeste));
    const req = { get: jest.fn(() => `Bearer ${token}`) };
    const res = criarRespostaMock();
    const next = jest.fn();

    await autenticarToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Autenticação inválida ou expirada.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("rejeita token assinado com segredo diferente", async () => {
    const token = await criarToken({ segredo: randomBytes(32).toString("base64") });
    const req = { get: jest.fn(() => `Bearer ${token}`) };
    const res = criarRespostaMock();
    const next = jest.fn();

    await autenticarToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Autenticação inválida ou expirada.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ["algoritmo diferente de HS256", { algoritmo: "HS384" }],
    ["claim sub ausente", { incluirSub: false }],
    ["claim sub inválida", { sub: "id-invalido" }],
    ["claim iat ausente", { incluirIat: false }],
    ["claim exp ausente", { incluirExp: false }],
  ])("rejeita token com %s sem consultar o usuário", async (_caso, opcoes) => {
    const token = await criarTokenComClaims(opcoes);
    const req = { get: jest.fn(() => `Bearer ${token}`) };
    const res = criarRespostaMock();
    const next = jest.fn();
    const buscarUsuario = jest.spyOn(Usuario, "findById");

    await autenticarToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Autenticação inválida ou expirada.",
    });
    expect(buscarUsuario).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("carrega os dados atuais e expõe somente campos públicos em req.usuario", async () => {
    const token = await criarToken();
    const usuario = {
      _id: idUsuario,
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ána",
      email: "ana@exemplo.com",
      perfil: "admin",
      senha: "$2b$12$hash-privado",
    };
    const query = { select: jest.fn().mockResolvedValue(usuario) };
    const buscarUsuario = jest
      .spyOn(Usuario, "findById")
      .mockReturnValue(query);
    const req = { get: jest.fn(() => `Bearer ${token}`) };
    const res = criarRespostaMock();
    const next = jest.fn();

    await autenticarToken(req, res, next);

    expect(buscarUsuario).toHaveBeenCalledWith(idUsuario);
    expect(query.select).toHaveBeenCalledWith(
      "_id nomeCompleto nomeUsuario email perfil",
    );
    expect(req.usuario).toEqual({
      _id: idUsuario,
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ána",
      email: "ana@exemplo.com",
      perfil: "admin",
    });
    expect(req.usuario).not.toHaveProperty("senha");
    expect(JSON.stringify(req.usuario)).not.toContain("hash-privado");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("retorna 401 se o usuário do subject não existe mais", async () => {
    const token = await criarToken();
    jest.spyOn(Usuario, "findById").mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });
    const req = { get: jest.fn(() => `Bearer ${token}`) };
    const res = criarRespostaMock();
    const next = jest.fn();

    await autenticarToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Autenticação inválida ou expirada.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("encaminha falha de banco sem tratá-la como token inválido", async () => {
    const token = await criarToken();
    const erro = new Error("Falha de banco");
    jest.spyOn(Usuario, "findById").mockReturnValue({
      select: jest.fn().mockRejectedValue(erro),
    });
    const req = { get: jest.fn(() => `Bearer ${token}`) };
    const res = criarRespostaMock();
    const next = jest.fn();

    await autenticarToken(req, res, next);

    expect(next).toHaveBeenCalledWith(erro);
    expect(res.status).not.toHaveBeenCalled();
  });
});
