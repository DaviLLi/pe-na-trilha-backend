# Preparação do Pé na Trilha para publicação

O backend Express e o frontend React/Vite foram validados localmente com Node.js 22.23.5 LTS. As etapas abaixo descrevem a configuração futura no Render, Vercel, MongoDB Atlas e Cloudinary. A publicação depende de autorização.

## Render

- Usar a raiz do repositório backend. Configurar `npm ci` para o build e `npm start` como comando de inicialização, com Node 22 LTS.
- Configurar a verificação HTTP em `/healthz`. Ela retorna 200 quando a conexão do Mongoose está ativa e 503 quando está indisponível. O bootstrap conecta o MongoDB e prepara os índices do limitador antes de abrir a porta. Confirmar a porta fornecida pelo Render e o encerramento por SIGTERM.
- Configurar `MONGO_URI_PRODUCTION`, `JWT_SECRET`, `CSRF_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET` no gerenciador de ambiente. Gerar chaves independentes com pelo menos 32 bytes aleatórios para sessão e CSRF. Usar as mesmas chaves entre instâncias do mesmo ambiente. Uma rotação invalida sessões ou altera a identificação das janelas de limite de login.
- Definir `FRONTEND_ORIGINS` com as origens HTTPS exatas e autorizadas. Confirmar os proxies que podem encaminhar o IP de cliente antes de definir `TRUST_PROXY_CIDRS`. O backend usa o endereço do socket quando essa variável está ausente. Verificar a identificação do cliente com a topologia real para evitar agrupar usuários em um único IP de proxy.
- Manter o deploy automático sob controle até a decisão sobre a A01 e a revisão dos hashes e assinaturas. Configurar alertas para falhas em `/healthz`, aumento de HTTP 429 e 503 de autenticação e acúmulo de operações de imagem em `failed`. Evitar coleta de cookies, cabeçalhos de autorização, corpos de login e URIs de banco nos logs.

[Render — serviços web](https://render.com/docs/web-services) · [Render — health checks](https://render.com/docs/health-checks) · [Express — proxies](https://expressjs.com/en/guide/behind-proxies/)

## Vercel

- Usar `pe-na-trilha` como diretório raiz da aplicação Vite, `npm ci` para instalar, `npm run build` para compilar e `dist` como saída.
- Configurar `VITE_API_URL` para a URL HTTPS do backend. Variáveis Vite entram no bundle público. Configurar o fallback da SPA e testar acesso direto a `/login`, `/cadastro`, `/perfil` e `/admin`.
- Preferir domínios HTTPS sob o mesmo domínio registrável para frontend e API, por exemplo `app.example.invalid` e `api.example.invalid`. Verificar `AUTH_COOKIE_SAME_SITE`, cookies `HttpOnly` e `Secure`, renovação e CSRF nos navegadores que serão suportados. Se forem usados os domínios padrão de provedores diferentes, testar as restrições dos navegadores a cookies entre sites.
- Publicar conjuntamente versões compatíveis do frontend e do backend. O cadastro agora exige as versões vigentes dos documentos e a moderação exige a revisão retornada pela API.

[Vercel — Vite](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel — rewrites](https://vercel.com/docs/routing/rewrites)

## Atlas e Cloudinary

- Usar um replica set Atlas compatível com transações e uma conta de aplicação com privilégios limitados à base necessária. Validar a capacidade de criar os índices `tentativas_login.expiraEm`, `trilhas.fotos.publicId` e `usuarios.fotoPerfilPublicId`. Preparar um backup e testar restauração fora de produção.
- Restringir o acesso de rede ao Atlas aos destinos confirmados para a aplicação e às rotinas autorizadas. Manter as contas, URIs e dados de teste e de produção separados.
- Usar a chave original de produção e a chave restrita à pasta `homologacao/` para homologação. Confirmar a entrega autenticada das fotos de publicações, a entrega por meio da API e as permissões da conta. Validar a compensação com arquivos descartáveis e verificar operações pendentes e falhas. A foto de perfil mantém seu fluxo existente.
- Preencher os campos de responsabilidade, contato, finalidades e retenção hoje marcados como pendentes nos documentos legais. A aprovação do conteúdo e a decisão sobre a versão publicada cabem aos responsáveis pelo projeto.

[MongoDB Atlas — lista de acesso IP](https://www.mongodb.com/docs/atlas/security/ip-access-list/) · [Cloudinary — controle de acesso à mídia](https://cloudinary.com/documentation/control_access_to_media)

## Critérios de liberação

- Aprovar separadamente qualquer publicação do histórico reescrito. Conferir as referências de PR, caches e acesso a commits antigos com o GitHub.
- Validar o Cloudinary real em ambiente descartável antes de publicar. Cobrir upload, substituição, exclusão, acesso privado, timeouts e reconciliação.
- Confirmar o proxy, os domínios, o cadastro com aceite, a sessão em navegadores, os perfis e a moderação em ambiente de homologação.
- Registrar responsáveis por alertas, backups, restauração e revisão das operações de limpeza que excederem as tentativas.
