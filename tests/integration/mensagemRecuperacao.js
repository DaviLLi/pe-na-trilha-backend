const NOME_BANCO_SEGURO = /^[A-Za-z0-9_-]{1,63}$/;

export function mensagemRecuperacaoIntegracao(nomeBanco) {
  const banco = NOME_BANCO_SEGURO.test(nomeBanco || "")
    ? nomeBanco
    : "não identificado";

  return `A limpeza de integração falhou. Base isolada: ${banco}. Preserve o ambiente e refaça a limpeza manualmente.`;
}
