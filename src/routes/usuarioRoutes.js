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

router.post("/login", validarLogin, loginUsuario);
router.get("/me", autenticarToken, buscarUsuarioAtual);
router.patch("/me", autenticarToken, validarAtualizacaoUsuario, atualizarUsuarioAtual);
router.put(
  "/me/foto-perfil",
  autenticarToken,
  exigirCloudinaryDisponivel,
  receberFotoPerfil,
  validarFotoPerfil,
  substituirFotoPerfil,
);
router.delete(
  "/me/foto-perfil",
  autenticarToken,
  exigirCloudinaryDisponivel,
  removerFotoPerfil,
);
router.post("/", validarUsuario, cadastrarUsuario);

export default router;
