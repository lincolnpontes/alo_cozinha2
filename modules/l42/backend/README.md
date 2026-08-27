# Supabase — v2.17

O projeto `sxbcjzshcjxzladwptiu` fornece autenticação, sincronização e a
fundação comercial do Alô Etiqueta. As alterações do banco ficam versionadas
em [`migrations`](migrations).

## Conta e sincronização

- O usuário cria a primeira conta no próprio aplicativo com nome, e-mail e
  senha.
- Cadastro e redefinição exigem a senha duas vezes e permitem revelar ou
  ocultar o texto digitado.
- A recuperação envia um e-mail que retorna ao APK pelo endereço
  `aloetiqueta://auth/callback`.
- A mesma conta pode entrar em vários celulares.
- Produtos, categorias, configurações, histórico, estoque e operadores são
  sincronizados por conta.
- O PIN do operador é sincronizado somente como verificador PBKDF2-SHA256 com
  salt individual. O PIN legível não é enviado nem armazenado na nuvem.
- Alterações usam revisão otimista: um aparelho não sobrescreve silenciosamente
  uma versão mais nova de outro aparelho.
- Em conflito, o aplicativo guarda uma cópia local e permite escolher entre os
  dados do aparelho e os dados da nuvem.
- Endereço e porta da impressora continuam exclusivos de cada aparelho.

## Segurança

- Schema `api` como única superfície da Data API.
- Schemas privados `billing_private` e `audit_private`.
- RLS forçada, permissões explícitas e isolamento por `auth.uid()`.
- Nenhum acesso anônimo aos dados do aplicativo.
- A chave publicável pode estar no APK; chaves `sb_secret_...` e
  `service_role` nunca entram no APK, Git ou logs.

## Fundação comercial

- Tabelas de perfil, produtos, modelos, gerações, uso diário, planos,
  assinaturas, benefícios, eventos de cobrança e auditoria.
- Funções atômicas `create_product`, `set_product_archived` e
  `generate_labels`.
- Plano Gratuito com 10 produtos ativos e 3 unidades finais por dia.
- Premium preparado para planos mensal e anual.
- Horário da cota calculado no servidor em `America/Fortaleza`.
- Chaves de idempotência para repetição segura após falha de internet.

O projeto permanece no plano gratuito e não há cobrança automática configurada.
Google Play Billing e login com Google dependem de credenciais e cadastros
externos da conta Google; esses segredos não são inventados nem gravados no
repositório.

Para os links de confirmação e recuperação voltarem ao APK, inclua
`aloetiqueta://auth/callback` em **Authentication → URL Configuration →
Redirect URLs**. O botão Google só é exibido quando o provedor estiver
realmente habilitado em **Authentication → Providers**.
