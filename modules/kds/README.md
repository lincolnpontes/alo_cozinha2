# Módulo KDS

Responsável por pedidos entre áreas, estados operacionais, alertas sonoros, histórico e sincronização confiável.

- `module.js`: contrato com o host.
- `logic.js`: regras puras de pedido e precedência de status.
- `storage.js`: IndexedDB e migração das filas antigas.
- `sync.js`: outbox, retentativa, idempotência e reconciliação.
- `audio.js`: alarmes por área.
- `app.js`: interface e integração operacional do KDS.

O módulo preserva as chaves históricas `kds_*`. Não acessar o armazenamento de Checklist ou Compras.
