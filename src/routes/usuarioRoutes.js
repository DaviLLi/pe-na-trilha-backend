import { Router } from "express";
import {
  cadastrarUsuario,
  loginUsuario,
} from "../controllers/usuarioController.js";
import { validarLogin } from "../middlewares/validarLogin.js";
import { validarUsuario } from "../middlewares/validarUsuario.js";
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
