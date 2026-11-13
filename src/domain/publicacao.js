export const STATUS_EDITAVEIS = ["pending", "rejected"];
export const OPCOES = {
  tipoLocal: ["Trilha", "Praia", "Cachoeira"],
  dificuldade: ["Fácil", "Moderada", "Difícil"],
  condicaoCaminho: ["Terra", "Pedra", "Areia"],
  sinalizacao: ["Boa", "Parcial", "Sem sinalização"],
  estacionamento: ["Gratuito", "Pago", "Não possui"],
  banheiro: ["Sim", "Não", "Não sei informar"],
  alimentacao: ["Lanchonete", "Quiosque", "Não possui"],
  estruturaBanho: ["Chuveiro", "Área de banho", "Não possui"],
  acesso: ["Livre", "Controlado", "Com autorização"],
};
export const CARACTERISTICAS = {
  Trilha: ["Rio", "Mirante", "Vegetação"],
  Praia: ["Mar", "Areia", "Costão"],
  Cachoeira: ["Queda d'água", "Piscina natural", "Rio"],
};
export const CAMPOS_BASICOS = ["titulo", "descricao", "endereco"];
export const CAMPOS_DETALHES = [...Object.keys(OPCOES), "caracteristicaPrincipal", "duracao"];

export function duracaoValida(valor) {
  return valor === null || (valor && typeof valor === "object" && !Array.isArray(valor)
    && Object.keys(valor).length === 2
    && Number.isInteger(valor.horas) && valor.horas >= 0 && valor.horas <= 23
    && Number.isInteger(valor.minutos) && valor.minutos >= 0 && valor.minutos <= 59
    && valor.horas * 60 + valor.minutos > 0);
}
