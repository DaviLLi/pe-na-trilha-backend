# Pé na Trilha — Backend

API REST para cadastrar usuários, autenticar e gerenciar trilhas. O projeto oferece operações de cadastro e login de usuários e criação, consulta, atualização e exclusão de trilhas, com validação, persistência no MongoDB e tratamento centralizado de erros.

## Tecnologias

- Node.js e ES Modules
- Express 5
- MongoDB e Mongoose
- bcrypt para hash de senhas
- jose para JWT
- Cloudinary para armazenamento de imagens
- Multer para recebimento multipart
- file-type para validação do formato pela assinatura
- CORS e dotenv
- Jest para testes
- ESLint para análise de código

## Pré-requisitos

Antes de começar, tenha instalado:

- [Node.js](https://nodejs.org/) 22 ou superior
- npm
- Uma instância do [MongoDB](https://www.mongodb.com/), local ou no MongoDB Atlas

Para upload e remoção de fotos, o MongoDB local deve operar como replica set, pois esses fluxos usam transações. O Atlas fornece suporte a transações.

## Instalação

1. Clone o repositório e acesse a pasta do projeto:

   ```bash
   git clone <URL_DO_REPOSITORIO>
   cd pe-na-trilha-backend
   ```

2. Instale as dependências com `npm ci`.
3. Use os modelos `.env.production.example` e `.env.homologation.example` para preparar os arquivos locais separados. Preserve as credenciais existentes de cada ambiente.

## Executando o projeto

| Ambiente | Comando | API | Origem do frontend local |
| --- | --- | --- | --- |
| Produção local | `npm run dev:production` | `http://localhost:3000` | `http://localhost:5173` |
| Homologação | `npm run dev:homologation` | `http://127.0.0.1:3001` | `http://127.0.0.1:5174` |

Use `npm start` no Render. Ele seleciona produção, usa a porta fornecida pelo provedor e escuta em `0.0.0.0`. Consulte o [guia de ambientes](docs/ambientes.md) para os arquivos de configuração e a conferência somente leitura.

## Moderação e edição por status

O contrato de publicações evoluiu: novos registros são pendentes e consultas públicas
retornam somente aprovadas. Aprovadas permitem ao autor editar apenas características
e duração; fotos e dados básicos ficam bloqueados. Rejeitadas exigem reenvio explícito.
Consulte [o contrato atualizado](docs/moderacao-publicacoes.md) para endpoints privados,
moderação, validações, histórico e tratamento dos dados legados. As descrições básicas
de trilhas abaixo devem ser lidas com essas restrições.

## Endpoints

Por padrão, a API está disponível em `http://localhost:3000`. As rotas de leitura das trilhas são públicas. No fluxo do navegador, a autenticação usa cookies `HttpOnly`; mutações autenticadas também exigem `X-CSRF-Token`.

### Usuários

| Método | Endpoint | Autenticação | Descrição | Sucesso |
| --- | --- | --- | --- | --- |
| `POST` | `/usuarios` | Não | Cadastra um usuário | `201` |
| `POST` | `/usuarios/login` | Origin frontend permitido | Autentica e define cookies da sessão | `200` |
| `POST` | `/usuarios/refresh` | Origin frontend permitido e cookie de refresh | Rotaciona o refresh token e renova a sessão | `200` |
| `POST` | `/usuarios/logout` | Cookie de acesso, Origin permitido e CSRF | Revoga a sessão e limpa cookies | `204` |
| `GET` | `/usuarios/csrf` | Cookie de acesso | Retorna token CSRF vinculado à sessão atual | `200` |
| `GET` | `/usuarios/me` | Sim | Consulta o próprio perfil | `200` |
| `PATCH` | `/usuarios/me` | Cookie de acesso e CSRF | Atualiza nome completo, username e/ou e-mail | `200` |
| `PUT` | `/usuarios/me/foto-perfil` | Cookie de acesso e CSRF | Envia ou substitui a foto de perfil (`multipart`, campo `imagem`) | `200` |
| `DELETE` | `/usuarios/me/foto-perfil` | Cookie de acesso e CSRF | Remove a foto de perfil | `200` |

O cadastro aceita `nomeCompleto`, `nomeUsuario`, `email` e `senha`. O backend define o perfil como `user`; não aceita foto nem perfil administrativo no cadastro. O `PATCH /usuarios/me` aceita um ou mais dos campos `nomeCompleto`, `nomeUsuario` e `email`; rejeita campos desconhecidos, `senha` e `perfil`. Username e e-mail são normalizados para minúsculas. Duplicidades retornam `409`.

Cadastro retorna o objeto público do usuário e não inicia sessão. Login retorna `{ "usuario": { ... } }` e define cookies de acesso e refresh `HttpOnly`; nenhum token de autenticação é retornado no JSON. O objeto público contém `_id`, `nomeCompleto`, `nomeUsuario`, `email`, `perfil`, `fotoPerfil`, `createdAt` e `updatedAt`; nunca inclui senha, hash ou public ID do Cloudinary.

Exemplo de cadastro:

```bash
curl -X POST http://localhost:3000/usuarios \
  -H "Content-Type: application/json" \
  -d '{
    "nomeCompleto": "Ana da Silva",
    "nomeUsuario": "ana",
    "email": "ana@example.com",
    "senha": "Trilha123!"
  }'
```

Exemplo de login:

```bash
curl -X POST http://localhost:3000/usuarios/login \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  -d '{"identificador":"ana@example.com","senha":"Trilha123!"}'
```

Para username, o mesmo campo `identificador` recebe o username. O access JWT dura 15 minutos e fica em cookie `HttpOnly`; o refresh opaco tem validade absoluta de 30 dias, é armazenado no banco somente como hash e gira a cada renovação. Reutilizar um hash consumido revoga a sessão. O cliente renova a sessão após reload e quando o access JWT expira.

O cliente deve usar `withCredentials` e enviar `X-CSRF-Token` nas requisições autenticadas que alteram estado. Obtenha o token com `GET /usuarios/csrf`; ele é HMAC vinculado ao ID da sessão e ao `CSRF_SECRET`, e não autentica por si só. Login, refresh e logout exigem `Origin` exatamente presente em `FRONTEND_ORIGINS`. CORS permite credenciais somente para essas origens; curingas não são aceitos.

Cookies usam `HttpOnly`, `Path=/` e não definem `Domain`. Em produção são `Secure` e usam o prefixo `__Host-`. Configure `AUTH_COOKIE_SAME_SITE=none` para frontend/API realmente cross-site; `SameSite=None` requer HTTPS. Os domínios gratuitos padrão da Vercel e Render costumam pertencer a sites registráveis diferentes: navegadores podem bloquear cookies de terceiros mesmo com CORS e `SameSite=None`. Para disponibilidade SaaS, prefira subdomínios do mesmo domínio próprio (por exemplo, `app.exemplo.com` e `api.exemplo.com`) ou um proxy/BFF no mesmo site. A configuração precisa ser testada nos navegadores suportados antes da publicação.

Exemplo de consulta e atualização de perfil:

```bash
curl http://localhost:3000/usuarios/me \
  -H "Origin: http://localhost:5173" \
  -b cookies.txt -c cookies.txt

curl -X PATCH http://localhost:3000/usuarios/me \
  -H "Origin: http://localhost:5173" \
  -H "X-CSRF-Token: <csrf-token-retornado-por-GET-usuarios-csrf>" \
  -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"nomeCompleto":"Ana Silva","email":"ana.silva@example.com"}'
```

### Trilhas

| Método | Endpoint | Autenticação | Descrição | Sucesso |
| --- | --- | --- | --- | --- |
| `GET` | `/trilhas` | Não | Lista trilhas da mais recente para a mais antiga | `200` |
| `GET` | `/trilhas/:id` | Não | Consulta uma trilha | `200` |
| `POST` | `/trilhas` | Sim | Cria trilha para o usuário autenticado | `201` |
| `PUT` | `/trilhas/:id` | Sim, proprietário | Substitui título, descrição e endereço | `200` |
| `DELETE` | `/trilhas/:id` | Sim, proprietário | Exclui a trilha | `204` |
| `POST` | `/trilhas/:id/fotos` | Sim, proprietário | Adiciona foto (máximo de cinco) | `201` |
| `PUT` | `/trilhas/:id/fotos/:fotoId` | Sim, proprietário | Substitui a foto indicada | `200` |
| `DELETE` | `/trilhas/:id/fotos/:fotoId` | Sim, proprietário | Remove a foto indicada | `204` |

Trilhas e fotos de trilha são públicas para leitura. Somente o proprietário pode alterar ou excluir a trilha ou suas fotos; outro usuário recebe `404`. O backend define o proprietário na criação e ignora qualquer proprietário enviado pelo cliente. As respostas públicas das fotos incluem `_id`, `url`, `createdAt` e `updatedAt`, sem o public ID do Cloudinary.

### Upload de imagens

Fotos de publicações agora usam armazenamento autenticado e URLs internas. Consulte
[o contrato de fotos privadas](docs/fotos-privadas.md) para entrega, permissões e
limitações dos assets legados. Fotos de perfil preservam seu comportamento anterior.

Fotos de perfil e de trilhas aceitam JPEG, PNG ou WebP, com limite de 5 MiB por arquivo e um arquivo por requisição. Envie o arquivo no campo multipart `imagem`; não envie URL, public ID ou proprietário. O formato é conferido pela assinatura do arquivo. O armazenamento multipart usa memória, portanto uploads simultâneos podem exigir limites adicionais de concorrência ou taxa no gateway. A substituição e remoção registram a limpeza remota em operações persistidas, com tentativas automáticas e recuperação por lease. Operações que esgotam tentativas permanecem registradas para reenvio operacional.

Exemplos de upload:

```bash
curl -X PUT http://localhost:3000/usuarios/me/foto-perfil \
  -H "X-CSRF-Token: <csrf-token>" \
  -b cookies.txt -c cookies.txt \
  -F "imagem=@perfil.webp"

curl -X POST http://localhost:3000/trilhas/<trilhaId>/fotos \
  -H "X-CSRF-Token: <csrf-token>" \
  -b cookies.txt -c cookies.txt \
  -F "imagem=@trilha.jpg"
```

Fotos legadas que contenham somente uma URL, sem `fotoPerfilPublicId`, não podem ser excluídas automaticamente do Cloudinary. A remoção limpa a referência no perfil, mas a limpeza remota dessas imagens exige reconciliação operacional.

Logout invalida a sessão no banco antes de apagar os cookies. O cliente não persiste JWT ou refresh token em Web Storage; o navegador envia os cookies HttpOnly automaticamente. O endpoint `GET /usuarios/csrf` requer uma sessão ativa.

**Requisito pendente antes da publicação em produção:** aplicar limitação de tentativas no endpoint de login via gateway/proxy ou solução adequada à topologia de implantação. Esta proteção não está implementada nesta etapa.

### Testes automatizados

`npm test` executa a suíte padrão com dependências simuladas. A suíte de integração de persistência usa somente uma fixture descartável em loopback, fornecida explicitamente ao processo. Nenhum arquivo de um terceiro ambiente é carregado. Consulte o [guia de ambientes](docs/ambientes.md#verificações-locais).

### Formato da trilha

Os campos `titulo`, `descricao` e `endereco` são obrigatórios e devem ser textos não vazios.

```json
{
  "titulo": "Trilha da Lagoa",
  "descricao": "Percurso com vista para a lagoa e mata nativa.",
  "endereco": "Florianópolis, SC"
}
```

Ao salvar uma trilha, a API acrescenta o `_id`, `createdAt` e `updatedAt`:

```json
{
  "_id": "685865727ad75b64e3d85abc",
  "titulo": "Trilha da Lagoa",
  "descricao": "Percurso com vista para a lagoa e mata nativa.",
  "endereco": "Florianópolis, SC",
  "createdAt": "2026-06-22T14:30:00.000Z",
  "updatedAt": "2026-06-22T14:30:00.000Z"
}
```

### Exemplo de requisição

```bash
curl -X POST http://localhost:3000/trilhas \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "titulo": "Trilha da Lagoa",
    "descricao": "Percurso com vista para a lagoa e mata nativa.",
    "endereco": "Florianópolis, SC"
  }'
```

### Respostas de erro

Os erros seguem este formato:

```json
{
  "mensagem": "Título, descrição e endereço são obrigatórios."
}
```

Possíveis respostas incluem `400` para corpo, validação ou ID inválidos; `401` para token ausente, inválido ou expirado; `404` para recurso inexistente ou sem acesso por propriedade; `409` para username/e-mail duplicado, limite de cinco fotos ou conflito de upload; `413` para arquivo acima de 5 MiB; `502` para falha de upload; `503` quando Cloudinary não está configurado; e `500` para falhas internas. Exclusões de trilhas e fotos de trilha retornam `204` sem corpo; as outras respostas de sucesso são JSON.

## Scripts disponíveis

| Comando | Descrição |
| --- | --- |
| `npm run dev:production` | Inicia a API local com os recursos de produção |
| `npm start` | Inicia a API em produção e exige `MONGO_URI_PRODUCTION` |
| `npm run dev:homologation` | Inicia a API local com os recursos de homologação |
| `npm run dev:production -- --check-connection` | Confere a conexão de produção somente em leitura |
| `npm run dev:homologation -- --check-connection` | Confere a conexão de homologação somente em leitura |
| `npm test` | Executa os testes e gera o relatório de cobertura |
| `npm run lint` | Verifica os arquivos de `src` com o ESLint |

## Estrutura do projeto

```text
src/
├── config/          # Configuração do banco e do JWT
├── controllers/     # Regras das operações da API
├── middlewares/     # Validação e tratamento de erros
├── models/          # Modelos do Mongoose
├── routes/          # Definição dos endpoints
├── app.js           # Configuração do Express
└── server.js        # Conexão ao banco e inicialização do servidor
tests/              # Testes automatizados
```

## Testes e qualidade

Execute a suíte de testes:

```bash
npm test
```

O relatório HTML de cobertura é gerado em `coverage/lcov-report/index.html`.

Para verificar o padrão do código:

```bash
npm run lint
```

### Sessões obrigatórias em rotas protegidas

Tanto cookie quanto Bearer exigem access JWT com `sid` de sessão ativa, não revogada
e não expirada, vinculada ao usuário. JWTs legados sem `sid` recebem 401. Login e
refresh atuais já emitem esse claim; não há migração de dados. Clientes antigos
precisam renovar a sessão por refresh válido ou realizar login novamente. Logout
revoga a sessão e invalida novas requisições com seus access tokens. As permissões
de proprietário/admin e a proteção CSRF por cookie permanecem aplicadas.
