import { jest } from "@jest/globals";
import { provisionarPrimeiroAdmin } from "../src/services/provisionarPrimeiroAdmin.js";

const usuarioId = "507f1f77bcf86cd799439011";
const alvo = { email: " ADMIN@example.com ", confirmado: true };
function preparar({ admin = false, conta = true, usado = false, duplicado = false } = {}) {
  const estado = { perfil: "user", marcador: usado };
  const sessao = {
    withTransaction: jest.fn(async (acao) => {
      const anterior = { ...estado };
      try { await acao(); } catch (erro) { Object.assign(estado, anterior); throw erro; }
    }),
    endSession: jest.fn(),
  };
  const controle = { insertOne: jest.fn(async () => {
    if (estado.marcador) throw Object.assign(new Error("duplicate"), { code: 11000 });
    estado.marcador = true;
  }) };
  const usuarios = {
    find: jest.fn(() => ({ select: jest.fn(() => ({ limit: jest.fn(() => ({
      session: jest.fn().mockResolvedValue(!conta ? [] : duplicado ? [{ _id: usuarioId }, { _id: "507f1f77bcf86cd799439012" }] : [{ _id: usuarioId, perfil: "user" }]),
    })) })) })),
    exists: jest.fn(() => ({ session: jest.fn().mockResolvedValue(admin ? { _id: usuarioId } : null) })),
    findOneAndUpdate: jest.fn(async () => { if (!conta) return null; estado.perfil = "admin"; return { _id: usuarioId }; }),
  };
  return { estado, sessao, usuarios, controle, deps: { usuarios, controle, iniciarSessao: jest.fn().mockResolvedValue(sessao) } };
}

test("localiza pelo e-mail normalizado e promove a identidade encontrada em transação", async () => {
  const t = preparar();
  await provisionarPrimeiroAdmin(alvo, t.deps);
  expect(t.estado).toEqual({ perfil: "admin", marcador: true });
  expect(t.usuarios.find).toHaveBeenCalledWith({ email: "admin@example.com" });
  expect(t.usuarios.findOneAndUpdate).toHaveBeenCalledWith(
    { _id: usuarioId, email: "admin@example.com", perfil: "user" },
    { $set: { perfil: "admin" } },
    { session: t.sessao, returnDocument: "after", runValidators: true },
  );
  expect(t.controle.insertOne).toHaveBeenCalledWith(expect.objectContaining({ _id: "primeiro-admin" }), { session: t.sessao });
  expect(t.sessao.endSession).toHaveBeenCalledTimes(1);
});

test.each([
  { confirmado: false }, { confirmado: "true" },
  { email: "invalido" }, { email: { $ne: null } }, { email: undefined }, { email: "   " },
])("recusa entrada inválida antes da sessão %j", async (entrada) => {
  const t = preparar();
  await expect(provisionarPrimeiroAdmin({ ...alvo, ...entrada }, t.deps)).rejects.toBeInstanceOf(Error);
  expect(t.deps.iniciarSessao).not.toHaveBeenCalled();
});

test("recusa quando já existe administrador e desfaz marcador", async () => {
  const t = preparar({ admin: true });
  await expect(provisionarPrimeiroAdmin(alvo, t.deps)).rejects.toMatchObject({ codigo: "ADMIN_JA_EXISTE" });
  expect(t.estado.marcador).toBe(false);
  expect(t.usuarios.findOneAndUpdate).not.toHaveBeenCalled();
  expect(t.sessao.endSession).toHaveBeenCalled();
});

test("e-mail inexistente não cria conta nem consome provisionamento", async () => {
  const t = preparar({ conta: false });
  await expect(provisionarPrimeiroAdmin(alvo, t.deps)).rejects.toMatchObject({ codigo: "ALVO_NAO_ENCONTRADO" });
  expect(t.estado).toEqual({ perfil: "user", marcador: false });
});

test("não repete provisionamento mesmo se o admin tiver sido removido", async () => {
  const t = preparar({ usado: true });
  await expect(provisionarPrimeiroAdmin(alvo, t.deps)).rejects.toMatchObject({ codigo: "PROVISIONAMENTO_ENCERRADO" });
  expect(t.usuarios.exists).not.toHaveBeenCalled();
  expect(t.usuarios.findOneAndUpdate).not.toHaveBeenCalled();
});

test("falha de escrita reverte a operação sem fallback fora da transação", async () => {
  const t = preparar();
  t.usuarios.findOneAndUpdate.mockRejectedValue(new Error("falha sintética"));
  await expect(provisionarPrimeiroAdmin(alvo, t.deps)).rejects.toThrow("falha sintética");
  expect(t.estado).toEqual({ perfil: "user", marcador: false });
  expect(t.sessao.endSession).toHaveBeenCalledTimes(1);
});


test("duas tentativas serializadas no mesmo marcador não promovem dois usuários", async () => {
  const t = preparar();
  const executarTransacao = t.sessao.withTransaction.getMockImplementation();
  let fila = Promise.resolve();
  t.sessao.withTransaction.mockImplementation((acao) => {
    const atual = fila.then(() => executarTransacao(acao));
    fila = atual.catch(() => {});
    return atual;
  });
  const resultados = await Promise.allSettled([
    provisionarPrimeiroAdmin(alvo, t.deps),
    provisionarPrimeiroAdmin(alvo, t.deps),
  ]);
  expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(resultados.find((r) => r.status === "rejected").reason.codigo).toBe("PROVISIONAMENTO_ENCERRADO");
  expect(t.usuarios.findOneAndUpdate).toHaveBeenCalledTimes(1);
  expect(t.estado.marcador).toBe(true);
});


test("recusa e-mail duplicado sem escolher uma conta arbitrariamente", async () => {
  const t = preparar({ duplicado: true });
  await expect(provisionarPrimeiroAdmin(alvo, t.deps)).rejects.toMatchObject({ codigo: "EMAIL_AMBIGUO" });
  expect(t.controle.insertOne).not.toHaveBeenCalled();
  expect(t.usuarios.findOneAndUpdate).not.toHaveBeenCalled();
  expect(t.estado).toEqual({ perfil: "user", marcador: false });
});

test("falha se a conta encontrada não puder mais ser promovida", async () => {
  const t = preparar();
  t.usuarios.findOneAndUpdate.mockResolvedValue(null);
  await expect(provisionarPrimeiroAdmin(alvo, t.deps)).rejects.toMatchObject({ codigo: "ALVO_NAO_ENCONTRADO" });
  expect(t.estado.marcador).toBe(false);
});
