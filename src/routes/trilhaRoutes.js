import { Router } from "express";
import { entregarFoto } from "../controllers/entregaFotoController.js";
import {
  atualizarTrilha,
  reenviarTrilha, listarMinhasTrilhas, buscarMinhaTrilha, moderarTrilha, listarPendentes,
  buscarTrilha,
  criarTrilha,
  excluirTrilha,
  listarTrilhas,
} from "../controllers/trilhaController.js";
import { autenticarToken } from "../middlewares/autenticarToken.js";
import { validarCsrf } from "../middlewares/validarCsrf.js";
import { validarTrilha, validarEdicaoTrilha } from "../middlewares/validarTrilha.js";
import { validarProprietarioTrilha, validarEdicaoFotos, exigirAdmin } from "../middlewares/validarProprietarioTrilha.js";
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

router.get("/:id/fotos/:fotoId/conteudo", entregarFoto("publico"));
router.get("/minhas/:id/fotos/:fotoId/conteudo", autenticarToken, entregarFoto("autor"));
router.get("/", listarTrilhas);
router.get("/minhas", autenticarToken, listarMinhasTrilhas);
router.get("/minhas/:id", autenticarToken, buscarMinhaTrilha);
router.get("/pendentes", autenticarToken, exigirAdmin, listarPendentes);
router.post("/:id/reenviar", autenticarToken, validarCsrf, reenviarTrilha);
router.post("/:id/moderacao", autenticarToken, validarCsrf, exigirAdmin, moderarTrilha);
router.get("/:id", buscarTrilha);
router.post(
  "/:id/fotos",
  autenticarToken,
  validarCsrf,
  validarProprietarioTrilha,
  validarEdicaoFotos,
  exigirCloudinaryDisponivel,
  receberImagem,
  validarImagem,
  adicionarFotoTrilha,
);
router.put(
  "/:id/fotos/:fotoId",
  autenticarToken,
  validarCsrf,
  validarProprietarioTrilha,
  validarEdicaoFotos,
  exigirCloudinaryDisponivel,
  receberImagem,
  validarImagem,
  substituirFotoTrilha,
);
router.delete(
  "/:id/fotos/:fotoId",
  autenticarToken,
  validarCsrf,
  validarProprietarioTrilha,
  validarEdicaoFotos,
  exigirCloudinaryDisponivel,
  removerFotoTrilha,
);
router.post("/", autenticarToken, validarCsrf, validarTrilha, criarTrilha);
router.patch("/:id", autenticarToken, validarCsrf, validarEdicaoTrilha, atualizarTrilha);
router.put("/:id", autenticarToken, validarCsrf, validarEdicaoTrilha, atualizarTrilha);
router.delete("/:id", autenticarToken, validarCsrf, excluirTrilha);

export default router;
