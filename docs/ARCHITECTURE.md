# Arquitetura do Alô Cozinha

## Objetivo

O Alô Cozinha é um único produto com uma única instalação e uma única tela inicial. KDS, Checklist, Compras e Etiquetas são módulos independentes dentro desse produto e não acessam o código interno uns dos outros.

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
  checklist/           atividades, fichas técnicas, documentos, POP, alarmes, relatórios e QR Code
  compras/             pedidos de compra, compras, operadores e fornecedores
  l42/                 Etiquetas, estoque, câmera, impressão e adaptador do host

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
| Atividades, POP, agenda, fichas técnicas e documentos | Checklist | localStorage, filas locais, planilhas e Drive privado pelo Apps Script | `checklist_*` |
| Catálogo, pedidos de compra e fornecedores | Compras | `alofeira_v1` e Apps Script | `compras_*` |
| Etiquetas, estoque e impressão | Etiquetas | `etiquetadora_*`, fila local e Apps Script unificado | `l42_*` |

As chaves existentes são um contrato de compatibilidade. A v2.1.38 não renomeia `kds_v1_db`, `alo_tasks_*`, `alofeira_v1`, `etiquetadora_*` ou `alo_supabase_*`; assim, atualizar o aplicativo não exige migração local. As chaves antigas do Supabase ficam apenas para compatibilidade com instalações anteriores e não são usadas como fonte remota no módulo incorporado.

## Regras entre módulos

1. Um módulo não lê arquivos, variáveis privadas ou armazenamento interno de outro módulo.
2. Dados compartilhados passam pelo Core ou por um adaptador explícito.
3. Navegação passa pelo `AloModuleHost`.
4. Backup contém seções independentes por módulo e uma versão de formato.
5. Uma falha em um módulo não deve impedir a abertura dos demais.
6. Cada ação sincronizável precisa de ID de operação, fila durável e confirmação do servidor.

Compras e Etiquetas permanecem em `iframe` por isolamento de CSS, estado e falhas. Isso é uma fronteira técnica interna, não uma composição de aplicativos independentes. Os hosts expõem contratos de dados, sessão, backup e restauração ao Core; o host de Etiquetas também encaminha os retornos da câmera Android para o quadro correto.

## Pessoas e acesso

`core/shared-data.js` é a fonte lógica de verdade para pessoas. Cada cadastro separa vínculo de trabalho e acessos protegidos:

- `permissions.checklist.funcionario`: a pessoa pode ser vinculada a tarefas e permanecer no histórico;
- permissões de KDS, Checklist, Compras, Etiquetas ou administração: fazem a pessoa aparecer somente no login correspondente e permitem que ela possua PIN.

Uma pessoa pode ser apenas funcionária, apenas usuária ou as duas coisas. Remover todos os acessos protegidos não apaga o cadastro, o PIN criptografado nem os registros anteriores. Compras e Etiquetas recebem somente os acessos habilitados; o Checklist recebe os funcionários vinculados às atividades.

Na primeira execução do núcleo compartilhado, o Core mescla pessoas antigas por vínculo estável e, na ausência dele, pelo nome normalizado. Depois dessa migração, os módulos não podem reativar permissões que foram desligadas no cadastro central.

## Hub de dados

O Core mantém um índice de produtos por nome normalizado e registra de qual módulo veio cada representação. Ele não força KDS, Compras e Etiquetas a usarem o mesmo formato de produto, pois validade, rota, unidade e etiqueta pertencem a domínios diferentes. O método `AloSharedData.getUnifiedData()` expõe, sob demanda, a visão completa dos quatro módulos; `getCatalogIndex()` expõe apenas os vínculos compactos.

O índice completo é reconstruível e fica local. A cópia enviada ao Apps Script contém pessoas, permissões, vínculos, restaurante e metadados, sem duplicar catálogos e históricos pesados no `PropertiesService`.

## Backend atual

O aplicativo usa uma URL única de Google Apps Script:

- KDS, Checklist, Compras, Etiquetas e a identidade central usam a mesma implantação;
- Etiquetas mantém uma cópia local e grava seu banco compactado em uma aba própria, usando slots A/B, checksum, revisão e operação idempotente;
- o backup único contém todas as seções e a identidade compartilhada.

Isso ainda não é um único banco ACID. Há proteção por lock, revisão, confirmação, checksum e idempotência nos fluxos críticos, mas não existe uma transação única entre módulos. O Apps Script é a fonte remota atual; a futura migração ao Supabase substituirá os adaptadores sem misturar regras de domínio.

## Preparação para Supabase

A futura migração deve trocar adaptadores, não telas nem regras de negócio. O desenho esperado é:

- tabelas separadas pelos prefixos `core_`, `kds_`, `checklist_`, `compras_` e `l42_`;
- chaves de estabelecimento em todas as entidades compartilhadas;
- RLS habilitado em toda tabela exposta;
- autorização real no servidor, sem confiar nas permissões visuais do navegador;
- operações idempotentes com chave única de operação;
- Realtime apenas para eventos operacionais, sem transformar histórico antigo em carga contínua;
- migrações versionadas, conferência por contagem e assinatura, e caminho de retorno;
- credenciais privilegiadas nunca incluídas no APK ou no JavaScript público.

O Supabase deve ser introduzido módulo a módulo por uma camada de repositório. Durante a transição, cada domínio terá uma única fonte de verdade declarada; não haverá gravação dupla silenciosa em Apps Script e Supabase.

O plano executável está em `docs/SUPABASE-MIGRATION.md`.

## Etiquetas e Android

Etiquetas usa o Apps Script unificado quando incorporado ao Alô Cozinha. O APK preserva o pacote `com.aloetiqueta.l42`, o deep link `aloetiqueta://auth/callback` e o mesmo certificado do APK anterior para permitir atualização sem limpar o sandbox Android. Esses nomes são compatibilidade técnica, não uma segunda conta ou um segundo aplicativo dentro do produto.

O Gradle empacota o shell web diretamente da raiz no momento do build; não existe uma segunda cópia manual dos arquivos web dentro de `android/app/src/main/assets`. As pontes `AloNative` e `AloPrinter` permanecem restritas ao WebView local do APK.

## Verificação obrigatória

Antes de publicar uma alteração estrutural:

1. executar `node tests/core.test.js`;
2. abrir KDS, Checklist, Compras e Etiquetas em tela móvel e desktop;
3. conferir que os quatro módulos voltam à tela inicial;
4. simular offline, fila pendente e retorno da internet;
5. validar backup e restauração com dados de todos os módulos;
6. validar a cópia A/B de Etiquetas e a resolução de conflito por revisão;
7. confirmar que o service worker não referencia arquivos removidos;
8. verificar que nenhuma chave persistente foi renomeada sem migração explícita.
