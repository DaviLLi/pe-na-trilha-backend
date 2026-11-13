import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
function executar(args) {
  return spawnSync(process.execPath, ["tools/provisionar-primeiro-admin.js", ...args], {
    cwd, env: { ...process.env, NODE_ENV: "development" }, encoding: "utf8", timeout: 5000,
  });
}

test("ajuda não abre banco nem solicita credenciais", () => {
  const r = executar(["--ajuda"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("--banco");
  expect(r.stdout).toContain("somente o e-mail");
  expect(r.stdout).not.toContain("MongoDB conectado");
  expect(r.stderr).toBe("");
});

test("provisionamento não interativo é recusado antes de ler configuração/conectar", () => {
  const r = executar(["--banco", "pe_na_trilha"]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("terminal interativo");
  expect(r.stdout).not.toContain("MongoDB conectado");
});
