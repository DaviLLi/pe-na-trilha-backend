# Inventário offline de fotos — critérios 3

O mecanismo permanece exclusivamente offline. Não importa clientes MongoDB,
Cloudinary, API, dotenv ou workers, nem implementa conexão externa, escrita em
banco, upload, exclusão, criação de índices ou migração.

## Execução e segurança

Requer o Node do projeto e uma chave local de pseudonimização de pelo menos 32
bytes em PHOTO_INVENTORY_PSEUDONYM_KEY. Essa chave não é credencial de serviço,
não entra no relatório e deve ser preservada para comparar execuções.

```bash
node tools/photo-inventory/cli.js --fixture tests/photo-inventory/fixtures/catalog.json --format text
node tools/photo-inventory/cli.js --fixture tests/photo-inventory/fixtures/catalog.json --format json
```

A CLI escreve somente em stdout. Saídas: 0 completo, 2 parcial, 1 bloqueado/erro.
Não cria arquivos de relatório. Opções são validadas por propriedade própria;
constructor, toString, __proto__, demais opções desconhecidas, flags de escrita e
modos externos são recusados. Não existe flag que habilite serviços reais.

Somente JSON de até 2 MiB no diretório tests/photo-inventory/fixtures é permitido,
com caminho validado após resolver symlinks. O fixture precisa declarar synthetic
true, schemaVersion "1" e arrays publications/users/operations/assets. Isso é uma
convenção de teste: não coloque dados reais nesse diretório. Variáveis de conexão
MongoDB/Cloudinary são ignoradas. Os leitores isolados recusam connect e write.

## Extração e rastreabilidade

Campos mantêm presença, tipo e valor original na extração em memória, sem defaults
Mongoose. Cada foto possui original com a representação integral em memória, mesmo
se for null, string, número, booleano ou array inválido. O relatório originalPhoto
expõe tipo e representação sanitizada/fingerprint, sem o conteúdo sensível.

O relatório também lista todas as publicações, inclusive sem fotos e malformadas.
Erros globais usam código fixo, referência HMAC ao registro de publicação e posição
na entrada. Assim INVALID_PHOTO_ARRAY e INVALID_PUBLICATION podem ser localizados
sem imprimir URLs, credenciais, nomes ou mensagens de exceção. Erros de fonte não
associáveis à publicação usam referências/posição null.

IDs repetidos de publicação, foto na mesma publicação e foto entre publicações são
motivos distintos. Todos os itens afetados perdem stableIdentity. IDs ausentes,
nulos ou não hexadecimais de 24 caracteres exigem revisão. itemKey tem HMAC e sufixo
de ocorrência; fotos sem identidade válida dependem de posição/conteúdo e não
prometem estabilidade após reordenação. recordRef permite distinguir registros
com o mesmo ID persistido. Nenhum ID ou campo original é modificado.

## Resolução e correlação

Primeiro, todas as referências de fotos, perfis e operações são resolvidas no
catálogo sintético. Lookup usa assetId válido ou publicId exato, respeitando tipo e
recurso quando declarados. publicId isolado só é resolvido se o catálogo comprovar
uma identidade única. Identidades compostas precisam de publicId não vazio,
resourceType image e deliveryType conhecido. Ausência nunca equivale a identidade.

Identificadores fornecidos e divergentes resultam em identity_conflict; não há
fallback de um assetId divergente para um publicId que encontrou outro registro.
Catálogo com identidades malformadas é invalid_catalog e não comprova proteção.
Duplicidades de assetId ou identidade composta produzem ambiguous.

Só resoluções found participam dos componentes confirmados. Os aliases locais
completos e os aliases confirmados pelo catálogo permitem reconhecer assetId de
uma referência e publicId de outra, inclusive conflitos transitivos com perfis e
operações. correlationEvidence registra tipo/referência das entidades, identidade
confirmada e aliases separados por origem; identityEvidence identifica estratégia
assetId/compound e origem local/synthetic_catalog da foto. Divergências de lookup
têm conflictEvidence separado por estratégia, com referências HMAC aos candidatos
conflitantes, sem imprimir identificadores remotos.

Referências incompletas não resolvidas nunca unem componentes. Coincidências
conservadoras de publicId ou URL idêntica com uma referência não resolvida geram
UNPROVEN_REFERENCE e revisão. URLs jamais são buscadas. Nomes parecidos não são
correspondências. Perfis nunca viram itens candidatos à migração.

## Classificação

Proteção: unverified, verified_authenticated, public_upload, private_type.
Integridade: complete, incomplete, inconsistent.
Referências: unique, shared_publications, profile_conflict, ambiguous.
Elegibilidade: already_protected, migration_candidate, manual_review, blocked.

