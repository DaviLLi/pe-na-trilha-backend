import { jest } from "@jest/globals";
import { validarUsuario } from "../src/middlewares/validarUsuario.js";

function criarRespostaMock() {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(),
  };

  return res;
}

function criarRequisicao(overrides = {}) {
  return {
    body: {
      nomeCompleto: " Ana da Silva ",
      nomeUsuario: "ÁNA",
      email: " ANA@EXEMPLO.COM ",
      senha: "Trilha123!",
      ...overrides,
    },
  };
}

describe("validarUsuario", () => {
  test("normaliza nome de usuário e e-mail e define o perfil como user", () => {
    const req = criarRequisicao({ perfil: "admin" });
    const next = jest.fn();

    validarUsuario(req, {}, next);

    expect(req.body).toEqual({
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ána",
      email: "ana@exemplo.com",
      senha: "Trilha123!",
      fotoPerfil: null,
      perfil: "user",
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["123Ana", "números"],
    ["Ana Silva", "espaços"],
    ["Ana-Silva", "símbolos"],
  ])("rejeita nome de usuário com %s (%s)", (nomeUsuario) => {
    const res = criarRespostaMock();
    const next = jest.fn();

    validarUsuario(criarRequisicao({ nomeUsuario }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ["trilha123!", "maiúscula"],
    ["TRILHA123!", "minúscula"],
    ["Trilhaabc!", "número"],
    ["Trilha1234", "caractere especial"],
    ["Tr1!a", "tamanho mínimo"],
  ])("rejeita senha sem requisito de %s (%s)", (senha) => {
    const res = criarRespostaMock();
    const next = jest.fn();

    validarUsuario(criarRequisicao({ senha }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ["Aa1!" + "x".repeat(68), true],
    ["Aa1!" + "x".repeat(69), false],
    ["Áa1!" + "x".repeat(68), false],
  ])("aplica o limite de 72 bytes à senha", (senha, valida) => {
    const req = criarRequisicao({ senha });
    const res = criarRespostaMock();
    const next = jest.fn();

    validarUsuario(req, res, next);

    if (valida) {
      expect(next).toHaveBeenCalledTimes(1);
    } else {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test("rejeita nome completo ausente ou vazio", () => {
    for (const nomeCompleto of [undefined, "   "]) {
      const res = criarRespostaMock();
      const next = jest.fn();

      validarUsuario(criarRequisicao({ nomeCompleto }), res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        mensagem: "O nome completo é obrigatório.",
      });
      expect(next).not.toHaveBeenCalled();
    }
  });

  test("rejeita e-mail inválido", () => {
    const res = criarRespostaMock();
    const next = jest.fn();

    validarUsuario(criarRequisicao({ email: "invalido" }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "O e-mail informado é inválido.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("mantém foto de perfil nula quando não enviada e aceita texto opcional", () => {
    const reqSemFoto = criarRequisicao();
    validarUsuario(reqSemFoto, {}, jest.fn());
    expect(reqSemFoto.body.fotoPerfil).toBeNull();

    const reqComFoto = criarRequisicao({ fotoPerfil: " https://exemplo.com/foto.jpg " });
    validarUsuario(reqComFoto, {}, jest.fn());
    expect(reqComFoto.body.fotoPerfil).toBe("https://exemplo.com/foto.jpg");
  });
});
