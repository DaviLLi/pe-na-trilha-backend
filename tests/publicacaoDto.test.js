import AuthSession from "../src/models/AuthSession.js";
import { jest } from "@jest/globals";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import app from "../src/app.js";
import Trilha from "../src/models/Trilha.js";
import Usuario from "../src/models/Usuario.js";
import { apresentarTrilha } from "../src/domain/fotoPublicacao.js";

const id = "507f1f77bcf86cd799439011";
const autor = "507f1f77bcf86cd799439012";
const moderador = "507f1f77bcf86cd799439013";
const base = {
  _id: id, titulo: "Trilha", descricao: "Descrição", endereco: "Local", proprietario: autor,
  status: "approved", tipoLocal: "Trilha", dificuldade: "Fácil", duracao: { horas: 1, minutos: 30 },
  motivoRejeicao: "Motivo confidencial", historicoModeracao: [{ acao: "rejected", usuario: moderador, motivo: "Nota confidencial", data: new Date() }],
  __v: 9, segredoInternoFuturo: "segredo", fotos: [{ _id: moderador, publicId: "interno", assetId: "asset", url: "https://cloudinary.test/foto" }],
};
let token;
let anterior;
beforeAll(async () => {
  anterior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString("base64");
  token = await new SignJWT({ sid: "507f1f77bcf86cd799439099" }).setProtectedHeader({ alg: "HS256" }).setSubject(autor).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(process.env.JWT_SECRET));
});
afterAll(() => { if (anterior === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = anterior; });
afterEach(() => jest.restoreAllMocks());
function autenticar(perfil = "user") {
  jest.spyOn(Usuario, "findById").mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: autor, perfil }) });
}
function verificarPublico(dados) {
  expect(dados).toMatchObject({ _id: id, titulo: "Trilha", proprietario: autor, duracao: { horas: 1, minutos: 30 } });
  for (const campo of ["historicoModeracao", "motivoRejeicao", "__v", "segredoInternoFuturo"]) expect(dados).not.toHaveProperty(campo);
  expect(JSON.stringify(dados)).not.toMatch(/confidencial|cloudinary|publicId|assetId/);
  expect(dados.fotos[0].url).toBeNull();
}

test.each(["/trilhas", `/trilhas/${id}`])("%s filtra histórico, motivos e metadados internos", async (rota) => {
  jest.spyOn(Trilha, "find").mockReturnValue({ sort: jest.fn().mockResolvedValue([base]) });
  jest.spyOn(Trilha, "findOne").mockResolvedValue(base);
  const resposta = await request(app).get(rota);
  expect(resposta.status).toBe(200);
  verificarPublico(Array.isArray(resposta.body) ? resposta.body[0] : resposta.body);
  expect(base.historicoModeracao[0].usuario).toBe(moderador);
  expect(base.motivoRejeicao).toBe("Motivo confidencial");
});

test.each(["/trilhas/minhas", `/trilhas/minhas/${id}`, "/trilhas/pendentes"])("%s mantém moderação no contexto autorizado", async (rota) => {
  autenticar(rota.endsWith("pendentes") ? "admin" : "user");
  const buscar = jest.spyOn(Trilha, "find").mockReturnValue({ sort: jest.fn().mockResolvedValue([base]) });
  const detalhe = jest.spyOn(Trilha, "findOne").mockResolvedValue(base);
  const resposta = await request(app).get(rota).set("Authorization", `Bearer ${token}`);
  expect(resposta.status).toBe(200);
  const dados = Array.isArray(resposta.body) ? resposta.body[0] : resposta.body;
  expect(dados.motivoRejeicao).toBe(base.motivoRejeicao);
  expect(dados.historicoModeracao[0]).toMatchObject({ usuario: moderador, motivo: "Nota confidencial" });
  if (rota === "/trilhas/minhas") expect(buscar).toHaveBeenCalledWith({ proprietario: autor });
  if (rota === `/trilhas/minhas/${id}`) expect(detalhe).toHaveBeenCalledWith({ _id: id, proprietario: autor });
});

test.each(["/trilhas/minhas", `/trilhas/minhas/${id}`, "/trilhas/pendentes"])("%s não disponibiliza histórico sem autenticação", async (rota) => {
  expect((await request(app).get(rota)).status).toBe(401);
});
test("usuário comum não acessa fila administrativa", async () => {
  autenticar();
  expect((await request(app).get("/trilhas/pendentes").set("Authorization", `Bearer ${token}`)).status).toBe(403);
});
test("proprietário diferente não recebe histórico", async () => {
  autenticar();
  const buscar = jest.spyOn(Trilha, "findOne").mockResolvedValue(null);
  expect((await request(app).get(`/trilhas/minhas/${id}`).set("Authorization", `Bearer ${token}`)).status).toBe(404);
  expect(buscar).toHaveBeenCalledWith({ _id: id, proprietario: autor });
});
test("DTO público também filtra documentos Mongoose sem alterar o documento", () => {
  const documento = new Trilha(base);
  const dados = apresentarTrilha(documento);
  expect(dados).not.toHaveProperty("historicoModeracao");
  expect(dados).not.toHaveProperty("motivoRejeicao");
  expect(documento.historicoModeracao[0].usuario.toString()).toBe(moderador);
  for (const contexto of ["autor", "admin"]) {
    expect(apresentarTrilha(documento, contexto).historicoModeracao).toHaveLength(1);
  }
});
test("campos estruturados públicos não propagam propriedades internas", () => {
  const dados = apresentarTrilha({ ...base, proprietario: { _id: autor, email: "privado@example.test" }, duracao: { horas: 1, minutos: 30, observacaoInterna: "segredo" } });
  expect(dados.proprietario).toBe(autor);
  expect(dados.duracao).toEqual({ horas: 1, minutos: 30 });
  expect(JSON.stringify(dados)).not.toMatch(/privado@example|observacaoInterna/);
});

beforeEach(() => {
  jest.spyOn(AuthSession, "findOne").mockResolvedValue({ _id: "507f1f77bcf86cd799439099" });
});