verified_authenticated exige metadados sintéticos completos e sem divergência.
already_protected exige ainda metadados locais completos, ready compatível,
proprietário existente, status persistido válido, IDs estáveis, nenhum conflito e
legacyPublicOrigin.state igual a none_found. Isso não comprova revogação de origem.
migration_candidate exige origem pública confirmada, metadados remotos completos,
legacy_public compatível e ausência de bloqueios; campos locais ausentes podem
ser preenchidos futuramente após revisão. Nenhuma classificação autoriza migrar.

storageState ausente, null, string desconhecida ou tipo inválido têm motivos
específicos e nunca mantêm candidatura. ready só é compatível com authenticated e
metadados locais completos; legacy_public não é compatível com tipo autenticado
ou private confirmado/declarado. blocked e migration_pending bloqueiam automação.
São usados somente os estados já existentes no projeto.

Compartilhamento, IDs duplicados, proprietário/status inválidos, ambiguidade,
falhas ou operações desconhecidas exigem revisão. Perfil conflitante, operação
pendente e estado bloqueado geram blocked. private é distinguido de authenticated
e não é candidato automático. Estado de aprovação da publicação nunca é alterado.

## Relatórios, schema e validação semântica

Versões: mecanismo 1.2.0-offline, schema do relatório 3, critérios 3. O formato do
fixture continua 1. Não trate relatórios antigos como compatíveis com o schema 3.

JSON detalhado e resumo incluem totais de publicações/fotos, assets confirmados,
distribuições por status/elegibilidade, conflitos, operações, erros e revisão.
Missing, null e invalid são categorias distintas de status persistido. sourceFields
e publicationFields preservam presença e tipo, com valores sensíveis substituídos
por HMAC. Só IDs hexadecimais de publicação/foto e metadados permitidos ficam claros.
Nenhum publicId, assetId, proprietário, URL completa ou token de lease é impresso.
O relatório não é um export integral nem um manifesto de migração executável.

A validação estrutural sem dependências suporta apenas as keywords utilizadas:
type, enum, required, properties, additionalProperties, items, minimum, pattern e
$ref local. Não resolve schemas externos; não é validador JSON Schema genérico.
Rejeita keywords não suportadas nos nós avaliados.

A validação semântica complementar confere datas ISO UTC válidas e sua ordem,
itemKeys/recordRefs únicos, formatos HMAC/IDs, presença coerente, associação à
publicação e status original, distinção das duplicidades, metadados/estados e
classificação recalculada a partir das evidências. Registros de publicação incluem a quantidade extraída para impedir que
itens removidos do relatório sejam ocultados apenas ajustando totais; erros de
cobertura são recompostos a partir das representações das publicações. Também confere componentes de
assets compartilhados, evidências de perfil/operações e recompõe todas as contagens
usando os registros detalhados, sem confiar no summary recebido.

Erros de extração, consultas sintéticas falhas, identidades remotas conflitantes,
catálogo inválido ou ambiguidade tornam a execução partial. Erros globais e de itens
precisam corresponder ao estado complete/partial. Totais parciais contam somente
referências extraíveis; não estimam o número de fotos de um array malformado.

Essa validação garante consistência interna, não autenticidade criptográfica ou
veracidade de um catálogo externo. Um relatório inteiramente fabricado com todas
as evidências alteradas não é detectável sem assinatura ou nova consulta à origem.

