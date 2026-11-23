import { jest } from "@jest/globals";

const conectarMongo = jest.fn();

jest.unstable_mockModule("mongoose", () => ({
  default: { connect: conectarMongo },
}));

const { conectarBanco, obterUriMongo } = await import("../src/config/database.js");
const { BANCO_HOMOLOGACAO, BANCO_PRODUCAO, HOST_ATLAS_PRODUCAO, HOST_ATLAS_TESTES } =
  await import("../src/config/isolamentoMongo.js");

const producao = {
  NODE_ENV: "production",
  APP_ENV: "production",
  MONGO_URI_PRODUCTION: `mongodb+srv://${HOST_ATLAS_PRODUCAO}/${BANCO_PRODUCAO}`,
};
const homologacao = {
  NODE_ENV: "production",
  APP_ENV: "homologation",
  MONGO_HOST_HOMOLOGATION: HOST_ATLAS_TESTES,
  MONGO_URI_HOMOLOGATION: `mongodb+srv://${HOST_ATLAS_TESTES}/${BANCO_HOMOLOGACAO}`,
};

beforeEach(() => {
  conectarMongo.mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each([
  [producao, "MONGO_URI_PRODUCTION", BANCO_PRODUCAO, HOST_ATLAS_PRODUCAO],
  [homologacao, "MONGO_URI_HOMOLOGATION", BANCO_HOMOLOGACAO, HOST_ATLAS_TESTES],
])("seleciona somente a URI e o banco do ambiente $APP_ENV", async (ambiente, nome, banco, host) => {
  const dados = { ...producao, ...homologacao, ...ambiente };
  expect(obterUriMongo(dados)).toBe(ambiente[nome]);
  await conectarBanco(dados, { dbName: "outro_banco" });
  expect(conectarMongo).toHaveBeenCalledWith(ambiente[nome], {
    dbName: banco, tls: true, tlsInsecure: false, srvAllowedHostsSuffix: host.slice(host.indexOf(".")),
  });
  delete dados[nome];
  await expect(conectarBanco(dados)).rejects.toThrow(`A variável ${nome} não foi definida`);
  expect(conectarMongo).toHaveBeenCalledTimes(1);
});

test.each([
  [{ ...producao, MONGO_URI_PRODUCTION: homologacao.MONGO_URI_HOMOLOGATION }],
  [{ ...producao, MONGO_URI_PRODUCTION: `mongodb+srv://${HOST_ATLAS_PRODUCAO}/outro_banco` }],
  [{ ...producao, MONGO_URI_PRODUCTION: "mongodb://127.0.0.1/pe_na_trilha" }],
  [{ ...homologacao, MONGO_URI_HOMOLOGATION: producao.MONGO_URI_PRODUCTION }],
  [{ ...homologacao, MONGO_URI_HOMOLOGATION: `${homologacao.MONGO_URI_HOMOLOGATION}?dbName=producao` }],
  [{ ...homologacao, MONGO_HOST_HOMOLOGATION: HOST_ATLAS_PRODUCAO }],
  [{ ...producao, NODE_ENV: "development" }],
])("recusa destino divergente antes de conectar", async (ambiente) => {
  await expect(conectarBanco(ambiente)).rejects.toThrow();
  expect(conectarMongo).not.toHaveBeenCalled();
});
