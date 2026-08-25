let backendFeiraValidadoEm = 0;

function atualizarEstadoSync(estado, mensagem) {
    const indicador = document.getElementById('syncIndicador');
    if(!indicador) return;
    indicador.className = `sync-indicador ${estado}`;
    indicador.title = mensagem || '';
    indicador.setAttribute('aria-label', mensagem || 'Estado da sincronização');
    if(typeof notificarHostCompras === 'function' && executandoNoHost && window.parent !== window) {
        window.parent.AloFeiraModule?.updateHeader({ ...obterEstadoHostCompras(), syncState: estado, syncMessage: mensagem || '' });
    }
}

async function fetchComTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } finally {
        clearTimeout(timer);
    }
}

async function lerRespostaJson(response) {
    if(!response.ok) throw new Error(`Servidor respondeu ${response.status}.`);
    const texto = await response.text();
    try { return JSON.parse(texto); }
    catch(e) { throw new Error('O servidor devolveu uma resposta inválida.'); }
}

function prepararBancoParaNuvem() {
    const copia = JSON.parse(JSON.stringify(db));
    copia.pedidosAtivos = copia.pedidosAtivos.filter(p => p.status !== 'rascunho');
    const configsLocais = ['url', 'colabAtivoId', 'modo', 'dadosBaixados', 'ultimaMudancaLocal', 'ultimoSyncConfirmado', 'syncPendente', 'relogioServidorOffset', 'relogioServidorSincronizadoEm', 'backendComControleRevisao', 'importacaoInicialPendente'];
    configsLocais.forEach(campo => delete copia.configs[campo]);
    delete copia.configs.senhaAdmin;
    delete copia.serverNow;
    return copia;
}

function aplicarConfirmacaoServidor(resposta, inicioRequisicao, fimRequisicao) {
    registrarRelogioServidor(resposta && resposta.serverNow, inicioRequisicao, fimRequisicao);
    (resposta && resposta.pedidosAtualizados || []).forEach(atualizacao => {
        const pedido = db.pedidosAtivos.find(pa => pa.idUnico === atualizacao.idUnico);
        if(!pedido) return;
        ['dataStatus', 'dataEnvio', 'dataPedidoFornecedor', 'dataConclusao', 'dataExclusao'].forEach(campo => {
            if(Object.prototype.hasOwnProperty.call(atualizacao, campo)) {
                if(atualizacao[campo] === null) delete pedido[campo];
                else pedido[campo] = atualizacao[campo];
            }
        });
    });
    const tempos = resposta && resposta.temposEstruturais || {};
    ['produtos', 'categorias', 'fornecedores', 'colaboradores'].forEach(nome => {
        (tempos[nome] || []).forEach(atualizacao => {
            const registro = (db[nome] || []).find(item => item.id === atualizacao.id);
            if(registro) registro.atualizadoEm = atualizacao.atualizadoEm;
        });
    });
    if(resposta && resposta.restauranteAtualizadoEm) db.restaurante.atualizadoEm = resposta.restauranteAtualizadoEm;
    if(resposta && resposta.configAtualizadoEm) db.configs.atualizadoEm = resposta.configAtualizadoEm;
}

function mesclarColecao(locais, remotos) {
    const mapa = new Map();
    (remotos || []).forEach(item => { if(item && item.id) mapa.set(item.id, item); });
    (locais || []).forEach(item => {
        if(!item || !item.id) return;
        const remoto = mapa.get(item.id);
        const localTs = Number(item.atualizadoEm || 0);
        const remotoTs = Number(remoto && remoto.atualizadoEm || 0);
        if(!remoto || localTs > remotoTs) mapa.set(item.id, item);
    });
    return Array.from(mapa.values());
}

