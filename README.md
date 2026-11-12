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

2. Instale as dependências:

   ```bash
   npm install
   ```

3. Crie o arquivo de variáveis de ambiente a partir do exemplo:

   ```bash
   cp .env.example .env
   ```

4. Preencha o `.env` com a configuração exclusiva de desenvolvimento. Mantenha em `MONGO_URI_DEVELOPMENT` exatamente o URI do banco de desenvolvimento atual:

   ```env
   PORT=3000
   NODE_ENV=development
   MONGO_URI_DEVELOPMENT=mongodb+srv://usuario:senha@cluster.mongodb.net/penatrilha
   FRONTEND_URL=http://localhost:5173
   FRONTEND_ORIGINS=http://localhost:5173
   JWT_SECRET=
   CSRF_SECRET=
   AUTH_COOKIE_SAME_SITE=lax
   CLOUDINARY_CLOUD_NAME=
   CLOUDINARY_API_KEY=
   CLOUDINARY_API_SECRET=
   ```

   Gere valores independentes para `JWT_SECRET` e `CSRF_SECRET`, cada um com pelo menos 256 bits (por exemplo, `openssl rand -base64 32`), e configure-os somente no `.env` local ou no gerenciador de segredos do ambiente. Não coloque valores reais no repositório.

   | Variável | Obrigatória | Descrição | Padrão |
   | --- | --- | --- | --- |
   | `NODE_ENV` | Definida pelo script | Ambiente selecionado (`development` ou `production`) | — |
   | `MONGO_URI_DEVELOPMENT` | Sim em desenvolvimento | URI exclusiva do MongoDB de desenvolvimento | — |
   | `MONGO_URI_PRODUCTION` | Sim em produção | URI exclusiva do MongoDB de produção | — |
   | `PORT` | Não | Porta utilizada pela API | `3000` |
   | `FRONTEND_URL` | Não | Origem frontend legada/fallback | `http://localhost:5173` |
   | `FRONTEND_ORIGINS` | Não | Lista separada por vírgulas de origens frontend exatas autorizadas por CORS e Origin | `FRONTEND_URL` |
   | `JWT_SECRET` | Sim | Segredo aleatório de pelo menos 256 bits para assinar tokens | — |
   | `CSRF_SECRET` | Sim | Segredo independente de pelo menos 256 bits para tokens CSRF vinculados à sessão | — |
   | `AUTH_COOKIE_SAME_SITE` | Não | `lax`, `strict` ou `none`; `none` exige ambiente HTTPS de produção | `lax` em desenvolvimento, `none` em produção |
   | `CLOUDINARY_CLOUD_NAME` | Não | Nome da conta Cloudinary para upload de fotos de perfil e trilhas | — |
   | `CLOUDINARY_API_KEY` | Não | Chave de API Cloudinary, mantida somente no backend | — |
   | `CLOUDINARY_API_SECRET` | Não | Segredo de API Cloudinary, mantido somente no backend | — |

As credenciais Cloudinary são opcionais para iniciar a API. Sem elas, cadastro, login e trilhas continuam disponíveis, enquanto os endpoints de foto respondem `503`. Nunca configure credenciais Cloudinary no frontend. Operações de sessão usam transações MongoDB; instâncias MongoDB locais precisam operar como replica set.

> Não publique o arquivo `.env`: ele pode conter credenciais e já está incluído no `.gitignore`.

## Executando o projeto

`npm run dev` seleciona explicitamente `development` e usa somente `MONGO_URI_DEVELOPMENT` do `.env`. O valor do URI existente deve ser preservado nessa variável. A configuração de produção nunca é usada pelo comando de desenvolvimento.

Em desenvolvimento, com reinicialização automática:

```bash
npm run dev
```

Para iniciar a API em produção:

```bash
npm start
```

`npm start` seleciona explicitamente `production` e exige `MONGO_URI_PRODUCTION`. Não há fallback para o URI de desenvolvimento. Configure a variável no ambiente do serviço de produção ou em um gerenciador de segredos, apontando para o cluster Atlas `PeNaTrilhaProducao`. O arquivo `.env.production.example` documenta o formato esperado; não versione um `.env.production` real. Se a variável de produção estiver ausente, o servidor encerra antes de conectar ao MongoDB.

