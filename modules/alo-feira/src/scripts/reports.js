function abrirModalRelatorio() {
    const selForn = document.getElementById('relatFornecedor');
    selForn.innerHTML = '<option value="">Selecione um fornecedor</option>';
    [...db.fornecedores]
        .filter(f => f.ativo !== false)
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .forEach(f => {
            const option = document.createElement('option');
            option.value = f.id;
            option.textContent = `${f.nome} (Vend: ${f.vendedor || 'N/A'})`;
            selForn.appendChild(option);
        });
    aplicarPreferenciasRelatorio(null);
    document.getElementById('modalRelatorio').style.display = 'flex';
    gerarTextoRelatorio();
}

function normalizarPreferenciasRelatorio(preferencias) {
    if(!preferencias || typeof preferencias !== 'object') {
        return { cabecalho:true, agruparCategorias:true, cotacao:true, pedido:false, mostrarQuantidade:true };
    }
    const pedido = preferencias.pedido === true;
    return {
        cabecalho: preferencias.cabecalho !== false,
        agruparCategorias: preferencias.agruparCategorias !== false,
        cotacao: pedido ? false : preferencias.cotacao !== false,
        pedido,
        mostrarQuantidade: preferencias.mostrarQuantidade !== false
    };
}

function lerPreferenciasRelatorioTela() {
    return {
        cabecalho: document.getElementById('relatToggleCab').checked,
        agruparCategorias: document.getElementById('relatToggleCat').checked,
        cotacao: document.getElementById('relatToggleItens').checked,
        pedido: document.getElementById('relatTogglePedido').checked,
        mostrarQuantidade: document.getElementById('relatToggleQtd').checked
    };
}

function aplicarPreferenciasRelatorio(fornecedor) {
    const preferencias = normalizarPreferenciasRelatorio(fornecedor && fornecedor.preferenciasRelatorio);
    document.getElementById('relatToggleCab').checked = preferencias.cabecalho;
    document.getElementById('relatToggleCat').checked = preferencias.agruparCategorias;
    document.getElementById('relatToggleItens').checked = preferencias.cotacao;
    document.getElementById('relatTogglePedido').checked = preferencias.pedido;
    document.getElementById('relatToggleQtd').checked = preferencias.mostrarQuantidade;
}

function selecionarFornecedorRelatorio() {
    const fornId = document.getElementById('relatFornecedor').value;
    const fornecedor = db.fornecedores.find(item => item.id === fornId);
    aplicarPreferenciasRelatorio(fornecedor);
    gerarTextoRelatorio();
}

function registrarPreferenciasRelatorioEnviadas(fornecedor) {
    if(!fornecedor) return;
    const preferencias = lerPreferenciasRelatorioTela();
    if(JSON.stringify(fornecedor.preferenciasRelatorio || null) === JSON.stringify(preferencias)) return;
    fornecedor.preferenciasRelatorio = preferencias;
    marcarMudancaEstrutural(fornecedor);
    sincronizarFundo(false, true);
}

function toggleExclusivoRelatorio(tipo) {
    if(tipo === 'cotacao' && document.getElementById('relatToggleItens').checked) {
        document.getElementById('relatTogglePedido').checked = false;
    } else if(tipo === 'pedido' && document.getElementById('relatTogglePedido').checked) {
        document.getElementById('relatToggleItens').checked = false;
    }
}

function obterItensProcessadosRelatorio(ids, banco = db) {
    return ids
        .map(idUnico => {
            const pa = banco.pedidosAtivos.find(item => item.idUnico === idUnico);
            const p = pa ? banco.produtos.find(item => item.id === pa.produtoId) : null;
            return { pa, p };
        })
        .filter(item => item.pa && item.p);
}

function gerarLinhaRelatorio(item, mostrarQtd) {
    const nomeItem = item.p.descFornecedor ? item.p.descFornecedor : item.p.nome;
    const marcasStr = item.pa.marcasSelecionadas && item.pa.marcasSelecionadas.length > 0
        ? ` - Marca: ${item.pa.marcasSelecionadas.join(', ')}`
        : '';
    const qtyVal = item.pa.qtd !== '' ? item.pa.qtd : null;
    const unVal = item.pa.unidade ? item.pa.unidade : null;
    let qtdStr = '';
    if(mostrarQtd) {
        if(qtyVal !== null && unVal !== null) qtdStr = ` *- Qtd: ${qtyVal} ${unVal}*`;
        else if(qtyVal !== null) qtdStr = ` *- Qtd: ${qtyVal}*`;
        else if(unVal !== null) qtdStr = ` *- Qtd: ${unVal}*`;
    }
    const obsStr = item.pa.obs ? ` *(obs.: ${item.pa.obs})*` : '';
    return `▪ ${nomeItem}${marcasStr}${qtdStr}${obsStr}`;
}

