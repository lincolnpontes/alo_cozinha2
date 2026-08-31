function abrirModalRelatorio() {
    const selForn = document.getElementById('relatFornecedor');
    selForn.innerHTML = '<option value="">Selecione um fornecedor</option>';
    [...db.fornecedores]
        .filter(f => f.ativo !== false)
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .forEach(f => {
            const option = document.createElement('option');
            option.value = f.id;
            option.textContent = rotuloFornecedorRelatorio(f);
            selForn.appendChild(option);
        });
    renderizarFornecedoresRelatorio();
    aplicarPreferenciasRelatorio(null);
    document.getElementById('modalRelatorio').style.display = 'flex';
    gerarTextoRelatorio();
}

function rotuloFornecedorRelatorio(fornecedor) {
    const nome = String(fornecedor?.nome || 'Fornecedor').trim();
    const vendedor = String(fornecedor?.vendedor || '').trim();
    return vendedor ? `${nome} (${vendedor})` : nome;
}

function renderizarFornecedoresRelatorio() {
    const selecionado = document.getElementById('relatFornecedor').value;
    const fornecedores = [...db.fornecedores]
        .filter(fornecedor => fornecedor.ativo !== false)
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    const atual = fornecedores.find(fornecedor => String(fornecedor.id) === String(selecionado));
    document.getElementById('relatFornecedorButtonLabel').textContent = atual ? rotuloFornecedorRelatorio(atual) : 'Selecionar fornecedor';
    const target = document.getElementById('relatFornecedorOptions');
    target.innerHTML = fornecedores.length ? fornecedores.map(fornecedor => {
        const label = rotuloFornecedorRelatorio(fornecedor);
        const ativo = String(fornecedor.id) === String(selecionado);
        const inicial = Array.from(String(fornecedor.nome || '?').trim())[0]?.toUpperCase() || '?';
        return `<button type="button" role="option" aria-selected="${ativo}" class="${ativo ? 'selected' : ''}" onclick="escolherFornecedorRelatorio('${escaparHtml(fornecedor.id)}')"><span class="report-supplier-initial" aria-hidden="true">${escaparHtml(inicial)}</span><span>${escaparHtml(label)}</span><b aria-hidden="true">${ativo ? '✓' : ''}</b></button>`;
    }).join('') : '<div class="report-supplier-empty">Nenhum fornecedor cadastrado.</div>';
}

function toggleFornecedoresRelatorio() {
    const list = document.getElementById('relatFornecedorOptions');
    const button = document.getElementById('relatFornecedorButton');
    const open = !list.classList.contains('open');
    list.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
}

function escolherFornecedorRelatorio(fornecedorId) {
    document.getElementById('relatFornecedor').value = fornecedorId;
    document.getElementById('relatFornecedorOptions').classList.remove('open');
    document.getElementById('relatFornecedorButton').setAttribute('aria-expanded', 'false');
    renderizarFornecedoresRelatorio();
    selecionarFornecedorRelatorio();
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

function abrirWhatsAppRelatorio(numero, texto) {
    if(window.AloNative && typeof window.AloNative.openWhatsApp === 'function') {
        try {
            const resposta = JSON.parse(window.AloNative.openWhatsApp(numero || '', texto || ''));
            if(resposta?.ok) return true;
        } catch(error) {}
    }
    const destino = numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`;
    const janela = window.open(destino, '_blank', 'noopener');
    if(!janela) window.top.location.assign(destino);
    return true;
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
        abrirWhatsAppRelatorio(num, texto);
        registrarPreferenciasRelatorioEnviadas(forn);
        return;
    }

    abrirWhatsAppRelatorio('', texto);
    registrarPreferenciasRelatorioEnviadas(forn);
}
