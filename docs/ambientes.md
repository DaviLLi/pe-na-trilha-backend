# Ambientes do backend

| Ambiente | Comando | Configuração | MongoDB e mídia |
| --- | --- | --- | --- |
| Desenvolvimento | `npm run dev` | `.env` | MongoDB local dedicado, Cloudinary desabilitado |
| Testes unitários | `npm test` | Jest e valores fictícios de cada suíte | Sem credenciais de MongoDB ou Cloudinary herdadas |
| Integração | `npm run test:integration` | `.env.integration` | Atlas de testes, Cloudinary desabilitado por padrão |
| Homologação | `npm run start:homologation` | `.env.homologation` | Banco `pe_na_trilha_homologacao` no Atlas de testes e pasta reservada no Cloudinary compartilhado |
| Produção | `npm start` | Variáveis do serviço ou `.env.production` | MongoDB e Cloudinary de produção |

Os comandos da API definem o ambiente antes de ler o arquivo correspondente. As variáveis já exportadas no processo têm precedência. Homologação usa `APP_ENV=homologation` e `NODE_ENV=production` para aplicar a configuração de cookies HTTPS. Os comandos administrativos usam o carregador e a proteção MongoDB da API e aceitam somente desenvolvimento ou produção.

### Onde a configuração é usada

- `package.json`, `src/server.js`, `src/config/carregarAmbiente.js`, `src/config/database.js`, `tools/provisionar-primeiro-admin.js` e `tools/gerenciar-admin.js` compõem os pontos de entrada da API e dos comandos administrativos.
- `jest.config.js` e `tests/unitEnvironment.js` isolam o processo dos testes unitários. `jest.integration.config.js` e os arquivos `run.js`, `ambiente.js`, `setupEnvironment.js`, `globalSetup.js`, `globalTeardown.js`, `topologia.js` e `infraGate.js` em `tests/integration/` preparam e validam as conexões da suíte de integração. Os cenários `authSession.integration.js`, `infra.integration.js` e `remediacao.integration.js` consomem essa configuração.
- `src/config/cloudinary.js` configura o SDK. `src/config/isolamentoCloudinary.js` valida a mídia de homologação. `src/domain/identidadeImagem.js`, `src/services/cloudinaryService.js` e `src/services/entregaFotoService.js` aplicam o escopo por execução. Os módulos `diagnosticoUpload.js` e `diagnosticoUpload403Temporario.js` tratam o diagnóstico de upload.

## Desenvolvimento local

1. Use um MongoDB local como replica set de um membro, vinculado ao loopback, e reserve um banco exclusivo para o projeto. Transações são necessárias para sessões e fotos.
2. Use [.env.example](../.env.example) como referência e preencha `MONGO_URI_DEVELOPMENT` com a URI real desse banco. A URI deve incluir o nome do banco e usar um único IP de loopback, `127.0.0.1` ou `[::1]`. O driver usa conexão direta para limitar a descoberta de destinos.
3. Configure segredos próprios para JWT e CSRF. Inicie com `npm run dev` e verifique `GET /healthz`.

O desenvolvimento local dispensa um cluster Atlas e uma chave Cloudinary.

## Atlas de testes

