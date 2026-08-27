# Migração do Alô Cozinha para Supabase

## Meta

Levar os quatro módulos e o núcleo compartilhado para um único projeto Supabase sem alterar as telas, perder históricos ou manter duas fontes de verdade indefinidamente.

## Modelo inicial

Tabelas do núcleo:

- `core_establishments`
- `core_people`
- `core_credentials`
- `core_module_permissions`
- `core_areas`
- `core_product_links`
- `core_migration_runs`

Tabelas de domínio:

- `kds_orders`, `kds_order_events`, `kds_alert_acknowledgements`
- `checklist_templates`, `checklist_schedules`, `checklist_executions`
- `compras_products`, `compras_suppliers`, `compras_orders`, `compras_order_items`
- `l42_products`, `l42_labels`, `l42_stock_events`, `l42_print_events`

Todas as entidades operacionais devem carregar `establishment_id`. IDs antigos ficam em colunas `legacy_id` com restrição única por origem, permitindo migração idempotente.

## Segurança

1. Expor à API somente as tabelas necessárias.
2. Habilitar RLS em todas as tabelas expostas.
3. Autorizar por estabelecimento e função no servidor.
4. Guardar PIN apenas como hash; nunca enviar credencial privilegiada no APK.
5. Usar funções `SECURITY DEFINER` somente quando indispensável, com `search_path` fixo e permissões mínimas.
6. Registrar ações administrativas e migrações.

## Consistência

- Toda escrita recebe `operation_id` único.
- Mudança de status grava evento e estado atual na mesma transação.
- O servidor rejeita revisões antigas.
- Realtime entrega eventos operacionais; a tela reconcilia periodicamente o estado canônico.
- Histórico antigo é consultado por período e não participa do fluxo operacional em tempo real.
- Exclusões regulatórias usam estado ou tombstone quando o histórico precisa permanecer auditável.

## Etapas

1. Criar esquema, RLS, índices e ambiente de homologação.
2. Migrar `core_people`, permissões, restaurante e áreas; conferir contagem e assinaturas.
3. Trocar o adaptador de identidade do frontend e manter os módulos atuais.
4. Migrar Checklist, depois Compras, KDS e por último L42.
5. Em cada módulo: congelar escrita antiga, importar, conferir, virar a fonte de verdade e manter retorno documentado.
6. Rodar ao menos um ciclo operacional completo em homologação.
7. Desativar Apps Script e o esquema legado do L42 somente depois da conferência final e do backup.

## Critérios de aceite

- nenhum registro perdido ou duplicado;
- mesma pessoa e mesmas permissões em todos os aparelhos;
- fila offline sobrevive a reinício e envia uma única vez;
- status não regride diante de respostas atrasadas;
- KDS e Checklist recebem atualizações operacionais em tempo útil;
- backup completo restaura os quatro módulos;
- APK não contém chave privilegiada;
- políticas RLS testadas para acesso permitido e negado.
