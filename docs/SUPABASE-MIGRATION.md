# Migração do Alô Cozinha para Supabase

## Resultado

A v2.1.41 usa um único projeto Supabase para KDS, Checklist, Lista de Compras, Etiquetas e dados compartilhados. O app continua local-first e não exige login para abrir; a conta da nuvem é conectada uma vez nas configurações e permanece no aparelho.

## Componentes

- `api.module_states`: snapshots separados por conta e domínio.
- `api.sync_operations`: recibos idempotentes de operações já confirmadas.
- `api.get_module_state` e `api.sync_module_state`: leitura e escrita autenticadas, com revisão otimista.
- `alo-cozinha-sync`: Edge Function que mantém os contratos dos quatro módulos.
- `alo-cozinha-private`: bucket privado para fotos e documentos.
- Supabase Realtime: aviso imediato de alteração aos demais aparelhos da mesma conta.

## Isolamento

1. O proprietário é sempre obtido da sessão Supabase; o cliente não escolhe `owner_id`.
2. `api.module_states` e `api.sync_operations` usam RLS forçada.
3. A política permite leitura somente quando `owner_id = auth.uid()`.
4. O bucket privado aceita apenas caminhos iniciados pelo ID do usuário autenticado.
5. A chave pública fica no cliente; a chave `service_role` existe somente dentro da Edge Function.
6. PINs de operadores continuam sendo uma autorização interna do restaurante e não substituem a conta da nuvem.

## Consistência

- Toda gravação compara a revisão conhecida com a revisão atual.
- Uma revisão antiga devolve conflito e o adaptador reconcilia o estado canônico.
- Operações com o mesmo ID devolvem o recibo anterior sem repetir o efeito.
- As filas locais sobrevivem a reinício e retomam o envio quando a conexão volta.
- Realtime acelera a atualização, mas a leitura periódica continua como conferência.

## Dados migrados

Em 1º de setembro de 2026, a conta principal recebeu:

- 44 produtos de catálogo e 5 tarefas cadastradas;
- 3.423 pedidos KDS;
- 15 atividades, 5 fichas técnicas e 1 documento;
- 209 produtos, 1.039 pedidos e 20 fornecedores de Compras;
- 77 produtos e 1.982 registros de histórico de Etiquetas;
- 3 fotos e 1 documento no Storage privado.

O backup anterior à migração está em `C:\Users\Lincoln\Downloads\alo_cozinha_pre_supabase_2026-09-01.json`. O commit e a tag `v2.1.40` preservam o backend anterior como caminho de retorno.

## Critérios de aceite

- nenhuma chamada operacional usa configuração manual de URL;
- outro usuário não lê nem altera dados da conta principal;
- KDS, Checklist, Compras e Etiquetas recebem confirmação do servidor;
- Realtime acorda somente o adaptador do domínio alterado;
- fotos e documentos não possuem URL pública permanente;
- confirmação e recuperação de senha continuam abrindo o site de conta existente;
- o APK não contém chave privilegiada e empacota a biblioteca Supabase;
- o backup completo continua exportando os quatro módulos.
