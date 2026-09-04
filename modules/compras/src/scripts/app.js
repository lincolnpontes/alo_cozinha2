history.pushState(null, null, location.href);
    window.addEventListener('popstate', function () { history.pushState(null, null, location.href); });

const executandoNoHost = new URLSearchParams(location.search).get('embedded') === '1';
if (executandoNoHost) document.body.classList.add('embedded-host');

let resolverComprasProntasHost;
const comprasProntasHost = new Promise(resolve => { resolverComprasProntasHost = resolve; });

function aguardarComprasProntasHost() {
    return comprasProntasHost;
}

function operadorSeguroParaHost(operador) {
    return {
        id: operador.id,
        nome: operador.nome,
        emoji: operador.emoji || '👤',
        isAdmin: Boolean(operador.isAdmin),
        podeConfigurarKds: operador.permissoesModulos?.kds?.configuracoes ?? Boolean(operador.isAdmin),
        podeConfigurarChecklist: operador.permissoesModulos?.checklist?.configuracoes ?? Boolean(operador.isAdmin),
        possuiPin: Boolean(operador.senhaHash || operador.senha)
    };
}

async function listarOperadoresComprasPeloHost() {
    await comprasProntasHost;
    return db.colaboradores
        .filter(operador => operador.ativo !== false)
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map(operadorSeguroParaHost);
}

async function autenticarOperadorComprasPeloHost(id, pin, options = {}) {
    await comprasProntasHost;
    const operador = db.colaboradores.find(item => item.id === id && item.ativo !== false);
    if (!operador) return { ok: false, reason: 'not_found' };

    const senhaArmazenada = operador.senhaHash || operador.senha || '';
    if (!(await verificarSenha(String(pin || ''), senhaArmazenada))) return { ok: false, reason: 'invalid_pin' };

    if (operador.senha && !operador.senhaHash) {
        operador.senhaHash = await gerarHashSenha(String(pin || ''));
        delete operador.senha;
        marcarMudancaEstrutural(operador);
        sincronizarFundo(false, true);
    }

    if (options.ativar !== false) {
        pilhaDesfazer = [];
        atualizarBotaoDesfazer();
        db.configs.colabAtivoId = operador.id;
        salvarBanco();
        iniciarApp();
    }
    return { ok: true, operador: operadorSeguroParaHost(operador) };
}

async function encerrarSessaoComprasPeloHost() {
    await comprasProntasHost;
    pilhaDesfazer = [];
    atualizarBotaoDesfazer();
    db.configs.colabAtivoId = null;
    salvarBanco();
    document.querySelectorAll('.modal-overlay').forEach(modal => { modal.style.display = 'none'; });
    notificarHostCompras();
    return true;
}

async function obterBackupComprasPeloHost() {
    await comprasProntasHost;
    const copia = JSON.parse(JSON.stringify(db));
    delete copia.configs.url;
    delete copia.configs.colabAtivoId;
    delete copia.configs.senhaAdmin;
    delete copia.configs.senhaAdminHash;
    return copia;
}

async function obterDadosCompartilhadosComprasPeloHost() {
    await comprasProntasHost;
    return {
        restaurant: JSON.parse(JSON.stringify(db.restaurante || {})),
        people: JSON.parse(JSON.stringify(db.colaboradores || [])),
        products: JSON.parse(JSON.stringify(db.produtos || [])),
        categories: JSON.parse(JSON.stringify(db.categorias || [])),
        historyCount: (db.pedidosAtivos || []).filter(item => item && item.status !== 'rascunho').length
    };
}

async function listarCategoriasComprasPeloHost() {
    await comprasProntasHost;
    return JSON.parse(JSON.stringify((db.categorias || []).filter(categoria => categoria?.ativo !== false)));
}

