import { jest } from "@jest/globals";
import https from "node:https";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import cloudinary from "../src/config/cloudinary.js";
import { apresentarUrlFotoPerfil } from "../src/domain/identidadeImagem.js";
import { criarPublicIdFotoPerfil, criarPublicIdFotoTrilha, enviarImagem, excluirImagem } from "../src/services/cloudinaryService.js";
import { abrirFotoProtegida, limitarTamanho, LIMITE_ENTREGA_BYTES, VARIANTES } from "../src/services/entregaFotoService.js";
const nomes = [
  "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "CLOUDINARY_HOMOLOGACAO_RUN_ID",
  "APP_ENV", "HOMOLOGATION_CLOUDINARY_PREFIX", "HOMOLOGATION_CLOUDINARY_FOLDER_MODE",
];
let anterior;
const resultado = { secure_url: "https://res.cloudinary.com/test/foto", public_id: "foto", asset_id: "asset", resource_type: "image", type: "authenticated", version: 1, format: "webp", width: 800, height: 600, bytes: 100 };
beforeEach(() => {
  anterior = nomes.map((nome) => process.env[nome]);
  nomes.slice(0, 3).forEach((nome) => { process.env[nome] = "teste"; });
  nomes.slice(3).forEach((nome) => { delete process.env[nome]; });
});
afterEach(() => {
  jest.restoreAllMocks();
  nomes.forEach((nome, i) => { if (anterior[i] === undefined) delete process.env[nome]; else process.env[nome] = anterior[i]; });
});
test("upload de publicação exige authenticated e valida metadados; perfil mantém contrato público", async () => {
  process.env.APP_ENV = "production";
  process.env.CLOUDINARY_HOMOLOGACAO_RUN_ID = "a".repeat(32);
  process.env.HOMOLOGATION_CLOUDINARY_PREFIX = "homologacao/";
  const upload = jest.spyOn(cloudinary.uploader, "upload_stream").mockImplementation((opcoes, callback) => {
    callback(null, resultado);
    return { end: jest.fn() };
  });
  const foto = await enviarImagem(Buffer.from("foto"), "foto", { deliveryType: "authenticated" });
  const opcoes = upload.mock.calls[0][0];
  expect(opcoes).toMatchObject({ type: "authenticated", resource_type: "image", overwrite: false, eager_async: false });
  expect(opcoes).not.toHaveProperty("asset_folder");
  expect(criarPublicIdFotoPerfil()).toMatch(/^pe-na-trilha\/perfis\//);
  const eager = cloudinary.utils.build_eager(opcoes.eager).split("|");
  const urls = Object.values(VARIANTES).map((transformacao) => {
    const url = new URL(cloudinary.url("foto", { type: "authenticated", version: 1, format: "webp", transformation: [transformacao] }));
    return `${url.pathname.split("/").at(-3)}/${url.pathname.split(".").at(-1)}`;
  });
  expect(eager).toEqual(urls);
  expect(eager).toHaveLength(2);
  expect(foto).toMatchObject({ assetId: "asset", deliveryType: "authenticated", storageState: "ready", version: 1 });
  expect(foto).not.toHaveProperty("secureUrl");
  const perfil = await enviarImagem(Buffer.from("perfil"), "foto");
  expect(upload.mock.calls[1][0]).not.toHaveProperty("type");
  expect(upload.mock.calls[1][0]).not.toHaveProperty("eager");
  expect(perfil).toEqual({ secureUrl: resultado.secure_url, publicId: "foto" });
});
test.each([{ type: "upload" }, { asset_id: undefined }, { public_id: "outro" }, { version: undefined }])("recusa resposta de upload não verificada %j", async (alteracoes) => {
  jest.spyOn(cloudinary.uploader, "upload_stream").mockImplementation((_opcoes, callback) => {
    callback(null, { ...resultado, ...alteracoes });
    return { end: jest.fn() };
  });
  await expect(enviarImagem(Buffer.from("foto"), "foto", { deliveryType: "authenticated" })).rejects.toMatchObject({
    message: expect.stringContaining("Resposta inválida"),
    code: "CLOUDINARY_INVALID_UPLOAD_RESPONSE",
  });
});
test("exclusão distingue authenticated e mantém exclusão de perfil", async () => {
  const destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
  await excluirImagem("foto", { resourceType: "image", deliveryType: "authenticated" });
  expect(destroy).toHaveBeenLastCalledWith("foto", { resource_type: "image", type: "authenticated", invalidate: true, timeout: 120000 });
  await excluirImagem("perfil");
  expect(destroy).toHaveBeenLastCalledWith("perfil", { resource_type: "image", invalidate: true, timeout: 120000 });
});
test("homologação gera IDs e bloqueia operações de outro escopo antes do SDK", async () => {
  const runId = "a".repeat(32);
  process.env.CLOUDINARY_HOMOLOGACAO_RUN_ID = runId;
  process.env.HOMOLOGATION_CLOUDINARY_PREFIX = "homologacao";
  const prefixo = `homologacao/integracao/${runId}/`;
  const idPerfil = criarPublicIdFotoPerfil();
  expect(idPerfil.startsWith(prefixo + "perfis/")).toBe(true);
  expect(criarPublicIdFotoTrilha("a".repeat(24)).startsWith(prefixo + "trilhas/")).toBe(true);
  const upload = jest.spyOn(cloudinary.uploader, "upload_stream");
  const destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
  const get = jest.spyOn(https, "get");
  const outro = idPerfil.replace(runId, "b".repeat(32));
  expect(() => enviarImagem(Buffer.from("foto"), outro)).toThrow("fora do escopo");
  expect(() => abrirFotoProtegida({ publicId: outro }, "detalhe", new AbortController().signal))
    .toThrow("fora do escopo");
  await expect(excluirImagem(outro)).rejects.toThrow("fora do escopo");
  expect(upload).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(destroy).not.toHaveBeenCalled();
  await excluirImagem(idPerfil);
  expect(destroy).toHaveBeenCalledWith(idPerfil, expect.objectContaining({ resource_type: "image" }));
});

test.each(["dynamic", "fixed"])("upload sintético de homologação usa ID e pasta reservados em modo %s", async (modo) => {
  process.env.APP_ENV = "homologation";
  process.env.HOMOLOGATION_CLOUDINARY_PREFIX = "homologacao/";
  process.env.HOMOLOGATION_CLOUDINARY_FOLDER_MODE = modo;
  const id = criarPublicIdFotoPerfil();
  const trilhaId = criarPublicIdFotoTrilha("a".repeat(24));
  const url = `https://res.cloudinary.com/teste/image/upload/v1/${id}.png`;
  const imagem = readFileSync(new URL("./integration/fixtures/imagens-homologacao/sintetica.png", import.meta.url));
  const end = jest.fn();
  const upload = jest.spyOn(cloudinary.uploader, "upload_stream").mockImplementation((opcoes, callback) => {
    callback(null, opcoes.type ? { ...resultado, public_id: trilhaId } : { ...resultado, secure_url: url, public_id: id });
    return { end };
  });
  await expect(enviarImagem(imagem, id)).resolves.toEqual({ secureUrl: url, publicId: id });
  await expect(enviarImagem(imagem, trilhaId, { deliveryType: "authenticated" }))
    .resolves.toMatchObject({ publicId: trilhaId, deliveryType: "authenticated" });
  const destino = (publicId) => modo === "dynamic"
    ? { public_id: publicId, asset_folder: "homologacao", use_asset_folder_as_public_id_prefix: false }
    : { public_id: publicId.slice("homologacao/".length), folder: "homologacao" };
  expect(id).toMatch(/^homologacao\/perfis\//);
  expect(upload.mock.calls[0][0]).toMatchObject({ ...destino(id), overwrite: false });
  expect(upload.mock.calls[1][0]).toMatchObject({ ...destino(trilhaId), type: "authenticated", overwrite: false });
  expect(end).toHaveBeenCalledWith(imagem);
});

test("servidor de homologação bloqueia IDs de produção, prefixo parecido, travessia e outra execução", async () => {
  process.env.APP_ENV = "homologation";
  process.env.HOMOLOGATION_CLOUDINARY_PREFIX = "homologacao";
  const upload = jest.spyOn(cloudinary.uploader, "upload_stream");
  const destroy = jest.spyOn(cloudinary.uploader, "destroy");
  const sdkUrl = jest.spyOn(cloudinary, "url");
  const id = criarPublicIdFotoPerfil();
  for (const fora of [
    id.replace("homologacao/", "pe-na-trilha/"),
    id.replace("homologacao/", "homologacao-outra/"),
    id.replace("/perfis/", "/perfis/../"),
    id.replace("homologacao/", `homologacao/integracao/${"a".repeat(32)}/`),
    `${id}\n`,
  ]) {
    expect(() => enviarImagem(Buffer.alloc(0), fora)).toThrow("fora do escopo");
    expect(() => abrirFotoProtegida({ publicId: fora }, "detalhe", new AbortController().signal)).toThrow("fora do escopo");
    await expect(excluirImagem(fora)).rejects.toThrow("fora do escopo");
  }
  expect(upload).not.toHaveBeenCalled();
  expect(destroy).not.toHaveBeenCalled();
  expect(sdkUrl).not.toHaveBeenCalled();
});

test("homologação só apresenta URL de perfil do cloud e do prefixo reservados", () => {
  process.env.APP_ENV = "homologation";
  process.env.HOMOLOGATION_CLOUDINARY_PREFIX = "homologacao";
  const id = criarPublicIdFotoPerfil();
  const url = `https://res.cloudinary.com/teste/image/upload/v1/${id}.webp`;
  expect(apresentarUrlFotoPerfil(url)).toBe(url);
  expect(apresentarUrlFotoPerfil(url.replace("/teste/", "/outro/"))).toBeNull();
  expect(apresentarUrlFotoPerfil(url.replace("/homologacao/", "/pe-na-trilha/"))).toBeNull();
  expect(apresentarUrlFotoPerfil(url, criarPublicIdFotoPerfil())).toBeNull();
});
function respostaRemota(status = 200, headers = { "content-type": "image/webp" }) {
  const resposta = Readable.from([Buffer.from("foto")]);
  resposta.statusCode = status;
  resposta.headers = headers;
  return resposta;
}
test("busca interna assina apenas variante fixa, sem headers de autenticação do usuário", async () => {
  const sdk = jest.spyOn(cloudinary, "url").mockReturnValue("https://res.cloudinary.com/test/image/authenticated/s--assinatura--/foto.webp");
  const resposta = respostaRemota();
  const get = jest.spyOn(https, "get").mockImplementation((_url, _opcoes, callback) => {
    callback(resposta);
    return new EventEmitter();
  });
  await expect(abrirFotoProtegida({ publicId: "foto", version: 1 }, "miniatura", new AbortController().signal)).resolves.toBe(resposta);
  expect(sdk).toHaveBeenCalledWith("foto", expect.objectContaining({ sign_url: true, type: "authenticated", format: "webp", transformation: [expect.objectContaining({ width: 480 })] }));
  expect(get.mock.calls[0][1].headers).toEqual({ Accept: "image/webp" });
  resposta.destroy();
});
test.each([[302, {}], [200, { "content-type": "text/html" }], [200, { "content-type": "image/webp", "content-length": String(LIMITE_ENTREGA_BYTES + 1) }]])("não segue redirects nem aceita resposta inválida %s %j", async (status, headers) => {
  jest.spyOn(cloudinary, "url").mockReturnValue("https://res.cloudinary.com/test/foto.webp");
  jest.spyOn(https, "get").mockImplementation((_url, _opcoes, callback) => {
    callback(respostaRemota(status, headers));
    return new EventEmitter();
  });
  await expect(abrirFotoProtegida({ publicId: "foto", version: 1 }, "detalhe", new AbortController().signal)).rejects.toThrow("Resposta inválida");
});
test("recusa origem externa antes de abrir conexão", () => {
  jest.spyOn(cloudinary, "url").mockReturnValue("https://example.test/foto");
  const get = jest.spyOn(https, "get");
  expect(() => abrirFotoProtegida({ publicId: "foto" }, "detalhe", new AbortController().signal)).toThrow("Origem");
  expect(get).not.toHaveBeenCalled();
});
test("limita bytes efetivamente recebidos, mesmo sem content-length", async () => {
  await expect(pipeline(Readable.from([Buffer.alloc(5), Buffer.alloc(6)]), limitarTamanho(10), new Writable({ write(_chunk, _encoding, callback) { callback(); } }))).rejects.toThrow("Limite");
});

test("falha upstream durante backpressure remove listener drain sem destruir resposta HTTP", async () => {
  const { transmitirFoto } = await import("../src/services/entregaFotoService.js");
  const { PassThrough } = await import("node:stream");
  const destino = new PassThrough({ highWaterMark: 1 });
  const origem = new Readable({ read() {
    if (this.iniciou) return;
    this.iniciou = true;
    this.push(Buffer.alloc(100));
    setImmediate(() => this.destroy(new Error("erro interno")));
  } });
  await expect(transmitirFoto(origem, destino, new AbortController().signal)).rejects.toThrow("erro interno");
  expect(destino.listenerCount("drain")).toBe(0);
  expect(destino.destroyed).toBe(false);
  destino.destroy();
});
