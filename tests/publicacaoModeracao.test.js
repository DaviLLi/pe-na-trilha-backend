import { jest } from "@jest/globals";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import app from "../src/app.js";
import Trilha from "../src/models/Trilha.js";
import Usuario from "../src/models/Usuario.js";
import OperacaoImagem from "../src/models/OperacaoImagem.js";
import { OPCOES, CARACTERISTICAS } from "../src/domain/publicacao.js";

const autor = "507f1f77bcf86cd799439011";
const id = "507f1f77bcf86cd799439012";
const fotoId = "507f1f77bcf86cd799439013";
let segredoAnterior;
let token;
let registro;
let atualizar;
beforeAll(async () => {
  segredoAnterior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString("base64");
  token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(autor)
    .setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(process.env.JWT_SECRET));
});
afterAll(() => {
  if (segredoAnterior === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = segredoAnterior;
});
beforeEach(() => {
  registro = { _id: id, proprietario: autor, status: "approved", titulo: "Original", descricao: "Original", endereco: "Original", updatedAt: new Date(), historicoModeracao: [] };
  jest.spyOn(Usuario, "findById").mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: autor, perfil: "user" }) });
  jest.spyOn(Trilha, "findOne").mockImplementation(async (filtro) => filtro.proprietario && filtro.proprietario !== registro.proprietario ? null : registro);
  jest.spyOn(Trilha, "exists").mockImplementation(async (filtro) => filtro.proprietario === registro.proprietario ? { _id: id } : null);
  atualizar = jest.spyOn(Trilha, "findOneAndUpdate").mockImplementation(async (filtro, update) => {
    if (filtro.status !== registro.status || (filtro.proprietario && filtro.proprietario !== registro.proprietario)) return null;
    Object.assign(registro, update.$set);
    if (update.$push) registro.historicoModeracao.push(update.$push.historicoModeracao);
    return registro;
  });
});
afterEach(() => jest.restoreAllMocks());
const editar = (dados) => request(app).patch(`/trilhas/${id}`).set("Authorization", `Bearer ${token}`).send(dados);

test.each(["titulo", "descricao", "endereco", "fotos"])("aprovada bloqueia %s sem salvar nem mesmo duração permitida", async (campo) => {
  const resposta = await editar({ [campo]: campo === "fotos" ? [] : "Novo", duracao: { horas: 1, minutos: 0 } });
  expect([400, 403]).toContain(resposta.status);
  expect(atualizar).not.toHaveBeenCalled();
  expect(registro).not.toHaveProperty("duracao");
  expect(registro.titulo).toBe("Original");
});

test("aprovada permite as dez características e duração sem alterar status", async () => {
  const detalhes = Object.fromEntries(Object.entries(OPCOES).map(([campo, valores]) => [campo, valores[0]]));
  detalhes.caracteristicaPrincipal = CARACTERISTICAS.Trilha[0];
  detalhes.duracao = { horas: 2, minutos: 30 };
  const resposta = await editar(detalhes);
  expect(resposta.status).toBe(200);
  expect(resposta.body).toMatchObject({ ...detalhes, status: "approved", titulo: "Original" });
  expect(atualizar.mock.calls[0][0]).toMatchObject({ status: "approved", updatedAt: registro.updatedAt, proprietario: autor });
});

test("permite limpar opcionais e duração com null", async () => {
  const resposta = await editar({ tipoLocal: null, caracteristicaPrincipal: null, duracao: null });
  expect(resposta.status).toBe(200);
  expect(resposta.body.duracao).toBeNull();
});

test.each([{}, { horas: 0, minutos: 0 }, { horas: 24, minutos: 0 }, { horas: 1, minutos: 60 }, { horas: 1.5, minutos: 0 }, "2h", { horas: 1, minutos: 0, extra: true }])("rejeita duração inválida %j", async (duracao) => {
  expect((await editar({ duracao })).status).toBe(400);
  expect(atualizar).not.toHaveBeenCalled();
});

test("rejeita característica incompatível e limpa destaque ao trocar tipo", async () => {
  expect((await editar({ tipoLocal: "Praia", caracteristicaPrincipal: "Mirante" })).status).toBe(400);
  registro.tipoLocal = "Trilha";
  registro.caracteristicaPrincipal = "Mirante";
  expect((await editar({ tipoLocal: "Praia" })).body.caracteristicaPrincipal).toBeNull();
});

