function alterarModo(modo) {
    db.configs.modo = modo;
    modoSelecaoAtivo = false;
    itensSelecionadosRelatorio.clear();
    aplicarPreferenciaAgrupamentoCompras();
    if(modo === 'pedido') filtroFornecedorComprasId = null;
    fecharMenuFerramentas();
    fecharMenuAcaoCompra();
    document.body.className = `theme-${modo}`;
    document.getElementById('metaThemeColor').content = modo === 'pedido' ? '#1565C0' : '#521565';
    document.getElementById('dicasCabecalho').innerHTML = '';
    document.getElementById('btnHistHoje').style.display = modo === 'pedido' ? 'inline-flex' : 'none';
    document.getElementById('btnLimparComprasBar').style.display = modo === 'compras' ? 'inline-flex' : 'none';
    document.getElementById('btnRelatorioBar').style.display = modo === 'compras' ? 'inline-flex' : 'none';
    if(modo === 'compras') document.getElementById('containerBotoesEnvio').style.display = 'none';
    renderizarFiltros();
    atualizarControlesSelecao();
    atualizarEstadoMenuFerramentas();
    atualizarVisibilidadeAdmin();
    atualizarBotaoPerfil();
    salvarBanco();
    atualizarBotaoDesfazer();
    renderizarLista();
}

function renderizarFiltros() {
    const compras = db.configs.modo === 'compras';
    const todosAtivo = categoriaAtual === null && (!compras || (!filtroFornecedorComprasId && !agrupamentoCompradoAtivo));
    let html = `<button id="btnTodosFiltros" class="chip ${todosAtivo ? 'active' : ''}" onclick="abrirMenuFerramentas(this)" aria-haspopup="menu" aria-expanded="false">TODOS</button>`;
    html += `<button class="btn-busca-filtros ${buscaPedidoTexto ? 'ativo' : ''}" onclick="abrirBuscaPedido()" id="btnBuscaPedido" title="Buscar item" aria-label="Buscar item">🔎</button>`;
    html += `<button class="btn-cancelar-selecao-inline" onclick="cancelarSelecaoCompras()" id="btnCancelarSelecaoCompras" title="Cancelar seleção" aria-label="Cancelar seleção" style="display:${compras && modoSelecaoAtivo ? 'inline-flex' : 'none'}">✓</button>`;
    html += `<div id="boxBuscaPedido" class="busca-filtros-inline" style="display:${buscaPedidoTexto ? 'flex' : 'none'}"><input type="text" id="inputBuscaPedidoInline" value="${escaparHtml(buscaPedidoTexto)}" placeholder="Buscar item..." oninput="aplicarBuscaPedido()" onkeydown="if(event.key === 'Escape') limparBuscaPedido()"></div>`;
    document.getElementById('containerFiltros').innerHTML = html;
}

function filtrarCat(catId) {
    fecharMenuFerramentas();
    categoriaAtual = catId;
    renderizarFiltros();
    renderizarLista();
}

