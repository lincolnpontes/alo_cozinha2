function criarBancoBase() {
        return {
            app_id: "alofeira",
            schemaVersion: 2,
            syncRevision: 0,
            restaurante: { nome: "", cnpj: "", rua: "", numero: "", bairro: "", cidade: "", uf: "PB", ponto: "" },
            categorias: [],
            fornecedores: [],
            colaboradores: [],
            produtos: [],
            pedidosAtivos: [],
            configs: {
                modo: "pedido",
                senhaAdminHash: "",
                exigirColaborador: true,
                agruparComprasPorStatus: false,
                colabAtivoId: null,
                url: "",
                dadosBaixados: false,
                ultimaMudancaLocal: 0,
                historicoApagadoEm: 0,
                ultimoSyncConfirmado: 0,
                relogioServidorOffset: 0,
                relogioServidorSincronizadoEm: 0,
                backendComControleRevisao: false,
                atualizadoEm: 0,
                syncPendente: false
            }
        };
    }

    function normalizarBanco(dados) {
        const base = criarBancoBase();
        const entrada = dados && typeof dados === 'object' ? dados : {};
        const banco = Object.assign({}, base, entrada);
        banco.app_id = "alofeira";
        delete banco.serverNow;
        banco.schemaVersion = 2;
        banco.syncRevision = AloFeiraDomain.numeroSeguro(entrada.syncRevision);
        banco.restaurante = Object.assign({}, base.restaurante, entrada.restaurante || {});
        banco.configs = Object.assign({}, base.configs, entrada.configs || {});
        banco.categorias = Array.isArray(entrada.categorias) ? entrada.categorias : [];
        banco.fornecedores = Array.isArray(entrada.fornecedores) ? entrada.fornecedores : [];
        banco.colaboradores = Array.isArray(entrada.colaboradores) ? entrada.colaboradores : [];
        banco.produtos = Array.isArray(entrada.produtos) ? entrada.produtos : [];
        banco.pedidosAtivos = Array.isArray(entrada.pedidosAtivos) ? entrada.pedidosAtivos : [];
        banco.pedidosAtivos.forEach(pa => {
            if(!pa.dataEnvio && pa.status !== 'rascunho') pa.dataEnvio = pa.dataStatus || parseInt((pa.idUnico || '').split('_')[1]);
            if(!pa.dataStatus) pa.dataStatus = pa.dataEnvio || parseInt((pa.idUnico || '').split('_')[1]) || 0;
        });
        banco.categorias.forEach((c, index) => { if(!c.subcategorias) c.subcategorias = []; if(c.ativo === undefined) c.ativo = true; if(c.ordem === undefined) c.ordem = index; });
        banco.categorias.sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));
        banco.produtos.forEach(p => { if(!p.unidades) p.unidades = ['']; if(!p.fornecedores) p.fornecedores = []; p.historicoPrecos = AloFeiraDomain.normalizarHistoricoPrecos(p.historicoPrecos, p.atualizadoEm); if(!p.precosExcluidos || typeof p.precosExcluidos !== 'object') p.precosExcluidos = {}; if(p.ativo === undefined) p.ativo = true; });
        banco.fornecedores.forEach(f => { if(f.ativo === undefined) f.ativo = true; });
        banco.colaboradores.forEach(c => { if(c.ativo === undefined) c.ativo = true; if(!c.emoji) c.emoji = '👤'; });
        banco.configs.agruparComprasPorStatus = banco.configs.agruparComprasPorStatus === true;
        if(banco.configs.ultimaMudancaLocal === undefined) banco.configs.ultimaMudancaLocal = 0;
        if(banco.configs.historicoApagadoEm === undefined) banco.configs.historicoApagadoEm = 0;
        if(banco.configs.relogioServidorOffset === undefined) banco.configs.relogioServidorOffset = 0;
        if(banco.configs.relogioServidorSincronizadoEm === undefined) banco.configs.relogioServidorSincronizadoEm = 0;
        if(banco.configs.backendComControleRevisao === undefined) banco.configs.backendComControleRevisao = false;
        if(banco.configs.atualizadoEm === undefined) banco.configs.atualizadoEm = 0;
        if(banco.configs.syncPendente === undefined) banco.configs.syncPendente = false;
        return banco;
    }

    function carregarBanco() {
        let salvo = localStorage.getItem('alofeira_v1');
        if(salvo) {
            try { return normalizarBanco(JSON.parse(salvo)); }
            catch(e) { console.error("Erro ao carregar banco local", e); }
        }
        return criarBancoBase();
    }

    function salvarBanco() { localStorage.setItem('alofeira_v1', JSON.stringify(db)); }
    function getHojeSTR() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    function agoraServidor() { return Math.round(Date.now() + Number(db.configs.relogioServidorOffset || 0)); }
    function registrarRelogioServidor(serverNow, inicioRequisicao = Date.now(), fimRequisicao = Date.now()) { const servidor = Number(serverNow); if(!Number.isFinite(servidor) || servidor <= 0) return; const meioRequisicao = Number(inicioRequisicao) + Math.max(0, Number(fimRequisicao) - Number(inicioRequisicao)) / 2; db.configs.relogioServidorOffset = Math.round(servidor - meioRequisicao); db.configs.relogioServidorSincronizadoEm = Date.now(); }
    function marcarMudancaEstrutural(registro = null) { const agora = agoraServidor(); db.configs.ultimaMudancaLocal = agora; db.configs.syncPendente = true; if(registro) { registro.atualizadoEm = agora; if(Array.isArray(registro.historicoPrecos)) registro.historicoPrecos = AloFeiraDomain.normalizarHistoricoPrecos(registro.historicoPrecos, agora); } salvarBanco(); }
    function marcarMudancaConfiguracao() { const agora = agoraServidor(); db.configs.atualizadoEm = agora; db.configs.ultimaMudancaLocal = agora; db.configs.syncPendente = true; salvarBanco(); }
    function marcarMudancaPedido(pedido) { if(!pedido) return; pedido.dataStatus = agoraServidor(); db.configs.syncPendente = true; salvarBanco(); }
    function getCatsPermitidas(colabLogado) { if(!colabLogado) return null; if(colabLogado.isAdmin) return null; let cats = db.configs.modo === 'pedido' ? colabLogado.catsPermitidasPedido : colabLogado.catsPermitidasCompras; return cats !== undefined ? cats : colabLogado.catsPermitidas; }
    function temAcessoAdmin() { const ativos = db.colaboradores.filter(c => c.ativo !== false); if(ativos.length === 0) return true; const atual = ativos.find(c => c.id === db.configs.colabAtivoId); return Boolean(atual && atual.isAdmin); }
    function formatarDataHora(ts) { if(!ts) return ""; let d = new Date(ts); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} às ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
    function formatarDataBr(dataStr) { if(!dataStr) return ""; if(dataStr.includes('-')) { const partes = dataStr.split('-'); if(partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`; } return dataStr; }
    function getNomeFornHTML(id) { if(!id) return ""; let f = db.fornecedores.find(x => x.id === id); return f ? ` - ${AloFeiraDomain.escaparHtml(f.nome)}` : ""; }
    function tempoRelativo(ts) { if(!ts) return ""; let hoje = new Date(); hoje.setHours(0,0,0,0); let d = new Date(ts); d.setHours(0,0,0,0); let diff = Math.floor((hoje - d) / (1000 * 60 * 60 * 24)); if(diff === 0) return "hoje"; if(diff === 1) return "ontem"; if(diff < 0) return "hoje"; return `há ${diff} dias`; }
    function toggleDiv(id) { let el = document.getElementById(id); el.style.display = (el.style.display === 'none') ? 'block' : 'none'; }
    function fecharModal(id) { document.getElementById(id).style.display = 'none'; isModalFechando = true; setTimeout(() => { isModalFechando = false; }, 400); }
    function maskCNPJ(el) { let v = el.value.replace(/\D/g,""); v = v.replace(/^(\d{2})(\d)/,"$1.$2"); v = v.replace(/^(\d{2})\.(\d{3})(\d)/,"$1.$2.$3"); v = v.replace(/\.(\d{3})(\d)/,".$1/$2"); v = v.replace(/(\d{4})(\d)/,"$1-$2"); el.value = v; }
    function maskTelefone(el) { let v = el.value.replace(/\D/g,""); v = v.replace(/^(\d{2})(\d)/g,"($1) $2"); v = v.replace(/(\d)(\d{4})$/,"$1-$2"); el.value = v; }
    function maskMoeda(el) { let v = el.value.replace(/\D/g, ""); if(!v) { el.value = ""; return; } v = (parseFloat(v) / 100).toLocaleString('pt-BR', {minimumFractionDigits: 2}); el.value = v; }
    function parseMoeda(str) { if(!str) return 0; return parseFloat(str.replace(/\./g, "").replace(",", ".")); }
    function criarRegistroPreco(preco, unidade = '', fornecedorId = '', data = '') { const agora = agoraServidor(); const d = new Date(agora); const dataServidor = data || `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; return { id:`preco_${agora}_${Math.random().toString(36).slice(2,7)}`, data:dataServidor, preco, unidade, fornecedorId, registradoEm:agora, atualizadoEm:agora }; }
    function parseFloatBr(str) { if(str === '' || str === null || str === undefined) return ''; const valor = Number(String(str).replace(',','.')); return Number.isFinite(valor) ? valor : ''; }
    function removerAcentos(str) { return str.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
    function atualizarVisibilidadeAdmin() { const btnAdmin = document.getElementById('btnAdmin'); if(!btnAdmin) return; let colab = db.colaboradores.find(c => c.id === db.configs.colabAtivoId && c.ativo !== false); let ativos = db.colaboradores.filter(c => c.ativo !== false); btnAdmin.style.display = (ativos.length === 0 || (colab && colab.isAdmin)) ? 'inline-flex' : 'none'; }
    function atualizarBotaoPerfil() { const btn = document.getElementById('btnTrocarPerfil'); if(!btn) return; const colab = db.colaboradores.find(c => c.id === db.configs.colabAtivoId && c.ativo !== false); const nome = colab ? colab.nome : 'Perfil'; const emoji = colab && colab.emoji ? colab.emoji : '👤'; btn.innerHTML = `<span class="perfil-emoji" aria-hidden="true">${escaparHtml(emoji)}</span><span class="perfil-nome">${escaparHtml(nome)}</span>`; btn.title = `Perfil: ${nome}`; btn.setAttribute('aria-label', `Trocar perfil. Atual: ${nome}`); }
    function iconePedidoFornecedorSvg(classe = 'icone-send') { return `<svg class="${classe}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7Z"></path><path d="M22 2 11 13"></path></svg>`; }

    function abrirConfirmacaoApp({ titulo = 'Confirmar ação', mensagem = '', rotulo = 'Confirmar', cor = '#1565C0', acao }) {
        const modal = document.getElementById('modalConfirmacaoApp');
        const caixa = modal.querySelector('.modal-confirmacao-app');
        const tituloEl = document.getElementById('tituloConfirmacaoApp');
        const botao = document.getElementById('btnConfirmacaoApp');
        tituloEl.textContent = titulo;
        tituloEl.style.borderColor = cor;
        document.getElementById('mensagemConfirmacaoApp').textContent = mensagem;
        botao.textContent = rotulo;
        botao.style.backgroundColor = cor;
        caixa.style.borderColor = cor;
        acaoConfirmacaoApp = typeof acao === 'function' ? acao : null;
        modal.style.display = 'flex';
        setTimeout(() => botao.focus(), 40);
    }
    function cancelarConfirmacaoApp() { acaoConfirmacaoApp = null; fecharModal('modalConfirmacaoApp'); }
    function executarConfirmacaoApp() { const acao = acaoConfirmacaoApp; acaoConfirmacaoApp = null; fecharModal('modalConfirmacaoApp'); if(acao) acao(); }

    function escaparHtml(valor) { return AloFeiraDomain.escaparHtml(valor); }
    function idDomSeguro(valor) { return AloFeiraDomain.idDomSeguro(valor); }

    function mostrarToast(mensagem, tipo = 'info', duracao = 3200) {
        const toast = document.getElementById('appToast');
        if(!toast) return;
        toast.textContent = mensagem;
        toast.className = `app-toast ${tipo} visivel`;
        clearTimeout(mostrarToast.timer);
        mostrarToast.timer = setTimeout(() => toast.classList.remove('visivel'), duracao);
    }

let db = carregarBanco(); let categoriaAtual = null; let modoSelecaoAtivo = false; let itensSelecionadosRelatorio = new Set(); let agrupamentoCompradoAtivo = false; let timerReagruparCompras = null; let pilhaDesfazer = []; let tempPrecosProduto = []; let tempFornecedoresProduto = []; let tempSubcats = []; let tempRenames = []; let isSyncingFundo = false; let syncRepetir = false; let syncRepetirApenasEmpurrar = false; let isModalFechando = false; let filtroFornecedorComprasId = null; let buscaPedidoTexto = ""; let envioPedidoEmAndamento = false; let currentGerenciarFiltro = 'todos'; let currentGerenciarBusca = ''; let tipoGerenciarAtual = null; let origemFormProduto = null; let modalAcaoCompraId = null; let acaoConfirmacaoApp = null;
