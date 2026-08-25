function abrirFormColaborador(id) {
        fecharModal('modalListagem');
        const box = document.getElementById('colabCategoriasBox');
        box.innerHTML = '';
        const c = id ? db.colaboradores.find(x => x.id === id) : null;
        const primeiroPerfil = db.colaboradores.filter(x => x.ativo !== false).length === 0;
        document.getElementById('colabIsAdmin').checked = c ? Boolean(c.isAdmin) : primeiroPerfil;
        document.getElementById('colabIsAdmin').disabled = primeiroPerfil;
        document.getElementById('colabApenasReceber').checked = c ? Boolean(c.apenasReceber) : false;
        db.categorias.filter(cat => cat.ativo !== false).forEach(cat => {
            const checkPed = (!c || (c.catsPermitidasPedido !== undefined ? c.catsPermitidasPedido.includes(cat.id) : (c.catsPermitidas ? c.catsPermitidas.includes(cat.id) : true))) ? 'checked' : '';
            const checkComp = (!c || (c.catsPermitidasCompras !== undefined ? c.catsPermitidasCompras.includes(cat.id) : (c.catsPermitidas ? c.catsPermitidas.includes(cat.id) : true))) ? 'checked' : '';
            box.innerHTML += `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid #ddd; padding-bottom:6px;"><span style="font-weight:bold; font-size:12px; flex:1; color:#333;">${escaparHtml(cat.nome)}</span><div style="display:flex; gap:15px;"><label style="display:flex; flex-direction:column; align-items:center; font-size:9px; color:#555; gap:2px;"><div class="switch" style="margin:0;"><input type="checkbox" value="${cat.id}" class="chk-cat-pedido" ${checkPed}><span class="slider"></span></div>Pedidos</label><label style="display:flex; flex-direction:column; align-items:center; font-size:9px; color:#555; gap:2px;"><div class="switch" style="margin:0;"><input type="checkbox" value="${cat.id}" class="chk-cat-compras" ${checkComp}><span class="slider"></span></div>Compras</label></div></div>`;
        });
        document.getElementById('colabId').value = id || '';
        document.getElementById('colabNome').value = c ? c.nome : '';
        document.getElementById('colabEmoji').value = c && c.emoji ? c.emoji : '👤';
        document.getElementById('colabSenha').value = '';
        document.getElementById('colabSenha').placeholder = c ? 'Em branco mantem o PIN atual' : 'Opcional';
        document.getElementById('modalFormColaborador').style.display = 'flex';
    }
    async function salvarColaborador() {
        const id = document.getElementById('colabId').value || 'col_' + Date.now();
        const nome = document.getElementById('colabNome').value.trim();
        const emoji = document.getElementById('colabEmoji').value || '👤';
        const pin = document.getElementById('colabSenha').value.trim();
        const ativos = db.colaboradores.filter(c => c.ativo !== false);
        const primeiroPerfil = ativos.length === 0;
        const isAdmin = primeiroPerfil || document.getElementById('colabIsAdmin').checked;
        if(!nome) return alert('Informe o nome do colaborador.');
        if(pin && pin.length < 4) return alert('Use pelo menos 4 digitos no PIN.');
        if(!isAdmin && ativos.filter(c => c.isAdmin && c.id !== id).length === 0) return alert('O sistema precisa manter pelo menos um administrador.');

        const catsPed = Array.from(document.querySelectorAll('.chk-cat-pedido:checked')).map(el => el.value);
        const catsComp = Array.from(document.querySelectorAll('.chk-cat-compras:checked')).map(el => el.value);
        const apenasReceber = document.getElementById('colabApenasReceber').checked;
        const idx = db.colaboradores.findIndex(x => x.id === id);
        const anterior = idx >= 0 ? db.colaboradores[idx] : {};
        const novo = Object.assign({}, anterior, {
            id,
            nome,
            emoji,
            telefone: anterior.telefone || '',
            isAdmin,
            apenasReceber,
            catsPermitidasPedido: catsPed,
            catsPermitidasCompras: catsComp,
            catsPermitidas: [],
            ativo: true,
            atualizadoEm: agoraServidor()
        });
        if(pin) novo.senhaHash = await gerarHashSenha(pin);
        else if(anterior.senha && !anterior.senhaHash) novo.senhaHash = await gerarHashSenha(anterior.senha);
        delete novo.senha;
        if(idx >= 0) db.colaboradores[idx] = novo; else db.colaboradores.push(novo);
        marcarMudancaEstrutural(novo);
        atualizarBotaoPerfil();
        fecharModal('modalFormColaborador');
        abrirGerenciar('colaboradores', true);
        sincronizarFundo(false, true);
    }

    function abrirFormFornecedor(id) { fecharModal('modalListagem'); if(id) { const f = db.fornecedores.find(x => x.id === id); document.getElementById('fornId').value = id; document.getElementById('fornNome').value = f.nome; document.getElementById('fornVendedor').value = f.vendedor || ''; document.getElementById('fornTel').value = f.telefone || ''; document.getElementById('fornNomeGerente').value = f.nomeGerente || ''; document.getElementById('fornTelGerente').value = f.telGerente || ''; document.getElementById('fornTelEmpresa').value = f.telEmpresa || ''; } else { document.getElementById('fornId').value = ''; document.getElementById('fornNome').value = ''; document.getElementById('fornVendedor').value = ''; document.getElementById('fornTel').value = ''; document.getElementById('fornNomeGerente').value = ''; document.getElementById('fornTelGerente').value = ''; document.getElementById('fornTelEmpresa').value = ''; } document.getElementById('modalFormFornecedor').style.display = 'flex'; }
    function salvarFornecedor() {
        const nome = document.getElementById('fornNome').value.trim();
        if(!nome) return alert('Informe o nome do fornecedor.');
        const id = document.getElementById('fornId').value || 'f_' + Date.now();
        const idx = db.fornecedores.findIndex(x => x.id === id);
        const anterior = idx >= 0 ? db.fornecedores[idx] : {};
        const novo = Object.assign({}, anterior, {
            id,
            nome,
            vendedor: document.getElementById('fornVendedor').value.trim(),
            telefone: document.getElementById('fornTel').value.trim(),
            nomeGerente: document.getElementById('fornNomeGerente').value.trim(),
            telGerente: document.getElementById('fornTelGerente').value.trim(),
            telEmpresa: document.getElementById('fornTelEmpresa').value.trim(),
            ativo: true,
            atualizadoEm: agoraServidor()
        });
        if(idx >= 0) db.fornecedores[idx] = novo; else db.fornecedores.push(novo);
        marcarMudancaEstrutural(novo);
        fecharModal('modalFormFornecedor');
        abrirGerenciar('fornecedores', true);
        sincronizarFundo(false, true);
    }
