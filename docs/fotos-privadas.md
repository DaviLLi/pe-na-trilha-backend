# Fotos privadas de publicações

## Armazenamento e compatibilidade

Novas fotos de publicações usam `resource_type: image`, `type: authenticated` e
`overwrite: false`. O servidor valida a resposta de upload antes de marcar o asset
como `ready`: identidade, tipo, versão, formato, dimensões e tamanho. Originais e
transformações ficam protegidos no Cloudinary. Identificadores aleatórios evitam
colisões; autorização não depende de sua imprevisibilidade.

Fotos de perfil mantêm seu upload público, respostas e endpoints anteriores. O
serviço compartilhado só usa `authenticated` quando solicitado explicitamente pelo
controller de publicações. Nenhum asset existente foi modificado ou migrado.

Cada foto de publicação armazena `assetId`, `publicId`, `resourceType`, `deliveryType`,
`version`, `format`, `width`, `height`, `bytes` e `storageState`, além de ID e datas.
A antiga propriedade `url` permanece apenas para leitura compatível no schema,
sem ser selecionada por padrão ou exposta na serialização. Não recebe novos uploads.

Estados de armazenamento:

- `ready`: resposta de upload autenticado validada; entrega ainda exige todos os metadados.
- `legacy_public`: formato antigo ou proteção não comprovada; entrega bloqueada.
- `migration_pending`: reservado para migração aprovada; entrega bloqueada.
- `blocked`: entrega bloqueada.

O default de fotos antigas é `legacy_public`, nunca `ready`. O estado de aprovação
continua na publicação, sem duplicar a autorização em cada foto.

**Bloquear a entrega no backend não revoga URLs públicas antigas do Cloudinary.**
Esses assets continuam exigindo inventário, migração e invalidação aprovados
separadamente. Fotos legadas retornam `url: null`, inclusive nas aprovadas.

## Endpoints de bytes

| GET / HEAD | Autorização |
| --- | --- |
| `/trilhas/:id/fotos/:fotoId/conteudo` | Publicação `approved`, sem exigir login |
| `/trilhas/minhas/:id/fotos/:fotoId/conteudo` | Autor autenticado; estado pending, rejected ou approved |
| `/admin/trilhas/:id/fotos/:fotoId/conteudo` | Administrador autenticado; estado pending, rejected ou approved |

Todos verificam associação da foto à publicação e armazenamento protegido completo.
Fotos ausentes, removidas, de terceiros ou sem proteção comprovada retornam 404.
Autenticação ausente/inválida retorna 401; usuário comum no endpoint administrativo
recebe 403. IDs inválidos ou variante inválida retornam 400.

Variantes: `?variante=miniatura` (até 480×360) e `?variante=detalhe` (até 1600×1600,
padrão quando o parâmetro está ausente). `?variante=` e parâmetros `variante`
duplicados são rejeitados com 400, inclusive duplicatas com valores iguais.
A imagem é entregue como WebP, com qualidade automática e remoção de
perfil de metadados da variante. Não aceita URLs externas, transformações livres,
intervalos de bytes ou parâmetros extras. `Range` não é encaminhado ao provedor;
a resposta é integral. HEAD autoriza igualmente, mas não baixa a imagem.

O backend gera internamente uma URL assinada para o asset autenticado e transmite
os bytes por HTTPS. Só aceita o host `res.cloudinary.com`, não segue redirects e
não encaminha cookies, Authorization ou headers do provedor. Nenhum endpoint retorna
assinaturas, credenciais ou URLs do Cloudinary. A assinatura interna de entrega
não tem expiração temporal garantida e nunca deve ser disponibilizada ao cliente.