function renderizarMenuFerramentas() {
    const menu = document.getElementById('menuFerramentas');
    const compras = db.configs.modo === 'compras';
    const colabLogado = db.colaboradores.find(c => c.id === db.configs.colabAtivoId);
    const catsPermitidas = getCatsPermitidas(colabLogado);
    const categorias = db.categorias.filter(cat => cat.ativo !== false && (!catsPermitidas || catsPermitidas.includes(cat.id)));
    const todosAtivo = categoriaAtual === null && (!compras || (!filtroFornecedorComprasId && !agrupamentoCompradoAtivo));
    let html = `<button type="button" class="menu-ferramentas-item ${compras ? '' : 'ultimo-grupo'}" role="menuitem" onclick="acionarMenuFerramentas('todos')"><span aria-hidden="true">≡</span><span>Mostrar todos os itens</span><span class="menu-estado" id="estadoMostrarTodos">${todosAtivo ? '✓' : ''}</span></button>`;
    if(compras) {
        html += `<button type="button" class="menu-ferramentas-item" role="menuitem" onclick="acionarMenuFerramentas('fornecedor')"><span aria-hidden="true">🚚</span><span>Filtrar por fornecedor</span><span class="menu-estado" id="estadoFiltroFornecedor">${filtroFornecedorComprasId ? '✓' : ''}</span></button>`;
        html += `<button type="button" class="menu-ferramentas-item ultimo-grupo" id="opcaoAgruparStatus" role="menuitem" onclick="acionarMenuFerramentas('agrupar')"><span aria-hidden="true">🗂️</span><span>Agrupar por status</span><span class="menu-estado" id="estadoAgruparStatus">${agrupamentoCompradoAtivo ? '✓' : ''}</span></button>`;
    }
    html += '<div class="menu-ferramentas-separador" role="separator"></div>';
    html += '<div class="menu-categorias-titulo">Agrupar por categoria:</div>';
    categorias.forEach(cat => {
        const ativa = categoriaAtual === cat.id;
        html += `<button type="button" class="menu-ferramentas-item menu-categoria-item" role="menuitem" onclick="selecionarCategoriaMenu('${cat.id}')"><span class="menu-categoria-cor" style="background:${cat.cor};" aria-hidden="true"></span><span>${escaparHtml(cat.nome)}</span><span class="menu-estado">${ativa ? '✓' : ''}</span></button>`;
    });
    if(categorias.length === 0) html += '<div class="menu-ferramentas-vazio">Nenhuma categoria disponível</div>';
    menu.innerHTML = html;
}

function abrirMenuFerramentas(origemEl) {
    if(modoSelecaoAtivo) return;
    const overlay = document.getElementById('overlayMenuFerramentas');
    const menu = document.getElementById('menuFerramentas');
    renderizarMenuFerramentas();
    overlay.style.display = 'block';
    const margem = 10;
    const largura = Math.min(310, window.innerWidth - margem * 2);
    menu.style.width = `${largura}px`;
    const origem = origemEl.getBoundingClientRect();
    const altura = menu.offsetHeight;
    let esquerda = Math.max(margem, Math.min(origem.left, window.innerWidth - largura - margem));
    let topo = origem.bottom + 6;
    if(topo + altura > window.innerHeight - margem) topo = origem.top - altura - 6;
    menu.style.left = `${Math.round(esquerda)}px`;
    menu.style.top = `${Math.max(margem, Math.round(topo))}px`;
    origemEl.setAttribute('aria-expanded', 'true');
}

function fecharMenuFerramentas() {
    const overlay = document.getElementById('overlayMenuFerramentas');
    const botao = document.getElementById('btnTodosFiltros');
    if(overlay) overlay.style.display = 'none';
    if(botao) botao.setAttribute('aria-expanded', 'false');
}

function acionarMenuFerramentas(acao) {
    fecharMenuFerramentas();
    if(acao === 'todos') mostrarTodosItens();
    else if(acao === 'fornecedor') abrirModalFiltroFornCompras();
    else if(acao === 'agrupar') ativarAgrupamentoCompras();
}

function selecionarCategoriaMenu(catId) {
    if(db.configs.modo === 'compras') {
        filtroFornecedorComprasId = null;
        agrupamentoCompradoAtivo = false;
    }
    filtrarCat(catId);
}

function atualizarEstadoMenuFerramentas() {
    const todos = document.getElementById('estadoMostrarTodos');
    const fornecedor = document.getElementById('estadoFiltroFornecedor');
    const agrupado = document.getElementById('estadoAgruparStatus');
    if(todos) todos.textContent = categoriaAtual === null && !filtroFornecedorComprasId && !agrupamentoCompradoAtivo ? '✓' : '';
    if(fornecedor) fornecedor.textContent = filtroFornecedorComprasId ? '✓' : '';
    if(agrupado) agrupado.textContent = agrupamentoCompradoAtivo ? '✓' : '';
}

