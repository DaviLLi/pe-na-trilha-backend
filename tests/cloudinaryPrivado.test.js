import { jest } from "@jest/globals";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import cloudinary from "../src/config/cloudinary.js";
import { enviarImagem, excluirImagem } from "../src/services/cloudinaryService.js";
import { abrirFotoProtegida, limitarTamanho, LIMITE_ENTREGA_BYTES } from "../src/services/entregaFotoService.js";
const nomes = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
let anterior;
const resultado = { secure_url: "https://res.cloudinary.com/test/foto", public_id: "foto", asset_id: "asset", resource_type: "image", type: "authenticated", version: 1, format: "webp", width: 800, height: 600, bytes: 100 };
beforeEach(() => {
  anterior = nomes.map((nome) => process.env[nome]);
  nomes.forEach((nome) => { process.env[nome] = "teste"; });
});
afterEach(() => {
  jest.restoreAllMocks();
  nomes.forEach((nome, i) => { if (anterior[i] === undefined) delete process.env[nome]; else process.env[nome] = anterior[i]; });
});
test("upload de publicação exige authenticated e valida metadados; perfil mantém contrato público", async () => {
  const upload = jest.spyOn(cloudinary.uploader, "upload_stream").mockImplementation((opcoes, callback) => {
    callback(null, resultado);
    return { end: jest.fn() };
  });
  const foto = await enviarImagem(Buffer.from("foto"), "foto", { deliveryType: "authenticated" });
  expect(upload.mock.calls[0][0]).toMatchObject({ type: "authenticated", resource_type: "image", overwrite: false });
  expect(foto).toMatchObject({ assetId: "asset", deliveryType: "authenticated", storageState: "ready", version: 1 });
  expect(foto).not.toHaveProperty("secureUrl");
  const perfil = await enviarImagem(Buffer.from("perfil"), "foto");
  expect(upload.mock.calls[1][0]).not.toHaveProperty("type");
  expect(perfil).toEqual({ secureUrl: resultado.secure_url, publicId: "foto" });
});
test.each([{ type: "upload" }, { asset_id: undefined }, { public_id: "outro" }, { version: undefined }])("recusa resposta de upload não verificada %j", async (alteracoes) => {
  jest.spyOn(cloudinary.uploader, "upload_stream").mockImplementation((_opcoes, callback) => {
    callback(null, { ...resultado, ...alteracoes });
    return { end: jest.fn() };
  });
  await expect(enviarImagem(Buffer.from("foto"), "foto", { deliveryType: "authenticated" })).rejects.toThrow("Resposta inválida");
});
test("exclusão distingue authenticated e mantém exclusão de perfil", async () => {
  const destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
  await excluirImagem("foto", { resourceType: "image", deliveryType: "authenticated" });
  expect(destroy).toHaveBeenLastCalledWith("foto", { resource_type: "image", type: "authenticated", invalidate: true, timeout: 120000 });
  await excluirImagem("perfil");
  expect(destroy).toHaveBeenLastCalledWith("perfil", { resource_type: "image", invalidate: true, timeout: 120000 });
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
