import { diagnosticarFalhaUpload, erroRespostaUploadInvalida } from "../src/services/diagnosticoUpload.js";

const segredo = "SEGREDO_SUPER_PRIVADO_123";

describe("diagnóstico seguro de upload", () => {
  test.each([
    new Error(`Falha ${segredo} https://example.com/image?signature=${segredo}`),
    Object.assign(new Error(`Invalid api_key ${segredo}`), { http_code: 401, code: segredo, api_secret: segredo }),
    Object.assign(new Error(`Quota ${segredo}`), { http_code: 429, token: segredo }),
    Object.assign(new Error(`Socket ${segredo}`), { code: "ECONNRESET", config: { auth: segredo } }),
    Object.assign(new Error(`Denied ${segredo}`), { statusCode: 403, request: { body: Buffer.from(segredo) } }),
    { message: segredo, code: { segredo }, http_code: `401 ${segredo}` },
    segredo, null, undefined,
  ])("nunca copia dados arbitrários do erro", (erro) => {
    const resultado = diagnosticarFalhaUpload(erro);
    expect(Object.keys(resultado).every((chave) => ["codigo", "statusHttp", "mensagem", "mensagemOriginal", "cldError"].includes(chave))).toBe(true);
    const texto = JSON.stringify(resultado);
    expect(texto).not.toContain(segredo);
    expect(texto).not.toContain("https://");
    expect(texto).not.toContain("signature=");
    expect(typeof resultado.mensagem).toBe("string");
  });

  test("preserva somente códigos reconhecidos e status HTTP válidos", () => {
    expect(diagnosticarFalhaUpload({ code: "ETIMEDOUT", http_code: 504 })).toEqual({
      codigo: "ETIMEDOUT", statusHttp: 504,
      mensagem: "Falha de comunicação com o Cloudinary (rede, TLS ou timeout).",
    });
    for (const status of ["401", NaN, 399, 600, {}, 401.5]) {
      expect(diagnosticarFalhaUpload({ http_code: status })).not.toHaveProperty("statusHttp");
    }
  });

  test("distingue validação local de falha de comunicação", () => {
    const erro = erroRespostaUploadInvalida();
    expect(erro.message).toBe("Resposta inválida do serviço de imagens.");
    expect(diagnosticarFalhaUpload(erro)).toEqual({
      codigo: "CLOUDINARY_INVALID_UPLOAD_RESPONSE",
      mensagem: "Falha na validação local da resposta de upload do Cloudinary.",
    });
    expect(diagnosticarFalhaUpload({ code: "ENOTFOUND" }).mensagem).toMatch(/comunicação/);
  });

  test("não executa getters nem serializadores fornecidos pelo SDK", () => {
    const erro = { toJSON() { throw new Error(segredo); } };
    for (const key of ["message", "code", "http_code", "statusCode", "status"]) {
      Object.defineProperty(erro, key, { get() { throw new Error(segredo); } });
    }
    expect(() => diagnosticarFalhaUpload(erro)).not.toThrow();
    expect(JSON.stringify(diagnosticarFalhaUpload(erro))).not.toContain(segredo);
  });
});


