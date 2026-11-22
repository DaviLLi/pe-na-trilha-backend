import { jest } from "@jest/globals";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import mongoose from "mongoose";
import request from "supertest";
import app from "../src/app.js";
import { nomeCookieAccess } from "../src/config/authCookies.js";
import { gerarTokenCsrf } from "../src/config/csrf.js";
import { obterChaveJwt } from "../src/config/jwt.js";
import AuthSession from "../src/models/AuthSession.js";
import Usuario from "../src/models/Usuario.js";
import { alterarPerfilAdmin } from "../src/services/gerenciarAdministradores.js";

const base = "/admin/administradores";
const idPrincipal = new mongoose.Types.ObjectId();
const idAdmin = new mongoose.Types.ObjectId();
const idUser = new mongoose.Types.ObjectId();
const sessaoId = new mongoose.Types.ObjectId();
const senha = "Credencial-sintetica-123!";
const ambienteOriginal = { JWT_SECRET: process.env.JWT_SECRET, CSRF_SECRET: process.env.CSRF_SECRET };
let hash, tokens;

beforeAll(async () => {
  for (const chave of Object.keys(ambienteOriginal)) process.env[chave] = randomBytes(32).toString("base64");
  hash = await bcrypt.hash(senha, 4);
  tokens = new Map();
  for (const id of [idPrincipal, idAdmin, idUser]) {
    const token = await new SignJWT({ sid: sessaoId.toString(), perfil: "admin", principal: true })
      .setProtectedHeader({ alg: "HS256" }).setSubject(id.toString())
      .setIssuedAt().setExpirationTime("15m").sign(obterChaveJwt());
    tokens.set(id, token);
  }
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  for (const [chave, valor] of Object.entries(ambienteOriginal)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
});

function preparar() {
  const data = new Date("2026-01-01T00:00:00.000Z");
  const conta = (_id, email, perfil) => ({
    _id, email, perfil, nomeCompleto: "Conta de teste",
    senha: hash, fotoPerfilPublicId: "foto-privada", updatedAt: data, createdAt: data,
  });
  const principal = conta(idPrincipal, "principal@example.test", "admin");
  const admin = conta(idAdmin, "admin@example.test", "admin");
  const user = conta(idUser, "user@example.test", "user");
  const contas = [principal, admin, user];
  const controle = { findOne: jest.fn().mockResolvedValue({ usuario: idPrincipal }) };
  const auditoria = { insertOne: jest.fn().mockResolvedValue({ acknowledged: true }) };
  let contador = 0;
  const tentativas = { findOneAndUpdate: jest.fn(async () => ({ tentativas: ++contador })) };
  const colecoes = { provisionamentoAdministrativo: controle, auditoriaAdministrativa: auditoria, confirmacoesAdministrativas: tentativas };
  jest.spyOn(mongoose.connection, "collection").mockImplementation((nome) => {
    if (!Object.hasOwn(colecoes, nome)) throw new Error("Coleção inesperada");
    return colecoes[nome];
  });
  const sessao = {
    withTransaction: jest.fn(async (operacao) => {
      const papeis = contas.map((u) => u.perfil);
      try { return await operacao(); } catch (erro) {
        contas.forEach((u, i) => { u.perfil = papeis[i]; });
        throw erro;
      }
    }),
    endSession: jest.fn(),
  };
  const iniciarSessao = jest.spyOn(mongoose, "startSession").mockResolvedValue(sessao);
  jest.spyOn(AuthSession, "findOne").mockResolvedValue({ _id: sessaoId });
  function consulta(obter) {
    return {
      select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      then: (resolver) => Promise.resolve(obter()).then(resolver),
    };
  }
  jest.spyOn(Usuario, "findById").mockImplementation((id) => consulta(() => {
    const encontrado = contas.find((u) => u._id.equals(id));
    return encontrado ? { ...encontrado } : null;
  }));
  const buscar = jest.spyOn(Usuario, "find").mockImplementation((filtros) => consulta(() => contas
    .filter((u) => Object.entries(filtros).every(([chave, valor]) => u[chave] === valor))
    .map((u) => ({ ...u }))));
  const alterar = jest.spyOn(Usuario, "updateOne").mockImplementation(async ({ _id, email, perfil }, { $set }) => {
    const alvo = contas.find((u) => u._id.equals(_id) && u.email === email && u.perfil === perfil);
    if (!alvo) return { modifiedCount: 0 };
    Object.assign(alvo, $set);
    return { modifiedCount: 1 };
  });
  return { principal, admin, user, controle, auditoria, tentativas, alterar, buscar, iniciarSessao, sessao };
}

function chamar(acao = "", usuario = idPrincipal, csrf = gerarTokenCsrf(sessaoId)) {
  const cliente = request(app);
  const requisicao = acao ? cliente.post(base + "/" + acao) : cliente.get(base);
  if (usuario) requisicao.set("Cookie", nomeCookieAccess() + "=" + tokens.get(usuario));
  if (csrf) requisicao.set("X-CSRF-Token", csrf);
  return requisicao;
}

test("só o ObjectId do marcador recebe a lista e a resposta expõe apenas o DTO permitido", async () => {
  const t = preparar();
  t.principal.email = "principal-alterado@example.test";
  const resposta = await chamar();
  expect(resposta.status).toBe(200);
  expect(resposta.headers["cache-control"]).toBe("no-store");
  expect(resposta.body).toEqual({ administradores: [
    { _id: idPrincipal.toString(), nomeCompleto: t.principal.nomeCompleto, email: t.principal.email, principal: true },
    { _id: idAdmin.toString(), nomeCompleto: t.admin.nomeCompleto, email: t.admin.email, principal: false },
  ] });
  expect(t.tentativas.findOneAndUpdate).not.toHaveBeenCalled();
  expect(t.auditoria.insertOne).not.toHaveBeenCalled();
});

test.each([["administrador comum", idAdmin], ["usuário comum", idUser]])("bloqueia as três operações para %s com 403", async (_rotulo, id) => {
  const t = preparar();
  expect((await chamar("", id)).status).toBe(403);
  for (const acao of ["promover", "remover"]) {
    const resposta = await chamar(acao, id).send({ email: t.user.email, senha });
    expect(resposta.status).toBe(403);
  }
  expect(t.buscar).not.toHaveBeenCalled();
  expect(t.tentativas.findOneAndUpdate).not.toHaveBeenCalled();
  expect(t.iniciarSessao).not.toHaveBeenCalled();
});

test("exige sessão e protege mutações por CSRF sem permitir omissão com bearer", async () => {
  const t = preparar();
  expect((await chamar("", null)).status).toBe(401);
  for (const csrf of [null, "invalido"]) {
    const resposta = await chamar("promover", idPrincipal, csrf).send({ email: t.user.email, senha });
    expect(resposta.status).toBe(403);
  }
  const bearer = await request(app).post(base + "/promover")
    .set("Authorization", "Bearer " + tokens.get(idPrincipal)).send({ email: t.user.email, senha });
  expect(bearer.status).toBe(403);
  expect(t.tentativas.findOneAndUpdate).not.toHaveBeenCalled();
  expect(t.alterar).not.toHaveBeenCalled();
});

test("promove com a senha do principal, escreve só perfil e audita ator, alvo, ação e data", async () => {
  const t = preparar();
  const alvoAntes = { ...t.user }, principalAntes = { ...t.principal };
  const resposta = await chamar("promover").send({ email: t.user.email, senha });
  expect(resposta.status).toBe(204);
  expect(t.user).toEqual({ ...alvoAntes, perfil: "admin" });
  expect(t.principal).toEqual(principalAntes);
  expect(t.alterar.mock.calls[0][1]).toEqual({ $set: { perfil: "admin" } });
  expect(t.alterar.mock.calls[0][2]).toMatchObject({ timestamps: false, session: t.sessao });
  expect(t.auditoria.insertOne).toHaveBeenCalledWith(
    { ator: idPrincipal, alvo: idUser, acao: "promover", criadoEm: expect.any(Date) },
    { session: t.sessao },
  );
  const registro = t.auditoria.insertOne.mock.calls[0][0];
  expect(JSON.stringify(registro)).not.toContain(senha);
  expect(JSON.stringify(registro)).not.toContain(hash);
  expect(Object.keys(registro).sort()).toEqual(["acao", "alvo", "ator", "criadoEm"]);
});

test("remove o último admin comum mantendo o principal e exige senha em cada chamada", async () => {
  const t = preparar();
  expect((await chamar("remover").send({ email: t.admin.email, senha })).status).toBe(204);
  expect(t.admin.perfil).toBe("user");
  expect(t.principal.perfil).toBe("admin");
  expect(t.auditoria.insertOne.mock.calls[0][0]).toMatchObject({ ator: idPrincipal, alvo: idAdmin, acao: "remover" });
  expect((await chamar("promover").send({ email: t.user.email })).status).toBe(400);
  expect(t.user.perfil).toBe("user");
  expect(t.alterar).toHaveBeenCalledTimes(1);
});

test("senha incorreta falha antes de buscar o alvo ou iniciar a transação", async () => {
  const t = preparar();
  const resposta = await chamar("promover").send({ email: t.user.email, senha: "senha-errada" });
  expect(resposta.status).toBe(403);
  expect(resposta.body).toEqual({ mensagem: "Não foi possível confirmar sua identidade." });
  expect(t.buscar).not.toHaveBeenCalled();
  expect(t.iniciarSessao).not.toHaveBeenCalled();
  expect(t.auditoria.insertOne).not.toHaveBeenCalled();
});

test("limita tentativas compartilhadas por ações e canal e bloqueia antes de chamar bcrypt", async () => {
  const t = preparar();
  const comparar = jest.spyOn(bcrypt, "compare");
  await expect(alterarPerfilAdmin({
    acao: "promover", email: t.user.email, senha: "errada", operadorEmail: t.principal.email, confirmado: true,
  })).rejects.toMatchObject({ codigo: "IDENTIDADE_NAO_CONFIRMADA" });
  for (const acao of ["promover", "remover", "promover", "remover"]) {
    expect((await chamar(acao).send({ email: t.user.email, senha: "errada" })).status).toBe(403);
  }
  const bloqueado = await chamar("remover").send({ email: t.admin.email, senha });
  expect(bloqueado.status).toBe(429);
  expect(comparar).toHaveBeenCalledTimes(5);
  expect(t.tentativas.findOneAndUpdate).toHaveBeenCalledTimes(6);
  expect(t.tentativas.findOneAndUpdate.mock.calls.every(([filtro]) => filtro._id.equals(idPrincipal))).toBe(true);
  expect(t.alterar).not.toHaveBeenCalled();
});

test.each([
  ["remover", "principal", 403], ["remover", "user", 409], ["promover", "admin", 409],
  ["promover", "inexistente", 404],
])("valida o alvo de %s para %s", async (acao, alvo, status) => {
  const t = preparar();
  const email = t[alvo]?.email ?? "inexistente@example.test";
  expect((await chamar(acao).send({ email, senha })).status).toBe(status);
  expect(t.alterar).not.toHaveBeenCalled();
  expect(t.auditoria.insertOne).not.toHaveBeenCalled();
});

test("recusa campos que tentem mudar ator, perfil ou marcador", async () => {
  const t = preparar();
  const dados = { email: t.user.email, senha, ator: idAdmin.toString(), perfil: "principal" };
  expect((await chamar("promover").send(dados)).status).toBe(400);
  expect(t.controle.findOne).toHaveBeenCalledTimes(1);
  expect(t.tentativas.findOneAndUpdate).not.toHaveBeenCalled();
  expect(t.alterar).not.toHaveBeenCalled();
});

test("falha fechada se o marcador estiver ausente", async () => {
  const t = preparar();
  t.controle.findOne.mockResolvedValue(null);
  expect((await chamar()).status).toBe(403);
  expect((await chamar("promover").send({ email: t.user.email, senha })).status).toBe(403);
  expect(t.alterar).not.toHaveBeenCalled();
});

test("a auditoria indisponível cancela a mudança e erros com dados sensíveis não são logados", async () => {
  const t = preparar();
  const consoleErro = jest.spyOn(console, "error").mockImplementation(() => {});
  t.auditoria.insertOne.mockRejectedValue(new Error("detalhe privado: " + senha));
  expect((await chamar("promover").send({ email: t.user.email, senha })).status).toBe(500);
  expect(t.user.perfil).toBe("user");
  expect(consoleErro.mock.calls).toEqual([["Falha interna no gerenciamento administrativo."]]);
});

test("JSON malformado com senha e corpos excessivos não geram logs brutos", async () => {
  preparar();
  const consoleErro = jest.spyOn(console, "error").mockImplementation(() => {});
  const malformado = await chamar("promover").type("json").send('{"senha":"' + senha + '"');
  expect(malformado.status).toBe(400);
  const grande = await chamar("promover").send({ email: "x".repeat(2500), senha });
  expect(grande.status).toBe(413);
  expect(consoleErro).not.toHaveBeenCalled();
  expect(JSON.stringify(malformado.body)).not.toContain(senha);
});
