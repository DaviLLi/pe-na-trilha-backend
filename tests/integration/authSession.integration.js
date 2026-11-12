import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import app from "../../src/app.js";
import AuthSession from "../../src/models/AuthSession.js";
import RefreshToken from "../../src/models/RefreshToken.js";
import Usuario from "../../src/models/Usuario.js";
import { conectarComGateDeInfra } from "./infraGate.js";
import {
  carregarAmbienteIntegracao,
  validarBancoDaExecucao,
} from "./ambiente.js";

const config = carregarAmbienteIntegracao();
const bancoExecucao = validarBancoDaExecucao(process.env);
const origin = "http://localhost:5173";
function nomeUsuarioTeste(sufixo) {
  return `u${[...sufixo].map((caractere) => String.fromCharCode(97 + Number.parseInt(caractere, 16))).join("")}`;
}

describe("sessão cookie, renovação e CSRF", () => {
  let conectado = false;

  beforeAll(async () => {
    await conectarComGateDeInfra({
      uri: config.uri,
      hostsPermitidos: config.hostsPermitidos,
      runId: process.env.TEST_RUN_ID,
      conectar: async () => {
        await mongoose.connect(config.uri, { dbName: bancoExecucao });
        return mongoose.connection.db;
      },
      desconectar: () => mongoose.disconnect(),
    });
    conectado = true;
  });

  afterAll(async () => {
    if (conectado) await mongoose.disconnect();
  });

  test("mantém sessão em cookies, renova, valida CSRF e revoga no logout", async () => {
    const sufixo = randomUUID().replaceAll("-", "");
    const usuario = await Usuario.create({
      nomeCompleto: "Usuário Sessão Teste",
      nomeUsuario: nomeUsuarioTeste(sufixo),
      email: `${sufixo}@example.test`,
      senha: "Trilha@123Ab",
    });
    const navegador = request.agent(app);
    try {
      const login = await navegador
        .post("/usuarios/login")
        .set("Origin", origin)
        .send({ identificador: usuario.email, senha: "Trilha@123Ab" });
      expect(login.status).toBe(200);
      expect(login.body).toEqual({
        usuario: expect.objectContaining({ _id: usuario.id, email: usuario.email }),
      });
      expect(login.body).not.toHaveProperty("token");
      expect(login.headers["set-cookie"].join(";")).toContain("HttpOnly");
      expect(login.headers["set-cookie"].join(";")).toContain("SameSite=Lax");

      const sessaoAntes = await AuthSession.findOne({ user: usuario._id });
      expect(sessaoAntes).toBeTruthy();
      const refreshAntes = await RefreshToken.findOne({ session: sessaoAntes._id });
      expect(refreshAntes).toBeTruthy();

      const consulta = await navegador.get("/usuarios/me");
      expect(consulta.status).toBe(200);
      expect(consulta.body._id).toBe(usuario.id);

      const csrf = await navegador.get("/usuarios/csrf");
      expect(csrf.status).toBe(200);
      expect(csrf.body.csrfToken).toEqual(expect.any(String));

      const semCsrf = await navegador.post("/trilhas").set("Origin", origin).send({
        titulo: "Trilha teste", descricao: "Descrição teste", endereco: "Local teste",
      });
      expect(semCsrf.status).toBe(403);

      const criarTrilha = await navegador
        .post("/trilhas")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf.body.csrfToken)
        .send({ titulo: "Trilha teste", descricao: "Descrição teste", endereco: "Local teste" });
      expect(criarTrilha.status).toBe(201);

      const refresh = await navegador.post("/usuarios/refresh").set("Origin", origin);
      expect(refresh.status).toBe(200);
      expect(refresh.body).toHaveProperty("usuario");
      expect(refresh.body).not.toHaveProperty("accessToken");
      expect(refresh.body).not.toHaveProperty("refreshToken");
      expect((await RefreshToken.findOne({ _id: refreshAntes._id })).consumedAt).toBeInstanceOf(Date);

      const csrfAtual = await navegador.get("/usuarios/csrf");
      const logout = await navegador
        .post("/usuarios/logout")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfAtual.body.csrfToken);
      expect(logout.status).toBe(204);
      expect((await AuthSession.findById(sessaoAntes._id)).revokedAt).toBeInstanceOf(Date);
      expect((await navegador.get("/usuarios/me")).status).toBe(401);
    } finally {
      await Usuario.deleteOne({ _id: usuario._id });
    }
  }, 30000);

  test("reuso de refresh consumido revoga a sessão e os refresh tokens", async () => {
    const sufixo = randomUUID().replaceAll("-", "");
    const usuario = await Usuario.create({
      nomeCompleto: "Usuário Reuso Teste",
      nomeUsuario: nomeUsuarioTeste(sufixo),
      email: `${sufixo}@example.test`,
      senha: "Trilha@123Ab",
    });
    const navegador = request.agent(app);
    try {
      const login = await navegador.post("/usuarios/login").set("Origin", origin).send({
        identificador: usuario.email, senha: "Trilha@123Ab",
      });
      const refreshSetCookie = login.headers["set-cookie"].find((cookie) => cookie.startsWith("pnt_refresh="));
      const valorAnterior = decodeURIComponent(refreshSetCookie.split(";")[0].split("=")[1]);
      expect((await navegador.post("/usuarios/refresh").set("Origin", origin)).status).toBe(200);
      await RefreshToken.updateOne(
        {
          session: (await AuthSession.findOne({ user: usuario._id }))._id,
          consumedAt: { $ne: null },
        },
        { $set: { consumedAt: new Date(Date.now() - 6_000) } },
      );

      const replay = await request(app)
        .post("/usuarios/refresh")
        .set("Origin", origin)
        .set("Cookie", `pnt_refresh=${valorAnterior}`);
      expect(replay.status).toBe(401);
      const sessao = await AuthSession.findOne({ user: usuario._id });
      expect(sessao.revokedAt).toBeInstanceOf(Date);
      expect(await RefreshToken.countDocuments({ session: sessao._id, revokedAt: null })).toBe(0);
    } finally {
      await Usuario.deleteOne({ _id: usuario._id });
    }
  }, 30000);

  test("refresh simultâneo em abas não revoga uma sessão legítima", async () => {
    const sufixo = randomUUID().replaceAll("-", "");
    const usuario = await Usuario.create({
      nomeCompleto: "Usuário Refresh Concorrente",
      nomeUsuario: nomeUsuarioTeste(sufixo),
      email: `${sufixo}@example.test`,
      senha: "Trilha@123Ab",
    });
    try {
      const login = await request(app).post("/usuarios/login").set("Origin", origin).send({
        identificador: usuario.email,
        senha: "Trilha@123Ab",
      });
      expect(login.status).toBe(200);
      const refreshSetCookie = login.headers["set-cookie"].find((cookie) => cookie.startsWith("pnt_refresh="));
      const refreshCookie = refreshSetCookie.split(";")[0];

      const respostas = await Promise.all([
        request(app).post("/usuarios/refresh").set("Origin", origin).set("Cookie", refreshCookie),
        request(app).post("/usuarios/refresh").set("Origin", origin).set("Cookie", refreshCookie),
      ]);

      expect(respostas.map(({ status }) => status).sort()).toEqual([200, 409]);
      const respostaConcorrente = respostas.find(({ status }) => status === 409);
      expect(respostaConcorrente.body).toEqual({
        mensagem: "A renovação da sessão já está em andamento; tente novamente.",
      });
      expect(respostaConcorrente.headers["set-cookie"]).toBeUndefined();

      const sessao = await AuthSession.findOne({ user: usuario._id });
      expect(sessao.revokedAt).toBeNull();
      expect(await RefreshToken.countDocuments({
        session: sessao._id,
        consumedAt: null,
        revokedAt: null,
      })).toBe(1);
    } finally {
      await Usuario.deleteOne({ _id: usuario._id });
    }
  }, 30000);
});
