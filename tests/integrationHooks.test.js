import { jest } from "@jest/globals";

const estado = {
  eventos: [],
  falharTopologia: false,
  marcadorExiste: true,
  marcadorValido: true,
  colecoes: [],
  etapaFalha: null,
  falharDesconexao: false,
  banco: "pe_na_trilha_integration_run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runId: "a".repeat(32),
  erroOriginal: null,
};

const config = {
  uri: "mongodb://mongo.test.internal/pe_na_trilha_integration",
  hostsPermitidos: ["mongo.test.internal"],
  cloudinary: {
    TEST_CLOUDINARY_CLOUD_NAME: "cloud-test",
    TEST_CLOUDINARY_API_KEY: "test-key",
    TEST_CLOUDINARY_API_SECRET: "test-secret",
  },
};

const marcador = {
  _id: estado.runId,
  environment: "integration",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function criarErroSimulado() {
  const erro = new Error("URI mongodb://user:password@host e CLOUDINARY_API_SECRET=secret");
  erro.name = "MongoServerError";
  erro.code = 13;
  erro.codeName = "Unauthorized";
  return erro;
}

const model = {
  collection: { name: "operacaoimagems" },
  init: jest.fn(),
};

const db = {
  admin: () => ({
    command: jest.fn(async () => {
      estado.eventos.push("validar-topologia");
      if (estado.falharTopologia || estado.etapaFalha === "validação da topologia") {
        throw estado.erroOriginal || new Error("topologia não autorizada");
      }
      return {
        setName: "rsIntegration",
        me: "mongo.test.internal:27017",
        hosts: ["mongo.test.internal:27017"],
      };
    }),
  }),
  listCollections: jest.fn(() => ({
    toArray: jest.fn(async () => {
      estado.eventos.push("listar-colecoes");
      if (estado.etapaFalha === "verificação de banco vazio") throw estado.erroOriginal;
      return estado.colecoes;
    }),
  })),
  createCollection: jest.fn(async () => {
    estado.eventos.push("criar-colecao");
    if (estado.etapaFalha === "criação do marcador") throw estado.erroOriginal;
  }),
  collection: jest.fn((nome) => ({
    insertOne: jest.fn(async () => {
      estado.eventos.push(`inserir:${nome}`);
      if (estado.etapaFalha === "criação do marcador") throw estado.erroOriginal;
    }),
    findOne: jest.fn(async () => {
      estado.eventos.push(`buscar:${nome}`);
      return estado.marcadorExiste ? marcador : null;
    }),
    find: jest.fn(() => ({ toArray: async () => [] })),
    distinct: jest.fn(async () => []),
    deleteMany: jest.fn(async () => {
      estado.eventos.push(`limpar:${nome}`);
    }),
    deleteOne: jest.fn(async () => {
      estado.eventos.push(`remover:${nome}`);
    }),
  })),
};

const mongoose = {
  connection: { db },
  connect: jest.fn(async () => {
    estado.eventos.push("conectar");
    if (estado.etapaFalha === "conexão MongoDB") throw estado.erroOriginal;
    return mongoose;
  }),
  disconnect: jest.fn(async () => {
    estado.eventos.push("desconectar");
    if (estado.falharDesconexao) throw new Error("erro de desconexão com conteúdo interno");
  }),
};

const excluirImagem = jest.fn(async () => {
  estado.eventos.push("excluir-cloudinary");
});

jest.unstable_mockModule("mongoose", () => ({ default: mongoose }));
jest.unstable_mockModule("./integration/ambiente.js", () => ({
  carregarAmbienteIntegracao: jest.fn(() => config),
  prepararAmbienteAplicacao: jest.fn(),
  validarBancoDaExecucao: jest.fn(() => estado.banco),
}));
jest.unstable_mockModule("./integration/topologia.js", () => ({
  conectarAposValidarSrv: jest.fn(async (_uri, _hosts, conectar) => {
    estado.eventos.push("validar-srv");
    if (estado.etapaFalha === "preflight e validação SRV") throw estado.erroOriginal;
    return conectar();
  }),
  executarAposValidarTopologia: jest.fn(async (database, _hosts, operacao) => {
    await database.admin().command({ hello: 1 });
    if (estado.falharTopologia) throw new Error("topologia não autorizada");
    return operacao(database);
  }),
}));
jest.unstable_mockModule("../src/services/cloudinaryService.js", () => ({
  excluirImagem,
}));
jest.unstable_mockModule("../src/models/OperacaoImagem.js", () => ({
  default: model,
}));
jest.unstable_mockModule("./integration/registroAssets.js", () => ({
  limparAssetsRegistrados: jest.fn(async () => {
    estado.eventos.push("limpar-assets");
  }),
  validarMarcadorDaExecucao: jest.fn(async () => {
    estado.eventos.push("buscar:__integration_run");
    if (!estado.marcadorExiste || !estado.marcadorValido) {
      throw new Error("O marcador da execução de integração não foi encontrado.");
    }
    return marcador;
  }),
  validarCoberturaAssetsOperacao: jest.fn(),
  validarRegistrosAssets: jest.fn(),
}));
jest.unstable_mockModule("./integration/mensagemRecuperacao.js", () => ({
  mensagemRecuperacaoIntegracao: jest.fn(() => "Falha segura; base isolada preservada."),
}));

const { default: globalSetup } = await import("./integration/globalSetup.js");
const { default: globalTeardown } = await import("./integration/globalTeardown.js");

describe("hooks globais de integração", () => {
  let erroConsole;
  let runIdAnterior;

  beforeEach(() => {
    runIdAnterior = process.env.TEST_RUN_ID;
    estado.eventos.length = 0;
    estado.falharTopologia = false;
    estado.marcadorExiste = true;
    estado.marcadorValido = true;
    estado.colecoes = [];
    estado.etapaFalha = null;
    estado.falharDesconexao = false;
    estado.erroOriginal = criarErroSimulado();
    process.env.TEST_RUN_ID = estado.runId;
    mongoose.connect.mockClear();
    mongoose.disconnect.mockClear();
    db.listCollections.mockClear();
    db.createCollection.mockClear();
    db.collection.mockClear();
    model.init.mockReset().mockImplementation(async () => {
      estado.eventos.push("iniciar-model");
      return model;
    });
    excluirImagem.mockClear();
    erroConsole = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    erroConsole.mockRestore();
    if (runIdAnterior === undefined) delete process.env.TEST_RUN_ID;
    else process.env.TEST_RUN_ID = runIdAnterior;
  });

  test("globalSetup valida topologia antes de consultar ou escrever no banco", async () => {
    await globalSetup();

    expect(estado.eventos.indexOf("validar-topologia"))
      .toBeLessThan(estado.eventos.indexOf("listar-colecoes"));
    expect(estado.eventos.indexOf("validar-topologia"))
      .toBeLessThan(estado.eventos.indexOf("criar-colecao"));
    expect(estado.eventos.indexOf("validar-topologia"))
      .toBeLessThan(estado.eventos.indexOf("inserir:__integration_run"));
  });

  test("globalSetup não grava se a validação da topologia falhar", async () => {
    estado.falharTopologia = true;

    await expect(globalSetup()).rejects.toThrow(
      "Não foi possível validar e reservar a base isolada de integração.",
    );

    expect(db.createCollection).not.toHaveBeenCalled();
    expect(estado.eventos.some((evento) => evento.startsWith("inserir:"))).toBe(false);
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["preflight e validação SRV", "preflight e validação SRV"],
    ["conexão MongoDB", "conexão MongoDB"],
    ["validação da topologia", "validação da topologia"],
    ["verificação de banco vazio", "verificação de banco vazio"],
    ["criação do marcador", "criação do marcador"],
  ])("registra somente o diagnóstico seguro da etapa %s", async (etapa, etapaLog) => {
    estado.etapaFalha = etapa;

    let erroApresentado;
    try {
      await globalSetup();
    } catch (erro) {
      erroApresentado = erro;
    }

    expect(erroApresentado.cause).toBe(estado.erroOriginal);
    expect(erroApresentado.message).toContain(estado.banco);
    expect(erroApresentado.message).toContain(etapa);
    expect(erroConsole).toHaveBeenCalledWith(JSON.stringify({
      etapa: etapaLog,
      name: "MongoServerError",
      code: 13,
      codeName: "Unauthorized",
    }));
    expect(JSON.stringify(erroConsole.mock.calls)).not.toContain("password");
    expect(JSON.stringify(erroConsole.mock.calls)).not.toContain("CLOUDINARY_API_SECRET");
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  });

  test("falha na desconexão não substitui a causa original", async () => {
    estado.etapaFalha = "validação da topologia";
    estado.falharDesconexao = true;

    let erroApresentado;
    try {
      await globalSetup();
    } catch (erro) {
      erroApresentado = erro;
    }

    expect(erroApresentado.cause).toBe(estado.erroOriginal);
    expect(erroConsole).toHaveBeenCalledWith(JSON.stringify({
      etapa: "desconexão MongoDB",
      name: "Error",
    }));
  });

  test("globalTeardown valida topologia e marcador antes de inicializar o model", async () => {
    estado.colecoes = [{ name: "__integration_run" }];
    await globalTeardown();

    expect(estado.eventos.indexOf("validar-topologia"))
      .toBeLessThan(estado.eventos.indexOf("buscar:__integration_run"));
    expect(estado.eventos.indexOf("buscar:__integration_run"))
      .toBeLessThan(estado.eventos.indexOf("iniciar-model"));
    expect(estado.eventos.indexOf("iniciar-model"))
      .toBeLessThan(estado.eventos.indexOf("listar-colecoes"));
    expect(model.init).toHaveBeenCalledTimes(1);
    expect(excluirImagem).not.toHaveBeenCalled();
  });

  test("globalTeardown aguarda OperacaoImagem.init antes de consultar coleções", async () => {
    estado.colecoes = [{ name: "__integration_run" }];
    let liberarInit;
    let notificarInit;
    const initIniciado = new Promise((resolve) => {
      notificarInit = resolve;
    });
    model.init.mockImplementation(() => {
      estado.eventos.push("iniciar-model");
      notificarInit();
      return new Promise((resolve) => {
        liberarInit = () => {
          estado.eventos.push("model-inicializado");
          resolve(model);
        };
      });
    });

    const teardown = globalTeardown();
    await initIniciado;
    expect(db.listCollections).not.toHaveBeenCalled();

    liberarInit();
    await teardown;

    expect(estado.eventos.indexOf("model-inicializado"))
      .toBeLessThan(estado.eventos.indexOf("listar-colecoes"));
  });

  test("falha em init interrompe a limpeza e preserva marcador e registros", async () => {
    estado.colecoes = [{ name: "__integration_run" }];
    model.init.mockRejectedValue(new Error("erro interno de índice"));

    await expect(globalTeardown()).rejects.toThrow(
      "Falha segura; base isolada preservada.",
    );

    expect(db.listCollections).not.toHaveBeenCalled();
    expect(excluirImagem).not.toHaveBeenCalled();
    expect(estado.eventos).not.toContain("limpar-assets");
    expect(estado.eventos).not.toContain("remover:__integration_run");
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
    expect(erroConsole).toHaveBeenCalledWith("Falha segura; base isolada preservada.");
  });

  test("globalTeardown não inicializa modelo nem limpa se a topologia falhar", async () => {
    estado.falharTopologia = true;

    await expect(globalTeardown()).rejects.toThrow(
      "Falha segura; base isolada preservada.",
    );

    expect(model.init).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
    expect(db.listCollections).not.toHaveBeenCalled();
    expect(excluirImagem).not.toHaveBeenCalled();
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  });

  test("globalTeardown não inicializa modelo nem limpa se o marcador não existir", async () => {
    estado.marcadorExiste = false;

    await expect(globalTeardown()).rejects.toThrow(
      "Falha segura; base isolada preservada.",
    );

    expect(model.init).not.toHaveBeenCalled();
    expect(db.listCollections).not.toHaveBeenCalled();
    expect(excluirImagem).not.toHaveBeenCalled();
    expect(estado.eventos).not.toContain("remover:__integration_run");
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  });

  test("globalTeardown não inicializa modelo nem limpa se createdAt do marcador for inválido", async () => {
    estado.marcadorValido = false;

    await expect(globalTeardown()).rejects.toThrow(
      "Falha segura; base isolada preservada.",
    );

    expect(estado.eventos.indexOf("validar-topologia"))
      .toBeLessThan(estado.eventos.indexOf("buscar:__integration_run"));
    expect(estado.eventos).not.toContain("iniciar-model");
    expect(db.listCollections).not.toHaveBeenCalled();
    expect(excluirImagem).not.toHaveBeenCalled();
    expect(estado.eventos).not.toContain("limpar-assets");
    expect(estado.eventos).not.toContain("remover:__integration_run");
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  });
});
