export class ErroGerenciamentoAdmin extends Error {
  constructor(codigo) {
    super(codigo);
    this.codigo = codigo;
  }
}
