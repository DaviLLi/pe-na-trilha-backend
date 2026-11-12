import { config as dotenvConfig } from "dotenv";

const arquivoPorAmbiente = {
  development: ".env",
  production: ".env.production",
};
const nodeEnv = process.env.NODE_ENV;

if (!Object.hasOwn(arquivoPorAmbiente, nodeEnv)) {
  throw new Error(
    "NODE_ENV inválido. Use somente development ou production para iniciar o backend.",
  );
}

const arquivo = arquivoPorAmbiente[nodeEnv];

dotenvConfig({ path: arquivo, quiet: true });
