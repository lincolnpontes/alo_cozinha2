function bytesParaBase64(bytes) {
    let binario = '';
    bytes.forEach(byte => { binario += String.fromCharCode(byte); });
    return btoa(binario);
}

function base64ParaBytes(valor) {
    const binario = atob(valor);
    return Uint8Array.from(binario, caractere => caractere.charCodeAt(0));
}

async function derivarSenha(pin, salt, iteracoes) {
    if(!window.crypto || !window.crypto.subtle) throw new Error('Criptografia segura indisponível neste navegador.');
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(String(pin)),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iteracoes },
        material,
        256
    );
    return new Uint8Array(bits);
}

async function gerarHashSenha(pin) {
    const valor = String(pin || '').trim();
    if(!valor) return '';
    const iteracoes = 150000;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivarSenha(valor, salt, iteracoes);
    return `pbkdf2$${iteracoes}$${bytesParaBase64(salt)}$${bytesParaBase64(hash)}`;
}

async function verificarSenha(pin, armazenada) {
    if(!armazenada) return String(pin || '') === '';
    if(!String(armazenada).startsWith('pbkdf2$')) return String(pin || '') === String(armazenada);
    const partes = String(armazenada).split('$');
    if(partes.length !== 4) return false;
    const iteracoes = Number(partes[1]);
    const esperado = base64ParaBytes(partes[3]);
    const calculado = await derivarSenha(pin, base64ParaBytes(partes[2]), iteracoes);
    if(calculado.length !== esperado.length) return false;
    let diferenca = 0;
    for(let i = 0; i < calculado.length; i++) diferenca |= calculado[i] ^ esperado[i];
    return diferenca === 0;
}

async function verificarSenhaAdmin(pin) {
    const hash = db.configs.senhaAdminHash || '';
    if(hash) return verificarSenha(pin, hash);
    const legado = db.configs.senhaAdmin || '';
    if(!legado) return false;
    const valido = await verificarSenha(pin, legado);
    if(valido) {
        db.configs.senhaAdminHash = await gerarHashSenha(pin);
        delete db.configs.senhaAdmin;
        marcarMudancaConfiguracao();
    }
    return valido;
}

async function definirSenhaAdmin(pin) {
    db.configs.senhaAdminHash = await gerarHashSenha(pin);
    delete db.configs.senhaAdmin;
    marcarMudancaConfiguracao();
}
