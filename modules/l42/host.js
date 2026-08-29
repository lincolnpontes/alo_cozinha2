(function (global) {
    const FRAME_ID = 'l42Frame';
    const pendingNativeCallbacks = [];
    let frameReady = false;
    let lastCloudStatus = { status: 'local', message: 'Aguardando abertura de Etiquetas' };

    function frameElement() {
        return document.getElementById(FRAME_ID);
    }

    function open() {
        const frame = frameElement();
        if (!frame) return;
        if (!frame.getAttribute('src')) {
            frameReady = false;
            frame.setAttribute('src', frame.dataset.src);
        }
    }

    function childWindow() {
        const frame = frameElement();
        return frame?.getAttribute('src') ? frame.contentWindow : null;
    }

    async function waitForChild(timeoutMs = 15000) {
        open();
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const child = childWindow();
            if (frameReady && child) return child;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('O módulo Etiquetas demorou para abrir.');
    }

    function deliverNativeCallback(name, args) {
        const child = childWindow();
        if (!frameReady || !child) {
            pendingNativeCallbacks.push({ name, args });
            return false;
        }
        try {
            const handler = child[name];
            if (typeof handler === 'function') handler(...args);
            return typeof handler === 'function';
        } catch (error) {
            pendingNativeCallbacks.push({ name, args });
            return false;
        }
    }

    function flushNativeCallbacks() {
        const callbacks = pendingNativeCallbacks.splice(0);
        callbacks.forEach(callback => deliverNativeCallback(callback.name, callback.args));
    }

    function legacyStorageSnapshot() {
        const entries = {};
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key || !/^(etiquetadora_|alo_supabase_|alo_etiqueta_)/.test(key)) continue;
            entries[key] = localStorage.getItem(key);
        }
        return entries;
    }

    function receiveMessage(event) {
        const frame = frameElement();
        if (!frame || event.source !== frame.contentWindow || event.data?.source !== 'alo-l42') return;
        if (event.data.type === 'ready') {
            frameReady = true;
            event.source.postMessage({ source: 'alo-cozinha', type: 'restore-legacy-storage', entries: legacyStorageSnapshot() }, '*');
            flushNativeCallbacks();
            setCloudStatus(lastCloudStatus.status, lastCloudStatus.message);
            global.AloEtiquetasCloud?.sync?.().catch(() => {});
            return;
        }
        if (event.data.type === 'show-home') global.AloModuleHost?.showHome();
        if (event.data.type === 'data-changed') global.AloEtiquetasCloud?.markDirty?.();
        if (event.data.type === 'open-settings') global.abrirLoginAdmin?.('etiquetas');
        if (event.data.type === 'switch-person') global.abrirLoginAdmin?.('trocar_l42');
    }

    function configure() {
        global.addEventListener('message', receiveMessage);
    }

    async function getBackup() {
        const child = await waitForChild();
        if (typeof child.obterBackupL42PeloHost !== 'function') throw new Error('Atualize o módulo Etiquetas antes de exportar.');
        return child.obterBackupL42PeloHost();
    }

    async function restoreBackup(bank) {
        const child = await waitForChild();
        if (typeof child.restaurarBackupL42PeloHost !== 'function') throw new Error('Atualize o módulo Etiquetas antes de restaurar.');
        return child.restaurarBackupL42PeloHost(bank);
    }

    async function mergeCloudData(bank) {
        const child = await waitForChild();
        if (typeof child.mesclarBancoEtiquetasPeloHost !== 'function') throw new Error('Atualize Etiquetas antes de sincronizar.');
        return child.mesclarBancoEtiquetasPeloHost(bank);
    }

    async function setCloudStatus(status, message) {
        lastCloudStatus = { status, message };
        const child = childWindow();
        if (typeof child?.atualizarNuvemEtiquetasPeloHost === 'function') child.atualizarNuvemEtiquetasPeloHost(status, message);
    }

    async function openSettings(section) {
        global.fecharModal?.('modalConfigEtiquetas');
        global.AloTasks?.openModule('l42');
        const child = await waitForChild();
        if (typeof child.abrirConfiguracaoEtiquetasPeloHost !== 'function') throw new Error('Atualize Etiquetas para abrir esta configuração.');
        return child.abrirConfiguracaoEtiquetasPeloHost(section);
    }

    function backToSettings() {
        global.abrirConfiguracoesEtiquetas?.();
    }

    async function getSharedSnapshot() {
        const child = await waitForChild();
        if (typeof child.obterDadosCompartilhadosL42PeloHost !== 'function') throw new Error('Atualize o módulo Etiquetas antes de integrar os dados.');
        return child.obterDadosCompartilhadosL42PeloHost();
    }

    async function applySharedPeople(people) {
        const child = await waitForChild();
        if (typeof child.aplicarPessoasCompartilhadasL42PeloHost !== 'function') throw new Error('Atualize o módulo Etiquetas antes de integrar os usuários.');
        return child.aplicarPessoasCompartilhadasL42PeloHost(people);
    }

    async function applySharedRestaurant(restaurant) {
        const child = await waitForChild();
        if (typeof child.aplicarRestauranteCompartilhadoL42PeloHost !== 'function') return false;
        return child.aplicarRestauranteCompartilhadoL42PeloHost(restaurant);
    }

    async function activateSharedPerson(person) {
        const child = await waitForChild();
        if (typeof child.ativarPessoaCompartilhadaL42PeloHost !== 'function') throw new Error('Atualize o módulo Etiquetas antes de entrar.');
        return child.ativarPessoaCompartilhadaL42PeloHost(person);
    }

    async function logout() {
        const child = childWindow();
        if (typeof child?.encerrarSessaoL42PeloHost === 'function') return child.encerrarSessaoL42PeloHost();
    }

    global.receberQrsNativos = (...args) => deliverNativeCallback('receberQrsNativos', args);
    global.cameraNativaFechada = (...args) => deliverNativeCallback('cameraNativaFechada', args);
    global.receberLinkAutenticacaoSupabase = (...args) => deliverNativeCallback('receberLinkAutenticacaoSupabase', args);

    global.AloL42Module = Object.freeze({
        configure, open, getBackup, restoreBackup, mergeCloudData, setCloudStatus, openSettings, backToSettings,
        getSharedSnapshot, applySharedPeople, applySharedRestaurant, activateSharedPerson, logout,
        getFullData: getBackup
    });
    configure();
})(window);
