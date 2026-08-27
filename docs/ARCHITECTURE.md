# Arquitetura do Alô Cozinha

## Objetivo

O Alô Cozinha é um único produto com uma única instalação e uma única tela inicial. KDS, Checklist, Compras e L42 são módulos independentes dentro desse produto e não acessam o código interno uns dos outros.

## Estrutura

```text
core/
  module-host.js       navegação e ciclo de vida dos módulos
  data-contracts.js    propriedade e namespaces dos dados
  shared-data.js       pessoas, acessos, restaurante e índice compartilhado
  api.js               transporte compartilhado com o backend atual
  catalog-sync.js      publicação confirmada de cadastros
  ui-dialog.js         diálogos consistentes do produto

modules/
  kds/                 pedidos, fila, áudio, armazenamento e sincronização KDS
  checklist/           atividades, POP, alarmes, relatórios e QR Code
  compras/             pedidos de compra, compras, operadores e fornecedores
  l42/                 etiquetas, estoque, câmera, impressão e adaptador do host

android/               shell Android, CameraX, ML Kit e ponte da impressora

index.html             composição da interface principal
service-worker.js      shell offline do produto
google-apps-script.gs  backend unificado atual
```

Cada módulo possui um `module.js` com identidade, tela, namespace, exigência de login e capacidades. `core/module-host.js` é o único responsável por mostrar ou ocultar módulos. Os aliases `tasks` e `feira` continuam aceitos para não quebrar chamadas antigas, mas os nomes canônicos são `checklist` e `compras`.

## Propriedade dos dados

| Domínio | Proprietário | Persistência atual | Namespace futuro |
| --- | --- | --- | --- |
| Restaurante, pessoas, acessos e índice de produtos | Core | `alo_core_shared_v2`, cópia compacta no Apps Script e adaptadores | `core_*` |
| Pedidos e alertas KDS | KDS | IndexedDB, fila local e Apps Script | `kds_*` |
| Atividades, POP e agenda | Checklist | localStorage, fila local e Apps Script | `checklist_*` |
| Catálogo, pedidos de compra e fornecedores | Compras | `alofeira_v1` e Apps Script | `compras_*` |
| Etiquetas, estoque e impressão | L42 | `etiquetadora_*` e Supabase do L42 | `l42_*` |

As chaves existentes são um contrato de compatibilidade. A v2.1.8 não renomeia nem copia `kds_v1_db`, `alo_tasks_*`, `alofeira_v1`, `etiquetadora_*` ou `alo_supabase_*`; assim, atualizar o aplicativo não exige migração local.

## Regras entre módulos

1. Um módulo não lê arquivos, variáveis privadas ou armazenamento interno de outro módulo.
2. Dados compartilhados passam pelo Core ou por um adaptador explícito.
3. Navegação passa pelo `AloModuleHost`.
4. Backup contém seções independentes por módulo e uma versão de formato.
5. Uma falha em um módulo não deve impedir a abertura dos demais.
6. Cada ação sincronizável precisa de ID de operação, fila durável e confirmação do servidor.

Compras e L42 permanecem em `iframe` por isolamento de CSS, estado e falhas. Isso é uma fronteira técnica interna, não uma composição de aplicativos independentes. Os hosts expõem contratos de dados, sessão, backup e restauração ao Core; o host do L42 também encaminha os retornos da câmera e da autenticação Android para o quadro correto.

## Pessoas e acesso

`core/shared-data.js` é a fonte lógica de verdade para pessoas. Cada cadastro separa duas capacidades:

- `permissions.checklist.funcionario`: a pessoa pode ser vinculada a tarefas e permanecer no histórico;
- `podeEntrar`: a pessoa aparece no login e pode possuir PIN e permissões dos módulos.

Uma pessoa pode ser apenas funcionária, apenas usuária ou as duas coisas. Desligar o login não apaga o cadastro, o PIN criptografado nem os registros anteriores. Compras e L42 recebem somente os acessos habilitados; o Checklist recebe somente funcionários habilitados.

Na primeira execução da v2.1.8, o Core mescla pessoas antigas por vínculo estável e, na ausência dele, pelo nome normalizado. Depois dessa migração, os módulos não podem reativar permissões que foram desligadas no cadastro central.

## Hub de dados

O Core mantém um índice de produtos por nome normalizado e registra de qual módulo veio cada representação. Ele não força KDS, Compras e L42 a usarem o mesmo formato de produto, pois validade, rota, unidade e etiqueta pertencem a domínios diferentes. O método `AloSharedData.getUnifiedData()` expõe, sob demanda, a visão completa dos quatro módulos; `getCatalogIndex()` expõe apenas os vínculos compactos.

O índice completo é reconstruível e fica local. A cópia enviada ao Apps Script contém pessoas, permissões, vínculos, restaurante e metadados, sem duplicar catálogos e históricos pesados no `PropertiesService`.

## Backend atual

O aplicativo já possui um núcleo único, mas ainda está em transição de persistência física:

- KDS, Checklist, Compras e a identidade central usam a mesma URL do Google Apps Script;
- L42 mantém o Supabase legado como fonte de verdade para etiquetas e estoque;
- o backup único contém todas as seções e a identidade compartilhada.

Isso ainda não é um único banco ACID. Há proteção por lock, revisão, confirmação e idempotência nos fluxos críticos, mas não se deve prometer transação entre uma alteração do KDS e outra do L42. A v2.1.8 altera o Apps Script apenas para persistir o núcleo compacto; não copia o histórico do L42 para o `PropertiesService`.

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

O plano executável está em `docs/SUPABASE-MIGRATION.md`.

## Alô L42 e Android

O L42 mantém sua fonte de verdade existente no Supabase e as chaves locais do aplicativo anterior. A v2.1.8 não faz gravação dupla nem migração automática para o Apps Script. O APK preserva o pacote `com.aloetiqueta.l42`, o deep link `aloetiqueta://auth/callback` e o mesmo certificado do APK anterior para permitir atualização sem limpar o sandbox Android.

O Gradle empacota o shell web diretamente da raiz no momento do build; não existe uma segunda cópia manual dos arquivos web dentro de `android/app/src/main/assets`. As pontes `AloNative` e `AloPrinter` permanecem restritas ao WebView local do APK.

## Verificação obrigatória

Antes de publicar uma alteração estrutural:

1. executar `node tests/core.test.js`;
2. abrir KDS, Checklist e Compras em tela móvel e desktop;
3. conferir que os três módulos voltam à tela inicial;
4. simular offline, fila pendente e retorno da internet;
5. validar backup e restauração com dados de todos os módulos;
6. confirmar que o service worker não referencia arquivos removidos;
7. verificar que nenhuma chave persistente foi renomeada sem migração explícita.
