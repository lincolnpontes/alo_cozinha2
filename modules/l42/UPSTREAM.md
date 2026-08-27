# Alô Etiqueta v2.22 (Android)

Aplicativo Android para criação, impressão e controle de etiquetas. A interface
web é empacotada dentro do APK. Os dados continuam disponíveis localmente e,
depois do login, são sincronizados por conta no Supabase.

## Novidades da v2.22

- O ajuste vertical usa a calibração real da L42: o antigo `-3` agora é o
  centro `0`, com passos menores para cima e para baixo.
- A impressão envia exatamente uma cópia e usa um limite de procura de sensor
  compatível com uma etiqueta inteira, evitando pular etiquetas em branco.
- Oito novos modelos de etiqueta atendem rotinas de validade, rastreio,
  produção, venda, uso compacto e identidade com logomarca.
- Configurações Gerais agora prepara uma logomarca PNG/JPG em preto e branco
  para impressão térmica.
- A tela inicial ganhou resumo no topo, categorias recolhidas em **Todos** e
  controles mais compactos; as ações sensíveis do Avançado usam painéis
  suspensos redesenhados.

## Obter o APK pelo GitHub

1. Abra a seção **Releases** do repositório.
2. Entre em **Alô Etiqueta v2.22**.
3. Em **Assets**, baixe `Alo-Etiqueta-L42-v2.22.apk` e instale no Android.

O APK também pode aparecer em **Actions → Gerar APK → Artifacts** quando
houver espaço disponível na cota de artefatos da conta GitHub.

O Android poderá solicitar autorização para instalar aplicativos dessa fonte.
A permissão de câmera só é solicitada quando o leitor de QR Code for usado.

## Backup e planilhas

- **Avançado → Backup completo** exporta e restaura um arquivo `.json` com
  produtos, categorias, perfis, configurações, estoque e histórico.
- **Gerenciar Produtos → 📲** exporta os produtos, importa uma planilha ou baixa
  o modelo `modelo-importacao-produtos-v2.10.xlsx`.
- No Android, os arquivos exportados são salvos em
  **Downloads/Alô Etiqueta**.

## Gerar localmente

Com Android SDK 36, Java 17 e Gradle 8.13 instalados:

```bash
gradle -p android assembleDebug
```

O arquivo será criado em `android/app/build/outputs/apk/debug/app-debug.apk`.

## Conta e sincronização no Supabase

A v2.22 permite criar a primeira conta diretamente no aplicativo, confirmar a
senha duas vezes, revelar ou ocultar o que foi digitado e recuperar uma senha
esquecida por e-mail. O mesmo login pode ser usado em vários celulares.
Os links de confirmação e recuperação abrem em uma página web própria,
[Alô Etiqueta · Conta](https://lincolnpontes.github.io/alo-etiqueta-conta/),
sem depender de `localhost` nem do aplicativo estar aberto.
Produtos, categorias, operadores, configurações, estoque e histórico são
sincronizados com revisão do servidor e proteção contra sobrescrita silenciosa.

Os operadores são diferentes da conta do sistema. Seus PINs também sincronizam,
mas somente como verificadores PBKDF2 com salt; o PIN original não é enviado em
texto legível. Configurações exclusivas do aparelho, como endereço da
impressora, permanecem locais.

Toda conta nova começa no plano gratuito, sem cobrança automática. A compra
mensal/anual ainda depende dos produtos e credenciais do Google Play Console.
O login com Google aparece automaticamente no aplicativo quando o provedor for
configurado no Supabase com as credenciais OAuth da conta Google.
As migrações e a política de segurança estão em [`supabase`](supabase/README.md).

## Atualizar a interface do APK

Os arquivos usados pelo Android ficam em `android/app/src/main/assets`. Depois de editar
a versão principal, sincronize-os antes de gerar o APK:

```bash
cp index.html manifest.json icon.png sw.js modelo-importacao-produtos-v2.10.xlsx android/app/src/main/assets/
```
