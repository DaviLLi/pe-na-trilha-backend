import { jest } from "@jest/globals";
import bcrypt from "bcrypt";
import request from "supertest";
import app from "../src/app.js";
import TentativaLogin from "../src/models/TentativaLogin.js";
import Usuario from "../src/models/Usuario.js";

let relogio;
let consultas;
let segredoAnterior;
const entrar = (identificador, origem = "203.0.113.1") => request(app)
  .post("/usuarios/login").set("Origin", "http://localhost:5173").set("X-Forwarded-For", origem)
  .send({ identificador, senha: "TesteFicticio1!" });

beforeEach(() => {
  segredoAnterior = process.env.CSRF_SECRET;
  process.env.CSRF_SECRET = "chave ficticia de teste com mais de trinta e dois bytes";
  relogio = Date.now();
  const reservas = new Map();
  jest.spyOn(TentativaLogin.collection, "findOneAndUpdate").mockImplementation(async ({ _id }, [{ $set }]) => {
    const existente = reservas.get(_id);
    const expirado = !existente || existente.expiraEm.getTime() <= relogio;
    const reserva = expirado
      ? { expiraEm: new Date(relogio + $set.expiraEm.$cond[1].$add[1]), tentativas: 1 }
      : { ...existente, tentativas: Math.min(existente.tentativas + 1, $set.tentativas.$cond[2].$min[1]) };
    reservas.set(_id, reserva);
    return reserva;
  });
  jest.spyOn(bcrypt, "compare").mockResolvedValue(false);
  consultas = jest.spyOn(Usuario, "findOne").mockReturnValue({
    select: jest.fn().mockResolvedValue({ senha: "hash-ficticio" }),
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  if (segredoAnterior === undefined) delete process.env.CSRF_SECRET;
  else process.env.CSRF_SECRET = segredoAnterior;
});

test("limita identificador normalizado e libera após a janela sem estender o bloqueio", async () => {
  const normais = await Promise.all(Array.from({ length: 10 }, () => entrar(" ANA@EXEMPLO.COM ")));
  expect(normais.every(({ status }) => status === 401)).toBe(true);
  expect(consultas).toHaveBeenCalledTimes(10);
  const bloqueada = await entrar("ana@exemplo.com", "203.0.113.2");
  expect(bloqueada.status).toBe(429);
  expect(Number(bloqueada.headers["retry-after"])).toBeGreaterThan(0);
  relogio += 299_999;
  expect((await entrar("ana@exemplo.com")).status).toBe(429);
  relogio++;
  expect((await entrar("ana@exemplo.com")).status).toBe(401);
  expect(consultas).toHaveBeenCalledTimes(11);
});

test("limita a origem mesmo com identificadores distintos e ignora cabeçalho de IP não confiável", async () => {
  const normais = await Promise.all(Array.from({ length: 60 }, (_, indice) => entrar(`usr${indice}@exemplo.com`)));
  expect(normais.every(({ status }) => status === 401)).toBe(true);
  expect((await entrar("outro@exemplo.com", "203.0.113.33")).status).toBe(429);
  expect(consultas).toHaveBeenCalledTimes(60);
});

test("falha de armazenamento impede a consulta de credenciais", async () => {
  TentativaLogin.collection.findOneAndUpdate.mockRejectedValue(new Error("Indisponível"));
  expect((await entrar("ana")).status).toBe(503);
  expect(consultas).not.toHaveBeenCalled();
});
