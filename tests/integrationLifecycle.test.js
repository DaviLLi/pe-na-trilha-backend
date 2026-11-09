import { jest } from "@jest/globals";
import {
  conectarAposValidarSrv,
  executarAposValidarTopologia,
} from "./integration/topologia.js";

describe("ordem segura do ciclo de vida dos testes de integração", () => {
  test("uma resposta SRV diferente bloqueia a conexão antes de qualquer operação no banco", async () => {
    const resolver = jest.fn()
      .mockResolvedValueOnce([{ name: "mongo-teste.internal.", port: 27017 }])
      .mockResolvedValueOnce([{ name: "mongo-producao.internal.", port: 27017 }]);
    const conectar = jest.fn();
    const executarEscrita = jest.fn();

    await expect(conectarAposValidarSrv(
      "mongodb+srv://cluster.test.internal/pe_na_trilha_integration",
      ["mongo-teste.internal", "mongo-producao.internal"],
      conectar,
      resolver,
    )).rejects.toThrow("Os destinos DNS SRV mudaram durante a validação de pré-conexão.");

    expect(conectar).not.toHaveBeenCalled();
    expect(executarEscrita).not.toHaveBeenCalled();
  });

  test.each(["setup", "teardown e inicialização do model"]) (
    "%s não executa gravações se a topologia não for aprovada",
    async () => {
      const eventos = [];
      const db = {
        admin: () => ({ command: jest.fn().mockResolvedValue({
          setName: "rsIntegration",
          me: "mongo-teste.internal:27017",
          hosts: ["mongo-teste.internal:27017", "mongo-desconhecido.internal:27017"],
        }) }),
      };
      const operacao = jest.fn(async () => eventos.push("escrita/importação do model"));

      await expect(executarAposValidarTopologia(db, ["mongo-teste.internal"], operacao))
        .rejects.toThrow("A topologia MongoDB anuncia hosts fora de TEST_MONGO_ALLOWED_HOSTS.");

      expect(operacao).not.toHaveBeenCalled();
      expect(eventos).toEqual([]);
    },
  );
});
