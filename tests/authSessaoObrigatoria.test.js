import { jest } from "@jest/globals";
import { randomBytes, createHash } from "node:crypto";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import { SignJWT } from "jose";
import request from "supertest";
const abrirFotoProtegida = jest.fn(async () => Readable.from([Buffer.from("foto")]));
const entrega = await import("../src/services/entregaFotoService.js");
jest.unstable_mockModule("../src/services/entregaFotoService.js", () => ({ ...entrega, abrirFotoProtegida }));
const { default: app } = await import("../src/app.js");
const { default: AuthSession } = await import("../src/models/AuthSession.js");
const { default: RefreshToken } = await import("../src/models/RefreshToken.js");
const { default: Usuario } = await import("../src/models/Usuario.js");
const { default: Trilha } = await import("../src/models/Trilha.js");
const { criarSessaoAuth } = await import("../src/services/authSessionService.js");
const { nomeCookieAccess, nomeCookieRefresh } = await import("../src/config/authCookies.js");
const user = "507f1f77bcf86cd799439011";
const id = "507f1f77bcf86cd799439012";
const fotoId = "507f1f77bcf86cd799439013";
const origem = "http://localhost:5173";
const privada = `/trilhas/minhas/${id}/fotos/${fotoId}/conteudo`;
const administrativa = `/admin/trilhas/${id}/fotos/${fotoId}/conteudo`;
let sessoes, tokens, usuario, auth;
let anterior;
const hash = (valor) => createHash("sha256").update(valor).digest("hex");
const cookies = (sessao) => `${nomeCookieAccess()}=${sessao.accessToken}; ${nomeCookieRefresh()}=${sessao.refreshToken}`;
const sessaoAtual = () => sessoes.get(String(auth.sessionId));
beforeAll(() => {
  const nomes = ["JWT_SECRET", "CSRF_SECRET", "FRONTEND_ORIGINS"];
  anterior = Object.fromEntries(nomes.map((nome) => [nome, process.env[nome]]));
  process.env.JWT_SECRET = randomBytes(32).toString("base64");
  process.env.CSRF_SECRET = randomBytes(32).toString("base64");
  process.env.FRONTEND_ORIGINS = origem;
});
afterAll(() => {
  for (const [nome, valor] of Object.entries(anterior)) {
    if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
  }
});
beforeEach(async () => {
  sessoes = new Map(); tokens = new Map();
  usuario = { _id: user, perfil: "user", nomeCompleto: "Teste", nomeUsuario: "teste", email: "teste@example.test" };
  abrirFotoProtegida.mockClear();
  jest.spyOn(mongoose, "startSession").mockResolvedValue({ withTransaction: async (callback) => callback(), endSession: jest.fn() });
  jest.spyOn(AuthSession, "create").mockImplementation(async (docs) => { docs.forEach((doc) => sessoes.set(String(doc._id), { revokedAt: null, ...doc })); return docs; });
  jest.spyOn(RefreshToken, "create").mockImplementation(async (docs) => { docs.forEach((doc) => tokens.set(doc.tokenHash, { _id: new mongoose.Types.ObjectId(), consumedAt: null, revokedAt: null, ...doc })); return docs; });
  jest.spyOn(AuthSession, "findOne").mockImplementation(async (filtro) => {
    const registro = sessoes.get(String(filtro._id));
    return registro && String(registro.user) === filtro.user && registro.revokedAt === filtro.revokedAt && registro.expiresAt > filtro.expiresAt.$gt ? registro : null;
  });
  jest.spyOn(AuthSession, "findById").mockImplementation((idSessao) => ({ session: async () => sessoes.get(String(idSessao)) || null }));
  jest.spyOn(AuthSession, "updateOne").mockImplementation(async (filtro, update) => {
    const registro = sessoes.get(String(filtro._id));
    if (registro && registro.revokedAt === filtro.revokedAt) Object.assign(registro, update.$set);
    return { modifiedCount: registro ? 1 : 0 };
  });
  jest.spyOn(RefreshToken, "findOne").mockImplementation((filtro) => ({ select: () => ({ session: async () => tokens.get(filtro.tokenHash) || null }) }));
  jest.spyOn(RefreshToken, "findOneAndUpdate").mockImplementation(async (filtro, update) => {
    const registro = [...tokens.values()].find((item) => String(item._id) === String(filtro._id) && item.consumedAt === null && item.revokedAt === null);
    if (registro) Object.assign(registro, update.$set);
    return registro || null;
  });
  jest.spyOn(RefreshToken, "updateMany").mockImplementation(async (filtro, update) => {
    for (const registro of tokens.values()) if (String(registro.session) === String(filtro.session) && registro.revokedAt === null) Object.assign(registro, update.$set);
    return { modifiedCount: 1 };
  });
  jest.spyOn(Usuario, "findById").mockImplementation(() => ({ select: async () => usuario, session: async () => usuario }));
  jest.spyOn(Trilha, "findOne").mockImplementation(async (filtro) => {
    if (filtro.proprietario && filtro.proprietario !== user) return null;
    return { _id: id, status: "pending", proprietario: user, fotos: [{ _id: fotoId, assetId: "asset", publicId: "foto", resourceType: "image", deliveryType: "authenticated", version: 1, format: "webp", width: 1, height: 1, bytes: 10, storageState: "ready" }] };
  });
  auth = await criarSessaoAuth(usuario);
});
afterEach(() => jest.restoreAllMocks());
function consultar(rota, modo = "bearer", access = auth.accessToken) {
  const req = request(app).get(rota);
  return modo === "cookie" ? req.set("Cookie", `${nomeCookieAccess()}=${access}`) : req.set("Authorization", `Bearer ${access}`);
}
async function assinar(claims) {
  return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(user).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(process.env.JWT_SECRET));
}
test.each([undefined, null, "invalido", 42, {}, "507f1f77bcf86cd799439099"])("Bearer com sid inválido/ausente/inexistente %j é negado", async (sid) => {
  const token = await assinar(sid === undefined ? {} : { sid });
  for (const rota of [privada, administrativa, "/usuarios/me", "/usuarios/csrf"]) expect((await consultar(rota, "bearer", token)).status).toBe(401);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
});
test.each(["bearer", "cookie"])("%s com sessão válida permite perfil e foto do autor", async (modo) => {
  expect((await consultar("/usuarios/me", modo)).status).toBe(200);
  expect((await consultar(privada, modo)).status).toBe(200);
  expect(AuthSession.findOne).toHaveBeenCalledWith({ _id: String(auth.sessionId), user, revokedAt: null, expiresAt: { $gt: expect.any(Date) } });
});
test.each(["bearer", "cookie"])("%s com sessão revogada nega novas consultas", async (modo) => {
  sessaoAtual().revokedAt = new Date();
  for (const rota of [privada, administrativa, "/usuarios/me"]) expect((await consultar(rota, modo)).status).toBe(401);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
});
test.each(["bearer", "cookie"])("%s com sessão expirada nega acesso", async (modo) => {
  sessaoAtual().expiresAt = new Date(Date.now() - 1);
  expect((await consultar(privada, modo)).status).toBe(401);
  expect((await consultar("/usuarios/me", modo)).status).toBe(401);
});
test("sessão de outro usuário não autoriza JWT", async () => {
  sessaoAtual().user = fotoId;
  expect((await consultar(privada)).status).toBe(401);
});
test("permissões de proprietário e administrador continuam obrigatórias com sessão ativa", async () => {
  expect((await consultar(administrativa)).status).toBe(403);
  usuario.perfil = "admin";
  expect((await consultar(administrativa)).status).toBe(200);
  Trilha.findOne.mockResolvedValue(null);
  expect((await consultar(privada)).status).toBe(404);
});
test("erro de consulta à sessão não autoriza nem consulta o usuário", async () => {
  AuthSession.findOne.mockRejectedValue(new Error("falha simulada"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  Usuario.findById.mockClear();
  expect((await consultar(privada)).status).toBe(500);
  expect(Usuario.findById).not.toHaveBeenCalled();
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalled();
});
test("cookie inválido não permite fallback para Bearer válido", async () => {
  const semSid = await assinar({});
  expect((await request(app).get(privada).set("Cookie", `${nomeCookieAccess()}=${semSid}`).set("Authorization", `Bearer ${auth.accessToken}`)).status).toBe(401);
});
test("logout revoga sessão e refresh; repetir tokens antigos deixa de autorizar", async () => {
  const csrf = await consultar("/usuarios/csrf", "cookie");
  expect(csrf.status).toBe(200);
  const resposta = await request(app).post("/usuarios/logout").set("Origin", origem).set("Cookie", cookies(auth)).set("X-CSRF-Token", csrf.body.csrfToken);
  expect(resposta.status).toBe(204);
  expect(sessaoAtual().revokedAt).toBeInstanceOf(Date);
  for (const modo of ["cookie", "bearer"]) {
    expect((await consultar(privada, modo)).status).toBe(401);
    expect((await consultar("/usuarios/me", modo)).status).toBe(401);
  }
  expect((await request(app).post("/usuarios/refresh").set("Origin", origem).set("Cookie", cookies(auth))).status).toBe(401);
});
test("refresh rotaciona token, preserva sid e novo access autoriza foto; replay revoga", async () => {
  const resposta = await request(app).post("/usuarios/refresh").set("Origin", origem).set("Cookie", cookies(auth));
  expect(resposta.status).toBe(200);
  const novos = resposta.headers["set-cookie"];
  const access = novos.find((cookie) => cookie.startsWith(nomeCookieAccess() + "=")).split(";")[0].slice(nomeCookieAccess().length + 1);
  const refresh = novos.find((cookie) => cookie.startsWith(nomeCookieRefresh() + "=")).split(";")[0].slice(nomeCookieRefresh().length + 1);
  expect(refresh).not.toBe(auth.refreshToken);
  expect(tokens.get(hash(auth.refreshToken)).consumedAt).toBeInstanceOf(Date);
  expect((await consultar(privada, "bearer", access)).status).toBe(200);
  expect((await consultar(privada, "cookie", access)).status).toBe(200);
  expect(resposta.body).not.toHaveProperty("accessToken");
  tokens.get(hash(auth.refreshToken)).consumedAt = new Date(Date.now() - 6000);
  expect((await request(app).post("/usuarios/refresh").set("Origin", origem).set("Cookie", cookies(auth))).status).toBe(401);
  expect((await consultar(privada, "bearer", access)).status).toBe(401);
});

test("refresh concorrente recebe 409 sem revogar sessão legítima", async () => {
  expect((await request(app).post("/usuarios/refresh").set("Origin", origem).set("Cookie", cookies(auth))).status).toBe(200);
  const repetir = await request(app).post("/usuarios/refresh").set("Origin", origem).set("Cookie", cookies(auth));
  expect(repetir.status).toBe(409);
  expect(sessaoAtual().revokedAt).toBeNull();
  expect((await consultar(privada)).status).toBe(200);
});
test("refresh de sessão expirada não emite novos tokens", async () => {
  sessaoAtual().expiresAt = new Date(Date.now() - 1);
  const resposta = await request(app).post("/usuarios/refresh").set("Origin", origem).set("Cookie", cookies(auth));
  expect(resposta.status).toBe(401);
  expect(tokens.size).toBe(1);
});
test("cookie revogado é limpo e não pode ser substituído por Bearer na mesma requisição", async () => {
  const antiga = auth;
  sessaoAtual().revokedAt = new Date();
  const nova = await criarSessaoAuth(usuario);
  const resposta = await request(app).get(privada).set("Cookie", `${nomeCookieAccess()}=${antiga.accessToken}`).set("Authorization", `Bearer ${nova.accessToken}`);
  expect(resposta.status).toBe(401);
  expect(resposta.headers["set-cookie"].join(";")).toContain(`${nomeCookieAccess()}=;`);
});
test("logout com Bearer revoga a sessão e impede reutilização", async () => {
  const resposta = await request(app).post("/usuarios/logout").set("Origin", origem).set("Authorization", `Bearer ${auth.accessToken}`);
  expect(resposta.status).toBe(204);
  expect((await consultar(privada)).status).toBe(401);
});
