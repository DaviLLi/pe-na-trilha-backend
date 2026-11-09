import mongoose from "mongoose";

const operacaoImagemSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, trim: true },
    estado: {
      type: String,
      enum: ["uploading", "cleanup_pending", "processing", "completed", "failed"],
      required: true,
      index: true,
    },
    uploadLeaseToken: { type: String, default: null, select: false },
    uploadLeaseUntil: { type: Date, default: null, index: true },
    processingLeaseToken: { type: String, default: null, select: false },
    processingLeaseUntil: { type: Date, default: null, index: true },
    nextAttemptAt: { type: Date, default: null, index: true },
    tentativas: { type: Number, default: 0, min: 0 },
    historicoTentativas: {
      type: [{ data: { type: Date, required: true }, erro: { type: String, required: true } }],
      default: [],
    },
    ultimoErro: { type: String, default: null },
    concluidoEm: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

operacaoImagemSchema.index({ estado: 1, nextAttemptAt: 1 });
operacaoImagemSchema.index({ estado: 1, uploadLeaseUntil: 1 });
operacaoImagemSchema.index({ estado: 1, processingLeaseUntil: 1 });
operacaoImagemSchema.index(
  { concluidoEm: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { estado: "completed" } },
);

const OperacaoImagem = mongoose.model("OperacaoImagem", operacaoImagemSchema);

export default OperacaoImagem;
