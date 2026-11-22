import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  carregarAmbienteIntegracao,
  criarNomeBancoDaExecucao,
  prepararAmbienteAplicacao,
} from "./ambiente.js";

function executarJest(ambiente) {
  const raiz = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const jestBin = resolve(raiz, "node_modules/jest/bin/jest.js");
  const config = resolve(raiz, "jest.integration.config.js");

  return new Promise((resolveExecucao, rejectExecucao) => {
    const processo = spawn(
      process.execPath,
      ["--experimental-vm-modules", jestBin, "--config", config, "--runInBand"],
      { cwd: raiz, env: ambiente, stdio: "inherit" },
    );

    processo.once("error", rejectExecucao);
    processo.once("close", (codigo, sinal) => {
      resolveExecucao(codigo ?? (sinal ? 1 : 0));
    });
  });
}

try {
  const [opcao, ...argumentos] = process.argv.slice(2);
  if (argumentos.length || (opcao !== undefined && opcao !== "--check")) {
    throw new Error("Use somente --check para validar sem conexões.");
  }
  const config = carregarAmbienteIntegracao(process.env, [process.env]);
  const idExecucao = process.env.TEST_RUN_ID ?? randomUUID().replaceAll("-", "");
  const bancoExecucao = criarNomeBancoDaExecucao(idExecucao);
  if (opcao === "--check") {
    console.log(`Configuração do Atlas de testes válida. Cloudinary real: ${config.cloudinary ? "prefixo e configuração local validados" : "desativado"}.`);
    if (process.env.TEST_RUN_ID !== undefined) console.log(`Banco de integração selecionado: ${bancoExecucao}.`);
  } else {
    const ambienteExecucao = { ...process.env };
    ambienteExecucao.TEST_RUN_ID = idExecucao;
    ambienteExecucao.TEST_RUN_DB_NAME = bancoExecucao;
    ambienteExecucao.TEST_RUN_JWT_SECRET = randomBytes(32).toString("base64");
    ambienteExecucao.TEST_RUN_CSRF_SECRET = randomBytes(32).toString("base64");
    prepararAmbienteAplicacao(ambienteExecucao, config);

    process.exitCode = await executarJest(ambienteExecucao);
  }
} catch (erro) {
  console.error(`Não foi possível iniciar a suíte de integração: ${erro.message}`);
  process.exitCode = 1;
}
