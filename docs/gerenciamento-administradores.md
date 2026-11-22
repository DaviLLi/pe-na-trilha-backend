# Gerenciamento de administradores

## Hierarquia

O administrador principal é a conta com perfil `admin` cujo ObjectId está no documento `provisionamentoAdministrativo/primeiro-admin`. O [provisionamento inicial](primeiro-administrador.md) grava esse vínculo. Os comandos e as rotas mantêm a conta principal e o marcador intactos. Um marcador ausente ou inválido bloqueia o gerenciamento.

Os administradores comuns continuam moderando publicações com as mesmas permissões. Toda mudança de perfil exige que o principal permaneça ativo. Ele também pode moderar, por isso é seguro remover o último administrador comum.

## API

| Método e caminho | Uso |
| --- | --- |
| `GET /admin/administradores` | Lista administradores com `_id`, `nomeCompleto`, `email` e o indicador `principal`. |
| `POST /admin/administradores/promover` | Promove uma conta `user` existente. |
| `POST /admin/administradores/remover` | Rebaixa uma conta `admin` adicional. |

As três rotas usam a sessão existente por cookie HttpOnly. Os POSTs também exigem `X-CSRF-Token` e JSON com os campos `email` do alvo e `senha` atual do operador. O backend compara a senha com bcrypt na própria requisição. Cada confirmação autoriza apenas essa operação. O sucesso de um POST retorna HTTP 204. Falhas de identidade ou de permissão retornam 403. Quando o limite é atingido, o retorno é 429.

Para integrar o frontend, faça as chamadas por HTTPS com `withCredentials: true`. Use o GET para identificar se a sessão pode abrir os controles. Para cada mudança, solicite novamente a senha, envie-a somente no corpo do POST e descarte-a após o uso. Exiba as respostas de conflito e limitação no formulário.

## Terminal

Execute na raiz do backend, selecionando explicitamente o ambiente. `--banco` deve corresponder ao banco da URI configurada.

```bash
NODE_ENV=development npm run admin:promover -- --banco pe_na_trilha
NODE_ENV=development npm run admin:remover -- --banco pe_na_trilha
```

Informe o e-mail da conta alvo, confira a identificação e digite a frase apresentada. Em seguida, informe o e-mail e a senha atual da sua conta operadora. A senha é lida sem eco. O comando `admin:provisionar` continua dedicado ao primeiro administrador.

## Limite e auditoria

As confirmações válidas para comparação têm orçamento compartilhado de cinco por janela de 15 minutos por principal, inclusive entre CLI e API e entre instâncias. A reserva atômica em `confirmacoesAdministrativas` usa o relógio do MongoDB. O orçamento inclui comparações que tiveram sucesso e que falharam. O documento guarda apenas o ID do principal, a contagem e a expiração.

Alterar o perfil exige MongoDB com transações. O serviço revalida o marcador e a credencial na transação, atualiza somente `perfil` e insere em `auditoriaAdministrativa` os IDs do ator e alvo, a ação e a data. Uma falha na auditoria cancela a alteração.
