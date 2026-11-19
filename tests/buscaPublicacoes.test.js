import { jest } from "@jest/globals";
import request from "supertest";
import app from "../src/app.js";
import Trilha from "../src/models/Trilha.js";
import { filtroBuscaPublica, CAMPOS_BUSCA_PUBLICA } from "../src/domain/buscaPublicacoes.js";
import { OPCOES } from "../src/domain/publicacao.js";

afterEach(() => jest.restoreAllMocks());
test("campos de busca são os campos reais do modelo, inclusive todas as perguntas", () => {
  expect(CAMPOS_BUSCA_PUBLICA).toEqual(["titulo", "descricao", "endereco", ...Object.keys(OPCOES), "caracteristicaPrincipal"]);
  for (const campo of CAMPOS_BUSCA_PUBLICA) expect(Trilha.schema.path(campo)).toBeDefined();
});
test("busca literal parcial ignora caixa e preserva o filtro aprovado", () => {
  const filtro = filtroBuscaPublica("  CaChO  ");
  expect(filtro.status).toBe("approved");
  expect(filtro.$or).toContainEqual({ tipoLocal: { $regex: "CaChO", $options: "i" } });
  expect(new RegExp(filtro.$or[3].tipoLocal.$regex,"i").test("Cachoeira")).toBe(true);
});
test.each([".*", "(a+)+$", "[a]", "a|b", "a\\b", "?^${}"])("trata %s literalmente", termo => {
  const expressao = new RegExp(filtroBuscaPublica(termo).$or[0].titulo.$regex, "i");
  expect(expressao.test(termo)).toBe(true);expect(expressao.test("texto comum")).toBe(false);
});
test.each([undefined, "", "   "])("busca vazia conserva contrato sem filtro adicional", termo => expect(filtroBuscaPublica(termo)).toEqual({ status: "approved" }));
test.each([{}, [], ["cachoeira"], "x".repeat(101)])("rejeita entrada inválida sem consultar MongoDB", valor => expect(() => filtroBuscaPublica(valor)).toThrow());
test("duração usa os campos numéricos reais", () => expect(filtroBuscaPublica("30").$or).toEqual(expect.arrayContaining([{ "duracao.horas": 30 }, { "duracao.minutos": 30 }])));
test("endpoint consulta características no MongoDB, com limite de tempo e DTO público", async () => {
  const consulta = { maxTimeMS: jest.fn().mockReturnThis(), populate: jest.fn().mockReturnThis(), sort: jest.fn().mockResolvedValue([]) };
  const buscar = jest.spyOn(Trilha,"find").mockReturnValue(consulta);
  const resposta = await request(app).get("/trilhas").query({ busca: "cachoeira" });
  expect(resposta.status).toBe(200);expect(buscar).toHaveBeenCalledWith(filtroBuscaPublica("cachoeira"));expect(consulta.maxTimeMS).toHaveBeenCalledWith(2000);
});
test.each(["/trilhas?busca=x&busca=y", `/trilhas?busca=${"x".repeat(101)}`])("entrada inválida não alcança banco: %s", async rota => {
  const buscar = jest.spyOn(Trilha,"find");
  const resposta = await request(app).get(rota);
  expect(resposta.status).toBe(400);expect(buscar).not.toHaveBeenCalled();
});
