import express from "express";
import { jest } from "@jest/globals";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import appApi from "../src/app.js";
import Usuario from "../src/models/Usuario.js";
import { obterChaveJwt } from "../src/config/jwt.js";
import {
  receberFotoPerfil,
  validarFotoPerfil,
} from "../src/middlewares/uploadFotoPerfil.js";
import { tratarErros } from "../src/middlewares/errorHandler.js";

const imagemPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p3sAAAAASUVORK5CYII=",
  "base64",
);

function criarAppUpload() {
  const app = express();
  app.put("/upload", receberFotoPerfil, validarFotoPerfil, (_req, res) => {
    res.status(200).json({ recebido: true });
  });
  app.use(tratarErros);
  return app;
}

describe("upload de foto de perfil", () => {
  const app = criarAppUpload();

  test("aceita imagem PNG identificada pela assinatura real", async () => {
    const resposta = await request(app)
      .put("/upload")
      .attach("imagem", imagemPng, { filename: "foto.png", contentType: "image/png" });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ recebido: true });
  });

  test("rejeita conteúdo que não seja imagem, mesmo com MIME declarado", async () => {
    const resposta = await request(app)
      .put("/upload")
      .attach("imagem", Buffer.from("texto"), {
        filename: "foto.png",
        contentType: "image/png",
      });

    expect(resposta.status).toBe(400);
    expect(resposta.body.mensagem).toMatch(/Formato de imagem inválido/);
  });

  test("rejeita arquivo acima de 5 MiB com 413", async () => {
    const resposta = await request(app)
      .put("/upload")
      .attach("imagem", Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: "grande.png",
        contentType: "image/png",
      });

    expect(resposta.status).toBe(413);
  });

  test("rejeita campo multipart inesperado", async () => {
    const resposta = await request(app)
      .put("/upload")
      .field("publicId", "arbitrario")
      .attach("imagem", imagemPng, { filename: "foto.png" });

    expect(resposta.status).toBe(400);
  });

  test("rejeita arquivo em campo inesperado", async () => {
    const resposta = await request(app)
      .put("/upload")
      .attach("fotoPerfil", imagemPng, { filename: "foto.png" });

    expect(resposta.status).toBe(400);
  });

  test("rejeita mais de um arquivo", async () => {
    const resposta = await request(app)
      .put("/upload")
      .attach("imagem", imagemPng, { filename: "uma.png" })
      .attach("imagem", imagemPng, { filename: "duas.png" });

    expect(resposta.status).toBe(400);
  });

  test("retorna 400 genérico para multipart truncado sem expor erro do Busboy", async () => {
    const resposta = await request(app)
      .put("/upload")
      .set("Content-Type", "multipart/form-data; boundary=fronteira-teste")
      .send(
        '--fronteira-teste\r\nContent-Disposition: form-data; name="imagem"; filename="foto.png"\r\nContent-Type: image/png\r\n\r\nconteudo incompleto',
      );

    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ mensagem: "A requisição multipart é inválida." });
    expect(JSON.stringify(resposta.body)).not.toMatch(/Unexpected end|Busboy|Multer/i);
  });

  test("sem credenciais Cloudinary, endpoints de foto retornam 503 após autenticar", async () => {
    const nomes = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
    const anteriores = Object.fromEntries(nomes.map((nome) => [nome, process.env[nome]]));
    const segredoAnterior = process.env.JWT_SECRET;
    const segredo = randomBytes(32).toString("base64");
    process.env.JWT_SECRET = segredo;
    for (const nome of nomes) delete process.env[nome];

    const usuario = {
      _id: "507f1f77bcf86cd799439011",
      nomeCompleto: "Ana da Silva",
      nomeUsuario: "ana",
      email: "ana@example.com",
      perfil: "user",
    };
    const select = jest.fn().mockResolvedValue(usuario);
    const buscar = jest.spyOn(Usuario, "findById").mockReturnValue({ select });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(usuario._id)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(obterChaveJwt());

    try {
      const semToken = await request(appApi).put("/usuarios/me/foto-perfil");
      expect(semToken.status).toBe(401);
      expect(buscar).not.toHaveBeenCalled();

      const indisponivel = await request(appApi)
        .put("/usuarios/me/foto-perfil")
        .set("Authorization", `Bearer ${token}`)
        .attach("imagem", imagemPng, { filename: "foto.png" });
      expect(indisponivel.status).toBe(503);
      expect(indisponivel.body).toEqual({ mensagem: "Serviço de imagens indisponível." });
      expect(buscar).toHaveBeenCalledTimes(1);
    } finally {
      jest.restoreAllMocks();
      for (const nome of nomes) {
        if (anteriores[nome] === undefined) delete process.env[nome];
        else process.env[nome] = anteriores[nome];
      }
      if (segredoAnterior === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = segredoAnterior;
    }
  });
});