1. Use uma credencial própria para a suíte, com acesso restrito ao cluster Atlas de testes. A suíte cria uma base descartável `tst_<TEST_RUN_ID>` por execução. A credencial precisa poder criar coleções e índices, ler, inserir, atualizar e remover documentos e usar transações nesse banco. [Usuários de banco no Atlas](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/)
2. Autorize somente os IPs dos executores de integração no projeto de testes. Preencha `TEST_MONGO_URI` com a URI SRV do Atlas de testes, usando um nome de banco-base com um segmento `test`, `testing`, `integration` ou `ci`. Em `TEST_MONGO_ALLOWED_HOSTS`, inclua o seed e os membros SRV do cluster. Mantenha a saída de rede limitada aos destinos aprovados. [Lista de acesso por IP](https://www.mongodb.com/docs/atlas/security/ip-access-list/)
3. Confira a seleção com `npm run test:integration -- --check`. Esse comando só valida configuração. A execução sem `--check` conecta ao Atlas de testes.

O setup exige um banco sem coleções de aplicação e grava o marcador `__integration_run`. Setup, cenários e teardown conferem o nome do banco da conexão. O teardown exige o marcador da execução e remove documentos desse banco, preservando as coleções e seus índices. A suíte não executa `dropDatabase` ou `dropCollection`.

### Restringir a credencial da suíte por banco

O Atlas concede permissões por nome exato de banco. `tst_*` é uma convenção da aplicação. Uma permissão de escrita para todos os bancos também abrange `pe_na_trilha_homologacao`, mesmo quando limitada ao cluster de testes. Para isolar os dois usuários no Atlas, selecione o identificador antes de conceder acesso:

```bash
pnt_run_id="$(node -p 'require("node:crypto").randomBytes(16).toString("hex")')"
TEST_RUN_ID="$pnt_run_id" npm run test:integration -- --check
```

Em **Database & Network Access → Database Users**, atribua `readWrite` somente ao banco exato mostrado pelo preflight. Use uma credencial de integração sem papéis amplos adicionais e informe-a em `TEST_MONGO_URI`, mantendo o banco-base de teste e os parâmetros de autenticação da URI. No mesmo terminal, execute `TEST_RUN_ID="$pnt_run_id" npm run test:integration`. Use um identificador novo e atualize a concessão a cada execução. As coleções deixadas pelo teardown fazem o setup recusar o reaproveitamento do mesmo banco. [Usuários no Atlas](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/) · [Escopo de recursos e permissões](https://www.mongodb.com/docs/manual/reference/resource-document/)

## MongoDB e Cloudinary de homologação

1. No projeto Atlas de testes existente, crie um usuário próprio para homologação. Atribua `readWrite` somente a `pe_na_trilha_homologacao` e selecione a restrição ao cluster de testes. Na lista de acesso do projeto, confirme o IP de saída do backend de homologação e adicione-o caso ainda falte. Use a URI SRV desse usuário em `MONGO_URI_HOMOLOGATION`, com o caminho `/pe_na_trilha_homologacao` antes dos parâmetros. Mantenha os parâmetros de autenticação emitidos pelo Atlas. Configure `MONGO_HOST_HOMOLOGATION=pe-na-trilha-testes.vcnkitn.mongodb.net`. A inicialização exige esse par de host e banco. [Usuários de banco no Atlas](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/) · [Lista de acesso por IP](https://www.mongodb.com/docs/atlas/security/ip-access-list/)
2. No Product Environment existente do Cloudinary, confirme que a pasta da Media Library e o prefixo de IDs públicos `homologacao/` estão livres de imagens de produção. Reserve essa pasta e mantenha seus assets e IDs dentro dela. Informe o Cloud Name compartilhado em `HOMOLOGATION_CLOUDINARY_CLOUD_NAME`, uma credencial própria em `HOMOLOGATION_CLOUDINARY_API_KEY` e `HOMOLOGATION_CLOUDINARY_API_SECRET`, e `homologacao/` em `HOMOLOGATION_CLOUDINARY_PREFIX`. Preencha `HOMOLOGATION_CLOUDINARY_FOLDER_MODE` com `dynamic` ou `fixed` conforme informado pelo Console. Em pastas dinâmicas, o backend envia `asset_folder=homologacao` além do ID completo. Em pastas fixas, usa `folder=homologacao` e o ID relativo. [Modos de pasta](https://cloudinary.com/documentation/folder_modes)
3. Use [.env.homologation.example](../.env.homologation.example) e preencha `FRONTEND_ORIGINS` com a origem HTTPS de homologação e os segredos exclusivos `JWT_SECRET` e `CSRF_SECRET`.
4. A API usa IDs sob `homologacao/perfis/` e `homologacao/trilhas/`. Com autorização para testes reais, use somente imagens sintéticas e valide primeiro com `TEST_CLOUDINARY_REAL=1 npm run test:integration -- --check`. A execução real usa o banco descartável e reserva `homologacao/integracao/<TEST_RUN_ID>/` para seus assets. O preflight local valida as variáveis e o escopo do código. Confirme as permissões efetivas da chave separadamente no provedor.

### Permissões da chave de homologação

Crie uma chave própria com o papel **Media Library User** e, pelo Admin API `folder_operations`, atribua **Manager** apenas à pasta `homologacao`. Entre os papéis predefinidos de pasta, Contributor inclui upload, Editor inclui substituição e Manager inclui exclusão. A configuração de papéis por pasta para chaves está disponível em todos os planos. Papéis personalizados por método exigem Enterprise. Mantenha a chave de provisionamento fora do backend de homologação. [Chaves e permissões](https://cloudinary.com/documentation/developer_onboarding_faq_find_credentials) · [Papéis de pasta](https://cloudinary.com/documentation/permissions_system_roles_policies#folder_roles) · [Atribuição de papéis via API](https://cloudinary.com/documentation/permissions_assign_roles_api#assign_folder_roles_via_the_admin_api)

Antes de ativar o ambiente, confirme com imagens sintéticas que essa chave permite upload, geração antecipada de variantes, entrega assinada e exclusão individual. Confirme que a chave respeita a pasta reservada. A função das chaves ativas e a cobertura real das permissões dependem dessa verificação. Os limites de uso, a CDN e as configurações globais do Product Environment são compartilhados. Fotos de perfil continuam públicas por URL e o prefixo, por si só, não impõe autorização no provedor.

## Produção

Mantenha a URI e as credenciais de produção no serviço de produção. Use [.env.production.example](../.env.production.example) como inventário. A aplicação carrega `MONGO_URI_PRODUCTION`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET` desse ambiente.
