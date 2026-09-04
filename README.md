# Alô Cozinha v2.1.49

Aplicativo para operação de restaurante com quatro módulos: pedidos entre áreas (KDS), checklist por setor, Lista de Compras e Etiquetas.

- A v2.1.49 coordena a renovação da sessão Supabase entre módulos e abas, evita reutilização do refresh token e recupera a conexão sem exigir logout após falhas transitórias.
- O backup completo v2.1.49 inclui dados do restaurante, logomarca, setores, funcionários e as mídias privadas de tarefas, fichas técnicas e documentos, com restauração para o Storage do Supabase.
- A Lista de Compras ganha estoque mínimo/máximo e o modo opcional Receber; o KDS ganha visualização em quadro, controle de “Vir buscar”, ícones maiores de área e uma nova ação para limpar o histórico.
- Etiquetas passa a usar somente o tema transparente integrado, inclusive para bancos antigos.

## Novidades da v2

- A v2.1.47 isola todo o armazenamento local, o IndexedDB e os caches por Alô Cozinha e por conta Supabase. Os módulos não leem nem sobrescrevem dados dos aplicativos antigos, e Etiquetas deixou de importar armazenamento legado.
- A v2.1.47 protege entrada, cadastro e recuperação de senha com Cloudflare Turnstile validado pelo Supabase. Na v2.1.49, a proteção local após três senhas incorretas foi reduzida para 30 segundos para não prender o operador.
- A v2.1.47 impede que exclusões e retornos do módulo Etiquetas reconstruam a tela antiga do Alô Etiqueta e mantém o cabeçalho integrado.
- A v2.1.47 centraliza as ações dos cartões de atividade, capitaliza os exemplos do Etiquetas e refina o ícone de Configurações.
- O APK v2.1.47 mantém os arquivos empacotados e passa a servi-los por uma origem HTTPS interna segura, compatível com o Turnstile sem atualizar o app por fora da Play Store.
- A v2.1.43 compacta e refina a tela inicial de acesso para celular, mantendo login, verificação e demonstração em uma única tela.
- A v2.1.43 amplia o Modo Demonstração com pedidos acionáveis, quantidades padrão, fichas, etiquetas e documentos fictícios, todos isolados dos dados reais.
- A v2.1.43 reorganiza as atividades do Checklist: o painel Geral não mistura cartões e cada atividade usa o título inteiro com ações na linha inferior.
- A v2.1.43 recupera automaticamente a sessão compartilhada do Supabase, serializa a renovação do token e reacorda as filas dos quatro módulos sem exigir novo login após falhas transitórias.
- A v2.1.42 migra os quatro módulos para um backend Supabase único, com autenticação persistente, atualização em tempo real e isolamento de dados por conta.
- A v2.1.42 corrige corridas de sincronização do KDS, importa a operação existente, usa armazenamento privado e elimina a configuração manual da antiga URL.
- A v2.1.40 corrige a exportação do backup completo: no APK, o arquivo é salvo em Downloads/Alo Cozinha; no navegador, o JSON é baixado diretamente.
- A v2.1.39 alinha o controle Inverter com a seleção de preto e dá a Funcionários e Acessos um ícone próprio no padrão visual das configurações.
- A v2.1.39 remove o atalho duplicado de categorias e impede que os retornos de Produtos e Categorias abram o painel legado do antigo L42.
- A v2.1.38 centraliza o botão de escolher logomarca nos Dados do Restaurante.
- A v2.1.38 posiciona a logomarca abaixo do controle por QR Code e alinha corretamente o controle Inverter em Etiquetas.
- A v2.1.38 simplifica os ícones de Dados do Restaurante, Setores e Módulos para símbolos diretos e legíveis.
- A v2.1.28 permite ocultar módulos não utilizados por restaurante, mantendo o painel central sempre acessível para reativá-los.
- A v2.1.28 liga tarefas a fichas técnicas e fichas a Etiquetas, com abertura direta do produto correspondente para impressão.
- A v2.1.28 adiciona duplicação de tarefas e fichas, transforma o cadastro de horários em uma janela própria e reforça a legibilidade da etiqueta simples 60x40.
- A v2.1.28 troca a limpeza de itens comprados por um ícone claro de lixeira com marcações concluídas e deixa os estados do Checklist mais translúcidos.
- A v2.1.13 corrige a retenção das atividades após a sincronização com o Google Sheets, cria o painel Geral do Checklist por setor e melhora fichas técnicas, fotos e busca de ingredientes.
- A v2.1.13 simplifica Funcionários e Acessos, torna o teclado de PIN mais responsivo, refina os filtros de KDS e Compras e melhora a edição visual de pedidos em andamento.
- O APK v2.1.13 abre a câmera nativa para fotos das atividades e fichas técnicas e atualiza o ícone dos controles da etiquetadora.
- A v2.1.12 transforma o antigo Alô L42 em Etiquetas, centraliza funcionários, PINs e permissões, adiciona as configurações do módulo ao painel principal e sincroniza etiquetas, estoque e histórico pela mesma URL do Google Apps Script.
- A v2.1.12 grava o banco completo de Etiquetas compactado em dois slots validados, com revisão, checksum, idempotência e recuperação da cópia anterior antes de trocar a versão ativa.
- A v2.1.8 criou a identidade central do produto: funcionário e login são capacidades independentes, Compras e Etiquetas usam a mesma sessão, o restaurante é compartilhado e o Core expõe um hub único de dados e backup.
- A v2.1.7 integrou o antigo Alô L42 como quarto módulo, preservando banco local, câmera nativa e impressão TCP em um APK único assinado com o certificado anterior.
- A v2.1.6 reorganizou o produto em `core/` e módulos independentes para KDS, Checklist e Compras, preservando todas as chaves de dados e preparando a entrada de novos módulos.
- A v2.0.24 prioriza pedidos novos, reduz a leitura operacional do histórico e sincroniza entre aparelhos a confirmação dos alertas das Panelas.
- A v2.0.25 confirma visualmente o POST sem esperar uma segunda leitura, mantém o retry durável e sincroniza apenas o expediente atual, sem limite numérico de pedidos.
- A v2.0.26 posiciona a área de origem no canto superior direito dos pedidos em celulares, preservando as três ações na mesma linha.
- A v2.1.5 corrige a identificação dos setores do Checklist e separa as permissões de comprar e receber para cada operador.
- A v2.1.4 unifica setores do estabelecimento, separa permissões por módulo, memoriza localmente o último operador e protege o KDS contra regressões de status causadas por leituras atrasadas.
- A v2.1.3 unifica o login por operador, encerra a sessão ao sair de Compras, centraliza restaurante e operadores, padroniza os indicadores de nuvem e cria um único backup para os três módulos.
- A v2.1.1 integra a Lista de Compras ao produto: cabeçalho único, perfil de operador, configurações centralizadas, senha de segurança única e uma só URL de nuvem para os três módulos.
- A versão estável anterior está preservada na tag `v2.0.27`.
- A v2.0.23 corrige a perspectiva do ícone do KDS, deixando a tela frontal, simétrica e com laterais paralelas.
- A v2.0.22 remove a seta do ícone do KDS, corrige a bolinha de sincronização do Checklist e iguala a altura e a proporção dos cabeçalhos no celular.
- A v2.0.21 simplifica os cabeçalhos dos módulos, preserva o emoji do setor no celular, padroniza a sincronização e adiciona ícones próprios para KDS e Checklist.
- A v2.0.20 limita os avisos sonoros das Panelas a uma reprodução por evento, mantém o destaque visual até a confirmação e preserva o alarme contínuo da Cozinha.
- A v2.0.19 adiciona o período Tudo ao histórico, liga a tela de hoje ao relatório completo e amplia a confirmação de migrações grandes.
- A v2.0.18 mantém o histórico migrado na nuvem e limita o cache local a pedidos operacionais, evitando estouro de armazenamento.
- A v2.0.17 aceita Apps Script independente, usa propriedades do script e cria automaticamente a planilha de dados no Drive.
- A v2.0.16 migra backups físicos para uma nova implantação, preserva a nova URL e importa o histórico por ID sem duplicar pedidos.
- A v2.0.15 simplifica o ícone do aplicativo, ampliando o chapéu e os talheres e removendo o balão e o selo de confirmação.
- A v2.0.14 compacta a correção de status isolada e refina os indicadores dos seletores de área.
- A v2.0.13 deixa os seletores compactos, separa as preferências locais dos módulos e uniformiza as ações de conclusão.
- A v2.0.12 iguala os seletores de setor, estabiliza os filtros sanitários e mantém a área de trabalho local em cada equipamento.
- A v2.0.11 uniformiza os nomes dos setores, reorganiza funcionários e amplia os modelos sanitários para os controles da RDC 216.
- A v2.0.10 identifica KDS e Checklist nos cabeçalhos, remove programações automáticas de tarefas novas e refina alarmes, frequências e switches.
- A v2.0.9 leva a troca de setor para o cabeçalho das atividades e permite vários horários e frequências na mesma tarefa.
- A biblioteca sanitária oferece modelos editáveis com base na RDC Anvisa 216/2004, sem fixar diluição ou tempo de contato de saneantes.
- Tarefas podem ter foto de referência sincronizada pelo Google Drive e QR Code para consulta do procedimento e das últimas execuções.
- Alarmes, controles e cores foram redesenhados com superfícies translúcidas e ações mais compactas.
- A v2.0.8 mostra o marcador imediatamente em linhas vazias, limita o alinhamento à linha ou seleção atual e mantém o marcador junto ao texto à direita.
- Os separadores de estado ganharam faixas semânticas mais nítidas, o Total ficou compacto e o seletor de áreas do KDS foi redesenhado com emojis e função de cada área.
- A confirmação de atividade não realizada agora usa somente a pergunta e as ações Cancelar/Confirmar.
- A v2.0.7 refina a Lista de Atividades com estados visuais, filtro de execução, popover de edição e procedimentos formatados corretamente.
- O editor usa um único controle de alinhamento visual, preserva marcadores centralizados e reconhece automaticamente procedimentos antigos em HTML.
- Confirmações e entradas rápidas agora usam janelas do próprio app; o seletor de área do KDS ganhou emojis e opções responsivas.
- O detalhe da atividade ganhou ações operacionais por estado e um lápis separado para retomar a execução ou excluir o registro e voltar para pendente.
- As abas exibem os totais do dia e substituem a antiga faixa de resumo, liberando mais espaço para as atividades.
- As configurações do cabeçalho abrem apenas o módulo atual; o painel completo e as configurações avançadas ficam no novo botão da tela inicial.
- O histórico gerencial não repete o procedimento e mostra a observação registrada na conclusão somente quando ela existe.
- A v2.0.5 deixa os cartões operacionais compactos: sem procedimento, estado escrito, POP ou duração na lista inicial.
- Atividades em execução podem voltar para pendente pelos detalhes, com ações de retorno mais claras.
- Procedimentos agora têm formato explícito: texto, bolinhas, numeração ou tracinhos, preservando blocos separados por linhas em branco.
- Relatórios agrupam e filtram registros por área, integram registros POP na mesma lista e oferecem períodos de até um ano.
- O histórico abre acima do relatório, pode ser impresso e mantém funcionário, área, data, horário, duração, POP e observação.
- A v2.0.4 alinha `Hoje`, `Pendentes` e `Concluídas` ao dia atual, evitando contagens diferentes entre as abas.
- Qualquer cartão de atividade abre seus detalhes e o procedimento, sem alterar o estado; somente os botões iniciam ou concluem.
- Procedimentos aceitam parágrafos, linhas em branco, marcadores com `-` e etapas numeradas.
- Relatórios permitem abrir o histórico de cada tarefa com executor, data, horário, duração, POP e observação.
- O cabeçalho do KDS identifica o módulo e os cartões não ocupam mais espaço com mensagens extensas de sincronização.
- A v2.0.3 remove o cargo do cadastro de funcionários e deixa somente nome, setor e estado ativo.
- `Hoje` mostra todas as atividades do dia; `Concluídas` mostra somente as concluídas do mesmo dia.
- Tocar numa atividade concluída abre seu registro e permite voltar para execução, continuando o tempo anterior, ou voltar para pendente.
- Tarefas configuradas como remarcáveis podem ser levadas para outra data sem perder o registro da data original.
- Tarefas com registro POP exigem o funcionário ao concluir e guardam procedimento, observação, data, hora e duração.
- A v2.0.2 reorganiza a Lista de Atividades em Hoje, Pendentes e Concluídas, com cores por estado e conclusão apenas por botão.
- Atividades concluídas podem ser desfeitas; lembretes abrem diretamente a atividade sem navegar quando a ação é feita no próprio aviso.
- A navegação dos módulos ganhou a assinatura Alô Cozinha e Gerenciar Áreas passou para Configurações KDS.
- A v2.0.1 adicionou confirmação explícita e suporte à tecla Enter em todos os acessos por senha.
- Senhas incorretas mostram uma mensagem no próprio modal, e salvar a senha de segurança não abre mais um alerta bloqueante.
- Nova tela inicial para escolher entre `KDS - Sistema de Pedidos` e `Checklist`.
- O KDS anterior foi preservado dentro do módulo de pedidos.
- Atividades diárias, semanais ou únicas, com horário, prioridade, setor, responsável, instrução curta e alarme opcional.
- Funcionários cadastrados somente com nome, setor e estado ativo.
- A atividade pode ser iniciada, concluída ou marcada como não realizada.
- O tempo é medido somente quando a atividade foi iniciada antes da conclusão.
- Alarmes aparecem sobre qualquer módulo e permitem abrir a tarefa, iniciar, marcar como feita ou silenciar.
- Fila local persistente para atividades: ações sem internet são guardadas e reenviadas até a confirmação.
- Sincronização entre aparelhos com revisão, operação idempotente e proteção contra status atrasado.
- Relatórios de 7 ou 30 dias com total concluído, tempo médio, atrasos e conclusões sem medição.
- Painel reorganizado em `Configurações KDS`, `Configurações Tarefas` e `Configurações Avançadas`; áreas ficam dentro do KDS.