## Testes e limitações

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --coverage=false --cache=false tests/photo-inventory
node node_modules/eslint/bin/eslint.js --config tools/photo-inventory/eslint.config.mjs tools/photo-inventory/*.js tests/photo-inventory/*.test.js
```

As regressões reproduzem todos os achados da auditoria, incluindo identidades
complementares, conflito de perfil, operações, null===null, duplicidades de entidades,
estados inválidos, manipulação de relatórios, opções herdadas e representação de
fotos malformadas. Os testes existentes são preservados; expectativas do relatório
foram atualizadas para erros estruturados rastreáveis.

Com a mesma fixture, chave, relógio e runId o JSON é repetível. Não há checkpoints
ou retomada em disco. Dados permanecem em memória; a correlação não foi dimensionada
para acervos reais grandes. JSON não representa integralmente tipos BSON; Extended
JSON não é convertido silenciosamente. Colisões potenciais de URL não normalizadas
não comprovam identidade. A consulta real de metadados, bloqueio CDN e revogação de
URLs antigas continuam fora desta versão. Catálogo inválido é tratado de maneira
conservadora e pode bloquear referências não afetadas.

Consulta real futura exige nova aprovação, autorização explícita por execução,
credenciais de leitura, destinos permitidos, paginação, tratamento BSON e controles
de tempo/cancelamento. Nenhuma conexão ou migração foi implementada nesta correção.

## Origem pública antiga: evidência separada (critérios 3)

A proteção do asset atual continua em classification.protection. O novo objeto
legacyPublicOrigin não mistura a identidade da cópia autenticada com a identidade
pública antiga. Catálogo sintético e URLs locais são evidências distintas:

| Campo/estado | Significado |
| --- | --- |
| state: none_found | Nenhuma evidência nas referências analisadas; não é prova de ausência global. |
| state: suspected | URL Cloudinary de entrega image/upload, sem confirmação no catálogo. |
| state: confirmed | Catálogo sintético contém origem image/upload relacionada por publicId local, confirmado ou extraído da URL. Não comprova disponibilidade HTTP real. |
| state: unknown | Catálogo inválido/indisponível/ambíguo ou URL não interpretável sem outra confirmação. |
| state: revoked | Reservado: geração offline nunca produz e validação atual sempre rejeita. |
| revocation: not_proven | Único valor permitido nesta versão; nenhuma revogação é inventada. |
| urlEvidence | absent, public_upload ou unknown; URL nunca é acessada. |
| catalogState | checked, ambiguous ou unavailable, sempre referente a dados sintéticos. |
| publicAssetRefs / publicAssets | Identidades públicas HMAC, com publicIdRef, resourceType e deliveryType; não são unidas ao asset autenticado. |

O leitor também procura assets upload com o mesmo publicId do asset atual, mesmo
quando não há URL local. AssetIds distintos permanecem distintos. Uma referência
pública pode resultar de um publicId antigo extraído de URL, diferente do atual.
O parser cobre URLs simples Cloudinary image/upload com versão opcional e extensão;
transformações, domínios próprios e variantes não interpretadas exigem revisão.
Ausência no catálogo sintético nunca comprova que uma URL deixou de funcionar.

Authenticated com origem suspected, confirmed ou unknown recebe manual_review
(ou blocked se houver outro bloqueio), com LEGACY_PUBLIC_ORIGIN_<ESTADO>.
verified_authenticated continua possível: descreve somente o asset atual.
Publicações upload elegíveis continuam migration_candidate; confirmed descreve a
origem existente, não uma migração concluída. private nunca equivale a authenticated.

Exemplos: authenticated/ready sem URL nem origem pública conhecida permanece
already_protected. Com URL image/upload passa a suspected/manual_review. Com cópia
upload no catálogo passa a confirmed/manual_review, sem compartilhar componentes.
Nenhum desses resultados autoriza operações de migração.

O resumo JSON inclui byLegacyPublicOrigin e o resumo legível mostra a distribuição.
As identidades públicas são sanitizadas por HMAC; URLs completas e credenciais não
são incluídas. A validação recompõe o estado a partir das evidências, confere os
publicAssetRefs e vínculos de publicId, bloqueia revogação não comprovada e recalcula
a elegibilidade. Não autentica um catálogo nem um relatório inteiramente fabricado.

## Referências e posições vinculadas à extração

Cada publicação inclui photoRecords, um manifesto sanitizado da extração com
itemKey, photoPosition, originalPhoto e sourceFields. O validador exige posições
inteiras únicas de zero até extractedPhotos menos um e correspondência exata com o
manifesto, inclusive para fotos sem ID. Trocar só a posição ou o itemKey não muda
o registro original. Isso é consistência interna, não assinatura criptográfica.

Todas as referências photo de correlationEvidence devem coincidir exatamente com
os itens do componente confirmado. Existência, assetRef e aliases locais/remotos
são conferidos contra o item de origem; referência fantasma e associação a outro
asset são rejeitadas. Evidências dos componentes compartilhados continuam iguais.

## Abertura de fixtures e limite de TOCTOU

Após restringir o caminho canônico ao diretório autorizado, a configuração captura
dev, ino, size, mtimeMs e ctimeMs. A leitura abre com O_RDONLY, O_NOFOLLOW e
O_NONBLOCK; verifica arquivo regular, tamanho e identidade com fstat; lê apenas
pelo descritor, com limite de 2 MiB mais um byte de detecção; e repete fstat antes
de aceitar o JSON. O descritor é fechado inclusive em erros. Plataformas sem
O_NOFOLLOW falham de forma segura. Substituição do arquivo entre validação e
abertura é recusada; após abertura nunca se reabre o caminho para obter bytes.

Isso NÃO garante atomicamente a segurança de todos os diretórios pais. As APIs
Node utilizadas não fornecem openat2/RESOLVE_BENEATH. O diretório de fixtures e
seus ancestrais devem ser confiáveis e não modificáveis por processos não
confiáveis durante a execução. Timestamps/identidade também não são autenticação
de conteúdo contra um atacante com controle do filesystem. Symlinks já existentes
são resolvidos e só podem levar a arquivos dentro da raiz autorizada; a troca do
componente final por symlink após validação é recusada por O_NOFOLLOW.

Os testes de filesystem criam e removem exclusivamente diretórios temporários
sintéticos de sua própria execução, sem tocar fixtures existentes ou dados reais.
