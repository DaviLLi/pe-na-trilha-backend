import mongoose from "mongoose";

const fotoTrilhaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
  },
  { timestamps: true, versionKey: false },
);

function serializarTrilha(_doc, ret) {
  ret.fotos = Array.isArray(ret.fotos) ? ret.fotos : [];
  for (const foto of ret.fotos) {
    delete foto.publicId;
  }
  return ret;
}

const trilhaSchema = new mongoose.Schema(
  {
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