test.each(["pending", "rejected"])("%s permite dados básicos sem mudar status nem rejeição", async (status) => {
  registro.status = status;
  registro.motivoRejeicao = "Corrigir endereço";
  registro.historicoModeracao = [{ acao: "rejected", motivo: "Corrigir endereço" }];
  const resposta = await editar({ titulo: "Corrigido", descricao: "Correção", endereco: "Local" });
  expect(resposta.status).toBe(200);
  expect(resposta.body).toMatchObject({ status, titulo: "Corrigido", motivoRejeicao: "Corrigir endereço" });
  expect(resposta.body.historicoModeracao).toHaveLength(1);
});

test.each(["status", "motivoRejeicao", "historicoModeracao", "proprietario", "$set", "fotos.0.url"])("edição rejeita manipulação de %s", async (campo) => {
  expect((await editar({ [campo]: "approved" })).status).toBe(400);
  expect(atualizar).not.toHaveBeenCalled();
});

test("outro usuário não pode editar", async () => {
  registro.proprietario = fotoId;
  expect((await editar({ duracao: null })).status).toBe(404);
  expect(atualizar).not.toHaveBeenCalled();
});

test("conflito concorrente não salva atualização", async () => {
  atualizar.mockResolvedValue(null);
  expect((await editar({ duracao: null })).status).toBe(409);
});

test.each(["post", "put", "delete"])("aprovada bloqueia %s de fotos antes de upload ou limpeza", async (metodo) => {
  const criar = jest.spyOn(OperacaoImagem, "create");
  const rota = `/trilhas/${id}/fotos${metodo === "post" ? "" : `/${fotoId}`}`;
  expect((await request(app)[metodo](rota).set("Authorization", `Bearer ${token}`)).status).toBe(403);
  expect(criar).not.toHaveBeenCalled();
  expect(atualizar).not.toHaveBeenCalled();
});

test.each(["pending", "rejected"])("%s passa autorização de fotos e chega ao serviço", async (status) => {
  registro.status = status;
  const anterior = [process.env.CLOUDINARY_CLOUD_NAME, process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET];
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
  try {
    expect((await request(app).post(`/trilhas/${id}/fotos`).set("Authorization", `Bearer ${token}`)).status).toBe(503);
  } finally {
    ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].forEach((campo, i) => {
      if (anterior[i] === undefined) delete process.env[campo]; else process.env[campo] = anterior[i];
    });
  }
});

const reenviar = (dados = {}) => request(app).post(`/trilhas/${id}/reenviar`).set("Authorization", `Bearer ${token}`).send(dados);
test("somente reenvio explícito muda rejected para pending preservando motivo e histórico", async () => {
  registro.status = "rejected";
  registro.motivoRejeicao = "Foto inadequada";
  registro.historicoModeracao = [{ acao: "rejected", motivo: "Foto inadequada" }];
  const resposta = await reenviar();
  expect(resposta.status).toBe(200);
  expect(resposta.body).toMatchObject({ status: "pending", motivoRejeicao: "Foto inadequada" });
  expect(resposta.body.historicoModeracao.map((item) => item.acao)).toEqual(["rejected", "resubmitted"]);
});
test.each(["approved", "pending"])("%s não pode ser reenviada", async (status) => {
  registro.status = status;
  expect((await reenviar()).status).toBe(409);
});
test("reenvio exige propriedade e não aceita dados", async () => {
  expect((await reenviar({ titulo: "Alterar" })).status).toBe(400);
  registro.proprietario = fotoId;
  expect((await reenviar()).status).toBe(404);
});

test("usuário comum não pode moderar ou listar pendentes", async () => {
  expect((await request(app).post(`/trilhas/${id}/moderacao`).set("Authorization", `Bearer ${token}`).send({ status: "approved" })).status).toBe(403);
  expect((await request(app).get("/trilhas/pendentes").set("Authorization", `Bearer ${token}`)).status).toBe(403);
  expect(atualizar).not.toHaveBeenCalled();
});

test.each(["approved", "rejected"])("admin decide %s apenas em pendente e registra histórico", async (status) => {
  Usuario.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: autor, perfil: "admin" }) });
  registro.status = "pending";
  const resposta = await request(app).post(`/trilhas/${id}/moderacao`).set("Authorization", `Bearer ${token}`)
    .send(status === "rejected" ? { status, motivo: "Corrigir fotos" } : { status });
  expect(resposta.status).toBe(200);
  expect(resposta.body.status).toBe(status);
  expect(resposta.body.historicoModeracao[0]).toMatchObject({ acao: status, usuario: autor });
  expect((await request(app).post(`/trilhas/${id}/moderacao`).set("Authorization", `Bearer ${token}`).send({ status: "approved" })).status).toBe(409);
});

