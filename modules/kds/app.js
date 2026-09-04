const STORAGE_KDS_SELECTED_AREA = 'alo_kds_selected_area_v1';
    let db = carregarBanco();
    db.configs.url = window.AloCloud?.getEndpoint?.() || '';
    let categoriaAtual = null;
    const KDS_ORDER_KEY = 'alo_kds_product_order_v1';
    const KDS_VIEW_KEY = 'alo_kds_product_view_v1';
    const KDS_RECEIVING_VIEW_KEY = 'alo_kds_receiving_view_v1';
    let ordemProdutos = ['cadastro', 'categoria', 'mais_pedidos'].includes(localStorage.getItem(KDS_ORDER_KEY))
        ? localStorage.getItem(KDS_ORDER_KEY)
        : 'cadastro';
    let visualizacaoProdutos = ['lista', 'quadro'].includes(localStorage.getItem(KDS_VIEW_KEY))
        ? localStorage.getItem(KDS_VIEW_KEY)
        : 'lista';
    let visualizacaoPedidos = ['lista', 'quadro'].includes(localStorage.getItem(KDS_RECEIVING_VIEW_KEY))
        ? localStorage.getItem(KDS_RECEIVING_VIEW_KEY)
        : 'lista';
    let menuOrdemAberto = false;
    let menuVisualizacaoPedidosAberto = false;
    let popularidadeCache = { assinatura: '', valores: {} };
    let popularidadeRemota = (() => { try { return JSON.parse(localStorage.getItem('alo_kds_popularity_v1') || '{}'); } catch (error) { return {}; } })();
    let pedidosServidor = [];
    let pedidosBloqueados = new Set();
    let pedidosCientes = new Set();
    let pedidosPendentesLocais = [];
    let loopSync = null;
    let wakeLock = null;
    let acaoPendente = null;
    let parametroAcao = null;
    let tituloAcaoPendente = 'Confirmação';
    let descricaoAcaoPendente = '';

    let filaRetentativaStatus = JSON.parse(localStorage.getItem('kds_fila_status') || '[]');
    let processandoFilaStatus = false;
    let bancoPublicacaoTimer = null;
    let estadoSyncPedidosAtual = { pendingCount: 0, online: navigator.onLine };

    // CARREGAR HISTÓRICO SALVO LOCALMENTE (Evita perda de dados em reloads)
    let savedPedidos = localStorage.getItem('kds_pedidos_local');
    if (savedPedidos) { pedidosServidor = JSON.parse(savedPedidos); }
    let savedCientes = localStorage.getItem('kds_cientes_local');
    if (savedCientes) { pedidosCientes = new Set(JSON.parse(savedCientes)); }

    const hierarquiaStatus = { 'pendente': 1, 'fazendo': 2, 'enviado': 3, 'buscar': 3, 'cancelado': 4, 'concluido': 5 };
    const AREAS_PADRAO = [
        { id: 'panelas', nome: 'Panelas', tipo: 'envio', emoji: '🥘' },
        { id: 'cozinha', nome: 'Cozinha', tipo: 'recebimento', emoji: '🧑‍🍳' }
    ];
    const IMAGENS_AREA_LEGADAS = {
        'assets/areas/kitchen.svg':'🧑‍🍳',
        'assets/areas/production.svg':'🔪',
        'assets/areas/pans.svg':'🥣',
        'assets/areas/grill.svg':'🍖',
        'assets/areas/pastry.svg':'🥐',
        'assets/areas/bar.svg':'🍹',
        'assets/areas/dining.svg':'🍽️',
        'assets/areas/cleaning.svg':'🧹',
        'assets/areas/restroom.svg':'🚻',
        'assets/areas/stock.svg':'🧺',
        'assets/areas/cold-room.svg':'❄️',
        'assets/areas/delivery.svg':'🛵',
        'assets/areas/cashier.svg':'🧾'
    };

    function normalizarAreasERotas() {
        const recebidas = Array.isArray(db.areas) ? db.areas : [];
        const porId = new Map();
        [...AREAS_PADRAO, ...recebidas].forEach(area => {
            if (!area || !area.id) return;
            const id = String(area.id);
            const tipo = id === 'panelas' ? 'envio' : (id === 'cozinha' ? 'recebimento' : (area.tipo === 'recebimento' ? 'recebimento' : 'envio'));
            porId.set(String(area.id), {
                id,
                nome: String(area.nome || area.id),
                tipo,
                emoji: IMAGENS_AREA_LEGADAS[area.emoji]
                    || (area.emoji === '🏺' ? '🥣' : (area.emoji || (tipo === 'recebimento' ? '🧑‍🍳' : '🥘')))
            });
        });
        db.areas = Array.from(porId.values());
        db.produtos = Array.isArray(db.produtos) ? db.produtos : [];
        db.produtos.forEach(produto => {
            const origensRecebidas = Array.isArray(produto.areasOrigem) && produto.areasOrigem.length
                ? produto.areasOrigem
                : [produto.areaOrigem || 'panelas'];
            produto.areasOrigem = [...new Set(origensRecebidas.map(String))]
                .filter(id => db.areas.some(area => area.id === id && area.tipo === 'envio'));
            if (!produto.areasOrigem.length) produto.areasOrigem = ['panelas'];
            produto.areaOrigem = produto.areasOrigem[0];
            if (!db.areas.some(area => area.id === produto.areaDestino && area.tipo === 'recebimento')) produto.areaDestino = 'cozinha';
        });
        const areaLocal = db.areas.find(area => area.id === localStorage.getItem(STORAGE_KDS_SELECTED_AREA));
        const areaSalva = db.areas.find(area => area.id === db.configs.areaAtual);
        const areaLegada = db.areas.find(area => area.id === db.configs.modo);
        db.configs.areaAtual = (areaLocal || areaSalva || areaLegada || db.areas[0]).id;
        localStorage.setItem(STORAGE_KDS_SELECTED_AREA, db.configs.areaAtual);
        const atual = db.areas.find(area => area.id === db.configs.areaAtual);
        db.configs.modo = atual && atual.tipo === 'recebimento' ? 'cozinha' : 'panelas';
    }

    function getAreaAtual() {
        return db.areas.find(area => area.id === db.configs.areaAtual) || db.areas[0];
    }

    function getAreaNome(id) {
        const area = db.areas.find(item => item.id === id);
        return area ? area.nome : id;
    }

    function isAreaImage(emoji) {
        return /^assets\/areas\/[a-z0-9-]+\.(?:svg|png)$/.test(String(emoji || ''));
    }

    function getAreaEmojiText(emoji) {
        return isAreaImage(emoji) ? '' : String(emoji || '');
    }

    function getEmojiAreaHtml(emoji) {
        if (isAreaImage(emoji)) return `<img class="area-visual-image" src="${emoji}" alt="">`;
        return emoji === '🥣' || emoji === '🏺'
            ? '<span class="emoji-panela-barro" role="img" aria-label="Panela de barro">🥣</span>'
            : emoji;
    }

    function ajustarNomeAreaCabecalho(element, nome) {
        if (!element) return;
        const length = Array.from(String(nome || '')).length;
        const desktop = length > 30 ? 10 : (length > 24 ? 12 : (length > 17 ? 15 : (length > 11 ? 17 : 19)));
        const mobile = length > 24 ? 10 : (length > 17 ? 12 : (length > 11 ? 13 : 15));
        element.style.setProperty('--area-name-size', `${desktop}px`);
        element.style.setProperty('--area-name-size-mobile', `${mobile}px`);
    }

    function getAreasOrigemProduto(produto) {
        if (Array.isArray(produto.areasOrigem) && produto.areasOrigem.length) return produto.areasOrigem;
        return [produto.areaOrigem || 'panelas'];
    }

    function pedidoPertenceArea(pedido, area = getAreaAtual()) {
        if (!area) return true;
        return area.tipo === 'recebimento'
            ? (pedido.areaDestino || 'cozinha') === area.id
            : (pedido.areaOrigem || 'panelas') === area.id;
    }

    function pedidosDaAreaAtual() {
        const area = getAreaAtual();
        return pedidosServidor.filter(pedido => pedidoPertenceArea(pedido, area));
    }

    function renderizarSeletorAreas() {
        const seletor = document.getElementById('seletorModo');
        if (!seletor) return;
        seletor.innerHTML = db.areas.map(area =>
            `<option value="${area.id}">${getAreaEmojiText(area.emoji)} ${area.nome}</option>`
        ).join('');
        seletor.value = db.configs.areaAtual;
        const areaAtual = getAreaAtual();
        const emojiAtual = document.getElementById('emojiAreaAtual');
        if (emojiAtual) emojiAtual.innerHTML = getEmojiAreaHtml(areaAtual.emoji);
        const nomeAtual = document.getElementById('nomeAreaAtual');
        if (nomeAtual) {
            nomeAtual.innerText = areaAtual.nome;
            ajustarNomeAreaCabecalho(nomeAtual, areaAtual.nome);
        }
        const options = document.getElementById('areaPickerOptions');
        if (options) {
            const title = document.createElement('div');
            title.className = 'header-area-options-title';
            title.textContent = 'Trocar área';
            options.replaceChildren(title, ...db.areas.map(area => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `header-area-option${area.id === areaAtual.id ? ' selected' : ''}`;
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', String(area.id === areaAtual.id));
                const emoji = document.createElement('span');
                emoji.className = 'header-area-option-emoji';
                emoji.innerHTML = getEmojiAreaHtml(area.emoji);
                const copy = document.createElement('span');
                copy.className = 'header-area-option-copy';
                const name = document.createElement('strong');
                name.textContent = area.nome;
                const role = document.createElement('small');
                role.textContent = area.tipo === 'recebimento' ? 'Recebe pedidos' : 'Envia pedidos';
                copy.append(name, role);
                const check = document.createElement('b');
                check.setAttribute('aria-hidden', 'true');
                check.textContent = area.id === areaAtual.id ? '✓' : '';
                button.append(emoji, copy, check);
                button.addEventListener('click', () => selecionarAreaCabecalho(area.id));
                return button;
            }));
        }
    }

    function fecharSeletorAreas() {
        const options = document.getElementById('areaPickerOptions');
        const button = document.getElementById('areaPickerButton');
        if (options) options.classList.remove('open');
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    function toggleSeletorAreas() {
        const options = document.getElementById('areaPickerOptions');
        const button = document.getElementById('areaPickerButton');
        if (!options || !button) return;
        const opening = !options.classList.contains('open');
        options.classList.toggle('open', opening);
        button.setAttribute('aria-expanded', String(opening));
    }

    function selecionarAreaCabecalho(areaId) {
        fecharSeletorAreas();
        iniciarTrocaModo(areaId);
    }

    normalizarAreasERotas();
    salvarBancoLocal();

    const sonsDisponiveis = {
        "sem_som": { tipo: "silencio" },
        "alarme": { tipo: "audio", url: "./assets/sounds/alarme-curto.ogg" },
        "beep": { tipo: "audio", url: "./assets/sounds/beep-classico.ogg" },
        "sino_forte": { tipo: "audio", url: "./assets/sounds/sino-forte.ogg" },
        "sirene_cozinha": { tipo: "sintetico", intervalo: 950 },
        "alerta_triplo": { tipo: "sintetico", intervalo: 850 },
        "campainha_forte": { tipo: "sintetico", intervalo: 1000 },
        "toque_urgente": { tipo: "sintetico", intervalo: 750 }
    };

    let playerAlarme = new Audio(); playerAlarme.loop = true; let alarmeTocando = false; let previewAudio = null; let previewTimeout = null;
    let audioCtx = null; let somAtualTocando = "sem_som"; let alarmeSinteticoTimer = null; let envioPedidoEmAndamento = false;
    let filaStatusTimer = null;

    let timerInatividade = null;
    function resetInatividade() {
        document.getElementById('overlayInatividade').style.opacity = '0';
        setTimeout(() => document.getElementById('overlayInatividade').style.display = 'none', 300);
        clearTimeout(timerInatividade);
        let tempoMinutos = parseFloat(db.configs.inatividade || 0);
        if(tempoMinutos > 0) {
            timerInatividade = setTimeout(() => {
                document.getElementById('overlayInatividade').style.display = 'block';
                setTimeout(() => document.getElementById('overlayInatividade').style.opacity = '1', 50);
            }, tempoMinutos * 60000);
        }
    }
    document.addEventListener('touchstart', resetInatividade); document.addEventListener('mousemove', resetInatividade); document.addEventListener('click', resetInatividade);
    document.addEventListener('pointerdown', event => {
        const picker = document.querySelector('.header-area-picker');
        if (picker && !picker.contains(event.target)) fecharSeletorAreas();
        const orderPicker = document.querySelector('.kds-order-picker');
        if (menuOrdemAberto && orderPicker && !orderPicker.contains(event.target)) {
            menuOrdemAberto = false;
            renderizarFiltros();
        }
        const receivingPicker = document.querySelector('.kds-receiving-view-picker');
        if (menuVisualizacaoPedidosAberto && receivingPicker && !receivingPicker.contains(event.target)) {
            menuVisualizacaoPedidosAberto = false;
            renderizarFiltrosCozinha();
        }
    });

    function prepararAudioNoPrimeiroToque() {
        const ctx = getAudioCtx();
        if(!ctx) return;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        const osc = ctx.createOscillator();
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.03);
    }
    document.addEventListener('touchstart', prepararAudioNoPrimeiroToque, { once: true });
    document.addEventListener('click', prepararAudioNoPrimeiroToque, { once: true });

    async function solicitarWakeLock() {
        if(db.configs.telaAtiva === "nao") {
            if(wakeLock !== null) { wakeLock.release(); wakeLock = null; } return;
        }
        try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (err) {}
    }
    document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') solicitarWakeLock(); });

    function getVolumePorSelect(selectId) {
        const idVolume = selectId === 'configSomPanelas' ? 'configVolumePanelas' : 'configVolumeCozinha';
        const input = document.getElementById(idVolume);
        const valor = input ? parseInt(input.value || '100', 10) : 100;
        return Math.max(0, Math.min(100, valor)) / 100;
    }

    function atualizarLabelsVolume() {
        const volumeCozinha = document.getElementById('configVolumeCozinha');
        const volumePanelas = document.getElementById('configVolumePanelas');
        const labelCozinha = document.getElementById('labelVolumeCozinha');
        const labelPanelas = document.getElementById('labelVolumePanelas');
        if(labelCozinha && volumeCozinha) labelCozinha.innerText = `${volumeCozinha.value}%`;
        if(labelPanelas && volumePanelas) labelPanelas.innerText = `${volumePanelas.value}%`;
    }

    function normalizarSom(valor, fallback) {
        if(valor === "sem_som") return "sem_som";
        return sonsDisponiveis[valor] ? valor : fallback;
    }

    function normalizarSonsConfigurados() {
        db.configs.somCozinha = normalizarSom(db.configs.somCozinha || "sem_som", "sirene_cozinha");
        db.configs.somPanelas = normalizarSom(db.configs.somPanelas || "sem_som", "beep");
    }

    function getAudioCtx() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if(!AudioContextClass) return null;
        if(!audioCtx) audioCtx = new AudioContextClass();
        if(audioCtx.state === "suspended") audioCtx.resume().catch(()=>{});
        return audioCtx;
    }

    function tocarPulso(freqInicio, freqFim, atraso, duracao, volume, tipoOnda = "square", camadas = 1) {
        const ctx = getAudioCtx();
        if(!ctx || volume <= 0) return;
        const inicio = ctx.currentTime + atraso;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-24, inicio);
        compressor.knee.setValueAtTime(8, inicio);
        compressor.ratio.setValueAtTime(12, inicio);
        compressor.attack.setValueAtTime(0.003, inicio);
        compressor.release.setValueAtTime(0.12, inicio);
        compressor.connect(ctx.destination);
        setTimeout(() => { try { compressor.disconnect(); } catch(e) {} }, (atraso + duracao + 0.3) * 1000);

        for(let i = 0; i < camadas; i++) {
            const deslocamento = (i - ((camadas - 1) / 2)) * 18;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = tipoOnda;
            osc.frequency.setValueAtTime(freqInicio + deslocamento, inicio);
            osc.frequency.linearRampToValueAtTime(freqFim + deslocamento, inicio + duracao);
            gain.gain.setValueAtTime(0.0001, inicio);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.75), inicio + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
            osc.connect(gain).connect(compressor);
            osc.start(inicio);
            osc.stop(inicio + duracao + 0.05);
        }
    }

    function tocarRuido(atraso, duracao, volume) {
        const ctx = getAudioCtx();
        if(!ctx || volume <= 0) return;
        const inicio = ctx.currentTime + atraso;
        const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duracao), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for(let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.55;
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(1600, inicio);
        filter.Q.setValueAtTime(1.6, inicio);
        gain.gain.setValueAtTime(0.0001, inicio);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.55), inicio + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
        source.buffer = buffer;
        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(inicio);
        source.stop(inicio + duracao + 0.05);
        setTimeout(() => {
            try { source.disconnect(); filter.disconnect(); gain.disconnect(); } catch(e) {}
        }, (atraso + duracao + 0.3) * 1000);
    }

    function executarSomSintetico(tipo, volume) {
        const vol = Math.max(0, Math.min(1, volume));
        if(navigator.vibrate) navigator.vibrate(tipo === "toque_urgente" ? [120, 60, 120, 60, 220] : [180, 70, 180]);
        if(tipo === "sirene_cozinha") {
            tocarPulso(560, 1420, 0, 0.34, vol, "square", 3);
            tocarRuido(0.02, 0.18, vol);
            tocarPulso(1420, 560, 0.38, 0.34, vol, "square", 3);
            tocarRuido(0.40, 0.16, vol);
        } else if(tipo === "alerta_triplo") {
            tocarPulso(1180, 1180, 0, 0.16, vol, "square", 3);
            tocarPulso(1480, 1480, 0.22, 0.16, vol, "square", 3);
            tocarPulso(1180, 1180, 0.44, 0.22, vol, "square", 3);
            tocarRuido(0, 0.12, vol);
            tocarRuido(0.22, 0.12, vol);
            tocarRuido(0.44, 0.14, vol);
        } else if(tipo === "campainha_forte") {
            tocarPulso(920, 1620, 0, 0.18, vol, "sine", 4);
            tocarPulso(1620, 920, 0.2, 0.18, vol, "sine", 4);
            tocarPulso(1180, 1180, 0.48, 0.25, vol, "triangle", 4);
        } else if(tipo === "toque_urgente") {
            tocarPulso(780, 780, 0, 0.12, vol, "sawtooth", 3);
            tocarPulso(980, 980, 0.14, 0.12, vol, "sawtooth", 3);
            tocarPulso(1280, 1280, 0.28, 0.18, vol, "sawtooth", 3);
            tocarPulso(1620, 1620, 0.5, 0.22, vol, "square", 3);
            tocarRuido(0.5, 0.16, vol);
        }
    }

    function pararSomSintetico() {
        if(alarmeSinteticoTimer) {
            clearInterval(alarmeSinteticoTimer);
            alarmeSinteticoTimer = null;
        }
    }

    function tocarPreview(selectId) {
        if(previewAudio) { previewAudio.pause(); previewAudio.currentTime = 0; }
        if(previewTimeout) { clearTimeout(previewTimeout); }

        let val = normalizarSom(document.getElementById(selectId).value, selectId === 'configSomPanelas' ? 'beep' : 'alarme');
        if(val === "sem_som") return;

        const som = sonsDisponiveis[val];
        const volume = getVolumePorSelect(selectId);
        if(som.tipo === "audio") {
            previewAudio = new Audio(som.url);
            previewAudio.volume = volume;
            previewAudio.play().catch(()=>{});
            previewTimeout = setTimeout(() => { if(previewAudio) previewAudio.pause(); }, 3000);
        } else if(som.tipo === "sintetico") {
            executarSomSintetico(val, volume);
        }
    }

    function migrarSenhaSeguranca(configs) {
        if (!configs || typeof configs !== 'object') return false;
        let alterado = false;
        if (!Object.prototype.hasOwnProperty.call(configs, 'senhaSeguranca')
            && Object.prototype.hasOwnProperty.call(configs, 'senhaMestra')) {
            configs.senhaSeguranca = configs.senhaMestra || '';
            alterado = true;
        }
        if (Object.prototype.hasOwnProperty.call(configs, 'senhaMestra')) {
            delete configs.senhaMestra;
            alterado = true;
        }
        return alterado;
    }

    function carregarBanco() {
        let defaultDB = {
            produtos: [], categorias: [], obsPedidos: ["Sem sal", "Pouco óleo"],
            obsCancelamentos: ["Falta de insumo", "Queimou"],
            setoresTarefas: [{ id: 'setor_cozinha', nome: 'Cozinha', emoji: '🧑‍🍳', ativo: true }],
            funcionarios: [], tarefas: [], coreCompartilhado: null,
            configsTarefas: { som: 'beep', volume: '80', repeticaoMinutos: '5' },
            configs: { modo: "panelas", url: "", senhaModo: "", somCozinha: "sem_som", somPanelas: "sem_som", volumeCozinha: "100", volumePanelas: "70", dadosBaixados: false, bancoPendente: false, revisaoBanco: 0, suporteDadosCompartilhados: false, telaAtiva: "sim", inatividade: "0", reenvio: "permitido", virBuscarAtivo: true, loginObrigatorioModulos: { kds:false, checklist:false, compras:true, l42:true }, loginObrigatorioChecklistVisoes: { documentos:false, geral:false }, modulosVisiveis: { kds:true, checklist:true, compras:true, l42:true } }
        };
        let local = JSON.parse(localStorage.getItem('kds_v1_db'));
        if(local) {
            if(!local.configs) local.configs = defaultDB.configs;
            if(typeof local.configs.dadosBaixados === 'undefined') local.configs.dadosBaixados = false;
            if(typeof local.configs.bancoPendente === 'undefined') local.configs.bancoPendente = false;
            if(typeof local.configs.revisaoBanco === 'undefined') local.configs.revisaoBanco = 0;
            if(typeof local.configs.suporteDadosCompartilhados === 'undefined') local.configs.suporteDadosCompartilhados = false;
            if (migrarSenhaSeguranca(local.configs)) local.configs.bancoPendente = true;
            if(!local.configs.telaAtiva) local.configs.telaAtiva = "sim";
            if(!local.configs.inatividade) local.configs.inatividade = "0";
            if(!local.configs.reenvio) local.configs.reenvio = "permitido";
            if(typeof local.configs.virBuscarAtivo !== 'boolean') local.configs.virBuscarAtivo = true;
            local.configs.loginObrigatorioModulos = { kds:false, checklist:false, compras:true, l42:true, ...(local.configs.loginObrigatorioModulos || {}) };
            local.configs.loginObrigatorioChecklistVisoes = { documentos:false, geral:false, ...(local.configs.loginObrigatorioChecklistVisoes || {}) };
            local.configs.modulosVisiveis = { kds:true, checklist:true, compras:true, l42:true, ...(local.configs.modulosVisiveis || {}) };
            if(!local.configs.volumeCozinha) local.configs.volumeCozinha = "100";
            if(!local.configs.volumePanelas) local.configs.volumePanelas = "70";
            if(!Array.isArray(local.setoresTarefas) || !local.setoresTarefas.length) local.setoresTarefas = defaultDB.setoresTarefas;
            if(!Array.isArray(local.funcionarios)) local.funcionarios = [];
            if(!Array.isArray(local.tarefas)) local.tarefas = [];
            if(!local.coreCompartilhado || typeof local.coreCompartilhado !== 'object') local.coreCompartilhado = null;
            local.configsTarefas = { ...defaultDB.configsTarefas, ...(local.configsTarefas || {}) };
            return local;
        }
        return defaultDB;
    }
    function salvarBancoLocal() { localStorage.setItem('kds_v1_db', JSON.stringify(db)); }
    function marcarBancoAlterado() {
        db.configs.bancoPendente = true;
        salvarBancoLocal();
        atualizarIndicadorSincronizacao(estadoSyncPedidosAtual);
        agendarSincronizacaoBanco(450);
    }
    function salvarFilaStatus() { localStorage.setItem('kds_fila_status', JSON.stringify(filaRetentativaStatus)); }

    function pedidosParaCacheLocal() {
        const agora = Date.now();
        const hoje = new Date().toDateString();
        const operacionais = pedidosServidor.filter(order => {
            if (order.status === 'pendente' || order.status === 'fazendo') return true;
            const finalizadoEm = new Date(order.finalizadoEm || 0).getTime();
            return new Date(order.timestamp).toDateString() === hoje
                || (Number.isFinite(finalizadoEm) && agora - finalizadoEm < 10 * 60 * 1000);
        });
        return operacionais.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    function salvarHistoricoLocal() {
        const cache = pedidosParaCacheLocal();
        try {
            localStorage.setItem('kds_pedidos_local', JSON.stringify(cache));
        } catch(error) {
            try {
                localStorage.removeItem('kds_pedidos_local');
                localStorage.setItem('kds_pedidos_local', JSON.stringify(cache.slice(-80)));
            } catch(fallbackError) {}
        }
        try {
            localStorage.setItem('kds_cientes_local', JSON.stringify(Array.from(pedidosCientes).slice(-250)));
        } catch(error) {}
    }
    setInterval(salvarHistoricoLocal, 60000);

    function getTempoRelativo(timestamp) {
        const diffEmMs = Date.now() - new Date(timestamp).getTime();
        const minutos = Math.floor(diffEmMs / 60000);
        if (minutos < 1) return "&lt; 1 min";
        if (minutos === 1) return `há 1 min`;
        return `há ${minutos} min`;
    }

    let modoPendente = null; let seletorGlobal = null;
    function iniciarTrocaModo(selectElement) {
        const novoModo = typeof selectElement === 'string' ? selectElement : selectElement.value;
        if (db.configs.senhaModo && db.configs.senhaModo.trim() !== "") {
            modoPendente = novoModo; seletorGlobal = typeof selectElement === 'string' ? null : selectElement; document.getElementById('inputSenhaModo').value = ''; limparErroSenha('erroSenhaModo'); document.getElementById('modalSenhaModo').style.display = 'flex'; setTimeout(() => document.getElementById('inputSenhaModo').focus(), 100); if (seletorGlobal) seletorGlobal.value = db.configs.areaAtual;
        } else { efetivarTrocaModo(novoModo); }
    }

    function limparErroSenha(id) {
        const feedback = document.getElementById(id);
        if (feedback) feedback.innerText = '';
    }

    function senhaIncorreta(inputId, feedbackId) {
        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        if (feedback) feedback.innerText = 'Senha incorreta. Tente novamente.';
        if (input) {
            input.focus();
            input.select();
        }
    }

    function confirmarSenhaModo() {
        const input = document.getElementById('inputSenhaModo');
        const valor = input.value;
        const senhaValida = db.configs.senhaModo && valor === db.configs.senhaModo;
        if (!senhaValida) return senhaIncorreta('inputSenhaModo', 'erroSenhaModo');
        input.blur();
        document.getElementById('modalSenhaModo').style.display = 'none';
        if (seletorGlobal) seletorGlobal.value = modoPendente;
        efetivarTrocaModo(modoPendente);
        input.value = '';
        limparErroSenha('erroSenhaModo');
    }

    function cancelarTrocaModo() { document.getElementById('modalSenhaModo').style.display = 'none'; if (seletorGlobal) seletorGlobal.value = db.configs.areaAtual; modoPendente = null; document.getElementById('inputSenhaModo').value = ''; limparErroSenha('erroSenhaModo'); }
    function efetivarTrocaModo(areaId) {
        const area = db.areas.find(item => item.id === areaId) || getAreaAtual();
        db.configs.areaAtual = area.id;
        db.configs.modo = area.tipo === 'recebimento' ? 'cozinha' : 'panelas';
        localStorage.setItem(STORAGE_KDS_SELECTED_AREA, area.id);
        salvarBancoLocal();
        aplicarModoVisual(area.id);
    }

    function iniciar() {
        normalizarAreasERotas();
        normalizarSonsConfigurados();
        renderizarSeletorAreas();
        document.getElementById('configSomCozinha').value = db.configs.somCozinha || 'sem_som';
        document.getElementById('configSomPanelas').value = db.configs.somPanelas || 'sem_som';
        document.getElementById('configTelaAtiva').value = db.configs.telaAtiva || "sim";
        document.getElementById('configInatividade').value = db.configs.inatividade || "0";
        document.getElementById('configVolumeCozinha').value = db.configs.volumeCozinha || "100";
        document.getElementById('configVolumePanelas').value = db.configs.volumePanelas || "70";
        atualizarLabelsVolume();
        sincronizarSwitchesLogin();
        aplicarVisibilidadeModulos();
        atualizarEngrenagensDaSessao();
        aplicarModoVisual(db.configs.areaAtual);
        solicitarWakeLock(); resetInatividade();
        const splash = document.getElementById('splashScreen');
        if (!sessionStorage.getItem('splash_v1_shown')) {
            setTimeout(() => { splash.style.opacity = '0'; setTimeout(() => { splash.style.display = 'none'; sessionStorage.setItem('splash_v1_shown', 'true'); }, 500); }, 2000);
        } else { splash.style.display = 'none'; }
    }

    function aplicarModoVisual(areaId) {
        const area = db.areas.find(item => item.id === areaId) || getAreaAtual();
        const modo = area.tipo === 'recebimento' ? 'cozinha' : 'panelas';
        db.configs.areaAtual = area.id;
        db.configs.modo = modo;
        const emojiAtual = document.getElementById('emojiAreaAtual');
        if (emojiAtual) emojiAtual.innerHTML = getEmojiAreaHtml(area.emoji);
        const nomeAtual = document.getElementById('nomeAreaAtual');
        if (nomeAtual) {
            nomeAtual.innerText = area.nome;
            ajustarNomeAreaCabecalho(nomeAtual, area.nome);
        }
        renderizarSeletorAreas();
        const themeColor = document.getElementById('metaThemeColor'); document.body.className = modo === 'panelas' ? 'theme-panelas' : 'theme-cozinha';
        if(loopSync) clearInterval(loopSync);
        loopSync = null;
        if(modo === 'panelas') { if(themeColor) themeColor.content = '#1565C0'; document.getElementById('area-panelas').style.display = 'flex'; document.getElementById('area-cozinha').style.display = 'none'; pararAlarme(); renderizarFiltros(); renderizarListaPanelas(); syncGeral(true); } else { if(themeColor) themeColor.content = '#2e7d32'; document.getElementById('area-panelas').style.display = 'none'; document.getElementById('area-cozinha').style.display = 'flex'; pararAlarme(); renderizarFiltrosCozinha(); renderizarListaCozinha(); syncGeral(true); }
    }

    function renderizarFiltros() {
        const rotulos = { cadastro: 'Ordem de cadastro', categoria: 'Ordem por categoria', mais_pedidos: 'Mais pedidos' };
        const visualizacoes = { lista: 'Lista', quadro: 'Quadro' };
        const opcoesVisualizacao = Object.entries(visualizacoes).map(([id, label]) => `<button type="button" role="menuitemradio" aria-checked="${visualizacaoProdutos === id}" class="${visualizacaoProdutos === id ? 'selected' : ''}" onclick="selecionarVisualizacaoProdutos('${id}', event)"><span>${label}</span><b>${visualizacaoProdutos === id ? '✓' : ''}</b></button>`).join('');
        const opcoesOrdem = Object.entries(rotulos).map(([id, label]) => `<button type="button" role="menuitemradio" aria-checked="${ordemProdutos === id}" class="${ordemProdutos === id ? 'selected' : ''}" onclick="selecionarOrdemProdutos('${id}', event)"><span>${label}</span><b>${ordemProdutos === id ? '✓' : ''}</b></button>`).join('');
        let html = `<div class="kds-order-picker"><button type="button" class="chip kds-all-chip ${categoriaAtual === null ? 'active' : ''}" style="${categoriaAtual === null ? 'background:#ccc; color:#000;' : ''}" onclick="toggleMenuOrdemProdutos(event)" aria-haspopup="menu" aria-expanded="${menuOrdemAberto}">TODOS <span class="filter-menu-chevron" aria-hidden="true">⌄</span></button><div class="kds-order-menu" style="display:${menuOrdemAberto ? 'grid' : 'none'}" role="menu" aria-label="Visualizar e ordenar produtos"><div class="kds-order-menu-title">Visualização</div>${opcoesVisualizacao}<div class="kds-order-menu-title">Ordenação</div>${opcoesOrdem}</div></div>`;
        db.categorias.forEach(cat => { const isActive = categoriaAtual === cat.nome; html += `<div class="chip ${isActive ? 'active' : ''}" style="background-color: ${cat.cor}; color: ${cat.corTexto};" onclick="filtrarCategoria('${cat.nome}')">${cat.nome}</div>`; });
        document.getElementById('containerFiltros').innerHTML = html;
    }

    function filtrarCategoria(cat) {
        categoriaAtual = cat;
        menuOrdemAberto = false;
        renderizarFiltros();
        renderizarListaPanelas();
    }

    function toggleMenuOrdemProdutos(event) {
        event?.stopPropagation?.();
        if (categoriaAtual !== null) {
            categoriaAtual = null;
            menuOrdemAberto = false;
            renderizarFiltros();
            renderizarListaPanelas();
            return;
        }
        menuOrdemAberto = !menuOrdemAberto;
        renderizarFiltros();
        renderizarListaPanelas();
    }

    function selecionarOrdemProdutos(ordem, event) {
        event?.stopPropagation?.();
        if (!['cadastro', 'categoria', 'mais_pedidos'].includes(ordem)) return;
        ordemProdutos = ordem;
        categoriaAtual = null;
        menuOrdemAberto = false;
        localStorage.setItem(KDS_ORDER_KEY, ordem);
        renderizarFiltros();
        renderizarListaPanelas();
        if (ordem === 'mais_pedidos') atualizarPopularidadeRemota();
    }

    function selecionarVisualizacaoProdutos(visualizacao, event) {
        event?.stopPropagation?.();
        if (!['lista', 'quadro'].includes(visualizacao)) return;
        visualizacaoProdutos = visualizacao;
        categoriaAtual = null;
        menuOrdemAberto = false;
        localStorage.setItem(KDS_VIEW_KEY, visualizacao);
        renderizarFiltros();
        renderizarListaPanelas();
    }

    function renderizarFiltrosCozinha() {
        const container = document.getElementById('containerFiltrosCozinha');
        if (!container) return;
        const labels = { lista: 'Lista', quadro: 'Quadro' };
        const options = Object.entries(labels).map(([id, label]) => `<button type="button" role="menuitemradio" aria-checked="${visualizacaoPedidos === id}" class="${visualizacaoPedidos === id ? 'selected' : ''}" onclick="selecionarVisualizacaoPedidos('${id}', event)"><span>${label}</span><b>${visualizacaoPedidos === id ? '✓' : ''}</b></button>`).join('');
        container.innerHTML = `<div class="kds-order-picker kds-receiving-view-picker"><button type="button" class="chip kds-all-chip active" style="background:#ccc;color:#000" onclick="toggleMenuVisualizacaoPedidos(event)" aria-haspopup="menu" aria-expanded="${menuVisualizacaoPedidosAberto}">TODOS <span class="filter-menu-chevron" aria-hidden="true">⌄</span></button><div class="kds-order-menu" style="display:${menuVisualizacaoPedidosAberto ? 'grid' : 'none'}" role="menu" aria-label="Visualização dos pedidos recebidos"><div class="kds-order-menu-title">Visualização</div>${options}</div></div>`;
    }

    function toggleMenuVisualizacaoPedidos(event) {
        event?.stopPropagation?.();
        menuVisualizacaoPedidosAberto = !menuVisualizacaoPedidosAberto;
        renderizarFiltrosCozinha();
    }

    function selecionarVisualizacaoPedidos(visualizacao, event) {
        event?.stopPropagation?.();
        if (!['lista', 'quadro'].includes(visualizacao)) return;
        visualizacaoPedidos = visualizacao;
        menuVisualizacaoPedidosAberto = false;
        localStorage.setItem(KDS_RECEIVING_VIEW_KEY, visualizacao);
        renderizarFiltrosCozinha();
        renderizarListaCozinha();
    }

    async function atualizarPopularidadeRemota() {
        if (!db.configs.url || !navigator.onLine) return;
        try {
            const url = new URL(db.configs.url);
            url.searchParams.set('action', 'estatisticas_produtos');
            url.searchParams.set('cb', String(Date.now()));
            const response = await fetch(url.toString(), { cache:'no-store' });
            const result = await response.json();
            if (result.status !== 'ok' || !result.porArea) return;
            popularidadeRemota = result;
            localStorage.setItem('alo_kds_popularity_v1', JSON.stringify(result));
            if (ordemProdutos === 'mais_pedidos') renderizarListaPanelas();
        } catch (error) {}
    }

    function getPopularidade30d() {
        const remoto = popularidadeRemota?.porArea?.[getAreaAtual().id];
        if (remoto && typeof remoto === 'object') return remoto;
        const ultimoPedido = pedidosServidor[pedidosServidor.length - 1];
        const assinatura = `${pedidosServidor.length}:${ultimoPedido?.id || ''}:${getAreaAtual().id}`;
        if (popularidadeCache.assinatura === assinatura) return popularidadeCache.valores;
        let pop = {};
        const hoje = new Date();
        hoje.setHours(0,0,0,0);
        const timeHoje = hoje.getTime();
        const time30d = timeHoje - (30 * 86400000);

        pedidosDaAreaAtual().forEach(p => {
            let t = new Date(p.timestamp).getTime();
            if (t >= time30d && t < timeHoje) {
                let nomeBase = p.produto.split(" (Obs:")[0];
                pop[nomeBase] = (pop[nomeBase] || 0) + 1;
            }
        });
        popularidadeCache = { assinatura, valores: pop };
        return pop;
    }

    function renderizarListaPanelas() {
        const lista = document.getElementById('listaProdutosPanelas'); lista.innerHTML = '';
        lista.classList.toggle('kds-grid-view', visualizacaoProdutos === 'quadro');
        const areaAtual = getAreaAtual();
        const produtosDaArea = db.produtos.filter(p => getAreasOrigemProduto(p).includes(areaAtual.id));
        let filtrados = categoriaAtual === null ? [...produtosDaArea] : produtosDaArea.filter(p => p.categoria === categoriaAtual);

        if (categoriaAtual === null && ordemProdutos === 'categoria') {
            const categorias = new Map(db.categorias.map((categoria, index) => [categoria.nome, index]));
            const cadastro = new Map(db.produtos.map((produto, index) => [produto, index]));
            filtrados.sort((a, b) => (categorias.get(a.categoria) ?? Number.MAX_SAFE_INTEGER) - (categorias.get(b.categoria) ?? Number.MAX_SAFE_INTEGER)
                || (cadastro.get(a) ?? 0) - (cadastro.get(b) ?? 0));
        } else if (categoriaAtual === null && ordemProdutos === 'mais_pedidos') {
            let pop = getPopularidade30d();
            const cadastro = new Map(db.produtos.map((produto, index) => [produto, index]));
            filtrados.sort((a, b) => {
                let countA = pop[a.nome] || 0;
                let countB = pop[b.nome] || 0;
                return countB - countA || (cadastro.get(a) ?? 0) - (cadastro.get(b) ?? 0);
            });
        }

        if(filtrados.length === 0) { lista.innerHTML = '<li style="padding: 20px; text-align: center; color: #666;">Nenhum produto cadastrado.</li>'; return; }
        filtrados.forEach(p => {
            const catObj = db.categorias.find(c => c.nome === p.categoria) || {cor:'#eee', corTexto:'#000'};
            const primeiraLetra = p.nome.charAt(0).toUpperCase();
            lista.innerHTML += `<li class="item" onclick="abrirModalPedido('${p.nome}')"><div class="item-avatar" style="background-color: ${catObj.cor}; color: ${catObj.corTexto};">${primeiraLetra}</div><div class="item-info"><div class="item-title">${p.nome}</div><div class="item-subtitle">${p.categoria}</div></div><div class="swipe-hint">➕</div></li>`;
        });
    }

    function getNomeBasePedido(produto) {
        return (produto || '').split(" (Obs:")[0];
    }

    function isPedidoAtivoHoje(pedido) {
        if(!pedido || (pedido.status !== 'pendente' && pedido.status !== 'fazendo')) return false;
        const dataPedido = new Date(pedido.timestamp);
        if(isNaN(dataPedido.getTime())) return false;
        return dataPedido.toDateString() === new Date().toDateString();
    }

    function existeItemEmProducao(nome) {
        const areaAtual = getAreaAtual();
        return pedidosServidor.some(p => getNomeBasePedido(p.produto) === nome &&
            (p.areaOrigem || 'panelas') === areaAtual.id && isPedidoAtivoHoje(p));
    }

    function abrirModalPedido(nomeProduto) {
        if(!db.configs.url && !window.AloDemo?.isActive?.()) return alert("A nuvem ainda não está conectada.");
        document.getElementById('tituloModalPedido').innerText = `Pedir: ${nomeProduto}`; document.getElementById('pedidoItemNome').value = nomeProduto; document.getElementById('pedidoObsText').value = '';
        const btnConfirmar = document.getElementById('btnConfirmarPedido');
        if(btnConfirmar) btnConfirmar.disabled = false;
        const container = document.getElementById('obsChipsContainer'); container.innerHTML = '';

        let pObj = db.produtos.find(p => p.nome === nomeProduto);
        let listaObs = [...db.obsPedidos];
        if(pObj && pObj.obsEspec) listaObs = [...listaObs, ...pObj.obsEspec];

        listaObs.forEach(obs => { container.innerHTML += `<div class="chip" style="font-weight: normal; background-color:#E3F2FD; color:#1565C0; border-color:#1565C0;" onclick="addObsToText('pedidoObsText', '${obs}')">${obs}</div>`; });
        document.getElementById('modalFazerPedido').style.display = 'flex';
        syncGeral();
    }

    function abrirModalCancelamento(id, nomeProduto) {
        document.getElementById('tituloModalCancelar').innerText = `Cancelar: ${nomeProduto}`; document.getElementById('cancelarItemId').value = id; document.getElementById('cancelarObsText').value = '';
        const container = document.getElementById('obsCancelChipsContainer'); container.innerHTML = '';
        db.obsCancelamentos.forEach(obs => { container.innerHTML += `<div class="chip" style="font-weight: normal; background-color:#ffebee; color:#d32f2f; border-color:#d32f2f;" onclick="addObsToText('cancelarObsText', '${obs}')">${obs}</div>`; });
        document.getElementById('modalCancelarPedido').style.display = 'flex';
    }

    function addObsToText(inputID, obsStr) {
        const input = document.getElementById(inputID);
        let parts = input.value.split(',').map(s => s.trim()).filter(s => s !== '');

        let index = parts.indexOf(obsStr);
        if (index > -1) {
            parts.splice(index, 1);
        } else {
            parts.push(obsStr);
        }

        input.value = parts.join(', ');
    }

    function confirmarCancelamento() {
        const id = document.getElementById('cancelarItemId').value;
        const motivo = document.getElementById('cancelarObsText').value.trim();
        if(!id) return;
        document.getElementById('modalCancelarPedido').style.display = 'none';
        alterarStatusPedido(id, 'cancelado', motivo);
    }

    function focarUltimosPedidosPanelas() {
        requestAnimationFrame(() => {
            const lista = document.getElementById('listaUltimosPedidosPanelas');
            const areaScroll = lista ? lista.closest('.scroll-area') : null;
            if(areaScroll) areaScroll.scrollTop = 0;
        });
    }

    async function enviarPedidoConfirmado() {
        if(envioPedidoEmAndamento) return;
        envioPedidoEmAndamento = true;
        const btnConfirmar = document.getElementById('btnConfirmarPedido');
        if(btnConfirmar) btnConfirmar.disabled = true;

        const nome = document.getElementById('pedidoItemNome').value;
        const obsText = document.getElementById('pedidoObsText').value.trim();

        let itemEmProducao = existeItemEmProducao(nome);
        let configReenvio = db.configs.reenvio || 'permitido';

        if (itemEmProducao && configReenvio !== 'permitido') {
            if (configReenvio === 'bloqueado') {
                alert("Esse item está em produção");
                document.getElementById('modalFazerPedido').style.display = 'none';
                envioPedidoEmAndamento = false;
                if(btnConfirmar) btnConfirmar.disabled = false;
                return;
            } else if (configReenvio === 'confirmacao') {
                const confirmed = await AloUiDialog.confirm('Esse item já está em produção. Deseja enviar outro pedido mesmo assim?', {
                    title: 'Pedido repetido', icon: '↻', confirmText: 'Enviar novamente'
                });
                if(!confirmed) {
                    document.getElementById('modalFazerPedido').style.display = 'none';
                    envioPedidoEmAndamento = false;
                    if(btnConfirmar) btnConfirmar.disabled = false;
                    return;
                }
            }
        }

        let nomeParaEnviar = obsText ? `${nome} (Obs: ${obsText})` : nome;
        document.getElementById('modalFazerPedido').style.display = 'none';

        const tempId = Date.now().toString();
        const pedidoTemporario = { id: tempId, produto: nomeParaEnviar, status: 'pendente', timestamp: new Date().toISOString(), finalizadoEm: '', motivo: '', isTemp: true, localTime: Date.now() };

        pedidosPendentesLocais.push(pedidoTemporario);
        pedidosServidor.push(pedidoTemporario);
        renderizarUltimosPedidos();
        focarUltimosPedidosPanelas();
        salvarHistoricoLocal();
        envioPedidoEmAndamento = false;
        if(btnConfirmar) btnConfirmar.disabled = false;

        try {
            await enviarPayloadServidor({ action: 'novo_pedido', produto: nomeParaEnviar });
            setTimeout(syncGeral, 500);
            setTimeout(syncGeral, 1800);
        } catch(e) {
            pedidosPendentesLocais = pedidosPendentesLocais.filter(p => p.id !== tempId);
            pedidosServidor = pedidosServidor.filter(p => p.id !== tempId);
            renderizarUltimosPedidos();
            alert("⚠️ Falha na conexão: Seu pedido não foi enviado.");
        }
    }

    function montarUrlPedidos() {
        let fetchUrl = db.configs.url;
        fetchUrl += fetchUrl.includes('?') ? '&' : '?';
        fetchUrl += "cb=" + Date.now();
        return fetchUrl;
    }

    async function carregarPedidosServidor() {
        const resp = await fetch(montarUrlPedidos());
        const dados = await resp.json();
        return Array.isArray(dados) ? dados : [];
    }

    async function enviarPayloadServidor(payload) {
        await fetch(db.configs.url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
    }

    function montarPayloadLoteStatus(itens) {
        return {
            action: 'atualizar_status_lote',
            updates: itens.map(item => ({
                id: item.payload.id,
                novoStatus: item.payload.action === 'cancelar_pedido' ? 'cancelado' : item.payload.novoStatus,
                motivo: item.payload.motivo || ''
            }))
        };
    }

    function payloadConfirmadoNoServidor(payload, dadosServidor) {
        if(payload.action === 'excluir_pedido') {
            return !dadosServidor.some(p => p.id.toString() === payload.id.toString());
        }

        if(payload.action === 'atualizar_status_lote') {
            return payload.updates.every(update => payloadConfirmadoNoServidor({
                action: update.novoStatus === 'cancelado' ? 'cancelar_pedido' : 'atualizar_status',
                id: update.id,
                novoStatus: update.novoStatus,
                motivo: update.motivo || ''
            }, dadosServidor));
        }

        const pedido = dadosServidor.find(p => p.id.toString() === payload.id.toString());
        if(!pedido) return false;

        if(payload.action === 'cancelar_pedido') {
            return pedido.status === 'cancelado';
        }

        if(payload.action === 'atualizar_status') {
            const pesoEsperado = hierarquiaStatus[payload.novoStatus] || 0;
            const pesoServidor = hierarquiaStatus[pedido.status] || 0;
            return pedido.status === payload.novoStatus || pesoServidor >= pesoEsperado;
        }

        return true;
    }

    function enfileirarPayloadStatus(payload) {
        filaRetentativaStatus = filaRetentativaStatus.filter(item => item.payload.id != payload.id);
        filaRetentativaStatus.push({ payload: payload, time: Date.now() });
        salvarFilaStatus();
    }

    function agendarProcessamentoFila(delay = 120) {
        if(filaStatusTimer) clearTimeout(filaStatusTimer);
        filaStatusTimer = setTimeout(() => {
            filaStatusTimer = null;
            processarFilaRetentativas();
        }, delay);
    }

    async function processarFilaRetentativas() {
        if(processandoFilaStatus || filaRetentativaStatus.length === 0 || !db.configs.url) return;
        processandoFilaStatus = true;
        try {
            while(filaRetentativaStatus.length > 0) {
                const agora = Date.now();
                const itensParaEnviar = filaRetentativaStatus.filter(item => !item.lastTry || (agora - item.lastTry) >= 700);

                if(itensParaEnviar.length === 0) break;

                itensParaEnviar.forEach(item => item.lastTry = agora);
                salvarFilaStatus();
                const payloadEnvio = itensParaEnviar.length > 1 ? montarPayloadLoteStatus(itensParaEnviar) : itensParaEnviar[0].payload;
                await enviarPayloadServidor(payloadEnvio);
                await new Promise(resolve => setTimeout(resolve, 500));

                const dadosServidor = await carregarPedidosServidor();
                const tamanhoAntes = filaRetentativaStatus.length;
                filaRetentativaStatus = filaRetentativaStatus.filter(item => !payloadConfirmadoNoServidor(item.payload, dadosServidor));
                salvarFilaStatus();

                if(filaRetentativaStatus.length === tamanhoAntes && itensParaEnviar.length > 1) {
                    await Promise.allSettled(itensParaEnviar.map(item => enviarPayloadServidor(item.payload)));
                    await new Promise(resolve => setTimeout(resolve, 700));
                    const dadosAposFallback = await carregarPedidosServidor();
                    filaRetentativaStatus = filaRetentativaStatus.filter(item => !payloadConfirmadoNoServidor(item.payload, dadosAposFallback));
                    salvarFilaStatus();
                }

                if(filaRetentativaStatus.length === tamanhoAntes) break;
            }
        } catch(e) {
        } finally {
            processandoFilaStatus = false;
        }
    }

    async function alterarStatusPedido(id, novoStatus, motivo = '') {
        pedidosBloqueados.add(id.toString());
        let pedidoLocal = pedidosServidor.find(x => x.id == id);

        if(pedidoLocal) {
            pedidoLocal.status = novoStatus;
            if(novoStatus === 'enviado' || novoStatus === 'buscar' || novoStatus === 'concluido' || novoStatus === 'cancelado') {
                pedidoLocal.finalizadoEm = new Date().toISOString();
            }
            if(motivo) pedidoLocal.motivo = motivo;
        }
        renderizarListaCozinha();
        salvarHistoricoLocal();

        let payload = { action: (novoStatus === 'cancelado' ? 'cancelar_pedido' : 'atualizar_status'), id: id, novoStatus: novoStatus };
        if(motivo) payload.motivo = motivo;

        enfileirarPayloadStatus(payload);
        agendarProcessamentoFila();
        setTimeout(syncGeral, 600);
        setTimeout(syncGeral, 1600);

        setTimeout(() => pedidosBloqueados.delete(id.toString()), 15000);
    }

    function corrigirTemposAbsurdos() {
        let medias = {}; let counts = {};
        pedidosServidor.forEach(p => {
            if ((p.status === 'enviado' || p.status === 'buscar' || p.status === 'concluido') && p.finalizadoEm) {
                let mins = Math.floor((new Date(p.finalizadoEm).getTime() - new Date(p.timestamp).getTime()) / 60000);
                if(mins >= 0 && mins <= 120) {
                    let n = p.produto.split(" (Obs:")[0];
                    medias[n] = (medias[n] || 0) + mins;
                    counts[n] = (counts[n] || 0) + 1;
                }
            }
        });
        Object.keys(medias).forEach(k => medias[k] = Math.round(medias[k] / counts[k]));

        let mudou = false;
        pedidosServidor.forEach(p => {
            if ((p.status === 'enviado' || p.status === 'buscar' || p.status === 'concluido') && p.finalizadoEm) {
                let n = p.produto.split(" (Obs:")[0];
                let media = medias[n];
                if (media !== undefined && media >= 0) {
                    let mins = Math.floor((new Date(p.finalizadoEm).getTime() - new Date(p.timestamp).getTime()) / 60000);
                    if (mins > (media + 60)) {
                        p.finalizadoEm = new Date(new Date(p.timestamp).getTime() + (media * 60000)).toISOString();
                        mudou = true;
                    }
                }
            }
        });
        if(mudou) { salvarHistoricoLocal(); }
    }

    async function syncGeral() {
        if(!db.configs.url) return;
        await processarFilaRetentativas();

        try {
            const dadosServidor = await carregarPedidosServidor();
            document.getElementById('indicadorConexao').innerHTML = '🟢';

            pedidosPendentesLocais = pedidosPendentesLocais.filter(p => (Date.now() - p.localTime) < 20000);
            pedidosPendentesLocais = pedidosPendentesLocais.filter(pTemp => {
                return !dadosServidor.some(pServ => pServ.produto === pTemp.produto && pServ.status === 'pendente' && Math.abs(new Date(pServ.timestamp).getTime() - pTemp.localTime) < 25000);
            });

            let mixPedidos = dadosServidor.concat(pedidosPendentesLocais);

            pedidosServidor = mixPedidos.map(pServ => {
                let pLocal = pedidosServidor.find(x => x.id == pServ.id);
                if (pLocal) {
                    if (pedidosBloqueados.has(pServ.id.toString())) { return pLocal; }
                    let pesoLocal = hierarquiaStatus[pLocal.status] || 0;
                    let pesoServidor = hierarquiaStatus[pServ.status] || 0;
                    let temNaFila = filaRetentativaStatus.some(f => f.payload.id == pServ.id);

                    if (pesoLocal > pesoServidor || temNaFila) {
                        if (pesoLocal > pesoServidor && !temNaFila) {
                            enfileirarPayloadStatus({ action: (pLocal.status === 'cancelado' ? 'cancelar_pedido' : 'atualizar_status'), id: pLocal.id, novoStatus: pLocal.status, motivo: pLocal.motivo || '' });
                        }
                        return pLocal;
                    }
                }
                return pServ;
            });

            corrigirTemposAbsurdos();
            salvarHistoricoLocal();

            if(db.configs.modo === 'cozinha') { renderizarListaCozinha(); } else { renderizarUltimosPedidos(); }
            gerenciarAlarme();
        } catch(e) {
            document.getElementById('indicadorConexao').innerHTML = '🔴';
        }
    }

    function alertaPedidoReconhecido(pedido) {
        return Boolean(pedido && pedido.alertaReconhecidoEm) || pedidosCientes.has(String(pedido && pedido.id));
    }

    async function darCiencia(id) {
        const orderId = String(id);
        pedidosCientes.add(orderId);
        salvarHistoricoLocal();
        renderizarUltimosPedidos();
        gerenciarAlarme();
        if (!syncConfiavel) return;
        try {
            await syncConfiavel.enqueueAcknowledgement(orderId);
            aplicarPedidosSincronizados(syncConfiavel.orders);
        } catch (error) {
            alert('A confirmação ficou apenas neste aparelho. Toque novamente quando a conexão voltar.');
        }
    }

    function renderizarUltimosPedidos() {
        const lista = document.getElementById('listaUltimosPedidosPanelas'); const agora = Date.now(); lista.innerHTML = '';
        const dataHoje = new Date().toDateString();
        let todosRecentes = pedidosDaAreaAtual().filter(p => new Date(p.timestamp).toDateString() === dataHoje).filter(p => {
            if(p.status !== 'concluido' && p.status !== 'enviado' && p.status !== 'buscar' && p.status !== 'cancelado') return true;
            return (agora - new Date(p.finalizadoEm).getTime()) < 300000;
        }).reverse();

        let itensAtencao = []; let itensNormais = [];
        todosRecentes.forEach(p => {
            if((p.status === 'buscar' || p.status === 'cancelado') && !alertaPedidoReconhecido(p)) { itensAtencao.push(p); } else { itensNormais.push(p); }
        });

        let recentes = [...itensAtencao, ...itensNormais].slice(0, 15);
        if(recentes.length === 0) { lista.innerHTML = `<li style="padding: 15px; text-align: center; color: #999;">Nenhum pedido recente.</li>`; return; }

        recentes.forEach(p => {
            let statusTraduzido = ''; let corStatus = ''; let piscaClass = ''; let onclickHtml = ''; let exibirTempo = true;
            if (p.status === 'pendente') { statusTraduzido = 'Pendente'; corStatus = '#d32f2f'; }
            else if (p.status === 'fazendo') { statusTraduzido = 'Em preparo'; corStatus = '#fbc02d'; }
            else if (p.status === 'enviado') { statusTraduzido = 'Enviado'; corStatus = '#9e9e9e'; exibirTempo = false; }
            else if (p.status === 'cancelado') {
                exibirTempo = false; let motivoTxt = p.motivo ? ` (Motivo: ${p.motivo})` : '';
                if(!alertaPedidoReconhecido(p)) { statusTraduzido = 'Cancelado' + motivoTxt; corStatus = '#d32f2f'; piscaClass = 'alerta-pisca-buscar'; onclickHtml = `onclick="darCiencia('${p.id}')"`; } else { statusTraduzido = 'Cancelado' + motivoTxt; corStatus = '#d32f2f'; }
            }
            else if (p.status === 'buscar') {
                exibirTempo = false;
                if(!alertaPedidoReconhecido(p)) { statusTraduzido = 'Pode ir buscar'; corStatus = '#d32f2f'; piscaClass = 'alerta-pisca-buscar'; onclickHtml = `onclick="darCiencia('${p.id}')"`; } else { statusTraduzido = 'Pode ir buscar'; corStatus = '#9e9e9e'; }
            } else { statusTraduzido = 'Finalizado'; corStatus = '#9e9e9e'; exibirTempo = false; }

            let textoTempo = exibirTempo ? ` - ${getTempoRelativo(p.timestamp)}` : '';
            let syncTxt = '';
            if (p.syncState === 'offline') syncTxt = '<span class="sync-pendente">Aguardando internet</span>';
            else if (p.syncState === 'queued' || p.syncState === 'retrying') syncTxt = '<span class="sync-pendente">Aguardando envio</span>';
            lista.innerHTML += `<li class="item ${piscaClass}" style="border-left: 5px solid ${corStatus}; padding: 10px 15px;" ${onclickHtml}><div class="item-info" style="font-size: 14px; white-space: normal; word-break: break-word; line-height: 1.4;"><strong>${p.produto}</strong> - <strong style="color:${corStatus}">${statusTraduzido}</strong><span style="color:#666;">${textoTempo}</span>${syncTxt}</div></li>`;
        });
    }

    function renderizarListaCozinha() {
        const lista = document.getElementById('listaPedidosCozinha'); const agora = Date.now(); lista.innerHTML = '';
        lista.classList.toggle('kds-grid-view', visualizacaoPedidos === 'quadro');
        const dataHoje = new Date().toDateString();

        const visiveis = pedidosDaAreaAtual().filter(p => new Date(p.timestamp).toDateString() === dataHoje).filter(p => {
            if(p.status !== 'concluido' && p.status !== 'enviado' && p.status !== 'buscar' && p.status !== 'cancelado') return true;
            return (agora - new Date(p.finalizadoEm).getTime()) < 300000;
        }).reverse();

        if (visiveis.length === 0) {
            lista.innerHTML = '<li style="padding: 24px; text-align: center; color: #777;">Nenhum pedido nesta área.</li>';
            return;
        }

        visiveis.forEach(p => {

            let emoji = '🔔'; let isFinal = false;
            const areaOrigemPedido = db.areas.find(area => area.id === (p.areaOrigem || 'panelas')) || AREAS_PADRAO[0];
            let formatProduto = `<strong class="pedido-produto-nome">${p.produto}</strong>`;
            let statusTxt = ""; let tempoStr = ""; let classeRiscar = ""; let acoesHtml = "";

            if (p.status === 'pendente') {
                emoji = '🔔';
                statusTxt = 'Novo pedido';
                tempoStr = getTempoRelativo(p.timestamp);
                acoesHtml = `<button class="btn-pedido-acao acao-aceitar" onclick="executarAcaoPedido(this, '${p.id}', 'fazendo')" aria-label="Aceitar pedido" title="Aceitar"><span>✅</span><span class="acao-label">Aceitar</span></button>`;
            }
            else if (p.status === 'fazendo') {
                emoji = '🔥';
                statusTxt = 'Em preparo';
                tempoStr = getTempoRelativo(p.timestamp);
                const botaoVirBuscar = db.configs.virBuscarAtivo !== false
                    ? `<button class="btn-pedido-acao acao-buscar" onclick="executarAcaoPedido(this, '${p.id}', 'buscar')" aria-label="Pedir para vir buscar" title="Vir buscar"><span>🏃🏻‍♀️</span><span class="acao-label">Vir buscar</span></button>`
                    : '';
                acoesHtml = `
                    <button class="btn-pedido-acao acao-enviar" onclick="executarAcaoPedido(this, '${p.id}', 'enviado')" aria-label="Enviar pedido" title="Enviar"><span class="emoji-enviar">⬆</span><span class="acao-label">Enviar</span></button>
                    ${botaoVirBuscar}
                    <button class="btn-pedido-acao acao-cancelar" onclick="cancelarPedidoPeloBotao(this, '${p.id}')" aria-label="Cancelar pedido" title="Cancelar"><span>❌</span></button>`;
            }
            else if (p.status === 'enviado') {
                emoji = '✔️'; isFinal = true; classeRiscar = "riscar";
                statusTxt = 'Enviado';
            }
            else if (p.status === 'buscar') {
                emoji = '✔️'; isFinal = true; classeRiscar = "riscar";
                statusTxt = 'Aguardando retirada';
            }
            else if (p.status === 'concluido') {
                emoji = '✔️'; isFinal = true; classeRiscar = "riscar";
                statusTxt = 'Retirado';
            }
            else if (p.status === 'cancelado') {
                emoji = '❌'; isFinal = true; classeRiscar = "riscar";
                statusTxt = p.motivo ? `Cancelado: ${p.motivo}` : 'Cancelado';
            }

            if (isFinal) {
                acoesHtml = `<button class="btn-pedido-acao acao-desfazer" onclick="executarAcaoPedido(this, '${p.id}', 'fazendo')" aria-label="Desfazer ação" title="Desfazer"><span>↩️</span><span class="acao-label">Desfazer</span></button>`;
            }

            let cssStatus = isFinal ? (p.status==='cancelado' ? 'cancelado' : 'concluido') : p.status;

            if (isFinal && p.finalizadoEm && p.status !== 'cancelado') {
                tempoStr = `Entregue ${getTempoRelativo(p.finalizadoEm)}`;
            } else if (p.status === 'cancelado') {
                tempoStr = "";
            }

            let subtitleHtml = `<div class="item-subtitle" style="text-decoration: none !important; opacity: 1 !important;">${statusTxt}</div>`;
            const atributosAceitar = p.status === 'pendente'
                ? `class="item pedido-cozinha pedido-aceitavel status-${cssStatus}" role="button" tabindex="0" aria-label="Aceitar pedido" onclick="aceitarPedidoPelaCaixa(event, '${p.id}')" onkeydown="aceitarPedidoPelaCaixa(event, '${p.id}')"`
                : `class="item pedido-cozinha status-${cssStatus}"`;

            lista.innerHTML += `
                <li ${atributosAceitar} id="ped-${p.id}" data-id="${p.id}" data-status="${p.status}">
                    <div class="pedido-conteudo">
                        <div class="item-avatar pedido-status-emoji ${classeRiscar}">${emoji}</div>
                        <div class="item-info" style="display:flex; justify-content:space-between; align-items:center;">
                          <div>
                            <div class="item-title ${classeRiscar}" style="margin: 0; line-height: 1.2;">${formatProduto}</div>
                            ${subtitleHtml}
                          </div>
                          <div style="font-size:13px; color:#888; font-weight:bold; white-space:nowrap; margin-left:10px;">${tempoStr}</div>
                        </div>
                    </div>
                    <div class="pedido-meta-acoes">
                        <div class="pedido-origem" aria-label="Área de origem">${getEmojiAreaHtml(areaOrigemPedido.emoji)}</div>
                        <div class="pedido-acoes">${acoesHtml}</div>
                    </div>
                </li>
            `;
        });
    }

    function desabilitarAcoesPedido(botao) {
        const container = botao && botao.closest('.pedido-acoes');
        if (container) container.querySelectorAll('button').forEach(item => { item.disabled = true; });
    }

    function executarAcaoPedido(botao, id, novoStatus) {
        desabilitarAcoesPedido(botao);
        alterarStatusPedido(id, novoStatus);
    }

    function aceitarPedidoPelaCaixa(event, id) {
        if (!event || event.target.closest('.btn-pedido-acao')) return;
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        if (event.type === 'keydown') event.preventDefault();
        const card = event.currentTarget;
        if (!card || card.dataset.status !== 'pendente') return;
        card.dataset.status = 'processando';
        executarAcaoPedido(card.querySelector('.acao-aceitar'), id, 'fazendo');
    }

    function cancelarPedidoPeloBotao(botao, id) {
        const pedido = pedidosServidor.find(item => item.id === String(id));
        if (!pedido) return;
        abrirModalCancelamento(id, pedido.produto);
    }

    function gerenciarAlarme() {
        let deveTocar = false; let configSom = "sem_som"; const h = document.getElementById('mainHeader'); h.classList.remove('alerta-pisca', 'alerta-pisca-buscar');
        if (db.configs.modo === 'cozinha') {
            const dataHoje = new Date().toDateString();
            if(pedidosServidor.some(p => p.status === 'pendente' && new Date(p.timestamp).toDateString() === dataHoje)) { h.classList.add('alerta-pisca'); if(db.configs.somCozinha !== "sem_som") { deveTocar = true; configSom = db.configs.somCozinha; } }
        } else if (db.configs.modo === 'panelas') {
            const agora = Date.now();
            if(pedidosServidor.some(p => { const ehRecente = (agora - new Date(p.finalizadoEm).getTime()) < 300000; return ehRecente && (p.status === 'buscar' || p.status === 'cancelado') && !alertaPedidoReconhecido(p); })) { h.classList.add('alerta-pisca-buscar'); if(db.configs.somPanelas !== "sem_som") { deveTocar = true; configSom = db.configs.somPanelas; } }
        }
        if (deveTocar) {
            configSom = normalizarSom(configSom, db.configs.modo === 'panelas' ? 'beep' : 'alarme');
            const volume = db.configs.modo === 'panelas' ? parseInt(db.configs.volumePanelas || '70', 10) : parseInt(db.configs.volumeCozinha || '100', 10);
            const volumeNormalizado = Math.max(0, Math.min(100, volume)) / 100;
            const som = sonsDisponiveis[configSom];

            if (som.tipo === "audio") {
                pararSomSintetico();
                playerAlarme.volume = volumeNormalizado;
                if (!alarmeTocando || somAtualTocando !== configSom) {
                    playerAlarme.src = som.url;
                    playerAlarme.play().catch(()=>{});
                    somAtualTocando = configSom;
                }
                alarmeTocando = true;
            } else if (som.tipo === "sintetico") {
                playerAlarme.pause();
                if (!alarmeTocando || somAtualTocando !== configSom) {
                    pararSomSintetico();
                    executarSomSintetico(configSom, volumeNormalizado);
                    alarmeSinteticoTimer = setInterval(() => executarSomSintetico(configSom, volumeNormalizado), som.intervalo || 1400);
                    somAtualTocando = configSom;
                }
                alarmeTocando = true;
            }
        } else { pararAlarme(); }
    }

    function pararAlarme() { document.getElementById('mainHeader').classList.remove('alerta-pisca', 'alerta-pisca-buscar'); playerAlarme.pause(); pararSomSintetico(); alarmeTocando = false; somAtualTocando = "sem_som"; }

    async function executarAcaoPendenteAutorizada() {
        if (acaoPendente === 'zerar_expediente') {
            await excluirHojeConfiavel();
        } else if (acaoPendente === 'excluir_item') {
            await excluirPedidoConfiavel(parametroAcao);
        }
        acaoPendente = null;
        parametroAcao = null;
    }

    async function solicitarAutorizacaoAcao() {
        const confirmed = await AloUiDialog.confirm(descricaoAcaoPendente, {
            title: tituloAcaoPendente,
            icon: '🗑️', tone: 'danger', confirmText: 'Excluir'
        });
        if (confirmed) executarAcaoPendenteAutorizada();
        else { acaoPendente = null; parametroAcao = null; }
    }

    function solicitarExclusaoHistorico(id) {
        acaoPendente = 'excluir_item';
        parametroAcao = id;
        tituloAcaoPendente = 'Excluir pedido?';
        descricaoAcaoPendente = 'Isso apagará este pedido do sistema para sempre.';
        solicitarAutorizacaoAcao();
    }

    function limparHistoricoHoje() {
        acaoPendente = 'zerar_expediente';
        tituloAcaoPendente = 'Zerar expediente?';
        descricaoAcaoPendente = 'Isso apagará os pedidos de hoje da tela e do servidor.';
        solicitarAutorizacaoAcao();
    }

    function abrirHistorico() {
        const lista = document.getElementById('listaHistorico'); lista.innerHTML = ''; const dataHoje = new Date().toDateString();
        const historicoHoje = pedidosServidor.filter(p => new Date(p.timestamp).toDateString() === dataHoje).reverse();
        if(historicoHoje.length === 0) { lista.innerHTML = '<li style="padding: 15px; text-align: center; color: #999;">Nenhum pedido hoje.</li>'; } else {
            historicoHoje.forEach(p => {
                let statusTxt = p.status === 'pendente' ? 'Pendente' : (p.status === 'fazendo' ? 'Em preparo' : (p.status === 'enviado' ? 'Enviado' : (p.status === 'buscar' ? 'Buscar' : (p.status === 'cancelado' ? 'Cancelado' : 'Finalizado'))));
                if(p.status === 'cancelado' && p.motivo) statusTxt += ` (Motivo: ${p.motivo})`;
                lista.innerHTML += `<li class="item" style="padding: 10px; border-bottom: 1px solid #eee;"><div class="item-info"><div class="item-title" style="font-size: 15px;">${p.produto}</div><div class="item-subtitle">${new Date(p.timestamp).toLocaleTimeString()} - ${statusTxt}</div></div><button class="btn-excluir-historico" onclick="solicitarExclusaoHistorico('${p.id}')" aria-label="Excluir pedido" title="Excluir pedido">🗑️</button></li>`;
            });
        }
        document.getElementById('modalHistorico').style.display = 'flex';
    }

    function abrirRelatorioCompleto() {
        fecharModal('modalHistorico');
        abrirModalMetricas();
        renderizarMetricasDetalhes('tudo');
    }

    function fecharModal(id) { document.getElementById(id).style.display = 'none'; }

    function abrirModalNoTopo(id) {
        const overlay = document.getElementById(id);
        if (!overlay) return;
        overlay.style.display = 'flex';
        overlay.scrollTop = 0;
        const modal = overlay.querySelector('.modal');
        if (modal) modal.scrollTop = 0;
        requestAnimationFrame(() => {
            overlay.scrollTop = 0;
            if (modal) modal.scrollTop = 0;
        });
    }

    let destinoConfiguracoes = 'painel';
    let destinoLoginOperador = 'painel';
    let sessaoCompras = null;
    let sessaoL42 = null;
    let sessaoKds = null;
    let sessaoChecklist = null;
    let etiquetaPendenteFicha = null;
    let destinoChecklistProtegido = '';
    let sessaoAdministrativaAtiva = false;
    const ULTIMO_OPERADOR_LOGIN_KEY = 'alo_ultimo_operador_login_v1';

    function atualizarEngrenagensDaSessao() {
        const compras = document.getElementById('feiraSettingsButton');
        if (compras) compras.style.display = !exigeLoginModulo('compras') || sessaoCompras?.isAdmin ? 'inline-flex' : 'none';
        const kds = document.getElementById('kdsSettingsButton');
        if (kds) kds.style.display = !exigeLoginModulo('kds') || sessaoKds?.podeConfigurarKds || sessaoKds?.isAdmin ? 'inline-flex' : 'none';
        const checklist = document.getElementById('tasksSettingsButton');
        if (checklist) checklist.style.display = !exigeLoginModulo('checklist') || sessaoChecklist?.podeConfigurarChecklist || sessaoChecklist?.isAdmin ? 'inline-flex' : 'none';
        atualizarChipOperador('kdsOperatorChip', sessaoKds, exigeLoginModulo('kds'));
        atualizarChipOperador('tasksOperatorChip', sessaoChecklist, exigeLoginModulo('checklist'));
    }

    function atualizarChipOperador(id, sessao, loginAtivo) {
        const chip = document.getElementById(id);
        if (!chip) return;
        chip.style.display = loginAtivo && sessao ? 'inline-flex' : 'none';
        if (!sessao) return;
        const emoji = chip.querySelector('span');
        const nome = chip.querySelector('strong');
        if (emoji) emoji.textContent = sessao.emoji || '👤';
        if (nome) nome.textContent = sessao.nome || '';
    }

    function exigeLoginModulo(modulo) {
        const defaults = { kds:false, checklist:false, compras:true, l42:true };
        return db.configs.loginObrigatorioModulos?.[modulo] ?? defaults[modulo] ?? false;
    }

    function exigeLoginChecklistVisao(visao) {
        return Boolean(db.configs.loginObrigatorioChecklistVisoes?.[visao]);
    }

    function podeAcessarChecklistVisao(visao) {
        return !exigeLoginChecklistVisao(visao) || Boolean(sessaoChecklist);
    }

    function solicitarAcessoChecklist(visao) {
        if (!exigeLoginChecklistVisao(visao) || sessaoChecklist) return true;
        destinoChecklistProtegido = visao;
        abrirLoginAdmin('checklist_acesso');
        return false;
    }

    function abrirVisaoChecklistProtegida() {
        const destino = destinoChecklistProtegido;
        destinoChecklistProtegido = '';
        if (destino === 'documentos') AloTechnicalSheets?.showView('documents', true);
        if (destino === 'geral') AloTasks?.setArea('todos', true);
    }

    function sincronizarSwitchesLogin() {
        [['loginRequiredKds','kds'],['loginRequiredChecklist','checklist'],['loginRequiredCompras','compras'],['loginRequiredL42','l42']].forEach(([id, modulo]) => {
            const input = document.getElementById(id);
            if (input) input.checked = exigeLoginModulo(modulo);
        });
        [['loginRequiredChecklistDocuments','documentos'],['loginRequiredChecklistOverview','geral']].forEach(([id, visao]) => {
            const input = document.getElementById(id);
            if (input) input.checked = exigeLoginChecklistVisao(visao);
        });
    }

    function salvarExigirLoginModulo(modulo, exigir) {
        db.configs.loginObrigatorioModulos = { kds:false, checklist:false, compras:true, l42:true, ...(db.configs.loginObrigatorioModulos || {}), [modulo]:Boolean(exigir) };
        marcarBancoAlterado();
        atualizarEngrenagensDaSessao();
    }

    function salvarExigirLoginChecklistVisao(visao, exigir) {
        db.configs.loginObrigatorioChecklistVisoes = {
            documentos:false,
            geral:false,
            ...(db.configs.loginObrigatorioChecklistVisoes || {}),
            [visao]:Boolean(exigir)
        };
        marcarBancoAlterado();
    }

    function modulosVisiveis() {
        return { kds:true, checklist:true, compras:true, l42:true, ...(db.configs.modulosVisiveis || {}) };
    }

    function aplicarVisibilidadeModulos() {
        const visibility = modulosVisiveis();
        document.querySelectorAll('[data-home-module]').forEach(button => {
            button.style.display = visibility[button.dataset.homeModule] === false ? 'none' : '';
        });
    }

    function sincronizarSwitchesModulos() {
        const visibility = modulosVisiveis();
        [['moduleVisibleKds','kds'],['moduleVisibleChecklist','checklist'],['moduleVisibleCompras','compras'],['moduleVisibleL42','l42']].forEach(([id, moduleId]) => {
            const input = document.getElementById(id);
            if (input) input.checked = visibility[moduleId] !== false;
        });
    }

    function salvarModuloVisivel(modulo, visivel) {
        if (!['kds', 'checklist', 'compras', 'l42'].includes(modulo)) return;
        db.configs.modulosVisiveis = { ...modulosVisiveis(), [modulo]:Boolean(visivel) };
        aplicarVisibilidadeModulos();
        marcarBancoAlterado();
    }

    function abrirConfiguracaoModulos() {
        sincronizarSwitchesModulos();
        window.AloFeiraModule?.refreshHeader?.();
        fecharModal('modalPainelUnificado');
        abrirModalNoTopo('modalModuleVisibility');
    }

    function voltarConfiguracaoModulos() {
        fecharModal('modalModuleVisibility');
        abrirModalNoTopo('modalPainelUnificado');
    }

    function abrirPainelControle() {
        window.AloCloud?.renderAccountSettings?.();
        abrirModalNoTopo('modalPainelUnificado');
    }

    function abrirDestinoConfiguracoes() {
        if (destinoConfiguracoes === 'kds') {
            abrirConfiguracoesKds();
            return;
        }
        if (destinoConfiguracoes === 'tasks') {
            AloTasks.openSettingsMenu();
            return;
        }
        if (destinoConfiguracoes === 'compras') {
            abrirConfiguracoesCompras();
            return;
        }
        if (destinoConfiguracoes === 'etiquetas') {
            abrirConfiguracoesEtiquetas();
            return;
        }
        abrirPainelControle();
    }

    function abrirConfiguracoesKds() {
        sincronizarSwitchesLogin();
        fecharModal('modalPainelUnificado');
        abrirModalNoTopo('modalConfigKds');
    }

    function voltarConfiguracoesKds() {
        fecharModal('modalConfigKds');
        if (destinoConfiguracoes !== 'kds') abrirModalNoTopo('modalPainelUnificado');
    }

    function voltarConfiguracoesTarefas() {
        fecharModal('modalConfigTasksMenu');
        if (destinoConfiguracoes !== 'tasks') abrirModalNoTopo('modalPainelUnificado');
    }

    function abrirConfiguracoesCompras() {
        sincronizarSwitchesLogin();
        fecharModal('modalPainelUnificado');
        AloFeiraModule.open();
        AloFeiraModule.refreshHeader();
        abrirModalNoTopo('modalConfigCompras');
    }

    function voltarConfiguracoesCompras() {
        fecharModal('modalConfigCompras');
        if (destinoConfiguracoes !== 'compras') abrirModalNoTopo('modalPainelUnificado');
    }

    function abrirConfiguracoesEtiquetas() {
        sincronizarSwitchesLogin();
        fecharModal('modalPainelUnificado');
        AloL42Module.open();
        abrirModalNoTopo('modalConfigEtiquetas');
    }

    function voltarConfiguracoesEtiquetas() {
        fecharModal('modalConfigEtiquetas');
        if (destinoConfiguracoes !== 'etiquetas') abrirModalNoTopo('modalPainelUnificado');
    }

    async function abrirModuloComLogin(modulo) {
        const canonical = modulo === 'tasks' ? 'checklist' : (modulo === 'feira' ? 'compras' : modulo);
        if (!exigeLoginModulo(canonical)) {
            AloTasks.openModule(canonical === 'checklist' ? 'tasks' : (canonical === 'compras' ? 'feira' : canonical));
            atualizarEngrenagensDaSessao();
            return;
        }
        await abrirLoginAdmin(canonical === 'checklist' ? 'checklist_modulo' : `${canonical}_modulo`);
    }

    async function abrirModuloCompras() {
        await abrirModuloComLogin('compras');
    }

    async function abrirModuloL42() {
        etiquetaPendenteFicha = null;
        await abrirModuloComLogin('l42');
    }

    async function abrirEtiquetaDaFicha(reference) {
        etiquetaPendenteFicha = reference && typeof reference === 'object' ? { ...reference } : null;
        if (!etiquetaPendenteFicha) return;
        if (!exigeLoginModulo('l42') || sessaoL42) {
            AloTasks.openModule('l42');
            const pending = etiquetaPendenteFicha;
            etiquetaPendenteFicha = null;
            await AloL42Module.openProductForPrint(pending);
            return;
        }
        await abrirLoginAdmin('l42_modulo');
    }

    async function abrirLoginAdmin(destino = 'painel') {
        const destinosValidos = ['painel', 'kds', 'tasks', 'compras', 'etiquetas', 'kds_modulo', 'trocar_kds', 'checklist_modulo', 'trocar_checklist', 'checklist_acesso', 'compras_modulo', 'trocar_compras', 'l42_modulo', 'trocar_l42'];
        destinoLoginOperador = destinosValidos.includes(destino) ? destino : 'painel';
        if (['painel', 'kds', 'tasks', 'compras', 'etiquetas'].includes(destinoLoginOperador)) destinoConfiguracoes = destinoLoginOperador;
        if (destinoLoginOperador === 'compras' && sessaoCompras?.isAdmin) {
            abrirDestinoConfiguracoes();
            return;
        }
        const sessaoPodeConfigurarEtiquetas = sessaoL42 && (
            sessaoL42.isAdmin
            || sessaoL42.podeConfigurarEtiquetas
            || sessaoL42.permissions?.l42?.configuracoes
        );
        if (destinoLoginOperador === 'etiquetas' && sessaoPodeConfigurarEtiquetas) {
            abrirDestinoConfiguracoes();
            return;
        }

        const modal = document.getElementById('modalLoginAdmin');
        const select = document.getElementById('operadorAdmin');
        const input = document.getElementById('senhaAdmin');
        const button = document.getElementById('btnConfirmarLoginOperador');
        const titulosModulo = { kds_modulo:'Entrar no KDS', checklist_modulo:'Entrar no Checklist', checklist_acesso:'Entrar no Checklist', compras_modulo:'Entrar na Lista de Compras', l42_modulo:'Entrar em Etiquetas' };
        document.getElementById('tituloLoginOperador').innerText = titulosModulo[destinoLoginOperador]
            || (destinoLoginOperador.startsWith('trocar_') ? 'Trocar pessoa' : 'Acesso às configurações');
        select.innerHTML = '<option value="">Carregando operadores...</option>';
        select.disabled = true;
        limparPinAdmin();
        input.disabled = true;
        button.disabled = true;
        limparErroSenha('erroSenhaAdmin');
        prepararTecladoPinAdmin();
        modal.style.display = 'flex';

        try {
            const finalidade = ['kds_modulo', 'trocar_kds'].includes(destinoLoginOperador)
                ? 'kds_operacional'
                : (['checklist_modulo', 'trocar_checklist', 'checklist_acesso'].includes(destinoLoginOperador)
                    ? 'checklist_operacional'
                    : (['compras_modulo', 'trocar_compras'].includes(destinoLoginOperador)
                        ? 'compras'
                        : (['l42_modulo', 'trocar_l42', 'etiquetas'].includes(destinoLoginOperador)
                            ? 'l42'
                            : (destinoLoginOperador === 'kds' ? 'kds' : (destinoLoginOperador === 'tasks' ? 'checklist' : 'painel')))));
            const operadores = await AloSharedData.listLoginPeople(finalidade);
            if (!operadores.length) {
                fecharModal('modalLoginAdmin');
                if (destinoLoginOperador === 'painel') {
                    sessaoAdministrativaAtiva = true;
                    abrirPainelControle();
                    return;
                }
                await AloUiDialog.notice('Cadastre o primeiro operador nas Configurações do Alô Cozinha.', {
                    title: 'Nenhum acesso cadastrado', icon: '👤', confirmText: 'Entendi'
                });
                return;
            }
            select.innerHTML = '<option value="">Selecione a pessoa</option>';
            operadores.forEach(operador => {
                const option = document.createElement('option');
                option.value = operador.id;
                option.textContent = `${operador.emoji} ${operador.nome}`;
                select.appendChild(option);
            });
            select.disabled = false;
            input.disabled = false;
            button.disabled = false;
            const ultimoOperadorId = localStorage.getItem(ULTIMO_OPERADOR_LOGIN_KEY) || '';
            const ultimoOperadorDisponivel = operadores.some(operador => operador.id === ultimoOperadorId);
            if (ultimoOperadorDisponivel) select.value = ultimoOperadorId;
            setTimeout(() => {
                if (ultimoOperadorDisponivel) {
                    input.focus();
                    input.select();
                } else {
                    select.focus();
                }
            }, 120);
        } catch (error) {
            fecharModal('modalLoginAdmin');
            await AloUiDialog.notice(error.message || 'Não foi possível carregar os operadores.', {
                title: 'Login indisponível', icon: '!', tone: 'danger', confirmText: 'Entendi'
            });
        }
    }

    function abrirConfiguracoesAvancadas() {
        document.getElementById('configSenhaSeguranca').value = db.configs.senhaSeguranca || '';
        document.getElementById('configSenhaFeedback').innerText = '';
        window.AloCloud?.renderAccountSettings?.();
        abrirModalNoTopo('modalConfigAvancadas');
    }

    function solicitarAcessoAvancado() {
        fecharModal('modalPainelUnificado');
        if (!db.configs.senhaSeguranca) {
            abrirConfiguracoesAvancadas();
            return;
        }
        document.getElementById('senhaAvancada').value = '';
        limparErroSenha('erroSenhaAvancada');
        document.getElementById('modalSenhaAvancada').style.display = 'flex';
        setTimeout(() => document.getElementById('senhaAvancada').focus(), 100);
    }

    async function limparHistoricoKds() {
        await AloApi.post(db.configs.url, { action: 'excluir_tudo' });
        pedidosServidor = [];
        pedidosPendentesLocais = [];
        pedidosBloqueados.clear();
        pedidosCientes.clear();
        filaRetentativaStatus = [];
        salvarFilaStatus();
        salvarHistoricoLocal();
        renderizarListaCozinha();
        renderizarUltimosPedidos();
        gerenciarAlarme();
    }

    async function limparHistoricoChecklist() {
        await AloApi.post(db.configs.url, { action: 'excluir_historico_atividades' });
        const confirmation = await AloApi.getActivityHistory(db.configs.url, '0000-01-01', '9999-12-31');
        const finalized = Array.isArray(confirmation?.atividades)
            ? confirmation.atividades.filter(activity => ['concluida', 'nao_realizada'].includes(activity.status))
            : [];
        if (confirmation?.revision === undefined || finalized.length) {
            throw new Error('A nuvem não confirmou a limpeza do Checklist.');
        }
        AloTasks.clearHistoryLocal();
    }

    async function limparHistoricoCompras() {
        await AloFeiraModule.clearHistory();
    }

    async function limparHistoricoEtiquetas() {
        await AloL42Module.clearHistory();
    }

    async function excluirHistoricoModulo(modulo) {
        const nomes = { kds: 'KDS', checklist: 'Checklist', compras: 'Compras', l42: 'Etiquetas', todos: 'todos os módulos' };
        const alvos = modulo === 'todos' ? ['kds', 'checklist', 'compras', 'l42'] : [modulo];
        if (!nomes[modulo] || !db.configs.url) {
            await AloUiDialog.notice('Configure e valide a URL da nuvem antes de apagar históricos.', {
                title: 'Nuvem não configurada', icon: '!', tone: 'danger', confirmText: 'Entendi'
            });
            return;
        }
        const confirmed = await AloUiDialog.confirm(
            `Apagar o histórico de ${nomes[modulo]}?\n\nProdutos, tarefas, operadores, fornecedores e configurações serão mantidos.`,
            { title: 'Apagar histórico', icon: '🗑️', tone: 'danger', confirmText: 'Apagar' }
        );
        if (!confirmed) return;

        const handlers = {
            kds: limparHistoricoKds,
            checklist: limparHistoricoChecklist,
            compras: limparHistoricoCompras,
            l42: limparHistoricoEtiquetas
        };
        const falhas = [];
        for (const alvo of alvos) {
            try { await handlers[alvo](); }
            catch (error) { falhas.push(nomes[alvo]); }
        }
        if (falhas.length) {
            await AloUiDialog.notice(`Não foi possível confirmar a exclusão em: ${falhas.join(', ')}. Os demais módulos já foram processados.`, {
                title: 'Exclusão parcialmente concluída', icon: '!', tone: 'danger', confirmText: 'Entendi'
            });
            return;
        }
        await AloUiDialog.notice(`Histórico de ${nomes[modulo]} apagado.`, {
            title: 'Histórico apagado', icon: '✓', confirmText: 'Entendi'
        });
    }

    async function forcarAtualizacao() {
        const confirmed = await AloUiDialog.confirm('Deseja recarregar o aplicativo e limpar os arquivos temporários?', {
            title: 'Atualizar aplicativo', icon: '↻', confirmText: 'Atualizar agora'
        });
        if (confirmed) {
            sessionStorage.clear();

            if ('caches' in window) {
                const names = await caches.keys();
                await Promise.all(names.filter(name => name.startsWith('alo-cozinha2-')).map(name => caches.delete(name)));
            }

            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                const appRoot = new URL('./', window.location.href).href;
                for (let registration of registrations) {
                    if (registration.scope.startsWith(appRoot)) await registration.unregister();
                }
            }
            window.location.href = window.location.pathname + '?t=' + new Date().getTime();
        }
    }

    function abrirModalMetricas() {
        fecharModal('modalPainelUnificado');
        fecharModal('modalConfigKds');
        document.getElementById('boxFiltroCustom').style.display = 'none';
        renderizarMetricasDetalhes('hoje');
        document.getElementById('modalMetricas').style.display = 'flex';
    }

    function mostrarCalendarioCustom() {
        document.querySelectorAll('#modalMetricas .btn-tab').forEach(b => b.classList.remove('active'));
        document.getElementById('btnAbaCustom').classList.add('active');
        document.getElementById('boxFiltroCustom').style.display = 'block';
    }

    function renderizarMetricasDetalhes(periodo) {
        if(periodo !== 'custom') {
            document.querySelectorAll('#modalMetricas .btn-tab').forEach(b => b.classList.remove('active'));
            document.getElementById('btnAba' + (periodo === 'hoje' ? 'Hoje' : periodo)).classList.add('active');
            document.getElementById('boxFiltroCustom').style.display = 'none';
        }

        const hoje = new Date();
        hoje.setHours(0,0,0,0);
        let timeInicio = 0; let timeFim = Date.now();

        if (periodo === 'hoje') { timeInicio = hoje.getTime(); }
        else if (periodo === 'tudo') { timeInicio = 0; }
        else if (periodo === '7d') { timeInicio = hoje.getTime() - (6 * 86400000); }
        else if (periodo === '15d') { timeInicio = hoje.getTime() - (14 * 86400000); }
        else if (periodo === '30d') { timeInicio = hoje.getTime() - (29 * 86400000); }
        else if (periodo === 'custom') {
            const dtIni = document.getElementById('filtroDataInicio').value;
            const dtFim = document.getElementById('filtroDataFim').value;
            if(!dtIni || !dtFim) return alert("Selecione a data de início e fim.");

            let dI = new Date(dtIni); dI.setMinutes(dI.getMinutes() + dI.getTimezoneOffset()); dI.setHours(0,0,0,0);
            let dF = new Date(dtFim); dF.setMinutes(dF.getMinutes() + dF.getTimezoneOffset()); dF.setHours(23,59,59,999);
            timeInicio = dI.getTime(); timeFim = dF.getTime();
        }

        let stats = {};
        let totalGeral = 0;

        pedidosServidor.forEach(p => {
            let dataPedTime = new Date(p.timestamp).getTime();
            if (dataPedTime >= timeInicio && dataPedTime <= timeFim) {
                let nomeBase = p.produto.split(" (Obs:")[0];

                if (!stats[nomeBase]) stats[nomeBase] = { qtd: 0, tempoTotal: 0, countTempo: 0, temposIndividuais: [] };
                stats[nomeBase].qtd++;
                totalGeral++;

                if ((p.status === 'enviado' || p.status === 'buscar' || p.status === 'concluido') && p.finalizadoEm) {
                    let minutos = Math.floor((new Date(p.finalizadoEm).getTime() - dataPedTime) / 60000);
                    stats[nomeBase].tempoTotal += minutos;
                    stats[nomeBase].countTempo++;

                    stats[nomeBase].temposIndividuais.push({
                        minutos: minutos,
                        dataStr: new Date(dataPedTime).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute:'2-digit'})
                    });
                }
            }
        });

        document.getElementById('metricaTotalQtd').innerText = totalGeral;
        const lista = document.getElementById('listaMetricasDetalhes');
        lista.innerHTML = '';

        let arrayStats = Object.keys(stats).map(k => ({ nome: k, ...stats[k] }));
        arrayStats.sort((a, b) => b.qtd - a.qtd);

        if(arrayStats.length === 0) {
            lista.innerHTML = '<li style="padding: 15px; text-align: center; color: #999;">Nenhum dado no período.</li>';
            return;
        }

        arrayStats.forEach((item, idx) => {
            let media = item.countTempo > 0 ? Math.round(item.tempoTotal / item.countTempo) : 0;
            let tempoStr = media < 1 ? "&lt; 1 min" : `${media} min`;
            if(item.countTempo === 0) tempoStr = "-";

            let tagsHtml = item.temposIndividuais.map(t => {
                let corBg = t.minutos <= 15 ? '#c8e6c9' : (t.minutos <= 30 ? '#fff9c4' : '#ffcdd2');
                let corTx = t.minutos <= 15 ? '#2e7d32' : (t.minutos <= 30 ? '#f57f17' : '#c62828');
                let minStr = t.minutos < 1 ? '<1m' : t.minutos + 'm';

                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; padding:6px 10px; margin-bottom: 4px; border-radius: 4px; border: 1px solid #eee;">
                        <span style="font-size:12px; color:#555; font-weight: bold;">📅 ${t.dataStr}</span>
                        <span style="display:inline-block; background:${corBg}; color:${corTx}; border-radius:4px; padding:3px 8px; font-size:12px; font-weight:bold;">⏱️ ${minStr}</span>
                    </div>
                `;
            }).join('');

            if(tagsHtml === '') tagsHtml = '<div style="font-size:12px; color:#999; padding: 5px;">Sem histórico finalizado</div>';

            lista.innerHTML += `
                <li class="item" style="padding: 10px; border-bottom: 1px solid #eee; flex-direction:column; align-items:stretch; cursor:pointer;" onclick="document.getElementById('det-${idx}').style.display = document.getElementById('det-${idx}').style.display === 'none' ? 'block' : 'none'">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex:1;">
                            <strong style="font-size:14px; color:#333;">${item.nome}</strong>
                            <div style="font-size:12px; color:#1976D2; margin-top:2px; font-weight: bold;">+ ver tempos</div>
                        </div>
                        <div style="text-align:right; font-size:13px; color:#555;">
                            <span style="display:inline-block; width:40px; text-align:center; background:#e0e0e0; border-radius:10px; padding:2px 5px; font-weight:bold;">${item.qtd}x</span>
                            <span style="display:inline-block; width:65px; text-align:right; color:#2e7d32; font-weight:bold;">⏱️ ${tempoStr}</span>
                        </div>
                    </div>
                    <div id="det-${idx}" style="display:none; margin-top:10px; padding:10px; background: #f9f9f9; border-radius: 5px;">
                        ${tagsHtml}
                    </div>
                </li>
            `;
        });
    }

    var sincronizarPuxarNuvem;

    async function coletarFotosTarefasBackup() {
        const tarefasComFoto = (db.tarefas || []).filter(tarefa => tarefa && tarefa.fotoReferencia && tarefa.id);
        const photos = {};
        if (!tarefasComFoto.length) return photos;
        if (!db.configs.url) throw new Error('Conecte a nuvem para incluir as fotos das tarefas no backup.');
        for (const tarefa of tarefasComFoto) {
            const file = await AloApi.getTaskPhoto(db.configs.url, tarefa.id, true);
            if (!file?.encontrada || !file.dataUrl) throw new Error(`A foto da tarefa “${tarefa.nome || tarefa.id}” não pôde ser incluída no backup.`);
            photos[tarefa.id] = { dataUrl:file.dataUrl, mime:file.mime || 'image/jpeg', name:file.nome || `tarefa-${tarefa.id}.jpg` };
        }
        return photos;
    }

    async function restaurarFotosTarefasBackup(photos) {
        const entries = Object.entries(photos || {});
        if (!entries.length) return;
        for (const [taskId, file] of entries) {
            if (file?.dataUrl) await AloApi.uploadTaskPhoto(db.configs.url, taskId, file.dataUrl);
        }
    }

    async function exportarDadosFisicos() {
        const button = document.getElementById('btnExportarBackupCompleto');
        const status = document.getElementById('statusImportacaoBackup');
        const originalText = button?.innerText || '';
        try {
            if (button) { button.disabled = true; button.innerText = 'Preparando backup...'; }
            if (status) status.innerText = 'Conferindo todos os módulos e históricos...';
            const runtimeChecklist = AloTasks.getBackupData();
            let pedidos = pedidosServidor;
            let atividades = runtimeChecklist.atividades;
            if (db.configs.url) {
                const [historicoKds, historicoChecklist] = await Promise.all([
                    AloApi.getHistory(db.configs.url, '2000-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z'),
                    AloApi.getActivityHistory(db.configs.url, '0000-01-01', '9999-12-31')
                ]);
                pedidos = Array.isArray(historicoKds?.pedidos) ? historicoKds.pedidos : [];
                atividades = Array.isArray(historicoChecklist?.atividades) ? historicoChecklist.atividades : [];
            }
            const [compras, l42] = await Promise.all([
                AloFeiraModule.getBackup(),
                AloL42Module.getBackup()
            ]);
            await Promise.allSettled([AloTechnicalSheets.syncNow(), AloChecklistDocuments.syncNow()]);
            if (status) status.innerText = 'Incluindo fotos, logomarca e documentos...';
            const [fichasTecnicas, documentosChecklist, taskPhotos] = await Promise.all([
                AloTechnicalSheets.getBackupWithMedia(),
                AloChecklistDocuments.getBackupWithMedia(),
                coletarFotosTarefasBackup()
            ]);
            const dataToExport = {
                app: 'alo_cozinha',
                format: 'backup_completo',
                schemaVersion: 4,
                version: '2.1.50',
                exportadoEm: new Date().toISOString(),
                kdsChecklist: {
                    db: JSON.parse(JSON.stringify(db)),
                    pedidos,
                    atividades,
                    filaChecklistPendente: runtimeChecklist.filaPendente,
                    cientes: Array.from(pedidosCientes)
                },
                compras,
                l42,
                fichasTecnicas,
                documentosChecklist,
                compartilhado: AloSharedData.getBackup(),
                media: { taskPhotos }
            };
            const dataStr = JSON.stringify(dataToExport, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const data = new Date();
            const carimbo = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}_${String(data.getHours()).padStart(2, '0')}-${String(data.getMinutes()).padStart(2, '0')}`;
            const nomeArquivo = `alo_cozinha_backup_completo_${carimbo}.json`;
            const resultado = await salvarBackupCompleto(blob, nomeArquivo);

            if (status) {
                status.innerText = resultado.destino === 'android'
                    ? `Backup salvo em Downloads/Alo Cozinha: ${resultado.nome}`
                    : `Download iniciado: ${resultado.nome}`;
            }
        } catch(error) {
            if (status) status.innerText = '';
            await AloUiDialog.notice(error.message || 'Não foi possível gerar o backup completo.', {
                title: 'Backup não gerado', icon: '!', tone: 'danger', confirmText: 'Entendi'
            });
        } finally {
            if (button) { button.disabled = false; button.innerText = originalText; }
        }
    }

    function arrayBufferParaBase64Backup(buffer) {
        const bytes = new Uint8Array(buffer);
        let binario = '';
        const bloco = 0x8000;
        for (let i = 0; i < bytes.length; i += bloco) {
            binario += String.fromCharCode(...bytes.subarray(i, Math.min(i + bloco, bytes.length)));
        }
        return btoa(binario);
    }

    async function salvarBackupCompleto(blob, nomeArquivo) {
        if (window.AloNative && typeof window.AloNative.saveDocumentBase64 === 'function') {
            const resposta = window.AloNative.saveDocumentBase64(
                arrayBufferParaBase64Backup(await blob.arrayBuffer()),
                blob.type || 'application/json',
                nomeArquivo
            );
            let resultado;
            try {
                resultado = JSON.parse(resposta);
            } catch (_) {
                throw new Error('O Android não confirmou o salvamento do backup.');
            }
            if (!resultado.ok) {
                throw new Error(resultado.error || 'Não foi possível salvar o backup em Downloads.');
            }
            return { destino: 'android', nome: resultado.name || nomeArquivo };
        }

        baixarComoArquivo(blob, nomeArquivo);
        return { destino: 'navegador', nome: nomeArquivo };
    }

    function baixarComoArquivo(blob, nomeArquivo) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = nomeArquivo;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 1500);
    }

    function bancoPreparadoDoBackup(importedData) {
        const source = importedData.db && typeof importedData.db === 'object' ? importedData.db : importedData;
        if (!source || !Array.isArray(source.produtos)) throw new Error('O arquivo não contém um banco válido.');
        const current = db;
        const hasArray = key => Object.prototype.hasOwnProperty.call(source, key) && Array.isArray(source[key]);
        return {
            ...current,
            produtos: source.produtos,
            categorias: hasArray('categorias') ? source.categorias : current.categorias,
            obsPedidos: hasArray('obsPedidos') ? source.obsPedidos : current.obsPedidos,
            obsCancelamentos: hasArray('obsCancelamentos') ? source.obsCancelamentos : current.obsCancelamentos,
            areas: hasArray('areas') ? source.areas : current.areas,
            setoresTarefas: hasArray('setoresTarefas') ? source.setoresTarefas : current.setoresTarefas,
            funcionarios: hasArray('funcionarios') ? source.funcionarios : current.funcionarios,
            tarefas: hasArray('tarefas') ? source.tarefas : current.tarefas,
            coreCompartilhado: source.coreCompartilhado && typeof source.coreCompartilhado === 'object'
                ? source.coreCompartilhado
                : current.coreCompartilhado,
            configsTarefas: Object.prototype.hasOwnProperty.call(source, 'configsTarefas')
                ? { ...current.configsTarefas, ...(source.configsTarefas || {}) }
                : current.configsTarefas,
            configs: {
                ...current.configs,
                ...(source.configs || {}),
                url: current.configs.url,
                modo: current.configs.modo,
                areaAtual: current.configs.areaAtual,
                dadosBaixados: true,
                bancoPendente: false,
                revisaoBanco: Number(current.configs.revisaoBanco || 0)
            }
        };
    }

    function resumoBackup(importedData) {
        const source = importedData.db && typeof importedData.db === 'object' ? importedData.db : importedData;
        const orders = Array.isArray(importedData.pedidos) ? importedData.pedidos : [];
        return {
            produtos: Array.isArray(source.produtos) ? source.produtos.length : 0,
            categorias: Array.isArray(source.categorias) ? source.categorias.length : 0,
            areas: Array.isArray(source.areas) ? source.areas.length : 0,
            pedidos: orders.length
        };
    }

    function lerArquivoTexto(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = event => resolve(event.target.result);
            reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
            reader.readAsText(file);
        });
    }

    function separarModulosDoBackup(importedData) {
        if (importedData?.format === 'backup_completo' && importedData?.app === 'alo_cozinha') {
            return { kdsChecklist: importedData.kdsChecklist || null, compras: importedData.compras || null, l42: importedData.l42 || null, fichasTecnicas: importedData.fichasTecnicas || null, documentosChecklist: importedData.documentosChecklist || null, compartilhado: importedData.compartilhado || null, media: importedData.media || null, completo: true };
        }
        if (importedData?.app_id === 'alofeira') return { kdsChecklist: null, compras: importedData, l42: null, fichasTecnicas: null, documentosChecklist:null, compartilhado: null, completo: false };
        if (importedData?.formato === 'alo-etiqueta-backup-completo') return { kdsChecklist: null, compras: null, l42: importedData, fichasTecnicas: null, documentosChecklist:null, compartilhado: null, completo: false };
        return { kdsChecklist: importedData, compras: null, l42: null, fichasTecnicas: null, documentosChecklist:null, compartilhado: null, completo: false };
    }

    async function importarDadosFisicos(event) {
        const input = event.target;
        const file = input.files[0];
        if (!file) return;
        const button = document.getElementById('btnImportarBackup');
        const status = document.getElementById('statusImportacaoBackup');
        const originalText = button ? button.innerText : '';
        const etapasConcluidas = [];
        try {
            if (!db.configs.url || !ehUrlAppsScript(db.configs.url)) {
                throw new Error('Conecte a conta da nuvem antes de restaurar o backup.');
            }
            const importedData = JSON.parse(await lerArquivoTexto(file));
            const modulos = separarModulosDoBackup(importedData);
            if (!modulos.kdsChecklist && !modulos.compras && !modulos.l42 && !modulos.fichasTecnicas && !modulos.documentosChecklist) throw new Error('O arquivo não contém dados reconhecidos.');
            const summary = modulos.kdsChecklist ? resumoBackup(modulos.kdsChecklist) : { produtos: 0, categorias: 0, areas: 0, pedidos: 0 };
            const atividades = Array.isArray(modulos.kdsChecklist?.atividades) ? modulos.kdsChecklist.atividades : [];
            const comprasSummary = modulos.compras ? {
                produtos: Array.isArray(modulos.compras.produtos) ? modulos.compras.produtos.length : 0,
                operadores: Array.isArray(modulos.compras.colaboradores) ? modulos.compras.colaboradores.length : 0,
                pedidos: Array.isArray(modulos.compras.pedidosAtivos) ? modulos.compras.pedidosAtivos.filter(item => item?.status !== 'rascunho').length : 0
            } : null;
            const detalhes = [];
            if (modulos.kdsChecklist) detalhes.push(`KDS e Checklist: ${summary.produtos} produtos, ${summary.pedidos} pedidos e ${atividades.length} registros de atividades`);
            if (comprasSummary) detalhes.push(`Compras: ${comprasSummary.produtos} produtos, ${comprasSummary.operadores} operadores e ${comprasSummary.pedidos} pedidos`);
            const l42Dados = modulos.l42?.formato === 'alo-etiqueta-backup-completo' ? modulos.l42.dados : modulos.l42;
            if (l42Dados) detalhes.push(`Etiquetas: ${Array.isArray(l42Dados.produtos) ? l42Dados.produtos.length : 0} produtos e ${Array.isArray(l42Dados.historico) ? l42Dados.historico.length : 0} registros`);
            if (modulos.fichasTecnicas) detalhes.push(`Fichas Técnicas: ${Array.isArray(modulos.fichasTecnicas.sheets) ? modulos.fichasTecnicas.sheets.length : 0} fichas`);
            if (modulos.documentosChecklist) detalhes.push(`Documentos: ${Array.isArray(modulos.documentosChecklist.documents) ? modulos.documentosChecklist.documents.length : 0} cadastros`);
            const confirmed = await AloUiDialog.confirm(
                `${detalhes.join('. ')}. A URL atual será preservada e registros repetidos não serão duplicados.`,
                { title: modulos.completo ? 'Restaurar backup completo' : 'Restaurar backup', icon: '📥', confirmText: 'Restaurar na nuvem' }
            );
            if (!confirmed) return;

            if (button) { button.disabled = true; button.innerText = 'Restaurando...'; }
            if (status) status.innerText = 'Conferindo se todos os módulos estão prontos...';

            if (modulos.compras) {
                const comprasProntas = await AloFeiraModule.ensureCloudReady({ refresh: true });
                if (!comprasProntas?.ok) throw new Error('A Lista de Compras não confirmou a conexão com a nuvem. Nenhum dado foi alterado.');
            }

            if (status) status.innerText = 'Enviando e conferindo os módulos...';

            if (modulos.kdsChecklist) {
                const preparedBank = bancoPreparadoDoBackup(modulos.kdsChecklist);
                const currentBank = await AloApi.getBank(db.configs.url);
                if (!bancoNuvemValido(currentBank)) throw new Error('A nuvem não possui suporte à restauração deste backup.');
                if (atividades.length && !currentBank._capabilities?.atividadesBackup) {
                    throw new Error('A nuvem não confirmou suporte ao histórico do Checklist.');
                }
                const migrationId = `backup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
                const report = await AloApi.migrateBackup(db.configs.url, {
                    migrationId,
                    expectedRevision: Number(currentBank._revision || 0),
                    dados: dadosBancoParaNuvem(preparedBank),
                    pedidos: Array.isArray(modulos.kdsChecklist.pedidos) ? modulos.kdsChecklist.pedidos : [],
                    atividades
                });
                if (report.status === 'conflict') throw new Error('Os dados na nuvem mudaram durante a restauração. Abra novamente e repita a operação.');
                if (report.status !== 'ok') throw new Error(report.message || 'KDS e Checklist não foram confirmados pelo servidor.');

                db = preparedBank;
                db.configs.revisaoBanco = Number(report.bancoRevision || 0);
                db.configs.bancoPendente = false;
                pedidosCientes = new Set(Array.isArray(modulos.kdsChecklist.cientes) ? modulos.kdsChecklist.cientes : []);
                normalizarAreasERotas();
                normalizarSonsConfigurados();
                salvarBancoLocal();
                salvarHistoricoLocal();
                await restaurarFotosTarefasBackup(modulos.media?.taskPhotos);
                etapasConcluidas.push('KDS e Checklist');
            }

            if (modulos.compras) {
                await AloFeiraModule.restoreBackup(modulos.compras);
                etapasConcluidas.push('Compras');
            }

            if (modulos.l42) {
                await AloL42Module.restoreBackup(modulos.l42);
                etapasConcluidas.push('Etiquetas');
            }

            if (modulos.fichasTecnicas) {
                await AloTechnicalSheets.restoreBackupWithMedia(modulos.fichasTecnicas);
                AloTechnicalSheets.syncNow().catch(() => {});
                etapasConcluidas.push('Fichas Técnicas');
            }

            if (modulos.documentosChecklist) {
                await AloChecklistDocuments.restoreBackupWithMedia(modulos.documentosChecklist);
                AloChecklistDocuments.syncNow().catch(() => {});
                etapasConcluidas.push('Documentos do Checklist');
            }

            if (modulos.compartilhado) {
                await AloSharedData.restoreBackup(modulos.compartilhado);
                etapasConcluidas.push('Funcionários e acessos');
            } else {
                await AloSharedData.refreshSources({ includeFrames: true, push: true });
            }

            if (status) status.innerText = 'Restauração concluída e confirmada.';
            await AloUiDialog.notice(`${etapasConcluidas.join(' e ')} restaurado(s) e conferido(s) na nuvem.`, {
                title: 'Backup restaurado', icon: '✓', confirmText: 'Abrir aplicativo'
            });
            location.reload();
        } catch(err) {
            if (status) status.innerText = '';
            const parcial = etapasConcluidas.length ? ` ${etapasConcluidas.join(' e ')} já foi restaurado.` : '';
            await AloUiDialog.notice(`${err.message || 'Não foi possível ler ou restaurar o arquivo.'}${parcial}`, {
                title: 'Restauração não concluída', icon: '!', tone: 'danger', confirmText: 'Entendi'
            });
        } finally {
            input.value = '';
            if (button) { button.disabled = false; button.innerText = originalText; }
        }
    }

    function preencherConfiguracoesBasicas() {
        document.getElementById('configSenhaModo').value = db.configs.senhaModo || '';
        document.getElementById('configSomCozinha').value = db.configs.somCozinha || 'sem_som';
        document.getElementById('configSomPanelas').value = db.configs.somPanelas || 'sem_som';
        document.getElementById('configVolumeCozinha').value = db.configs.volumeCozinha || '100';
        document.getElementById('configVolumePanelas').value = db.configs.volumePanelas || '70';
        document.getElementById('configTelaAtiva').value = db.configs.telaAtiva || 'sim';
        document.getElementById('configInatividade').value = db.configs.inatividade || '0';
        document.getElementById('configReenvio').value = db.configs.reenvio || 'permitido';
        document.getElementById('configVirBuscarAtivo').checked = db.configs.virBuscarAtivo !== false;
        atualizarLabelsVolume();
    }

    function abrirConfiguracoesBasicas() {
        preencherConfiguracoesBasicas();
        fecharModal('modalPainelUnificado');
        fecharModal('modalConfigKds');
        abrirModalNoTopo('modalConfigBasicas');
    }

    function salvarConfiguracoesBasicas() {
        const configuracoesAnteriores = JSON.stringify(dadosBancoParaNuvem().configs);
        db.configs.senhaModo = document.getElementById('configSenhaModo').value;
        db.configs.somCozinha = document.getElementById('configSomCozinha').value;
        db.configs.somPanelas = document.getElementById('configSomPanelas').value;
        normalizarSonsConfigurados();
        db.configs.volumeCozinha = document.getElementById('configVolumeCozinha').value;
        db.configs.volumePanelas = document.getElementById('configVolumePanelas').value;
        db.configs.telaAtiva = document.getElementById('configTelaAtiva').value;
        db.configs.inatividade = document.getElementById('configInatividade').value;
        db.configs.reenvio = document.getElementById('configReenvio').value;
        db.configs.virBuscarAtivo = document.getElementById('configVirBuscarAtivo').checked;
        if(configuracoesAnteriores !== JSON.stringify(dadosBancoParaNuvem().configs)) marcarBancoAlterado();
        else salvarBancoLocal();

        solicitarWakeLock();
        resetInatividade();
        gerenciarAlarme();
        if(previewAudio) { previewAudio.pause(); }
        fecharModal('modalConfigBasicas');
        abrirModalNoTopo('modalConfigKds');
    }

    function cancelarConfiguracoesBasicas() {
        if(previewAudio) previewAudio.pause();
        fecharModal('modalConfigBasicas');
        abrirModalNoTopo('modalConfigKds');
    }

    function fecharPainelUnificado() {
        if(previewAudio) previewAudio.pause();
        fecharModal('modalPainelUnificado');
        if (sessaoAdministrativaAtiva) {
            sessaoAdministrativaAtiva = false;
            const comprasVisivel = document.getElementById('feiraModule')?.style.display !== 'none';
            if (comprasVisivel) AloTasks.showHome();
            else AloFeiraModule.logout().catch(() => {});
        }
    }

    function abrirMenuProdutos() {
        fecharModal('modalPainelUnificado');
        fecharModal('modalConfigKds');
        abrirModalNoTopo('modalMenuProdutos');
    }

    function voltarDoMenuProdutos() {
        fecharModal('modalMenuProdutos');
        abrirModalNoTopo('modalConfigKds');
    }

    let tipoGerenciamentoAtual = '';
    function voltarDaListagem() {
        fecharModal('modalListagem');
        if(['categorias', 'produtos', 'obsPedidos', 'obsCancelamentos'].includes(tipoGerenciamentoAtual)) abrirModalNoTopo('modalMenuProdutos');
        else abrirModalNoTopo('modalPainelUnificado');
    }

    let areasUnificadasAtuais = [];

    function escaparTextoHtml(valor) {
        return String(valor ?? '').replace(/[&<>'"]/g, caractere => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[caractere]);
    }

    function chaveNomeArea(nome) {
        const texto = String(nome || '').trim().toLocaleLowerCase('pt-BR');
        try { return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (error) { return texto; }
    }

    function obterAreasUnificadas() {
        const grupos = new Map();
        const garantirGrupo = (nome, emoji) => {
            const chave = chaveNomeArea(nome);
            if (!grupos.has(chave)) grupos.set(chave, { chave, nome, emoji: emoji || '📍', kds: null, checklist: null });
            return grupos.get(chave);
        };
        (db.areas || []).forEach(area => {
            const grupo = garantirGrupo(area.nome, area.emoji);
            grupo.kds = area;
            grupo.nome = area.nome;
            grupo.emoji = area.emoji || grupo.emoji;
        });
        (db.setoresTarefas || []).forEach(setor => {
            const grupo = garantirGrupo(setor.nome, setor.emoji);
            grupo.checklist = setor;
            if (!grupo.kds) {
                grupo.nome = setor.nome;
                grupo.emoji = setor.emoji || grupo.emoji;
            }
        });
        return Array.from(grupos.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }

    function renderizarAreasUnificadas(lista) {
        areasUnificadasAtuais = obterAreasUnificadas();
        lista.innerHTML = areasUnificadasAtuais.map((grupo, index) => {
            const modulos = [];
            if (grupo.kds) modulos.push(`KDS · ${grupo.kds.tipo === 'envio' ? 'envia pedidos' : 'recebe pedidos'}`);
            if (grupo.checklist && grupo.checklist.ativo !== false) modulos.push('Checklist');
            const resumo = modulos.length ? modulos.join(' · ') : 'Sem módulo ativo';
            return `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${getEmojiAreaHtml(grupo.emoji)} ${escaparTextoHtml(grupo.nome)}</strong><br><span style="color:#666">${escaparTextoHtml(resumo)}</span></div><div class="gerenciar-actions"><button onclick="abrirFormArea(${index})" title="Editar">✏️</button><button onclick="excluirArea(${index})" title="Excluir">🗑️</button></div></div>`;
        }).join('');
        if (!lista.innerHTML) lista.innerHTML = '<div style="padding:18px 4px; color:#66747d; text-align:center;">Nenhum setor cadastrado.</div>';
    }

    function salvarSenhaSeguranca() {
        const novaSenha = document.getElementById('configSenhaSeguranca').value.trim();
        const feedback = document.getElementById('configSenhaFeedback');
        if (novaSenha === (db.configs.senhaSeguranca || '')) {
            feedback.style.color = '#607d8b';
            feedback.innerText = 'A senha de segurança não foi alterada.';
            return;
        }
        db.configs.senhaSeguranca = novaSenha;
        marcarBancoAlterado();
        feedback.style.color = '#2e7d32';
        feedback.innerText = novaSenha ? 'Senha de segurança salva no banco de dados.' : 'Senha removida. O aplicativo está sem senha de segurança.';
    }

    function moverItem(tipo, index, direcao) { const lista = tipo === 'produtos' ? db.produtos : (tipo === 'categorias' ? db.categorias : (tipo === 'obsPedidos' ? db.obsPedidos : db.obsCancelamentos)); if(direcao === 'cima' && index > 0) { const temp = lista[index]; lista[index] = lista[index - 1]; lista[index - 1] = temp; } else if (direcao === 'baixo' && index < lista.length - 1) { const temp = lista[index]; lista[index] = lista[index + 1]; lista[index + 1] = temp; } marcarBancoAlterado(); iniciar(); abrirGerenciar(tipo); }

    function abrirGerenciar(tipo) {
        tipoGerenciamentoAtual = tipo;
        fecharModal('modalPainelUnificado'); fecharModal('modalConfigKds'); fecharModal('modalMenuProdutos'); fecharModal('modalFormProduto'); fecharModal('modalFormCategoria'); fecharModal('modalFormArea');
        const lista = document.getElementById('conteudoListagem'); const btnNovo = document.getElementById('btnNovoListagem'); const titulo = document.getElementById('tituloListagem'); lista.innerHTML = '';
        if (tipo === 'areas') {
            titulo.innerText = 'Setores do Estabelecimento';
            btnNovo.onclick = () => abrirFormArea(-1);
            renderizarAreasUnificadas(lista);
            document.getElementById('modalListagem').style.display = 'flex';
            return;
        }
        if(tipo === 'produtos') { titulo.innerText = "Gerenciar Produtos"; btnNovo.onclick = () => abrirFormProduto(-1); db.produtos.forEach((p, idx) => { const origens = getAreasOrigemProduto(p).map(getAreaNome).join(', '); lista.innerHTML += `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${p.nome}</strong><br><span style="color:#666">${p.categoria} · ${origens} → ${getAreaNome(p.areaDestino || 'cozinha')}</span></div><div class="gerenciar-actions"><button onclick="moverItem('produtos', ${idx}, 'cima')">🔼</button><button onclick="moverItem('produtos', ${idx}, 'baixo')">🔽</button><button onclick="abrirFormProduto(${idx})">✏️</button><button onclick="excluirItem('produtos', ${idx})">🗑️</button></div></div>`; }); } else if (tipo === 'categorias') { titulo.innerText = "Gerenciar Categorias"; btnNovo.onclick = () => abrirFormCategoria(-1); db.categorias.forEach((c, idx) => { lista.innerHTML += `<div class="gerenciar-item"><div class="gerenciar-info"><span class="color-preview" style="background:${c.cor}; color:${c.corTexto}">${c.nome}</span></div><div class="gerenciar-actions"><button onclick="moverItem('categorias', ${idx}, 'cima')">🔼</button><button onclick="moverItem('categorias', ${idx}, 'baixo')">🔽</button><button onclick="abrirFormCategoria(${idx})">✏️</button><button onclick="excluirItem('categorias', '${c.nome}')">🗑️</button></div></div>`; }); } else if (tipo === 'obsPedidos') { titulo.innerText = "Observação dos Produtos"; btnNovo.onclick = () => novaObservacao('obsPedidos'); db.obsPedidos.forEach((obs, idx) => { lista.innerHTML += `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${obs}</strong></div><div class="gerenciar-actions"><button onclick="moverItem('obsPedidos', ${idx}, 'cima')">🔼</button><button onclick="moverItem('obsPedidos', ${idx}, 'baixo')">🔽</button><button onclick="excluirItem('obsPedidos', '${obs}')">🗑️</button></div></div>`; }); } else if (tipo === 'obsCancelamentos') { titulo.innerText = "Motivos Cancelamento"; btnNovo.onclick = () => novaObservacao('obsCancelamentos'); db.obsCancelamentos.forEach((obs, idx) => { lista.innerHTML += `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${obs}</strong></div><div class="gerenciar-actions"><button onclick="moverItem('obsCancelamentos', ${idx}, 'cima')">🔼</button><button onclick="moverItem('obsCancelamentos', ${idx}, 'baixo')">🔽</button><button onclick="excluirItem('obsCancelamentos', '${obs}')">🗑️</button></div></div>`; }); }
        document.getElementById('modalListagem').style.display = 'flex';
    }

    async function novaObservacao(tipo) {
        const isProductNote = tipo === 'obsPedidos';
        const obs = await AloUiDialog.prompt(isProductNote ? 'Cadastre uma observação que poderá ser usada nos pedidos.' : 'Cadastre um motivo para o cancelamento.', {
            title: isProductNote ? 'Nova observação' : 'Novo motivo',
            icon: isProductNote ? '💬' : '🗑️',
            inputLabel: isProductNote ? 'Observação' : 'Motivo do cancelamento',
            placeholder: isProductNote ? 'Ex: Sem cebola' : 'Ex: Produto indisponível'
        });
        if(obs) { db[tipo].push(obs); marcarBancoAlterado(); abrirGerenciar(tipo); }
    }
    async function excluirItem(tipo, id) {
        const confirmed = await AloUiDialog.confirm('Este cadastro será removido. Deseja continuar?', {
            title: 'Excluir cadastro', icon: '🗑️', tone: 'danger', confirmText: 'Excluir'
        });
        if(!confirmed) return;
        if(tipo === 'produtos') db.produtos.splice(id, 1);
        if(tipo === 'categorias') db.categorias = db.categorias.filter(i => i.nome !== id);
        if(tipo === 'obsPedidos') db.obsPedidos = db.obsPedidos.filter(i => i !== id);
        if(tipo === 'obsCancelamentos') db.obsCancelamentos = db.obsCancelamentos.filter(i => i !== id);
        marcarBancoAlterado(); iniciar(); abrirGerenciar(tipo);
    }

    function abrirFormProduto(idx) {
        fecharModal('modalListagem');
        const combo = document.getElementById('prodCategoria'); combo.innerHTML = '';
        db.categorias.forEach(c => combo.innerHTML += `<option value="${c.nome}">${c.nome}</option>`);
        const comboDestino = document.getElementById('prodAreaDestino');
        comboDestino.innerHTML = db.areas.filter(area => area.tipo === 'recebimento').map(area => `<option value="${area.id}">${getAreaEmojiText(area.emoji)} ${area.nome}</option>`).join('');
        let origensSelecionadas = [];
        if(idx >= 0) {
            const p = db.produtos[idx];
            document.getElementById('prodIndexOriginal').value = idx;
            document.getElementById('prodNome').value = p.nome;
            document.getElementById('prodCategoria').value = p.categoria;
            origensSelecionadas = getAreasOrigemProduto(p);
            comboDestino.value = p.areaDestino || 'cozinha';
            document.getElementById('prodObsEspec').value = p.obsEspec ? p.obsEspec.join(', ') : '';
        } else {
            document.getElementById('prodIndexOriginal').value = '-1';
            document.getElementById('prodNome').value = '';
            origensSelecionadas = [getAreaAtual().tipo === 'envio' ? getAreaAtual().id : 'panelas'];
            comboDestino.value = 'cozinha';
            document.getElementById('prodObsEspec').value = '';
        }
        document.getElementById('prodAreasOrigem').innerHTML = db.areas.filter(area => area.tipo === 'envio').map(area => `
            <label class="area-switch-row">
                <span class="area-switch-identidade"><span class="area-switch-emoji">${getEmojiAreaHtml(area.emoji)}</span><span>${area.nome}</span></span>
                <span class="switch-moderno">
                    <input class="area-origem-checkbox" type="checkbox" value="${area.id}" ${origensSelecionadas.includes(area.id) ? 'checked' : ''}>
                    <span class="switch-trilho"></span>
                </span>
            </label>
        `).join('');
        document.getElementById('modalFormProduto').style.display = 'flex';
    }

    function salvarProduto() {
        const idx = parseInt(document.getElementById('prodIndexOriginal').value);
        const nome = document.getElementById('prodNome').value.trim();
        const cat = document.getElementById('prodCategoria').value;
        const obsStr = document.getElementById('prodObsEspec').value;
        const areasOrigem = Array.from(document.querySelectorAll('#prodAreasOrigem .area-origem-checkbox:checked')).map(input => input.value);
        const areaDestino = document.getElementById('prodAreaDestino').value;
        const obsArray = obsStr.split(',').map(s => s.trim()).filter(s => s !== '');

        if(!nome || !cat) return alert("Preencha o nome e a categoria!");
        if(!areasOrigem.length) return alert("Escolha pelo menos uma área que envia o pedido.");
        const areaOrigem = areasOrigem[0];
        if(idx >= 0) {
            db.produtos[idx] = { nome: nome, categoria: cat, obsEspec: obsArray, areasOrigem, areaOrigem, areaDestino };
        } else {
            db.produtos.push({ nome: nome, categoria: cat, obsEspec: obsArray, areasOrigem, areaOrigem, areaDestino });
        }
        marcarBancoAlterado(); iniciar(); abrirGerenciar('produtos');
    }

    function abrirFormArea(idx) {
        fecharModal('modalListagem');
        prepararSeletorImagensArea();
        const grupo = idx >= 0 ? areasUnificadasAtuais[idx] : null;
        const kds = grupo?.kds || null;
        const checklist = grupo?.checklist || null;
        document.getElementById('areaIndexOriginal').value = idx;
        document.getElementById('areaKdsIdOriginal').value = kds?.id || '';
        document.getElementById('areaChecklistIdOriginal').value = checklist?.id || '';
        document.getElementById('areaNome').value = grupo?.nome || '';
        document.getElementById('areaEmoji').value = grupo?.emoji || '🧑‍🍳';
        selecionarEmojiArea(document.getElementById('areaEmoji').value);
        document.getElementById('areaTipo').value = kds?.tipo || 'envio';
        const moduloKds = document.getElementById('areaModuloKds');
        moduloKds.checked = Boolean(kds);
        moduloKds.disabled = Boolean(kds && (kds.id === 'panelas' || kds.id === 'cozinha'));
        document.getElementById('areaModuloChecklist').checked = Boolean(checklist && checklist.ativo !== false);
        alternarCamposAreaModulo();
        document.getElementById('modalFormArea').style.display = 'flex';
        setTimeout(() => document.getElementById('areaNome').focus(), 80);
    }

    function selecionarEmojiArea(emoji) {
        document.getElementById('areaEmoji').value = emoji;
        const current = document.getElementById('areaImageCurrent');
        if (current) current.innerHTML = getEmojiAreaHtml(emoji);
        document.querySelectorAll('[data-area-image]').forEach(button => button.classList.toggle('selected', button.dataset.areaImage === emoji));
        toggleSeletorImagemArea(false);
    }

    function prepararSeletorImagensArea() {
        const target = document.getElementById('areaImageOptionsGrid');
        if (target && !target.children.length) {
            document.querySelectorAll('#modalFormArea .emoji-area-opcoes button').forEach(button => target.appendChild(button));
        }
        const current = document.getElementById('areaImageCurrent');
        if (!current || current.dataset.pickerReady === '1') return;
        current.dataset.pickerReady = '1';
        current.setAttribute('role', 'button');
        current.setAttribute('tabindex', '0');
        current.setAttribute('aria-haspopup', 'dialog');
        current.setAttribute('aria-label', 'Escolher imagem do setor');
        current.addEventListener('click', () => toggleSeletorImagemArea());
        current.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggleSeletorImagemArea();
        });
    }

    function toggleSeletorImagemArea(requested) {
        const picker = document.getElementById('modalAreaImagePicker');
        const current = document.getElementById('areaImageCurrent');
        if (!picker) return;
        const open = requested === undefined ? picker.style.display !== 'flex' : Boolean(requested);
        picker.style.display = open ? 'flex' : 'none';
        if (current) current.setAttribute('aria-expanded', String(open));
    }

    function alternarCamposAreaModulo() {
        const ativo = document.getElementById('areaModuloKds').checked;
        document.getElementById('areaTipoGrupo').style.display = ativo ? 'block' : 'none';
    }

    function salvarArea() {
        const nome = document.getElementById('areaNome').value.trim();
        const emoji = document.getElementById('areaEmoji').value.trim();
        const tipo = document.getElementById('areaTipo').value;
        const usarKds = document.getElementById('areaModuloKds').checked;
        const usarChecklist = document.getElementById('areaModuloChecklist').checked;
        const kdsId = document.getElementById('areaKdsIdOriginal').value;
        const checklistId = document.getElementById('areaChecklistIdOriginal').value;
        if (!nome) return alert('Preencha o nome do setor.');
        if (!emoji) return alert('Escolha uma imagem para o setor.');
        if (!usarKds && !usarChecklist) return alert('Ative o setor no KDS, no Checklist ou nos dois.');
        const duplicado = obterAreasUnificadas().some(grupo => grupo.chave === chaveNomeArea(nome)
            && grupo.kds?.id !== kdsId && grupo.checklist?.id !== checklistId);
        if (duplicado) return alert('Já existe um setor com esse nome. Edite o cadastro existente para ativar outro módulo.');

        const indiceKds = db.areas.findIndex(area => area.id === kdsId);
        const areaKdsAtual = indiceKds >= 0 ? db.areas[indiceKds] : null;
        if (usarKds) {
            if (areaKdsAtual) {
                if ((areaKdsAtual.id === 'panelas' || areaKdsAtual.id === 'cozinha') && areaKdsAtual.tipo !== tipo) return alert('A função das áreas padrão não pode ser alterada.');
                const emUso = db.produtos.some(produto => getAreasOrigemProduto(produto).includes(areaKdsAtual.id) || produto.areaDestino === areaKdsAtual.id);
                if (emUso && areaKdsAtual.tipo !== tipo) return alert('Este setor está ligado a produtos. Altere primeiro a rota desses produtos.');
                db.areas[indiceKds] = { ...areaKdsAtual, nome, tipo, emoji };
            } else {
                db.areas.push({ id: `area_${Date.now()}`, nome, tipo, emoji });
            }
        } else if (areaKdsAtual) {
            if (areaKdsAtual.id === 'panelas' || areaKdsAtual.id === 'cozinha') return alert('Panelas e Cozinha precisam permanecer ativas no KDS.');
            const emUso = db.produtos.some(produto => getAreasOrigemProduto(produto).includes(areaKdsAtual.id) || produto.areaDestino === areaKdsAtual.id);
            if (emUso) return alert('Este setor ainda está ligado a produtos do KDS. Altere primeiro a rota desses produtos.');
            db.areas.splice(indiceKds, 1);
            if (db.configs.areaAtual === areaKdsAtual.id) db.configs.areaAtual = 'panelas';
        }

        const indiceChecklist = db.setoresTarefas.findIndex(setor => setor.id === checklistId);
        const setorChecklistAtual = indiceChecklist >= 0 ? db.setoresTarefas[indiceChecklist] : null;
        if (usarChecklist) {
            const valor = { ...(setorChecklistAtual || {}), id: setorChecklistAtual?.id || `setor_${Date.now()}`, nome, emoji, ativo: true };
            if (indiceChecklist >= 0) db.setoresTarefas[indiceChecklist] = valor;
            else db.setoresTarefas.push(valor);
        } else if (setorChecklistAtual) {
            db.setoresTarefas[indiceChecklist] = { ...setorChecklistAtual, nome, emoji, ativo: false };
        }

        normalizarAreasERotas();
        marcarBancoAlterado();
        iniciar();
        window.AloTasks?.refreshDefinitions();
        abrirGerenciar('areas');
    }

    async function excluirArea(idx) {
        const grupo = areasUnificadasAtuais[idx];
        if (!grupo) return;
        if (grupo.kds && (grupo.kds.id === 'panelas' || grupo.kds.id === 'cozinha')) return alert('Panelas e Cozinha não podem ser excluídas. Você pode desativar apenas o Checklist ao editar.');
        if (grupo.kds && db.produtos.some(produto => getAreasOrigemProduto(produto).includes(grupo.kds.id) || produto.areaDestino === grupo.kds.id)) return alert('Este setor está ligado a produtos do KDS. Altere primeiro a rota desses produtos.');
        if (grupo.checklist && db.tarefas.some(tarefa => tarefa.setorId === grupo.checklist.id)) return alert('Este setor está ligado a tarefas. Desative-o no Checklist ou altere primeiro essas tarefas.');
        if (grupo.checklist && db.funcionarios.some(funcionario => funcionario.setorId === grupo.checklist.id || (Array.isArray(funcionario.setorIds) && funcionario.setorIds.map(String).includes(String(grupo.checklist.id))))) return alert('Este setor está ligado a funcionários. Altere primeiro os setores desses funcionários.');
        const confirmed = await AloUiDialog.confirm(`Excluir o setor “${grupo.nome}” dos módulos?`, {
            title: 'Excluir setor', icon: '🗑️', tone: 'danger', confirmText: 'Excluir setor'
        });
        if (!confirmed) return;
        if (grupo.kds) db.areas = db.areas.filter(area => area.id !== grupo.kds.id);
        if (grupo.checklist) db.setoresTarefas = db.setoresTarefas.filter(setor => setor.id !== grupo.checklist.id);
        normalizarAreasERotas();
        marcarBancoAlterado();
        iniciar();
        window.AloTasks?.refreshDefinitions();
        abrirGerenciar('areas');
    }

    function abrirFormCategoria(idx) { fecharModal('modalListagem'); if(idx >= 0) { const c = db.categorias[idx]; document.getElementById('catIndexOriginal').value = idx; document.getElementById('catNome').value = c.nome; document.getElementById('catCor').value = c.cor; document.getElementById('catCorTexto').value = c.corTexto || '#000000'; } else { document.getElementById('catIndexOriginal').value = '-1'; document.getElementById('catNome').value = ''; document.getElementById('catCor').value = '#1976D2'; document.getElementById('catCorTexto').value = '#ffffff'; } document.getElementById('modalFormCategoria').style.display = 'flex'; }
    function salvarCategoria() { const idx = parseInt(document.getElementById('catIndexOriginal').value); const nome = document.getElementById('catNome').value.trim(); const cor = document.getElementById('catCor').value; const corTexto = document.getElementById('catCorTexto').value; if(!nome) return alert("Preencha o nome!"); if(idx >= 0) { const nomeAntigo = db.categorias[idx].nome; db.categorias[idx] = { nome, cor, corTexto }; db.produtos.forEach(p => { if(p.categoria === nomeAntigo) p.categoria = nome; }); } else { db.categorias.push({ nome, cor, corTexto }); } marcarBancoAlterado(); iniciar(); abrirGerenciar('categorias'); }

    async function confirmarSenhaAdmin() {
        const select = document.getElementById('operadorAdmin');
        const input = document.getElementById('senhaAdmin');
        const button = document.getElementById('btnConfirmarLoginOperador');
        if (!select.value) {
            const feedback = document.getElementById('erroSenhaAdmin');
            feedback.innerText = 'Selecione a pessoa.';
            select.focus();
            return;
        }
        button.disabled = true;
        try {
            const resultado = await AloSharedData.authenticate(select.value, input.value);
            if (!resultado?.ok) {
                senhaIncorreta('senhaAdmin', 'erroSenhaAdmin');
                limparPinAdmin();
                return;
            }
            localStorage.setItem(ULTIMO_OPERADOR_LOGIN_KEY, resultado.operador.id);
            const acessoOperacional = ['kds_modulo', 'trocar_kds', 'checklist_modulo', 'trocar_checklist', 'checklist_acesso', 'compras_modulo', 'trocar_compras', 'l42_modulo', 'trocar_l42'].includes(destinoLoginOperador);
            const podeConfigurar = acessoOperacional
                || (destinoLoginOperador === 'kds' && resultado.operador.podeConfigurarKds)
                || (destinoLoginOperador === 'tasks' && resultado.operador.podeConfigurarChecklist)
                || (destinoLoginOperador === 'etiquetas' && resultado.operador.podeConfigurarEtiquetas)
                || (['painel', 'compras'].includes(destinoLoginOperador) && resultado.operador.isAdmin);
            if (!podeConfigurar) {
                const modulo = destinoLoginOperador === 'kds' ? 'KDS' : (destinoLoginOperador === 'tasks' ? 'Checklist' : 'Alô Cozinha');
                document.getElementById('erroSenhaAdmin').innerText = `Esta pessoa não tem acesso às configurações do ${modulo}.`;
                limparPinAdmin();
                return;
            }

            input.blur();
            fecharModal('modalLoginAdmin');
            limparPinAdmin();
            limparErroSenha('erroSenhaAdmin');
            if (destinoLoginOperador === 'compras_modulo' || destinoLoginOperador === 'trocar_compras') {
                await AloSharedData.activateForModule('compras', resultado.operador.id);
                sessaoCompras = resultado.operador;
                atualizarEngrenagensDaSessao();
                AloFeiraModule.refreshHeader();
                if (destinoLoginOperador === 'compras_modulo') AloTasks.openModule('feira');
                return;
            }
            if (destinoLoginOperador === 'kds_modulo' || destinoLoginOperador === 'trocar_kds') {
                sessaoKds = resultado.operador;
                atualizarEngrenagensDaSessao();
                if (destinoLoginOperador === 'kds_modulo') AloTasks.openModule('kds');
                return;
            }
            if (destinoLoginOperador === 'checklist_modulo' || destinoLoginOperador === 'trocar_checklist') {
                sessaoChecklist = resultado.operador;
                atualizarEngrenagensDaSessao();
                if (destinoLoginOperador === 'checklist_modulo') AloTasks.openModule('tasks');
                return;
            }
            if (destinoLoginOperador === 'checklist_acesso') {
                sessaoChecklist = resultado.operador;
                atualizarEngrenagensDaSessao();
                abrirVisaoChecklistProtegida();
                return;
            }
            if (destinoLoginOperador === 'l42_modulo' || destinoLoginOperador === 'trocar_l42') {
                await AloSharedData.activateForModule('l42', resultado.operador.id);
                sessaoL42 = resultado.operador;
                atualizarEngrenagensDaSessao();
                if (destinoLoginOperador === 'l42_modulo') {
                    AloTasks.openModule('l42');
                    if (etiquetaPendenteFicha) {
                        const pending = etiquetaPendenteFicha;
                        etiquetaPendenteFicha = null;
                        await AloL42Module.openProductForPrint(pending);
                    }
                }
                return;
            }
            if (destinoLoginOperador === 'painel') sessaoAdministrativaAtiva = true;
            abrirDestinoConfiguracoes();
        } catch (error) {
            document.getElementById('erroSenhaAdmin').innerText = error.message || 'Não foi possível entrar.';
        } finally {
            button.disabled = false;
        }
    }

    function atualizarPinAdminVisual() {
        const value = document.getElementById('senhaAdmin')?.value || '';
        const dots = document.getElementById('pinAdminDots');
        if (dots) dots.innerHTML = '<i></i>'.repeat(value.length);
        limparErroSenha('erroSenhaAdmin');
    }

    function digitarPinAdmin(numero) {
        const input = document.getElementById('senhaAdmin');
        if (!input || input.value.length >= 12) return;
        input.value += String(numero).replace(/\D/g, '');
        atualizarPinAdminVisual();
    }

    function apagarPinAdmin() {
        const input = document.getElementById('senhaAdmin');
        if (!input) return;
        input.value = input.value.slice(0, -1);
        atualizarPinAdminVisual();
    }

    function limparPinAdmin() {
        const input = document.getElementById('senhaAdmin');
        if (input) input.value = '';
        atualizarPinAdminVisual();
    }

    function prepararTecladoPinAdmin() {
        const keypad = document.getElementById('pinAdminKeypad');
        if (!keypad || keypad.dataset.fastInput === '1') return;
        keypad.dataset.fastInput = '1';
        const activate = button => {
            if (button.dataset.pinKey !== undefined) digitarPinAdmin(button.dataset.pinKey);
            else if (button.dataset.pinAction === 'clear') limparPinAdmin();
            else if (button.dataset.pinAction === 'backspace') apagarPinAdmin();
        };
        keypad.addEventListener('pointerdown', event => {
            const button = event.target.closest('button');
            if (!button || !keypad.contains(button)) return;
            event.preventDefault();
            button.dataset.lastPointerInput = String(Date.now());
            activate(button);
        }, { passive:false });
        keypad.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button || !keypad.contains(button)) return;
            event.preventDefault();
            if (Date.now() - Number(button.dataset.lastPointerInput || 0) < 600) return;
            activate(button);
        });
    }

    function instalarProtecaoRolagemModais() {
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            if (overlay.dataset.scrollGuard === '1') return;
            overlay.dataset.scrollGuard = '1';
            overlay.addEventListener('touchmove', event => {
                if (event.target === overlay) event.preventDefault();
            }, { passive:false });
            overlay.addEventListener('wheel', event => {
                if (event.target === overlay) event.preventDefault();
            }, { passive:false });
        });
    }

    function confirmarSenhaAvancada() {
        const input = document.getElementById('senhaAvancada');
        if (!db.configs.senhaSeguranca || input.value !== db.configs.senhaSeguranca) {
            return senhaIncorreta('senhaAvancada', 'erroSenhaAvancada');
        }
        input.blur();
        fecharModal('modalSenhaAvancada');
        input.value = '';
        limparErroSenha('erroSenhaAvancada');
        abrirConfiguracoesAvancadas();
    }

    function encerrarSessaoModulo(modulo) {
        if (modulo === 'feira' || modulo === 'compras') {
            sessaoCompras = null;
            atualizarEngrenagensDaSessao();
            AloSharedData.logoutModule('compras').catch(() => {});
            return;
        }
        if (modulo === 'l42') {
            sessaoL42 = null;
            atualizarEngrenagensDaSessao();
            AloSharedData.logoutModule('l42').catch(() => {});
            return;
        }
        if (modulo === 'kds') {
            sessaoKds = null;
            atualizarEngrenagensDaSessao();
            return;
        }
        if (modulo === 'tasks' || modulo === 'checklist') {
            sessaoChecklist = null;
            destinoChecklistProtegido = '';
            atualizarEngrenagensDaSessao();
        }
    }

    let syncConfiavel = null;
    window.addEventListener('alo:cloud-change', event => {
        const module = String(event.detail?.module || '');
        if (module === 'kds') syncConfiavel?.syncNow?.(false, true);
        if (module === 'catalog') agendarSincronizacaoBanco(0);
    });
    window.addEventListener('alo:cloud-ready', event => {
        const endpoint = String(event.detail?.endpoint || window.AloCloud?.getEndpoint?.() || '');
        if (!endpoint) return;
        db.configs.url = endpoint;
        window.AloFeiraModule?.syncServerUrl?.();
        agendarIntegracaoInicialDaNuvem(0);
    });
    let bancoSyncTimer = null;
    let bancoSyncEmAndamento = false;
    let bancoSyncErro = '';
    let bancoSyncFalhas = 0;
    let integracaoInicialTimer = null;
    let fontesCompartilhadasIntegradas = false;

    async function integrarFontesCompartilhadas() {
        if (fontesCompartilhadasIntegradas || !window.AloSharedData) return true;
        await AloSharedData.refreshSources({ includeFrames: true, push: true });
        fontesCompartilhadasIntegradas = true;
        return true;
    }

    function agendarIntegracaoInicialDaNuvem(tentativa = 0) {
        if (fontesCompartilhadasIntegradas || integracaoInicialTimer) return;
        const atraso = tentativa === 0 ? 0 : Math.min(2000, 250 * tentativa);
        integracaoInicialTimer = setTimeout(async () => {
            integracaoInicialTimer = null;
            if (bancoSyncEmAndamento) {
                agendarIntegracaoInicialDaNuvem(tentativa + 1);
                return;
            }
            const confirmado = await sincronizarBancoAutomaticamente({ preferirNuvem: true });
            if (confirmado) {
                integrarFontesCompartilhadas().catch(error => console.warn('Integração dos dados:', error));
            } else if (tentativa < 4 && navigator.onLine) {
                agendarIntegracaoInicialDaNuvem(tentativa + 1);
            }
        }, atraso);
    }

    function atualizarIndicadorSincronizacao(estado) {
        estadoSyncPedidosAtual = estado || estadoSyncPedidosAtual;
        const indicador = document.getElementById('indicadorConexao');
        if (!indicador) return;
        const pendingPedidos = Number(estadoSyncPedidosAtual.pendingCount || 0);
        if (window.AloDemo?.isActive?.()) {
            indicador.className = 'app-sync-indicator sincronizado';
            indicador.title = pendingPedidos ? 'Alterações salvas nesta demonstração' : 'Demonstração pronta';
            indicador.setAttribute('aria-label', indicador.title);
            return;
        }
        if (!db.configs.url) {
            indicador.className = 'app-sync-indicator offline';
            indicador.title = 'Nuvem não configurada';
            indicador.setAttribute('aria-label', indicador.title);
            return;
        }
        if (pendingPedidos > 0) {
            indicador.className = `app-sync-indicator ${estadoSyncPedidosAtual.online ? 'sincronizando' : 'offline'}`;
            indicador.title = estadoSyncPedidosAtual.online ? `${pendingPedidos} operação(ões) aguardando confirmação` : `${pendingPedidos} operação(ões) aguardando internet`;
            indicador.setAttribute('aria-label', indicador.title);
            return;
        }
        if (db.configs.bancoPendente) {
            const publicacaoComErro = Boolean(bancoSyncErro);
            indicador.className = `app-sync-indicator ${estadoSyncPedidosAtual.online && !publicacaoComErro ? 'sincronizando' : 'offline'}`;
            indicador.title = estadoSyncPedidosAtual.online
                ? (bancoSyncErro ? 'Configurações aguardando nova tentativa; pedidos conectados' : 'Publicando cardápio e configurações')
                : 'Alterações aguardando internet';
            indicador.setAttribute('aria-label', indicador.title);
            return;
        }
        indicador.className = `app-sync-indicator ${estadoSyncPedidosAtual.online ? 'sincronizado' : 'offline'}`;
        indicador.title = estadoSyncPedidosAtual.online ? 'Sincronizado' : 'Sem conexão';
        indicador.setAttribute('aria-label', indicador.title);
    }

    async function tentarSincronizarAgora() {
        if (window.AloDemo?.isActive?.()) {
            await AloUiDialog.notice('Os dados fictícios já estão salvos nesta demonstração.', {
                title:'Modo Demonstração', confirmText:'Entendi'
            });
            return;
        }
        if (!db.configs.url) {
            await AloUiDialog.notice('Configure a URL da nuvem nas Configurações Avançadas.', {
                title:'Nuvem não configurada', icon:'!', confirmText:'Entendi'
            });
            return;
        }
        if (syncConfiavel) await syncConfiavel.retryNow();
        await sincronizarBancoAutomaticamente();
    }

    function aplicarPedidosSincronizados(novosPedidos) {
        pedidosServidor = novosPedidos;
        pedidosServidor.forEach(pedido => {
            if (pedido.alertaReconhecidoEm) pedidosCientes.add(String(pedido.id));
            else if (pedido.status === 'buscar' || pedido.status === 'cancelado') pedidosCientes.delete(String(pedido.id));
        });
        salvarHistoricoLocal();
        if (db.configs.modo === 'cozinha') renderizarListaCozinha();
        else renderizarUltimosPedidos();
        gerenciarAlarme();
    }

    tocarPreview = function(selectId) { AloAudio.previewSound(selectId); };
    atualizarLabelsVolume = function() { AloAudio.updateVolumeLabels(); };
    normalizarSom = function(valor, fallback) { return AloAudio.normalize(valor, fallback); };
    normalizarSonsConfigurados = function() {
        db.configs.somCozinha = AloAudio.normalize(db.configs.somCozinha || 'sem_som', 'sirene_cozinha');
        db.configs.somPanelas = AloAudio.normalize(db.configs.somPanelas || 'sem_som', 'beep');
    };
    gerenciarAlarme = function() {
        AloAudio.manage({ mode: db.configs.modo, configs: db.configs, orders: pedidosDaAreaAtual(), knownIds: pedidosCientes });
    };
    pararAlarme = function() { AloAudio.stop(); };

    syncGeral = async function(forcarAtualizacao = false) {
        if (syncConfiavel) await syncConfiavel.syncNow(true, Boolean(forcarAtualizacao));
    };
    processarFilaRetentativas = async function() {
        if (syncConfiavel) await syncConfiavel.syncNow(true);
    };
    alterarStatusPedido = async function(id, novoStatus, motivo = '') {
        pedidosBloqueados.add(String(id));
        if (!syncConfiavel) {
            pedidosBloqueados.delete(String(id));
            alert('O armazenamento do aplicativo ainda está iniciando. Toque novamente.');
            return;
        }
        try {
            await syncConfiavel.enqueueStatus(String(id), novoStatus, motivo);
            aplicarPedidosSincronizados(syncConfiavel.orders);
        } catch (error) {
            alert('Não foi possível guardar essa alteração neste aparelho. Toque novamente.');
        } finally {
            setTimeout(() => pedidosBloqueados.delete(String(id)), 15000);
        }
    };

    async function excluirPedidoConfiavel(id) {
        if (!syncConfiavel) return alert('O armazenamento do aplicativo ainda está iniciando. Tente novamente.');
        try {
            await syncConfiavel.enqueueDelete(String(id));
            aplicarPedidosSincronizados(syncConfiavel.orders);
            abrirHistorico();
        } catch (error) {
            alert('Não foi possível guardar a exclusão. O pedido foi preservado; tente novamente.');
        }
    }

    async function excluirHojeConfiavel() {
        if (!syncConfiavel) return alert('O armazenamento do aplicativo ainda está iniciando. Tente novamente.');
        try {
            await syncConfiavel.enqueueDeleteToday();
            aplicarPedidosSincronizados(syncConfiavel.orders);
            abrirHistorico();
            alert(navigator.onLine ? 'Expediente removido. Confirmando no servidor.' : 'Expediente removido deste aparelho. A exclusão será enviada quando a internet voltar.');
        } catch (error) {
            alert('Não foi possível guardar a exclusão. Os pedidos foram preservados; tente novamente.');
        }
    }

    excluirTodoHistorico = async function() {
        const frase = document.getElementById('inputExcluirTudo').value;
        if (frase !== 'quero excluir todo o histórico') return alert('Frase de segurança incorreta.');
        if (!syncConfiavel) return alert('O armazenamento do aplicativo ainda está iniciando. Tente novamente.');
        try {
            await syncConfiavel.enqueueDeleteAll();
            aplicarPedidosSincronizados(syncConfiavel.orders);
            fecharModal('modalConfigAvancadas');
            alert(navigator.onLine ? 'Histórico removido. Confirmando no servidor.' : 'Histórico removido deste aparelho. A exclusão será enviada quando a internet voltar.');
        } catch (error) {
            alert('Não foi possível guardar a exclusão. O histórico foi preservado; tente novamente.');
        }
    };
    enviarPedidoConfirmado = async function() {
        if (envioPedidoEmAndamento || !syncConfiavel) return;
        envioPedidoEmAndamento = true;
        const btnConfirmar = document.getElementById('btnConfirmarPedido');
        if (btnConfirmar) btnConfirmar.disabled = true;
        const nome = document.getElementById('pedidoItemNome').value;
        const obsText = document.getElementById('pedidoObsText').value.trim();
        const reenvio = db.configs.reenvio || 'permitido';

        if (existeItemEmProducao(nome) && reenvio !== 'permitido') {
            const podeEnviar = reenvio === 'confirmacao' && await AloUiDialog.confirm('Esse item já está em produção. Deseja enviar outro pedido mesmo assim?', {
                title: 'Pedido repetido', icon: '↻', confirmText: 'Enviar novamente'
            });
            if (!podeEnviar) {
                if (reenvio === 'bloqueado') alert('Esse item está em produção');
                document.getElementById('modalFazerPedido').style.display = 'none';
                envioPedidoEmAndamento = false;
                if (btnConfirmar) btnConfirmar.disabled = false;
                return;
            }
        }

        const produto = obsText ? `${nome} (Obs: ${obsText})` : nome;
        const cadastroProduto = db.produtos.find(item => item.nome === nome) || {};
        const origensProduto = getAreasOrigemProduto(cadastroProduto);
        const areaOrigemAtual = getAreaAtual().tipo === 'envio' && origensProduto.includes(getAreaAtual().id)
            ? getAreaAtual().id
            : origensProduto[0];
        try {
            const pedido = await syncConfiavel.enqueueNewOrder({
                produto,
                areaOrigem: areaOrigemAtual || 'panelas',
                areaDestino: cadastroProduto.areaDestino || 'cozinha'
            });
            pedidosServidor = syncConfiavel.orders;
            document.getElementById('modalFazerPedido').style.display = 'none';
            renderizarUltimosPedidos();
            focarUltimosPedidosPanelas();
            salvarHistoricoLocal();
            if (!navigator.onLine) alert('Pedido guardado neste aparelho. Ele será enviado quando a internet voltar.');
        } catch (error) {
            alert('Não foi possível guardar o pedido neste aparelho. Tente novamente.');
        } finally {
            envioPedidoEmAndamento = false;
            if (btnConfirmar) btnConfirmar.disabled = false;
        }
    };

    async function iniciarComSyncConfiavel() {
        document.addEventListener('touchstart', () => AloAudio.unlock(), { once: true });
        document.addEventListener('click', () => AloAudio.unlock(), { once: true });
        iniciar();
        window.AloFeiraModule?.configure({ getServerUrl: () => db.configs.url });
        window.AloEtiquetasCloud?.configure({
            getServerUrl: () => db.configs.url,
            isModuleActive: () => document.getElementById('l42Module')?.style.display !== 'none'
        });
        if (window.AloTasks) {
            AloTasks.init({
                getDatabase: () => db,
                getUrl: () => db.configs.url,
                markDatabaseChanged: marcarBancoAlterado,
                openModalTop: abrirModalNoTopo
            });
        }
        window.AloTechnicalSheets?.configure({
            getUrl: () => db.configs.url,
            getAreas: () => db.setoresTarefas || [],
            openModalTop: abrirModalNoTopo,
            onSyncState: state => window.AloTasks?.setAuxiliarySyncState?.('sheets', state)
        });
        window.AloChecklistDocuments?.configure({
            getUrl: () => db.configs.url,
            getTasks: () => db.tarefas || [],
            openModalTop: abrirModalNoTopo,
            onSyncState: state => window.AloTasks?.setAuxiliarySyncState?.('documents', state)
        });
        if (window.AloSharedData) {
            AloSharedData.registerAdapter('compras', {
                getSnapshot: () => AloFeiraModule.getSharedSnapshot(),
                applyPeople: people => AloFeiraModule.applySharedPeople(people),
                applyRestaurant: restaurant => AloFeiraModule.applySharedRestaurant(restaurant),
                activatePerson: person => AloFeiraModule.activateSharedPerson(person),
                logout: () => AloFeiraModule.logout(),
                getCategories: () => AloFeiraModule.getCategories(),
                getFullData: () => AloFeiraModule.getBackup()
            });
            AloSharedData.registerAdapter('l42', {
                getSnapshot: () => AloL42Module.getSharedSnapshot(),
                applyPeople: people => AloL42Module.applySharedPeople(people),
                applyRestaurant: restaurant => AloL42Module.applySharedRestaurant(restaurant),
                activatePerson: person => AloL42Module.activateSharedPerson(person),
                logout: () => AloL42Module.logout(),
                getFullData: () => AloL42Module.getBackup()
            });
            AloSharedData.configure({
                getDatabase: () => db,
                markDatabaseChanged: marcarBancoAlterado,
                openModalTop: abrirModalNoTopo
            });
        }
        syncConfiavel = new AloSync({
            getUrl: () => db.configs.url,
            onOrders: aplicarPedidosSincronizados,
            onState: atualizarIndicadorSincronizacao
        });
        // O catálogo e os pedidos usam canais independentes. Iniciá-los em paralelo
        // evita que uma leitura mais lenta do histórico mantenha o catálogo amarelo.
        const inicializacaoPedidos = syncConfiavel.start();
        const catalogoConfirmado = await sincronizarBancoAutomaticamente({ preferirNuvem: true });
        if (catalogoConfirmado) {
            await integrarFontesCompartilhadas()
                .catch(error => console.warn('Integração dos dados:', error));
        }
        if(!bancoSyncTimer) bancoSyncTimer = setInterval(sincronizarBancoAutomaticamente, 5000);
        window.addEventListener('online', () => {
            agendarSincronizacaoBanco(0);
            agendarIntegracaoInicialDaNuvem(0);
        });
        await inicializacaoPedidos;
    }

    const abrirModalMetricasOriginal = abrirModalMetricas;
    const renderizarMetricasDetalhesLocal = renderizarMetricasDetalhes;
    const cacheRelatorios = new Map();
    let requisicaoRelatorio = 0;

    function intervaloDoRelatorio(periodo) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        let inicio = new Date(hoje);
        let fim = new Date();
        if (periodo === 'tudo') inicio = new Date('2000-01-01T00:00:00.000Z');
        else if (periodo === '7d') inicio.setDate(inicio.getDate() - 6);
        else if (periodo === '15d') inicio.setDate(inicio.getDate() - 14);
        else if (periodo === '30d') inicio.setDate(inicio.getDate() - 29);
        else if (periodo === 'custom') {
            const valorInicio = document.getElementById('filtroDataInicio').value;
            const valorFim = document.getElementById('filtroDataFim').value;
            if (!valorInicio || !valorFim) return null;
            inicio = new Date(`${valorInicio}T00:00:00`);
            fim = new Date(`${valorFim}T23:59:59.999`);
        }
        return { start: inicio.toISOString(), end: fim.toISOString() };
    }

    async function atualizarHistoricoRelatorio(periodo) {
        if (!syncConfiavel || !db.configs.url) return;
        const intervalo = intervaloDoRelatorio(periodo);
        if (!intervalo) return;
        const chave = `${intervalo.start}|${intervalo.end}`;
        const agora = Date.now();
        if (agora - (cacheRelatorios.get(chave) || 0) < 30000) return;

        const idRequisicao = ++requisicaoRelatorio;
        const status = document.getElementById('statusRelatorio');
        if (status) status.innerText = 'Atualizando dados...';
        try {
            const resposta = await AloApi.getHistory(db.configs.url, intervalo.start, intervalo.end);
            if (idRequisicao !== requisicaoRelatorio) return;
            const historico = Array.isArray(resposta.pedidos) ? resposta.pedidos.map(AloLogic.normalizeOrder) : [];
            const porId = new Map(syncConfiavel.orders.map(pedido => [pedido.id, pedido]));
            historico.forEach(pedido => porId.set(pedido.id, pedido));
            syncConfiavel.orders = Array.from(porId.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            await AloStorage.putOrders(syncConfiavel.orders);
            aplicarPedidosSincronizados(syncConfiavel.orders);
            cacheRelatorios.set(chave, Date.now());
            renderizarMetricasDetalhesLocal(periodo);
            if (status) status.innerText = `${historico.length} pedidos carregados`;
        } catch (error) {
            if (idRequisicao === requisicaoRelatorio && status) status.innerText = 'Exibindo os dados salvos neste aparelho';
        }
    }

    renderizarMetricasDetalhes = function(periodo) {
        renderizarMetricasDetalhesLocal(periodo);
        atualizarHistoricoRelatorio(periodo);
    };

    abrirModalMetricas = function() {
        const status = document.getElementById('statusRelatorio');
        if (status) status.innerText = '';
        abrirModalMetricasOriginal();
    };

    function dadosBancoParaNuvem(banco = db) {
        const taskSettings = banco.configsTarefas || {};
        const settings = banco.configs || {};
        return {
            produtos: banco.produtos,
            categorias: banco.categorias,
            obsPedidos: banco.obsPedidos,
            obsCancelamentos: banco.obsCancelamentos,
            areas: banco.areas,
            setoresTarefas: banco.setoresTarefas,
            funcionarios: banco.funcionarios,
            tarefas: banco.tarefas,
            coreCompartilhado: window.AloSharedData ? AloSharedData.getCloudData() : (banco.coreCompartilhado || null),
            configsTarefas: {
                som: taskSettings.som,
                volume: taskSettings.volume,
                repeticaoMinutos: taskSettings.repeticaoMinutos
            },
            configs: {
                senhaSeguranca: settings.senhaSeguranca || '',
                senhaModo: settings.senhaModo || '',
                somCozinha: settings.somCozinha || 'sem_som',
                somPanelas: settings.somPanelas || 'sem_som',
                volumeCozinha: settings.volumeCozinha || '100',
                volumePanelas: settings.volumePanelas || '70',
                telaAtiva: settings.telaAtiva || 'sim',
                inatividade: settings.inatividade || '0',
                reenvio: settings.reenvio || 'permitido',
                virBuscarAtivo: settings.virBuscarAtivo !== false,
                loginObrigatorioModulos: { kds:false, checklist:false, compras:true, l42:true, ...(settings.loginObrigatorioModulos || {}) },
                loginObrigatorioChecklistVisoes: { documentos:false, geral:false, ...(settings.loginObrigatorioChecklistVisoes || {}) },
                modulosVisiveis: { kds:true, checklist:true, compras:true, l42:true, ...(settings.modulosVisiveis || {}) }
            }
        };
    }

    function ehUrlAppsScript(valor) {
        return Boolean(window.AloCloud?.isEndpoint?.(valor));
    }

    function bancoNuvemValido(nuvemDB) {
        return Boolean(nuvemDB)
            && !Array.isArray(nuvemDB)
            && typeof nuvemDB === 'object'
            && Object.prototype.hasOwnProperty.call(nuvemDB, '_revision');
    }

    function aplicarBancoDaNuvem(nuvemDB) {
        const configuracaoLocal = {
            url: db.configs.url,
            modo: db.configs.modo,
            areaAtual: db.configs.areaAtual,
            suporteDadosCompartilhados: Boolean(nuvemDB._capabilities?.dadosCompartilhados)
        };
        db.produtos = Array.isArray(nuvemDB.produtos) ? nuvemDB.produtos : db.produtos;
        db.categorias = Array.isArray(nuvemDB.categorias) ? nuvemDB.categorias : db.categorias;
        db.obsPedidos = Array.isArray(nuvemDB.obsPedidos) ? nuvemDB.obsPedidos : db.obsPedidos;
        db.obsCancelamentos = Array.isArray(nuvemDB.obsCancelamentos) ? nuvemDB.obsCancelamentos : db.obsCancelamentos;
        db.areas = Array.isArray(nuvemDB.areas) && nuvemDB.areas.length ? nuvemDB.areas : db.areas;
        db.setoresTarefas = Array.isArray(nuvemDB.setoresTarefas) && nuvemDB.setoresTarefas.length ? nuvemDB.setoresTarefas : db.setoresTarefas;
        db.funcionarios = Array.isArray(nuvemDB.funcionarios) ? nuvemDB.funcionarios : db.funcionarios;
        db.tarefas = Array.isArray(nuvemDB.tarefas) ? nuvemDB.tarefas : db.tarefas;
        if (nuvemDB.coreCompartilhado && typeof nuvemDB.coreCompartilhado === 'object') {
            db.coreCompartilhado = nuvemDB.coreCompartilhado;
            window.AloSharedData?.applyCloudState(nuvemDB.coreCompartilhado, { force: true });
        }
        const devePublicarNucleo = configuracaoLocal.suporteDadosCompartilhados
            && !nuvemDB.coreCompartilhado
            && Boolean(window.AloSharedData?.describe().people);
        db.configsTarefas = { ...db.configsTarefas, ...(nuvemDB.configsTarefas || {}) };
        db.configs = {
            ...db.configs,
            ...(nuvemDB.configs || {}),
            ...configuracaoLocal,
            dadosBaixados: true,
            bancoPendente: false,
            revisaoBanco: Number(nuvemDB._revision || 0)
        };
        if (devePublicarNucleo) db.configs.bancoPendente = true;
        if (migrarSenhaSeguranca(db.configs)) db.configs.bancoPendente = true;
        normalizarAreasERotas();
        normalizarSonsConfigurados();
        salvarBancoLocal();
        if (window.AloTasks) AloTasks.refreshDefinitions();
    }

    function agendarSincronizacaoBanco(atraso = 450) {
        if(bancoPublicacaoTimer) clearTimeout(bancoPublicacaoTimer);
        bancoPublicacaoTimer = setTimeout(() => {
            bancoPublicacaoTimer = null;
            sincronizarBancoAutomaticamente();
        }, atraso);
    }

    async function publicarBancoPendente() {
        const dadosEnviados = dadosBancoParaNuvem();
        const assinaturaEnviada = JSON.stringify(dadosEnviados);
        const resultado = await AloCatalogSync.publish({ api: AloApi, url: db.configs.url, data: dadosEnviados });
        if(!resultado.confirmed) throw new Error('O servidor ainda não confirmou as configurações. Tentando novamente.');

        // A versão original confiável comparava o conteúdo real após o envio.
        // Isso evita manter o amarelo por notificações internas sem mudança de dados.
        const nenhumaEdicaoNova = JSON.stringify(dadosBancoParaNuvem()) === assinaturaEnviada;
        const tarefasMescladas = AloCatalogSync.mergeTaskDefinitions(db.tarefas, resultado.bank?.tarefas);
        const tarefasAtualizadas = JSON.stringify(tarefasMescladas) !== JSON.stringify(db.tarefas);
        if(tarefasAtualizadas) db.tarefas = tarefasMescladas;
        db.configs.dadosBaixados = true;
        db.configs.bancoPendente = !nenhumaEdicaoNova;
        db.configs.revisaoBanco = resultado.revision;
        db.configs.suporteDadosCompartilhados = Boolean(resultado.sharedSupported);
        bancoSyncErro = '';
        bancoSyncFalhas = 0;
        salvarBancoLocal();
        if(tarefasAtualizadas && window.AloTasks) AloTasks.refreshDefinitions();
    }

    async function sincronizarBancoAutomaticamente(options = {}) {
        if(bancoSyncEmAndamento || !db.configs.url || !navigator.onLine) return false;
        bancoSyncEmAndamento = true;
        bancoSyncErro = '';
        atualizarIndicadorSincronizacao(estadoSyncPedidosAtual);
        try {
            if(db.configs.bancoPendente) {
                const nuvemAtual = await AloApi.getBank(db.configs.url);
                const primeiraCargaSemCatalogo = options.preferirNuvem === true
                    && !db.configs.dadosBaixados
                    && !db.produtos.length
                    && !db.categorias.length;
                if (primeiraCargaSemCatalogo || AloCatalogSync.shouldHydrateRemoteBeforePublish(db, nuvemAtual)) {
                    if (!bancoNuvemValido(nuvemAtual)) return false;
                    aplicarBancoDaNuvem(nuvemAtual);
                    iniciar();
                } else {
                    await publicarBancoPendente();
                }
            } else {
                const nuvemDB = await AloApi.getBank(db.configs.url);
                if(!bancoNuvemValido(nuvemDB) || !Array.isArray(nuvemDB.produtos)) return false;
                // Uma edição pode acontecer enquanto a leitura está em andamento. Nesse caso,
                // publicar primeiro evita que a resposta antiga apague a alteração local.
                if(db.configs.bancoPendente) {
                    await publicarBancoPendente();
                    return;
                }
                const revisaoNuvem = Number(nuvemDB._revision || 0);
                const revisaoLocal = Number(db.configs.revisaoBanco || 0);
                if(!db.configs.dadosBaixados || revisaoNuvem > revisaoLocal) {
                    aplicarBancoDaNuvem(nuvemDB);
                    iniciar();
                }
            }
            bancoSyncErro = '';
            bancoSyncFalhas = 0;
            return true;
        } catch(error) {
            bancoSyncFalhas += 1;
            bancoSyncErro = bancoSyncFalhas >= 3
                ? (error && error.message ? error.message : 'Não foi possível sincronizar as configurações.')
                : '';
            return false;
        } finally {
            bancoSyncEmAndamento = false;
            atualizarIndicadorSincronizacao(estadoSyncPedidosAtual);
            if(db.configs.bancoPendente && navigator.onLine) agendarSincronizacaoBanco(2200);
        }
    }

    sincronizarPuxarNuvem = async function(pedirConfirmacao) {
        if (!db.configs.url) return;
        if (pedirConfirmacao) {
            const confirmed = await AloUiDialog.confirm('Este aparelho receberá o cardápio salvo na nuvem. Deseja continuar?', {
                title: 'Receber dados da nuvem', icon: '☁️', confirmText: 'Receber dados'
            });
            if (!confirmed) return;
        }
        try {
            const nuvemDB = await AloApi.getBank(db.configs.url);
            if (!bancoNuvemValido(nuvemDB)) {
                alert('URL incompatível com o banco do Alô Cozinha.');
                return;
            }
            if (Array.isArray(nuvemDB.produtos)) {
                aplicarBancoDaNuvem(nuvemDB);
                if (pedirConfirmacao) {
                    alert('Cardápio e configurações atualizados.');
                    location.reload();
                } else {
                    iniciar();
                }
            }
        } catch (error) {
            if(pedirConfirmacao) alert('Falha ao receber os dados. O que já está neste aparelho foi preservado.');
        }
    };

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js?v=2.1.50').catch(() => {}));
    }

    instalarProtecaoRolagemModais();
    iniciarComSyncConfiavel();
