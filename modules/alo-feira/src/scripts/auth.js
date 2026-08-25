let modoSenhaAvancada = 'entrar';

function abrirSelecaoColaboradorInicial(isTroca = false) {
    const ativos = db.colaboradores.filter(c => c.ativo !== false);
    if(ativos.length === 0 && db.configs.exigirColaborador) {
        alert('Nenhum colaborador cadastrado. O acesso às configurações iniciais foi liberado.');
        db.configs.exigirColaborador = false;
        salvarBanco();
        iniciarApp();
        return;
    }
    const sel = document.getElementById('selectColabInicial');
    sel.innerHTML = '<option value="">-- Selecione o Perfil --</option>';
    [...ativos].sort((a,b) => a.nome.localeCompare(b.nome)).forEach(c => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = `${c.emoji || '👤'} ${c.nome}`;
        option.selected = c.id === db.configs.colabAtivoId;
        sel.appendChild(option);
    });
    document.getElementById('inputSenhaColab').value = '';
    document.getElementById('btnCancelColab').style.display = isTroca ? 'block' : 'none';
    document.getElementById('btnSairSistema').style.display = isTroca ? 'block' : 'none';
    document.getElementById('modalColaboradorObrigatorio').style.display = 'flex';
    setTimeout(focarSenhaColab, 250);
}

function focarSenhaColab() {
    const select = document.getElementById('selectColabInicial');
    (select.value ? document.getElementById('inputSenhaColab') : select).focus();
}

async function definirColaboradorAtivo() {
    const id = document.getElementById('selectColabInicial').value;
    if(!id) return alert('Selecione um perfil primeiro.');
    const colab = db.colaboradores.find(c => c.id === id && c.ativo !== false);
    if(!colab) return alert('Este perfil não está mais disponível.');
    const senhaDigitada = document.getElementById('inputSenhaColab').value;
    const senhaArmazenada = colab.senhaHash || colab.senha || '';
    let senhaCorreta = await verificarSenha(senhaDigitada, senhaArmazenada);
    if(!senhaCorreta && senhaDigitada) senhaCorreta = await verificarSenhaAdmin(senhaDigitada);
    if(!senhaCorreta) return alert('Senha incorreta.');

    if(colab.senha && !colab.senhaHash) {
        colab.senhaHash = await gerarHashSenha(senhaDigitada);
        delete colab.senha;
        marcarMudancaEstrutural(colab);
        sincronizarFundo(false, true);
    }
    pilhaDesfazer = [];
    atualizarBotaoDesfazer();
    db.configs.colabAtivoId = id;
    salvarBanco();
    fecharModal('modalColaboradorObrigatorio');
    iniciarApp();
}

function sairDoSistema() {
    db.configs.exigirColaborador = true;
    pilhaDesfazer = [];
    atualizarBotaoDesfazer();
    db.configs.colabAtivoId = null;
    salvarBanco();
    fecharModal('modalColaboradorObrigatorio');
    document.getElementById('splashScreen').style.opacity = '1';
    document.getElementById('splashScreen').style.display = 'flex';
    setTimeout(() => location.reload(), 300);
}

function toggleExigirColab() {
    db.configs.exigirColaborador = document.getElementById('configExigirColab').checked;
    marcarMudancaConfiguracao();
    sincronizarFundo(false, true);
}

function solicitarAcessoAvancado() {
    const colab = db.colaboradores.find(c => c.id === db.configs.colabAtivoId && c.ativo !== false);
    const haAdmin = db.colaboradores.some(c => c.ativo !== false && c.isAdmin);
    if(haAdmin && (!colab || !colab.isAdmin)) return alert('Apenas um administrador pode acessar as configurações avançadas.');
    modoSenhaAvancada = 'entrar';
    fecharModal('modalPainelUnificado');
    const possuiSenha = Boolean(db.configs.senhaAdminHash || db.configs.senhaAdmin);
    document.getElementById('tituloSenhaAvancada').textContent = possuiSenha ? 'Acesso avançado' : 'Criar senha avançada';
    document.getElementById('ajudaSenhaAvancada').textContent = possuiSenha ? 'Digite sua senha para continuar.' : 'Defina uma senha numérica com pelo menos 4 dígitos.';
    document.getElementById('senhaAvancada').value = '';
    document.getElementById('modalSenhaAvancada').style.display = 'flex';
    setTimeout(() => document.getElementById('senhaAvancada').focus(), 100);
}

function abrirTrocaSenhaAvancada() {
    modoSenhaAvancada = 'redefinir';
    document.getElementById('tituloSenhaAvancada').textContent = 'Nova senha avançada';
    document.getElementById('ajudaSenhaAvancada').textContent = 'Defina uma nova senha numérica com pelo menos 4 dígitos.';
    document.getElementById('senhaAvancada').value = '';
    document.getElementById('modalSenhaAvancada').style.display = 'flex';
    setTimeout(() => document.getElementById('senhaAvancada').focus(), 100);
}

async function confirmarSenhaAvancada() {
    const input = document.getElementById('senhaAvancada');
    const pin = input.value.trim();
    if(pin.length < 4) return alert('Use pelo menos 4 dígitos.');
    const possuiSenha = Boolean(db.configs.senhaAdminHash || db.configs.senhaAdmin);
    if(modoSenhaAvancada === 'redefinir' || !possuiSenha) {
        await definirSenhaAdmin(pin);
        sincronizarFundo(false, true);
    } else if(!(await verificarSenhaAdmin(pin))) {
        input.value = '';
        return alert('Senha incorreta.');
    }
    input.value = '';
    fecharModal('modalSenhaAvancada');
    document.getElementById('configUrlApp').value = db.configs.url || '';
    document.getElementById('modalConfigAvancadas').style.display = 'flex';
}
