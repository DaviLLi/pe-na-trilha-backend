import {
  criarNomeBancoDaExecucao,
  prepararAmbienteAplicacao,
  validarAmbienteIntegracao,
  validarBancoDaExecucao,
} from "./integration/ambiente.js";
import { validarCloudinaryHomologacao } from "../src/config/isolamentoCloudinary.js";
import { BANCO_HOMOLOGACAO, HOST_ATLAS_PRODUCAO, HOST_ATLAS_TESTES } from "../src/config/isolamentoMongo.js";

const ambienteValido = {
  TEST_ENVIRONMENT: "integration",
  TEST_MONGO_URI: "mongodb://127.0.0.1/pe_na_trilha_integration",
};
const mediaHomologacao = {
  HOMOLOGATION_CLOUDINARY_CLOUD_NAME: "fixture-homol",
  HOMOLOGATION_CLOUDINARY_API_KEY: "fixture-key",
  HOMOLOGATION_CLOUDINARY_API_SECRET: "fixture-secret",
  HOMOLOGATION_CLOUDINARY_PREFIX: "homologacao/",
  HOMOLOGATION_CLOUDINARY_FOLDER_MODE: "dynamic",
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
    })).toThrow("A variável TEST_MONGO_URI é obrigatória.");
  });

  test("remove URIs normais antes de preparar o processo dos testes de integração", () => {
    const ambiente = {
      MONGO_URI: "mongodb://legacy/db",
      MONGO_URI_PRODUCTION: "mongodb://production/db",
      MONGO_URI_HOMOLOGATION: "mongodb://homologation/db",
      CLOUDINARY_API_SECRET: "segredo-normal-ignorado",
      JWT_SECRET: "segredo-normal",
      CSRF_SECRET: "csrf-normal",
    };
    const config = validarAmbienteIntegracao(ambienteValido);

    prepararAmbienteAplicacao(ambiente, config);

    expect(ambiente).not.toHaveProperty("MONGO_URI");
    expect(ambiente).not.toHaveProperty("MONGO_URI_PRODUCTION");
    expect(ambiente).not.toHaveProperty("MONGO_URI_HOMOLOGATION");
    expect(ambiente).not.toHaveProperty("CLOUDINARY_API_SECRET");
    expect(ambiente.JWT_SECRET).not.toBe("segredo-normal");
    expect(ambiente.CSRF_SECRET).not.toBe("csrf-normal");
    expect(Buffer.byteLength(ambiente.CSRF_SECRET, "utf8")).toBeGreaterThanOrEqual(32);
  });

  test("exige banco com marcador de teste", () => {
    expect(() => validarAmbienteIntegracao({
      ...ambienteValido,
      TEST_MONGO_URI: "mongodb://127.0.0.1/pe_na_trilha",
    })).toThrow("O nome do banco em TEST_MONGO_URI precisa conter um marcador de teste válido.");
  });

  test("fixa a allowlist no loopback da fixture", () => {
    expect(validarAmbienteIntegracao(ambienteValido).hostsPermitidos).toEqual(["127.0.0.1"]);
  });

  test("exige credenciais exclusivas quando o modo real é pedido", () => {
    expect(() => validarCloudinaryHomologacao({
      ...mediaHomologacao, HOMOLOGATION_CLOUDINARY_API_SECRET: "",
    }, [])).toThrow("Informe HOMOLOGATION_CLOUDINARY_API_SECRET");
    expect(() => validarCloudinaryHomologacao({
      ...mediaHomologacao, HOMOLOGATION_CLOUDINARY_FOLDER_MODE: "",
    }, [])).toThrow("HOMOLOGATION_CLOUDINARY_FOLDER_MODE");
    expect(() => validarCloudinaryHomologacao({
      ...mediaHomologacao, HOMOLOGATION_CLOUDINARY_PREFIX: "pe-na-trilha/",
    }, [])).toThrow("HOMOLOGATION_CLOUDINARY_PREFIX");
  });

  test("aceita Cloud Name compartilhado e recusa a chave de produção quando conhecida", () => {
    expect(validarCloudinaryHomologacao(mediaHomologacao, [{
      CLOUDINARY_CLOUD_NAME: "fixture-homol", CLOUDINARY_API_KEY: "outra-chave",
    }])).toMatchObject({ CLOUDINARY_CLOUD_NAME: "fixture-homol", HOMOLOGATION_CLOUDINARY_PREFIX: "homologacao" });
    expect(() => validarCloudinaryHomologacao(mediaHomologacao, [{ CLOUDINARY_API_KEY: "fixture-key" }]))
      .toThrow("API Key própria");
    expect(() => validarCloudinaryHomologacao(mediaHomologacao, [{ CLOUDINARY_URL: "cloudinary://fixture-key:secreto@fixture-homol" }]))
      .toThrow("API Key própria");
  });

  test("injeta escopo da execução e remove configuração Cloudinary herdada do processo", () => {
    const ambiente = {
      ...ambienteValido,
      TEST_CLOUDINARY_REAL: "1",
      TEST_RUN_ID: "a".repeat(32),
      TEST_RUN_DB_NAME: criarNomeBancoDaExecucao("a".repeat(32)),
      CLOUDINARY_URL: "cloudinary://sintetico:ficticio@outro",
      CLOUDINARY_DIAGNOSTICO_403: "1",
    };
    const cloudinary = validarCloudinaryHomologacao(mediaHomologacao, []);
    prepararAmbienteAplicacao(ambiente, { ...validarAmbienteIntegracao(ambiente), cloudinary });
    expect(ambiente.CLOUDINARY_HOMOLOGACAO_RUN_ID).toBe(ambiente.TEST_RUN_ID);
    expect(ambiente.CLOUDINARY_CLOUD_NAME).toBe(mediaHomologacao.HOMOLOGATION_CLOUDINARY_CLOUD_NAME);
    expect(ambiente).not.toHaveProperty("CLOUDINARY_URL");
    expect(ambiente).not.toHaveProperty("CLOUDINARY_DIAGNOSTICO_403");
  });

  test("retorna a configuração validada sem consultar variáveis normais", () => {
    const config = validarAmbienteIntegracao({
      ...ambienteValido,
      MONGO_URI: "mongodb://localhost:27017/producao",
      CLOUDINARY_API_SECRET: "segredo-normal-ignorado",
    });

    expect(config.bancoBase).toBe("pe_na_trilha_integration");
    expect(config.hostMongo).toBe("127.0.0.1");
    expect(config.cloudinary).toBeUndefined();
  });

  test.each([
    `mongodb+srv://${HOST_ATLAS_PRODUCAO}/pe_na_trilha_integration`,
    `mongodb+srv://${HOST_ATLAS_TESTES}/${BANCO_HOMOLOGACAO}`,
    "mongodb://127.0.0.1/pe_na_trilha_integration?proxyHost=externo.example",
  ])("recusa conexões de integração fora da fixture", (uri) => {
    expect(() => validarAmbienteIntegracao({
      ...ambienteValido, TEST_MONGO_URI: uri,
    })).toThrow("replica set descartável em 127.0.0.1");
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
