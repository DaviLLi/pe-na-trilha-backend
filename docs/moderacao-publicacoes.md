# Edição e moderação de publicações

Novos registros recebem `status: pending` no servidor. Estados aceitos: `pending`,
`approved`, `rejected`. Nenhuma migração de dados ou imagens acompanha esta mudança.

| Estado | Dados básicos | Características/duração | Fotos | Edição muda status? |
| --- | --- | --- | --- | --- |
| pending | Autor pode editar | Autor pode editar | Autor pode editar | Não |
| approved | Bloqueados | Autor pode editar | Bloqueadas | Não |
| rejected | Autor pode corrigir | Autor pode corrigir | Autor pode corrigir | Não |

`PUT /trilhas/:id` e `PATCH /trilhas/:id` aceitam edição parcial. Campos desconhecidos,
operadores, autoria, status e histórico são rejeitados com 400; dados básicos em
aprovadas retornam 403. Requisições mistas falham integralmente. Fotos só são alteradas
pelos endpoints próprios. O proprietário continua podendo excluir sua publicação.
Administradores não ganham permissão de editar conteúdo de terceiros.

As características opcionais são `tipoLocal`, `dificuldade`, `condicaoCaminho`,
`sinalizacao`, `estacionamento`, `banheiro`, `alimentacao`, `estruturaBanho`, `acesso`
e `caracteristicaPrincipal`. Valores seguem `src/domain/publicacao.js`, alinhados
às opções do frontend. `null` limpa uma resposta; omitir preserva seu valor na edição.
Trocar/limpar tipo sem enviar destaque limpa o destaque anterior. Um destaque
incompatível com o tipo efetivo é rejeitado.

`duracao` aceita `null` ou `{ "horas": 2, "minutos": 30 }`: inteiros, horas 0–23,
minutos 0–59 e total positivo. Objetos com propriedades adicionais são rejeitados.

## Endpoints

Mutações exigem autenticação e, com cookies, `X-CSRF-Token`.

- `POST /trilhas`: cria pendente, com autoria derivada da autenticação.
- `GET /trilhas` e `GET /trilhas/:id`: retornam somente aprovadas.
- `GET /trilhas/minhas`: lista todas as publicações do autor, com status, motivo e histórico.
- `GET /trilhas/minhas/:id`: consulta privada do autor, inclusive pendentes e rejeitadas.
- `GET /trilhas/pendentes`: fila administrativa; exige perfil `admin`.
- `POST /trilhas/:id/moderacao`: exige `admin` e estado atual `pending`.
  Corpo `{ "status": "approved" }` ou
  `{ "status": "rejected", "motivo": "Corrigir localização" }`.
  Rejeição exige motivo não vazio com até 2000 caracteres.
- `POST /trilhas/:id/reenviar`: somente autor, somente `rejected`, corpo vazio.
  Muda para `pending`, preserva `motivoRejeicao` e acrescenta `resubmitted` ao histórico.
  Novo envio em estado diferente retorna 409; registro de terceiro retorna 404.

`historicoModeracao` registra ação, usuário, data do servidor e motivo quando houver.
Correções não apagam o motivo. Uma aprovação posterior limpa o motivo atual, mas
mantém todas as rejeições no histórico. Novas rejeições substituem apenas o motivo
atual e acrescentam um evento. Não há exclusão de histórico pela API de edição.

Os três endpoints de fotos rejeitam aprovadas antes de processar o multipart e
revalidam estados editáveis dentro da transação. Se houver aprovação durante um
upload, a foto não é associada e a limpeza remota é agendada. Conflitos transacionais
são tratados pelo mecanismo de retry do MongoDB. A edição de dados usa status e
`updatedAt` como condições atômicas; conflito retorna 409.

## Dados existentes e implantação

Registros sem status não são incluídos no feed público nem autorizados para edição
ou fotos até definição e execução de migração aprovada. Defaults do Mongoose não
substituem uma migração de documentos persistidos. A migração real precisa de
aprovação separada, inclusive a classificação das publicações antigas.

Cloudinary continua usando URLs públicas; excluir pendentes do feed não torna os
assets privados. Não houve migração de imagens. O frontend deve usar as consultas
privadas para editar suas pendentes/rejeitadas e ligar o botão explícito de reenvio
ao endpoint acima.

Os testes locais simulam persistência e serviços externos. Testes reais de
transações, Atlas e Cloudinary não foram executados por esta alteração.
