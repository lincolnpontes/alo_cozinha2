# Arquitetura do Alô Cozinha

## Objetivo

O Alô Cozinha é um único produto com uma única instalação, uma única tela inicial e uma única configuração de nuvem. KDS, Checklist e Compras são módulos independentes dentro desse produto. Novos módulos, como o L42, devem entrar pelo mesmo contrato, sem acessar o código interno dos módulos existentes.

## Estrutura

```text
core/
  module-host.js       navegação e ciclo de vida dos módulos
  data-contracts.js    propriedade e namespaces dos dados
  api.js               transporte compartilhado com o backend atual
  catalog-sync.js      publicação confirmada de cadastros
  ui-dialog.js         diálogos consistentes do produto

modules/
  kds/                 pedidos, fila, áudio, armazenamento e sincronização KDS
  checklist/           atividades, POP, alarmes, relatórios e QR Code
  compras/             pedidos de compra, compras, operadores e fornecedores

index.html             composição da interface principal
service-worker.js      shell offline do produto
google-apps-script.gs  backend unificado atual
```

Cada módulo possui um `module.js` com identidade, tela, namespace, exigência de login e capacidades. `core/module-host.js` é o único responsável por mostrar ou ocultar módulos. Os aliases `tasks` e `feira` continuam aceitos para não quebrar chamadas antigas, mas os nomes canônicos são `checklist` e `compras`.

## Propriedade dos dados

| Domínio | Proprietário | Persistência atual | Namespace futuro |
| --- | --- | --- | --- |
| Restaurante, operadores, setores e segurança | Core | Adaptadores dos bancos atuais | `core_*` |
| Pedidos e alertas KDS | KDS | IndexedDB, fila local e Apps Script | `kds_*` |
| Atividades, POP e agenda | Checklist | localStorage, fila local e Apps Script | `checklist_*` |
| Catálogo, pedidos de compra e fornecedores | Compras | `alofeira_v1` e Apps Script | `compras_*` |

As chaves existentes são um contrato de compatibilidade. A v2.1.6 não renomeia nem copia `kds_v1_db`, `alo_tasks_*` ou `alofeira_v1`; assim, atualizar o aplicativo não perde dados e não exige migração local.

## Regras entre módulos

1. Um módulo não lê arquivos, variáveis privadas ou armazenamento interno de outro módulo.
2. Dados compartilhados passam pelo Core ou por um adaptador explícito.
3. Navegação passa pelo `AloModuleHost`.
4. Backup contém seções independentes por módulo e uma versão de formato.
5. Uma falha em um módulo não deve impedir a abertura dos demais.
6. Cada ação sincronizável precisa de ID de operação, fila durável e confirmação do servidor.

Compras permanece em `iframe` por isolamento de CSS, estado e falhas. O host expõe apenas funções necessárias, como autenticação, backup, restauração, sincronização e abertura de telas administrativas.

## Backend atual

O Google Apps Script continua sendo o backend único. Ele roteia KDS, Checklist e Compras pela mesma URL, mas isso não equivale a uma transação ACID entre todos os módulos. Hoje há proteção por lock, revisões e operações idempotentes nos fluxos críticos. Não se deve prometer atomicidade entre uma alteração de KDS e outra de Compras.

Esta reorganização não altera o Apps Script nem o formato da nuvem. Misturar refatoração do frontend e migração de backend na mesma versão aumentaria o risco e dificultaria a recuperação.

## Preparação para Supabase

A futura migração deve trocar adaptadores, não telas nem regras de negócio. O desenho esperado é:

- tabelas separadas pelos prefixos `core_`, `kds_`, `checklist_`, `compras_` e futuramente `l42_`;
- chaves de estabelecimento em todas as entidades compartilhadas;
- RLS habilitado em toda tabela exposta;
- autorização real no servidor, sem confiar nas permissões visuais do navegador;
- operações idempotentes com chave única de operação;
- Realtime apenas para eventos operacionais, sem transformar histórico antigo em carga contínua;
- migrações versionadas, conferência por contagem e assinatura, e caminho de retorno;
- credenciais privilegiadas nunca incluídas no APK ou no JavaScript público.

O Supabase deve ser introduzido módulo a módulo por uma camada de repositório. Durante a transição, cada domínio terá uma única fonte de verdade declarada; não haverá gravação dupla silenciosa em Apps Script e Supabase.

## Entrada do L42

O L42 deve ser adicionado como `modules/l42/`, com seu próprio `module.js`, CSS, armazenamento e repositório de dados. Ele poderá consumir identidade do restaurante e operadores pelo Core, mas não deve reutilizar diretamente bancos ou funções internas de KDS, Checklist ou Compras.

## Verificação obrigatória

Antes de publicar uma alteração estrutural:

1. executar `node tests/core.test.js`;
2. abrir KDS, Checklist e Compras em tela móvel e desktop;
3. conferir que os três módulos voltam à tela inicial;
4. simular offline, fila pendente e retorno da internet;
5. validar backup e restauração com dados de todos os módulos;
6. confirmar que o service worker não referencia arquivos removidos;
7. verificar que nenhuma chave persistente foi renomeada sem migração explícita.
