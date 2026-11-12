import {
  criarNomeBancoDaExecucao,
  prepararAmbienteAplicacao,
  validarAmbienteIntegracao,
  validarBancoDaExecucao,
} from "./integration/ambiente.js";

const ambienteValido = {
  TEST_ENVIRONMENT: "integration",
  TEST_MONGO_URI: "mongodb://localhost:27017/pe_na_trilha_integration",
  TEST_MONGO_ALLOWED_HOSTS: "localhost",
  TEST_CLOUDINARY_CLOUD_NAME: "cloud-test",
  TEST_CLOUDINARY_API_KEY: "test-key",
  TEST_CLOUDINARY_API_SECRET: "test-secret",
};

describe("validação da configuração da suíte de integração", () => {
  test("exige modo explícito de integração", () => {
    expect(() => validarAmbienteIntegracao({ ...ambienteValido, TEST_ENVIRONMENT: "production" }))
      .toThrow("Defina TEST_ENVIRONMENT=integration para executar esta suíte.");
  });

  test("não usa variáveis normais como fallback", () => {
    expect(() => validarAmbienteIntegracao({
      TEST_ENVIRONMENT: "integration",
      MONGO_URI: ambienteValido.TEST_MONGO_URI,
      CLOUDINARY_CLOUD_NAME: ambienteValido.TEST_CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY: ambienteValido.TEST_CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET: ambienteValido.TEST_CLOUDINARY_API_SECRET,
    })).toThrow("A variável TEST_MONGO_URI é obrigatória.");

    expect(() => validarAmbienteIntegracao({
      ...ambienteValido,
      TEST_CLOUDINARY_CLOUD_NAME: undefined,
      TEST_CLOUDINARY_API_KEY: undefined,
      TEST_CLOUDINARY_API_SECRET: undefined,
      CLOUDINARY_CLOUD_NAME: "normal-cloud",
      CLOUDINARY_API_KEY: "normal-key",
      CLOUDINARY_API_SECRET: "normal-secret",
    })).toThrow("A variável TEST_CLOUDINARY_CLOUD_NAME é obrigatória para a suíte de integração.");
  });

  test("remove URIs normais antes de preparar o processo dos testes de integração", () => {
    const ambiente = {
      MONGO_URI: "mongodb://legacy/db",
      MONGO_URI_DEVELOPMENT: "mongodb://development/db",
      MONGO_URI_PRODUCTION: "mongodb://production/db",
    };
    const config = validarAmbienteIntegracao(ambienteValido);

    prepararAmbienteAplicacao(ambiente, config);

    expect(ambiente).not.toHaveProperty("MONGO_URI");
    expect(ambiente).not.toHaveProperty("MONGO_URI_DEVELOPMENT");
    expect(ambiente).not.toHaveProperty("MONGO_URI_PRODUCTION");
  });

  test("exige banco com marcador de teste", () => {
    expect(() => validarAmbienteIntegracao({
      ...ambienteValido,
      TEST_MONGO_URI: "mongodb://localhost:27017/pe_na_trilha",
    })).toThrow("O nome do banco em TEST_MONGO_URI precisa conter um marcador de teste válido.");
  });

  test("exige allowlist explícita e correspondência exata do host", () => {
    expect(() => validarAmbienteIntegracao({
      ...ambienteValido,
      TEST_MONGO_ALLOWED_HOSTS: "",
    })).toThrow("TEST_MONGO_ALLOWED_HOSTS deve conter hosts explícitos.");

    expect(() => validarAmbienteIntegracao({
      ...ambienteValido,
      TEST_MONGO_ALLOWED_HOSTS: "outro-host.local",
    })).toThrow("O host de TEST_MONGO_URI não está na allowlist.");
  });

  test("exige todas as credenciais de Cloudinary de teste", () => {
    expect(() => validarAmbienteIntegracao({
      ...ambienteValido,
      TEST_CLOUDINARY_API_SECRET: "",
    })).toThrow("A variável TEST_CLOUDINARY_API_SECRET é obrigatória para a suíte de integração.");
  });

  test("retorna a configuração validada sem consultar variáveis normais", () => {
    const config = validarAmbienteIntegracao({
      ...ambienteValido,
      MONGO_URI: "mongodb://localhost:27017/producao",
      CLOUDINARY_API_SECRET: "segredo-normal-ignorado",
    });

    expect(config.bancoBase).toBe("pe_na_trilha_integration");
    expect(config.hostMongo).toBe("localhost");
    expect(config.cloudinary.TEST_CLOUDINARY_API_SECRET).toBe("test-secret");
  });

  test("aceita somente o nome de banco associado ao identificador da execução", () => {
    const idExecucao = "a".repeat(32);
    const ambienteExecucao = {
      TEST_RUN_ID: idExecucao,
      TEST_RUN_DB_NAME: criarNomeBancoDaExecucao(idExecucao),
    };

    expect(ambienteExecucao.TEST_RUN_DB_NAME).toBe(`tst_${idExecucao}`);
    expect(Buffer.byteLength(ambienteExecucao.TEST_RUN_DB_NAME, "utf8")).toBe(36);
    expect(validarBancoDaExecucao(ambienteExecucao)).toBe(ambienteExecucao.TEST_RUN_DB_NAME);
    expect(() => validarBancoDaExecucao({
      ...ambienteExecucao,
      TEST_RUN_DB_NAME: "producao",
    })).toThrow("A base isolada da execução de integração é inválida.");
  });

  test("rejeita qualquer nome de banco acima de 38 bytes", () => {
    const idExecucao = "a".repeat(32);
    const ambienteExecucao = {
      TEST_RUN_ID: idExecucao,
      TEST_RUN_DB_NAME: "x".repeat(39),
    };

    expect(() => validarBancoDaExecucao(ambienteExecucao))
      .toThrow("A base isolada da execução de integração é inválida.");
  });

  test("preserva os 32 caracteres do TEST_RUN_ID ao gerar o nome compacto", () => {
    const idExecucao = "0123456789abcdef0123456789abcdef";

    expect(criarNomeBancoDaExecucao(idExecucao)).toBe(`tst_${idExecucao}`);
    expect(() => criarNomeBancoDaExecucao("a".repeat(31)))
      .toThrow("O identificador da execução de integração é inválido.");
  });
});
