# Módulo Etiquetas

O módulo Etiquetas preserva as rotinas maduras de câmera, estoque e impressão dentro de um `iframe`, isolando CSS, estado e falhas dos demais módulos do Alô Cozinha.

- As chaves locais `etiquetadora_*` e `alo_supabase_*` não foram renomeadas para preservar instalações anteriores.
- Quando incorporado, o módulo usa a mesma URL do Google Apps Script dos demais módulos; o Supabase legado não é iniciado.
- O host encaminha ao `iframe` os retornos da câmera nativa.
- `AloNative` e `AloPrinter` continuam disponíveis no APK para câmera, arquivos e impressão TCP.
- O banco remoto é compactado e salvo em slots A/B validados por checksum, com revisão e idempotência.

O identificador interno `l42` e o pacote Android antigo continuam existindo somente por compatibilidade técnica com a impressora, os backups e as atualizações instaladas.
