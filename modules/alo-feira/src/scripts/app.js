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

function obterEstadoHostCompras() {
    const operador = db.colaboradores.find(c => c.id === db.configs.colabAtivoId && c.ativo !== false);
    return {
        mode: db.configs.modo === 'compras' ? 'compras' : 'pedido',
        profileName: operador?.nome || 'Perfil',
        profileEmoji: operador?.emoji || '👤'
    };
}

function notificarHostCompras() {
    if (!executandoNoHost || window.parent === window) return;
    window.parent.AloFeiraModule?.updateHeader(obterEstadoHostCompras());
}

function voltarParaConfiguracoesHost() {
    if (executandoNoHost && window.parent !== window) {
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
    ativarAtualizacaoAutomatica();
    await sincronizarInicializacao();
    if (executandoNoHost) {
        db.configs.colabAtivoId = null;
        salvarBanco();
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