test("admin não rejeita sem motivo", async () => {
  Usuario.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: autor, perfil: "admin" }) });
  expect((await request(app).post(`/trilhas/${id}/moderacao`).set("Authorization", `Bearer ${token}`).send({ status: "rejected" })).status).toBe(400);
  expect(atualizar).not.toHaveBeenCalled();
});

test.each(["post", "put", "patch"])("%s não permite forjar status ou autoria", async (metodo) => {
  const criar = jest.spyOn(Trilha, "create");
  const resposta = await request(app)[metodo](metodo === "post" ? "/trilhas" : `/trilhas/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ titulo: "Título", descricao: "Descrição", endereco: "Local", status: "approved" });
  expect(resposta.status).toBe(400);
  expect(criar).not.toHaveBeenCalled();
  expect(atualizar).not.toHaveBeenCalled();
});

test("PUT também bloqueia alteração básica em aprovada", async () => {
  expect((await request(app).put(`/trilhas/${id}`).set("Authorization", `Bearer ${token}`)
    .send({ titulo: "Novo", descricao: "Nova", endereco: "Novo" })).status).toBe(403);
  expect(atualizar).not.toHaveBeenCalled();
});

test("publicação legada sem status exige revisão antes de editar", async () => {
  delete registro.status;
  expect((await editar({ titulo: "Novo" })).status).toBe(409);
  expect(atualizar).not.toHaveBeenCalled();
});

test.each(["/trilhas/minhas", `/trilhas/minhas/${id}`, "/trilhas/pendentes"])("consulta privada %s exige autenticação", async (rota) => {
  expect((await request(app).get(rota)).status).toBe(401);
});

test.each(["reenviar", "moderacao"])("ação %s exige autenticação", async (acao) => {
  expect((await request(app).post(`/trilhas/${id}/${acao}`).send({})).status).toBe(401);
});

test("autor consulta rejeitada com motivo e histórico; outro usuário recebe 404", async () => {
  registro.status = "rejected";
  registro.motivoRejeicao = "Corrigir localização";
  const resposta = await request(app).get(`/trilhas/minhas/${id}`).set("Authorization", `Bearer ${token}`);
  expect(resposta.status).toBe(200);
  expect(resposta.body.motivoRejeicao).toBe("Corrigir localização");
  registro.proprietario = fotoId;
  expect((await request(app).get(`/trilhas/minhas/${id}`).set("Authorization", `Bearer ${token}`)).status).toBe(404);
});

test("criação persiste os detalhes e sempre inicia pending", async () => {
  const criar = jest.spyOn(Trilha, "create").mockImplementation(async (dados) => dados);
  const resposta = await request(app).post("/trilhas").set("Authorization", `Bearer ${token}`)
    .send({ titulo: "Título", descricao: "Descrição", endereco: "Local", tipoLocal: "Praia", caracteristicaPrincipal: "Mar", duracao: null });
  expect(resposta.status).toBe(201);
  expect(criar).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", tipoLocal: "Praia", caracteristicaPrincipal: "Mar", proprietario: autor, duracao: null }));
});

test("consulta pública não revela publicação pendente ou rejeitada", async () => {
  Trilha.findOne.mockResolvedValue(null);
  expect((await request(app).get(`/trilhas/${id}`)).status).toBe(404);
  expect(Trilha.findOne).toHaveBeenCalledWith({ _id: id, status: "approved" });
});

test("admin não pode editar publicação de outro autor", async () => {
  Usuario.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: autor, perfil: "admin" }) });
  registro.proprietario = fotoId;
  expect((await editar({ titulo: "Novo" })).status).toBe(404);
  expect(atualizar).not.toHaveBeenCalled();
});

test("listagem própria inclui filtro de proprietário e preserva rejeição", async () => {
  registro.status = "rejected";
  registro.motivoRejeicao = "Corrigir fotos";
  const buscar = jest.spyOn(Trilha, "find").mockReturnValue({ sort: jest.fn().mockResolvedValue([registro]) });
  const resposta = await request(app).get("/trilhas/minhas").set("Authorization", `Bearer ${token}`);
  expect(resposta.status).toBe(200);
  expect(buscar).toHaveBeenCalledWith({ proprietario: autor });
  expect(resposta.body[0]).toMatchObject({ status: "rejected", motivoRejeicao: "Corrigir fotos" });
});
