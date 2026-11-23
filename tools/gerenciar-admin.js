// Comandos locais de operação. A aplicação HTTP não importa este arquivo.
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import mongoose from "mongoose";
import { conectarBanco, obterUriMongo } from "../src/config/database.js";
import { ErroGerenciamentoAdmin } from "../src/services/errosGerenciamentoAdmin.js";
import {
  alterarPerfilAdmin,
  localizarContaAdmin,
  normalizarEmailAdmin,
} from "../src/services/gerenciarAdministradores.js";

const mensagens = {
  ENTRADA: "Informe apenas --banco com o nome explícito do banco pretendido.",
  TERMINAL: "A operação exige terminal interativo.",
  AMBIENTE: "Use NODE_ENV=production com APP_ENV=production ou homologation.",
  BANCO: "O banco configurado não corresponde ao banco solicitado.",
  EMAIL_INVALIDO: "E-mail inválido.",
  CONTA_INEXISTENTE: "Nenhuma conta possui esse e-mail.",
  EMAIL_AMBIGUO: "Mais de uma conta possui esse e-mail. Operação recusada.",
  JA_ADMIN: "Essa conta já é administradora.",
  NAO_ADMIN: "Essa conta não é administradora.",
  SENHA_INVALIDA: "Informe a senha atual do administrador principal.",
  IDENTIDADE_NAO_CONFIRMADA: "Não foi possível confirmar a identidade.",
  ACESSO_PRINCIPAL: "Acesso exclusivo do administrador principal.",
  LIMITE_TENTATIVAS: "Limite de tentativas atingido. Tente mais tarde.",
  CONFIRMACAO: "Confirmação incorreta ou interrompida. Operação cancelada.",
  CONTA_ALTERADA: "A identidade ou o perfil da conta mudou. Confira o alvo e tente novamente.",
  MARCADOR_INDISPONIVEL: "O marcador do primeiro administrador está ausente ou inválido. Operação recusada.",
  ADMIN_ORIGINAL: "O primeiro administrador está protegido. Operação recusada.",
  ADMIN_ORIGINAL_INATIVO: "A conta do primeiro administrador não está ativa como admin. Operação recusada.",
};

async function configurarBanco() {
  await import("../src/config/carregarAmbiente.js");
  const uri = obterUriMongo();
  return {
    uri,
    async conectar() {
      await conectarBanco(process.env, { autoCreate: false, autoIndex: false });
      return mongoose.connection.name;
    },
    desconectar: () => mongoose.disconnect(),
    localizar: localizarContaAdmin,
    alterar: alterarPerfilAdmin,
  };
}

function conferirBancoNaUri(uri, banco) {
  // A autoridade da URI pode conter vários hosts quando se usa um replica set.
  const partes = /^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^/?#]+)(?:\?([^#]*))?$/.exec(uri);
  try {
    if (partes && decodeURIComponent(partes[1]) === banco
      && !Array.from(new URLSearchParams(partes[2]).keys()).some((nome) => nome.toLowerCase() === "dbname")) {
      return;
    }
  } catch {
    // Uma URI com codificação inválida também é recusada.
  }
  throw new ErroGerenciamentoAdmin("BANCO");
}

export async function lerSenhaAdmin(entrada, saida) {
  const oculto = new Writable({
    write(_dados, _codificacao, concluir) { concluir(); },
  });
  const terminal = createInterface({ input: entrada, output: oculto, terminal: true, historySize: 0 });
  const cancelamento = new AbortController();
  terminal.once("close", () => cancelamento.abort());
  saida.write("Senha atual da conta operadora: ");
  try {
    return await terminal.question("", { signal: cancelamento.signal });
  } finally {
    terminal.close();
    saida.write("\n");
  }
}

export async function executarGerenciamentoAdmin(args, {
  ambiente = process.env.APP_ENV ?? process.env.NODE_ENV,
  entrada = process.stdin,
  saida = process.stdout,
  abrirTerminal = createInterface,
  lerSenha = lerSenhaAdmin,
  obterBanco = configurarBanco,
} = {}) {
  const [acao, flag, banco] = args;
  if (args.length !== 3 || !["promover", "remover"].includes(acao)
    || flag !== "--banco" || !/^[A-Za-z0-9_-]{1,63}$/.test(banco)) {
    throw new ErroGerenciamentoAdmin("ENTRADA");
  }
  if (!entrada.isTTY || !saida.isTTY) throw new ErroGerenciamentoAdmin("TERMINAL");
  if (!["production", "homologation"].includes(ambiente)) throw new ErroGerenciamentoAdmin("AMBIENTE");
  const conexao = await obterBanco();
  conferirBancoNaUri(conexao.uri, banco);

  let terminal = abrirTerminal({ input: entrada, output: saida });
  const cancelamento = new AbortController();
  terminal.once("close", () => cancelamento.abort());
  let conexaoIniciada = false;
  try {
    saida.write(`Ambiente: ${ambiente} | Banco: ${banco}\n`);
    const opcoes = { signal: cancelamento.signal };
    const email = normalizarEmailAdmin(await terminal.question("E-mail exato da conta: ", opcoes));
    conexaoIniciada = true;
    if (await conexao.conectar() !== banco) throw new ErroGerenciamentoAdmin("BANCO");
    const conta = await conexao.localizar({ acao, email });

    const verbo = acao.toUpperCase();
    saida.write(`Confirme o alvo: ${ambiente} / ${banco} / ${email}\n`);
    const frase = `${verbo} ADMIN ${ambiente} ${banco} ${email}`;
    const resposta = await terminal.question(`Digite exatamente ${frase}: `, opcoes);
    if (opcoes.signal.aborted || resposta !== frase) throw new ErroGerenciamentoAdmin("CONFIRMACAO");
    const operadorEmail = normalizarEmailAdmin(await terminal.question("E-mail da conta operadora: ", opcoes));
    if (opcoes.signal.aborted) throw new ErroGerenciamentoAdmin("CONFIRMACAO");
    terminal.close();
    terminal = null;
    const senha = await lerSenha(entrada, saida);
    await conexao.alterar({ acao, email, usuarioId: conta._id, operadorEmail, senha, confirmado: true });
  } finally {
    terminal?.close();
    if (conexaoIniciada) await conexao.desconectar();
  }
  saida.write(acao === "promover" ? "Conta promovida a administradora.\n" : "Perfil de administrador removido da conta.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await executarGerenciamentoAdmin(process.argv.slice(2));
  } catch (erro) {
    const codigo = erro?.name === "AbortError" ? "CONFIRMACAO" : erro?.codigo;
    console.error(mensagens[codigo] || "Operação não concluída. Confira a configuração, o acesso ao banco e o suporte a transações.");
    process.exitCode = 1;
  }
}