async function registrarPrecoProdutoComprasPeloHost(produtoId, dados = {}) {
    await comprasProntasHost;
    const produto = db.produtos.find(item => String(item.id) === String(produtoId) && item.ativo !== false);
    const preco = Number(dados.preco || 0);
    if (!produto) throw new Error('Ingrediente não encontrado na Lista de Compras.');
    if (!Number.isFinite(preco) || preco <= 0) throw new Error('Informe um preço válido.');

    const fornecedorId = String(dados.fornecedorId || '');
    const unidade = String(dados.unidade || produto.unidades?.[0] || 'un');
    const agora = agoraServidor();
    produto.historicoPrecos = Array.isArray(produto.historicoPrecos) ? produto.historicoPrecos : [];
    produto.historicoPrecos.push({
        id: `preco_ficha_${agora}_${Math.random().toString(36).slice(2, 7)}`,
        data: getHojeSTR(),
        preco,
        unidade,
        fornecedorId,
        registradoEm: agora,
        atualizadoEm: agora
    });
    if (fornecedorId) produto.fornecedores = Array.from(new Set([...(produto.fornecedores || []), fornecedorId]));
    marcarMudancaEstrutural(produto);
    sincronizarFundo(false, true);
    return JSON.parse(JSON.stringify(produto));
}

function hashCentralCompras(pessoa) {
    const alternativas = pessoa?.credentials?.alternatives || [];
    return alternativas.find(item => item.scheme === 'pbkdf2-sha256')?.hash || '';
}

async function aplicarPessoasCompartilhadasComprasPeloHost(pessoas) {
    await comprasProntasHost;
    const recebidas = Array.isArray(pessoas) ? pessoas : [];
    const acessos = recebidas.filter(pessoa => pessoa?.podeEntrar === true && (pessoa?.isAdmin || pessoa?.permissions?.compras?.acesso === true));
    const antes = JSON.stringify(db.colaboradores || []);
    acessos.forEach(pessoa => {
        const idVinculado = String(pessoa?.links?.comprasId || '');
        let operador = db.colaboradores.find(item => item.coreId === pessoa.id)
            || db.colaboradores.find(item => idVinculado && item.id === idVinculado)
            || db.colaboradores.find(item => removerAcentos(item.nome || '').toLowerCase().trim() === removerAcentos(pessoa.nome || '').toLowerCase().trim());
        if (!operador) {
            operador = { id: idVinculado || `core_${pessoa.id}`, telefone: '', catsPermitidas: [] };
            db.colaboradores.push(operador);
        }
        const permissions = pessoa.permissions || {};
        const compras = permissions.compras || {};
        operador.coreId = pessoa.id;
        operador.nome = pessoa.nome;
        operador.emoji = pessoa.emoji || '👤';
        operador.ativo = pessoa.ativo !== false && pessoa.podeEntrar === true;
        operador.isAdmin = Boolean(pessoa.isAdmin);
        operador.permissoesModulos = {
            ...(operador.permissoesModulos || {}),
            kds: { configuracoes: Boolean(permissions.kds?.configuracoes) },
            checklist: { configuracoes: Boolean(permissions.checklist?.configuracoes) },
            compras: { pedir: compras.pedir !== false, comprar: compras.comprar !== false, receber: compras.receber !== false },
            l42: JSON.parse(JSON.stringify(permissions.l42 || {}))
        };
        operador.catsPermitidasPedido = Array.isArray(compras.categoriasPedido) ? [...compras.categoriasPedido] : (operador.catsPermitidasPedido || []);
        operador.catsPermitidasCompras = Array.isArray(compras.categoriasCompras) ? [...compras.categoriasCompras] : (operador.catsPermitidasCompras || []);
        operador.catsPermitidasReceber = Array.isArray(compras.categoriasReceber) ? [...compras.categoriasReceber] : (operador.catsPermitidasReceber || operador.catsPermitidasCompras || []);
        const centralHash = hashCentralCompras(pessoa);
        if (centralHash) {
            operador.senhaHash = centralHash;
            delete operador.senha;
        }
        operador.atualizadoEm = Math.max(Number(operador.atualizadoEm || 0), Number(pessoa.atualizadoEm || 0));
    });
    const centralIds = new Set(acessos.map(pessoa => pessoa.id));
    db.colaboradores.forEach(operador => {
        if (operador.coreId && !centralIds.has(operador.coreId)) operador.ativo = false;
    });
    if (JSON.stringify(db.colaboradores || []) === antes) return false;
    marcarMudancaEstrutural();
    salvarBanco();
    sincronizarFundo(false, true);
    return true;
}

