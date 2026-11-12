import { CAMPOS_BASICOS, CAMPOS_DETALHES, OPCOES, CARACTERISTICAS, duracaoValida } from "../domain/publicacao.js";

function validar(req, res, next, criacao) {
  const entrada = req.body;
  const falhar = (mensagem) => res.status(400).json({ mensagem });
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return falhar("Dados da publicação inválidos.");
  const permitidos = [...CAMPOS_BASICOS, ...CAMPOS_DETALHES];
  // Mantém a compatibilidade de criação: autoria sempre vem da autenticação.
  const campos = Object.keys(entrada).filter((campo) => !(criacao && campo === "proprietario"));
  if (!campos.length || campos.some((campo) => !permitidos.includes(campo))) return falhar("Campos da publicação não permitidos.");
  const dados = {};
  for (const campo of CAMPOS_BASICOS) {
    if (!criacao && !Object.hasOwn(entrada, campo)) continue;
    const valor = entrada[campo];
    if (typeof valor !== "string" || !valor.trim()) return falhar("Título, descrição e endereço são obrigatórios.");
    dados[campo] = valor.trim();
  }
  for (const campo of CAMPOS_DETALHES) {
    if (!Object.hasOwn(entrada, campo)) continue;
    const valor = entrada[campo];
    if (campo === "duracao") {
      if (!duracaoValida(valor)) return falhar("Duração inválida.");
    } else if (valor !== null) {
      const opcoes = campo === "caracteristicaPrincipal" ? Object.values(CARACTERISTICAS).flat() : OPCOES[campo];
      if (!opcoes.includes(valor)) return falhar(`Valor inválido para ${campo}.`);
    }
    dados[campo] = valor;
  }
  req.body = dados;
  return next();
}
export function validarTrilha(req, res, next) { return validar(req, res, next, true); }
export function validarEdicaoTrilha(req, res, next) { return validar(req, res, next, false); }
