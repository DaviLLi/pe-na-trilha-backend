# Diagnóstico TEMPORÁRIO de resposta 403 do Cloudinary

Remover após identificar a causa. Desligado por padrão. Sem alteração de credenciais,
assinatura, preset, tipo authenticated, agent, proxy, TLS ou resposta pública 502.

## Um teste real, executado manualmente

1. Prepare o [ambiente isolado de homologação](ambientes.md). Na pasta do backend,
   inicie a instância de homologação com o diagnóstico ativado:

   ```bash
   CLOUDINARY_DIAGNOSTICO_403=1 npm run start:homologation
   ```

   A variável é apenas um opt-in de diagnóstico; não é credencial. Não precisa ser
   adicionada ao .env. Evite manter outra instância na mesma porta.
2. Na interface de homologação, use uma publicação sintética pendente ou rejeitada
   e envie **uma** imagem sintética válida. Desative seleção múltipla e retentativa
   automática nesse teste.
3. Se a resposta remota for 403, procurar no terminal:
   `[TEMP Cloudinary 403 — remover após diagnóstico]`.
   O log pode aparecer depois do 502, quando o corpo remoto terminar de chegar.
4. Encerrar essa instância e reiniciar normalmente, sem a variável.

A captura atende somente à primeira tentativa authenticated por processo, mesmo
se ela retornar outro status. Novo restart/watch reload renova essa cota. Outros
uploads simultâneos não recebem observação. Esta limitação é local a cada processo.
O upload real é uma operação normal e pode criar um asset se for aceito; não repetir
cegamente uma operação de resultado incerto. Nenhum teste real foi feito na implementação.

## Conteúdo capturado

- Status 403 e somente o header de resposta X-Cld-Error, quando disponível.
- Corpo textual original sanitizado: em JSON, somente error.message/error textual
  ou message; os demais campos são omitidos. Em HTML, retira scripts, formulários,
  estilos e atributos. Texto simples passa pela mesma sanitização.
- Credenciais configuradas, tokens, assinaturas, URLs e identificadores sensíveis
  passam pelo sanitizador compartilhado; controles de log são removidos.
- Até 8 KiB de corpo em memória. Ao exceder, descarta inclusive o prefixo capturado.
  Cada texto registrado tem até 256 caracteres; o log é um objeto pequeno com
  campos fixos. Não loga corpo binário, multipart, comprimido, JSON inválido,
  resposta incompleta ou eco de multipart identificado em resposta textual.
- Nunca inspeciona ou registra request, arquivos, buffer de upload, multipart,
  credenciais de autenticação ou headers diferentes do permitido.

`corpoEstado` explica ausência/omissão. Mensagens sanitizadas podem perder detalhes;
conteúdo omitido nunca é substituído por logging bruto.

## Técnica e remoção

O módulo envolve apenas a criação síncrona do request pelo upload_stream do SDK
2.11.0. A referência https.request é restaurada em finally, antes de stream.end
receber a imagem. Não há alteração persistente de node_modules nem de transporte.
O callback do SDK continua recebendo a mesma resposta imediatamente. Em 403, o
observador drena a resposta descartada pelo SDK, retendo apenas conteúdo limitado;
não aguarda o diagnóstico para rejeitar o upload. Falha do logger não muda o resultado.

Para remover: retirar o import e o invólucro temporário de cloudinaryService.js,
apagar diagnosticoUpload403Temporario.js e seu teste específico e remover este guia.
Preservar o diagnóstico sanitizado convencional já existente. Não modificar o
controller, as opções de upload ou as regras de segurança.