describe("envelope error do SDK Cloudinary", () => {
  test("extrai 401 aninhado sem copiar opções, parâmetros ou mensagem bruta", () => {
    const erro = {
      request_options: { auth: segredo, headers: { Authorization: segredo } },
      query_params: `signature=${segredo}`,
      error: { http_code: 401, code: segredo, message: `Invalid api_key ${segredo} https://example.com/?signature=${segredo}` },
    };
    expect(diagnosticarFalhaUpload(erro)).toMatchObject({
      statusHttp: 401,
      mensagem: "Cloudinary recusou as credenciais ou a identificação da conta.",
    });
    expect(JSON.stringify(diagnosticarFalhaUpload(erro))).not.toContain(segredo);
  });

  test("extrai código de rede, status e classificação da mensagem interna", () => {
    expect(diagnosticarFalhaUpload({ error: { code: "ETIMEDOUT", http_code: 504, message: segredo } })).toEqual({
      codigo: "ETIMEDOUT", statusHttp: 504,
      mensagem: "Falha de comunicação com o Cloudinary (rede, TLS ou timeout).",
    });
    expect(diagnosticarFalhaUpload({ error: { message: `Invalid Signature ${segredo}` } }).mensagem).toMatch(/credenciais/);
    expect(diagnosticarFalhaUpload({ error: erroRespostaUploadInvalida() }).codigo).toBe("CLOUDINARY_INVALID_UPLOAD_RESPONSE");
  });

  test("prioriza campos internos válidos e usa campos externos como fallback", () => {
    expect(diagnosticarFalhaUpload({ http_code: 500, error: { http_code: 401 } }).statusHttp).toBe(401);
    expect(diagnosticarFalhaUpload({ code: "ENOTFOUND", statusCode: 503, error: { code: segredo, http_code: "401" } })).toMatchObject({ codigo: "ENOTFOUND", statusHttp: 503 });
  });

  test.each([null, undefined, segredo, 401, {}, []])("tolera error ausente ou sem estrutura útil", (error) => {
    expect(diagnosticarFalhaUpload({ error, http_code: 403 }).statusHttp).toBe(403);
    expect(JSON.stringify(diagnosticarFalhaUpload({ error }))).not.toContain(segredo);
  });

  test("não executa getters ou serializadores em nenhum nível", () => {
    const falhar = () => { throw new Error(segredo); };
    const interno = { toJSON: falhar };
    for (const chave of ["code", "message", "http_code", "statusCode", "status"]) {
      Object.defineProperty(interno, chave, { get: falhar });
    }
    const externo = { error: interno, toJSON: falhar };
    for (const chave of ["request_options", "query_params"]) {
      Object.defineProperty(externo, chave, { get: falhar });
    }
    expect(() => diagnosticarFalhaUpload(externo)).not.toThrow();
    const envelope = {};
    Object.defineProperty(envelope, "error", { get: falhar });
    expect(() => diagnosticarFalhaUpload(envelope)).not.toThrow();
  });

  test("não percorre ciclos nem proxies com acesso bloqueado", () => {
    const erro = { http_code: 401 };
    erro.error = erro;
    expect(diagnosticarFalhaUpload(erro).statusHttp).toBe(401);
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(segredo); } });
    expect(() => diagnosticarFalhaUpload(proxy)).not.toThrow();
  });
});


describe("mensagem e X-Cld-Error sanitizados", () => {
  test("conserva texto útil de restrição authenticated e cabeçalho de resposta", () => {
    const message = "Upload type authenticated is not allowed for this account";
    const resultado = diagnosticarFalhaUpload({ error: { http_code: 403, message,
      response: { headers: { "X-Cld-Error": "Account upload access denied" } } } });
    expect(resultado).toMatchObject({ statusHttp: 403, mensagemOriginal: message, cldError: "Account upload access denied" });
  });

  test("redige credenciais configuradas, assinaturas, URLs e autenticação", () => {
    const anterior = process.env.CLOUDINARY_API_SECRET;
    process.env.CLOUDINARY_API_SECRET = "segredo.curto";
    try {
      const message = `Denied segredo.curto api_key=123456789 signature=abcd token=xyz Bearer TOKEN_PRIVADO https://example.com/private?s=SECRETO`;
      const resultado = diagnosticarFalhaUpload({ error: { http_code: 403, message,
        headers: { "x-cld-error": message, Authorization: "nao-registrar" } },
        request_options: { auth: "nao-registrar" }, query_params: "nao-registrar" });
      const texto = JSON.stringify(resultado);
      for (const segredo of ["segredo.curto", "123456789", "abcd", "xyz", "TOKEN_PRIVADO", "https://", "SECRETO", "nao-registrar"]) expect(texto).not.toContain(segredo);
      expect(resultado.mensagemOriginal).toContain("Denied");
    } finally {
      if (anterior === undefined) delete process.env.CLOUDINARY_API_SECRET;
      else process.env.CLOUDINARY_API_SECRET = anterior;
    }
  });

  test("ignora cabeçalhos indisponíveis, getters, objetos e textos excessivos", () => {
    const headers = {};
    Object.defineProperty(headers, "X-Cld-Error", { get() { throw new Error(segredo); } });
    const resultado = diagnosticarFalhaUpload({ message: "x".repeat(9000), headers });
    expect(resultado).not.toHaveProperty("cldError");
    expect(resultado).not.toHaveProperty("mensagemOriginal");
    expect(diagnosticarFalhaUpload({ request_options: { headers: { "X-Cld-Error": "nao-registrar" } } })).not.toHaveProperty("cldError");
    expect(diagnosticarFalhaUpload({ message: { segredo }, headers: { "x-cld-error": { segredo } } })).not.toHaveProperty("mensagemOriginal");
  });

  test("remove quebras de linha e mantém mensagem limitada", () => {
    const resultado = diagnosticarFalhaUpload({ message: "Access denied\nInjected log\rentry" });
    expect(resultado.mensagemOriginal).toBe("Access denied Injected log entry");
    expect(diagnosticarFalhaUpload({ message: "Denied ".repeat(300) }).mensagemOriginal.length).toBeLessThanOrEqual(1024);
  });
});
