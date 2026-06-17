import mongoose from "mongoose";

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
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const Trilha = mongoose.model("Trilha", trilhaSchema);

export default Trilha;