function mesclarProdutos(locais, remotos) {
    const produtos = mesclarColecao(locais, remotos).map(item => JSON.parse(JSON.stringify(item)));
    const locaisPorId = new Map((locais || []).map(item => [item.id, item]));
    const remotosPorId = new Map((remotos || []).map(item => [item.id, item]));
    produtos.forEach(produto => {
        const local = locaisPorId.get(produto.id);
        const remoto = remotosPorId.get(produto.id);
        if(!local || !remoto) return;
        const exclusoes = Object.assign({}, remoto.precosExcluidos || {});
        Object.entries(local.precosExcluidos || {}).forEach(([id, timestamp]) => {
            exclusoes[id] = Math.max(Number(exclusoes[id] || 0), Number(timestamp || 0));
        });
        produto.precosExcluidos = exclusoes;
        produto.historicoPrecos = AloFeiraDomain.mesclarHistoricosPrecos(
            local.historicoPrecos,
            remoto.historicoPrecos,
            exclusoes,
            local.atualizadoEm,
            remoto.atualizadoEm
        );
        const fornecedoresDePrecos = produto.historicoPrecos.map(item => item.fornecedorId).filter(Boolean);
        produto.fornecedores = Array.from(new Set([...(produto.fornecedores || []), ...fornecedoresDePrecos]));
    });
    return produtos;
}

function mesclarBancos(local, remotoBruto) {
    const remoto = normalizarBanco(remotoBruto);
    const localNormalizado = normalizarBanco(local);
    const corteHistorico = Math.max(
        Number(localNormalizado.configs.historicoApagadoEm || 0),
        Number(remoto.configs.historicoApagadoEm || 0)
    );
    const pedidos = AloFeiraDomain.mesclarPedidos(
        localNormalizado.pedidosAtivos,
        remoto.pedidosAtivos,
        corteHistorico
    );
    const pedidosRemotos = AloFeiraDomain.mesclarPedidos([], remoto.pedidosAtivos, corteHistorico);
    const precisaEnviarPedidos = JSON.stringify(pedidos.filter(p => p.status !== 'rascunho')) !== JSON.stringify(pedidosRemotos);

    const banco = normalizarBanco(remoto);
    banco.pedidosAtivos = pedidos;
    banco.produtos = mesclarProdutos(localNormalizado.produtos, remoto.produtos);
    banco.categorias = mesclarColecao(localNormalizado.categorias, remoto.categorias)
        .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));
    banco.fornecedores = mesclarColecao(localNormalizado.fornecedores, remoto.fornecedores);
    banco.colaboradores = mesclarColecao(localNormalizado.colaboradores, remoto.colaboradores);

    const localRestTs = Number(localNormalizado.restaurante.atualizadoEm || 0);
    const remotoRestTs = Number(remoto.restaurante.atualizadoEm || 0);
    if(localRestTs > remotoRestTs) banco.restaurante = localNormalizado.restaurante;

    const locais = localNormalizado.configs;
    const remotos = remoto.configs;
    const localConfigTs = Number(locais.atualizadoEm || 0);
    const remotoConfigTs = Number(remotos.atualizadoEm || 0);
    const configsCompartilhadas = localConfigTs > remotoConfigTs ? locais : remotos;
    banco.configs = Object.assign({}, configsCompartilhadas, {
        url: locais.url,
        colabAtivoId: locais.colabAtivoId,
        modo: locais.modo,
        dadosBaixados: true,
        ultimaMudancaLocal: locais.ultimaMudancaLocal || 0,
        ultimoSyncConfirmado: locais.ultimoSyncConfirmado || 0,
        relogioServidorOffset: Number(locais.relogioServidorOffset || 0),
        relogioServidorSincronizadoEm: Number(locais.relogioServidorSincronizadoEm || 0),
        backendComControleRevisao: Boolean(locais.backendComControleRevisao),
        historicoApagadoEm: corteHistorico,
        syncPendente: Boolean(locais.syncPendente || precisaEnviarPedidos)
    });
    if(locais.senhaAdminHash && !banco.configs.senhaAdminHash) banco.configs.senhaAdminHash = locais.senhaAdminHash;
    if(locais.senhaAdmin && !banco.configs.senhaAdmin && !banco.configs.senhaAdminHash) banco.configs.senhaAdmin = locais.senhaAdmin;
    banco.syncRevision = Number(remoto.syncRevision || 0);

    const colecoesLocaisMaisNovas = ['produtos', 'categorias', 'fornecedores', 'colaboradores'].some(nome =>
        (localNormalizado[nome] || []).some(item => {
            const remotoItem = (remoto[nome] || []).find(outro => outro.id === item.id);
            return !remotoItem || Number(item.atualizadoEm || 0) > Number(remotoItem.atualizadoEm || 0);
        })
    );
    const historicosPrecosRecuperados = banco.produtos.some(produto => {
        const remotoProduto = remoto.produtos.find(item => item.id === produto.id);
        if(!remotoProduto) return true;
        return JSON.stringify(produto.historicoPrecos || []) !== JSON.stringify(remotoProduto.historicoPrecos || []) ||
            JSON.stringify(produto.precosExcluidos || {}) !== JSON.stringify(remotoProduto.precosExcluidos || {});
    });
    const precisaEnviar = banco.configs.syncPendente || colecoesLocaisMaisNovas || historicosPrecosRecuperados || localRestTs > remotoRestTs || localConfigTs > remotoConfigTs;
    banco.configs.syncPendente = precisaEnviar;
    return { banco, precisaEnviar };
}

