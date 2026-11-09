import { mensagemRecuperacaoIntegracao } from "./integration/mensagemRecuperacao.js";

describe("mensagem segura de recuperação da suíte de integração", () => {
  test("informa a base isolada sem incluir dados de conexão ou credenciais", () => {
    const nomeBanco = `pe_na_trilha_integration_run_${"a".repeat(32)}`;
    const mensagem = mensagemRecuperacaoIntegracao(nomeBanco);

    expect(mensagem).toContain(nomeBanco);
    expect(mensagem).not.toContain("mongodb://");
    expect(mensagem).not.toContain("password");
    expect(mensagem).not.toContain("api_secret");
  });

  test("não exibe um nome de banco inválido", () => {
    const mensagem = mensagemRecuperacaoIntegracao("mongodb://usuario:segredo@host/producao");

    expect(mensagem).toContain("não identificado");
    expect(mensagem).not.toContain("usuario");
    expect(mensagem).not.toContain("segredo");
    expect(mensagem).not.toContain("producao");
  });
});
