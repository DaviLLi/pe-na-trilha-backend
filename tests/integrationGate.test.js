import { jest } from "@jest/globals";
import { conectarComGateDeInfra } from "./integration/infraGate.js";

const URI = "mongodb://mongo-test.internal:27017/pe_na_trilha_integration";
const HOSTS = ["mongo-test.internal"];
const RUN_ID = "a".repeat(32);

function criarDb({ hosts = ["mongo-test.internal:27017"], marker = null } = {}) {
  const eventos = [];
  const findMarker = jest.fn(async () => {
    eventos.push("marcador");
    return marker;
  });
  const db = {
    eventos,
    admin: () => ({
      command: jest.fn(async () => {
        eventos.push("topologia");
        return { setName: "rsIntegration", me: hosts[0], hosts };
      }),
    }),
    collection: jest.fn(() => ({ findOne: findMarker })),
    createCollection: jest.fn(async () => eventos.push("escrita")),
  };
  return { db, findMarker };
}

describe("gate da infraestrutura MongoDB de integração", () => {
  const marker = {
    _id: RUN_ID,
    environment: "integration",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  test("SRV divergente bloqueia conexão antes de qualquer escrita", async () => {
    const conectar = jest.fn();
    const resolver = jest.fn()
      .mockResolvedValueOnce([{ name: "mongo-test.internal.", port: 27017 }])
      .mockResolvedValueOnce([{ name: "mongo-prod.internal.", port: 27017 }]);

    await expect(conectarComGateDeInfra({
      uri: "mongodb+srv://cluster.test.internal/pe_na_trilha_integration",
      hostsPermitidos: ["mongo-test.internal", "mongo-prod.internal"],
      runId: RUN_ID,
      conectar,
      desconectar: jest.fn(),
      resolver,
    })).rejects.toThrow("Os destinos DNS SRV mudaram durante a validação de pré-conexão.");

    expect(conectar).not.toHaveBeenCalled();
  });

  test("topologia inválida fecha a conexão e impede a leitura do marcador e a transação", async () => {
    const { db, findMarker } = criarDb({
      hosts: ["mongo-test.internal:27017", "mongo-unapproved.internal:27017"],
      marker,
    });
    const desconectar = jest.fn();
    const executarTransacao = jest.fn();

    await expect((async () => {
      const infraestrutura = await conectarComGateDeInfra({
        uri: URI,
        hostsPermitidos: HOSTS,
        runId: RUN_ID,
        conectar: jest.fn(async () => db),
        desconectar,
      });
      await executarTransacao(infraestrutura.db);
    })()).rejects.toThrow("A topologia MongoDB anuncia hosts fora de TEST_MONGO_ALLOWED_HOSTS.");

    expect(desconectar).toHaveBeenCalledTimes(1);
    expect(findMarker).not.toHaveBeenCalled();
    expect(db.createCollection).not.toHaveBeenCalled();
    expect(executarTransacao).not.toHaveBeenCalled();
  });

  test("marcador ausente fecha a conexão e não libera a infraestrutura para escrita", async () => {
    const { db, findMarker } = criarDb({ marker: null });
    const desconectar = jest.fn();
    const executarTransacao = jest.fn();

    await expect((async () => {
      const infraestrutura = await conectarComGateDeInfra({
        uri: URI,
        hostsPermitidos: HOSTS,
        runId: RUN_ID,
        conectar: jest.fn(async () => db),
        desconectar,
      });
      await executarTransacao(infraestrutura.db);
    })()).rejects.toThrow("O marcador da execução de integração não foi encontrado.");

    expect(findMarker).toHaveBeenCalledWith({ _id: RUN_ID, environment: "integration" });
    expect(desconectar).toHaveBeenCalledTimes(1);
    expect(db.createCollection).not.toHaveBeenCalled();
    expect(executarTransacao).not.toHaveBeenCalled();
  });

  test("retorna a conexão somente depois de SRV, topologia e marcador válidos", async () => {
    const { db } = criarDb({ marker });
    const eventos = [];
    const resultado = await conectarComGateDeInfra({
      uri: URI,
      hostsPermitidos: HOSTS,
      runId: RUN_ID,
      conectar: jest.fn(async () => {
        eventos.push("conectar");
        return db;
      }),
      desconectar: jest.fn(),
    });

    expect(resultado).toMatchObject({ db, marcador: marker });
    expect(db.eventos).toEqual(["topologia", "marcador"]);
    expect(eventos).toEqual(["conectar"]);
  });
});
