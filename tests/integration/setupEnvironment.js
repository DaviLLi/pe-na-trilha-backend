import {
  carregarAmbienteIntegracao,
  prepararAmbienteAplicacao,
  validarBancoDaExecucao,
} from "./ambiente.js";

const config = carregarAmbienteIntegracao();
validarBancoDaExecucao(process.env, config);
prepararAmbienteAplicacao(process.env, config);