Respostas usam `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, CSP restritiva e `Vary: Origin, Cookie, Authorization`.
Não há cache de imagem no backend ou redirecionamento. Isso também vale para a
entrega pública nesta primeira versão.

Limites por processo: 20 operações de entrega simultâneas (incluindo a consulta da
publicação), 30 segundos por operação e 8 MiB por resposta, conferidos pelo
Content-Length quando presente e pelos bytes reais. A vaga, o timer e os listeners
são instalados na entrada do handler de entrega, antes da consulta ao MongoDB;
os middlewares de autenticação e papel continuam anteriores ao handler.
Transferências respeitam backpressure; desconexão e timeout abortam a requisição
remota. Excesso de concorrência retorna 503 com Retry-After. Falha remota antes da
transmissão retorna 502, indisponibilidade de configuração 503 e timeout 504.
Após início da transmissão, falhas encerram a conexão; não se acrescenta JSON a uma
imagem parcial. Detalhes do erro remoto não são enviados nem registrados.

A autorização é verificada no início de cada entrega. Bytes já recebidos ou uma
cópia salva pelo usuário não podem ser revogados. O custo de banda e a concorrência
devem ser acompanhados na hospedagem; o limite é por processo, não distribuído.

## Respostas JSON e React

Consultas públicas retornam URLs internas públicas; consultas próprias e upload
retornam URLs de autor; fila e decisões administrativas retornam URLs de moderação.
A serialização de fotos usa uma lista explícita de propriedades:

```json
{
  "_id": "fotoId",
  "url": "/trilhas/minhas/publicacaoId/fotos/fotoId/conteudo",
  "width": 800,
  "height": 600,
  "storageState": "ready",
  "createdAt": "...",
  "updatedAt": "..."
}
```

`url` é relativa à origem da API, não à origem do site React. O frontend precisa
resolvê-la usando sua configuração de API. Não há renovação de URL de imagem:
endpoints são estáveis e cada acesso privado revalida a autenticação.

No Feed, usar o endpoint público em img, com lazy loading e variante miniatura.
No perfil e na moderação, usar o cliente HTTP autenticado com `responseType: blob`
e `withCredentials`, reaproveitando o fluxo existente de refresh após 401. Converter
o Blob em object URL para exibição e chamar `URL.revokeObjectURL` ao trocar a foto,
desmontar o componente ou sair da conta. Cancelar requisições ao desmontar. Não salvar
imagens privadas em localStorage, service worker ou cache offline. Tratar 404 como
foto indisponível e 502/503/504 como falha temporária, com retry limitado.

A implementação React não integra esta alteração de backend.

## Upload, exclusão e recuperação

A intenção persistida de upload inclui tipo e recurso antes da chamada externa.
Associação da foto e conclusão da operação continuam transacionais, com leases e
heartbeat. Perda de propriedade/status editável, falha de associação ou interrupção
resultam em limpeza pendente imediata ou recuperação após expiração do lease.
Substituição mantém o ID da foto e agenda o asset anterior na mesma transação;
remoção e exclusão da publicação também persistem a identidade do asset a limpar.

Operações de limpeza registram `resourceType` e `deliveryType`. O worker exclui no
tipo correto, com invalidação, leases e retentativas. Operações antigas sem tipo
continuam usando `image/upload`, preservando a limpeza de perfis. Falhas permanecem
registradas para reenvio. A infraestrutura opt-in de integração também preserva o
tipo no registro autorizado de assets de teste.

Aprovação não move nem publica assets no Cloudinary: libera apenas o endpoint
público. Edição de fotos de aprovadas continua bloqueada, inclusive dentro das
transações para impedir associação após aprovação concorrente.

## Validação e implantação

Testes locais usam mocks de MongoDB, Cloudinary e HTTPS: não criam, alteram ou apagam
assets reais. Cobrem autorização, serialização, upload autenticado, compatibilidade
de perfil, limpeza, limites, timeout, desconexão e falhas durante streaming.

A disponibilidade efetiva no plano da conta Cloudinary e o bloqueio de acesso direto
a originais/derivados precisam de validação isolada autorizada antes de produção.
Essa validação não foi executada, tampouco migrações ou alterações em configurações
da conta. Não iniciar a API com credenciais reais para validar esta mudança: o worker
existente processa operações de limpeza pendentes ao iniciar.

## DTO público e histórico de moderação

`GET /trilhas` e `GET /trilhas/:id` usam uma lista explícita de campos públicos:
ID, título, descrição, endereço, dez características, duração, ID do proprietário,
status, datas e fotos serializadas. Não retornam `historicoModeracao`,
`motivoRejeicao`, IDs de moderadores, versão interna do documento ou propriedades
internas adicionais. Duração expõe apenas horas/minutos; proprietário expõe somente
seu ID, mesmo se o documento estiver populado.

Consultas autorizadas do proprietário e administrativas preservam motivo e histórico.
Os metadados de armazenamento das fotos continuam ocultos em todos os contextos.
A filtragem é feita somente na resposta; nenhum registro persistido é modificado.

## Sessão obrigatória para autenticação

Cookies de acesso e tokens Bearer exigem JWT com `sub`, `iat`, `exp` e `sid` válidos.
O middleware consulta `AuthSession` em cada acesso protegido, verificando ID da sessão,
usuário correspondente, ausência de revogação e expiração posterior ao horário atual.
JWT legado sem `sid` retorna 401; não há exceção para fotos nem outras rotas protegidas.
O usuário precisa efetuar login novamente se não possuir refresh válido.

Login e refresh já emitem access tokens com `sid`; a rotação do refresh permanece
inalterada. Logout/replay revogam a sessão no banco e impedem novas consultas com
access tokens ainda não expirados. Isso não retira bytes de uma transferência já
autorizada ou imagens anteriormente recebidas. O cookie de acesso tem prioridade
sobre Bearer; se estiver inválido, não há fallback para o cabeçalho. Cookies inválidos
são limpos. Erro de consulta ao banco falha sem autorizar acesso.


## Cancelamento durante a consulta da publicação

A admissão é síncrona: a 21ª operação recebe 503 e não consulta a publicação no
MongoDB. O limite de 20 é compartilhado entre os handlers públicos, de autor e de
administrador no mesmo processo, incluindo HEAD. Requisições já desconectadas não
iniciam consulta. Eventos `aborted` da requisição e `close` da resposta abortam o
mesmo AbortController usado nas etapas posteriores.

A consulta Mongoose recebe `signal`, `maxTimeMS` e `timeoutMS` com o orçamento
restante dos 30 segundos. O driver instalado suporta AbortSignal; maxTimeMS limita
execução no servidor e timeoutMS limita a operação no driver. Cancelar uma operação
pode fechar a conexão usada pelo driver. A liberação remota é cooperativa e não
constitui garantia de interrupção instantânea no servidor.

Uma espera cancelável permite encerrar o handler mesmo durante etapas locais que
não observem o signal imediatamente, como buffering do Mongoose. Um resultado
posterior é descartado e uma rejeição posterior é consumida, sem iniciar Cloudinary.
A fila local do Mongoose pode permanecer até seu próprio timeout ou até o driver
observar o sinal; não se altera a configuração global de conexão nesta correção.

Timeout durante a consulta retorna 504. Erros comuns de MongoDB continuam no
tratamento centralizado. Ao sair do handler por qualquer caminho, um finally
remove timer e listeners e devolve exatamente uma vaga. Timeout e desconexão
também cancelam a busca HTTPS e o stream, conforme a fase em andamento.

## Capacidade do worker de limpeza

O worker agora mantém três faixas concorrentes e até 30 reivindicações por ciclo,
com intervalo de 15 segundos. Uma faixa livre busca outra operação imediatamente,
sem esperar pelas exclusões mais lentas das outras faixas. Ciclos do mesmo processo
não se sobrepõem. Ao constatar fila vazia, o lote encerra; podem existir até três
consultas já iniciadas. Erro inesperado de banco encerra a faixa afetada para evitar
consultas repetidas sem limite.

O teto teórico com fila disponível e operações rápidas passa de quatro para até
120 reivindicações por minuto por processo. Não é garantia de throughput: latência,
backoff, ciclos longos e indisponibilidade reduzem essa capacidade. Até três chamadas
remotas ficam ativas por instância; com N instâncias o teto agregado é 3×N. Monitorar
backlog, idade das operações, failed e quotas antes de ampliar o número de instâncias.

A seleção é atômica por `cleanup_pending` e `nextAttemptAt`, ordenada pelo agendamento,
e atribui um token exclusivo e lease de três minutos. O índice existente
`{ estado: 1, nextAttemptAt: 1 }` atende essa seleção; não há alteração de schema ou
migração de índices nesta etapa. O modelo já mantém identidade completa, tentativas,
histórico e estado failed, sem TTL para falhas definitivas.

Antes da exclusão, o worker renova e revalida a posse do lease. Durante a chamada,
renova a cada 30 segundos, sem acumular renovações periódicas concorrentes. A
exclusão remota tem timeout explícito de 120 segundos e utiliza publicId, resourceType
e deliveryType. Conclusão e registro de falha exigem o token atual. Perda do lease
ou falha de sua renovação impedem confirmação pelo worker antigo; a operação fica
recuperável após expiração. Outro worker só reivindica novamente depois da recuperação
para cleanup_pending. Leases válidos impedem reivindicações simultâneas do mesmo
registro.

Não há transação distribuída com Cloudinary: uma queda após exclusão remota e antes
da confirmação no MongoDB pode causar repetição. Exclusão é idempotente e aceita
`not found`. Em falhas de rede extremas não se promete exactly-once na chamada
externa; o token impede que um worker antigo sobrescreva o estado do novo proprietário.

Falhas remotas retornam a cleanup_pending com backoff exponencial já existente; a
oitava tentativa falha gera failed, sem concluir nem apagar a operação. O histórico
limitado às últimas 20 entradas e ultimoErro permanecem disponíveis; erros remotos
não são gravados integralmente. A função interna reenfileirarOperacaoImagem permite
reenvio operacional controlado de failed, sem apagar seu histórico.

Ao parar, o worker remove o timer e deixa de reivindicar novas operações, aguardando
as já iniciadas e seus heartbeats. Uma reivindicação em andamento pode terminar
após o pedido de parada e será finalizada normalmente. Interrupção forçada deixa
processing/uploading recuperáveis pelos respectivos leases; não apaga registros.
Os testes desta mudança usam apenas serviços simulados. Não iniciar o servidor
com credenciais reais para testar a fila sem autorização operacional.


## Falhas antes e depois do início da imagem

O pipeline escreve por um destino intermediário que respeita backpressure, sem
incluir a resposta HTTP na destruição automática dos streams. Assim, falhas de
origem ou excesso de tamanho antes do primeiro byte retornam 502 com JSON genérico,
sem headers de imagem. Timeout antes da transmissão preserva 504 e configuração
indisponível preserva 503. Não se repassam mensagens, headers ou URLs do provedor.

Depois do primeiro byte (ou se os headers já tiverem sido enviados), falha ou
timeout encerra a conexão; nunca se tenta enviar JSON ou alterar o status HTTP.
Desconexão do cliente cancela os streams sem uma nova resposta. O destino limpa
esperas de drain ao encerrar, inclusive se o upstream falhar enquanto o cliente
estiver lento. Respostas com sucesso continuam sendo transmitidas sem buffering
integral da imagem, com os limites de tamanho, tempo e concorrência anteriores.
