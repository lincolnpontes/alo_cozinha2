# Alô Feira

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

O módulo usa a mesma URL e a mesma implantação dos demais módulos. O código publicado deve ser o `google-apps-script.gs` da raiz do Alô Cozinha.
