import mongoose from "mongoose";

const refreshTokenSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AuthSession",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true, select: false },
    consumedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null, select: false },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true, versionKey: false },
);

refreshTokenSchema.index({ session: 1, expiresAt: 1 });

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);

export default RefreshToken;