function mostrarTodosItens() {
    if(db.configs.modo === 'compras') {
        filtroFornecedorComprasId = null;
        agrupamentoCompradoAtivo = false;
    }
    categoriaAtual = null;
    renderizarFiltros();
    renderizarLista();
}

function mostrarTodosCompras() { mostrarTodosItens(); }

function ativarAgrupamentoCompras() {
    if(db.configs.modo !== 'compras') return;
    filtroFornecedorComprasId = null;
    agrupamentoCompradoAtivo = true;
    categoriaAtual = null;
    db.configs.agruparComprasPorStatus = true;
    marcarMudancaConfiguracao();
    atualizarEstadoMenuFerramentas();
    renderizarFiltros();
    renderizarLista();
    sincronizarFundo(false, true);
}

function aplicarPreferenciaAgrupamentoCompras() {
    agrupamentoCompradoAtivo = db.configs.modo === 'compras' && db.configs.agruparComprasPorStatus === true;
    if(agrupamentoCompradoAtivo) {
        filtroFornecedorComprasId = null;
        categoriaAtual = null;
    }
}

function limparComprasAntigas() {
    const concluidos = db.pedidosAtivos.filter(pa => !pa.excluido && !pa.ocultoCompras && ['comprado', 'entregue', 'cancelado'].includes(pa.status));
    if(concluidos.length === 0) return alert('Não há itens concluídos ou cancelados para limpar.');
    abrirConfirmacaoApp({
        titulo: 'Limpar itens concluídos?',
        mensagem: `${concluidos.length} item(ns) sairão da lista, mas continuarão no histórico.`,
        rotulo: 'Limpar',
        cor: '#c62828',
        acao: executarLimpezaComprasAntigas
    });
}

function executarLimpezaComprasAntigas() {
    const concluidos = db.pedidosAtivos.filter(pa => !pa.excluido && !pa.ocultoCompras && ['comprado', 'entregue', 'cancelado'].includes(pa.status));
    if(concluidos.length === 0) return;
    const backupEstados = concluidos.map(pa => JSON.parse(JSON.stringify(pa)));
    const idsAvulsosCancelados = new Set(concluidos.filter(pa => pa.status === 'cancelado').map(pa => pa.produtoId));
    const produtosAvulsos = db.produtos.filter(p => p.avulso && p.ativo !== false && idsAvulsosCancelados.has(p.id));
    const backupProdutos = produtosAvulsos.map(p => JSON.parse(JSON.stringify(p)));
    const agora = agoraServidor();
    concluidos.forEach(pa => { pa.ocultoCompras = true; pa.dataStatus = agora; });
    produtosAvulsos.forEach(p => { p.ativo = false; p.atualizadoEm = agoraServidor(); });
    pilhaDesfazer.push({ pedidos: backupEstados, produtos: backupProdutos });
    db.configs.syncPendente = true;
    atualizarBotaoDesfazer();
    salvarBanco();
    renderizarLista();
    sincronizarFundo(false, true);
}

function atualizarControlesSelecao() {
    const pedido = db.configs.modo === 'pedido';
    const btnRelatorio = document.getElementById('btnRelatorioBar');
    const btnComprado = document.getElementById('btnMassaComprado');
    const btnPedidoFornecedor = document.getElementById('btnMassaPedForn');
    const btnVincular = document.getElementById('btnMassaVincular');
    const acoesSelecao = document.getElementById('acoesSelecaoCompras');
    const btnLimpar = document.getElementById('btnLimparComprasBar');
    const btnCancelarSelecao = document.getElementById('btnCancelarSelecaoCompras');

    btnComprado.style.display = 'inline-flex';
    btnPedidoFornecedor.style.display = 'inline-flex';
    btnVincular.style.display = 'inline-flex';
    acoesSelecao.style.display = !pedido && modoSelecaoAtivo ? 'flex' : 'none';
    btnLimpar.style.display = !pedido && !modoSelecaoAtivo ? 'inline-flex' : 'none';
    btnRelatorio.style.display = !pedido ? 'inline-flex' : 'none';
    if(btnCancelarSelecao) btnCancelarSelecao.style.display = !pedido && modoSelecaoAtivo ? 'inline-flex' : 'none';
    if(modoSelecaoAtivo) {
        fecharMenuFerramentas();
        document.getElementById('btnDesfazerBar').style.display = 'none';
    } else {
        atualizarBotaoDesfazer();
    }
    atualizarCentroFiltrosCompras();
}

