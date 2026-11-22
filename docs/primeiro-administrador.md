# Primeiro administrador e validação de moderação

## O que já protege a área

O cadastro público normaliza o corpo e força `perfil: user`, mesmo que o cliente
mande admin. PATCH de conta permite somente os campos de perfil aprovados e rejeita
perfil/senha/campos extras. O login valida senha e cria sessão revogável; o middleware
reconsulta o papel no MongoDB em cada acesso autenticado, sem confiar em papel do
corpo do request ou de um token antigo.

GET /trilhas/pendentes, POST /trilhas/:id/moderacao e fotos administrativas exigem
admin no servidor. Mutações por cookies continuam exigindo CSRF. O frontend Admin
não monta a fila para perfil user; a navegação mostra Administração somente para
admin. O [gerenciamento de administradores](gerenciamento-administradores.md) tem rotas exclusivas do principal.

## Provisionamento operacional (não executado nesta implementação)

O comando promove uma conta existente controlada pelo operador. Não cria senha,
usuário padrão ou administrador automático. Exige acesso ao terminal e às credenciais
MongoDB do backend: esse acesso deve ficar restrito aos operadores autorizados.

1. Cadastre normalmente a conta que será administradora e confirme o acesso com
   login. Confirme a titularidade e o e-mail da conta; não é necessário consultar seu ID.
2. Na pasta do backend, confira a conexão/cluster e o banco pretendido. O comando
   usa o carregador existente: development → .env/MONGO_URI_DEVELOPMENT;
   production → .env.production/MONGO_URI_PRODUCTION. Variáveis herdadas prevalecem.
3. Para o ambiente local já configurado com banco explícito pe_na_trilha:

   ```bash
   NODE_ENV=development npm run admin:provisionar -- --banco pe_na_trilha
   ```

   Não execute production nesta etapa sem autorização operacional separada.
4. Informe somente o e-mail no terminal interativo. Digite exatamente a confirmação
   apresentada, incluindo ambiente e banco. Sem confirmação não há conexão.
5. Saia e entre novamente no frontend para atualizar a conta em memória, e abra
   Administração no menu ou /admin.

O argumento --banco deve corresponder ao banco explícito da URI; ausência de banco,
divergência ou opção dbName na query interrompem o comando. O cluster continua sendo
o configurado no ambiente; o argumento de banco não verifica identidade do cluster.
Não passa senha por argumentos, não imprime URI e não aceita execução por pipe/CI.

O e-mail é normalizado da mesma forma que no cadastro. A consulta MongoDB ocorre
na transação e lê somente `_id` e `perfil`, com limite de duas contas. O ID usado
na promoção e no marcador é obtido internamente; não é solicitado ao operador.
Nenhuma conta encontrada ou mais de uma com o mesmo e-mail interrompe a operação.
A checagem de ambiguidade não presume que o índice único esteja ativo em dados
legados. Ela não comprova titularidade: o operador continua responsável por promover
apenas uma conta sob seu controle.

A promoção e um marcador único `_id: primeiro-admin` na coleção
`provisionamentoAdministrativo` usam a mesma transação. O marcador impede duas
inicializações concorrentes e impede reutilização após remoção/rebaixamento do
primeiro administrador. A operação também recusa se já houver qualquer admin.
Falha ou usuário não encontrado desfazem ambos. Exige MongoDB com suporte a transações
(Atlas/replica set); não há fallback sem transação. O marcador guarda ID e data do
provisionamento, sem senha. Para administrar contas adicionais, consulte o
[gerenciamento de administradores](gerenciamento-administradores.md).

## Aprovação e rejeição manual

1. Entre como user e crie duas publicações: devem ficar pending, fora do Feed.
2. Entre como admin. A fila GET /trilhas/pendentes deve trazer essas publicações e
   suas fotos privadas pela entrega /admin/trilhas/:id/fotos/:fotoId/conteudo.
3. Aprove uma: o cliente envia `{ "status": "approved" }` a
   POST /trilhas/:id/moderacao; após sucesso, o cartão sai da fila e aparece no Feed.
4. Na outra, tente rejeitar sem motivo ou só com espaços: não deve enviar decisão.
   Informe um motivo (até 2000 caracteres) e rejeite: envia status rejected e motivo;
   após sucesso sai da fila, não entra no Feed e o proprietário pode consultar o motivo.
5. Como user, acessar /admin não deve consultar a fila. Chamar diretamente os
   endpoints administrativos com essa sessão deve retornar 403; sem sessão, 401.
6. Decidir novamente uma publicação já decidida deve retornar 409. Erros não devem
   remover cartões nem mostrar sucesso. O histórico é mantido pelo backend.

As mudanças não ampliam edição/exclusão de terceiros por administradores. O fluxo
de correção/reenvio do proprietário permanece separado da decisão administrativa.

## Verificações e limites

Testes de provisionamento usam dependências simuladas e não promovem conta real.
Testes de rotas cobrem cadastro sem elevação de privilégio, autenticação, negação de
user, aprovação/rejeição, motivo obrigatório, histórico e conflitos. O frontend tem
suite de navegador com API sintética para fila, fotos, autorização, motivo e erros.
Integração com MongoDB/Cloudinary reais e validação operacional de uma conta admin
continuam uma etapa manual autorizada; não se fazem deploy ou provisionamento real
na execução de testes. Retirar o opt-in de diagnóstico Cloudinary após seu uso;
a instrumentação temporária não foi alterada nesta tarefa.
