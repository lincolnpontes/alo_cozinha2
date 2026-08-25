history.pushState(null, null, location.href);
    window.addEventListener('popstate', function () { history.pushState(null, null, location.href); });

const executandoNoHost = new URLSearchParams(location.search).get('embedded') === '1';
if (executandoNoHost) document.body.classList.add('embedded-host');

function obterEstadoHostCompras() {
    const operador = db.colaboradores.find(c => c.id === db.configs.colabAtivoId && c.ativo !== false);
    return {
        mode: db.configs.modo === 'compras' ? 'compras' : 'pedido',
        profileName: operador?.nome || 'Perfil',
        profileEmoji: operador?.emoji || '👤',
        requireOperator: Boolean(db.configs.exigirColaborador)
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

function definirExigenciaOperadorHost(enabled) {
    db.configs.exigirColaborador = Boolean(enabled);
    const input = document.getElementById('configExigirColab');
    if (input) input.checked = Boolean(enabled);
    marcarMudancaConfiguracao();
    salvarBanco();
    notificarHostCompras();
    sincronizarFundo(false, true);
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
    if(db.configs.exigirColaborador) {
        abrirSelecaoColaboradorInicial(false);
    } else {
        const admin = db.colaboradores.find(c => c.ativo !== false && c.isAdmin);
        db.configs.colabAtivoId = admin ? admin.id : null;
        iniciarApp();
    }
    ocultarSplash();
};

function ocultarSplash() {
    const splash = document.getElementById('splashScreen');
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
