import { CAMPOS_BASICOS, OPCOES } from "./publicacao.js";

export const CAMPOS_BUSCA_PUBLICA = [...CAMPOS_BASICOS, ...Object.keys(OPCOES), "caracteristicaPrincipal"];

export function filtroBuscaPublica(valor) {
  const filtro = { status: "approved" };
  if (valor === undefined) return filtro;
  if (typeof valor !== "string" || valor.length > 100) {
    const erro = new Error("Busca deve ser um texto de até 100 caracteres.");
    erro.status = 400;
    throw erro;
  }
  const termo = valor.trim().normalize("NFC");
  if (!termo) return filtro;
  // Regex literal: o usuário não controla operadores nem quantificadores.
  const literal = [...termo].map((caractere) => "\\^$.*+?()[]{}|".includes(caractere) ? "\\" + caractere : caractere).join("");
  filtro.$or = CAMPOS_BUSCA_PUBLICA.map((campo) => ({ [campo]: { $regex: literal, $options: "i" } }));
  // Duração é um objeto numérico, nunca uma string sobre a qual aplicar regex.
  if (/^\d{1,2}$/.test(termo)) {
    filtro.$or.push({ "duracao.horas": Number(termo) }, { "duracao.minutos": Number(termo) });
  }
  return filtro;
}
