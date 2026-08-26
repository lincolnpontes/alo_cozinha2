(function (global) {
    const STORAGE_KEY = 'alofeira_v1';
    const MODE_LABELS = {
        pedido: { name: 'Pedir', emoji: '📝' },
        compras: { name: 'Comprar', emoji: '🛒' }
    };
    let getServerUrl = () => '';
    let loadPromise = null;

    function readBank() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            return null;
        }
    }

    function unifiedUrl() {
        return String(getServerUrl() || '').trim();
    }

    function frameElement() {
        return document.getElementById('feiraFrame');
    }

    function syncServerUrl() {
        const savedBank = readBank();
        const bank = savedBank || { app_id: 'alofeira', schemaVersion: 2, configs: {} };
        const previousAppId = bank.app_id;
        bank.app_id = 'alofeira';
        bank.configs = bank.configs && typeof bank.configs === 'object' ? bank.configs : {};
        const url = unifiedUrl();
        const changed = !savedBank || previousAppId !== 'alofeira' || String(bank.configs.url || '') !== url;
        bank.configs.url = url;
        if (changed) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bank));
            const frame = frameElement();
            if (frame?.getAttribute('src')) frame.contentWindow.location.reload();
        }
        return changed;
    }

    function open() {
        syncServerUrl();
        const frame = frameElement();
        if (!frame) return;
        if (!frame.getAttribute('src')) frame.setAttribute('src', frame.dataset.src);
    }

    function waitForChild() {
        open();
        const frame = frameElement();
        if (!frame) return Promise.reject(new Error('O módulo de compras não está disponível.'));
        try {
            if (frame.contentDocument?.readyState === 'complete' && typeof frame.contentWindow.obterEstadoHostCompras === 'function') {
                return Promise.resolve(frame.contentWindow);
            }
        } catch (error) {}
        if (!loadPromise) {
            loadPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    loadPromise = null;
                    reject(new Error('A Lista de Compras demorou para abrir.'));
                }, 12000);
                frame.addEventListener('load', () => {
                    clearTimeout(timeout);
                    loadPromise = null;
                    resolve(frame.contentWindow);
                }, { once: true });
            });
        }
        return loadPromise;
    }

    function closeModePicker() {
        document.getElementById('feiraModeOptions')?.classList.remove('open');
        document.getElementById('feiraModeButton')?.setAttribute('aria-expanded', 'false');
    }

    function toggleModePicker() {
        const options = document.getElementById('feiraModeOptions');
        const button = document.getElementById('feiraModeButton');
        if (!options || !button) return;
        const openNow = !options.classList.contains('open');
        options.classList.toggle('open', openNow);
        button.setAttribute('aria-expanded', String(openNow));
    }

    function updateHeader(state = {}) {
        const mode = MODE_LABELS[state.mode] ? state.mode : 'pedido';
        const label = MODE_LABELS[mode];
        const modeName = document.getElementById('feiraModeName');
        const modeEmoji = document.getElementById('feiraModeEmoji');
        const profileName = document.getElementById('feiraProfileName');
        const profileEmoji = document.getElementById('feiraProfileEmoji');
        const requireOperator = document.getElementById('configComprasExigirOperador');
        const syncIndicator = document.getElementById('feiraSyncIndicator');
        if (modeName) modeName.textContent = label.name;
        if (modeEmoji) modeEmoji.textContent = label.emoji;
        if (profileName) profileName.textContent = state.profileName || 'Perfil';
        if (profileEmoji) profileEmoji.textContent = state.profileEmoji || '👤';
        if (requireOperator && state.requireOperator !== undefined) requireOperator.checked = Boolean(state.requireOperator);
        if (syncIndicator && state.syncState) {
            syncIndicator.className = `feira-sync-indicator ${state.syncState}`;
            syncIndicator.title = state.syncMessage || 'Estado da sincronização de Compras';
            syncIndicator.setAttribute('aria-label', syncIndicator.title);
        }
        document.querySelectorAll('[data-feira-mode]').forEach(button => {
            const selected = button.dataset.feiraMode === mode;
            button.classList.toggle('selected', selected);
            button.setAttribute('aria-selected', String(selected));
            const check = button.querySelector('b');
            if (check) check.textContent = selected ? '✓' : '';
        });
    }

    async function refreshHeader() {
        try {
            const child = await waitForChild();
            if (typeof child.obterEstadoHostCompras === 'function') updateHeader(child.obterEstadoHostCompras());
        } catch (error) {}
    }

    function currentHeaderState() {
        return {
            mode: document.querySelector('[data-feira-mode].selected')?.dataset.feiraMode || 'pedido',
            profileName: document.getElementById('feiraProfileName')?.textContent || 'Perfil',
            profileEmoji: document.getElementById('feiraProfileEmoji')?.textContent || '👤',
            requireOperator: document.getElementById('configComprasExigirOperador')?.checked || false
        };
    }

    async function setMode(mode) {
        closeModePicker();
        if (!MODE_LABELS[mode]) return;
        updateHeader({ ...currentHeaderState(), mode });
        const child = await waitForChild();
        child.alterarModo(mode);
    }

    async function openProfile() {
        const child = await waitForChild();
        child.abrirSelecaoColaboradorInicial(true);
    }

    async function openManager(type) {
        global.fecharModal?.('modalConfigCompras');
        global.AloTasks?.openModule('feira');
        const child = await waitForChild();
        child.abrirGerenciar(type);
    }

    async function setRequireOperator(enabled) {
        const child = await waitForChild();
        if (typeof child.definirExigenciaOperadorHost === 'function') child.definirExigenciaOperadorHost(Boolean(enabled));
    }

    async function exportData() {
        const child = await waitForChild();
        child.exportarDados();
    }

    function readTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = event => resolve(event.target.result);
            reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
            reader.readAsText(file);
        });
    }

    function backupSummary(bank) {
        return {
            products: Array.isArray(bank.produtos) ? bank.produtos.length : 0,
            categories: Array.isArray(bank.categorias) ? bank.categorias.length : 0,
            suppliers: Array.isArray(bank.fornecedores) ? bank.fornecedores.length : 0,
            operators: Array.isArray(bank.colaboradores) ? bank.colaboradores.length : 0,
            orders: Array.isArray(bank.pedidosAtivos) ? bank.pedidosAtivos.filter(item => item?.status !== 'rascunho').length : 0
        };
    }

    async function restoreData(event) {
        const input = event?.target;
        const file = input?.files?.[0];
        if (!file) return;
        const button = document.getElementById('btnRestaurarCompras');
        const status = document.getElementById('statusRestauracaoCompras');
        const originalText = button?.innerText || '';
        try {
            const imported = JSON.parse(await readTextFile(file));
            if (!imported || imported.app_id !== 'alofeira') throw new Error('Este arquivo não é um backup da Lista de Compras.');
            const summary = backupSummary(imported);
            if (!summary.products && !summary.orders) throw new Error('O backup da Lista de Compras está vazio.');
            const confirmed = await global.AloUiDialog.confirm(
                `Foram encontrados ${summary.products} produtos, ${summary.categories} categorias, ${summary.suppliers} fornecedores, ${summary.operators} operadores e ${summary.orders} pedidos. Somente os dados de Compras serão substituídos.`,
                { title: 'Restaurar Lista de Compras', icon: '🛒', confirmText: 'Restaurar na nuvem' }
            );
            if (!confirmed) return;

            if (button) { button.disabled = true; button.innerText = 'Restaurando...'; }
            if (status) status.innerText = 'Enviando e conferindo o backup na nuvem...';
            const child = await waitForChild();
            if (typeof child.restaurarBackupComprasPeloHost !== 'function') throw new Error('Atualize o aplicativo antes de restaurar este backup.');
            const result = await child.restaurarBackupComprasPeloHost(imported);
            if (status) status.innerText = `Backup confirmado na revisão ${result.revision}.`;
            await global.AloUiDialog.notice(
                `${result.produtos} produtos, ${result.fornecedores} fornecedores, ${result.operadores} operadores e ${result.pedidos} pedidos foram confirmados na nuvem.`,
                { title: 'Compras restauradas', icon: '✓', confirmText: 'Abrir Lista de Compras' }
            );
            frameElement()?.contentWindow?.location.reload();
        } catch (error) {
            if (status) status.innerText = '';
            await global.AloUiDialog.notice(error.message || 'Não foi possível restaurar o backup.', {
                title: 'Restauração não concluída', icon: '!', tone: 'danger', confirmText: 'Entendi'
            });
        } finally {
            if (input) input.value = '';
            if (button) { button.disabled = false; button.innerText = originalText; }
        }
    }

    async function clearHistory() {
        const child = await waitForChild();
        if (typeof child.excluirHistoricoPeloHost !== 'function') throw new Error('A Lista de Compras precisa ser atualizada.');
        return child.excluirHistoricoPeloHost();
    }

    function backToSettings() {
        global.abrirConfiguracoesCompras?.();
    }

    function configure(options = {}) {
        if (typeof options.getServerUrl === 'function') getServerUrl = options.getServerUrl;
        syncServerUrl();
        frameElement()?.addEventListener('load', refreshHeader);
        document.addEventListener('pointerdown', event => {
            const picker = document.querySelector('.feira-mode-picker');
            if (picker && !picker.contains(event.target)) closeModePicker();
        });
    }

    global.AloFeiraModule = Object.freeze({
        configure, open, syncServerUrl, toggleModePicker, closeModePicker, setMode,
        updateHeader, refreshHeader, openProfile, openManager, setRequireOperator,
        exportData, restoreData, clearHistory, backToSettings
    });
})(window);
