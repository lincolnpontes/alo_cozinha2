function abrirAdmin() { document.getElementById('modalPainelUnificado').style.display = 'flex'; }

function abrirCategoriasDosProdutos() {
    abrirGerenciar('categorias', true);
}

function atualizarRotuloFiltroCategoriasProdutos() {
    const select = document.getElementById('filtroGerenciarCat');
    const rotulo = document.getElementById('rotuloFiltroGerenciarCat');
    const amostra = document.getElementById('corFiltroGerenciarCat');
    if(!select || !rotulo || !amostra) return;
    const categoria = db.categorias.find(item => item.id === select.value);
    rotulo.textContent = categoria ? categoria.nome : 'Todas as categorias';
    amostra.style.background = categoria ? categoria.cor : '#eceff1';
}

function abrirFiltroCategoriasProdutos() {
    const atual = document.getElementById('filtroGerenciarCat').value || 'todos';
    const opcao = (id, nome, cor) => `<button type="button" class="opcao-filtro-categoria ${atual === id ? 'ativa' : ''}" onclick="selecionarFiltroCategoriaProduto('${id}')"><span class="opcao-filtro-categoria-cor" style="background:${cor}"></span><span>${escaparHtml(nome)}</span><span class="opcao-filtro-categoria-check">${atual === id ? '✓' : ''}</span></button>`;
    let html = opcao('todos', 'Todas as categorias', '#eceff1');
    db.categorias.filter(item => item.ativo !== false).forEach(categoria => { html += opcao(categoria.id, categoria.nome, categoria.cor); });
    document.getElementById('opcoesFiltroCategoriasProdutos').innerHTML = html;
    document.getElementById('modalFiltroCategoriasProdutos').style.display = 'flex';
}

function selecionarFiltroCategoriaProduto(id) {
    document.getElementById('filtroGerenciarCat').value = id;
    currentGerenciarFiltro = id;
    fecharModal('modalFiltroCategoriasProdutos');
    renderizarFiltroGerenciar();
}

