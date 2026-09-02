# Arquitetura do Alô Cozinha

## Objetivo

O Alô Cozinha é um único produto com uma única instalação e uma única tela inicial. KDS, Checklist, Compras e Etiquetas são módulos independentes dentro desse produto e não acessam o código interno uns dos outros.

## Estrutura

```text
core/
  module-host.js       navegação e ciclo de vida dos módulos
  data-contracts.js    propriedade e namespaces dos dados
  shared-data.js       pessoas, acessos, restaurante e índice compartilhado
  cloud.js             sessão Supabase, Realtime e endpoint único
  api.js               transporte autenticado compartilhado
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
supabase/              migrações, políticas RLS e Edge Functions
```

Cada módulo possui um `module.js` com identidade, tela, namespace, exigência de login e capacidades. `core/module-host.js` é o único responsável por mostrar ou ocultar módulos. Os aliases `tasks` e `feira` continuam aceitos para não quebrar chamadas antigas, mas os nomes canônicos são `checklist` e `compras`.

## Propriedade dos dados

| Domínio | Proprietário | Persistência atual | Namespace futuro |
| --- | --- | --- | --- |
| Restaurante, pessoas, acessos e índice de produtos | Core | armazenamento local e módulo `catalog` isolado por conta | `core_*` |
| Pedidos e alertas KDS | KDS | IndexedDB, fila local e módulo `kds` no Supabase | `kds_*` |
| Atividades, POP, agenda, fichas técnicas e documentos | Checklist | filas locais, módulos próprios e Storage privado | `checklist_*` |
| Catálogo, pedidos de compra e fornecedores | Compras | `alofeira_v1` e módulo `compras` no Supabase | `compras_*` |
| Etiquetas, estoque e impressão | Etiquetas | `etiquetadora_*`, fila local e módulo `etiquetas` no Supabase | `l42_*` |

As chaves existentes são um contrato de compatibilidade. A v2.1.45 não renomeia `kds_v1_db`, `alo_tasks_*`, `alofeira_v1`, `etiquetadora_*` ou `alo_supabase_*`; assim, atualizar o aplicativo não exige migração local. A sessão anterior do Etiquetas é reaproveitada como sessão única do produto.

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

O índice completo é reconstruível e fica local. A cópia remota usa estados separados por domínio e conta, sem permitir leitura cruzada entre restaurantes.

## Backend atual

O aplicativo usa um projeto Supabase configurado no próprio cliente:

- a conta da nuvem é opcional para abrir o aplicativo e fica persistida após a primeira conexão;
- KDS, Checklist, Compras, Etiquetas e a identidade central usam uma única Edge Function autenticada;
- `api.module_states` separa os domínios e todas as leituras são limitadas a `auth.uid()` por RLS forçada;
- cada gravação usa revisão otimista e recibo idempotente, enquanto Realtime avisa os outros aparelhos imediatamente;
- fotos e documentos ficam em bucket privado, em caminhos pertencentes ao usuário autenticado;
- o backup único continua contendo todas as seções e a identidade compartilhada.

Cada mutação de módulo é transacional e consistente no PostgreSQL. Operações que atravessam módulos continuam coordenadas pelos adaptadores e não fingem ser uma única transação distribuída; os vínculos usam referências explícitas e reconciliação idempotente.

## Regras do Supabase

O backend segue estas regras:

- estados separados por domínio e proprietário em `api.module_states`;
- `owner_id` derivado da sessão, nunca aceito do corpo enviado pelo cliente;
- RLS habilitado em toda tabela exposta;
- autorização real no servidor, sem confiar nas permissões visuais do navegador;
- operações idempotentes com chave única de operação;
- Realtime apenas sinaliza mudança de revisão; cada adaptador reconcilia o estado canônico;
- migrações versionadas, conferência por contagem e assinatura, e caminho de retorno;
- credenciais privilegiadas nunca incluídas no APK ou no JavaScript público.

Não existe gravação dupla: conectado, o Supabase é a única fonte remota; desconectado, as filas locais preservam as ações até a reconciliação.

O plano executável está em `docs/SUPABASE-MIGRATION.md`.

## Etiquetas e Android

Etiquetas usa a sessão e o endpoint Supabase do núcleo quando incorporado ao Alô Cozinha. O APK preserva o pacote `com.aloetiqueta.l42`, o deep link `aloetiqueta://auth/callback` e o mesmo certificado do APK anterior para permitir atualização sem limpar o sandbox Android. Esses nomes são compatibilidade técnica, não uma segunda conta ou um segundo aplicativo dentro do produto.

O Gradle empacota o shell web diretamente da raiz no momento do build; não existe uma segunda cópia manual dos arquivos web dentro de `android/app/src/main/assets`. As pontes `AloNative` e `AloPrinter` permanecem restritas ao WebView local do APK.

## Verificação obrigatória

Antes de publicar uma alteração estrutural:

1. executar `node tests/core.test.js`;
2. abrir KDS, Checklist, Compras e Etiquetas em tela móvel e desktop;
3. conferir que os quatro módulos voltam à tela inicial;
4. simular offline, fila pendente e retorno da internet;
5. validar backup e restauração com dados de todos os módulos;
6. validar a resolução de conflito por revisão em Etiquetas;
7. confirmar que o service worker não referencia arquivos removidos;
8. verificar que nenhuma chave persistente foi renomeada sem migração explícita.
