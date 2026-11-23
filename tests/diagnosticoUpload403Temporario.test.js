import { jest } from "@jest/globals";
import https from "node:https";
import { Readable, Writable } from "node:stream";
import { criarDiagnosticoUpload403 } from "../src/services/diagnosticoUpload403Temporario.js";
import { enviarImagem } from "../src/services/cloudinaryService.js";

const nomes = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "CLOUDINARY_DIAGNOSTICO_403"];
let anterior;
beforeEach(() => { anterior = nomes.map((nome) => process.env[nome]); });
afterEach(() => {
  jest.restoreAllMocks();
  nomes.forEach((nome, i) => {
    if (anterior[i] === undefined) delete process.env[nome];
    else process.env[nome] = anterior[i];
  });
});

async function simular({ status = 403, corpo = "", headers = { "content-type": "text/plain" }, habilitado = true } = {}) {
  const resposta = Readable.from(corpo ? [Buffer.from(corpo)] : []);
  resposta.statusCode = status;
  resposta.headers = headers;
  const log = jest.fn();
  const requisicao = {};
  const request = jest.spyOn(https, "request").mockImplementation((_opcoes, callback) => {
    queueMicrotask(() => callback(resposta));
    return requisicao;
  });
  const instrumentar = criarDiagnosticoUpload403({ habilitado: () => habilitado, registrar: log });
  const callback = jest.fn((res) => { expect(res).toBe(resposta); res.resume(); });
  const fim = new Promise((resolve) => resposta.once("end", resolve));
  const retorno = instrumentar(() => https.request({ method: "POST", pathname: "/v1_1/teste/image/upload" }, callback));
  expect(retorno).toBe(requisicao);
  expect(https.request).toBe(request);
  await fim;
  return { log, callback, instrumentar };
}