## Arquivos

- `core/`: navegação, contratos de dados, API, diálogos e serviços compartilhados.
- `modules/kds/`: pedidos, armazenamento, áudio e sincronização do KDS.
- `modules/checklist/`: atividades, POP, alarmes, relatórios e QR Code.
- `modules/compras/`: Lista de Compras e seu adaptador para identidade, restaurante, sessão e backup compartilhados.
- `modules/l42/`: Etiquetas, estoque, câmera, impressão e adaptador para o backend unificado. O nome da pasta é preservado por compatibilidade técnica.
- `android/`: aplicativo Android unificado, com CameraX, ML Kit e a ponte da etiquetadora.
- `index.html`: composição da interface principal e das configurações.
- `styles.css`: shell visual e estilos históricos do KDS.
- `service-worker.js`: cache para abertura offline.
- `supabase/`: schema, RLS, Storage e Edge Function do backend unificado.
- `docs/ARCHITECTURE.md`: propriedade dos dados, limites dos módulos e arquitetura integrada.
- `docs/SUPABASE-MIGRATION.md`: registro e critérios da migração dos quatro módulos.

## Atualizar sem perder dados

A v2 preserva pedidos, produtos, categorias, observações, áreas, configurações e históricos locais. Na v2.1.42, a operação existente também foi importada para o Supabase antes da troca do adaptador.

