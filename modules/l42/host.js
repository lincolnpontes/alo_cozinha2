(function (global) {
    const FRAME_ID = 'l42Frame';
    const pendingNativeCallbacks = [];
    let frameReady = false;

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
        throw new Error('O Alô L42 demorou para abrir.');
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
            return;
        }
        if (event.data.type === 'show-home') global.AloModuleHost?.showHome();
    }

    function configure() {
        global.addEventListener('message', receiveMessage);
    }

    async function getBackup() {
        const child = await waitForChild();
        if (typeof child.obterBackupL42PeloHost !== 'function') throw new Error('Atualize o módulo L42 antes de exportar.');
        return child.obterBackupL42PeloHost();
    }

    async function restoreBackup(bank) {
        const child = await waitForChild();
        if (typeof child.restaurarBackupL42PeloHost !== 'function') throw new Error('Atualize o módulo L42 antes de restaurar.');
        return child.restaurarBackupL42PeloHost(bank);
    }

    global.receberQrsNativos = (...args) => deliverNativeCallback('receberQrsNativos', args);
    global.cameraNativaFechada = (...args) => deliverNativeCallback('cameraNativaFechada', args);
    global.receberLinkAutenticacaoSupabase = (...args) => deliverNativeCallback('receberLinkAutenticacaoSupabase', args);

    global.AloL42Module = Object.freeze({ configure, open, getBackup, restoreBackup });
    configure();
})(window);
