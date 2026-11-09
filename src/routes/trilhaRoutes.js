import { Router } from "express";
import {
  atualizarTrilha,
  buscarTrilha,
  criarTrilha,
  excluirTrilha,
  listarTrilhas,
} from "../controllers/trilhaController.js";
import { autenticarToken } from "../middlewares/autenticarToken.js";
import { validarTrilha } from "../middlewares/validarTrilha.js";

const router = Router();

router.get("/", listarTrilhas);
router.get("/:id", buscarTrilha);
router.post("/", autenticarToken, validarTrilha, criarTrilha);
router.put("/:id", autenticarToken, validarTrilha, atualizarTrilha);
router.delete("/:id", autenticarToken, excluirTrilha);

export default router;
