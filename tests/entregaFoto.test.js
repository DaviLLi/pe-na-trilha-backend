import AuthSession from "../src/models/AuthSession.js";
import { jest } from "@jest/globals";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";

const abrirFotoProtegida = jest.fn();
const real = await import("../src/services/entregaFotoService.js");
jest.unstable_mockModule("../src/services/entregaFotoService.js", () => ({ ...real, abrirFotoProtegida }));
const { default: app } = await import("../src/app.js");
const { default: Trilha } = await import("../src/models/Trilha.js");
const { default: Usuario } = await import("../src/models/Usuario.js");
const { apresentarTrilha } = await import("../src/domain/fotoPublicacao.js");
const id = "507f1f77bcf86cd799439011";
const fotoId = "507f1f77bcf86cd799439012";
const autor = "507f1f77bcf86cd799439013";
const outro = "507f1f77bcf86cd799439014";
const fotoBase = { _id: fotoId, assetId: "asset", publicId: "public-id-confidencial", resourceType: "image", deliveryType: "authenticated", version: 1, format: "webp", width: 800, height: 600, bytes: 100, storageState: "ready" };
let trilha;
let token;
let segredoAnterior;
let consulta;
beforeAll(async () => {
  segredoAnterior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString("base64");
  token = await new SignJWT({ sid: "507f1f77bcf86cd799439099" }).setProtectedHeader({ alg: "HS256" }).setSubject(autor).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(process.env.JWT_SECRET));
});
afterAll(() => {
  if (segredoAnterior === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = segredoAnterior;
});
beforeEach(() => {
  jest.spyOn(AuthSession, "findOne").mockResolvedValue({ _id: "507f1f77bcf86cd799439099" });
  abrirFotoProtegida.mockReset().mockImplementation(async () => Readable.from([Buffer.from("imagem") ]));
  trilha = { _id: id, status: "pending", proprietario: autor, fotos: [{ ...fotoBase }] };
  jest.spyOn(Usuario, "findById").mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: autor, perfil: "user" }) });
  consulta = jest.spyOn(Trilha, "findOne").mockImplementation(async (filtro) => {
    if (String(filtro._id) !== String(trilha._id)) return null;
    if (filtro.proprietario && filtro.proprietario !== trilha.proprietario) return null;
    if (typeof filtro.status === "string" && filtro.status !== trilha.status) return null;
    if (filtro.status?.$in && !filtro.status.$in.includes(trilha.status)) return null;
    if (!trilha.fotos.some((foto) => foto._id === filtro["fotos._id"])) return null;
    return trilha;
  });
});
afterEach(() => jest.restoreAllMocks());
const publico = `/trilhas/${id}/fotos/${fotoId}/conteudo`;
const privado = `/trilhas/minhas/${id}/fotos/${fotoId}/conteudo`;
const admin = `/admin/trilhas/${id}/fotos/${fotoId}/conteudo`;
const get = (url) => request(app).get(url).set("Authorization", `Bearer ${token}`);

