import {
  carregarAmbienteIntegracao,
  prepararAmbienteAplicacao,
  validarBancoDaExecucao,
} from "./ambiente.js";

const config = carregarAmbienteIntegracao();
validarBancoDaExecucao(process.env);
prepararAmbienteAplicacao(process.env, config);