function aplicarNuvemNaInicializacao(local, remotoBruto) {
    const localNormalizado = normalizarBanco(local);
    const remoto = normalizarBanco(remotoBruto);
    if(localNormalizado.configs.syncPendente) return mesclarBancos(localNormalizado, remoto);

    const banco = normalizarBanco(remoto);
    const corteHistorico = Math.max(
        Number(localNormalizado.configs.historicoApagadoEm || 0),
        Number(remoto.configs.historicoApagadoEm || 0)
    );
    const rascunhosLocais = localNormalizado.pedidosAtivos.filter(pa => pa.status === 'rascunho' && !pa.excluido);
    banco.pedidosAtivos = AloFeiraDomain.mesclarPedidos(rascunhosLocais, remoto.pedidosAtivos, corteHistorico);
    banco.configs = Object.assign({}, remoto.configs, {
        url: localNormalizado.configs.url,
        colabAtivoId: localNormalizado.configs.colabAtivoId,
        modo: localNormalizado.configs.modo,
        dadosBaixados: true,
        ultimaMudancaLocal: localNormalizado.configs.ultimaMudancaLocal || 0,
        ultimoSyncConfirmado: localNormalizado.configs.ultimoSyncConfirmado || 0,
        relogioServidorOffset: Number(localNormalizado.configs.relogioServidorOffset || 0),
        relogioServidorSincronizadoEm: Number(localNormalizado.configs.relogioServidorSincronizadoEm || 0),
        backendComControleRevisao: Boolean(localNormalizado.configs.backendComControleRevisao),
        historicoApagadoEm: corteHistorico,
        syncPendente: false
    });
    if(localNormalizado.configs.senhaAdminHash && !banco.configs.senhaAdminHash) {
        banco.configs.senhaAdminHash = localNormalizado.configs.senhaAdminHash;
    }
    banco.syncRevision = Number(remoto.syncRevision || 0);
    return { banco, precisaEnviar: false };
}

async function postarBanco({ forcar = false, permitirRetry = true, nuvemConferida = false } = {}) {
    await garantirBackendFeira();
    if(!forcar && !nuvemConferida && !db.configs.backendComControleRevisao) {
        const nuvem = await baixarBancoNuvem();
        const resultado = mesclarBancos(db, nuvem);
        db = resultado.banco;
        db.configs.backendComControleRevisao = Boolean(nuvem.serverNow && nuvem.syncRevision !== undefined);
        salvarBanco();
    }
    const dadosEnviados = prepararBancoParaNuvem();
    const assinaturaEnviada = JSON.stringify(dadosEnviados);
    const payload = {
        app_id: 'alofeira',
        action: 'salvar_banco',
        dados: dadosEnviados,
        baseRevision: Number(db.syncRevision || 0),
        force: Boolean(forcar)
    };
    const inicioRequisicao = Date.now();
    const response = await fetchComTimeout(db.configs.url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    });
    const resposta = await lerRespostaJson(response);
    const fimRequisicao = Date.now();
    const validacao = AloFeiraDomain.validarRespostaServidor(resposta);

    if(validacao.conflito && permitirRetry && resposta.dados) {
        registrarRelogioServidor(resposta.serverNow, inicioRequisicao, fimRequisicao);
        const resultado = mesclarBancos(db, resposta.dados);
        db = resultado.banco;
        db.syncRevision = Number(resposta.revision || db.syncRevision || 0);
        db.configs.syncPendente = true;
        salvarBanco();
        return postarBanco({ forcar: false, permitirRetry: false, nuvemConferida: true });
    }
    if(!validacao.ok) throw new Error(validacao.mensagem || 'O servidor não confirmou a gravação.');

    const mudouDuranteEnvio = JSON.stringify(prepararBancoParaNuvem()) !== assinaturaEnviada;
    aplicarConfirmacaoServidor(resposta, inicioRequisicao, fimRequisicao);
    db.configs.backendComControleRevisao = Boolean(resposta && resposta.serverNow && resposta.revision !== undefined);
    if(validacao.revision) db.syncRevision = validacao.revision;
    db.configs.syncPendente = mudouDuranteEnvio;
    db.configs.ultimoSyncConfirmado = agoraServidor();
    salvarBanco();
    if(mudouDuranteEnvio) { syncRepetir = true; syncRepetirApenasEmpurrar = true; }
    return true;
}

