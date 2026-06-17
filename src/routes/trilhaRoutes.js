import { Router } from "express";
import {
  atualizarTrilha,
  buscarTrilha,
  criarTrilha,
  excluirTrilha,
  listarTrilhas,
} from "../controllers/trilhaController.js";
import { validarTrilha } from "../middlewares/validarTrilha.js";

const router = Router();

router.get("/", listarTrilhas);
router.get("/:id", buscarTrilha);
router.post("/", validarTrilha, criarTrilha);
router.put("/:id", validarTrilha, atualizarTrilha);
router.delete("/:id", excluirTrilha);

export default router;
