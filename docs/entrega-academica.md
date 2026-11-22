# Síntese técnica para a entrega acadêmica

O Pé na Trilha é uma aplicação web para cadastro, consulta e moderação de publicações sobre trilhas. O frontend usa React e Vite. O backend usa Express, MongoDB via Mongoose e Cloudinary para as imagens. A entrega prevista usa Vercel e Render.

## Regras implementadas

| Área | Regra aplicada pelo backend |
|---|---|
| Cadastro e sessão | O cadastro valida dados, registra a versão vigente dos termos aceitos, a versão da política apresentada e a data do servidor. O perfil inicial é `user`. As contas antigas continuam utilizáveis. A sessão por cookie tem proteção CSRF nas operações de escrita pertinentes. |
| Login | O MongoDB reserva tentativas atomicamente por origem e identificador normalizado. A janela é temporária e a resposta de credenciais inválidas é genérica. |
| Publicações | O autor controla a edição e a exclusão, conforme o estado da publicação. A consulta pública retorna publicações aprovadas. |
| Moderação | Um administrador só decide sobre uma publicação pendente com a revisão consultada. Uma atualização atômica garante uma única decisão concorrente. O proprietário continua sendo a autoridade para editar o conteúdo. |
| Administração | O administrador principal gerencia o perfil de outras contas com confirmação da identidade. O backend distingue essa permissão da função de moderador. |
| Fotos | A associação de metadados e as operações de limpeza usam transações MongoDB. Um processador recupera operações pendentes e protege fotos que ainda estejam referenciadas. |

## Método de validação

A validação combina testes de unidade, rotas HTTP com Supertest, integração em um replica set MongoDB descartável e testes de frontend no Chromium com uma API sintética. O build do frontend usa uma URL de API fictícia. Os testes de recuperação de imagens usam um provedor simulado ou mocks. O resultado local e as limitações estão no [relatório de remediação](remediacao-seguranca.md).

A publicação ainda está pendente. A remoção pública do histórico requer autorização e pode envolver o GitHub. A comprovação do fluxo com Cloudinary real, os testes após configuração dos domínios e o fechamento dos textos legais fazem parte da preparação de entrada em produção.
