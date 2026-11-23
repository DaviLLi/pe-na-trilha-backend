# Relatório de remediação do Pé na Trilha

**Situação em 21/11/2026.** As correções locais e as auditorias npm foram validadas. O espelho sanitizado foi preservado. O projeto ainda não está pronto para publicação porque a exposição no GitHub continua aberta, o Cloudinary real precisa de validação em homologação e a configuração dos provedores e dos documentos legais depende dos responsáveis pelo projeto.

## Estado e preservação dos repositórios

O backend está no commit `7f3e4a4` e o frontend em `4407986`, ambos na branch `chore/ci-cd-pipeline`. A comparação inicial com as referências locais de acompanhamento deu zero commits à frente e zero atrás nas duas branches ativas. O backup local das mudanças iniciais está em `/tmp/pnt-preservacao.TsDfgg4o`, com permissões restritas. Inclui patches dos arquivos rastreados e os quatro arquivos inicialmente novos do backend.

Na inspeção inicial, o backend tinha 16 arquivos modificados fora do índice e quatro novos. O frontend tinha seis arquivos modificados fora do índice. O stash `0f1ac73` do backend foi mantido e contém mudanças em quatro arquivos de cobertura. O frontend não tinha stash. Sua lista de worktrees também continha um registro para um caminho temporário ausente. O registro ficou preservado. As mudanças da continuidade ficaram no diretório de trabalho, sem commits ou publicação.

## A01 — Histórico e achados

O diretório da primeira tentativa estava vazio. O espelho foi reconstruído em um `ramfs` privado com permissão `0700` e swap desativado para o grupo de processos. Apenas a cópia reescrita foi preservada em `/tmp/pnt-a01-sanitizado.tl3U2abM/clean.git`. O diretório pai tem modo `0700`. O remoto local da cópia foi removido após a validação. O caminho em `/tmp` é temporário.

O `git fsck` passou. O mapa é bijetivo e cobre os 65 commits. A comparação validou a ordem dos pais, as árvores fora do `.env` removido e autoria, datas, codificação e mensagens. Foram confirmadas 21 branches e 28 refs de PR. As 49 pontas mudaram. A credencial histórica era alcançável por 47 refs, incluindo os 26 PRs de #3 a #28. Commits assinados anteriores à introdução também tiveram seus hashes alterados pela exportação. A ausência do caminho e do blob histórico foi verificada novamente no espelho preservado.

| Regra | Arquivo | Commit original → reescrito | Classificação e alcance no espelho |
|---|---|---|---|
| `generic-api-key` | `tests/authSessionSecurity.test.js:30` | `50f1494` → `f71bdd6` | Identificador fictício em um teste que exige rejeição de token CSRF de outra sessão. O commit continua alcançável por 7 branches e 5 refs de PR. |
| `generic-api-key` | `tests/authSessionSecurity.test.js:30` | `d370401` → `5a4910a` | O mesmo identificador fictício, reapresentado em um merge. O commit continua alcançável por 6 branches e 4 refs de PR. |

O teste gera a chave CSRF aleatoriamente durante sua execução. O conteúdo sinalizado é o argumento de identificação da sessão passada para a rejeição esperada. A busca pela literal nos caminhos de runtime e CI dos commits apontados não encontrou ocorrências. O Gitleaks 8.30.1 encerrou com o código de achados `42` e reportou exatamente esses dois casos. Nenhuma exceção foi adicionada.

### Minuta para o GitHub Support

Para `DaviLLi/pe-na-trilha-backend`, solicitar orientação para desreferenciar os PRs #3 a #28, preservar conversas e limpar caches e objetos antigos após uma eventual publicação aprovada do histórico reescrito. O commit que introduziu a exposição é `e8b4baf`. O primeiro commit alterado pelo filtro foi `d008d6b`, devido à perda de assinatura antes do incidente. Anexar `filter-repo/changed-refs`, `filter-repo/first-changed-commits` e `affected-prs` do diretório privado. As refs #1 e #2 mudaram na cópia local pela reescrita de ancestrais e estão fora do grupo de refs que alcançava o segredo.