function cancelarSelecaoCompras() {
    itensSelecionadosRelatorio.clear();
    modoSelecaoAtivo = false;
    atualizarControlesSelecao();
    renderizarLista();
}

function toggleModoSelecao() {
    modoSelecaoAtivo = !modoSelecaoAtivo;
    if(!modoSelecaoAtivo) itensSelecionadosRelatorio.clear();
    atualizarControlesSelecao();
    renderizarLista();
}

function alternarSelecaoDireta(id) {
    if(itensSelecionadosRelatorio.has(id)) itensSelecionadosRelatorio.delete(id);
    else itensSelecionadosRelatorio.add(id);
    modoSelecaoAtivo = itensSelecionadosRelatorio.size > 0;
    atualizarControlesSelecao();
    renderizarLista();
}

function selecionarItemCompraDireto(event, idUnico) {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    if(db.configs.modo !== 'compras') return;
    alternarSelecaoDireta(idUnico);
}

function alternarSelecaoGrupo(seletor) {
    const ids = Array.from(document.querySelectorAll(seletor)).map(el => el.getAttribute('data-id')).filter(Boolean);
    if(ids.length === 0) return;
    const todosSelecionados = ids.every(id => itensSelecionadosRelatorio.has(id));
    ids.forEach(id => todosSelecionados ? itensSelecionadosRelatorio.delete(id) : itensSelecionadosRelatorio.add(id));
    modoSelecaoAtivo = itensSelecionadosRelatorio.size > 0;
    atualizarControlesSelecao();
    renderizarLista();
}

function selecionarGrupoCompras(grupoId, tipo = 'cat') {
    const seletor = tipo === 'cat' ? `.item[data-grp-cat="${grupoId}"]` : `.item[data-grp-sub="${grupoId}"]`;
    alternarSelecaoGrupo(seletor);
}

function acaoEmMassa(acao) {
    if(itensSelecionadosRelatorio.size === 0) return alert('Selecione os itens primeiro.');
    const pedidoFornecedor = acao === 'pedido_forn';
    abrirConfirmacaoApp({
        titulo: pedidoFornecedor ? 'Pedido ao fornecedor?' : 'Marcar como comprado?',
        mensagem: `${itensSelecionadosRelatorio.size} item(ns) selecionado(s) serão atualizados.`,
        rotulo: pedidoFornecedor ? 'Confirmar pedido' : 'Confirmar compra',
        cor: pedidoFornecedor ? '#521565' : '#145218',
        acao: () => executarAcaoEmMassa(acao)
    });
}

function executarAcaoEmMassa(acao) {
    const backupEstados = [];
    let alterados = 0;
    let ignorados = 0;
    const apenasReceber = getPermissaoColab();
    const agora = agoraServidor();
    itensSelecionadosRelatorio.forEach(idUnico => {
        const pa = db.pedidosAtivos.find(x => x.idUnico === idUnico);
        if(!pa) return;
        const acaoItem = acao === 'concluir' ? (pa.status === 'pedido_forn' ? 'entregue' : 'comprado') : 'pedido_forn';
        const backup = JSON.parse(JSON.stringify(pa));
        const resultado = AloFeiraDomain.aplicarTransicao(pa, acaoItem, agora, apenasReceber);
        if(resultado.ok) { backupEstados.push(backup); alterados++; }
        else ignorados++;
    });
    if(alterados) {
        pilhaDesfazer.push(backupEstados);
        db.configs.syncPendente = true;
        salvarBanco();
        toggleModoSelecao();
        sincronizarFundo(false, true);
        mostrarToast(`${alterados} item(ns) atualizados.`, 'sucesso');
    }
    if(ignorados) mostrarToast(`${ignorados} item(ns) não permitiam essa mudança.`, 'info', 4500);
}

