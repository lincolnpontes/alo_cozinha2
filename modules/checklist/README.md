# Módulo Checklist

Responsável por atividades, horários, POP, alarmes, funcionários vinculados, relatórios, fotos e QR Codes.

- `module.js`: contrato com o host.
- `app.js`: domínio e interface do Checklist.
- `templates.js`: modelos sanitários.
- `styles.css`: aparência exclusiva do módulo.
- `vendor/`: biblioteca de QR Code e sua licença.

O módulo preserva as chaves `alo_tasks_*`. Dados comuns do estabelecimento devem ser obtidos pelo Core, nunca pelo armazenamento interno de outro módulo.
