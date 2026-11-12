import { Router } from "express";
import {
  cadastrarUsuario,
  buscarUsuarioAtual,
  loginUsuario,
  atualizarUsuarioAtual,
} from "../controllers/usuarioController.js";
import { validarLogin } from "../middlewares/validarLogin.js";
import { validarUsuario } from "../middlewares/validarUsuario.js";
import { validarAtualizacaoUsuario } from "../middlewares/validarAtualizacaoUsuario.js";
import { autenticarToken } from "../middlewares/autenticarToken.js";
import { validarCsrf } from "../middlewares/validarCsrf.js";
import { validarOrigemFrontend } from "../middlewares/validarOrigemFrontend.js";
import {
  consultarTokenCsrf,
  logoutUsuario,
  renovarSessao,
} from "../controllers/authSessionController.js";
import {
  exigirCloudinaryDisponivel,
  receberFotoPerfil,
  validarFotoPerfil,
} from "../middlewares/uploadFotoPerfil.js";
import {
  removerFotoPerfil,
  substituirFotoPerfil,
} from "../controllers/fotoPerfilController.js";

const router = Router();

router.post("/login", validarOrigemFrontend, validarLogin, loginUsuario);
router.post("/refresh", validarOrigemFrontend, renovarSessao);
router.post("/logout", validarOrigemFrontend, autenticarToken, validarCsrf, logoutUsuario);
router.get("/csrf", autenticarToken, consultarTokenCsrf);
router.get("/me", autenticarToken, buscarUsuarioAtual);
router.patch("/me", autenticarToken, validarCsrf, validarAtualizacaoUsuario, atualizarUsuarioAtual);
router.put(
  "/me/foto-perfil",
  autenticarToken,
  validarCsrf,
  exigirCloudinaryDisponivel,
  receberFotoPerfil,
  validarFotoPerfil,
  substituirFotoPerfil,
);
router.delete(
  "/me/foto-perfil",
  autenticarToken,
  validarCsrf,
  exigirCloudinaryDisponivel,
  removerFotoPerfil,
);
router.post("/", validarUsuario, cadastrarUsuario);

export default router;