async function postarPedidosNovos(pedidos, permitirRetry = true) {
    await garantirBackendFeira();
    const idsProdutos = new Set(pedidos.map(pa => pa.produtoId));
    const payload = {
        app_id: 'alofeira',
        action: 'enviar_pedidos',
        pedidos: pedidos.map(pa => JSON.parse(JSON.stringify(pa))),
        produtos: db.produtos.filter(produto => idsProdutos.has(produto.id)).map(produto => JSON.parse(JSON.stringify(produto))),
        baseRevision: Number(db.syncRevision || 0)
    };
    const inicioRequisicao = Date.now();
    const response = await fetchComTimeout(db.configs.url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    });
    const resposta = await lerRespostaJson(response);
    const fimRequisicao = Date.now();
    const validacao = AloFeiraDomain.validarRespostaServidor(resposta);

    if(resposta && resposta.status === 'erro') return { suportado: false, conflito: false };
    if(validacao.conflito && permitirRetry && resposta.dados) {
        registrarRelogioServidor(resposta.serverNow, inicioRequisicao, fimRequisicao);
        const idsPedidos = new Set(pedidos.map(pa => pa.idUnico));
        const resultado = mesclarBancos(db, resposta.dados);
        db = resultado.banco;
        db.syncRevision = Number(resposta.revision || db.syncRevision || 0);
        salvarBanco();
        const pedidosMesclados = db.pedidosAtivos.filter(pa => idsPedidos.has(pa.idUnico));
        const retry = await postarPedidosNovos(pedidosMesclados, false);
        retry.conflito = true;
        return retry;
    }
    if(!validacao.ok) throw new Error(validacao.mensagem || 'O servidor não confirmou o pedido.');

    aplicarConfirmacaoServidor(resposta, inicioRequisicao, fimRequisicao);
    db.configs.backendComControleRevisao = Boolean(resposta && resposta.serverNow && resposta.revision !== undefined);
    if(validacao.revision) db.syncRevision = validacao.revision;
    db.configs.ultimoSyncConfirmado = agoraServidor();
    salvarBanco();
    return { suportado: true, conflito: false };
}

function isUsuarioGerenciando() {
    return Array.from(document.querySelectorAll('.modal-overlay')).some(el => el.style.display === 'flex');
}

async function consultarMetaNuvem() {
    const separador = db.configs.url.includes('?') ? '&' : '?';
    const fetchUrl = db.configs.url + separador + 'app=alofeira&meta=1&nocache=' + Date.now();
    const inicioRequisicao = Date.now();
    const response = await fetchComTimeout(fetchUrl, { redirect: 'follow', cache: 'no-store' }, 10000);
    const resposta = await lerRespostaJson(response);
    const fimRequisicao = Date.now();
    registrarRelogioServidor(resposta && resposta.serverNow, inicioRequisicao, fimRequisicao);
    if(resposta && resposta.status === 'sucesso' && resposta.app_id === 'alofeira' && resposta.revision !== undefined) {
        backendFeiraValidadoEm = Date.now();
        return { revision: Number(resposta.revision || 0), banco: null };
    }
    if(resposta && resposta.app_id === 'alofeira') {
        backendFeiraValidadoEm = Date.now();
        return { revision: Number(resposta.syncRevision || 0), banco: resposta };
    }
    throw new Error('Banco da nuvem inválido.');
}