O remoto foi conferido antes e depois da reconstrução e permaneceu igual. O chamado fica como minuta. A política do GitHub permite que o suporte recuse a limpeza quando a revogação já mitiga o risco. A retirada do histórico público continua pendente de autorização e da resolução das refs internas e caches. [GitHub — remoção de dados sensíveis e suporte](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository#fully-removing-the-data-from-github)

## A02 — Dependências

Na primeira atualização compatível, o backend atualizou Mongoose 9.7.2 → 9.12.3, ESLint 10.5.0 → 10.15.0 e Jest 30.4.2 → 30.5.2. O frontend atualizou Axios 1.17.0 → 1.21.1, React Router DOM 7.17.0 → 7.18.6 e Vite 8.0.8 → 8.3.8. As duas aplicações preservaram suas versões principais.

A nova consulta do backend identificou 18 entradas moderadas. Duas correspondiam a avisos sobre pacotes transitivos, e as demais propagavam o efeito pela árvore de desenvolvimento.

| Entrada reportada | Versão encontrada | Tipo e efeito |
|---|---|---|
| `glob` | 13.0.7 e 10.5.0 | Transitiva. O cancelamento de uma busca em arquivos locais pode deixar trabalho de travessia continuar. |
| `minimatch` | 10.2.6 e 9.0.9 | Transitiva. O processamento de padrões pode consumir recursos em excesso. |
| `test-exclude` | 7.0.2 | Transitiva. Seleção de arquivos para instrumentação trazia os dois pacotes. |
| `babel-plugin-istanbul` | 8.0.0 | Transitiva. Instrumentação de cobertura via `test-exclude`. |
| `babel-jest`, `@jest/transform`, `@jest/reporters` | 30.5.2 | Transitivas. Transformação e relatórios traziam os pacotes afetados. |
| `@jest/core`, `@jest/expect`, `@jest/globals`, `jest-circus`, `jest-cli`, `jest-config`, `jest-resolve-dependencies`, `jest-runner`, `jest-runtime`, `jest-snapshot` | 30.5.2 | Transitivas. Impacto herdado da execução, localização e instrumentação dos testes. |
| `jest` | 30.5.2 | Direta de desenvolvimento. Impacto herdado de `@jest/core` e `jest-cli`. |

Os avisos atingiam a preparação e a execução de testes, inclusive CI. A auditoria apenas de produção já retornava zero. O npm sugeria um downgrade principal do Jest, que teria efeito sobre a suíte ESM. Foram usadas substituições limitadas aos quatro consumidores da cadeia de testes, com `glob` 14.0.6 e `minimatch` 11.0.9. Como essas versões ultrapassam o intervalo declarado pelos consumidores antigos, a compatibilidade foi verificada em uma cópia privada antes de aplicar os manifests. A suíte completa, incluindo a cobertura, passou novamente no backend. **As auditorias finais retornaram zero alertas no backend completo, no backend sem devDependencies e no frontend.** Reavaliar as substituições quando os consumidores publicarem faixas compatíveis. [Aviso de glob](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4) · [Aviso de minimatch](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)

## A03 a A06 — Regras e evidências

| Item | Resultado local |
|---|---|
| **A03 — Login** | A API reserva atômica e temporariamente 60 tentativas por origem e 10 por identificador em cinco minutos. As chaves são derivadas por HMAC e expiram pelo índice TTL. Os testes unitários e o replica set comprovaram resposta genérica, limite concorrente, bloqueio, recuperação e o tratamento de cabeçalhos de IP com e sem proxy confiável. E-mail e nome de usuário são identificadores separados. Um bloqueio dirigido pode afetar temporariamente tentativas legítimas pelo mesmo identificador. A topologia de proxy real ainda precisa ser confirmada. |
| **A04 — Termos** | O cadastro direto rejeitou aceite ausente, não booleano ou desatualizado nos testes. O MongoDB registrou versão dos termos, versão da política apresentada e data do servidor, sem devolver a evidência na resposta pública. O login de conta antiga funcionou sem criação retroativa de aceite. As versões no React e no backend estão alinhadas. |
| **A05 — Moderação** | Uma revisão da publicação é obrigatória junto da decisão. A API grava somente quando estado e revisão coincidem. Duas decisões simultâneas geraram uma gravação e um 409. Testes cobriram revisão obsoleta, publicação já moderada, usuário comum, CSRF e tentativa de edição por administrador que não é o proprietário. O navegador exige nova consulta após conflito. |
| **A06 — Fotos** | Testes com falhas injetadas confirmaram compensação de upload, falha de metadados após envio, preservação de foto antiga quando a substituição falha e recuperação de leases. Com MongoDB local e provedor simulado, o worker protegeu referências de trilha e perfil, voltou a agendar após falha transitória e concluiu a remoção do órfão sintético. O comportamento do provedor real fica pendente de homologação. |

Os arquivos centrais são `src/middlewares/limitarLogin.js`, `src/models/TentativaLogin.js`, `src/middlewares/validarUsuario.js`, `src/models/Usuario.js`, `src/controllers/trilhaController.js`, `src/models/Trilha.js` e `src/services/processarOperacoesImagem.js`. No frontend, os principais ajustes estão em `src/pages/Admin.jsx`, `src/services/trilhasService.js`, `src/pages/CadastroUsuario.jsx` e `src/data/documentosLegais.js`.

## Evidências de execução

O ambiente usou Node.js **22.23.5 LTS**, MongoDB local **7.0.34** com replica set descartável e Chromium local para testes com API sintética.

| Verificação | Resultado |
|---|---|
| Backend, suíte padrão | 665 aprovados, 0 reprovados em 39 suítes. Cobertura de linhas de 92,36%. |
| Integração em replica set local | 10 aprovados, 0 reprovados e 3 ignorados. As três suítes e o teardown passaram. Os ignorados exigem Cloudinary real. |
| Frontend, unidade e navegador | 194 aprovados, 0 reprovados, 0 ignorados. |
| ESLint backend e frontend | Ambos aprovados. |
| Build de produção frontend | Vite 8.3.8 aprovado com URL de API fictícia. O backend JavaScript executa diretamente via Node. |
| Inicialização e encerramento do backend | Processo em modo produção, conectado apenas ao MongoDB local. `/healthz` respondeu HTTP 200 e o encerramento por SIGTERM foi confirmado. |

Nas primeiras rodadas, testes do navegador falharam porque as fixtures de moderação ainda omitiam a revisão. As fixtures e as verificações de conflito foram atualizadas e a suíte inteira passou depois. Na integração, foi corrigido o caminho da configuração Jest. Uma seleção ampla incluiu três testes de Cloudinary real, que falharam por ausência deliberada de rede externa, e deixou operações que interferiram no teste da fila. A seleção final excluiu esses três testes. A primeira seleção local passou nas assertivas, mas o teardown recusou registros simulados sem registro de asset externo. O teste passou a limpar apenas seus IDs sintéticos no fim, mantendo a proteção do teardown. A rodada final encerrou com código zero.

## Pendências de liberação

A configuração futura está em [Preparação para publicação](publicacao-nuvem.md). A síntese do projeto para a entrega está em [Entrega acadêmica](entrega-academica.md). Publicação, validação do Cloudinary real, definição do proxy, conferência de cookies nos domínios efetivos e aprovação dos documentos legais continuam pendentes.
