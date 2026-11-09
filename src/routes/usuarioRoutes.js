import { Router } from "express";
import {
  cadastrarUsuario,
  loginUsuario,
} from "../controllers/usuarioController.js";
import { validarLogin } from "../middlewares/validarLogin.js";
import { validarUsuario } from "../middlewares/validarUsuario.js";

const router = Router();

router.post("/login", validarLogin, loginUsuario);
router.post("/", validarUsuario, cadastrarUsuario);

export default router;
