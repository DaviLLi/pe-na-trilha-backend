import mongoose from "mongoose";
import { apresentarFoto } from "../domain/fotoPublicacao.js";
import { OPCOES, CARACTERISTICAS, duracaoValida } from "../domain/publicacao.js";

const fotoTrilhaSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true, select: false },
    assetId: { type: String },
    resourceType: { type: String, enum: ["image"] },
    deliveryType: { type: String, enum: ["upload", "authenticated", "private"] },
    version: { type: Number },
    format: { type: String },
    width: { type: Number },
    height: { type: Number },
    bytes: { type: Number },
    storageState: { type: String, enum: ["ready", "legacy_public", "migration_pending", "blocked"], default: "legacy_public" },
    publicId: { type: String, required: true, trim: true },
  },
  { timestamps: true, versionKey: false },
);

function serializarTrilha(_doc, ret) {
  ret.fotos = (ret.fotos || []).map((foto) => apresentarFoto(foto, ret._id));
  return ret;
}

const trilhaSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", required: true, index: true },
    motivoRejeicao: { type: String, default: null },
    historicoModeracao: { type: [{
      acao: { type: String, enum: ["approved", "rejected", "resubmitted"], required: true },
      usuario: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true },
      motivo: { type: String, default: null },
      data: { type: Date, required: true },
    }], default: [] },
    ...Object.fromEntries(Object.entries(OPCOES).map(([campo, valores]) => [campo, { type: String, enum: [...valores, null], default: null }])),
    caracteristicaPrincipal: { type: String, enum: [...new Set(Object.values(CARACTERISTICAS).flat()), null], default: null },
    duracao: { type: mongoose.Schema.Types.Mixed, default: null, validate: duracaoValida },
    titulo: {
      type: String,
      required: [true, "O título é obrigatório."],
      trim: true,
    },
    descricao: {
      type: String,
      required: [true, "A descrição é obrigatória."],
      trim: true,
    },
    endereco: {
      type: String,
      required: [true, "O endereço é obrigatório."],
      trim: true,
    },
    proprietario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
    },
    fotos: {
      type: [fotoTrilhaSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { transform: serializarTrilha },
    toObject: { transform: serializarTrilha },
  },
);

const Trilha = mongoose.model("Trilha", trilhaSchema);

export default Trilha;
