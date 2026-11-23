import bcrypt from "bcrypt";
import Usuario from "../src/models/Usuario.js";

function criarUsuario(overrides = {}) {
  return new Usuario({
    nomeCompleto: "Ana da Silva",
    nomeUsuario: "ÁNA",
    email: "ANA@EXEMPLO.COM",
    senha: "Trilha123!",
    ...overrides,
  });
}

describe("modelo Usuario", () => {
  test("normaliza nome de usuário e e-mail e aplica defaults", () => {
    const usuario = criarUsuario();

    expect(usuario.nomeUsuario).toBe("ána");
    expect(usuario.email).toBe("ana@exemplo.com");
    expect(usuario.fotoPerfil).toBeNull();
    expect(usuario.perfil).toBe("user");
  });

  test("declara índices únicos para e-mail e nome de usuário", () => {
    const indices = Usuario.schema.indexes();

    expect(indices).toEqual(
      expect.arrayContaining([
        [{ nomeUsuario: 1 }, expect.objectContaining({ unique: true })],
        [{ email: 1 }, expect.objectContaining({ unique: true })],
      ]),
    );
  });

  test("permite perfil admin em documento confiável e aplica user por padrão", async () => {
    const usuario = criarUsuario({ perfil: "admin" });

    expect(usuario.perfil).toBe("admin");
    await expect(usuario.validate()).resolves.toBeUndefined();
  });

  test("valida senha antes de persistir", async () => {
    const usuario = criarUsuario({ senha: "senha-invalida" });

    await expect(usuario.validate()).rejects.toMatchObject({
      errors: {
        senha: expect.objectContaining({ message: expect.stringMatching(/maiúscula/) }),
      },
    });
  });

  test("não seleciona senha em consultas comuns nem serializa o hash", () => {
    const usuario = criarUsuario();
    usuario.senha = "$2b$12$hash-de-teste";

    expect(Usuario.schema.path("senha").options.select).toBe(false);
    expect(usuario.toJSON()).not.toHaveProperty("senha");
    expect(usuario.toObject()).not.toHaveProperty("senha");
  });

  test("hook real hasheia senha nova e alterada, sem rehash em save sem alteração", async () => {
    const usuario = criarUsuario();
    const executarHooksSave = () =>
      Usuario._middleware.execPre("save", usuario, [usuario, {}]);

    await executarHooksSave();
    const primeiroHash = usuario.senha;
    expect(primeiroHash).not.toBe("Trilha123!");
    await expect(bcrypt.compare("Trilha123!", primeiroHash)).resolves.toBe(true);

    usuario.$__reset();
    await executarHooksSave();
    expect(usuario.senha).toBe(primeiroHash);

    usuario.senha = "NovaTrilha123!";
    await executarHooksSave();
    expect(usuario.senha).not.toBe(primeiroHash);
    await expect(bcrypt.compare("NovaTrilha123!", usuario.senha)).resolves.toBe(true);
  });

  test.each([
    ["Aa1!" + "x".repeat(68), true],
    ["Aa1!" + "x".repeat(69), false],
    ["Áa1!" + "x".repeat(68), false],
  ])("valida limite de 72 bytes no model", async (senha, valida) => {
    const usuario = criarUsuario({ senha });

    if (valida) {
      await expect(usuario.validate()).resolves.toBeUndefined();
    } else {
      await expect(usuario.validate()).rejects.toMatchObject({
        errors: { senha: expect.any(Object) },
      });
    }
  });

  test("rejeita atualizações diretas da senha por query", async () => {
    const atualizacoes = [
      { $set: { senha: "NovaTrilha123!" } },
      { $rename: { apelido: "senha" } },
    ];

    for (const atualizacao of atualizacoes) {
      await expect(Usuario.updateOne({}, atualizacao).exec()).rejects.toThrow(
        "A senha deve ser alterada",
      );
    }
  });

  test("rejeita escritas de senha por bulkWrite e insertMany", async () => {
    await expect(
      Usuario._middleware.execPre("bulkWrite", Usuario, [
        [{ updateOne: { filter: {}, update: { $set: { senha: "NovaTrilha123!" } } } }],
        {},
      ]),
    ).rejects.toThrow("A senha deve ser alterada");

    await expect(
      Usuario._middleware.execPre("insertMany", Usuario, [[{
          nomeCompleto: "Ana da Silva",
          nomeUsuario: "Ana",
          email: "ana@exemplo.com",
          senha: "Trilha123!",
        }]]),
    ).rejects.toThrow("Usuários devem ser criados");
  });
});
