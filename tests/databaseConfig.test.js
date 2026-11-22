import { jest } from "@jest/globals";

const conectarMongo = jest.fn();

jest.unstable_mockModule("mongoose", () => ({
  default: { connect: conectarMongo },
}));

const { conectarBanco, obterUriMongo } = await import("../src/config/database.js");
const { BANCO_HOMOLOGACAO, HOST_ATLAS_PRODUCAO, HOST_ATLAS_TESTES } = await import("../src/config/isolamentoMongo.js");

const ambienteHomologacao = {
  NODE_ENV: "production",
  APP_ENV: "homologation",
  MONGO_HOST_HOMOLOGATION: HOST_ATLAS_TESTES,
  MONGO_URI_HOMOLOGATION: `mongodb+srv://${HOST_ATLAS_TESTES}/${BANCO_HOMOLOGACAO}`,
};

describe("configuração MongoDB por ambiente", () => {
  beforeEach(() => {
    conectarMongo.mockReset();
    conectarMongo.mockResolvedValue(undefined);
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("desenvolvimento seleciona somente o URI de desenvolvimento", () => {
    expect(
      obterUriMongo({
        NODE_ENV: "development",
        MONGO_URI_DEVELOPMENT: "mongodb://127.0.0.1/db",
        MONGO_URI_PRODUCTION: "mongodb://prod/db",
        MONGO_URI: "mongodb://legacy/db",
      }),
    ).toBe("mongodb://127.0.0.1/db");
  });

  test("produção seleciona somente o URI de produção", () => {
    expect(
      obterUriMongo({
        NODE_ENV: "production",
        MONGO_URI_DEVELOPMENT: "mongodb://dev/db",
        MONGO_URI_PRODUCTION: "mongodb://prod/db",
        MONGO_URI: "mongodb://legacy/db",
      }),
    ).toBe("mongodb://prod/db");
  });

  test.each([
    ["development", "MONGO_URI_DEVELOPMENT"],
    ["production", "MONGO_URI_PRODUCTION"],
  ])("falha sem %s configurado e não usa o URI legado", async (nodeEnv, variable) => {
    const ambiente = {
      NODE_ENV: nodeEnv,
      MONGO_URI: "mongodb://legacy/db",
      [nodeEnv === "development" ? "MONGO_URI_PRODUCTION" : "MONGO_URI_DEVELOPMENT"]:
        "mongodb://other-environment/db",
    };

    expect(() => obterUriMongo(ambiente)).toThrow(`A variável ${variable} não foi definida`);
    await expect(conectarBanco(ambiente)).rejects.toThrow(
      `A variável ${variable} não foi definida`,
    );
    expect(conectarMongo).not.toHaveBeenCalled();
  });

  test("falha para ambiente não selecionado", () => {
    expect(() => obterUriMongo({ NODE_ENV: "test", MONGO_URI: "mongodb://legacy/db" }))
      .toThrow("NODE_ENV deve ser development ou production");
  });

  test("conecta com o URI do ambiente selecionado", async () => {
    await conectarBanco({
      NODE_ENV: "development",
      MONGO_URI_DEVELOPMENT: "mongodb://127.0.0.1/db",
    });

    expect(conectarMongo).toHaveBeenCalledWith("mongodb://127.0.0.1/db", { directConnection: true });
  });

  test.each([
    `mongodb+srv://${HOST_ATLAS_PRODUCAO}/db`,
    `mongodb://127.0.0.1,${HOST_ATLAS_PRODUCAO}/db`,
    "mongodb://[::1]/db?proxyHost=externo.example",
  ])("recusa destino não local antes de conectar", async (uri) => {
    await expect(conectarBanco({ NODE_ENV: "development", MONGO_URI_DEVELOPMENT: uri })).rejects.toThrow();
    expect(conectarMongo).not.toHaveBeenCalled();
  });

  test.each([
    [HOST_ATLAS_PRODUCAO, `/${BANCO_HOMOLOGACAO}`],
    [HOST_ATLAS_TESTES, "/tst_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    [HOST_ATLAS_TESTES, "/pe_na_trilha_integration"],
    [HOST_ATLAS_TESTES, `/${BANCO_HOMOLOGACAO}?dbName=pe_na_trilha_integration`],
  ])("recusa outros destinos de homologação antes de conectar", async (host, caminho) => {
    await expect(conectarBanco({
      ...ambienteHomologacao,
      MONGO_URI_HOMOLOGATION: `mongodb+srv://${host}${caminho}`,
      MONGO_HOST_HOMOLOGATION: host,
    })).rejects.toThrow("Homologação exige o seed SRV do Atlas de testes");
    expect(conectarMongo).not.toHaveBeenCalled();
  });

  test("conecta ao banco de homologação no Atlas de testes com NODE_ENV=production", async () => {
    await conectarBanco({
      ...ambienteHomologacao,
      MONGO_URI_PRODUCTION: `mongodb+srv://${HOST_ATLAS_PRODUCAO}/db`,
    }, { dbName: "tst_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(conectarMongo).toHaveBeenCalledWith(
      ambienteHomologacao.MONGO_URI_HOMOLOGATION, { dbName: BANCO_HOMOLOGACAO },
    );
    expect(() => obterUriMongo({ NODE_ENV: "development", APP_ENV: "production" })).toThrow("corresponder");
  });

  test("exige que MONGO_HOST_HOMOLOGATION corresponda ao seed adotado", () => {
    expect(() => obterUriMongo({ ...ambienteHomologacao, MONGO_HOST_HOMOLOGATION: HOST_ATLAS_PRODUCAO }))
      .toThrow("Homologação exige o seed SRV do Atlas de testes");
  });
});
