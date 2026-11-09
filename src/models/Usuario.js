import bcrypt from "bcrypt";
import mongoose from "mongoose";

const SALT_ROUNDS = 12;

function normalizarTexto(texto) {
  if (typeof texto !== "string") {
    return texto;
  }

  return texto.trim().normalize("NFC").toLowerCase().normalize("NFC");
}

function senhaValida(senha) {
  return (
    typeof senha === "string" &&
    [...senha].length >= 8 &&
    Buffer.byteLength(senha, "utf8") <= 72 &&
    /\p{Lu}/u.test(senha) &&
    /\p{Ll}/u.test(senha) &&
    /\p{N}/u.test(senha) &&
    /[\p{P}\p{S}]/u.test(senha)
  );
}

function updateContemSenha(update) {
  if (Array.isArray(update)) {
    return update.some(updateContemSenha);
  }

  if (!update || typeof update !== "object") {
    return false;
  }

  return Object.entries(update).some(([chave, valor]) => {
    if (chave === "senha" || chave.endsWith(".senha")) {
      return true;
    }

    if (chave === "$rename" && valor && typeof valor === "object") {
      if (
        Object.values(valor).some(
          (destino) =>
            typeof destino === "string" &&
            (destino === "senha" || destino.endsWith(".senha")),
        )
      ) {
        return true;
      }
    }

    return updateContemSenha(valor);
  });
}

function bulkWriteContemSenha(operacoes) {
  return operacoes.some((operacao) => {
    if (operacao.insertOne) {
      return updateContemSenha(operacao.insertOne.document);
    }

    if (operacao.replaceOne) {
      return updateContemSenha(operacao.replaceOne.replacement);
    }

    if (operacao.updateOne || operacao.updateMany) {
      const atualizacao = operacao.updateOne || operacao.updateMany;
      return updateContemSenha(atualizacao.update);
    }

    return false;
  });
}

const usuarioSchema = new mongoose.Schema(
  {
    nomeCompleto: {
      type: String,
      required: [true, "O nome completo é obrigatório."],
      trim: true,
    },
    nomeUsuario: {
      type: String,
      required: [true, "O nome de usuário é obrigatório."],
      set: normalizarTexto,
      validate: {
        validator: (valor) => /^\p{L}[\p{L}\p{M}]*$/u.test(valor),
        message:
          "O nome de usuário deve conter somente letras, incluindo letras acentuadas.",
      },
      unique: true,
    },
    email: {
      type: String,
      required: [true, "O e-mail é obrigatório."],
      set: normalizarTexto,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "O e-mail informado é inválido."],
      unique: true,
    },
    senha: {
      type: String,
      required: [true, "A senha é obrigatória."],
      select: false,
      validate: {
        validator: senhaValida,
        message:
          "A senha deve ter no mínimo 8 caracteres, no máximo 72 bytes e conter letra maiúscula, letra minúscula, número e caractere especial.",
      },
    },
    fotoPerfil: {
      type: String,
      default: null,
      trim: true,
    },
    fotoPerfilPublicId: {
      type: String,
      default: null,
      select: false,
      trim: true,
    },
    perfil: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        delete ret.senha;
        delete ret.fotoPerfilPublicId;
        return ret;
      },
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.senha;
        delete ret.fotoPerfilPublicId;
        return ret;
      },
    },
  },
);

export async function hashSenhaSeAlterada() {
  if (!this.isModified("senha")) {
    return;
  }

  this.senha = await bcrypt.hash(this.senha, SALT_ROUNDS);
}

usuarioSchema.pre("save", hashSenhaSeAlterada);

for (const operacao of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
]) {
  usuarioSchema.pre(operacao, function impedirAtualizacaoDiretaDaSenha() {
    if (updateContemSenha(this.getUpdate())) {
      throw new Error("A senha deve ser alterada por meio de save().");
    }
  });
}

usuarioSchema.pre("insertMany", function impedirInsercaoEmLote() {
  throw new Error("Usuários devem ser criados por meio de save().");
});

usuarioSchema.pre("bulkWrite", function impedirEscritaDiretaDaSenha(operacoes) {
  if (bulkWriteContemSenha(operacoes)) {
    throw new Error("A senha deve ser alterada por meio de save().");
  }
});

const Usuario = mongoose.model("Usuario", usuarioSchema);

export default Usuario;
