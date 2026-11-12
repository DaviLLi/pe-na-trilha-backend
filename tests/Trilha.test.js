import mongoose from "mongoose";
import Trilha from "../src/models/Trilha.js";

describe("model Trilha", () => {
  test("exige proprietário em novos registros", async () => {
    const trilha = new Trilha({
      titulo: "Trilha da Lagoa",
      descricao: "Muito bonita",
      endereco: "Florianópolis",
    });

    await expect(trilha.validate()).rejects.toMatchObject({
      errors: {
        proprietario: expect.objectContaining({ kind: "required" }),
      },
    });
  });

  test("define proprietário como referência a Usuario", () => {
    const caminho = Trilha.schema.path("proprietario");

    expect(caminho.instance).toBe("ObjectId");
    expect(caminho.options.ref).toBe("Usuario");
    expect(caminho.isRequired).toBe(true);
  });

  test("aceita proprietário ObjectId válido", async () => {
    const trilha = new Trilha({
      titulo: "Trilha da Lagoa",
      descricao: "Muito bonita",
      endereco: "Florianópolis",
      proprietario: new mongoose.Types.ObjectId(),
    });

    await expect(trilha.validate()).resolves.toBeUndefined();
  });

  test("inicializa fotos vazias e não serializa public IDs", () => {
    const trilha = new Trilha({
      titulo: "Trilha da Lagoa",
      descricao: "Muito bonita",
      endereco: "Florianópolis",
      proprietario: new mongoose.Types.ObjectId(),
      fotos: [{
        url: "https://res.cloudinary.com/demo/foto.jpg",
        publicId: "pe-na-trilha/trilhas/interno",
      }],
    });

    expect(trilha.toJSON().fotos).toHaveLength(1);
    expect(trilha.toJSON().fotos[0]).not.toHaveProperty("publicId");
    expect(new Trilha().fotos).toEqual([]);
  });

  test("serializa trilha legada sem fotos como lista vazia", () => {
    const legada = Trilha.hydrate({
      _id: new mongoose.Types.ObjectId(),
      titulo: "Trilha antiga",
      descricao: "Descrição",
      endereco: "Endereço",
      proprietario: new mongoose.Types.ObjectId(),
    });

    expect(legada.toJSON().fotos).toEqual([]);
  });
});

test("publicações novas começam pendentes com histórico vazio", () => {
  const trilha = new Trilha();
  expect(trilha.status).toBe("pending");
  expect(trilha.historicoModeracao).toEqual([]);
  expect(trilha.duracao).toBeNull();
});

test("schema rejeita status, opções e duração inválidos", async () => {
  const trilha = new Trilha({
    titulo: "Teste", descricao: "Descrição", endereco: "Local",
    proprietario: new mongoose.Types.ObjectId(), status: "publicada",
    dificuldade: "Impossível", duracao: { horas: 0, minutos: 0 },
  });
  await expect(trilha.validate()).rejects.toMatchObject({ errors: {
    status: expect.anything(), dificuldade: expect.anything(), duracao: expect.anything(),
  } });
});
