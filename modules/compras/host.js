(function (global) {
    const STORAGE_KEY = 'alofeira_v1';
    const MODE_LABELS = {
        pedido: { name: 'Pedir', emoji: '📝' },
        compras: { name: 'Comprar', emoji: '🛒' }
    };
    let getServerUrl = () => '';
    let loadPromise = null;
    let settingsReturnTarget = 'compras';

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

    async function waitForChild() {
        open();
        const frame = frameElement();
        if (!frame) throw new Error('O módulo de compras não está disponível.');
        let child = null;
        try {
            if (frame.contentDocument?.readyState === 'complete' && typeof frame.contentWindow.obterEstadoHostCompras === 'function') {
                child = frame.contentWindow;
            }
        } catch (error) {}
        if (!child) {
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
            child = await loadPromise;
        }
        if (typeof child.aguardarComprasProntasHost === 'function') await child.aguardarComprasProntasHost();
        return child;
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
        const syncIndicator = document.getElementById('feiraSyncIndicator');
        if (modeName) modeName.textContent = label.name;
        if (modeEmoji) modeEmoji.textContent = label.emoji;
        if (profileName) profileName.textContent = state.profileName || 'Perfil';
        if (profileEmoji) profileEmoji.textContent = state.profileEmoji || '👤';
        if (syncIndicator && state.syncState) {
            syncIndicator.className = `app-sync-indicator ${state.syncState}`;
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
            syncState: document.getElementById('feiraSyncIndicator')?.classList[1] || 'local'
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
        global.abrirLoginAdmin?.('trocar_compras');
    }

    async function openManager(type, returnTarget = 'compras') {
        settingsReturnTarget = returnTarget === 'central' ? 'central' : 'compras';
        global.fecharModal?.(settingsReturnTarget === 'central' ? 'modalPainelUnificado' : 'modalConfigCompras');
        global.AloTasks?.openModule('feira');
        const child = await waitForChild();
        child.abrirGerenciar(type);
    }

    async function prepareLogin() {
        const child = await waitForChild();
        if (typeof child.listarOperadoresComprasPeloHost !== 'function') throw new Error('Atualize o módulo Compras para usar o login unificado.');
        return child.listarOperadoresComprasPeloHost();
    }

    async function authenticateOperator(id, pin, options = {}) {
        const child = await waitForChild();
        if (typeof child.autenticarOperadorComprasPeloHost !== 'function') throw new Error('O login unificado ainda não está disponível.');
        return child.autenticarOperadorComprasPeloHost(id, pin, options);
    }

    async function logout() {
        const frame = frameElement();
        if (!frame?.getAttribute('src')) return true;
        const child = await waitForChild();
        if (typeof child.encerrarSessaoComprasPeloHost === 'function') await child.encerrarSessaoComprasPeloHost();
        updateHeader({ ...currentHeaderState(), profileName: 'Perfil', profileEmoji: '👤' });
        return true;
    }

    async function getBackup() {
        const child = await waitForChild();
        if (typeof child.obterBackupComprasPeloHost !== 'function') throw new Error('Atualize o módulo Compras antes de exportar.');
        return child.obterBackupComprasPeloHost();
    }

    async function getSharedSnapshot() {
        const child = await waitForChild();
        if (typeof child.obterDadosCompartilhadosComprasPeloHost !== 'function') throw new Error('Atualize Compras para integrar os dados do estabelecimento.');
        return child.obterDadosCompartilhadosComprasPeloHost();
    }

    async function getCategories() {
        const child = await waitForChild();
        if (typeof child.listarCategoriasComprasPeloHost !== 'function') return [];
        return child.listarCategoriasComprasPeloHost();
    }

    async function applySharedPeople(people) {
        const child = await waitForChild();
        if (typeof child.aplicarPessoasCompartilhadasComprasPeloHost !== 'function') throw new Error('Compras ainda não aceita pessoas compartilhadas.');
        return child.aplicarPessoasCompartilhadasComprasPeloHost(people);
    }

    async function applySharedRestaurant(restaurant) {
        const child = await waitForChild();
        if (typeof child.aplicarRestauranteCompartilhadoComprasPeloHost !== 'function') return false;
        return child.aplicarRestauranteCompartilhadoComprasPeloHost(restaurant);
    }

    async function activateSharedPerson(person) {
        const child = await waitForChild();
        if (typeof child.ativarPessoaCompartilhadaComprasPeloHost !== 'function') throw new Error('Compras ainda não aceita a sessão compartilhada.');
        return child.ativarPessoaCompartilhadaComprasPeloHost(person);
    }

    async function restoreBackup(bank) {
        const child = await waitForChild();
        if (typeof child.restaurarBackupComprasPeloHost !== 'function') throw new Error('Atualize o módulo Compras antes de restaurar.');
        return child.restaurarBackupComprasPeloHost(bank);
    }

    async function syncNow() {
        const child = await waitForChild();
        if (typeof child.sincronizarFundo === 'function') return child.sincronizarFundo(true);
        return false;
    }

    async function clearHistory() {
        const child = await waitForChild();
        if (typeof child.excluirHistoricoPeloHost !== 'function') throw new Error('A Lista de Compras precisa ser atualizada.');
        return child.excluirHistoricoPeloHost();
    }

    function backToSettings() {
        if (settingsReturnTarget === 'central') {
            global.abrirPainelControle?.();
            return;
        }
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
        updateHeader, refreshHeader, openProfile, openManager, prepareLogin, authenticateOperator,
        logout, getBackup, restoreBackup, getSharedSnapshot, getCategories, applySharedPeople, applySharedRestaurant, activateSharedPerson,
        syncNow, clearHistory, backToSettings
    });
})(window);
