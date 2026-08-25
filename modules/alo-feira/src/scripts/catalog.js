function statusEfetivoNoAgrupamento(pedido, agora = agoraServidor()) {
        const iniciou = Number(pedido && pedido.transicaoProgresso || 0);
        return iniciou && agora - iniciou < 10000 ? pedido.statusAnterior : pedido.status;
    }

    function agendarReagrupamentoCompras() {
        if(timerReagruparCompras) clearTimeout(timerReagruparCompras);
        timerReagruparCompras = null;
        if(db.configs.modo !== 'compras' || !agrupamentoCompradoAtivo) return;
        const agora = agoraServidor();
        const esperas = db.pedidosAtivos
            .filter(pedido => pedido.transicaoProgresso && agora - Number(pedido.transicaoProgresso) < 10000)
            .map(pedido => Math.max(0, 10000 - (agora - Number(pedido.transicaoProgresso))));
        if(!esperas.length) return;
        timerReagruparCompras = setTimeout(() => {
            timerReagruparCompras = null;
            if(db.configs.modo === 'compras' && agrupamentoCompradoAtivo) renderizarLista();
        }, Math.min(...esperas));
    }

    function renderizarLista() {
        const lista = document.getElementById('listaPrincipal');
        let htmlPrincipal = '';
        let itensMostrados = 0;
        let colabLogado = db.colaboradores.find(c => c.id === db.configs.colabAtivoId);
        let catsPermitidas = getCatsPermitidas(colabLogado);
        let temRascunho = false;
        let produtosOrdenados = db.produtos.filter(p => p.ativo !== false);

        if (db.configs.modo === 'pedido') { db.categorias.filter(cat => cat.ativo !== false).forEach(cat => { if (cat.permiteAvulso) { produtosOrdenados.push({ id: 'dummy_' + cat.id, categoria: cat.id, subcategoria: '', nome: '', isDummy: true }); } }); }
        produtosOrdenados.sort(ordernarPorCategoriaESub);
        if (db.configs.modo === 'pedido') {
            let lastCatId = ""; let lastSubcat = null;
            produtosOrdenados.forEach(p => {
                if (filtroFornecedorComprasId) { if (!p.fornecedores || !p.fornecedores.includes(filtroFornecedorComprasId)) return; }
                if(categoriaAtual && p.categoria !== categoriaAtual) return; if(catsPermitidas && !catsPermitidas.includes(p.categoria)) return;
                let cObj = db.categorias.find(c => c.id === p.categoria); let catId = cObj ? cObj.id : "sem_cat"; let subcat = p.subcategoria || "";
                if(buscaPedidoTexto) { if(p.isDummy) return; let busca = normalizarTextoBusca(buscaPedidoTexto); let textoItem = normalizarTextoBusca(`${p.nome} ${p.descFornecedor || ''} ${p.obsPadrao || ''} ${subcat} ${cObj ? cObj.nome : ''}`); if(!textoItem.includes(busca)) return; }
                if (catId !== lastCatId) {
                    let catName = cObj ? escaparHtml(cObj.nome) : "Sem Categoria";
                    let btnAvulso = (cObj && cObj.permiteAvulso) ? `<button onclick="abrirModalAvulso('${cObj.id}'); event.stopPropagation();" style="background:#fff; border:1px solid #ccc; border-radius:4px; color:#1565C0; font-size:12px; padding:2px 8px; cursor:pointer; font-weight:bold;">+ Avulso</button>` : '';
                    if (categoriaAtual === null || categoriaAtual === catId) {
                        const corCategoria = cObj ? cObj.cor : '#e0e0e0';
                        const corTextoCategoria = cObj ? cObj.corTexto : '#333';
                        htmlPrincipal += `<li class="cat-header" style="cursor:default; background-color:${corCategoria}; color:${corTextoCategoria};"><span>🏷️ ${catName}</span> ${btnAvulso}</li>`;
                        itensMostrados++;
                    }
                    lastCatId = catId; lastSubcat = null;
                }
                if (p.isDummy) return;
                let subcatGroupId = "sub_" + idDomSeguro(catId) + "_" + idDomSeguro(subcat);
                if (subcat !== lastSubcat && subcat !== "") {
                    htmlPrincipal += `<li class="subcat-header" style="cursor:default;"><span>▪ ${escaparHtml(subcat)}</span></li>`;
                    lastSubcat = subcat;
                }
                const pedidosDeste = db.pedidosAtivos.filter(pa => { if (pa.produtoId !== p.id) return false; if (pa.excluido && pa.excluidoPorPedidos) return false; if (!pa.excluido && ['rascunho', 'pendente', 'pedido_forn'].includes(pa.status)) return true; let ts = pa.dataConclusao || pa.dataExclusao || pa.dataStatus || parseInt(pa.idUnico.split('_')[1]); if (ts) { let diffDias = (Date.now() - ts) / (1000 * 60 * 60 * 24); return diffDias <= 7; } return false; });
                const concluidos = pedidosDeste.filter(pa => pa.excluido || ['comprado', 'entregue', 'cancelado'].includes(pa.status)); const ultimoConcluido = concluidos.length > 0 ? concluidos[concluidos.length - 1] : null; const pedidoEditavel = pedidosDeste.find(pa => !pa.excluido && ['rascunho', 'pendente', 'pedido_forn'].includes(pa.status));
                if (p.avulso && !ultimoConcluido && !pedidoEditavel) { return; }

                let classesExtra = ""; let infoDireita = ""; let iconeListaPedido = '○'; let classeIconePedido = 'pendente';
                let defaultUn = p.unidades && p.unidades.length > 0 ? p.unidades[0] : '';
                let padraoTexto = (p.qtdPadrao !== null && p.qtdPadrao !== '') ? `(Padrão: ${p.qtdPadrao} ${defaultUn})` : '';
                if(p.obsPadrao) { let quebra = padraoTexto ? '<br>' : ''; padraoTexto += `${quebra}<span style="color:#000; font-size:11px;">Obs Padrão: ${escaparHtml(p.obsPadrao)}</span>`; }

                if (pedidoEditavel) {
                    let statusName = 'Rascunho'; let statusClass = 'bg-rascunho';
                    if(pedidoEditavel.status === 'pendente') { statusName = 'Pendente'; statusClass = 'bg-pendente'; }
                    else if(pedidoEditavel.status === 'pedido_forn') { statusName = 'Pedido Forn.'; statusClass = 'bg-pedido_forn'; }
                    let obsVisual = pedidoEditavel.obs ? `<div style="color:#000; font-size:11px;">Obs: ${escaparHtml(pedidoEditavel.obs)}</div>` : "";
                    let qtyVal = pedidoEditavel.qtd !== '' ? pedidoEditavel.qtd : null; let unVal = pedidoEditavel.unidade ? pedidoEditavel.unidade : null;
                    let qtdStrDisplay = (qtyVal !== null && unVal !== null) ? `${qtyVal} ${unVal}` : (qtyVal !== null ? `${qtyVal}` : (unVal !== null ? `${unVal}` : ""));
                    let exibicaoQtd = qtdStrDisplay ? `<div style="font-weight: bold; font-size: 14px; color: #1565C0;">${escaparHtml(qtdStrDisplay)}</div>` : "";
                    infoDireita += `<div style="text-align: right;"><div class="status-badge ${statusClass}" style="margin-bottom: 2px;">${statusName}</div>${exibicaoQtd}${obsVisual}</div>`;
                    classesExtra += (pedidoEditavel.status === 'rascunho') ? "item-pedido-rascunho " : "item-pedido-ativo ";
                    if(pedidoEditavel.status === 'rascunho') { iconeListaPedido = '✓'; classeIconePedido = 'rascunho'; }
                    else if(pedidoEditavel.status === 'pedido_forn') { iconeListaPedido = iconePedidoFornecedorSvg('icone-send icone-send-status'); classeIconePedido = 'pedido_forn'; }
                    if(pedidoEditavel.status === 'rascunho') temRascunho = true;
                } else if (ultimoConcluido) {
                    let statusName = "Excluído"; let statusClass = "bg-excluido";
                    if (ultimoConcluido.excluido && ultimoConcluido.excluidoCompras) { statusName = "Excluído"; statusClass = "bg-excluido"; }
                    else if (!ultimoConcluido.excluido) {
                        switch(ultimoConcluido.status) {
                            case 'comprado': statusName = 'Comprado'; statusClass = 'bg-comprado'; break;
                            case 'entregue': statusName = 'Entregue'; statusClass = 'bg-entregue'; break;
                            case 'cancelado': statusName = 'Cancelado'; statusClass = 'bg-cancelado'; break;
                        }
                    }
                    let obsVisual = ultimoConcluido.obs && !ultimoConcluido.excluido ? `<div style="color:#000; font-size:10px;">Obs: ${escaparHtml(ultimoConcluido.obs)}</div>` : "";
                    let qtyVal = ultimoConcluido.qtd !== '' ? ultimoConcluido.qtd : null; let unVal = ultimoConcluido.unidade ? ultimoConcluido.unidade : null;
                    let qtdStrDisplay = (qtyVal !== null && unVal !== null) ? `${qtyVal} ${unVal}` : (qtyVal !== null ? `${qtyVal}` : (unVal !== null ? `${unVal}` : ""));
                    let exibicaoQtd = qtdStrDisplay && !ultimoConcluido.excluido ? `<div style="font-size: 11px; color: #777;">${escaparHtml(qtdStrDisplay)}</div>` : "";
                    infoDireita += `<div style="text-align: right;"><div class="status-badge ${statusClass}" style="margin-bottom: 2px;">${statusName}</div>${exibicaoQtd}${obsVisual}</div>`;
                    if(ultimoConcluido.excluido || ultimoConcluido.status === 'cancelado') { iconeListaPedido = '×'; classeIconePedido = 'cancelado'; }
                    else { iconeListaPedido = '✓'; classeIconePedido = ultimoConcluido.status === 'entregue' ? 'entregue' : 'comprado'; }
                }

                let pedIdAtributo = pedidoEditavel ? pedidoEditavel.idUnico : '';
                const rotuloAcao = pedidoEditavel ? (pedidoEditavel.status === 'rascunho' ? 'Editar pedido de' : 'Item no fluxo de compra:') : 'Adicionar';
                htmlPrincipal += `<li class="item item-pedido ${classesExtra}" data-id="${p.id}" data-pedid="${pedIdAtributo}" data-cat-id="${catId}" data-sub-id="${subcatGroupId}"><button type="button" class="item-main-action" aria-label="${rotuloAcao} ${escaparHtml(p.nome)}" onclick="cliqueItemPedido('${p.id}', this.closest('.item'))"><span class="item-status-pedido" aria-hidden="true"><span class="status-glyph ${classeIconePedido}">${iconeListaPedido}</span></span><div class="item-info"><div class="item-title">${escaparHtml(p.nome)}</div><div class="item-subtitle">${padraoTexto}</div></div><div class="info-direita" style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">${infoDireita}</div></button></li>`;
                itensMostrados++;
            });
            document.getElementById('containerBotoesEnvio').style.display = temRascunho ? 'flex' : 'none';
        } else {
            let comprasParaMostrar = db.pedidosAtivos.filter(pa => pa.status !== 'rascunho' && !pa.excluido && !pa.ocultoCompras);
            if(agrupamentoCompradoAtivo) {
                comprasParaMostrar.sort((a, b) => {
                    let getStatusPrio = (s) => s === 'pendente' ? 1 : (s === 'pedido_forn' ? 2 : (s === 'cancelado' ? 4 : 3));
                    let statusEfetivoA = statusEfetivoNoAgrupamento(a);
                    let statusEfetivoB = statusEfetivoNoAgrupamento(b);
                    let prioA = getStatusPrio(statusEfetivoA); let prioB = getStatusPrio(statusEfetivoB);
                    if (prioA !== prioB) return prioA - prioB;
                    let pA = db.produtos.find(p => p.id === a.produtoId); let pB = db.produtos.find(p => p.id === b.produtoId); return ordernarPorCategoriaESub({p: pA}, {p: pB});
                });
            } else {
                comprasParaMostrar.sort((a, b) => { let pA = db.produtos.find(p => p.id === a.produtoId); let pB = db.produtos.find(p => p.id === b.produtoId); return ordernarPorCategoriaESub({p: pA}, {p: pB}); });
            }
            let lastGroup = ""; let lastCatId = ""; let lastSubcat = null;
            comprasParaMostrar.forEach(pa => {
                const p = db.produtos.find(prod => prod.id === pa.produtoId); if(!p) return;
                if (filtroFornecedorComprasId) { if (!p.fornecedores || !p.fornecedores.includes(filtroFornecedorComprasId)) return; }
                if(categoriaAtual && p.categoria !== categoriaAtual) return; if(catsPermitidas && !catsPermitidas.includes(p.categoria)) return;
                let cObj = db.categorias.find(c => c.id === p.categoria); let catId = cObj ? cObj.id : "sem_cat"; let subcat = p.subcategoria || ""; let stGroupId = "st_" + pa.status; let catGroupId = "cat_" + idDomSeguro(catId); let subcatGroupId = "cat_" + idDomSeguro(catId) + "_sub_" + idDomSeguro(subcat);
                if(buscaPedidoTexto) { let busca = normalizarTextoBusca(buscaPedidoTexto); let textoItem = normalizarTextoBusca(`${p.nome} ${p.descFornecedor || ''} ${p.obsPadrao || ''} ${pa.obs || ''} ${subcat} ${cObj ? cObj.nome : ''}`); if(!textoItem.includes(busca)) return; }
                if (agrupamentoCompradoAtivo) {
                    let statusEfetivo = statusEfetivoNoAgrupamento(pa);
                    let currentGroup = statusEfetivo === 'pendente' ? '⏳ PENDENTES' : (statusEfetivo === 'pedido_forn' ? `${iconePedidoFornecedorSvg('icone-send icone-send-grupo')} PEDIDOS AO FORNECEDOR` : (statusEfetivo === 'cancelado' ? '🚫 CANCELADOS' : '✓ COMPRADOS / ENTREGUES'));
                    if (currentGroup !== lastGroup) { htmlPrincipal += `<li class="cat-header" style="background:#546e7a; color:#fff;"><span>${currentGroup}</span></li>`; lastGroup = currentGroup; lastCatId = ""; lastSubcat = null; }
                    catGroupId = stGroupId + "_" + catGroupId; subcatGroupId = stGroupId + "_" + subcatGroupId;
                }
                if (categoriaAtual === null || agrupamentoCompradoAtivo) { if (catId !== lastCatId) { let catName = cObj ? escaparHtml(cObj.nome) : "Sem Categoria"; let corCategoria = cObj ? cObj.cor : '#e0e0e0'; let corTextoCategoria = cObj ? cObj.corTexto : '#333'; htmlPrincipal += `<li class="cat-header" style="background-color:${corCategoria}; color:${corTextoCategoria};" onclick="selecionarGrupoCompras('${catGroupId}', 'cat')"><span>🏷️ ${catName}</span></li>`; lastCatId = catId; lastSubcat = null; } }
                if (subcat !== lastSubcat && subcat !== "") { htmlPrincipal += `<li class="subcat-header" onclick="selecionarGrupoCompras('${subcatGroupId}', 'sub')"><span>▪ ${escaparHtml(subcat)}</span></li>`; lastSubcat = subcat; }
                const catObj = db.categorias.find(c => c.id === p.categoria) || { cor: '#999', corTexto: '#fff' }; let emojiStatus = pa.status === 'pendente' ? '○' : (pa.status === 'pedido_forn' ? iconePedidoFornecedorSvg('icone-send icone-send-status') : (pa.status === 'cancelado' ? '×' : '✓')); let isSelected = itensSelecionadosRelatorio.has(pa.idUnico); let qtyVal = pa.qtd !== '' ? pa.qtd : null; let unVal = pa.unidade ? pa.unidade : null; let qtdStrDisplay = ""; if(qtyVal !== null && unVal !== null) qtdStrDisplay = `${qtyVal} ${unVal}`; else if(qtyVal !== null) qtdStrDisplay = `${qtyVal}`; else if(unVal !== null) qtdStrDisplay = `${unVal}`; let tituloItem = escaparHtml(p.nome);

                let tsReferencia; if (pa.status === 'pendente') { tsReferencia = pa.dataEnvio || parseInt(pa.idUnico.split('_')[1]); } else if (pa.status === 'pedido_forn') { tsReferencia = pa.dataPedidoFornecedor || pa.dataStatus || pa.dataEnvio || parseInt(pa.idUnico.split('_')[1]); } else { tsReferencia = pa.dataConclusao || pa.dataExclusao || pa.dataStatus || parseInt(pa.idUnico.split('_')[1]); } let tempoTxt = tsReferencia ? ` ${tempoRelativo(tsReferencia)}` : "";

                let nomeStatus = ""; let statusClass = "bg-pendente"; let itemClassExtra = pa.status === 'cancelado' ? 'riscado' : '';
                switch(pa.status) { case 'pendente': nomeStatus = 'Pendente'; statusClass = 'bg-pendente'; break; case 'comprado': nomeStatus = 'Comprado'; statusClass = 'bg-comprado'; break; case 'pedido_forn': nomeStatus = 'Pedido Forn.'; statusClass = 'bg-pedido_forn'; break; case 'entregue': nomeStatus = 'Entregue'; statusClass = 'bg-entregue'; break; case 'cancelado': nomeStatus = 'Cancelado'; statusClass = 'bg-cancelado'; break; }
                let statusText = nomeStatus + tempoTxt; let editIndicador = pa.historico && pa.historico.some(h => h.msg.includes('Editado em compras')) ? ' <span style="font-size:10px; color:#a61b1b; font-weight:bold;">Editado</span>' : ''; let obsVisual = pa.obs ? `<div class="item-subtitle" style="margin-top:2px; font-weight:600; color:#444;">Obs: ${escaparHtml(pa.obs)}</div>` : ""; let exibicaoQtd = qtdStrDisplay ? `<span style="font-weight:700; font-size:14px; color:#4a235a;">${escaparHtml(qtdStrDisplay)}</span>` : ""; let infoDireita = `<div class="status-pill">${statusText}</div>${exibicaoQtd}`;
                htmlPrincipal += `<li class="item status-${pa.status} ${itemClassExtra} ${isSelected ? 'selecionado' : ''}" data-id="${pa.idUnico}" data-grp-cat="${catGroupId}" data-grp-sub="${subcatGroupId}"><button type="button" class="seletor-item-compra" aria-label="Selecionar ${tituloItem}" aria-pressed="${isSelected}" onclick="selecionarItemCompraDireto(event, '${pa.idUnico}')"><span class="status-glyph ${pa.status}">${isSelected ? '✓' : emojiStatus}</span></button><button type="button" class="item-main-action" aria-label="Ações de ${tituloItem}. ${nomeStatus}" onclick="cliqueItemCompra('${pa.idUnico}', this.closest('.item'))"><div style="display: flex; align-items: center; flex: 1; overflow: hidden;"><div class="item-info" style="overflow: hidden; text-overflow: ellipsis; padding-right: 5px;"><div class="item-title">${tituloItem}${editIndicador}</div>${obsVisual}</div></div><div class="info-direita" style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; margin-left: 5px;">${infoDireita}</div></button></li>`;
                itensMostrados++;
            });
        }
        if(itensMostrados === 0) htmlPrincipal = `<li style="padding: 20px; text-align: center; color: #999;">Nenhum item.</li>`;
        lista.innerHTML = htmlPrincipal;
        agendarReagrupamentoCompras();
    }

    function cliqueItemCompra(idUnico, el) { if(isModalFechando) return; abrirAcoesCompra(idUnico, el); }
    function cliqueItemPedido(pId, el) { if(isModalFechando) return; acaoToqueSimples(el); }