function abrirModalMassaVincular() {
    if(db.configs.modo !== 'compras') return;
    if(itensSelecionadosRelatorio.size === 0) return alert('Selecione itens primeiro.');
    const selForn = document.getElementById('massaVincularForn');
    selForn.innerHTML = '<option value="">-- Escolha o Fornecedor --</option>';
    db.fornecedores.filter(f => f.ativo !== false).sort((a,b) => a.nome.localeCompare(b.nome)).forEach(f => {
        const option = document.createElement('option');
        option.value = f.id;
        option.textContent = f.nome;
        selForn.appendChild(option);
    });
    document.getElementById('modalMassaVincular').style.display = 'flex';
}

function confirmarMassaVincular() {
    if(db.configs.modo !== 'compras') return;
    if(getPermissaoColab()) return alert('Seu perfil não permite alterar fornecedores.');
    const fornId = document.getElementById('massaVincularForn').value;
    if(!fornId) return alert('Selecione um fornecedor.');
    itensSelecionadosRelatorio.forEach(idSelecionado => {
        let p;
        const pa = db.pedidosAtivos.find(x => x.idUnico === idSelecionado);
        if(pa) p = db.produtos.find(prod => prod.id === pa.produtoId);
        if(p) {
            if(!p.fornecedores) p.fornecedores = [];
            if(!p.fornecedores.includes(fornId)) p.fornecedores.push(fornId);
            p.atualizadoEm = agoraServidor();
        }
    });
    marcarMudancaEstrutural();
    fecharModal('modalMassaVincular');
    toggleModoSelecao();
    sincronizarFundo(false, true);
    mostrarToast('Fornecedor vinculado.', 'sucesso');
}

function abrirModalFiltroFornCompras() {
    if(db.configs.modo !== 'compras') return;
    const selForn = document.getElementById('filtroComprasForn');
    selForn.innerHTML = '<option value="">-- Mostrar Todos os Itens --</option>';
    db.fornecedores.filter(f => f.ativo !== false).sort((a,b) => a.nome.localeCompare(b.nome)).forEach(f => {
        const option = document.createElement('option');
        option.value = f.id;
        option.textContent = f.nome;
        selForn.appendChild(option);
    });
    selForn.value = filtroFornecedorComprasId || '';
    document.getElementById('modalFiltroFornCompras').style.display = 'flex';
}

function aplicarFiltroFornCompras() {
    filtroFornecedorComprasId = document.getElementById('filtroComprasForn').value;
    agrupamentoCompradoAtivo = false;
    categoriaAtual = null;
    fecharModal('modalFiltroFornCompras');
    atualizarEstadoMenuFerramentas();
    renderizarFiltros();
    renderizarLista();
}

function zerarFiltroForn() {
    document.getElementById('filtroComprasForn').value = '';
    fecharModal('modalFiltroFornCompras');
    mostrarTodosCompras();
}

function normalizarTextoBusca(str) { return removerAcentos(String(str || '').toLowerCase()); }

function abrirBuscaPedido() {
    const box = document.getElementById('boxBuscaPedido');
    const input = document.getElementById('inputBuscaPedidoInline');
    const container = document.getElementById('containerFiltros');
    const aberto = box.style.display === 'flex';
    if(aberto || buscaPedidoTexto) { limparBuscaPedido(); return; }
    box.style.display = 'flex';
    input.value = buscaPedidoTexto;
    if(container) container.scrollLeft = 0;
    setTimeout(() => {
        input.focus({ preventScroll:true });
        if(container) container.scrollLeft = 0;
    }, 80);
}