test.each(["pending", "rejected"])("visitante não acessa %s", async (status) => {
  trilha.status = status;
  expect((await request(app).get(publico)).status).toBe(404);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
});
test.each(["pending", "rejected", "approved"])("autor visualiza %s por stream sem redirect", async (status) => {
  trilha.status = status;
  const resposta = await get(privado);
  expect(resposta.status).toBe(200);
  expect(resposta.body.toString()).toBe("imagem");
  expect(resposta.headers["content-type"]).toContain("image/webp");
  expect(resposta.headers["cache-control"]).toBe("private, no-store");
  expect(resposta.headers["x-content-type-options"]).toBe("nosniff");
  expect(resposta.headers).not.toHaveProperty("location");
  expect(JSON.stringify(resposta.headers)).not.toContain("cloudinary");
});
test("outro usuário não acessa privada", async () => {
  trilha.proprietario = outro;
  expect((await get(privado)).status).toBe(404);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
});
test.each(["pending", "rejected", "approved"])("admin visualiza %s", async (status) => {
  trilha.status = status;
  Usuario.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: autor, perfil: "admin" }) });
  expect((await get(admin)).status).toBe(200);
  expect(consulta).toHaveBeenCalledWith(expect.not.objectContaining({ proprietario: expect.anything() }), null, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
test("admin endpoint rejeita usuário comum; endpoints privados exigem sessão", async () => {
  expect((await get(admin)).status).toBe(403);
  expect((await request(app).get(privado)).status).toBe(401);
  expect((await request(app).get(admin)).status).toBe(401);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
});
test("visitante recebe aprovada", async () => {
  trilha.status = "approved";
  expect((await request(app).get(publico)).status).toBe(200);
});
test.each(["legacy_public", "migration_pending", "blocked", undefined])("bloqueia armazenamento %s", async (storageState) => {
  trilha.fotos[0].storageState = storageState;
  expect((await get(privado)).status).toBe(404);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
});
test.each(["assetId", "publicId", "version", "format", "width", "bytes"])("bloqueia metadado incompleto %s", async (campo) => {
  delete trilha.fotos[0][campo];
  expect((await get(privado)).status).toBe(404);
});
test("bloqueia tipo público mesmo marcado ready", async () => {
  trilha.fotos[0].deliveryType = "upload";
  expect((await get(privado)).status).toBe(404);
});
test("foto removida ou pertencente a outra publicação não é entregue", async () => {
  trilha.fotos = [];
  expect((await get(privado)).status).toBe(404);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
});
test.each(["?url=https://example.test", "?variante=constructor", "?variante=livre", "?variante[]=detalhe"])("rejeita parâmetros arbitrários %s", async (query) => {
  expect((await get(privado + query)).status).toBe(400);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
});
test("miniatura predefinida e HEAD autorizado", async () => {
  expect((await get(privado + "?variante=miniatura")).status).toBe(200);
  expect(abrirFotoProtegida).toHaveBeenCalledWith(expect.anything(), "miniatura", expect.any(AbortSignal));
  abrirFotoProtegida.mockClear();
  expect((await request(app).head(privado).set("Authorization", `Bearer ${token}`)).status).toBe(200);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
  expect((await request(app).head(publico)).status).toBe(404);
});
test("erro upstream não expõe endereço assinado nem é registrado", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  abrirFotoProtegida.mockRejectedValue(new Error("https://cloudinary.test/signature-secreta"));
  const resposta = await get(privado);
  expect(resposta.status).toBe(502);
  expect(JSON.stringify(resposta.body)).not.toContain("signature");
  expect(log).not.toHaveBeenCalled();
});
test("serialização usa endpoints por contexto e nunca vaza URL legada", () => {
  const comLegada = { ...trilha, fotos: [fotoBase, { _id: outro, publicId: "antigo", url: "https://res.cloudinary.com/publica.jpg" }] };
  for (const contexto of ["publico", "autor", "admin"]) {
    const dados = apresentarTrilha(comLegada, contexto);
    expect(dados.fotos[0].url).toContain(`/fotos/${fotoId}/conteudo`);
    expect(dados.fotos[1].url).toBeNull();
    expect(JSON.stringify(dados)).not.toMatch(/cloudinary|public-id-confidencial|assetId/);
  }
});

test("falha antes dos bytes retorna 502 sem detalhes internos", async () => {
  abrirFotoProtegida.mockImplementation(async () => new Readable({ read() { this.destroy(new Error("assinatura-secreta")); } }));
  const resposta = await get(privado);
  expect(resposta.status).toBe(502);
  expect(resposta.headers["content-type"]).toContain("application/json");
  expect(resposta.body).toEqual({ mensagem: "Não foi possível entregar a imagem." });
});

test("foto com tamanho excedido durante stream interrompe resposta", async () => {
  abrirFotoProtegida.mockImplementation(async () => Readable.from([Buffer.alloc(real.LIMITE_ENTREGA_BYTES + 1)]));
  const resposta = await get(privado);
  expect(resposta.status).toBe(502);
  expect(resposta.headers["content-type"]).toContain("application/json");
  expect(resposta.body).toEqual({ mensagem: "Não foi possível entregar a imagem." });
});

const { EventEmitter } = await import("node:events");
const { entregarFoto } = await import("../src/controllers/entregaFotoController.js");
function respostaManual() {
  const res = new EventEmitter();
  res.set = jest.fn(() => res);
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.removeHeader = jest.fn();
  return res;
}
const reqManual = () => ({ params: { id, fotoId }, query: {}, usuario: { _id: autor }, method: "GET" });

test("timeout aborta busca e responde 504 sem assinatura", async () => {
  jest.useFakeTimers();
  abrirFotoProtegida.mockImplementation((_foto, _variante, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("url-assinada")), { once: true });
  }));
  try {
    const res = respostaManual();
    const pendente = entregarFoto("autor")(reqManual(), res, jest.fn());
    await jest.advanceTimersByTimeAsync(30_000);
    await pendente;
    expect(res.status).toHaveBeenCalledWith(504);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("assinada");
  } finally { jest.useRealTimers(); }
});

test("desconexão cancela requisição remota e libera capacidade", async () => {
  let sinal;
  abrirFotoProtegida.mockImplementation((_foto, _variante, signal) => {
    sinal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelado")), { once: true }));
  });
  const res = respostaManual();
  const pendente = entregarFoto("autor")(reqManual(), res, jest.fn());
  await new Promise(setImmediate);
  res.destroyed = true;
  res.emit("close");
  await pendente;
  expect(sinal.aborted).toBe(true);
  expect(res.json).not.toHaveBeenCalled();
  expect(res.listenerCount("close")).toBe(0);
});

