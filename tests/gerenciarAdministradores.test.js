import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { jest } from "@jest/globals";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import Usuario from "../src/models/Usuario.js";
import {
  alterarPerfilAdmin,
  localizarContaAdmin,
} from "../src/services/gerenciarAdministradores.js";
import { executarGerenciamentoAdmin, lerSenhaAdmin } from "../tools/gerenciar-admin.js";

const idOriginal = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
const idAlvo = new mongoose.Types.ObjectId("507f1f77bcf86cd799439012");
const idOutro = new mongoose.Types.ObjectId("507f1f77bcf86cd799439013");
const senhaSintetica = "Senha-sintetica-123!";
let hash;
beforeAll(async () => { hash = await bcrypt.hash(senhaSintetica, 4); });

function conta(_id, email, perfil) {
  return {
    _id, email, perfil,
    nomeCompleto: "Pessoa sintética",
    nomeUsuario: "pessoa",
    senha: hash,
    fotoPerfil: "foto-sintetica",
    fotoPerfilPublicId: "id-foto-sintetica",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };
}

function preparar({
  perfilAlvo = "user", perfilOriginal = "admin", temOriginal = true,
  marcador = { _id: "primeiro-admin", usuario: idOriginal },
} = {}) {
  const original = conta(idOriginal, "original@example.test", perfilOriginal);
  const alvo = conta(idAlvo, "alvo@example.test", perfilAlvo);
  const outro = conta(idOutro, "outro@example.test", "admin");
  const registros = [alvo, outro, ...(temOriginal ? [original] : [])];
  const novaSessao = () => ({
    withTransaction: jest.fn(async (acao) => {
      const estado = registros.map((u) => u.perfil);
      try { return await acao(); } catch (erro) {
        registros.forEach((u, i) => { u.perfil = estado[i]; });
        throw erro;
      }
    }),
    endSession: jest.fn(),
  });
  const sessao = novaSessao();
  const controle = { findOne: jest.fn().mockResolvedValue(marcador) };
  const usuarios = {
    find: jest.fn(({ email }) => {
      const consulta = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        then: (resolver) => Promise.resolve(registros.filter((u) => u.email === email)
          .slice(0, 2).map(({ _id, email: encontrado, perfil }) => ({ _id, email: encontrado, perfil }))).then(resolver),
      };
      return consulta;
    }),
    findById: jest.fn((_id) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      then: (resolver) => {
        const conta = registros.find((u) => u._id.equals(_id));
        return Promise.resolve(conta ? { ...conta } : null).then(resolver);
      },
    })),
    updateOne: jest.fn(async ({ _id, email, perfil }, { $set }) => {
      const encontrada = registros.find((u) => u._id.equals(_id) && u.email === email && u.perfil === perfil);
      if (!encontrada) return { modifiedCount: 0 };
      Object.assign(encontrada, $set);
      return { modifiedCount: 1 };
    }),
  };
  const iniciarSessao = jest.fn(async () => novaSessao()).mockResolvedValueOnce(sessao);
  let reservas = 0;
  const tentativas = { findOneAndUpdate: jest.fn(async () => ({ tentativas: ++reservas })) };
  const auditoria = { insertOne: jest.fn().mockResolvedValue({ acknowledged: true }) };
  const deps = { usuarios, controle, iniciarSessao, auditoria, tentativas };
  return { original, alvo, outro, registros, marcador, sessao, deps };
}

function alterar(t, acao, alvo = t.alvo, confirmado = true) {
  return alterarPerfilAdmin({
    acao, email: alvo.email, usuarioId: alvo._id, confirmado, operadorId: idOriginal, senha: senhaSintetica,
  }, t.deps);
}

