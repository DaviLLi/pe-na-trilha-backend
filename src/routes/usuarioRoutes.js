import { Router } from "express";
import { cadastrarUsuario } from "../controllers/usuarioController.js";
import { validarUsuario } from "../middlewares/validarUsuario.js";

const router = Router();

router.post("/", validarUsuario, cadastrarUsuario);

export default router;
