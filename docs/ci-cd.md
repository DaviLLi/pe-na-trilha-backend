# CI/CD do backend do Pé na Trilha

## Integração contínua

O workflow **CI** roda em pushes para `main` e `develop` e em pull requests direcionados a essas branches. O job **Validar backend** prepara o Node.js 22 LTS, executa `npm ci` com o `package-lock.json` da raiz, roda `npm run lint` e executa toda a suíte padrão com `npm test -- --runInBand`. O Jest gera o relatório de cobertura. A API é iniciada diretamente pelo Node.js e o projeto não possui etapa de build.

A CI roda com as dependências do lockfile e não usa secrets. A suíte externa `npm run test:integration` continua disponível sob demanda em ambiente descartável, com suporte a transações no MongoDB e conta Cloudinary dedicada. As variáveis `TEST_*` e o procedimento estão na seção [Testes de integração](../README.md#testes-de-integração). Esses testes fazem operações reais nessas duas plataformas.

## Como verificar no GitHub

Após publicar a branch de trabalho, abra um pull request para `develop`. Na aba **Checks** do PR, ou em **Actions → CI**, abra o job **Validar backend** e confira as etapas de instalação, ESLint e Jest. Para condicionar merges de produção à validação, o responsável pelo repositório pode exigir esse check na proteção da branch de produção.

## Entrega no Render

O workflow de CI não aciona deploy. Confirme no Render a integração com o GitHub e qual é a branch de produção (`main` é a branch padrão observada localmente). O serviço usa a raiz do repositório, `npm ci` para instalar e `npm start` para iniciar a API. A opção **After CI Checks Pass** condiciona o deploy automático às verificações da branch vinculada. Confirme a branch e essa opção antes de ligar o deploy automático. [Deploys no Render](https://render.com/docs/deploys)

As variáveis de produção pertencem ao ambiente do serviço no Render. Configure `MONGO_URI_PRODUCTION` para o Atlas, `JWT_SECRET` e `CSRF_SECRET` independentes e `FRONTEND_ORIGINS` com a origem HTTPS autorizada. Para os recursos de fotos, configure as credenciais Cloudinary do backend no mesmo serviço. O [exemplo de ambiente](../.env.production.example) lista os nomes sem valores reais. A integração nativa do Render com o GitHub não requer um token de deploy na CI.
