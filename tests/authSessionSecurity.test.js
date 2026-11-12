import { randomBytes } from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import {
  definirCookiesAuth,
  nomeCookieAccess,
  nomeCookieRefresh,
  validarConfiguracaoCookies,
} from "../src/config/authCookies.js";
import {
  gerarTokenCsrf,
  tokenCsrfValido,
} from "../src/config/csrf.js";
import {
  origemFrontendPermitida,
} from "../src/config/origensFrontend.js";

const segredoAnterior = process.env.CSRF_SECRET;
const segredo = randomBytes(32).toString("base64url");

beforeAll(() => { process.env.CSRF_SECRET = segredo; });
afterAll(() => {
  if (segredoAnterior === undefined) delete process.env.CSRF_SECRET;
  else process.env.CSRF_SECRET = segredoAnterior;
});

test("CSRF é HMAC vinculado à sessão e rejeita token alterado", () => {
  const token = gerarTokenCsrf("507f1f77bcf86cd799439011");
  expect(tokenCsrfValido(token, "507f1f77bcf86cd799439011")).toBe(true);
  expect(tokenCsrfValido(token, "507f1f77bcf86cd799439012")).toBe(false);
  expect(tokenCsrfValido(`${token}x`, "507f1f77bcf86cd799439011")).toBe(false);
});

test("Origin usa correspondência exata com allowlist", () => {
  const env = { FRONTEND_ORIGINS: "https://app.exemplo.com,http://localhost:5173" };
  expect(origemFrontendPermitida("https://app.exemplo.com", env)).toBe(true);
  expect(origemFrontendPermitida("https://app.exemplo.com.evil", env)).toBe(false);
  expect(origemFrontendPermitida(undefined, env)).toBe(false);
});

test("cookies de produção são Secure, HttpOnly, host-only e SameSite=None", () => {
  const nodeEnvAnterior = process.env.NODE_ENV;
  const sameSiteAnterior = process.env.AUTH_COOKIE_SAME_SITE;
  const cookies = [];
  try {
    process.env.NODE_ENV = "production";
    process.env.AUTH_COOKIE_SAME_SITE = "none";
    validarConfiguracaoCookies();
    definirCookiesAuth({ cookie: (...args) => cookies.push(args) }, {
      accessToken: "access",
      refreshToken: "refresh",
      expiraEm: new Date(Date.now() + 60_000),
    });
    expect(nomeCookieAccess()).toBe("__Host-pnt_access");
    expect(nomeCookieRefresh()).toBe("__Host-pnt_refresh");
    expect(cookies).toHaveLength(2);
    for (const [, , opcoes] of cookies) {
      expect(opcoes).toMatchObject({ secure: true, httpOnly: true, sameSite: "none", path: "/" });
      expect(opcoes).not.toHaveProperty("domain");
    }
  } finally {
    if (nodeEnvAnterior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvAnterior;
    if (sameSiteAnterior === undefined) delete process.env.AUTH_COOKIE_SAME_SITE;
    else process.env.AUTH_COOKIE_SAME_SITE = sameSiteAnterior;
  }
});

test("SameSite=None sem HTTPS não é aceito", () => {
  expect(() => validarConfiguracaoCookies({ NODE_ENV: "development", AUTH_COOKIE_SAME_SITE: "none" }))
    .toThrow("SameSite=None exige cookies Secure.");
});

test("login e refresh rejeitam Origin ausente ou não permitido", async () => {
  for (const path of ["/usuarios/login", "/usuarios/refresh"]) {
    const semOrigin = await request(app).post(path).send({});
    const originMalicioso = await request(app)
      .post(path)
      .set("Origin", "https://nao-permitido.invalid")
      .send({});
    expect(semOrigin.status).toBe(403);
    expect(semOrigin.body).toEqual({ mensagem: "Origem não permitida." });
    expect(originMalicioso.status).toBe(403);
  }
});

test("CORS aceita somente origem cadastrada e permite credenciais", async () => {
  const permitido = await request(app)
    .options("/usuarios/refresh")
    .set("Origin", "http://localhost:5173")
    .set("Access-Control-Request-Method", "POST");
  const bloqueado = await request(app)
    .options("/usuarios/refresh")
    .set("Origin", "https://origem-maliciosa.invalid")
    .set("Access-Control-Request-Method", "POST");
  expect(permitido.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  expect(permitido.headers["access-control-allow-credentials"]).toBe("true");
  expect(bloqueado.headers["access-control-allow-origin"]).toBeUndefined();
});
