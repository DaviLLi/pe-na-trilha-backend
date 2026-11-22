import { lerArquivoAmbiente, obterAmbienteAplicacao } from "./ambientes.js";

const arquivoPorAmbiente = {
  development: ".env",
  production: ".env.production",
  homologation: ".env.homologation",
};
const ambiente = obterAmbienteAplicacao(process.env);
for (const [chave, valor] of Object.entries(lerArquivoAmbiente(arquivoPorAmbiente[ambiente]))) {
  if (chave !== "NODE_ENV" && chave !== "APP_ENV") process.env[chave] ??= valor;
}
