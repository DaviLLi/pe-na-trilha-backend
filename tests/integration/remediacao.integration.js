import { createHmac, randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import mongoose from "mongoose";
import request from "supertest";
import app from "../../src/app.js";
import { VERSAO_PRIVACIDADE, VERSAO_TERMOS } from "../../src/config/documentosLegais.js";
import Usuario from "../../src/models/Usuario.js";
import Trilha from "../../src/models/Trilha.js";
import TentativaLogin from "../../src/models/TentativaLogin.js";
import OperacaoImagem from "../../src/models/OperacaoImagem.js";
import { processarUmaOperacao, recuperarOperacoesExpiradas } from "../../src/services/processarOperacoesImagem.js";
import { criarPublicIdFotoPerfil } from "../../src/services/cloudinaryService.js";
import { carregarAmbienteIntegracao, validarBancoDaExecucao } from "./ambiente.js";
import { conectarComGateDeInfra } from "./infraGate.js";

const config = carregarAmbienteIntegracao();
const banco = validarBancoDaExecucao(process.env);
const origin = "http://localhost:5173";
const senha = "SenhaSintetica1!";
const aceite = { aceiteTermos: true, versaoTermos: VERSAO_TERMOS, versaoPoliticaPrivacidade: VERSAO_PRIVACIDADE };
const dadosTrilha = { titulo: "Trilha de integração", descricao: "Descrição de integração", endereco: "Local de integração" };

function cadastro() {
  const id = randomUUID().replaceAll("-", "");
  return {
    nomeCompleto: "Integração local",
    email: `${id}@example.test`,
    nomeUsuario: `u${id.replace(/[0-9]/g, (digito) => "ghijklmnop"[Number(digito)])}`,
    senha,
  };
}

async function autenticar(usuario) {
  const agente = request.agent(app);
  await agente.post("/usuarios/login").set("Origin", origin)
    .send({ identificador: usuario.email, senha }).expect(200);
  const { body } = await agente.get("/usuarios/csrf").expect(200);
  return { agente, csrf: body.csrfToken };
}

function gravar(sessao, metodo, rota, dados) {
  return sessao.agente[metodo](rota).set("Origin", origin).set("X-CSRF-Token", sessao.csrf).send(dados);
}

describe("remediação no replica set isolado", () => {
  jest.setTimeout(30_000);

  beforeAll(async () => {
    await conectarComGateDeInfra({
      uri: config.uri,
      hostsPermitidos: config.hostsPermitidos,
      runId: process.env.TEST_RUN_ID,
      conectar: async () => {
        await mongoose.connect(config.uri, { dbName: banco });
        return mongoose.connection.db;
      },
      desconectar: () => mongoose.disconnect(),
    });
    await TentativaLogin.createIndexes();
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => mongoose.disconnect());

  test("cadastro direto exige aceite vigente e guarda evidência com data do servidor", async () => {
    const dados = cadastro();
    await request(app).post("/usuarios").send(dados).expect(400);
    await request(app).post("/usuarios").send({ ...dados, ...aceite, versaoTermos: "antiga" }).expect(400);
    expect(await Usuario.exists({ email: dados.email })).toBeNull();
    const inicio = new Date();
    const resposta = await request(app).post("/usuarios").send({
      ...dados, ...aceite, aceitoEm: "2000-01-01",
    }).expect(201);
    const usuario = await Usuario.findById(resposta.body._id).select("+aceiteDocumentos");
    expect(usuario.aceiteDocumentos.versaoTermos).toBe(VERSAO_TERMOS);
    expect(usuario.aceiteDocumentos.versaoPoliticaPrivacidade).toBe(VERSAO_PRIVACIDADE);
    expect(usuario.aceiteDocumentos.aceitoEm.getTime()).toBeGreaterThanOrEqual(inicio.getTime());
    expect(usuario.aceiteDocumentos.aceitoEm.getTime()).toBeLessThanOrEqual(Date.now());
    expect(resposta.body).not.toHaveProperty("aceiteDocumentos");
    const antigo = await Usuario.create(cadastro());
    const { agente } = await autenticar(antigo);
    await agente.get("/usuarios/me").expect(200);
    expect((await Usuario.findById(antigo.id).select("+aceiteDocumentos")).aceiteDocumentos).toBeUndefined();
  });

  test("reserva tentativas atômicas, mantém resposta genérica e libera após expirar", async () => {
    const usuario = await Usuario.create(cadastro());
    const login = (identificador, senha, ip) => request(app).post("/usuarios/login")
      .set("Origin", origin).set("X-Forwarded-For", ip).send({ identificador, senha });
    const proxyAnterior = app.get("trust proxy");
    app.set("trust proxy", "loopback");
    try {
      const inexistente = await login(cadastro().email, "Incorreta", "192.0.2.1");
      const tentativas = await Promise.all(Array.from({ length: 11 }, (_, n) =>
        login(` ${usuario.email.toUpperCase()} `, "Incorreta", `192.0.2.${n + 2}`)));
      const negadas = tentativas.filter(({ status }) => status === 401);
      expect(negadas).toHaveLength(10);
      expect(negadas.every(({ body }) => body.mensagem === inexistente.body.mensagem)).toBe(true);
      expect(inexistente.status).toBe(401);
      expect(tentativas.filter(({ status }) => status === 429)).toHaveLength(1);
      const bloqueada = await login(usuario.email, senha, "192.0.2.15").expect(429);
      expect(Number(bloqueada.headers["retry-after"])).toBeGreaterThan(0);

      const _id = createHmac("sha256", process.env.CSRF_SECRET)
        .update(`login:identificador:${usuario.email}`).digest("hex");
      await TentativaLogin.collection.updateOne({ _id }, { $set: { expiraEm: new Date(0) } });
      await login(usuario.email, senha, "192.0.2.16").expect(200);
      expect(await TentativaLogin.collection.findOne({ _id })).toMatchObject({ tentativas: 1 });
    } finally {
      app.set("trust proxy", proxyAnterior);
    }
  });

  test("moderação protege a revisão consultada e só uma decisão concorrente vence", async () => {
    const autor = await Usuario.create(cadastro());
    const admin = await Usuario.create({ ...cadastro(), perfil: "admin" });
    const sessaoAutor = await autenticar(autor);
    const sessaoAdmin = await autenticar(admin);
    const { body: trilha } = await gravar(sessaoAutor, "post", "/trilhas", dadosTrilha).expect(201);
    const rota = `/trilhas/${trilha._id}`;
    const consultarRevisao = async () => (await sessaoAdmin.agente.get("/trilhas/pendentes").expect(200))
      .body.find(({ _id }) => _id === trilha._id).revisao;
    const revisaoInicial = await consultarRevisao();
    await gravar(sessaoAdmin, "patch", rota, { titulo: "Alteração de terceiro" }).expect(404);
    await gravar(sessaoAutor, "post", `${rota}/moderacao`,
      { status: "approved", revisao: revisaoInicial }).expect(403);
    await gravar(sessaoAutor, "patch", rota, { titulo: "Revisada pelo autor" }).expect(200);
    await gravar(sessaoAdmin, "post", `${rota}/moderacao`,
      { status: "approved", revisao: revisaoInicial }).expect(409);

    const revisao = await consultarRevisao();
    expect(revisao).not.toBe(revisaoInicial);
    const decidir = () => gravar(sessaoAdmin, "post", `${rota}/moderacao`, { status: "approved", revisao });
    expect((await Promise.all([decidir(), decidir()])).map(({ status }) => status).sort()).toEqual([200, 409]);
    await decidir().expect(409);
    const persistida = await Trilha.findById(trilha._id);
    expect(persistida.historicoModeracao).toHaveLength(1);
    await request(app).get(rota).expect(200);
    await gravar(sessaoAutor, "delete", rota).expect(204);
    await request(app).get(rota).expect(404);
  });

  test("limpeza protege fotos vinculadas e recupera órfão após indisponibilidade temporária", async () => {
    const referenciada = criarPublicIdFotoPerfil();
    const fotoPerfil = criarPublicIdFotoPerfil();
    const usuario = await Usuario.create({ ...cadastro(), fotoPerfilPublicId: fotoPerfil });
    const orfa = criarPublicIdFotoPerfil();
    await Trilha.create({ ...dadosTrilha, proprietario: usuario._id, fotos: [{ publicId: referenciada }] });
    const destruir = jest.fn()
      .mockRejectedValueOnce(new Error("Cloudinary sintético indisponível"))
      .mockResolvedValue({ result: "ok" });
    const processar = (agora) => processarUmaOperacao(agora, destruir);
    try {
      const [vinculada, perfil, expirada] = await OperacaoImagem.create([
        { publicId: referenciada, estado: "cleanup_pending", nextAttemptAt: new Date(0) },
        { publicId: fotoPerfil, estado: "cleanup_pending", nextAttemptAt: new Date(0) },
        { publicId: orfa, estado: "uploading", uploadLeaseUntil: new Date(0) },
      ]);
      expect(await processar()).toBe(true);
      expect(await processar()).toBe(true);
      expect(destruir).not.toHaveBeenCalled();
      expect(await OperacaoImagem.findById(vinculada.id)).toMatchObject({ estado: "failed" });
      expect(await OperacaoImagem.findById(perfil.id)).toMatchObject({ estado: "failed" });
      expect(await Trilha.exists({ "fotos.publicId": referenciada })).not.toBeNull();
      await recuperarOperacoesExpiradas();
      const pendente = await OperacaoImagem.findById(expirada.id);
      expect(pendente.estado).toBe("cleanup_pending");
      expect(await processar(new Date(pendente.nextAttemptAt.getTime() + 1))).toBe(true);
      const retry = await OperacaoImagem.findById(expirada.id);
      expect(retry.estado).toBe("cleanup_pending");
      expect(await processar(new Date(retry.nextAttemptAt.getTime() + 1))).toBe(true);
      expect(destruir.mock.calls.map(([id]) => id)).toEqual([orfa, orfa]);
      expect(await OperacaoImagem.findById(expirada.id)).toMatchObject({ estado: "completed" });
    } finally {
      // Estes IDs foram gerados neste teste e nunca enviados ao provedor.
      await OperacaoImagem.deleteMany({ publicId: { $in: [referenciada, fotoPerfil, orfa] } });
    }
  });
});