test("limite de concorrência rejeita excesso e é liberado após cancelamento", async () => {
  abrirFotoProtegida.mockImplementation((_foto, _variante, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("cancelado")), { once: true });
  }));
  const respostas = Array.from({ length: 20 }, respostaManual);
  const pendentes = respostas.map((res) => entregarFoto("autor")(reqManual(), res, jest.fn()));
  await Promise.resolve();
  const extra = respostaManual();
  await entregarFoto("autor")(reqManual(), extra, jest.fn());
  expect(extra.status).toHaveBeenCalledWith(503);
  for (const res of respostas) { res.destroyed = true; res.emit("close"); }
  await Promise.all(pendentes);
  abrirFotoProtegida.mockRejectedValue(new Error("teste"));
  const depois = respostaManual();
  await entregarFoto("autor")(reqManual(), depois, jest.fn());
  expect(depois.status).toHaveBeenCalledWith(502);
});


test.each(["", "?variante=detalhe", "?variante=miniatura"])("variante suportada ou ausente %s", async (query) => {
  expect((await get(privado + query)).status).toBe(200);
  expect(abrirFotoProtegida).toHaveBeenCalledWith(expect.anything(), query.includes("miniatura") ? "miniatura" : "detalhe", expect.any(AbortSignal));
});
test.each(["?variante=", "?variante=desconhecida", "?variante=miniatura&variante=detalhe", "?variante=detalhe&variante=detalhe"])("rejeita variante vazia, inválida ou duplicada %s", async (query) => {
  expect((await get(privado + query)).status).toBe(400);
  expect(consulta).not.toHaveBeenCalled();
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
});

test("erro após primeiro chunk encerra conexão HTTP", async () => {
  abrirFotoProtegida.mockImplementation(async () => new Readable({
    read() {
      if (this.iniciou) return;
      this.iniciou = true;
      this.push(Buffer.from("bytes-parciais"));
      setImmediate(() => this.destroy(new Error("url-assinada-secreta")));
    },
  }));
  await expect(get(privado)).rejects.toThrow();
});


test.each(["publico", "autor", "admin"])("IDs cruzados são negados e IDs corretos entregam somente a foto correspondente em %s", async (contexto) => {
  const idB = "507f1f77bcf86cd799439021";
  const fotoBId = "507f1f77bcf86cd799439022";
  const fotoA = { ...fotoBase, publicId: "asset-da-foto-A" };
  const fotoB = { ...fotoBase, _id: fotoBId, publicId: "asset-da-foto-B" };
  const publicacoes = [
    { _id: id, status: "approved", proprietario: autor, fotos: [fotoA] },
    { _id: idB, status: "approved", proprietario: autor, fotos: [fotoB] },
  ];
  if (contexto === "admin") Usuario.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: autor, perfil: "admin" }) });
  consulta.mockImplementation(async (filtro) => publicacoes.find((publicacao) =>
    publicacao._id === filtro._id
    && publicacao.fotos.some((foto) => foto._id === filtro["fotos._id"])
    && (!filtro.proprietario || publicacao.proprietario === filtro.proprietario)
    && (typeof filtro.status === "string" ? publicacao.status === filtro.status : filtro.status.$in.includes(publicacao.status)),
  ) || null);
  abrirFotoProtegida.mockImplementation(async (foto) => Readable.from([Buffer.from(foto.publicId === fotoA.publicId ? "bytes-exclusivos-A" : "bytes-exclusivos-B")]));
  const prefixo = contexto === "publico" ? "/trilhas" : contexto === "autor" ? "/trilhas/minhas" : "/admin/trilhas";
  const cruzada = await get(`${prefixo}/${idB}/fotos/${fotoId}/conteudo`);
  expect(cruzada.status).toBe(404);
  expect(cruzada.headers["content-type"]).toContain("application/json");
  expect(cruzada.body).toEqual({ mensagem: "Foto não encontrada." });
  expect(cruzada.text).not.toMatch(/bytes-exclusivos/);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
  for (const [publicacaoId, foto, bytes] of [[id, fotoA, "bytes-exclusivos-A"], [idB, fotoB, "bytes-exclusivos-B"]]) {
    const correta = await get(`${prefixo}/${publicacaoId}/fotos/${foto._id}/conteudo`);
    expect(correta.status).toBe(200);
    expect(correta.body.toString()).toBe(bytes);
    expect(abrirFotoProtegida).toHaveBeenLastCalledWith(foto, "detalhe", expect.any(AbortSignal));
  }
  expect(abrirFotoProtegida).toHaveBeenCalledTimes(2);
  expect(publicacoes[0].fotos).toEqual([fotoA]);
  expect(publicacoes[1].fotos).toEqual([fotoB]);
});