async function garantirBackendFeira() {
    if(Date.now() - backendFeiraValidadoEm < 300000) return true;
    await consultarMetaNuvem();
    return true;
}

async function baixarBancoNuvem(timeoutMs = 15000) {
    const fetchUrl = db.configs.url + (db.configs.url.includes('?') ? '&' : '?') + 'app=alofeira&nocache=' + Date.now();
    const inicioRequisicao = Date.now();
    const response = await fetchComTimeout(fetchUrl, { redirect: 'follow', cache: 'no-store' }, timeoutMs);
    const nuvem = await lerRespostaJson(response);
    const fimRequisicao = Date.now();
    registrarRelogioServidor(nuvem && nuvem.serverNow, inicioRequisicao, fimRequisicao);
    if(!nuvem || nuvem.app_id !== 'alofeira') throw new Error('Banco da nuvem inválido.');
    backendFeiraValidadoEm = Date.now();
    return nuvem;
}

async function sincronizarInicializacao() {
    if(!db.configs.url) {
        atualizarEstadoSync('local', 'Dados somente neste aparelho');
        return false;
    }
    if(!navigator.onLine) {
        atualizarEstadoSync('offline', 'Sem internet; exibindo os dados guardados neste aparelho');
        return false;
    }
    if(isSyncingFundo) return false;

    isSyncingFundo = true;
    atualizarEstadoSync('sincronizando', 'Atualizando dados antes de abrir');
    try {
        if(db.configs.importacaoInicialPendente) {
            await garantirBackendFeira();
            await postarBanco({ forcar: true, permitirRetry: false, nuvemConferida: true });
            delete db.configs.importacaoInicialPendente;
            db.configs.syncPendente = false;
            db.configs.ultimoSyncConfirmado = agoraServidor();
            salvarBanco();
            atualizarEstadoSync('sincronizado', 'Dados importados e enviados');
            setTimeout(() => atualizarEstadoSync('oculto', 'Dados importados e enviados'), 1800);
            return true;
        }
        const nuvem = await baixarBancoNuvem(8000);
        const backendComControleRevisao = Boolean(nuvem.serverNow && nuvem.syncRevision !== undefined);
        const resultado = aplicarNuvemNaInicializacao(db, nuvem);
        db = resultado.banco;
        db.configs.backendComControleRevisao = backendComControleRevisao;
        salvarBanco();
        if(resultado.precisaEnviar) await postarBanco({ nuvemConferida: true });
        db.configs.ultimoSyncConfirmado = agoraServidor();
        salvarBanco();
        atualizarEstadoSync('sincronizado', 'Dados atualizados');
        setTimeout(() => atualizarEstadoSync('oculto', 'Dados atualizados'), 1800);
        return true;
    } catch(e) {
        atualizarEstadoSync(navigator.onLine ? 'erro' : 'offline', navigator.onLine ? 'Não foi possível conferir a nuvem' : 'Sem internet; exibindo os dados guardados neste aparelho');
        console.error('Erro na sincronização de inicialização', e);
        return false;
    } finally {
        isSyncingFundo = false;
    }
}

