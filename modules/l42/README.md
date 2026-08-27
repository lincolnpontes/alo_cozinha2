# Módulo Alô L42

O módulo preserva a aplicação Alô L42 v2.22 dentro de um `iframe`, isolando CSS, estado e falhas dos demais módulos do Alô Cozinha.

- As chaves locais `etiquetadora_*` e `alo_supabase_*` não foram renomeadas.
- A conta e a sincronização Supabase existentes continuam sendo a fonte de verdade do L42.
- O host encaminha ao `iframe` os retornos da câmera nativa e da autenticação Android.
- `AloNative` e `AloPrinter` continuam disponíveis no APK para câmera, arquivos e impressão TCP.
- O código de backend importado do projeto original está preservado em `backend/` para a futura migração unificada.

O L42 ainda usa seu backend Supabase próprio nesta versão. Integrar autenticação e dados dos quatro módulos será uma migração posterior, com esquema e retorno definidos antes de qualquer troca de fonte de verdade.
