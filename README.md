# Pé na Trilha — Backend

API REST para cadastrar usuários, autenticar e gerenciar trilhas. O projeto oferece operações de cadastro e login de usuários e criação, consulta, atualização e exclusão de trilhas, com validação, persistência no MongoDB e tratamento centralizado de erros.

## Tecnologias

- Node.js e ES Modules
- Express 5
- MongoDB e Mongoose
- bcrypt para hash de senhas
- jose para JWT
- CORS e dotenv
- Jest para testes
- ESLint para análise de código

## Pré-requisitos

Antes de começar, tenha instalado:

- [Node.js](https://nodejs.org/) 20 ou superior
- npm
- Uma instância do [MongoDB](https://www.mongodb.com/), local ou no MongoDB Atlas

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

4. Preencha o `.env` com os dados do seu ambiente:

   ```env
   PORT=3000
   MONGO_URI=mongodb+srv://usuario:senha@cluster.mongodb.net/penatrilha
   FRONTEND_URL=http://localhost:5173
   JWT_SECRET=
   ```

   Gere um segredo aleatório com pelo menos 256 bits (por exemplo, `openssl rand -base64 32`) e configure-o somente no `.env` local ou no gerenciador de segredos do ambiente. Não coloque o valor real no repositório.

   | Variável | Obrigatória | Descrição | Padrão |
   | --- | --- | --- | --- |
   | `MONGO_URI` | Sim | URI de conexão com o MongoDB | — |
   | `PORT` | Não | Porta utilizada pela API | `3000` |
   | `FRONTEND_URL` | Não | Origem autorizada pelo CORS | `http://localhost:5173` |
   | `JWT_SECRET` | Sim | Segredo aleatório de pelo menos 256 bits para assinar tokens | — |

> Não publique o arquivo `.env`: ele pode conter credenciais e já está incluído no `.gitignore`.

## Executando o projeto

Em desenvolvimento, com reinicialização automática:

```bash
npm run dev
```

Em modo normal:

```bash
npm start
```

Por padrão, a API estará disponível em `http://localhost:3000`.

## Endpoints

A URL base dos recursos é `/trilhas`.

| Método | Endpoint | Descrição | Sucesso |
| --- | --- | --- | --- |
| `GET` | `/trilhas` | Lista todas as trilhas, das mais recentes para as mais antigas | `200` |
| `GET` | `/trilhas/:id` | Busca uma trilha pelo ID | `200` |
| `POST` | `/trilhas` | Cadastra uma trilha | `201` |
| `PUT` | `/trilhas/:id` | Atualiza todos os dados de uma trilha | `200` |
| `DELETE` | `/trilhas/:id` | Exclui uma trilha | `204` |

### Cadastro e autenticação de usuários

| Método | Endpoint | Descrição | Sucesso |
| --- | --- | --- | --- |
| `POST` | `/usuarios` | Cadastra um usuário | `201` |
| `POST` | `/usuarios/login` | Autentica por username ou e-mail e retorna JWT | `200` |

O login recebe `identificador` e `senha`. Para acessar rotas protegidas, envie o JWT no cabeçalho `Authorization: Bearer <token>`. O token expira em 15 minutos. A API não armazena tokens; o cliente não deve persistir o token em `localStorage`.

**Requisito pendente antes da publicação em produção:** aplicar limitação de tentativas no endpoint de login via gateway/proxy ou solução adequada à topologia de implantação. Esta proteção não está implementada nesta etapa.

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

Possíveis respostas incluem:

- `400` para corpo, dados ou ID inválidos;
- `404` para trilha ou rota não encontrada;
- `500` para erro interno do servidor.

## Scripts disponíveis

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia a API em modo de desenvolvimento |
| `npm start` | Inicia a API |
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
