# Ambientes do Pé na Trilha

| Ambiente | Banco Atlas | Comando local nos dois projetos | API | Frontend |
| --- | --- | --- | --- | --- |
| Produção | `pe_na_trilha` em `penatrilhaproducao.squuj5c.mongodb.net` | `npm run dev:production` | `http://localhost:3000` | `http://localhost:5173` |
| Homologação e testes | `pe_na_trilha_homologacao` em `pe-na-trilha-testes.vcnkitn.mongodb.net` | `npm run dev:homologation` | `http://127.0.0.1:3001` | `http://127.0.0.1:5174` |

Execute o frontend dentro de `pe-na-trilha/` no repositório frontend. Use os endereços da tabela para manter os cookies de cada ambiente em hosts distintos. Os comandos locais fixam as origens permitidas e as portas de cada par.

## Arquivos de ambiente

- Backend de produção lê `.env.production` ou as variáveis do Render. Use `MONGO_URI_PRODUCTION` com o banco `pe_na_trilha`, os valores originais de `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET`, além de `JWT_SECRET` e `CSRF_SECRET` próprios de produção.
- Backend de homologação lê `.env.homologation`. Use `MONGO_URI_HOMOLOGATION`, `MONGO_HOST_HOMOLOGATION` e os segredos `JWT_SECRET` e `CSRF_SECRET` próprios de homologação. Para mídia, use `HOMOLOGATION_CLOUDINARY_CLOUD_NAME`, `HOMOLOGATION_CLOUDINARY_API_KEY`, `HOMOLOGATION_CLOUDINARY_API_SECRET`, `HOMOLOGATION_CLOUDINARY_PREFIX=homologacao/` e `HOMOLOGATION_CLOUDINARY_FOLDER_MODE=dynamic`. Os modelos do repositório listam os nomes sem valores secretos.
- Frontend local usa os endereços fixos da tabela. O build de produção recebe `VITE_API_URL` com a origem HTTPS real da API pelo painel da Vercel ou por `pe-na-trilha/.env.production` para build local. O build de homologação aponta para a API local de homologação.

Os arquivos reais ficam fora do Git. Arquivos locais antigos ficam preservados como arquivo histórico e estão fora do carregamento dos comandos.

### Permissões da chave de homologação

Crie uma chave própria com o papel **Media Library User** e, pelo Admin API `folder_operations`, atribua **Manager** apenas à pasta `homologacao`. Entre os papéis predefinidos de pasta, Contributor inclui upload, Editor inclui substituição e Manager inclui exclusão. A configuração de papéis por pasta para chaves está disponível em todos os planos. Papéis personalizados por método exigem Enterprise. Mantenha a chave de provisionamento fora do backend de homologação. [Chaves e permissões](https://cloudinary.com/documentation/developer_onboarding_faq_find_credentials) · [Papéis de pasta](https://cloudinary.com/documentation/permissions_system_roles_policies#folder_roles) · [Atribuição de papéis via API](https://cloudinary.com/documentation/permissions_assign_roles_api#assign_folder_roles_via_the_admin_api)

Antes de ativar o ambiente, confirme com imagens sintéticas que essa chave permite upload, geração antecipada de variantes, entrega assinada e exclusão individual. Confirme que a chave respeita a pasta reservada. A função das chaves ativas e a cobertura real das permissões dependem dessa verificação. Os limites de uso, a CDN e as configurações globais do Product Environment são compartilhados. Fotos de perfil continuam públicas por URL e o prefixo, por si só, não impõe autorização no provedor.

## Verificações locais

Na raiz do backend, acrescente `--check-connection` para conferir a identidade do banco somente em leitura:

```bash
npm run dev:production -- --check-connection
npm run dev:homologation -- --check-connection
```

Esses comandos consultam a topologia e os metadados do banco. A API, a criação de índices e o worker ficam desligados nessa verificação. O comando sem a opção inicia a aplicação normal no ambiente escolhido.

Use `npm test` e `npm run lint` nos dois projetos. A suíte de persistência `npm run test:integration` só aceita um replica set descartável em `127.0.0.1`, indicado por `TEST_MONGO_URI` com `TEST_ENVIRONMENT=integration`. Ela é uma fixture automatizada e fica fora dos dois bancos Atlas. Para habilitar seu Cloudinary real em uma execução autorizada, use `TEST_CLOUDINARY_REAL=1`. A suíte usa as credenciais de homologação e o prefixo por execução.

## Nuvem

- Render usa a raiz do backend, Node 22, build `npm ci`, start `npm start` e health check `/healthz`. Cadastre os segredos de produção no serviço. Deixe o Render definir `PORT` e informe em `FRONTEND_ORIGINS` a origem HTTPS exata da Vercel.
- Vercel usa `pe-na-trilha/` como raiz, `npm run build`, saída `dist` e a origem HTTPS do Render em `VITE_API_URL`. O arquivo `vercel.json` registra o fallback da SPA.
- Antes da publicação, verifique cookies de sessão, CSRF e CORS nos domínios finais. Mantenha os usuários Atlas e as chaves Cloudinary separados por ambiente, preservando os dados e o administrador principal de produção.
