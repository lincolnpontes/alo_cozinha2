function registrarDesfazer(pa) { pilhaDesfazer.push([JSON.parse(JSON.stringify(pa))]); atualizarBotaoDesfazer(); }
    function desfazerAcao() { if(pilhaDesfazer.length === 0) return; const agora = agoraServidor(); let last = pilhaDesfazer.pop(); let itensRestore = Array.isArray(last) ? last : (last.pedidos || [last]); itensRestore.forEach(itemBackup => { let idx = db.pedidosAtivos.findIndex(x => x.idUnico === itemBackup.idUnico); if(idx !== -1) { itemBackup.dataStatus = agora; db.pedidosAtivos[idx] = itemBackup; } }); if(last && !Array.isArray(last) && last.produtos) { last.produtos.forEach(produtoBackup => { produtoBackup.atualizadoEm = agora; const idx = db.produtos.findIndex(p => p.id === produtoBackup.id); if(idx >= 0) db.produtos[idx] = produtoBackup; else db.produtos.push(produtoBackup); }); } db.configs.syncPendente = true; salvarBanco(); renderizarLista(); sincronizarFundo(false, true); atualizarBotaoDesfazer(); mostrarToast('Última alteração desfeita.', 'sucesso'); }
    function atualizarCentroFiltrosCompras() { const centro = document.getElementById('filtrosCentroCompras'); const barra = document.querySelector('.filters'); const acoes = document.getElementById('acoesSelecaoCompras'); const desfazer = document.getElementById('btnDesfazerBar'); const visivel = db.configs.modo === 'compras' && (acoes.style.display !== 'none' || desfazer.style.display !== 'none'); centro.style.display = visivel ? 'flex' : 'none'; barra.classList.toggle('com-centro', visivel); }
    function atualizarBotaoDesfazer() { const btn = document.getElementById('btnDesfazerBar'); if (db.configs.modo === 'compras' && pilhaDesfazer.length > 0 && !modoSelecaoAtivo) { btn.style.display = 'inline-flex'; } else { btn.style.display = 'none'; } atualizarCentroFiltrosCompras(); }

    function getPermissaoColab() { let c = db.colaboradores.find(col => col.id === db.configs.colabAtivoId); return c ? (c.apenasReceber || false) : false; }

    function acaoToqueSimples(el) {
        if(db.configs.modo === 'compras') return abrirAcoesCompra(el.getAttribute('data-id'), el);
        const pId = el.getAttribute('data-id');
        const pedId = el.getAttribute('data-pedid');
        if(!pedId) {
            const p = db.produtos.find(x => x.id === pId);
            if(!p) return;
            const qtd = (p.qtdPadrao !== null && p.qtdPadrao !== '') ? p.qtdPadrao : '';
            const un = p.unidades[0] || '';
            const obsPad = p.obsPadrao || '';
            const novoPedId = 'pa_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
            db.pedidosAtivos.push({ idUnico: novoPedId, produtoId: pId, qtd, unidade: un, obs: obsPad, status: 'rascunho', dataStatus: agoraServidor(), excluido: false, historico: [], colaboradorId: db.configs.colabAtivoId });
            salvarBanco();
            renderizarLista();
            return;
        }
        const pedido = db.pedidosAtivos.find(pa => pa.idUnico === pedId);
        if(pedido && pedido.status === 'rascunho') abrirModalEditarPedido(pedId, pId);
        else mostrarToast('Este item já está no fluxo de compra.', 'info');
    }
    function acaoDuploToque(el) { if(db.configs.modo === 'pedido') { const pId = el.getAttribute('data-id'); const pedidosDeste = db.pedidosAtivos.filter(pa => pa.produtoId === pId && !pa.excluido && (pa.status === 'rascunho' || pa.status === 'pendente' || pa.status === 'pedido_forn')); const pedidoEditavel = pedidosDeste[pedidosDeste.length-1]; if(pedidoEditavel && pedidoEditavel.status !== 'rascunho') { let colabLogado = db.colaboradores.find(c => c.id === db.configs.colabAtivoId); let isAdmin = temAcessoAdmin(); if(!isAdmin && pedidoEditavel.colaboradorId !== db.configs.colabAtivoId) { return alert("🔒 Acesso Negado: Você só pode visualizar e editar pedidos que foram enviados pelo seu próprio perfil."); } } abrirModalEditarPedido(pedidoEditavel ? pedidoEditavel.idUnico : null, pId); } else { if (getPermissaoColab()) return alert("Seu perfil não permite editar os detalhes das compras."); const paId = el.getAttribute('data-id'); const pa = db.pedidosAtivos.find(x => x.idUnico === paId); if(pa && !pa.excluido) { abrirHistoricoCompra(paId); } } }
    function abrirConfirmarCancelamento(paId) { const pa = db.pedidosAtivos.find(x => x.idUnico === paId); if(!pa) return; const p = db.produtos.find(prod => prod.id === pa.produtoId); document.getElementById('cancelamentoCompraId').value = paId; document.getElementById('textoConfirmarCancelamento').innerHTML = `<b>${escaparHtml(p ? p.nome : 'Este item')}</b>`; document.getElementById('modalConfirmarCancelamento').style.display = 'flex'; }
    function confirmarCancelamentoCompra() { const paId = document.getElementById('cancelamentoCompraId').value; const pa = db.pedidosAtivos.find(x => x.idUnico === paId); if(!pa) return fecharModal('modalConfirmarCancelamento'); registrarDesfazer(pa); delete pa.transicaoProgresso; delete pa.statusAnterior; pa.status = 'cancelado'; pa.dataStatus = agoraServidor(); delete pa.dataConclusao; delete pa.dataPedidoFornecedor; db.configs.syncPendente = true; salvarBanco(); fecharModal('modalConfirmarCancelamento'); fecharMenuAcaoCompra(); renderizarLista(); sincronizarFundo(false, true); mostrarToast('Item cancelado. Você pode desfazer.', 'sucesso'); }

    function removerPedidoPelaEdicao() { const pedId = document.getElementById('editPedidoId').value; const pa = db.pedidosAtivos.find(x => x.idUnico === pedId && x.status === 'rascunho'); if(!pa) return; db.pedidosAtivos = db.pedidosAtivos.filter(x => x.idUnico !== pedId); salvarBanco(); fecharModal('modalEditarPedido'); renderizarLista(); mostrarToast('Item removido do pedido.', 'sucesso'); }

    function rotuloStatusCompra(status) {
        return { pendente:'Pendente', pedido_forn:'Pedido ao fornecedor', comprado:'Comprado', entregue:'Recebido', cancelado:'Cancelado' }[status] || status;
    }

    function botaoAcaoCompra(acao, icone, titulo, classe) {
        return `<button class="menu-compra-acao ${classe}" type="button" role="menuitem" onclick="executarAcaoCompra('${acao}')"><span class="menu-compra-icone" aria-hidden="true">${icone}</span><span>${titulo}</span></button>`;
    }

    function fecharMenuAcaoCompra() {
        const overlay = document.getElementById('modalAcaoCompra');
        if(overlay) overlay.style.display = 'none';
        modalAcaoCompraId = null;
    }

    function posicionarMenuAcaoCompra(origemEl) {
        const menu = document.getElementById('menuAcaoCompra');
        const margem = 10;
        const largura = Math.min(270, window.innerWidth - margem * 2);
        menu.style.width = `${largura}px`;
        const origem = origemEl && origemEl.getBoundingClientRect ? origemEl.getBoundingClientRect() : null;
        const altura = menu.offsetHeight;
        let esquerda = origem ? origem.right - largura - 10 : (window.innerWidth - largura) / 2;
        esquerda = Math.max(margem, Math.min(esquerda, window.innerWidth - largura - margem));
        let topo = origem ? origem.bottom + 6 : (window.innerHeight - altura) / 2;
        if(topo + altura > window.innerHeight - margem && origem) topo = origem.top - altura - 6;
        topo = Math.max(margem, Math.min(topo, window.innerHeight - altura - margem));
        menu.style.left = `${Math.round(esquerda)}px`;
        menu.style.top = `${Math.round(topo)}px`;
    }

    function abrirAcoesCompra(paId, origemEl = null) {
        const pa = db.pedidosAtivos.find(x => x.idUnico === paId);
        if(!pa || pa.excluido) return;
        const p = db.produtos.find(prod => prod.id === pa.produtoId);
        if(!p) return;
        modalAcaoCompraId = paId;
        const apenasReceber = getPermissaoColab();
        let html = '';
        if(pa.status === 'pendente' && !apenasReceber) {
            html += botaoAcaoCompra('comprado', '✓', 'Comprado', 'comprado');
            html += botaoAcaoCompra('pedido_forn', iconePedidoFornecedorSvg('icone-send icone-send-menu'), 'Pedido ao fornecedor', 'fornecedor');
        } else if(pa.status === 'pedido_forn') {
            html += botaoAcaoCompra('entregue', '✓', 'Comprado', 'comprado');
            if(!apenasReceber) html += botaoAcaoCompra('voltar_pendente', '←', 'Voltar a pendente', 'secundaria');
        } else if(pa.status === 'comprado' && !apenasReceber) {
            html += botaoAcaoCompra('voltar_pendente', '←', 'Voltar a pendente', 'secundaria');
        } else if(pa.status === 'entregue' && !apenasReceber) {
            html += botaoAcaoCompra('voltar_fornecedor', '←', 'Voltar ao fornecedor', 'secundaria');
        } else if(pa.status === 'cancelado' && !apenasReceber) {
            html += botaoAcaoCompra('restaurar', '↶', 'Restaurar', 'secundaria');
        }
        if(!apenasReceber) html += botaoAcaoCompra('preco', 'R$', 'Preço e fornecedor', 'preco');
        if(!apenasReceber) html += botaoAcaoCompra('detalhes', 'i', 'Detalhes', 'detalhes');
        if(!apenasReceber && (pa.status === 'pendente' || pa.status === 'pedido_forn')) html += botaoAcaoCompra('cancelar', '×', 'Cancelar item', 'cancelar');
        if(!html) return mostrarToast('Nenhuma ação disponível.', 'info');
        document.getElementById('acoesDisponiveisCompra').innerHTML = html;
        document.getElementById('modalAcaoCompra').style.display = 'block';
        posicionarMenuAcaoCompra(origemEl);
    }

    function abrirDetalhesDaAcaoCompra() {
        const paId = modalAcaoCompraId;
        fecharMenuAcaoCompra();
        if(paId) abrirHistoricoCompra(paId);
    }

    function renderizarHistoricoPrecoRapido(produto) {
        const box = document.getElementById('historicoPrecoRapido');
        const registros = [...(produto.historicoPrecos || [])]
            .sort((a, b) => AloFeiraDomain.timestampPreco(b) - AloFeiraDomain.timestampPreco(a))
            .slice(0, 4);
        let html = '<div class="historico-preco-titulo">Histórico recente</div>';
        if(!registros.length) {
            box.innerHTML = html + '<div class="historico-preco-vazio">Nenhum preço registrado.</div>';
            return;
        }
        registros.forEach(registro => {
            const fornecedor = db.fornecedores.find(item => item.id === registro.fornecedorId);
            const local = fornecedor ? fornecedor.nome : 'Local não informado';
            const unidade = registro.unidade ? ` / ${registro.unidade}` : '';
            html += `<div class="historico-preco-linha"><span>${formatarDataBr(registro.data)} · ${escaparHtml(local)}</span><strong>R$ ${Number(registro.preco || 0).toLocaleString('pt-BR', { minimumFractionDigits:2 })}${escaparHtml(unidade)}</strong></div>`;
        });
        box.innerHTML = html;
    }

    function abrirPrecoRapido() {
        const paId = modalAcaoCompraId;
        const pa = db.pedidosAtivos.find(item => item.idUnico === paId);
        const produto = pa && db.produtos.find(item => item.id === pa.produtoId);
        fecharMenuAcaoCompra();
        if(!pa || !produto) return;
        document.getElementById('precoRapidoPedidoId').value = paId;
        document.getElementById('produtoPrecoRapido').textContent = produto.nome;
        document.getElementById('precoRapidoValor').value = '';

        const fornecedores = db.fornecedores.filter(item => item.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome));
        const comboFornecedor = document.getElementById('precoRapidoFornecedor');
        comboFornecedor.innerHTML = '<option value="">Local não informado</option>';
        fornecedores.forEach(fornecedor => {
            const option = document.createElement('option');
            option.value = fornecedor.id;
            option.textContent = fornecedor.nome;
            comboFornecedor.appendChild(option);
        });
        const fornecedorPadrao = pa.fornecedorId || (produto.fornecedores || []).find(id => fornecedores.some(item => item.id === id)) || '';
        comboFornecedor.value = fornecedorPadrao;

        const unidades = Array.from(new Set([pa.unidade, ...(produto.unidades || [])].filter(Boolean)));
        const comboUnidade = document.getElementById('precoRapidoUnidade');
        comboUnidade.innerHTML = '';
        (unidades.length ? unidades : ['']).forEach(unidade => {
            const option = document.createElement('option');
            option.value = unidade;
            option.textContent = unidade || 'Sem unidade';
            comboUnidade.appendChild(option);
        });
        renderizarHistoricoPrecoRapido(produto);
        document.getElementById('modalPrecoRapido').style.display = 'flex';
        const campo = document.getElementById('precoRapidoValor');
        campo.onkeydown = event => { if(event.key === 'Enter') { event.preventDefault(); salvarPrecoRapido(); } };
        setTimeout(() => campo.focus(), 120);
    }

    function salvarPrecoRapido() {
        const pa = db.pedidosAtivos.find(item => item.idUnico === document.getElementById('precoRapidoPedidoId').value);
        const produto = pa && db.produtos.find(item => item.id === pa.produtoId);
        if(!produto) return fecharModal('modalPrecoRapido');
        const preco = parseMoeda(document.getElementById('precoRapidoValor').value);
        if(!(preco > 0)) {
            document.getElementById('precoRapidoValor').focus();
            return mostrarToast('Digite um preço válido.', 'erro');
        }
        const fornecedorId = document.getElementById('precoRapidoFornecedor').value;
        const unidade = document.getElementById('precoRapidoUnidade').value;
        produto.historicoPrecos = produto.historicoPrecos || [];
        produto.historicoPrecos.push(criarRegistroPreco(preco, unidade, fornecedorId));
        vincularFornecedorPossivel(produto, fornecedorId);
        marcarMudancaEstrutural(produto);
        fecharModal('modalPrecoRapido');
        renderizarLista();
        sincronizarFundo(false, true);
        mostrarToast(fornecedorId ? 'Preço salvo e fornecedor vinculado.' : 'Preço salvo no histórico.', 'sucesso');
    }

    function vincularFornecedorPossivel(produto, fornecedorId) {
        if(!produto || !fornecedorId) return false;
        produto.fornecedores = produto.fornecedores || [];
        if(produto.fornecedores.includes(fornecedorId)) return false;
        produto.fornecedores.push(fornecedorId);
        return true;
    }

    function voltarStatusCompra(pa, destino) {
        if(getPermissaoColab()) return false;
        registrarDesfazer(pa);
        delete pa.transicaoProgresso;
        delete pa.statusAnterior;
        pa.status = destino;
        pa.dataStatus = agoraServidor();
        delete pa.dataConclusao;
        if(destino === 'pendente') delete pa.dataPedidoFornecedor;
        if(destino === 'pedido_forn' && !pa.dataPedidoFornecedor) pa.dataPedidoFornecedor = pa.dataStatus;
        return true;
    }

    function executarAcaoCompra(acao) {
        const pa = db.pedidosAtivos.find(x => x.idUnico === modalAcaoCompraId);
        if(!pa) return fecharMenuAcaoCompra();
        if(acao === 'preco') return abrirPrecoRapido();
        if(acao === 'detalhes') return abrirDetalhesDaAcaoCompra();
        if(acao === 'cancelar') {
            fecharMenuAcaoCompra();
            abrirConfirmarCancelamento(pa.idUnico);
            return;
        }
        let alterou = false;
        if(['pedido_forn', 'comprado', 'entregue'].includes(acao)) {
            const backup = JSON.parse(JSON.stringify(pa));
            const resultado = AloFeiraDomain.aplicarTransicao(pa, acao, agoraServidor(), getPermissaoColab());
            if(resultado.ok) { pilhaDesfazer.push([backup]); atualizarBotaoDesfazer(); alterou = true; }
            else return mostrarToast(resultado.motivo, 'erro');
        } else if(acao === 'voltar_pendente' || acao === 'restaurar') {
            alterou = voltarStatusCompra(pa, 'pendente');
        } else if(acao === 'voltar_fornecedor') {
            alterou = voltarStatusCompra(pa, 'pedido_forn');
        }
        if(!alterou) return;
        db.configs.syncPendente = true;
        salvarBanco();
        fecharMenuAcaoCompra();
        renderizarLista();
        sincronizarFundo(false, true);
        mostrarToast(`Item marcado como ${rotuloStatusCompra(pa.status).toLowerCase()}.`, 'sucesso');
    }

    function deletarPrecoDireto(pId, idx, paId) { abrirConfirmacaoApp({ titulo:'Excluir preço?', mensagem:'Este registro será removido do histórico de preços.', rotulo:'Excluir', cor:'#c62828', acao:() => { let p = db.produtos.find(x => x.id === pId); if(p && p.historicoPrecos && p.historicoPrecos[idx]) { p.historicoPrecos = AloFeiraDomain.normalizarHistoricoPrecos(p.historicoPrecos, p.atualizadoEm); const removido = p.historicoPrecos[idx]; p.precosExcluidos = p.precosExcluidos || {}; p.precosExcluidos[removido.id] = agoraServidor(); p.historicoPrecos.splice(idx, 1); marcarMudancaEstrutural(p); sincronizarFundo(false, true); if (document.getElementById('modalHistoricoCompra').style.display === 'flex') { abrirHistoricoCompra(paId); } else if(document.getElementById('modalEditarPedido').style.display === 'flex') { abrirModalEditarPedido(paId, pId); } else { abrirFormProduto(pId); } } } }); }
    function deletarPedidoDireto(idUnico, pId, paId) { abrirConfirmacaoApp({ titulo:'Excluir pedido?', mensagem:'Este pedido será removido do histórico geral.', rotulo:'Excluir', cor:'#c62828', acao:() => { let pa = db.pedidosAtivos.find(x => x.idUnico === idUnico); if(pa) { pa.excluido = true; pa.excluidoCompras = true; pa.dataExclusao = agoraServidor(); pa.dataStatus = pa.dataExclusao; db.configs.syncPendente = true; salvarBanco(); sincronizarFundo(false, true); const historicoAberto = document.getElementById('modalHistoricoPedidosProduto').style.display === 'flex'; if(historicoAberto && paId && paId !== idUnico) renderizarHistoricoPedidosProduto(pId, paId); else if(paId && paId !== idUnico) abrirModalEditarPedido(paId, pId); else abrirFormProduto(pId); } } }); }
