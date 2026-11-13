import { jest } from "@jest/globals";
const excluirImagem = jest.fn();
jest.unstable_mockModule("../src/services/cloudinaryService.js", () => ({ excluirImagem }));
const { default: OperacaoImagem } = await import("../src/models/OperacaoImagem.js");
const { processarLoteOperacoesImagem, processarUmaOperacao, recuperarOperacoesExpiradas, iniciarProcessadorOperacoesImagem, pararProcessadorOperacoesImagem } = await import("../src/services/processarOperacoesImagem.js");
const nomes = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
let anterior, fila, ativas, maxAtivas, buscar, atualizar;
const tick = () => new Promise(setImmediate);
function popular(total) {
  fila = Array.from({ length: total }, (_, i) => ({ _id: String(i), publicId: `foto-${i}`, resourceType: "image", deliveryType: i % 2 ? "upload" : "authenticated", estado: "cleanup_pending", tentativas: 0, nextAttemptAt: null }));
}
function coincide(doc, filtro) {
  return (!filtro._id || doc._id === filtro._id) && doc.estado === filtro.estado
    && (!filtro.processingLeaseToken || doc.processingLeaseToken === filtro.processingLeaseToken)
    && (!filtro.processingLeaseUntil?.$gt || doc.processingLeaseUntil > filtro.processingLeaseUntil.$gt);
}
function aplicar(doc, update) {
  Object.assign(doc, update.$set);
  for (const [campo, valor] of Object.entries(update.$inc || {})) doc[campo] = (doc[campo] || 0) + valor;
  for (const campo of Object.keys(update.$unset || {})) delete doc[campo];
}
beforeEach(() => {
  anterior = nomes.map((nome) => process.env[nome]);
  nomes.forEach((nome) => { process.env[nome] = "teste"; });
  ativas = 0; maxAtivas = 0; popular(0);
  excluirImagem.mockReset().mockImplementation(async () => {
    ativas++; maxAtivas = Math.max(maxAtivas, ativas);
    await tick();
    ativas--;
  });
  buscar = jest.spyOn(OperacaoImagem, "findOneAndUpdate").mockImplementation(async (filtro, update) => {
    const doc = fila.find((item) => coincide(item, filtro) && (!item.nextAttemptAt || item.nextAttemptAt <= filtro.$or[1].nextAttemptAt.$lte));
    if (!doc) return null;
    aplicar(doc, update);
    return { ...doc };
  });
  atualizar = jest.spyOn(OperacaoImagem, "updateOne").mockImplementation(async (filtro, update) => {
    const doc = fila.find((item) => coincide(item, filtro));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    aplicar(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  });
});
afterEach(() => {
  jest.restoreAllMocks(); jest.useRealTimers();
  nomes.forEach((nome, i) => { if (anterior[i] === undefined) delete process.env[nome]; else process.env[nome] = anterior[i]; });
});
test("um ciclo processa múltiplas operações com no máximo três exclusões simultâneas", async () => {
  popular(12);
  expect(await processarLoteOperacoesImagem()).toBe(12);
  expect(maxAtivas).toBe(3);
  expect(fila.every((doc) => doc.estado === "completed")).toBe(true);
});
test("ciclo tem orçamento de 30 claims, sem drenar fila ilimitadamente", async () => {
  popular(70);
  expect(await processarLoteOperacoesImagem()).toBe(30);
  expect(buscar).toHaveBeenCalledTimes(30);
  expect(excluirImagem).toHaveBeenCalledTimes(30);
  expect(maxAtivas).toBe(3);
});
test("dois workers disputam atomicamente sem excluir duas vezes a mesma operação", async () => {
  popular(25);
  await Promise.all([processarLoteOperacoesImagem(), processarLoteOperacoesImagem()]);
  const ids = excluirImagem.mock.calls.map(([id]) => id);
  expect(ids).toHaveLength(25);
  expect(new Set(ids).size).toBe(25);
  expect(fila.every((doc) => doc.tentativas === 1)).toBe(true);
});
test("operação lenta não impede outras faixas de avançarem", async () => {
  popular(10);
  let liberar;
  excluirImagem.mockImplementation(async (id) => { if (id === "foto-0") await new Promise((resolve) => { liberar = resolve; }); });
  const pendente = processarLoteOperacoesImagem();
  await tick();
  expect(fila.filter((doc) => doc.estado === "completed")).toHaveLength(9);
  expect(fila[0].estado).toBe("processing");
  liberar(); await pendente;
});
test("falha remota mantém pendente com backoff e não declara conclusão", async () => {
  popular(1);
  excluirImagem.mockRejectedValue(new Error("detalhe confidencial"));
  const antes = Date.now();
  await processarLoteOperacoesImagem();
  expect(fila[0]).toMatchObject({ estado: "cleanup_pending", tentativas: 1, ultimoErro: "Falha ao excluir imagem no serviço remoto." });
  expect(fila[0].nextAttemptAt.getTime()).toBeGreaterThanOrEqual(antes + 2000);
  expect(fila[0].concluidoEm).toBeUndefined();
  expect(JSON.stringify(atualizar.mock.calls)).not.toContain("confidencial");
});
test("oitava falha fica identificada como failed, sem agendamento automático", async () => {
  popular(1); fila[0].tentativas = 7;
  excluirImagem.mockRejectedValue(new Error("falha"));
  await processarLoteOperacoesImagem();
  expect(fila[0]).toMatchObject({ estado: "failed", tentativas: 8, nextAttemptAt: null });
  expect(fila[0].processingLeaseToken).toBeUndefined();
});
test("cada exclusão recebe publicId, resourceType e deliveryType corretos", async () => {
  popular(2); await processarLoteOperacoesImagem();
  expect(excluirImagem).toHaveBeenCalledWith("foto-0", { resourceType: "image", deliveryType: "authenticated" });
  expect(excluirImagem).toHaveBeenCalledWith("foto-1", { resourceType: "image", deliveryType: "upload" });
});
test("fila vazia faz no máximo três consultas e nenhuma exclusão", async () => {
  expect(await processarLoteOperacoesImagem()).toBe(0);
  expect(buscar.mock.calls.length).toBeLessThanOrEqual(3);
  expect(excluirImagem).not.toHaveBeenCalled();
});
test("heartbeat renova lease e impede recuperação enquanto exclusão está ativa", async () => {
  jest.useFakeTimers(); popular(1);
  let liberar;
  excluirImagem.mockImplementation(() => new Promise((resolve) => { liberar = resolve; }));
  const pendente = processarUmaOperacao();
  await jest.advanceTimersByTimeAsync(0);
  const inicial = fila[0].processingLeaseUntil.getTime();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(fila[0].processingLeaseUntil.getTime()).toBeGreaterThan(inicial);
  liberar(); await pendente;
  expect(jest.getTimerCount()).toBe(0);
});
test("matchedCount 1 com modifiedCount 0 mantém lease válido e permite exclusão", async () => {
  popular(1);
  atualizar.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 0 });
  await processarUmaOperacao();
  expect(atualizar.mock.calls[0][0]).toMatchObject({
    _id: "0", estado: "processing", processingLeaseToken: expect.any(String),
    processingLeaseUntil: { $gt: expect.any(Date) },
  });
  expect(excluirImagem).toHaveBeenCalledTimes(1);
  expect(fila[0].estado).toBe("completed");
});
test("lease perdido antes da exclusão não permite chamada remota", async () => {
  popular(1); atualizar.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
  await processarUmaOperacao();
  expect(excluirImagem).not.toHaveBeenCalled();
  expect(fila[0].estado).toBe("processing");
});
test("worker antigo não conclui operação após perder token de lease", async () => {
  popular(1);
  excluirImagem.mockImplementation(async () => { fila[0].processingLeaseToken = "outro-worker"; });
  await processarUmaOperacao();
  expect(fila[0].estado).toBe("processing");
  expect(fila[0].concluidoEm).toBeUndefined();
});
test("lease expirado é recuperado e pode ser novamente reivindicado", async () => {
  popular(1); fila[0].estado = "processing"; fila[0].processingLeaseUntil = new Date(Date.now() - 1000);
  jest.spyOn(OperacaoImagem, "updateMany").mockImplementation(async (filtro, update) => {
    for (const doc of fila) if (doc.estado === filtro.estado && doc.processingLeaseUntil <= filtro.processingLeaseUntil?.$lte) aplicar(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  });
  await recuperarOperacoesExpiradas();
  expect(fila[0].estado).toBe("cleanup_pending");
  await processarLoteOperacoesImagem();
  expect(fila[0].estado).toBe("completed");
});
test("erro MongoDB em uma faixa não causa loop ilimitado nem perde claims", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  buscar.mockRejectedValue(new Error("banco indisponível"));
  expect(await processarLoteOperacoesImagem()).toBe(0);
  expect(buscar).toHaveBeenCalledTimes(3);
  expect(log).toHaveBeenCalled();
});
test("falha ao renovar lease durante exclusão impede conclusão pelo worker antigo", async () => {
  jest.useFakeTimers(); popular(1);
  let liberar;
  excluirImagem.mockImplementation(() => new Promise((resolve) => { liberar = resolve; }));
  const pendente = processarUmaOperacao();
  await jest.advanceTimersByTimeAsync(0);
  atualizar.mockRejectedValueOnce(new Error("banco indisponível"));
  await jest.advanceTimersByTimeAsync(30_000);
  liberar(); await pendente;
  expect(fila[0].estado).toBe("processing");
  expect(fila[0].concluidoEm).toBeUndefined();
  expect(jest.getTimerCount()).toBe(0);
});
// Último teste: o singleton de produção permanece encerrado após parar.
test("interrupção aguarda exclusões em andamento e não reivindica novas operações", async () => {
  popular(10);
  const liberar = [];
  excluirImagem.mockImplementation(() => new Promise((resolve) => liberar.push(resolve)));
  jest.spyOn(OperacaoImagem, "updateMany").mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
  iniciarProcessadorOperacoesImagem();
  await tick();
  expect(liberar).toHaveLength(3);
  let terminou = false;
  const parada = pararProcessadorOperacoesImagem().then(() => { terminou = true; });
  await tick(); expect(terminou).toBe(false);
  liberar.forEach((resolve) => resolve());
  await parada;
  expect(fila.filter((doc) => doc.estado === "completed")).toHaveLength(3);
  expect(fila.filter((doc) => doc.estado === "cleanup_pending")).toHaveLength(7);
  expect(fila.some((doc) => doc.estado === "processing")).toBe(false);
  expect(buscar).toHaveBeenCalledTimes(3);
});
