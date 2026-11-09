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
import { validarProprietarioTrilha } from "../middlewares/validarProprietarioTrilha.js";
import {
  exigirCloudinaryDisponivel,
  receberImagem,
  validarImagem,
} from "../middlewares/uploadFotoPerfil.js";
import {
  adicionarFotoTrilha,
  removerFotoTrilha,
  substituirFotoTrilha,
} from "../controllers/fotoTrilhaController.js";

const router = Router();

router.get("/", listarTrilhas);
router.get("/:id", buscarTrilha);
router.post(
  "/:id/fotos",
  autenticarToken,
  validarProprietarioTrilha,
  exigirCloudinaryDisponivel,
  receberImagem,
  validarImagem,
  adicionarFotoTrilha,
);
router.put(
  "/:id/fotos/:fotoId",
  autenticarToken,
  validarProprietarioTrilha,
  exigirCloudinaryDisponivel,
  receberImagem,
  validarImagem,
  substituirFotoTrilha,
);
router.delete(
  "/:id/fotos/:fotoId",
  autenticarToken,
  validarProprietarioTrilha,
  exigirCloudinaryDisponivel,
  removerFotoTrilha,
);
router.post("/", autenticarToken, validarTrilha, criarTrilha);
router.put("/:id", autenticarToken, validarTrilha, atualizarTrilha);
router.delete("/:id", autenticarToken, excluirTrilha);

export default router;
