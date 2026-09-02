# Módulo Etiquetas

O módulo Etiquetas preserva as rotinas maduras de câmera, estoque e impressão dentro de um `iframe`, isolando CSS, estado e falhas dos demais módulos do Alô Cozinha.

- As chaves locais `etiquetadora_*` e `alo_supabase_*` não foram renomeadas para preservar instalações anteriores.
- Quando incorporado, o módulo usa a sessão e o endpoint Supabase únicos do Alô Cozinha; a tela de conta independente não é iniciada.
- O host encaminha ao `iframe` os retornos da câmera nativa.
- `AloNative` e `AloPrinter` continuam disponíveis no APK para câmera, arquivos e impressão TCP.
- O banco remoto usa revisão otimista e recibos idempotentes no mesmo backend dos demais módulos.

O identificador interno `l42` e o pacote Android antigo continuam existindo somente por compatibilidade técnica com a impressora, os backups e as atualizações instaladas.