async function sincronizarFundo(forcado = false, apenasEmpurrar = false) {
    if(!db.configs.url) { atualizarEstadoSync('local', 'Dados somente neste aparelho'); return false; }
    if(isUsuarioGerenciando() && !forcado && !apenasEmpurrar) return false;
    if(isSyncingFundo) { syncRepetir = true; syncRepetirApenasEmpurrar = syncRepetirApenasEmpurrar || apenasEmpurrar; return false; }
    if(document.hidden && !forcado && !apenasEmpurrar) return false;
    isSyncingFundo = true;
    atualizarEstadoSync('sincronizando', 'Sincronizando com a nuvem');
    try {
        let precisaEnviar = Boolean(apenasEmpurrar || db.configs.syncPendente);
        if(precisaEnviar) {
            await postarBanco();
        } else if(!apenasEmpurrar) {
            const meta = await consultarMetaNuvem();
            let nuvem = meta.banco;
            if(!nuvem && meta.revision !== Number(db.syncRevision || 0)) nuvem = await baixarBancoNuvem();
            if(nuvem) {
                const agrupamentoCompartilhadoAnterior = Boolean(db.configs.agruparComprasPorStatus);
                const resultado = mesclarBancos(db, nuvem);
                db = resultado.banco;
                precisaEnviar = precisaEnviar || resultado.precisaEnviar;
                salvarBanco();
                if(Boolean(db.configs.agruparComprasPorStatus) !== agrupamentoCompartilhadoAnterior) {
                    aplicarPreferenciaAgrupamentoCompras();
                }
                atualizarBotaoPerfil();
                atualizarVisibilidadeAdmin();
                const exigirColab = document.getElementById('configExigirColab');
                if(exigirColab) exigirColab.checked = db.configs.exigirColaborador;
                if(!isUsuarioGerenciando()) {
                    renderizarFiltros();
                    renderizarLista();
                }
            }
            if(precisaEnviar) await postarBanco();
        }
        db.configs.ultimoSyncConfirmado = agoraServidor();
        salvarBanco();
        atualizarEstadoSync('sincronizado', 'Dados confirmados na nuvem');
        setTimeout(() => atualizarEstadoSync('oculto', 'Dados confirmados na nuvem'), 1800);
        return true;
    } catch(e) {
        salvarBanco();
        atualizarEstadoSync(navigator.onLine ? 'erro' : 'offline', navigator.onLine ? 'Falha ao sincronizar' : 'Sem internet; alterações guardadas no aparelho');
        console.error('Erro na sincronização de fundo', e);
        if(forcado) mostrarToast(e.message || 'Não foi possível sincronizar agora.', 'erro', 5000);
        return false;
    } finally {
        isSyncingFundo = false;
        if(syncRepetir) {
            const somenteEnvio = syncRepetirApenasEmpurrar;
            syncRepetir = false;
            syncRepetirApenasEmpurrar = false;
            setTimeout(() => sincronizarFundo(false, somenteEnvio), 180);
        }
    }
}

