for (const nome of Object.keys(process.env)) {
  if (nome === "APP_ENV" || /^(?:MONGO_|TEST_MONGO_|CLOUDINARY_|HOMOLOGATION_CLOUDINARY_)/.test(nome)) {
    delete process.env[nome];
  }
}