test("captura 403 antes do callback e sanitiza mensagem JSON e X-Cld-Error", async () => {
  const { log, callback } = await simular({
    corpo: JSON.stringify({ error: { message: "Upload type authenticated is not allowed" }, arquivo: "NUNCA_REGISTRAR_ARQUIVO" }),
    headers: { "content-type": "application/json", "x-cld-error": "Upload denied" },
  });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("TEMP"), {
    statusHttp: 403, cldError: "Upload denied", corpoOriginal: "Upload type authenticated is not allowed", corpoEstado: "sanitizado",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("NUNCA_REGISTRAR_ARQUIVO");
});

test("403 sem corpo mantém status e indica ausência", async () => {
  const { log } = await simular();
  expect(log).toHaveBeenCalledWith(expect.any(String), { statusHttp: 403, corpoEstado: "ausente" });
});

test("redige segredos, URLs, assinaturas e ignora outros headers", async () => {
  process.env.CLOUDINARY_API_KEY = "123456789123456";
  process.env.CLOUDINARY_API_SECRET = "segredo.curto";
  const texto = "Denied segredo.curto api_key=123456789123456 token=abc signature=xyz https://example.test/private?signature=PRIVADO";
  const { log } = await simular({ corpo: texto, headers: { "content-type": "text/plain", "X-Cld-Error": texto, authorization: "NUNCA_HEADERS" } });
  const registro = JSON.stringify(log.mock.calls);
  for (const segredo of ["segredo.curto", "123456789123456", "abc", "xyz", "https://", "PRIVADO", "NUNCA_HEADERS"]) expect(registro).not.toContain(segredo);
  expect(registro.length).toBeLessThan(4096);
});

test.each(["image/png", "multipart/form-data", "application/octet-stream"])("não registra corpo %s", async (tipo) => {
  const { log } = await simular({ corpo: "NUNCA_ARQUIVO", headers: { "content-type": tipo } });
  expect(log.mock.calls[0][1].corpoEstado).toBe("omitido_tipo_ou_codificacao");
  expect(JSON.stringify(log.mock.calls)).not.toContain("NUNCA_ARQUIVO");
});

test("não registra corpo comprimido nem prefixo de resposta acima do limite", async () => {
  for (const opcoes of [
    { corpo: "NUNCA_COMPRIMIDO", headers: { "content-type": "text/plain", "content-encoding": "gzip" } },
    { corpo: "NUNCA_PREFIXO " + "x".repeat(9000) },
  ]) {
    const { log } = await simular(opcoes);
    expect(log.mock.calls[0][1]).not.toHaveProperty("corpoOriginal");
    expect(JSON.stringify(log.mock.calls)).not.toContain("NUNCA");
    jest.restoreAllMocks();
  }
});

test("remove scripts, formulários e atributos HTML e limita texto", async () => {
  const { log } = await simular({ corpo: '<html><script>NUNCA_SCRIPT</script><form>NUNCA_FORM</form><p title="NUNCA_ATTR">Access denied</p></html>', headers: { "content-type": "text/html" } });
  expect(log.mock.calls[0][1].corpoOriginal).toBe("Access denied");
  expect(JSON.stringify(log.mock.calls)).not.toContain("NUNCA");
});

test.each([{ status: 200 }, { habilitado: false }])("não registra respostas fora do escopo %j", async (opcoes) => {
  const { log } = await simular(opcoes);
  expect(log).not.toHaveBeenCalled();
});

test("instrumenta somente uma tentativa e restaura request mesmo se o SDK lançar", () => {
  const original = https.request;
  const instrumentar = criarDiagnosticoUpload403({ habilitado: () => true });
  expect(() => instrumentar(() => { expect(https.request).not.toBe(original); throw new Error("falha simulada"); })).toThrow("falha simulada");
  expect(https.request).toBe(original);
  instrumentar(() => expect(https.request).toBe(original));
});

test("logger com falha não interfere no callback do SDK", async () => {
  const resposta = Readable.from([Buffer.from("Access denied")]);
  resposta.statusCode = 403;
  resposta.headers = { "content-type": "text/plain" };
  jest.spyOn(https, "request").mockImplementation((_opcoes, callback) => { queueMicrotask(() => callback(resposta)); return {}; });
  const instrumentar = criarDiagnosticoUpload403({ habilitado: () => true, registrar: () => { throw new Error("falha de log"); } });
  const callback = jest.fn();
  const fim = new Promise((resolve) => resposta.once("end", resolve));
  instrumentar(() => https.request({ method: "POST", pathname: "/v1_1/teste/image/upload" }, callback));
  await fim;
  expect(callback).toHaveBeenCalledTimes(1);
});

test("SDK real preserva erro 403 enquanto captura resposta original, sem rede nem multipart no log", async () => {
  for (const nome of nomes.slice(0, 3)) process.env[nome] = "teste-sintetico";
  process.env.CLOUDINARY_DIAGNOSTICO_403 = "1";
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(https, "request").mockImplementation((_opcoes, callback) => {
    const req = new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) {
      const res = Readable.from([Buffer.from('{"error":{"message":"Authenticated upload denied by remote policy"}}')]);
      res.statusCode = 403;
      res.headers = { "content-type": "application/json", "x-cld-error": "Access denied" };
      callback(res);
      done();
    } });
    req.setTimeout = () => req;
    req.abort = () => req;
    return req;
  });
  await expect(enviarImagem(Buffer.from("NUNCA_MULTIPART_IMAGEM"), "foto-sintetica", { deliveryType: "authenticated" })).rejects.toMatchObject({ http_code: 403 });
  await new Promise((resolve) => setImmediate(resolve));
  expect(log).toHaveBeenCalledWith(expect.stringContaining("TEMP"), expect.objectContaining({ statusHttp: 403, corpoOriginal: "Authenticated upload denied by remote policy", cldError: "Access denied" }));
  expect(JSON.stringify(log.mock.calls)).not.toContain("NUNCA_MULTIPART_IMAGEM");
});


test("omite eco de multipart mesmo declarado como texto", async () => {
  const { log } = await simular({ corpo: 'Content-Disposition: form-data; name="file"\r\nNUNCA_IMAGEM' });
  expect(log.mock.calls[0][1]).not.toHaveProperty("corpoOriginal");
  expect(JSON.stringify(log.mock.calls)).not.toContain("NUNCA_IMAGEM");
});