async function salvarURL() {
    const inputUrl = document.getElementById('configUrlApp').value.trim();
    if(!inputUrl) return alert('Digite a URL primeiro.');
    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('loadingText').textContent = 'Conectando e conferindo os dados...';
    try {
        const fetchUrl = inputUrl + (inputUrl.includes('?') ? '&' : '?') + 'app=alofeira&nocache=' + Date.now();
        const inicioRequisicao = Date.now();
        const response = await fetchComTimeout(fetchUrl, { redirect: 'follow', cache: 'no-store' });
        const nuvem = await lerRespostaJson(response);
        registrarRelogioServidor(nuvem && nuvem.serverNow, inicioRequisicao, Date.now());
        if(!nuvem || nuvem.app_id !== 'alofeira') throw new Error('Não encontrei um banco válido nesse endereço.');
        db.configs.url = inputUrl;
        const resultado = mesclarBancos(db, nuvem);
        db = resultado.banco;
        db.configs.url = inputUrl;
        db.configs.dadosBaixados = true;
        db.configs.backendComControleRevisao = Boolean(nuvem.serverNow && nuvem.syncRevision !== undefined);
        salvarBanco();
        alert('Conexão estabelecida. Os dados deste aparelho e da nuvem foram conferidos.');
        location.reload();
    } catch(e) {
        alert(`Não foi possível conectar. ${e.message}`);
    } finally {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

function exportarDados() {
    const copia = JSON.parse(JSON.stringify(db));
    delete copia.configs.url;
    delete copia.configs.colabAtivoId;
    delete copia.configs.senhaAdmin;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(copia, null, 2));
    const link = document.createElement('a');
    link.href = dataStr;
    link.download = 'alo_cozinha_compras_backup_' + getHojeSTR() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    mostrarToast('Backup exportado.', 'sucesso');
}

function importarDados(event) {
    const file = event.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importado = JSON.parse(e.target.result);
            if(!importado || importado.app_id !== 'alofeira') throw new Error('Arquivo de backup inválido.');
            abrirConfirmacaoApp({ titulo:'Importar backup?', mensagem:'Os dados deste aparelho serão substituídos. A cópia atual continuará na nuvem até a próxima sincronização.', rotulo:'Importar', cor:'#c62828', acao:() => aplicarBackupImportado(importado) });
        } catch(err) {
            alert(err.message || 'Erro ao ler o arquivo.');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function aplicarBackupImportado(importado) {
    const urlSalva = db.configs.url;
    db = normalizarBanco(importado);
    db.configs.url = urlSalva || '';
    db.configs.ultimaMudancaLocal = agoraServidor();
    db.configs.syncPendente = true;
    salvarBanco();
    alert('Backup importado neste aparelho. Confira os dados e use “Forçar envio” para substituir a nuvem.');
    location.reload();
}

async function forcarEnvioNuvemCompleto(confirmado = false) {
    if(!db.configs.url) return alert('Configure primeiro a URL do Google Script.');
    if(!confirmado) return abrirConfirmacaoApp({ titulo:'Substituir dados da nuvem?', mensagem:'A versão deste aparelho substituirá a cópia atual da nuvem.', rotulo:'Forçar envio', cor:'#c62828', acao:() => forcarEnvioNuvemCompleto(true) });
    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('loadingText').textContent = 'Gravando a cópia completa na nuvem...';
    try {
        isSyncingFundo = true;
        await postarBanco({ forcar: true, permitirRetry: false });
        alert('Dados confirmados e gravados na nuvem.');
    } catch(e) {
        alert(`A nuvem não confirmou a gravação. Nada foi dado como concluído. ${e.message}`);
    } finally {
        isSyncingFundo = false;
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

async function excluirTodoHistorico(confirmado = false) {
    const frase = document.getElementById('inputExcluirTudo').value.trim().toLowerCase();
    if(frase !== 'quero excluir todo o histórico') return alert('Frase incorreta.');
    if(!confirmado) return abrirConfirmacaoApp({ titulo:'Apagar todo o histórico?', mensagem:'Todos os pedidos serão apagados em todos os aparelhos. Os cadastros serão mantidos.', rotulo:'Apagar histórico', cor:'#c62828', acao:() => excluirTodoHistorico(true) });
    const backup = JSON.parse(JSON.stringify(db));
    db.configs.historicoApagadoEm = agoraServidor();
    db.pedidosAtivos = [];
    db.produtos = db.produtos.filter(p => !p.avulso);
    marcarMudancaEstrutural();
    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('loadingText').textContent = 'Apagando o histórico com segurança...';
    try {
        if(db.configs.url) {
            isSyncingFundo = true;
            await postarBanco();
        }
        alert('Histórico apagado. Aparelhos antigos respeitarão esta exclusão quando voltarem a sincronizar.');
        document.getElementById('inputExcluirTudo').value = '';
        fecharModal('modalConfigAvancadas');
        renderizarLista();
    } catch(e) {
        db = backup;
        salvarBanco();
        alert(`Não foi possível confirmar a exclusão na nuvem. O histórico foi restaurado neste aparelho. ${e.message}`);
    } finally {
        isSyncingFundo = false;
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

async function forcarAtualizacao(confirmado = false) {
    if(!confirmado) return abrirConfirmacaoApp({ titulo:'Atualizar aplicativo?', mensagem:'A versão mais recente será buscada sem apagar seus dados.', rotulo:'Atualizar', cor:'#1565C0', acao:() => forcarAtualizacao(true) });
    if('serviceWorker' in navigator) {
        const registros = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registros.map(registro => registro.update()));
    }
    window.location.href = window.location.pathname + '?nocache=' + Date.now();
}

setInterval(() => sincronizarFundo(false, false), 12000);
window.addEventListener('online', () => sincronizarFundo(false, false));
window.addEventListener('offline', () => atualizarEstadoSync('offline', 'Sem internet; alterações guardadas no aparelho'));
document.addEventListener('visibilitychange', () => { if(!document.hidden) sincronizarFundo(false, false); });
