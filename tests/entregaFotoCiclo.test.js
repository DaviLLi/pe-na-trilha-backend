import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
const abrirFotoProtegida = jest.fn();
const real = await import("../src/services/entregaFotoService.js");
jest.unstable_mockModule("../src/services/entregaFotoService.js", () => ({ ...real, abrirFotoProtegida }));
const { entregarFoto } = await import("../src/controllers/entregaFotoController.js");
const { default: Trilha } = await import("../src/models/Trilha.js");
const id = "507f1f77bcf86cd799439011";
const fotoId = "507f1f77bcf86cd799439012";
const trilha = { fotos: [{ _id: fotoId, publicId: "foto", assetId: "asset", resourceType: "image", deliveryType: "authenticated", version: 1, format: "webp", width: 1, height: 1, bytes: 10, storageState: "ready" }] };
const handler = entregarFoto("publico");
function criar() {
  const req = new EventEmitter();
  Object.assign(req, { params: { id, fotoId }, query: {}, method: "GET" });
  const res = new PassThrough();
  res.resume();
  res.headers = {};
  res.codigo = 200;
  res.set = jest.fn((objeto, valor) => { if (typeof objeto === "string") res.headers[objeto] = valor; else Object.assign(res.headers, objeto); return res; });
  res.status = jest.fn((codigo) => { res.codigo = codigo; return res; });
  res.json = jest.fn((dados) => { res.end(JSON.stringify(dados)); return res; });
  res.type = jest.fn(() => res);
  res.removeHeader = jest.fn();
  const next = jest.fn();
  return { req, res, next, executar: () => handler(req, res, next) };
}
let buscar;
beforeEach(() => {
  buscar = jest.spyOn(Trilha, "findOne").mockResolvedValue(trilha);
  abrirFotoProtegida.mockReset().mockImplementation(async () => Readable.from([Buffer.from("foto")]));
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
function consultaPendente() {
  buscar.mockImplementation((_filtro, _projecao, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
}
async function provarCapacidade() {
  buscar.mockResolvedValue(trilha);
  const itens = Array.from({ length: 20 }, criar);
  await Promise.all(itens.map((item) => item.executar()));
  for (const item of itens) expect(item.res.codigo).toBe(200);
}
test("20 consultas ocupam vagas antes do MongoDB; excesso não consulta nem acessa Cloudinary", async () => {
  consultaPendente();
  const itens = Array.from({ length: 20 }, criar);
  const pendentes = itens.map((item) => item.executar());
  expect(buscar).toHaveBeenCalledTimes(20);
  const extras = Array.from({ length: 10 }, criar);
  await Promise.all(extras.map((item) => item.executar()));
  expect(buscar).toHaveBeenCalledTimes(20);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
  extras.forEach(({ res }) => { expect(res.codigo).toBe(503); expect(res.headers["Retry-After"]).toBe("2"); });
  itens.forEach(({ req }) => { req.aborted = true; req.emit("aborted"); });
  await Promise.all(pendentes);
  await provarCapacidade();
});
test.each(["res", "req"])("cliente já desconectado em %s não inicia consulta", async (lado) => {
  const item = criar();
  if (lado === "res") item.res.destroy(); else item.req.aborted = true;
  await item.executar();
  expect(buscar).not.toHaveBeenCalled();
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
  await provarCapacidade();
});
test.each(["close", "aborted"])("desconexão %s durante MongoDB aborta signal, limpa listeners e libera vaga", async (evento) => {
  consultaPendente();
  const item = criar();
  const pendente = item.executar();
  const signal = buscar.mock.calls[0][2].signal;
  if (evento === "close") item.res.destroy(); else { item.req.aborted = true; item.req.emit("aborted"); }
  await pendente;
  expect(signal.aborted).toBe(true);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
  expect(item.req.listenerCount("aborted")).toBe(0);
  expect(item.res.listeners("close")).toHaveLength(0);
  await provarCapacidade();
});
test("timeout cobre MongoDB, libera 20 vagas e remove todos os timers", async () => {
  jest.useFakeTimers();
  consultaPendente();
  const itens = Array.from({ length: 20 }, criar);
  const pendentes = itens.map((item) => item.executar());
  const signals = buscar.mock.calls.map((chamada) => chamada[2].signal);
  await jest.advanceTimersByTimeAsync(30_000);
  await Promise.all(pendentes);
  itens.forEach(({ req, res }) => { expect(res.codigo).toBe(504); expect(req.listenerCount("aborted")).toBe(0); });
  signals.forEach((signal) => expect(signal.aborted).toBe(true));
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
  await provarCapacidade();
});
test("resultado tardio de consulta que ignora cancelamento não inicia Cloudinary", async () => {
  let resolver;
  buscar.mockImplementation(() => new Promise((resolve) => { resolver = resolve; }));
  const item = criar();
  const pendente = item.executar();
  item.req.aborted = true;
  item.req.emit("aborted");
  await pendente;
  resolver(trilha);
  await new Promise(setImmediate);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
  await provarCapacidade();
});
test.each(["sucesso", "mongo", "cloudinary", "excecao", "404", "HEAD", "validacao"])("libera vagas e listeners após %s", async (cenario) => {
  if (cenario === "mongo") buscar.mockRejectedValue(new Error("banco"));
  if (cenario === "excecao") buscar.mockImplementation(() => { throw new Error("síncrono"); });
  if (cenario === "cloudinary") abrirFotoProtegida.mockRejectedValue(new Error("remoto"));
  if (cenario === "404") buscar.mockResolvedValue(null);
  const itens = Array.from({ length: 20 }, criar);
  if (cenario === "HEAD") itens.forEach(({ req }) => { req.method = "HEAD"; });
  if (cenario === "validacao") itens.forEach(({ req }) => { req.query = { variante: "invalida" }; });
  await Promise.all(itens.map((item) => item.executar()));
  for (const { req, res, next } of itens) {
    expect(req.listenerCount("aborted")).toBe(0);
    if (["mongo", "excecao"].includes(cenario)) expect(next).toHaveBeenCalled();
  }
  abrirFotoProtegida.mockImplementation(async () => Readable.from([Buffer.from("foto")]));
  await provarCapacidade();
});
test.each([ { code: 50 }, { name: "MongoOperationTimeoutError" } ])("timeout do driver responde 504 %j", async (erro) => {
  buscar.mockRejectedValue(erro);
  const item = criar();
  await item.executar();
  expect(item.res.codigo).toBe(504);
  expect(abrirFotoProtegida).not.toHaveBeenCalled();
  await provarCapacidade();
});
test("Mongoose encaminha o mesmo AbortSignal e limites ao driver sem acessar MongoDB", async () => {
  buscar.mockRestore();
  const driver = jest.spyOn(Trilha.collection, "findOne").mockResolvedValue(null);
  const signal = new AbortController().signal;
  await Trilha.findOne({ _id: id }, null, { signal, maxTimeMS: 30_000, timeoutMS: 30_000 });
  expect(driver).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ signal, maxTimeMS: 30_000, timeoutMS: 30_000 }));
  expect(driver.mock.calls[0][1].signal).toBe(signal);
});

test("erro após bytes nunca tenta enviar JSON nem mudar status", async () => {
  const item = criar();
  const write = item.res.write.bind(item.res);
  item.res.write = (...args) => { item.res.headersSent = true; return write(...args); };
  abrirFotoProtegida.mockImplementation(async () => new Readable({ read() {
    if (this.iniciou) return;
    this.iniciou = true;
    this.push(Buffer.from("inicio-da-imagem"));
    setImmediate(() => this.destroy(new Error("assinatura-confidencial")));
  } }));
  await item.executar();
  expect(item.res.headersSent).toBe(true);
  expect(item.res.destroyed).toBe(true);
  expect(item.res.json).not.toHaveBeenCalled();
  expect(item.res.status).not.toHaveBeenCalled();
  expect(item.next).not.toHaveBeenCalled();
});

test("timeout aguardando primeiro byte retorna JSON 504 e destrói origem", async () => {
  jest.useFakeTimers();
  const origem = new Readable({ read() {} });
  abrirFotoProtegida.mockResolvedValue(origem);
  const item = criar();
  const pendente = item.executar();
  await jest.advanceTimersByTimeAsync(30_000);
  await pendente;
  expect(item.res.codigo).toBe(504);
  expect(item.res.json).toHaveBeenCalledTimes(1);
  expect(origem.destroyed).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test("cliente desconectado enquanto espera bytes não recebe JSON", async () => {
  const origem = new Readable({ read() {} });
  abrirFotoProtegida.mockResolvedValue(origem);
  const item = criar();
  const pendente = item.executar();
  await new Promise(setImmediate);
  item.res.destroy();
  await pendente;
  expect(origem.destroyed).toBe(true);
  expect(item.res.json).not.toHaveBeenCalled();
  expect(item.req.listenerCount("aborted")).toBe(0);
});
