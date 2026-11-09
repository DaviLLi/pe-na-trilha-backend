import {
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
    const config = validarAmbienteIntegracao(ambienteValido);
    const idExecucao = "a".repeat(32);
    const ambienteExecucao = {
      TEST_RUN_ID: idExecucao,
      TEST_RUN_DB_NAME: `${config.bancoBase}_run_${idExecucao}`,
    };

    expect(validarBancoDaExecucao(ambienteExecucao, config)).toBe(ambienteExecucao.TEST_RUN_DB_NAME);
    expect(() => validarBancoDaExecucao({
      ...ambienteExecucao,
      TEST_RUN_DB_NAME: "producao",
    }, config)).toThrow("A base isolada da execução de integração é inválida.");
  });
});