1. Publique os arquivos web desta branch ou instale o APK da mesma versão.
2. Abra `Configurações avançadas > Conta e sincronização` e conecte a conta já usada no Etiquetas.
3. Aguarde a indicação verde e abra cada módulo uma vez no primeiro aparelho.
4. Confira `Funcionários e Acessos`; funcionários sem permissão protegida permanecem disponíveis no Checklist e não aparecem na autenticação.
5. Em outro aparelho, conecte a mesma conta e confirme a atualização de KDS, Checklist, Compras e Etiquetas.
6. Gere um backup completo antes de qualquer limpeza ou troca de conta.

## Teste recomendado

1. Cadastre uma tarefa para alguns minutos à frente e confirme o alarme em outro módulo.
2. Use `Iniciar`, aguarde um pouco e conclua; o relatório deve mostrar o tempo gasto.
3. Desligue o Wi-Fi, conclua uma tarefa e confirme a indicação de envio pendente.
4. Feche e reabra o app ainda offline; a conclusão deve continuar salva.
5. Ligue o Wi-Fi e confira em outro aparelho que a atividade chega concluída apenas uma vez.
6. Com dois aparelhos, tente agir sobre a mesma tarefa e confirme que o status mais novo prevalece.
7. Marque uma tarefa como remarcável, leve-a para amanhã e confirme que ela sai de `Hoje`, mas continua em `Pendentes`.
8. Marque uma tarefa como POP, conclua com um funcionário e confira o registro em `Relatórios por Tarefas`.

## Publicação

A versão aprovada é publicada na branch `main` do repositório `lincolnpontes/alo_cozinha2`.
