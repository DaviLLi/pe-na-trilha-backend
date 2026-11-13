// Comando operacional local. Nunca é carregado pelo servidor HTTP.
import { createInterface } from "node:readline/promises";

const mensagens = {
  CONFIRMACAO_OBRIGATORIA: "Confirmação ausente; nenhuma promoção realizada.",
  ALVO_INVALIDO: "E-mail inválido.",
  EMAIL_AMBIGUO: "Mais de uma conta possui esse e-mail; promoção recusada. Revise a integridade do cadastro.",
  ADMIN_JA_EXISTE: "Já existe administrador; provisionamento inicial recusado.",
  ALVO_NAO_ENCONTRADO: "Não foi encontrada uma conta user com esse e-mail.",
  PROVISIONAMENTO_ENCERRADO: "O primeiro administrador já foi provisionado; operação recusada.",
};

async function executar() {
  if (process.argv.includes("--ajuda")) {
    console.log("Uso: NODE_ENV=development|production npm run admin:provisionar -- --banco NOME_DO_BANCO");
    console.log("Solicita somente o e-mail de uma conta existente, em terminal interativo, com confirmação explícita. Não recebe senha.");
    return;
  }
  let mongoose, terminal;
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--banco" || !/^[A-Za-z0-9_-]{1,63}$/.test(args[1])) {
      throw new Error("ENTRADA");
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("TERMINAL");
    if (!["development", "production"].includes(process.env.NODE_ENV)) throw new Error("AMBIENTE");
    await import("../src/config/carregarAmbiente.js");
    const { obterUriMongo, conectarBanco } = await import("../src/config/database.js");
    const uri = new URL(obterUriMongo());
    if (decodeURIComponent(uri.pathname.slice(1)) !== args[1]
      || [...uri.searchParams.keys()].some((nome) => nome.toLowerCase() === "dbname")) {
      throw new Error("BANCO");
    }
    terminal = createInterface({ input: process.stdin, output: process.stdout });
    console.log(`Alvo: ambiente ${process.env.NODE_ENV}, banco ${args[1]}. Confira também o cluster configurado antes de continuar.`);
    const email = (await terminal.question("E-mail exato dessa conta: ")).trim();
    const frase = `PROVISIONAR ADMIN ${process.env.NODE_ENV} ${args[1]}`;
    if ((await terminal.question(`Para confirmar, digite ${frase}: `)) !== frase) throw new Error("CONFIRMACAO");
    terminal.close(); terminal = null;
    ({ default: mongoose } = await import("mongoose"));
    const { provisionarPrimeiroAdmin } = await import("../src/services/provisionarPrimeiroAdmin.js");
    await conectarBanco();
    await provisionarPrimeiroAdmin({ email, confirmado: true });
    console.log("Primeiro administrador provisionado. Saia e entre novamente na conta para atualizar o frontend.");
  } catch (erro) {
    // Não imprime erro bruto: drivers podem incluir URI, credenciais ou detalhes internos.
    const locais = {
      ENTRADA: "Informe apenas --banco com o nome explícito do banco pretendido.",
      TERMINAL: "Operação exige terminal interativo; execução por pipe/CI recusada.",
      AMBIENTE: "Defina NODE_ENV como development ou production explicitamente.",
      BANCO: "O banco configurado não corresponde ao banco confirmado; nenhuma conexão iniciada.",
      CONFIRMACAO: "Confirmação incorreta; nenhuma conexão iniciada.",
    };
    console.error(mensagens[erro?.codigo] || locais[erro?.message] || "Provisionamento não concluído. Verifique configuração, acesso ao banco e suporte a transações; detalhes sensíveis omitidos.");
    process.exitCode = 1;
  } finally {
    terminal?.close();
    if (mongoose) {
      try { await mongoose.disconnect(); } catch { console.error("Falha ao encerrar conexão; detalhes omitidos."); process.exitCode = 1; }
    }
  }
}

await executar();
