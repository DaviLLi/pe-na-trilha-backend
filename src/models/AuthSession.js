import mongoose from "mongoose";

const authSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
      index: true,
    },
    expiresAt: { type: Date, required: true, expires: 0 },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

authSessionSchema.index({ user: 1, revokedAt: 1 });

const AuthSession = mongoose.model("AuthSession", authSessionSchema);

export default AuthSession;