async function aplicarRestauranteCompartilhadoComprasPeloHost(restaurante) {
    await comprasProntasHost;
    if (!restaurante?.nome) return false;
    const incomingTimestamp = Number(restaurante.atualizadoEm || 0);
    const currentTimestamp = Number(db.restaurante?.atualizadoEm || 0);
    if (db.restaurante?.nome && incomingTimestamp < currentTimestamp) return false;
    const next = { ...(db.restaurante || {}), ...JSON.parse(JSON.stringify(restaurante)) };
    if (JSON.stringify(next) === JSON.stringify(db.restaurante || {})) return false;
    db.restaurante = next;
    marcarMudancaEstrutural();
    salvarBanco();
    sincronizarFundo(false, true);
    return true;
}

async function ativarPessoaCompartilhadaComprasPeloHost(pessoa) {
    await comprasProntasHost;
    const operador = db.colaboradores.find(item => item.coreId === pessoa.id && item.ativo !== false);
    if (!operador) throw new Error('Este acesso não está habilitado para Compras.');
    pilhaDesfazer = [];
    atualizarBotaoDesfazer();
    db.configs.colabAtivoId = operador.id;
    salvarBanco();
    iniciarApp();
    notificarHostCompras();
    return operadorSeguroParaHost(operador);
}

function obterEstadoHostCompras() {
    const operador = db.colaboradores.find(c => c.id === db.configs.colabAtivoId && c.ativo !== false);
    const permissions = getPermissoesComprasColab(operador);
    return {
        mode: ['pedido', 'compras', 'receber'].includes(db.configs.modo) ? db.configs.modo : 'pedido',
        receiveModeEnabled: db.configs.modoReceberAtivo === true,
        canOrder: permissions.pedir,
        canBuy: permissions.comprar,
        canReceive: permissions.receberModo,
        profileName: operador?.nome || 'Perfil',
        profileEmoji: operador?.emoji || '👤',
        syncState: window.AloDemo?.isActive?.() ? 'sincronizado' : (db.configs.url ? 'sincronizando' : 'local'),
        syncMessage: window.AloDemo?.isActive?.() ? 'Demonstração pronta' : (db.configs.url ? 'Conferindo dados' : 'Dados somente neste aparelho')
    };
}

function definirModoReceberAtivoPeloHost(enabled) {
    db.configs.modoReceberAtivo = Boolean(enabled);
    if (!db.configs.modoReceberAtivo && db.configs.modo === 'receber') db.configs.modo = 'compras';
    marcarMudancaConfiguracao();
    alterarModo(db.configs.modo);
    sincronizarFundo(false, true);
    return obterEstadoHostCompras();
}

async function configurarNuvemComprasPeloHost(endpoint, options = {}) {
    await comprasProntasHost;
    const url = String(endpoint || '').trim();
    const cloud = window.parent !== window ? window.parent.AloCloud : window.AloCloud;
    if (!url || !cloud?.isEndpoint?.(url)) throw new Error('A conexão segura da Lista de Compras ainda não está pronta.');

    const limiteEspera = Date.now() + 15000;
    while (isSyncingFundo && Date.now() < limiteEspera) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (isSyncingFundo) throw new Error('A Lista de Compras ainda está concluindo uma sincronização.');

    const mudouEndpoint = String(db.configs.url || '') !== url;
    if (mudouEndpoint) {
        db.configs.url = url;
        db.configs.dadosBaixados = false;
        backendFeiraValidadoEm = 0;
        salvarBanco();
    }

    const precisaAtualizar = options.forcar === true || mudouEndpoint || db.configs.dadosBaixados !== true;
    if (precisaAtualizar) {
        const sincronizou = await sincronizarInicializacao();
        if (!sincronizou) throw new Error('Não foi possível baixar a Lista de Compras desta conta.');
    }

    if (precisaAtualizar || options.render === true) iniciarApp();
    return {
        ok: true,
        revision: Number(db.syncRevision || 0),
        produtos: (db.produtos || []).length,
        categorias: (db.categorias || []).length,
        fornecedores: (db.fornecedores || []).length,
        pedidos: (db.pedidosAtivos || []).filter(item => item?.status !== 'rascunho').length
    };
}

