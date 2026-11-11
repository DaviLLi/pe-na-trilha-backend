import { mensagemRecuperacaoIntegracao } from "./integration/mensagemRecuperacao.js";

describe("mensagem segura de recuperação da suíte de integração", () => {
  test("informa o nome compacto usado pelas execuções atuais", () => {
    const nomeBanco = `tst_${"a".repeat(32)}`;

    expect(mensagemRecuperacaoIntegracao(nomeBanco)).toContain(nomeBanco);
  });

  test("informa a base isolada sem incluir dados de conexão ou credenciais", () => {
    // Nomes antigos continuam seguros para orientar a recuperação manual de resíduos legados.
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
