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
});
