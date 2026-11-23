import { jest } from "@jest/globals";
import {
  conectarAposValidarSrv,
  executarAposValidarTopologia,
  validarDestinosSrv,
  validarMembrosReplicaSet,
  verificarTopologiaMongo,
} from "./integration/topologia.js";

describe("validação da topologia MongoDB de integração", () => {
  test("aceita todos os membros anunciados e normaliza portas e DNS", () => {
    const membros = validarMembrosReplicaSet({
      setName: "rsIntegration",
      me: "mongo-1.test.internal:27017",
      hosts: ["mongo-1.test.internal:27017", "mongo-2.test.internal:27017"],
      passives: ["mongo-3.test.internal:27017"],
      arbiters: [],
    }, [
      "mongo-1.test.internal",
      "mongo-2.test.internal",
      "mongo-3.test.internal",
    ]);

    expect(membros).toHaveLength(4);
  });

  test("rejeita membro do replica set fora da allowlist", () => {
    expect(() => validarMembrosReplicaSet({
      setName: "rsIntegration",
      me: "mongo-1.test.internal:27017",
      hosts: ["mongo-1.test.internal:27017", "mongo-producao.internal:27017"],
    }, ["mongo-1.test.internal"])).toThrow(
      "A topologia MongoDB anuncia hosts fora de TEST_MONGO_ALLOWED_HOSTS.",
    );
  });

  test("rejeita replica set sem a lista completa de membros", () => {
    expect(() => validarMembrosReplicaSet({
      setName: "rsIntegration",
      me: "mongo-1.test.internal:27017",
    }, ["mongo-1.test.internal"])).toThrow(
      "O replica set não anunciou a lista completa de membros.",
    );
  });

  test("rejeita topologia mongos sem enumerar membros internos", () => {
    expect(() => validarMembrosReplicaSet({ msg: "isdbgrid" }, ["mongos.test.internal"]))
      .toThrow("Topologia mongos não é aceita porque seus membros internos não são enumeráveis.");
  });

  test("valida todos os destinos DNS SRV antes da conexão", async () => {
    const resolver = jest.fn().mockResolvedValue([
      { name: "mongo-1.test.internal.", port: 27017 },
      { name: "mongo-2.test.internal.", port: 27017 },
    ]);

    const destinos = await validarDestinosSrv(
      "mongodb+srv://cluster.test.internal/pe_na_trilha_integration",
      ["mongo-1.test.internal", "mongo-2.test.internal"],
      resolver,
    );

    expect(resolver).toHaveBeenCalledWith("_mongodb._tcp.cluster.test.internal");
    expect(destinos).toEqual(["mongo-1.test.internal", "mongo-2.test.internal"]);
  });

  test("rejeita destino SRV fora da allowlist", async () => {
    const resolver = jest.fn().mockResolvedValue([
      { name: "mongo-1.test.internal.", port: 27017 },
      { name: "mongo-nao-autorizado.internal.", port: 27017 },
    ]);

    await expect(validarDestinosSrv(
      "mongodb+srv://cluster.test.internal/pe_na_trilha_integration",
      ["mongo-1.test.internal"],
      resolver,
    )).rejects.toThrow("A topologia MongoDB anuncia hosts fora de TEST_MONGO_ALLOWED_HOSTS.");
  });

  test("rejeita alteração dos destinos SRV antes de chamar a conexão", async () => {
    const resolver = jest.fn()
      .mockResolvedValueOnce([{ name: "mongo-1.test.internal.", port: 27017 }])
      .mockResolvedValueOnce([{ name: "mongo-prod.internal.", port: 27017 }]);
    const conectar = jest.fn();

    await expect(conectarAposValidarSrv(
      "mongodb+srv://cluster.test.internal/pe_na_trilha_integration",
      ["mongo-1.test.internal", "mongo-prod.internal"],
      conectar,
      resolver,
    )).rejects.toThrow("Os destinos DNS SRV mudaram durante a validação de pré-conexão.");

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(conectar).not.toHaveBeenCalled();
  });

  test("confirma hosts e portas em duas respostas SRV antes de conectar", async () => {
    const respostas = [
      [{ name: "mongo-1.test.internal.", port: 27017 }],
      [{ name: "mongo-1.test.internal.", port: 27018 }],
    ];
    const conectar = jest.fn();

    await expect(conectarAposValidarSrv(
      "mongodb+srv://cluster.test.internal/pe_na_trilha_integration",
      ["mongo-1.test.internal"],
      conectar,
      jest.fn().mockImplementation(() => respostas.shift()),
    )).rejects.toThrow("Os destinos DNS SRV mudaram durante a validação de pré-conexão.");

    expect(conectar).not.toHaveBeenCalled();
  });

  test("executa gravações e inicialização de model somente após validar a topologia", async () => {
    const writeSetup = jest.fn();
    const importModelAndWriteTeardown = jest.fn();
    const db = { admin: () => ({ command: jest.fn().mockResolvedValue({
      setName: "rsIntegration",
      me: "mongo-1.test:27017",
      hosts: ["mongo-1.test:27017", "mongo-prod.internal:27017"],
    }) }) };

    await expect(executarAposValidarTopologia(db, ["mongo-1.test"], writeSetup))
      .rejects.toThrow("A topologia MongoDB anuncia hosts fora de TEST_MONGO_ALLOWED_HOSTS.");
    await expect(executarAposValidarTopologia(db, ["mongo-1.test"], importModelAndWriteTeardown))
      .rejects.toThrow("A topologia MongoDB anuncia hosts fora de TEST_MONGO_ALLOWED_HOSTS.");

    expect(writeSetup).not.toHaveBeenCalled();
    expect(importModelAndWriteTeardown).not.toHaveBeenCalled();
  });

  test("consulta hello e aplica a validação antes de retornar a topologia", async () => {
    const hello = { setName: "rsIntegration", me: "mongo-1.test:27017", hosts: ["mongo-1.test:27017"] };
    const db = { admin: () => ({ command: jest.fn().mockResolvedValue(hello) }) };

    await expect(verificarTopologiaMongo(db, ["mongo-1.test"])).resolves.toBe(hello);
  });
});
