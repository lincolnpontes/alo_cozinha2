history.pushState(null, null, location.href);
    window.addEventListener('popstate', function () { history.pushState(null, null, location.href); });

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
    setTimeout(() => sincronizarFundo(), 300);
}