describe("mudanças de perfil administrativas", () => {
  test("promove somente o alvo e permite três administradores", async () => {
    const t = preparar();
    const antes = { ...t.alvo }, originalAntes = { ...t.original }, outroAntes = { ...t.outro };
    await alterar(t, "promover");
    expect(t.alvo).toEqual({ ...antes, perfil: "admin" });
    expect(t.original).toEqual(originalAntes);
    expect(t.outro).toEqual(outroAntes);
    expect(t.registros.filter((u) => u.perfil === "admin")).toHaveLength(3);
    expect(t.deps.usuarios.updateOne).toHaveBeenCalledTimes(1);
    expect(t.deps.usuarios.updateOne).toHaveBeenCalledWith(
      { _id: idAlvo, email: "alvo@example.test", perfil: "user" },
      { $set: { perfil: "admin" } },
      { session: t.sessao, timestamps: false, runValidators: true },
    );
    expect(t.sessao.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      readPreference: "primary", readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
    });
    expect(t.sessao.endSession).toHaveBeenCalledTimes(1);
    expect(t.marcador.usuario).toEqual(idOriginal);
    expect(t.deps.auditoria.insertOne).toHaveBeenCalledWith(
      { ator: idOriginal, alvo: idAlvo, acao: "promover", criadoEm: expect.any(Date) },
      { session: t.sessao },
    );
  });

  test("desfaz a atualização se o registro da auditoria falhar", async () => {
    const t = preparar();
    t.deps.auditoria.insertOne.mockRejectedValue(new Error("auditoria indisponível"));
    await expect(alterar(t, "promover")).rejects.toThrow("auditoria indisponível");
    expect(t.alvo.perfil).toBe("user");
    expect(t.sessao.endSession).toHaveBeenCalledTimes(1);
  });

  test("revalida marcador e credencial na transação após a comparação", async () => {
    const t = preparar();
    t.deps.controle.findOne.mockResolvedValueOnce(t.marcador).mockResolvedValueOnce({ usuario: idOutro });
    await expect(alterar(t, "promover")).rejects.toMatchObject({ codigo: "ACESSO_PRINCIPAL" });
    expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
    expect(t.deps.auditoria.insertOne).not.toHaveBeenCalled();
  });

  test("rejeita credencial que mudou entre a confirmação e a transação", async () => {
    const t = preparar();
    t.sessao.withTransaction.mockImplementationOnce((acao) => {
      t.original.senha = "hash-alterado-sintetico";
      return acao();
    });
    await expect(alterar(t, "promover")).rejects.toMatchObject({ codigo: "IDENTIDADE_NAO_CONFIRMADA" });
    expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
  });

  test("reserva no servidor e satura tentativas, inclusive com primeira reserva concorrente", async () => {
    const t = preparar();
    t.deps.tentativas.findOneAndUpdate
      .mockRejectedValueOnce(Object.assign(new Error("concorrência de upsert"), { code: 11000 }))
      .mockResolvedValueOnce({ tentativas: 6 });
    const comparar = jest.spyOn(bcrypt, "compare");
    try {
      await expect(alterar(t, "promover")).rejects.toMatchObject({ codigo: "LIMITE_TENTATIVAS" });
      expect(comparar).not.toHaveBeenCalled();
      const [primeira, segunda] = t.deps.tentativas.findOneAndUpdate.mock.calls;
      expect(primeira[0]).toEqual({ _id: idOriginal });
      expect(primeira[2]).toMatchObject({ upsert: true, returnDocument: "after", writeConcern: { w: "majority" } });
      expect(segunda[2]).not.toHaveProperty("upsert");
      expect(segunda[1]).toEqual(primeira[1]);
      const atualizacao = primeira[1][0].$set;
      expect(atualizacao.expiraEm.$cond[1]).toEqual({ $add: ["$$NOW", 900_000] });
      expect(atualizacao.tentativas.$cond.slice(1)).toEqual([1, { $min: [{ $add: ["$tentativas", 1] }, 6] }]);
      expect(t.deps.iniciarSessao).not.toHaveBeenCalled();
    } finally {
      comparar.mockRestore();
    }
  });

  test("rebaixa somente o administrador indicado", async () => {
    const t = preparar({ perfilAlvo: "admin" });
    const antes = { ...t.alvo }, originalAntes = { ...t.original }, outroAntes = { ...t.outro };
    await alterar(t, "remover");
    expect(t.alvo).toEqual({ ...antes, perfil: "user" });
    expect(t.original).toEqual(originalAntes);
    expect(t.outro).toEqual(outroAntes);
    expect(t.deps.usuarios.updateOne).toHaveBeenCalledTimes(1);
    expect(t.deps.usuarios.updateOne).toHaveBeenCalledWith(
      { _id: idAlvo, email: "alvo@example.test", perfil: "admin" },
      { $set: { perfil: "user" } },
      { session: t.sessao, timestamps: false, runValidators: true },
    );
  });

  test.each(["promover", "remover"])("recusa conta inexistente em %s", async (acao) => {
    const t = preparar();
    await expect(alterar(t, acao, { ...t.alvo, email: "ausente@example.test" }))
      .rejects.toMatchObject({ codigo: "CONTA_INEXISTENTE" });
    expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
    expect(t.sessao.endSession).toHaveBeenCalled();
  });

  test.each([
    ["promover", "admin", "JA_ADMIN"],
    ["remover", "user", "NAO_ADMIN"],
  ])("recusa %s um alvo com perfil %s", async (acao, perfilAlvo, codigo) => {
    const t = preparar({ perfilAlvo });
    await expect(alterar(t, acao)).rejects.toMatchObject({ codigo });
    expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
  });

  test.each(["promover", "remover"])("exige confirmação antes de abrir sessão em %s", async (acao) => {
    const t = preparar();
    await expect(alterar(t, acao, t.alvo, false)).rejects.toMatchObject({ codigo: "CONFIRMACAO" });
    expect(t.deps.iniciarSessao).not.toHaveBeenCalled();
  });

  test("protege o original pelo ID mesmo após mudança de e-mail e com outros administradores", async () => {
    const t = preparar({ perfilAlvo: "admin" });
    t.alvo.email = t.original.email;
    t.original.email = "original-alterado@example.test";
    const antes = { ...t.original };
    await expect(alterar(t, "remover", t.original)).rejects.toMatchObject({ codigo: "ADMIN_ORIGINAL" });
    expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
    expect(t.original).toEqual(antes);
    await alterar(t, "remover");
    expect(t.alvo.perfil).toBe("user");
    expect(t.original).toEqual(antes);
  });

  test("recusa remover o último admin quando a conta original é a única ativa", async () => {
    const t = preparar();
    t.outro.perfil = "user";
    await expect(alterar(t, "remover", t.original)).rejects.toMatchObject({ codigo: "ADMIN_ORIGINAL" });
    expect(t.original.perfil).toBe("admin");
    expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
  });

  test.each([
    [false, "admin"],
    [true, "user"],
    [true, "Admin"],
  ])("recusa remover o último admin adicional se o original estiver ausente ou inativo (%s, %s)",
    async (temOriginal, perfilOriginal) => {
      const t = preparar({ temOriginal, perfilOriginal, perfilAlvo: "admin" });
      t.outro.perfil = "user";
      await expect(alterar(t, "remover")).rejects.toMatchObject({ codigo: "ADMIN_ORIGINAL_INATIVO" });
      expect(t.alvo.perfil).toBe("admin");
      expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
    });

  test("recusa alterar até mesmo um original que já apareça como usuário na base", async () => {
    const t = preparar({ perfilOriginal: "user" });
    await expect(alterar(t, "promover", t.original)).rejects.toMatchObject({ codigo: "ADMIN_ORIGINAL_INATIVO" });
    expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
  });

  test.each([
    ["promover", "user", null],
    ["remover", "admin", null],
    ["remover", "admin", { usuario: "ID-invalido" }],
  ])("recusa %s sem identidade original confiável", async (acao, perfilAlvo, marcador) => {
    const t = preparar({ perfilAlvo, marcador });
    await expect(alterar(t, acao)).rejects.toMatchObject({ codigo: "MARCADOR_INDISPONIVEL" });
    expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
  });

  test("recusa e-mail ambíguo e conta trocada entre consulta e confirmação", async () => {
    const t = preparar();
    const contaConfirmada = await localizarContaAdmin({ acao: "promover", email: t.alvo.email }, t.deps);
    const emailAntigo = t.alvo.email;
    t.alvo.email = "alvo-alterado@example.test";
    t.outro.email = emailAntigo;
    t.outro.perfil = "user";
    await expect(alterar(t, "promover", contaConfirmada)).rejects.toMatchObject({ codigo: "CONTA_ALTERADA" });
    t.alvo.email = emailAntigo;
    await expect(alterar(t, "promover", contaConfirmada)).rejects.toMatchObject({ codigo: "EMAIL_AMBIGUO" });
    expect(t.deps.usuarios.updateOne).not.toHaveBeenCalled();
  });

  test("remoções concorrentes de administradores adicionais preservam o original", async () => {
    const t = preparar({ perfilAlvo: "admin" });
    await Promise.all([alterar(t, "remover"), alterar(t, "remover", t.outro)]);
    expect(t.registros.filter((u) => u.perfil === "admin")).toEqual([t.original]);
    expect(t.deps.usuarios.updateOne).toHaveBeenCalledTimes(2);
  });

  test("a atualização real do model passa somente perfil ao driver, sem timestamps ou upsert", async () => {
    const escrita = jest.spyOn(Usuario.collection, "updateOne").mockResolvedValue({ modifiedCount: 1 });
    try {
      await Usuario.updateOne({ _id: idAlvo, perfil: "user" }, { $set: { perfil: "admin" } }, {
        timestamps: false, runValidators: true,
      });
      const [filtro, update, opcoes] = escrita.mock.calls[0];
      expect(filtro).toEqual({ _id: idAlvo, perfil: "user" });
      expect(update).toEqual({ $set: { perfil: "admin" } });
      expect(opcoes.upsert).not.toBe(true);
    } finally {
      escrita.mockRestore();
    }
  });
});

