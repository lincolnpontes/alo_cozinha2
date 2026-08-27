function cancelarRascunhos() {
    const total = db.pedidosAtivos.filter(pa => pa.status === 'rascunho').length;
    if(!total) return;
    abrirConfirmacaoApp({ titulo:'Cancelar pedido?', mensagem:`Os ${total} item(ns) preparados serão removidos.`, rotulo:'Cancelar pedido', cor:'#c62828', acao:executarCancelamentoRascunhos });
}
function executarCancelamentoRascunhos() { db.pedidosAtivos = db.pedidosAtivos.filter(pa => pa.status !== 'rascunho'); salvarBanco(); renderizarLista(); isModalFechando = true; setTimeout(() => { isModalFechando = false; }, 400); }
    function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    async function aguardarSyncLivre(timeoutMs = 12000) { const inicio = Date.now(); while(isSyncingFundo && Date.now() - inicio < timeoutMs) { await esperar(250); } return !isSyncingFundo; }
    async function enviarPedidosParaCompras(confirmado = false) {
        if(envioPedidoEmAndamento) return;
        if(!db.configs.url) return alert('Configure primeiro a nuvem nas configurações do Alô Cozinha.');
        if(!db.pedidosAtivos.some(pa => pa.status === 'rascunho' && !pa.excluido)) return;
        if(!confirmado) {
            const total = db.pedidosAtivos.filter(pa => pa.status === 'rascunho' && !pa.excluido).length;
            return abrirConfirmacaoApp({ titulo:'Enviar pedido?', mensagem:`Enviar ${total} item(ns) preparados para a lista de compras?`, rotulo:'Enviar pedido', cor:'#1565C0', acao:() => enviarPedidosParaCompras(true) });
        }
        envioPedidoEmAndamento = true;
        document.getElementById('loadingOverlay').style.display = 'flex';
        document.getElementById('loadingText').textContent = 'Enviando pedido...';
        let backupsRascunhos = [];
        let syncPendenteAntes = db.configs.syncPendente;
        try {
            const livre = await aguardarSyncLivre(16000);
            if(!livre) throw new Error('A sincronização anterior não terminou a tempo.');
            syncPendenteAntes = db.configs.syncPendente;
            const rascunhos = db.pedidosAtivos.filter(pa => pa.status === 'rascunho' && !pa.excluido);
            if(rascunhos.length === 0) throw new Error('Os rascunhos não estão mais disponíveis.');
            backupsRascunhos = rascunhos.map(pa => JSON.parse(JSON.stringify(pa)));
            const agora = agoraServidor();
            rascunhos.forEach(pa => {
                pa.status = 'pendente';
                pa.dataStatus = agora;
                pa.dataEnvio = agora;
                delete pa.dataPedidoFornecedor;
            });
            db.configs.syncPendente = true;
            salvarBanco();
            isSyncingFundo = true;
            const envioLeve = await postarPedidosNovos(rascunhos);
            if(!envioLeve.suportado) {
                await postarBanco();
            } else {
                db.configs.syncPendente = Boolean(syncPendenteAntes || envioLeve.conflito);
                salvarBanco();
                if(db.configs.syncPendente) { syncRepetir = true; syncRepetirApenasEmpurrar = true; }
            }
            mostrarToast('Pedido confirmado na nuvem.', 'sucesso', 4200);
            renderizarLista();
        } catch(error) {
            backupsRascunhos.forEach(backup => {
                const idx = db.pedidosAtivos.findIndex(pa => pa.idUnico === backup.idUnico);
                if(idx >= 0) db.pedidosAtivos[idx] = backup;
            });
            db.configs.syncPendente = syncPendenteAntes;
            salvarBanco();
            mostrarToast(`Pedido não enviado. Os itens continuam preparados. ${error.message}`, 'erro', 7000);
            renderizarLista();
        } finally {
            isSyncingFundo = false;
            envioPedidoEmAndamento = false;
            document.getElementById('loadingOverlay').style.display = 'none';
            if(syncRepetir) {
                const somenteEnvio = syncRepetirApenasEmpurrar;
                syncRepetir = false;
                syncRepetirApenasEmpurrar = false;
                setTimeout(() => sincronizarFundo(false, somenteEnvio), 180);
            }
        }
    }
    function abrirPedidosHoje() {
        const modal = document.getElementById('modalPedidosHoje');
        const lista = document.getElementById('listaPedidosHoje');
        const hoje = new Date().setHours(0,0,0,0);
        const itensHojeDetalhado = db.pedidosAtivos
            .filter(pa => {
                if(pa.status === 'rascunho' || pa.excluido) return false;
                return pa.dataEnvio ? new Date(pa.dataEnvio).setHours(0,0,0,0) === hoje : false;
            })
            .map(pa => ({ pa, p: db.produtos.find(x => x.id === pa.produtoId) }))
            .filter(item => item.p)
            .sort(ordernarPorCategoriaESub);
        let htmlLista = '';
        const isAdmin = temAcessoAdmin();
        if(itensHojeDetalhado.length === 0) {
            htmlLista = '<div style="padding:20px; text-align:center; color:#666; font-size:14px;">Nenhum pedido enviado hoje.</div>';
        } else {
            const statusNomes = { pendente:'Pendente', pedido_forn:'No fornecedor', comprado:'Comprado', entregue:'Entregue', cancelado:'Cancelado' };
            itensHojeDetalhado.forEach(({pa, p}) => {
                const statusNome = statusNomes[pa.status] || pa.status;
                const podeEditar = isAdmin || pa.colaboradorId === db.configs.colabAtivoId;
                let acoes = '';
                if(pa.status === 'pendente' && podeEditar) {
                    acoes = `<button type="button" aria-label="Editar pedido" onclick="abrirModalEditarPedido('${pa.idUnico}', '${pa.produtoId}')" class="btn-icon-lista">✏️</button><button type="button" aria-label="Excluir pedido" onclick="excluirPedidoHoje('${pa.idUnico}')" class="btn-icon-lista perigo">🗑️</button>`;
                } else if(pa.status !== 'pendente') {
                    acoes = `<span class="pedido-bloqueado">${escaparHtml(statusNome)}</span>`;
                }
                const qtd = pa.qtd !== '' ? pa.qtd : null;
                const unidade = pa.unidade || '';
                const quantidade = qtd !== null ? `${qtd}${unidade ? ' ' + unidade : ''}` : unidade;
                const obs = pa.obs ? `<span class="pedido-hoje-obs">Obs: ${escaparHtml(pa.obs)}</span>` : '';
                htmlLista += `<div class="pedido-hoje-item"><div class="pedido-hoje-info"><strong>${escaparHtml(p.nome)}</strong>${quantidade ? `<span class="pedido-hoje-qtd">${escaparHtml(quantidade)}</span>` : ''}<span class="pedido-hoje-status">${escaparHtml(statusNome)}</span>${obs}</div><div class="pedido-hoje-acoes">${acoes}</div></div>`;
            });
        }
        lista.innerHTML = htmlLista;
        modal.style.display = 'flex';
    }
    function excluirPedidoHoje(idUnico) { abrirConfirmacaoApp({ titulo:'Excluir pedido?', mensagem:'Este pedido feito hoje será removido definitivamente.', rotulo:'Excluir', cor:'#c62828', acao:() => { let pa = db.pedidosAtivos.find(x => x.idUnico === idUnico); if(pa) { pa.excluido = true; pa.status = 'excluido'; pa.excluidoPorPedidos = true; pa.dataExclusao = agoraServidor(); pa.dataStatus = pa.dataExclusao; db.configs.syncPendente = true; salvarBanco(); abrirPedidosHoje(); renderizarLista(); sincronizarFundo(false, true); } } }); }
    async function compartilharTxtNativo() { let hoje = new Date().setHours(0,0,0,0); let itensHoje = db.pedidosAtivos.filter(pa => { if(pa.status === 'rascunho' || pa.excluido) return false; let dataPa = pa.dataEnvio ? new Date(pa.dataEnvio).setHours(0,0,0,0) : 0; return dataPa === hoje; }); if (itensHoje.length === 0) return alert("Nenhum pedido foi enviado hoje para ser exportado."); let itensHojeDetalhado = itensHoje.map(pa => ({ pa: pa, p: db.produtos.find(x => x.id === pa.produtoId) })).filter(item => item.p); itensHojeDetalhado.sort(ordernarPorCategoriaESub); let gruposArr = []; itensHojeDetalhado.forEach(item => { let nomeGrupo = item.p.subcategoria && item.p.subcategoria.trim() !== "" ? item.p.subcategoria.trim() : (db.categorias.find(c => c.id === item.p.categoria)?.nome || "Outros"); let g = gruposArr.find(x => x.nome === nomeGrupo); if(!g) { g = { nome: nomeGrupo, itens: [] }; gruposArr.push(g); } g.itens.push(item); }); let blocosTexto = []; gruposArr.forEach(grupo => { let txt = `> *${grupo.nome}*\n`; let linhas = grupo.itens.map(item => { let qtyVal = item.pa.qtd !== '' ? item.pa.qtd : null; let unVal = item.pa.unidade ? item.pa.unidade : null; let qtdStr = ""; if(qtyVal !== null && unVal !== null) qtdStr = ` - Qtd: ${qtyVal} ${unVal}`; else if(qtyVal !== null) qtdStr = ` - Qtd: ${qtyVal}`; else if(unVal !== null) qtdStr = ` - Qtd: ${unVal}`; let obsStr = item.pa.obs ? ` *(obs.: ${item.pa.obs})*` : ''; return `▪ ${item.p.nome}${qtdStr}${obsStr}`; }); blocosTexto.push(txt + linhas.join('\n')); }); const textoFinal = blocosTexto.join('\n\n'); const d = new Date(); const dataBrFormatada = `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; const nomeRes = db.restaurante.nome || "Restaurante"; const nomeArquivo = `Pedido - ${nomeRes} - ${dataBrFormatada}.txt`; const file = new File([textoFinal], nomeArquivo, { type: 'text/plain' }); if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Relatório de Pedidos', text: 'Segue a lista de pedidos gerada hoje.' }); } catch (error) { console.log('Compartilhamento falhou', error); } } else { const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = nomeArquivo; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); alert("O arquivo foi baixado."); } }