function voltarDaListagem() {
    if(tipoGerenciarAtual === 'categorias') return abrirGerenciar('produtos', true);
    tipoGerenciarAtual = null;
    fecharModal('modalListagem');
    document.getElementById('modalPainelUnificado').style.display = 'flex';
}

    function abrirGerenciar(tipo, preserveState = false) { tipoGerenciarAtual = tipo; fecharModal('modalPainelUnificado'); const lista = document.getElementById('conteudoListagem'); const btnNovo = document.getElementById('btnNovoListagem'); const titulo = document.getElementById('tituloListagem'); const btnCategorias = document.getElementById('btnCategoriasProdutos'); const boxFiltro = document.getElementById('filtroGerenciarCatBox'); const barAlfabeto = document.getElementById('sidebarAlfabeto'); let htmlLista = ''; btnCategorias.style.display = tipo === 'produtos' ? 'inline-flex' : 'none'; if(!preserveState) { currentGerenciarFiltro = 'todos'; currentGerenciarBusca = ''; } if(tipo === 'restaurante') { fecharModal('modalListagem'); document.getElementById('restNome').value = db.restaurante.nome; document.getElementById('restCNPJ').value = db.restaurante.cnpj; document.getElementById('restRua').value = db.restaurante.rua; document.getElementById('restNum').value = db.restaurante.numero; document.getElementById('restBairro').value = db.restaurante.bairro; document.getElementById('restCidade').value = db.restaurante.cidade; document.getElementById('restUF').value = db.restaurante.uf || 'PB'; document.getElementById('restPonto').value = db.restaurante.ponto; document.getElementById('modalFormRestaurante').style.display = 'flex'; return; } if(tipo === 'produtos') { titulo.innerText = "Produtos"; btnNovo.onclick = () => abrirFormProduto(null); const selFiltro = document.getElementById('filtroGerenciarCat'); selFiltro.innerHTML = '<option value="todos">-- Todas as Categorias --</option>'; db.categorias.filter(c => c.ativo !== false).forEach(c => { const option = document.createElement('option'); option.value = c.id; option.textContent = c.nome; selFiltro.appendChild(option); }); boxFiltro.style.display = 'flex'; document.getElementById('filtroGerenciarCat').value = currentGerenciarFiltro; document.getElementById('inputBuscaProd').value = currentGerenciarBusca; barAlfabeto.style.display = 'flex'; barAlfabeto.innerHTML = ''; "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('').forEach(l => { barAlfabeto.innerHTML += `<div onclick="rolarParaLetra('${l}')">${l}</div>`; }); renderizarFiltroGerenciar(); } else { boxFiltro.style.display = 'none'; barAlfabeto.style.display = 'none'; if (tipo === 'categorias') { titulo.innerText = "Categorias"; btnNovo.onclick = () => abrirFormCategoria(null); db.categorias.forEach((c, index) => { if(c.ativo === false) return; htmlLista += `<div class="gerenciar-item"><div class="gerenciar-info"><span class="color-preview" style="background:${c.cor}; color:${c.corTexto}; padding:4px 8px; border-radius:4px; font-weight:bold;">${escaparHtml(c.nome)}</span></div><div class="gerenciar-actions"><button aria-label="Mover para cima" onclick="moverCategoria(${index}, -1)">↑</button><button aria-label="Mover para baixo" onclick="moverCategoria(${index}, 1)">↓</button><button aria-label="Editar ${escaparHtml(c.nome)}" onclick="abrirFormCategoria('${c.id}')">✏️</button><button aria-label="Excluir ${escaparHtml(c.nome)}" onclick="excluirItem('categorias', '${c.id}')">🗑️</button></div></div>`; }); } else if (tipo === 'colaboradores') { titulo.innerText = "Colaboradores"; btnNovo.onclick = () => abrirFormColaborador(null); db.colaboradores.filter(c => c.ativo !== false).sort((a,b) => a.nome.localeCompare(b.nome)).forEach(c => { htmlLista += `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${escaparHtml(c.nome)}</strong>${c.isAdmin ? '<br><span style="font-size:10px;color:#1565c0;">Administrador</span>' : ''}</div><div class="gerenciar-actions"><button aria-label="Editar ${escaparHtml(c.nome)}" onclick="abrirFormColaborador('${c.id}')">✏️</button><button aria-label="Excluir ${escaparHtml(c.nome)}" onclick="excluirItem('colaboradores', '${c.id}')">🗑️</button></div></div>`; }); } else if (tipo === 'fornecedores') { titulo.innerText = "Fornecedores"; btnNovo.onclick = () => abrirFormFornecedor(null); db.fornecedores.filter(f => f.ativo !== false).sort((a,b) => a.nome.localeCompare(b.nome)).forEach(f => { htmlLista += `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${escaparHtml(f.nome)}</strong><br><span style="color:#666">${escaparHtml(f.telefone || '')}</span></div><div class="gerenciar-actions"><button aria-label="Editar ${escaparHtml(f.nome)}" onclick="abrirFormFornecedor('${f.id}')">✏️</button><button aria-label="Excluir ${escaparHtml(f.nome)}" onclick="excluirItem('fornecedores', '${f.id}')">🗑️</button></div></div>`; }); } lista.innerHTML = htmlLista || '<p style="color:#777; text-align:center;">Nenhum cadastro.</p>'; } document.getElementById('modalListagem').style.display = 'flex'; }
    function renderizarFiltroGerenciar() { const lista = document.getElementById('conteudoListagem'); currentGerenciarFiltro = document.getElementById('filtroGerenciarCat').value; currentGerenciarBusca = document.getElementById('inputBuscaProd').value.toLowerCase().trim(); const filtro = currentGerenciarFiltro; const busca = currentGerenciarBusca; let htmlLista = ''; let prodOrdem = db.produtos.filter(p => p.ativo !== false).sort((a,b) => a.nome.localeCompare(b.nome)); prodOrdem.forEach((p) => { if (p.avulso) return; if (filtro !== 'todos' && p.categoria !== filtro) return; if (busca && !normalizarTextoBusca(p.nome).includes(normalizarTextoBusca(busca))) return; let letraInicial = removerAcentos(p.nome).charAt(0).toUpperCase(); let nSubcat = p.subcategoria ? ` <span style="font-size:10px; color:#888;">(${escaparHtml(p.subcategoria)})</span>` : ''; htmlLista += `<div class="gerenciar-item" data-letra="${letraInicial}"><div class="gerenciar-info"><strong>${escaparHtml(p.nome)}</strong><br><span style="color:#666">${escaparHtml(db.categorias.find(c=>c.id===p.categoria)?.nome || '')}</span>${nSubcat}</div><div class="gerenciar-actions"><button aria-label="Editar ${escaparHtml(p.nome)}" onclick="abrirFormProduto('${p.id}')">✏️</button><button onclick="duplicarProduto('${p.id}')" title="Duplicar" aria-label="Duplicar ${escaparHtml(p.nome)}">📑</button><button aria-label="Excluir ${escaparHtml(p.nome)}" onclick="excluirItem('produtos', '${p.id}')">🗑️</button></div></div>`; }); lista.innerHTML = htmlLista || '<p style="color:#777; text-align:center;">Nenhum produto encontrado.</p>'; }
    function rolarParaLetra(letraClicada) { const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; let indexInicial = alfabeto.indexOf(letraClicada); let containerLista = document.getElementById('conteudoListagem'); let elementoAlvo = null; for (let i = indexInicial; i < alfabeto.length; i++) { elementoAlvo = document.querySelector(`.gerenciar-item[data-letra="${alfabeto[i]}"]`); if (elementoAlvo) break; } if(elementoAlvo) { containerLista.scrollTo({ top: elementoAlvo.offsetTop - containerLista.offsetTop, behavior: 'smooth' }); } }
    function moverCategoria(index, direcao) { if (direcao === -1 && index > 0) { let temp = db.categorias[index]; db.categorias[index] = db.categorias[index - 1]; db.categorias[index - 1] = temp; } else if (direcao === 1 && index < db.categorias.length - 1) { let temp = db.categorias[index]; db.categorias[index] = db.categorias[index + 1]; db.categorias[index + 1] = temp; } const agora = agoraServidor(); db.categorias.forEach((c, ordem) => { c.ordem = ordem; c.atualizadoEm = agora; }); marcarMudancaEstrutural(); abrirGerenciar('categorias', true); sincronizarFundo(false, true); }
    function excluirItem(tipo, id) {
        const item = db[tipo] && db[tipo].find(x => x.id === id);
        if(!item) return;
        if(tipo === 'categorias' && db.produtos.some(p => p.ativo !== false && p.categoria === id)) return alert('Esta categoria ainda possui produtos. Mova ou exclua esses produtos antes.');
        if(tipo === 'colaboradores') {
            if(id === db.configs.colabAtivoId) return alert('Não é possível excluir o perfil que está usando o aplicativo agora.');
            if(item.isAdmin && db.colaboradores.filter(c => c.ativo !== false && c.isAdmin && c.id !== id).length === 0) return alert('O sistema precisa manter pelo menos um administrador.');
        }
        const nome = item.nome || 'este cadastro';
        abrirConfirmacaoApp({ titulo:'Arquivar cadastro?', mensagem:`${nome} sairá das listas, mas continuará preservado no histórico.`, rotulo:'Arquivar', cor:'#c62828', acao:() => { item.ativo = false; marcarMudancaEstrutural(item); abrirGerenciar(tipo, true); renderizarLista(); sincronizarFundo(false, true); } });
    }
    function duplicarProduto(id) { const p = db.produtos.find(x => x.id === id); if(!p) return; abrirConfirmacaoApp({ titulo:'Duplicar produto?', mensagem:`Será criada uma cópia de ${p.nome} com os mesmos dados.`, rotulo:'Duplicar', cor:'#1565C0', acao:() => { let copia = JSON.parse(JSON.stringify(p)); copia.id = 'p_' + Date.now(); copia.atualizadoEm = agoraServidor(); db.produtos.push(copia); marcarMudancaEstrutural(copia); abrirGerenciar('produtos', true); sincronizarFundo(false, true); } }); }
    function salvarRestaurante() { const nome = document.getElementById('restNome').value.trim(); if(!nome) return alert('Informe o nome do restaurante.'); db.restaurante.nome = nome; db.restaurante.cnpj = document.getElementById('restCNPJ').value; db.restaurante.rua = document.getElementById('restRua').value.trim(); db.restaurante.numero = document.getElementById('restNum').value.trim(); db.restaurante.bairro = document.getElementById('restBairro').value.trim(); db.restaurante.cidade = document.getElementById('restCidade').value.trim(); db.restaurante.uf = document.getElementById('restUF').value; db.restaurante.ponto = document.getElementById('restPonto').value.trim(); db.restaurante.atualizadoEm = agoraServidor(); marcarMudancaEstrutural(); fecharModal('modalFormRestaurante'); document.getElementById('modalPainelUnificado').style.display = 'flex'; sincronizarFundo(false, true); }

const renderizarFiltroGerenciarBase = renderizarFiltroGerenciar;
renderizarFiltroGerenciar = function() {
    renderizarFiltroGerenciarBase();
    atualizarRotuloFiltroCategoriasProdutos();
};

const abrirGerenciarBase = abrirGerenciar;
abrirGerenciar = function(tipo, preserveState = false) {
    abrirGerenciarBase(tipo, preserveState);
    if(tipo === 'categorias') {
        document.querySelectorAll('button[aria-label="Mover para cima"]').forEach(botao => { botao.textContent = '🔼'; });
        document.querySelectorAll('button[aria-label="Mover para baixo"]').forEach(botao => { botao.textContent = '🔽'; });
    }
};