O banco de integração permanece independente: `npm run test:integration` carrega `.env.integration` e usa somente `TEST_MONGO_URI`, sem fallback para as variáveis de desenvolvimento ou produção.

Por padrão, a API estará disponível em `http://localhost:3000`.

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

### Testes de integração

Os testes de integração são opt-in e usam `npm run test:integration`; `npm test` continua executando a suíte padrão sem depender de MongoDB ou Cloudinary.

Configure um MongoDB descartável com suporte a transações e uma conta Cloudinary dedicada a testes. Para MongoDB local, configure o servidor como replica set (o exemplo usa `replicaSet=rs0`). Copie `.env.integration.example` para `.env.integration` e preencha somente credenciais desses recursos de teste. O setup carrega explicitamente esse arquivo e nunca usa `.env`, `MONGO_URI_DEVELOPMENT`, `MONGO_URI_PRODUCTION` ou credenciais Cloudinary normais como fallback.

São obrigatórias `TEST_ENVIRONMENT=integration`, `TEST_MONGO_URI`, `TEST_MONGO_ALLOWED_HOSTS` com uma lista explícita de hosts, e `TEST_CLOUDINARY_CLOUD_NAME`, `TEST_CLOUDINARY_API_KEY` e `TEST_CLOUDINARY_API_SECRET`. O URI deve apontar para um banco cujo nome contenha um segmento `test`, `testing`, `integration` ou `ci`; o host precisa corresponder exatamente a um item da allowlist. Para `mongodb+srv`, inclua na allowlist o host de seed e todos os destinos SRV. O setup valida duas respostas DNS SRV consecutivas e aborta antes da conexão se os destinos ou portas mudarem. Também valida os membros `hosts`, `passives` e `arbiters` anunciados pelo replica set antes de criar o marcador. No teardown, o model `OperacaoImagem` só é importado depois dessa validação, evitando a criação automática antecipada de índices. Topologias mongos são rejeitadas porque a resposta `hello` não enumera todos os membros internos dos shards.

Cada execução cria um nome de banco `tst_<TEST_RUN_ID>` com os 32 caracteres aleatórios completos (36 bytes), respeitando o limite de 38 bytes do MongoDB Atlas. A validação rejeita qualquer nome de banco da execução acima desse limite. O setup aborta se encontrar coleções nesse banco antes dos testes. O teardown remove documentos somente desse banco isolado e exclui assets somente após registro explícito em `__integration_assets` para o `TEST_RUN_ID` atual. Os testes de imagem devem registrar os `publicId`s obtidos após uploads feitos nessa execução; a coleção geral de operações não autoriza exclusões. O registro permanece se a chamada Cloudinary falhar, permitindo nova tentativa. Fixtures devem criar imagens pelos endpoints, sem semear `publicId`s arbitrários. Não usa `dropDatabase` nem limpa assets por prefixo. Mensagens de recuperação ainda podem identificar nomes legados, mas a validação atual só aceita o formato compacto. Use credenciais com acesso restrito ao cluster de teste e não compartilhe a conta Cloudinary com produção.

O driver pode resolver novamente o DNS SRV e abrir conexões com membros anunciados pelo servidor durante descoberta antes que o setup consiga comparar a resposta `hello`. As duas consultas SRV reduzem a janela para uma resposta DNS instável, mas não eliminam a corrida entre a validação e a resolução interna do driver. A allowlist do código não substitui uma regra de saída de rede para impedir contatos TCP com hosts não permitidos. Configure também o firewall/egress do ambiente de teste para os hosts aprovados.

O teste inicial valida conexão e topologia MongoDB, depois verifica commit e rollback reais consultando o estado persistido. A execução desse comando conecta ao MongoDB e pode fazer chamadas ao Cloudinary durante os testes; não o execute sem configurar e conferir os recursos descartáveis.

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
| `npm run dev` | Inicia a API em modo de desenvolvimento e usa `MONGO_URI_DEVELOPMENT` |
| `npm start` | Inicia a API em produção e exige `MONGO_URI_PRODUCTION` |
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