function notificarHostCompras() {
    if (!executandoNoHost || window.parent === window) return;
    window.parent.AloFeiraModule?.updateHeader(obterEstadoHostCompras());
}

async function abrirNovoProdutoParaFichaPeloHost() {
    await comprasProntasHost;
    abrirFormProduto(null, 'ficha_tecnica');
    return true;
}

function retornarProdutoParaFichaTecnicaPeloHost(produto = null) {
    if (!executandoNoHost || window.parent === window) return false;
    if (produto?.id) {
        obterDadosCompartilhadosComprasPeloHost()
            .then(snapshot => window.parent.AloSharedData?.updateFromModule('compras', snapshot))
            .catch(() => {});
    }
    window.parent.AloTechnicalSheets?.returnFromPurchaseProduct(produto);
    return true;
}

function voltarParaConfiguracoesHost() {
    if (executandoNoHost && window.parent !== window) {
        obterDadosCompartilhadosComprasPeloHost().then(snapshot => window.parent.AloSharedData?.updateFromModule('compras', snapshot)).catch(() => {});
        window.parent.AloFeiraModule?.backToSettings();
        return;
    }
    document.getElementById('modalPainelUnificado').style.display = 'flex';
}

async function excluirHistoricoPeloHost() {
    const backup = JSON.parse(JSON.stringify(db));
    db.configs.historicoApagadoEm = agoraServidor();
    db.pedidosAtivos = [];
    db.produtos = db.produtos.filter(produto => !produto.avulso);
    marcarMudancaEstrutural();
    salvarBanco();
    try {
        if (db.configs.url) {
            isSyncingFundo = true;
            await postarBanco();
        }
        renderizarLista();
        notificarHostCompras();
        return true;
    } catch (error) {
        db = backup;
        salvarBanco();
        throw error;
    } finally {
        isSyncingFundo = false;
    }
}

window.onload = async () => {
    document.addEventListener('pointerdown', () => {
        if (executandoNoHost && window.parent !== window) window.parent.AloFeiraModule?.closeModePicker?.();
    }, true);
    ativarAtualizacaoAutomatica();
    await sincronizarInicializacao();
    if (executandoNoHost) {
        db.configs.colabAtivoId = null;
        salvarBanco();
        iniciarApp();
        ocultarSplash(true);
        resolverComprasProntasHost(true);
        notificarHostCompras();
        return;
    }
    if(db.configs.exigirColaborador) {
        abrirSelecaoColaboradorInicial(false);
    } else {
        const admin = db.colaboradores.find(c => c.ativo !== false && c.isAdmin);
        db.configs.colabAtivoId = admin ? admin.id : null;
        iniciarApp();
    }
    ocultarSplash();
    resolverComprasProntasHost(true);
};

function ocultarSplash(imediato = false) {
    const splash = document.getElementById('splashScreen');
    if (imediato) {
        splash.style.display = 'none';
        return;
    }
    splash.style.opacity = '0';
    setTimeout(() => { splash.style.display = 'none'; }, 500);
}

async function ativarAtualizacaoAutomatica() {
    if(!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const jaControlado = Boolean(navigator.serviceWorker.controller);
    let recarregando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if(!jaControlado || recarregando) return;
        recarregando = true;
        location.reload();
    });
    try {
        const registro = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
        await registro.update();
    } catch(error) {
        console.error('Falha ao ativar modo offline', error);
    }
}

function iniciarApp() {
    document.getElementById('seletorModo').value = db.configs.modo;
    document.getElementById('configExigirColab').checked = db.configs.exigirColaborador;
    alterarModo(db.configs.modo);
    atualizarEstadoSync(db.configs.url ? 'oculto' : 'local', db.configs.url ? 'Sincronização configurada' : 'Dados somente neste aparelho');
    notificarHostCompras();
    setTimeout(() => sincronizarFundo(), 300);
}