function terminalSintetico(acao, respostas = [], { ttyEntrada = true, ttySaida = true } = {}) {
  const t = preparar({ perfilAlvo: acao === "promover" ? "user" : "admin" });
  const terminal = Object.assign(new EventEmitter(), {
    question: jest.fn(async () => respostas.shift()),
    close: jest.fn(() => terminal.emit("close")),
  });
  const banco = {
    uri: "mongodb://exemplo:27017/pe_na_trilha?replicaSet=sintetico",
    conectar: jest.fn().mockResolvedValue("pe_na_trilha"),
    desconectar: jest.fn(),
    localizar: jest.fn((args) => localizarContaAdmin(args, t.deps)),
    alterar: jest.fn((args) => alterarPerfilAdmin(args, t.deps)),
  };
  const deps = {
    ambiente: "production",
    entrada: { isTTY: ttyEntrada },
    saida: { isTTY: ttySaida, write: jest.fn() },
    abrirTerminal: jest.fn(() => terminal),
    lerSenha: jest.fn(async () => senhaSintetica),
    obterBanco: jest.fn().mockResolvedValue(banco),
  };
  return { t, banco, terminal, deps, executar: () => executarGerenciamentoAdmin([acao, "--banco", "pe_na_trilha"], deps) };
}

describe("confirmação e terminal", () => {
  test.each(["promover", "remover"])("confirma por ambiente, banco e e-mail no modo %s", async (acao) => {
    const frase = acao.toUpperCase() + " ADMIN production pe_na_trilha alvo@example.test";
    const x = terminalSintetico(acao, [" ALVO@example.test ", frase, "original@example.test"]);
    await x.executar();
    expect(x.deps.saida.write).toHaveBeenCalledWith("Ambiente: production | Banco: pe_na_trilha\n");
    expect(x.terminal.question).toHaveBeenNthCalledWith(2, "Digite exatamente " + frase + ": ", expect.any(Object));
    expect(x.banco.localizar.mock.invocationCallOrder[0]).toBeLessThan(x.terminal.question.mock.invocationCallOrder[1]);
    expect(x.banco.alterar).toHaveBeenCalledWith({
      acao, email: "alvo@example.test", usuarioId: idAlvo, confirmado: true,
      operadorEmail: "original@example.test", senha: senhaSintetica,
    });
    expect(x.banco.desconectar).toHaveBeenCalledTimes(1);
    expect(x.terminal.close).toHaveBeenCalledTimes(1);
  });

  test.each(["promover", "remover"])("recusa a identidade de um administrador comum no modo %s", async (acao) => {
    const frase = acao.toUpperCase() + " ADMIN production pe_na_trilha alvo@example.test";
    const x = terminalSintetico(acao, ["alvo@example.test", frase, "outro@example.test"]);
    await expect(x.executar()).rejects.toMatchObject({ codigo: "IDENTIDADE_NAO_CONFIRMADA" });
    expect(x.t.deps.usuarios.updateOne).not.toHaveBeenCalled();
    expect(x.t.deps.auditoria.insertOne).not.toHaveBeenCalled();
  });

  test("leitura da senha no terminal não ecoa a entrada", async () => {
    const entrada = Object.assign(new PassThrough(), { isTTY: true, setRawMode: jest.fn() });
    let output = "";
    const saida = new Writable({
      write(dados, _codificacao, concluir) {
        output += dados.toString();
        concluir();
      },
    });
    const leitura = lerSenhaAdmin(entrada, saida);
    entrada.write(senhaSintetica + "\r");
    await expect(leitura).resolves.toBe(senhaSintetica);
    expect(output).toBe("Senha atual da conta operadora: \n");
    expect(entrada.setRawMode).toHaveBeenLastCalledWith(false);
    entrada.destroy();
  });

  test.each(["promover", "remover"])("recusa confirmação incorreta no modo %s", async (acao) => {
    const x = terminalSintetico(acao, ["alvo@example.test", "sim"]);
    await expect(x.executar()).rejects.toMatchObject({ codigo: "CONFIRMACAO" });
    expect(x.banco.alterar).not.toHaveBeenCalled();
    expect(x.t.deps.iniciarSessao).not.toHaveBeenCalled();
    expect(x.banco.desconectar).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["promover", false, true], ["remover", false, true],
    ["promover", true, false], ["remover", true, false],
  ])("recusa %s com terminal entrada=%s saída=%s antes de ler o ambiente", async (acao, ttyEntrada, ttySaida) => {
    const x = terminalSintetico(acao, [], { ttyEntrada, ttySaida });
    await expect(x.executar()).rejects.toMatchObject({ codigo: "TERMINAL" });
    expect(x.deps.obterBanco).not.toHaveBeenCalled();
    expect(x.deps.abrirTerminal).not.toHaveBeenCalled();
  });

  test.each([
    "mongodb://exemplo:27017",
    "mongodb://exemplo:27017/outro_banco",
    "mongodb://exemplo:27017/pe_na_trilha?DBname=outro_banco",
  ])("recusa URI sem o banco explícito confirmado ou com sobrescrita (%s)", async (uri) => {
    const x = terminalSintetico("promover");
    x.banco.uri = uri;
    await expect(x.executar()).rejects.toMatchObject({ codigo: "BANCO" });
    expect(x.deps.abrirTerminal).not.toHaveBeenCalled();
    expect(x.banco.conectar).not.toHaveBeenCalled();
  });

  test("confere o banco efetivamente aberto antes de consultar contas", async () => {
    const x = terminalSintetico("remover", ["alvo@example.test"]);
    x.banco.conectar.mockResolvedValue("outro_banco");
    await expect(x.executar()).rejects.toMatchObject({ codigo: "BANCO" });
    expect(x.banco.localizar).not.toHaveBeenCalled();
    expect(x.banco.desconectar).toHaveBeenCalledTimes(1);
  });

  test("encerramento do terminal cancela a confirmação e fecha a conexão", async () => {
    const x = terminalSintetico("remover");
    x.terminal.question.mockResolvedValueOnce("alvo@example.test");
    x.terminal.question.mockImplementationOnce(async (_pergunta, opcoes) => {
      x.terminal.emit("close");
      expect(opcoes.signal.aborted).toBe(true);
      return "REMOVER ADMIN production pe_na_trilha alvo@example.test";
    });
    await expect(x.executar()).rejects.toMatchObject({ codigo: "CONFIRMACAO" });
    expect(x.banco.alterar).not.toHaveBeenCalled();
    expect(x.banco.desconectar).toHaveBeenCalledTimes(1);
  });
});
