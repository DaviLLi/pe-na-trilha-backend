import { jest } from "@jest/globals";

const conectarMongo = jest.fn();

jest.unstable_mockModule("mongoose", () => ({
  default: { connect: conectarMongo },
}));

const { conectarBanco, obterUriMongo } = await import("../src/config/database.js");

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
        MONGO_URI_DEVELOPMENT: "mongodb://dev/db",
        MONGO_URI_PRODUCTION: "mongodb://prod/db",
        MONGO_URI: "mongodb://legacy/db",
      }),
    ).toBe("mongodb://dev/db");
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
      MONGO_URI_DEVELOPMENT: "mongodb://dev/db",
    });

    expect(conectarMongo).toHaveBeenCalledWith("mongodb://dev/db");
  });
});