function atualizarEnvioWhatsAppRelatorio(fornecedor) {
    const botao = document.getElementById('btnEnviarWhatsAppRelatorio');
    if(!botao) return;
    botao.disabled = !fornecedor;
    botao.dataset.tel = fornecedor && fornecedor.telefone ? fornecedor.telefone : '';
    botao.title = fornecedor ? 'Enviar relatório pelo WhatsApp' : 'Selecione um fornecedor';
}

function gerarTextoRelatorio() {
    const fornId = document.getElementById('relatFornecedor').value;
    const res = db.restaurante;
    const forn = db.fornecedores.find(f => f.id === fornId);
    const incluirCabecalho = document.getElementById('relatToggleCab').checked;
    const agruparCat = document.getElementById('relatToggleCat').checked;
    const isCotacao = document.getElementById('relatToggleItens').checked;
    const isPedido = document.getElementById('relatTogglePedido').checked;
    const mostrarQtd = document.getElementById('relatToggleQtd').checked;
    const blocos = [];

    if(incluirCabecalho) {
        let cab = `> *${res.nome.toUpperCase()}*\n> CNPJ: ${res.cnpj}\n> End.: ${res.rua}, ${res.numero}\n> ${res.bairro} - ${res.cidade} / ${res.uf}`;
        if(res.ponto) cab += `\n> Ponto de referência: ${res.ponto}`;
        blocos.push(cab);
    }
    if(isCotacao) blocos.push('*ITENS PARA COTAÇÃO:*');
    if(isPedido) blocos.push('*ITENS DO PEDIDO:*');

    const itensOrigem = itensSelecionadosRelatorio.size > 0
        ? Array.from(itensSelecionadosRelatorio)
        : Array.from(document.querySelectorAll('.item'))
            .map(el => el.getAttribute('data-id'))
            .filter(id => id && id.includes('_'));
    const itensProcessados = obterItensProcessadosRelatorio(itensOrigem);
    itensProcessados.sort(ordernarPorCategoriaESub);

    const blocosItens = [];
    if(agruparCat) {
        const gruposArr = [];
        itensProcessados.forEach(item => {
            const nomeGrupo = item.p.subcategoria && item.p.subcategoria.trim() !== ''
                ? item.p.subcategoria.trim()
                : (db.categorias.find(c => c.id === item.p.categoria)?.nome || 'Outros');
            let grupo = gruposArr.find(itemGrupo => itemGrupo.nome === nomeGrupo);
            if(!grupo) {
                grupo = { nome: nomeGrupo, itens: [] };
                gruposArr.push(grupo);
            }
            grupo.itens.push(item);
        });
        gruposArr.forEach(grupo => {
            const linhas = grupo.itens.map(item => gerarLinhaRelatorio(item, mostrarQtd));
            blocosItens.push(`> *${grupo.nome}*\n${linhas.join('\n')}`);
        });
    } else {
        const linhas = itensProcessados.map(item => gerarLinhaRelatorio(item, mostrarQtd));
        if(linhas.length > 0) blocosItens.push(linhas.join('\n'));
    }

    if(blocosItens.length > 0) blocos.push(blocosItens.join('\n\n'));
    else blocos.push('_Nenhum item disponível para o relatório._');
    document.getElementById('relatTexto').value = blocos.join('\n\n');
    atualizarEnvioWhatsAppRelatorio(forn);
}

function enviarWhatsAppAPI() {
    const texto = document.getElementById('relatTexto').value;
    const fornId = document.getElementById('relatFornecedor').value;
    const forn = db.fornecedores.find(f => f.id === fornId);
    if(!forn) return;

    const tel = forn.telefone;
    if(tel) {
        let num = tel.replace(/\D/g, '');
        if(num.length === 10 || num.length === 11) num = '55' + num;
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto)}`, '_blank');
        registrarPreferenciasRelatorioEnviadas(forn);
        return;
    }

    const txtArea = document.getElementById('relatTexto');
    txtArea.select();
    document.execCommand('copy');
    alert('Copiado! Selecione o contato no WhatsApp manualmente.');
    window.open('https://wa.me/', '_blank');
    registrarPreferenciasRelatorioEnviadas(forn);
}
