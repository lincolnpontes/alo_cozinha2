(function (global) {
    const FLAG_KEY = 'alo_demo_mode_v1';
    const SEEDED_KEY = 'alo_demo_seeded_v3';
    const PREFIX = 'alo_demo_v3:';
    const storagePrototype = global.Storage?.prototype;
    const idbPrototype = global.IDBFactory?.prototype;

    if (!storagePrototype) return;

    const nativeStorage = {
        getItem: storagePrototype.getItem,
        setItem: storagePrototype.setItem,
        removeItem: storagePrototype.removeItem,
        clear: storagePrototype.clear
    };
    const enabled = nativeStorage.getItem.call(global.localStorage, FLAG_KEY) === '1';
    const unscopedKeys = new Set([FLAG_KEY, 'alo_cloud_device_id_v1', 'alo_supabase_device_id']);

    function scopedKey(key) {
        const text = String(key);
        return enabled && !unscopedKeys.has(text) ? `${PREFIX}${text}` : text;
    }

    storagePrototype.getItem = function (key) {
        return nativeStorage.getItem.call(this, this === global.localStorage ? scopedKey(key) : key);
    };
    storagePrototype.setItem = function (key, value) {
        return nativeStorage.setItem.call(this, this === global.localStorage ? scopedKey(key) : key, value);
    };
    storagePrototype.removeItem = function (key) {
        return nativeStorage.removeItem.call(this, this === global.localStorage ? scopedKey(key) : key);
    };
    storagePrototype.clear = function () {
        if (this !== global.localStorage || !enabled) return nativeStorage.clear.call(this);
        const keys = [];
        for (let index = 0; index < this.length; index += 1) {
            const key = this.key(index);
            if (key?.startsWith(PREFIX)) keys.push(key);
        }
        keys.forEach(key => nativeStorage.removeItem.call(this, key));
    };

    if (enabled && idbPrototype) {
        const nativeOpen = idbPrototype.open;
        const nativeDeleteDatabase = idbPrototype.deleteDatabase;
        idbPrototype.open = function (name, version) {
            const scopedName = this === global.indexedDB ? `${PREFIX}${String(name)}` : name;
            return version === undefined
                ? nativeOpen.call(this, scopedName)
                : nativeOpen.call(this, scopedName, version);
        };
        idbPrototype.deleteDatabase = function (name) {
            const scopedName = this === global.indexedDB ? `${PREFIX}${String(name)}` : name;
            return nativeDeleteDatabase.call(this, scopedName);
        };
    }

    function isoAt(hour, minute) {
        const value = new Date();
        value.setHours(hour, minute, 0, 0);
        return value.toISOString();
    }

    function dateKey() {
        const value = new Date();
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }

    function seed() {
        if (!enabled || localStorage.getItem(SEEDED_KEY) === '1') return;
        const now = Date.now();
        const today = dateKey();
        const areas = [
            { id: 'panelas', nome: 'Self-service', emoji: '🥘', tipo: 'envio', ativo: true, modulos: { kds: true, checklist: false } },
            { id: 'cozinha', nome: 'Cozinha', emoji: '🧑‍🍳', tipo: 'recebimento', ativo: true, modulos: { kds: true, checklist: true } },
            { id: 'salao', nome: 'Salão', emoji: '🍽️', tipo: 'envio', ativo: true, modulos: { kds: false, checklist: true } }
        ];
        const people = [
            { id: 'demo_ana', nome: 'Ana', emoji: '👩‍🍳', ativo: true, isAdmin: true, setorIds: ['cozinha'] },
            { id: 'demo_carlos', nome: 'Carlos', emoji: '👨', ativo: true, isAdmin: false, setorIds: ['salao'] }
        ];
        const mainDatabase = {
            produtos: [
                { nome: 'Feijão', categoria: 'Panelas', obsEspec: ['Sem bacon'], areasOrigem: ['panelas'], areaOrigem: 'panelas', areaDestino: 'cozinha' },
                { nome: 'Arroz', categoria: 'Panelas', obsEspec: [], areasOrigem: ['panelas'], areaOrigem: 'panelas', areaDestino: 'cozinha' },
                { nome: 'Frango grelhado', categoria: 'Pratos', obsEspec: ['Bem passado'], areasOrigem: ['panelas'], areaOrigem: 'panelas', areaDestino: 'cozinha' },
                { nome: 'Purê de batata', categoria: 'Guarnições', obsEspec: [], areasOrigem: ['panelas'], areaOrigem: 'panelas', areaDestino: 'cozinha' },
                { nome: 'Farofa da casa', categoria: 'Guarnições', obsEspec: ['Sem cebola'], areasOrigem: ['panelas'], areaOrigem: 'panelas', areaDestino: 'cozinha' }
            ],
            categorias: [
                { nome: 'Panelas', cor: '#f0c34e', corTexto: '#2d2d2d' },
                { nome: 'Pratos', cor: '#5f8d79', corTexto: '#ffffff' },
                { nome: 'Guarnições', cor: '#9a6b52', corTexto: '#ffffff' }
            ],
            obsPedidos: ['Sem sal', 'Pouco óleo'],
            obsCancelamentos: ['Falta de insumo', 'Pedido corrigido'],
            areas,
            setoresTarefas: areas.filter(area => area.modulos.checklist),
            funcionarios: people,
            tarefas: [
                { id: 'demo_task_temp', nome: 'Conferir temperatura das geladeiras', setorId: 'cozinha', funcionarioId: 'demo_ana', ativo: true, prioridade: 'alta', tempoEsperadoMin: 10, instrucoes: '<b>Meça e registre</b> a temperatura de cada equipamento.', programacoes: [{ id: 'manha', horario: '08:00', recorrencia: 'diaria', dias: [0,1,2,3,4,5,6], dataInicio: today, alarme: true }] },
                { id: 'demo_task_bancada', nome: 'Higienizar bancadas de preparo', setorId: 'cozinha', funcionarioId: 'demo_ana', ativo: true, prioridade: 'normal', tempoEsperadoMin: 12, instrucoes: 'Retire resíduos, lave, enxágue e aplique o sanitizante.', programacoes: [{ id: 'antes_almoco', horario: '10:30', recorrencia: 'diaria', dias: [0,1,2,3,4,5,6], dataInicio: today, alarme: false }] },
                { id: 'demo_task_salao', nome: 'Organizar mesas antes da abertura', setorId: 'salao', funcionarioId: 'demo_carlos', ativo: true, prioridade: 'normal', tempoEsperadoMin: 15, instrucoes: 'Limpar mesas, alinhar cadeiras e conferir os itens.', programacoes: [{ id: 'abertura', horario: '09:00', recorrencia: 'diaria', dias: [0,1,2,3,4,5,6], dataInicio: today, alarme: false }] },
                { id: 'demo_task_banheiros', nome: 'Conferir limpeza dos banheiros', setorId: 'salao', funcionarioId: 'demo_carlos', ativo: true, prioridade: 'alta', tempoEsperadoMin: 10, instrucoes: 'Verifique limpeza, sabonete, papel e lixeira.', programacoes: [{ id: 'meio_turno', horario: '12:00', recorrencia: 'diaria', dias: [0,1,2,3,4,5,6], dataInicio: today, alarme: false }] }
            ],
            coreCompartilhado: null,
            configsTarefas: { som: 'beep', volume: '70', repeticaoMinutos: '5' },
            configs: {
                modo: 'panelas', areaAtual: 'panelas', url: '', senhaModo: '', somCozinha: 'sem_som', somPanelas: 'sem_som',
                volumeCozinha: '100', volumePanelas: '70', dadosBaixados: true, bancoPendente: false, revisaoBanco: 0,
                suporteDadosCompartilhados: true, telaAtiva: 'sim', inatividade: '0', reenvio: 'permitido',
                loginObrigatorioModulos: { kds: false, checklist: false, compras: false, l42: false },
                loginObrigatorioChecklistVisoes: { documentos: false, geral: false },
                modulosVisiveis: { kds: true, checklist: true, compras: true, l42: true }
            }
        };
        const sharedState = {
            schemaVersion: 2, revision: 1, updatedAt: now,
            restaurant: { nome: 'Restaurante Demonstração', cidade: 'Sua cidade', uf: 'PB' },
            people: people.map(person => ({
                id: person.id, nome: person.nome, emoji: person.emoji, ativo: true, podeEntrar: true, isAdmin: person.isAdmin,
                credentials: { alternatives: [] },
                permissions: {
                    kds: { configuracoes: true }, checklist: { configuracoes: true, funcionario: true, setorIds: person.setorIds },
                    compras: { acesso: true, receber: true, comprar: true, categoriasPedido: [], categoriasCompras: [] },
                    l42: { acesso: true, imprimir: true, estoque: true, darBaixa: true, movimentacao: true, relatorios: true, produtos: true, categorias: true, estilo: true, configuracoes: true, operadores: false, avancado: true }
                },
                links: { comprasId: person.id, l42Nome: person.nome, checklistId: person.id }, atualizadoEm: now
            })),
            catalog: [], sourceStats: {}, migration: { identitiesMerged: true, catalogIndexed: true }
        };
        const orders = [
            { id: 'demo_pedido_1', produto: 'Feijão', status: 'pendente', timestamp: isoAt(11, 30), atualizadoEm: isoAt(11, 30), revisao: 1, areaOrigem: 'panelas', areaDestino: 'cozinha' },
            { id: 'demo_pedido_2', produto: 'Arroz (Obs: Pouco óleo)', status: 'fazendo', timestamp: isoAt(11, 34), atualizadoEm: isoAt(11, 36), revisao: 2, areaOrigem: 'panelas', areaDestino: 'cozinha' },
            { id: 'demo_pedido_3', produto: 'Frango grelhado', status: 'buscar', timestamp: isoAt(11, 38), atualizadoEm: isoAt(11, 43), finalizadoEm: isoAt(11, 43), revisao: 3, areaOrigem: 'panelas', areaDestino: 'cozinha' }
        ];
        const activities = [
            { id: `atividade_demo_task_temp_manha_${today}`, tarefaId: 'demo_task_temp', programacaoId: 'manha', nome: 'Conferir temperatura das geladeiras', setorId: 'cozinha', funcionarioId: 'demo_ana', funcionarioNome: 'Ana', status: 'pendente', data: today, horario: '08:00', alarmeStatus: 'dispensado', prioridade: 'alta', tempoEsperadoMin: 10, atualizadoEm: new Date(now).toISOString(), revisao: 1, syncState: 'confirmed' },
            { id: `atividade_demo_task_bancada_antes_almoco_${today}`, tarefaId: 'demo_task_bancada', programacaoId: 'antes_almoco', nome: 'Higienizar bancadas de preparo', setorId: 'cozinha', funcionarioId: 'demo_ana', funcionarioNome: 'Ana', status: 'em_execucao', data: today, horario: '10:30', iniciadoEm: isoAt(10, 31), alarmeStatus: 'reconhecido', prioridade: 'normal', tempoEsperadoMin: 12, atualizadoEm: isoAt(10, 31), revisao: 2, syncState: 'confirmed' },
            { id: `atividade_demo_task_salao_abertura_${today}`, tarefaId: 'demo_task_salao', programacaoId: 'abertura', nome: 'Organizar mesas antes da abertura', setorId: 'salao', funcionarioId: 'demo_carlos', funcionarioNome: 'Carlos', status: 'concluida', data: today, horario: '09:00', iniciadoEm: isoAt(8, 52), finalizadoEm: isoAt(9, 4), duracaoSegundos: 720, atualizadoEm: isoAt(9, 4), revisao: 2, syncState: 'confirmed' },
            { id: `atividade_demo_task_banheiros_meio_turno_${today}`, tarefaId: 'demo_task_banheiros', programacaoId: 'meio_turno', nome: 'Conferir limpeza dos banheiros', setorId: 'salao', funcionarioId: 'demo_carlos', funcionarioNome: 'Carlos', status: 'pendente', data: today, horario: '12:00', alarmeStatus: 'dispensado', prioridade: 'alta', tempoEsperadoMin: 10, atualizadoEm: new Date(now).toISOString(), revisao: 1, syncState: 'confirmed' }
        ];
        const compras = {
            app_id: 'alofeira', schemaVersion: 2, syncRevision: 0,
            restaurante: { nome: 'Restaurante Demonstração', cidade: 'Sua cidade', uf: 'PB' },
            categorias: [
                { id: 'cat_secos', nome: 'Secos', cor: '#b63ab8', corTexto: '#ffffff', ativo: true, ordem: 0, subcategorias: [] },
                { id: 'cat_hortifruti', nome: 'Hortifruti', cor: '#3f8f63', corTexto: '#ffffff', ativo: true, ordem: 1, subcategorias: [] },
                { id: 'cat_limpeza', nome: 'Limpeza', cor: '#367ca5', corTexto: '#ffffff', ativo: true, ordem: 2, subcategorias: [] }
            ],
            fornecedores: [{ id: 'forn_central', nome: 'Distribuidora Central', vendedor: 'João', telefone: '', ativo: true }],
            colaboradores: [{ id: 'demo_ana', nome: 'Ana', emoji: '👩‍🍳', ativo: true, isAdmin: true, catsPermitidasPedido: ['cat_secos','cat_hortifruti','cat_limpeza'], catsPermitidasCompras: ['cat_secos','cat_hortifruti','cat_limpeza'] }],
            produtos: [
                { id: 'prod_arroz', nome: 'Arroz parboilizado', categoria: 'cat_secos', unidades: ['kg'], qtdPadrao: 10, fornecedores: ['forn_central'], ativo: true, historicoPrecos: [{ id: 'preco_arroz', data: today, preco: 6.49, unidade: 'kg', fornecedorId: 'forn_central', registradoEm: now, atualizadoEm: now }] },
                { id: 'prod_tomate', nome: 'Tomate', categoria: 'cat_hortifruti', unidades: ['kg'], qtdPadrao: 4, fornecedores: ['forn_central'], ativo: true, historicoPrecos: [{ id: 'preco_tomate', data: today, preco: 7.9, unidade: 'kg', fornecedorId: 'forn_central', registradoEm: now, atualizadoEm: now }] },
                { id: 'prod_leite', nome: 'Leite condensado', categoria: 'cat_secos', unidades: ['un'], qtdPadrao: 12, fornecedores: ['forn_central'], ativo: true, historicoPrecos: [{ id: 'preco_leite', data: today, preco: 6.2, unidade: 'un', fornecedorId: 'forn_central', registradoEm: now, atualizadoEm: now }] },
                { id: 'prod_oleo', nome: 'Óleo de soja', categoria: 'cat_secos', unidades: ['un'], qtdPadrao: 6, fornecedores: ['forn_central'], ativo: true, historicoPrecos: [{ id: 'preco_oleo', data: today, preco: 8.7, unidade: 'un', fornecedorId: 'forn_central', registradoEm: now, atualizadoEm: now }] },
                { id: 'prod_cebola', nome: 'Cebola', categoria: 'cat_hortifruti', unidades: ['kg'], qtdPadrao: 3, fornecedores: ['forn_central'], ativo: true, historicoPrecos: [{ id: 'preco_cebola', data: today, preco: 5.4, unidade: 'kg', fornecedorId: 'forn_central', registradoEm: now, atualizadoEm: now }] },
                { id: 'prod_detergente', nome: 'Detergente neutro', categoria: 'cat_limpeza', unidades: ['un'], qtdPadrao: 8, fornecedores: ['forn_central'], ativo: true, historicoPrecos: [{ id: 'preco_detergente', data: today, preco: 2.6, unidade: 'un', fornecedorId: 'forn_central', registradoEm: now, atualizadoEm: now }] }
            ],
            pedidosAtivos: [
                { idUnico: `demo_${now}_arroz`, produtoId: 'prod_arroz', qtd: 10, unidade: 'kg', status: 'rascunho', dataStatus: now },
                { idUnico: `demo_${now}_tomate`, produtoId: 'prod_tomate', qtd: 4, unidade: 'kg', status: 'pendente', dataEnvio: now - 3600000, dataStatus: now - 3600000 }
            ],
            configs: { modo: 'pedido', senhaAdminHash: '', exigirColaborador: false, agruparComprasPorStatus: true, colabAtivoId: 'demo_ana', url: '', dadosBaixados: true, ultimaMudancaLocal: 0, historicoApagadoEm: 0, ultimoSyncConfirmado: 0, relogioServidorOffset: 0, relogioServidorSincronizadoEm: 0, backendComControleRevisao: false, atualizadoEm: 0, syncPendente: false }
        };
        const technicalSheets = {
            revision: 0, outbox: [], categories: ['Sobremesas', 'Pratos principais'],
            categoryColors: { Sobremesas: '#8a4f7d', 'Pratos principais': '#337a62' },
            categoryTextColors: { Sobremesas: '#ffffff', 'Pratos principais': '#ffffff' },
            sheets: [{
                id: 'demo_sheet_pudim', nome: 'Pudim de leite', categoria: 'Sobremesas', setorId: 'cozinha', rendimento: 12, rendimentoUnidade: 'porções', porcao: 1, porcaoUnidade: 'fatia', precoVenda: 8,
                ingredientes: [
                    { id: 'ing_leite', produtoId: 'prod_leite', nome: 'Leite condensado', quantidade: 2, unidade: 'un', perda: 0, precoInformado: 6.2, precoUnidade: 'un', fornecedorId: 'forn_central' },
                    { id: 'ing_ovos', produtoId: '', nome: 'Ovos', quantidade: 6, unidade: 'un', perda: 0, precoInformado: 0.8, precoUnidade: 'un', fornecedorId: '' }
                ],
                preparo: '<b>Bata os ingredientes</b>, caramelize a forma e asse em banho-maria.', atualizadoEm: now, revisao: 1
            }, {
                id: 'demo_sheet_frango', nome: 'Frango grelhado da casa', categoria: 'Pratos principais', setorId: 'cozinha', rendimento: 10, rendimentoUnidade: 'porções', porcao: 180, porcaoUnidade: 'g', precoVenda: 24,
                ingredientes: [
                    { id: 'ing_frango', produtoId: '', nome: 'Filé de frango', quantidade: 2, unidade: 'kg', perda: 8, precoInformado: 18.9, precoUnidade: 'kg', fornecedorId: '' },
                    { id: 'ing_oleo', produtoId: 'prod_oleo', nome: 'Óleo de soja', quantidade: 0.08, unidade: 'l', perda: 0, precoInformado: 8.7, precoUnidade: 'un', fornecedorId: 'forn_central' }
                ],
                preparo: 'Tempere, deixe descansar por 20 minutos e grelhe até atingir o ponto seguro.', atualizadoEm: now, revisao: 1
            }]
        };
        const documents = {
            revision: 0, outbox: [], documents: [
                { id: 'demo_doc_alvara', templateId: 'alvara-sanitario', nome: 'Alvará sanitário', categoria: 'Licenças', orgao: 'Vigilância Sanitária Municipal', numero: 'DEMO-2026/001', emitidoEm: today, venceEm: `${new Date().getFullYear() + 1}-12-31`, observacoes: 'Exemplo fictício criado somente para apresentar o módulo.', arquivo: { nome:'alvara-sanitario-ficticio.png', mime:'image/png', tamanho:145000, atualizadoEm:now, demoUrl:'assets/demo/alvara-sanitario-ficticio.png?v=2.1.47' }, atualizadoEm: now, revisao: 1 },
                { id: 'demo_doc_contrato', templateId: 'ato-constitutivo', nome: 'Contrato social ou ato constitutivo', categoria: 'Empresa e Fiscal', orgao: 'Junta Comercial', numero: 'DEMO-NIRE-0001', emitidoEm: today, venceEm: '', observacoes: 'Documento totalmente fictício para demonstração.', arquivo: { nome:'contrato-social-ficticio.png', mime:'image/png', tamanho:138000, atualizadoEm:now, demoUrl:'assets/demo/contrato-social-ficticio.png?v=2.1.47' }, atualizadoEm: now, revisao: 1 }
            ]
        };
        const labels = {
            produtos: [
                { codigo: '1', nome: 'Pudim de leite', categoria: 'Sobremesas', validadeDias: 5, armazenamento: 'Refrigerado', precoPadrao: 0, marcas: [], acaoPadrao: 'Produzido', usaQR: true, fichaTecnicaId: 'demo_sheet_pudim' },
                { codigo: '2', nome: 'Molho de tomate', categoria: 'Preparos', validadeDias: 3, armazenamento: 'Refrigerado', precoPadrao: 0, marcas: [], acaoPadrao: 'Produzido', usaQR: true },
                { codigo: '3', nome: 'Frango temperado', categoria: 'Preparos', validadeDias: 2, armazenamento: 'Refrigerado', precoPadrao: 0, marcas: [], acaoPadrao: 'Aberto', usaQR: true, fichaTecnicaId: 'demo_sheet_frango' },
                { codigo: '4', nome: 'Feijão cozido', categoria: 'Preparos', validadeDias: 3, armazenamento: 'Refrigerado', precoPadrao: 0, marcas: [], acaoPadrao: 'Produzido', usaQR: true }
            ],
            categorias: [{ nome: 'Sobremesas', cor: '#8a4f7d', corTexto: '#ffffff' }, { nome: 'Preparos', cor: '#337a62', corTexto: '#ffffff' }],
            operadores: [{ nome: 'Ana', emoji: '👩‍🍳', ativo: true, admin: true }],
            configs: { nomeEmpresa: 'Restaurante Demonstração', impressora: 'Elgin L42 Pro Full', controleEstoqueQR: true },
            historico: []
        };

        localStorage.setItem('kds_v1_db', JSON.stringify(mainDatabase));
        localStorage.setItem('alo_core_shared_v2', JSON.stringify(sharedState));
        localStorage.setItem('kds_pedidos_local', JSON.stringify(orders));
        localStorage.setItem('kds_fila_status', '[]');
        localStorage.setItem('alo_tasks_activities_v2', JSON.stringify(activities));
        localStorage.setItem('alo_tasks_outbox_v2', '[]');
        localStorage.setItem('alo_tasks_revision_v2', '');
        localStorage.setItem('alo_checklist_technical_sheets_v1', JSON.stringify(technicalSheets));
        localStorage.setItem('alo_checklist_documents_v1', JSON.stringify(documents));
        localStorage.setItem('alofeira_v1', JSON.stringify(compras));
        localStorage.setItem('etiquetadora_db', JSON.stringify(labels));
        localStorage.setItem(SEEDED_KEY, '1');
    }

    function enter() {
        nativeStorage.setItem.call(global.localStorage, FLAG_KEY, '1');
        global.location.reload();
    }

    function exit() {
        nativeStorage.removeItem.call(global.localStorage, FLAG_KEY);
        global.location.reload();
    }

    global.AloDemo = Object.freeze({ isActive: () => enabled, enter, exit });
    seed();
})(window);
