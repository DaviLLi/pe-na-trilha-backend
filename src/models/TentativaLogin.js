import mongoose from "mongoose";

const schema = new mongoose.Schema({
  _id: String,
  tentativas: Number,
  expiraEm: { type: Date, required: true },
}, { versionKey: false });

schema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("TentativaLogin", schema, "tentativas_login");
