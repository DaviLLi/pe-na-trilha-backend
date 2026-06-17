import mongoose from "mongoose";

export async function conectarBanco() {
  const { MONGO_URI } = process.env;

  if (!MONGO_URI) {
    throw new Error("A variável de ambiente MONGO_URI não foi definida.");
  }

  await mongoose.connect(MONGO_URI);
  console.log("MongoDB conectado.");
}
