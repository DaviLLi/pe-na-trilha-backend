import Usuario from "../models/Usuario.js";

export async function cadastrarUsuario(req, res, next) {
  try {
    const usuario = await Usuario.create(req.body);

    return res.status(201).json({
      _id: usuario._id,
      nomeCompleto: usuario.nomeCompleto,
      nomeUsuario: usuario.nomeUsuario,
      email: usuario.email,
      perfil: usuario.perfil,
      createdAt: usuario.createdAt,
    });
  } catch (erro) {
    return next(erro);
  }
}
