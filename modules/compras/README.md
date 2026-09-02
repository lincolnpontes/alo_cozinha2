# Lista de Compras

Aplicativo web instalável para preparar pedidos, acompanhar compras e gerar relatórios por fornecedor.

## Estrutura

- `index.html`: estrutura das telas e modais.
- `src/scripts/`: regras separadas por domínio, sincronização, segurança e interface.
- `src/styles/`: base, layout, componentes, recursos e responsividade.
- `backend/README.md`: referência para o backend unificado do Alô Cozinha.
- `service-worker.js`: instalação e funcionamento offline da PWA.

## Executar localmente

```powershell
python -m http.server 5173 --bind 127.0.0.1
```

Abra `http://127.0.0.1:5173/`.

## Backend

Quando incorporado, o módulo usa a sessão e a Edge Function Supabase configuradas pelo núcleo do Alô Cozinha.