function aplicarBuscaPedido() {
    buscaPedidoTexto = document.getElementById('inputBuscaPedidoInline').value.trim();
    const btn = document.getElementById('btnBuscaPedido');
    if(btn) btn.classList.toggle('ativo', Boolean(buscaPedidoTexto));
    renderizarLista();
}

function limparBuscaPedido() {
    buscaPedidoTexto = '';
    const input = document.getElementById('inputBuscaPedidoInline');
    const box = document.getElementById('boxBuscaPedido');
    if(input) input.value = '';
    if(box) box.style.display = 'none';
    const btn = document.getElementById('btnBuscaPedido');
    if(btn) btn.classList.remove('ativo');
    renderizarLista();
}

function ordernarPorCategoriaESub(a, b) {
    const pA = a.p || a;
    const pB = b.p || b;
    let idxA = pA ? db.categorias.findIndex(c => c.id === pA.categoria) : 999;
    let idxB = pB ? db.categorias.findIndex(c => c.id === pB.categoria) : 999;
    if(idxA === -1) idxA = 999;
    if(idxB === -1) idxB = 999;
    if(idxA !== idxB) return idxA - idxB;
    const subA = pA && pA.subcategoria ? pA.subcategoria : '';
    const subB = pB && pB.subcategoria ? pB.subcategoria : '';
    const cObjA = db.categorias.find(c => c.id === (pA ? pA.categoria : null));
    const cObjB = db.categorias.find(c => c.id === (pB ? pB.categoria : null));
    let idxSubA = cObjA && cObjA.subcategorias && subA ? cObjA.subcategorias.indexOf(subA) : 999;
    let idxSubB = cObjB && cObjB.subcategorias && subB ? cObjB.subcategorias.indexOf(subB) : 999;
    if(idxSubA === -1) idxSubA = 999;
    if(idxSubB === -1) idxSubB = 999;
    if(idxSubA !== idxSubB) return idxSubA - idxSubB;
    if(subA !== subB) return subA.localeCompare(subB);
    const nomeA = pA.descFornecedor ? pA.descFornecedor : (pA.nome || '');
    const nomeB = pB.descFornecedor ? pB.descFornecedor : (pB.nome || '');
    return nomeA.localeCompare(nomeB);
}

function abrirModalAvulso(catId) {
    document.getElementById('avulsoCatId').value = catId;
    document.getElementById('avulsoNome').value = '';
    document.getElementById('avulsoQtd').value = '';
    document.getElementById('avulsoUn').value = '';
    document.getElementById('modalFormAvulso').style.display = 'flex';
    setTimeout(() => document.getElementById('avulsoNome').focus(), 100);
}

function salvarAvulso() {
    const catId = document.getElementById('avulsoCatId').value;
    const nome = document.getElementById('avulsoNome').value.trim();
    if(!nome) return alert('Por favor, digite o nome do item avulso.');
    const qtdStr = document.getElementById('avulsoQtd').value.trim();
    const qtd = qtdStr !== '' ? parseFloatBr(qtdStr) : '';
    const un = document.getElementById('avulsoUn').value.trim();
    const newProdId = 'p_av_' + Date.now();
    const novoProd = { id: newProdId, nome: nome + ' (Avulso)', descFornecedor: '', obsPadrao: '', categoria: catId, subcategoria: '', qtdPadrao: '', unidades: un ? [un] : [''], marcasAprovadas: '', marcasReprovadas: '', historicoPrecos: [], fornecedores: [], avulso: true };
    db.produtos.push(novoProd);
    db.pedidosAtivos.push({ idUnico: 'pa_' + Date.now(), produtoId: newProdId, qtd, unidade: un, obs: 'Item Avulso', status: 'rascunho', dataStatus: agoraServidor(), excluido: false, historico: [], colaboradorId: db.configs.colabAtivoId });
    salvarBanco();
    fecharModal('modalFormAvulso');
    renderizarLista();
}
