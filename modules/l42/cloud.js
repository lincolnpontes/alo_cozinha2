(function (global) {
    const REVISION_KEY = 'alo_etiquetas_cloud_revision_v1';
    const DIRTY_KEY = 'alo_etiquetas_cloud_dirty_v1';
    const OPERATION_KEY = 'alo_etiquetas_cloud_operation_v1';
    const POLL_INTERVAL_MS = 8000;
    let getServerUrl = () => '';
    let isModuleActive = () => false;
    let syncPromise = null;
    let syncTimer = null;
    let dirtyTimer = null;

    function serverUrl() {
        return String(getServerUrl() || '').trim();
    }

    function revision() {
        return Number(localStorage.getItem(REVISION_KEY) || 0);
    }

    function isDirty() {
        return localStorage.getItem(DIRTY_KEY) === '1';
    }

    function operationId() {
        let value = localStorage.getItem(OPERATION_KEY) || '';
        if (!value) {
            value = global.crypto?.randomUUID?.() || `etq_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            localStorage.setItem(OPERATION_KEY, value);
        }
        return value;
    }

    function setStatus(status, message) {
        global.AloL42Module?.setCloudStatus?.(status, message);
    }

    function markConfirmed(nextRevision) {
        localStorage.setItem(REVISION_KEY, String(Number(nextRevision || 0)));
        localStorage.setItem(DIRTY_KEY, '0');
        localStorage.removeItem(OPERATION_KEY);
    }

    function markDirty({ immediate = false } = {}) {
        localStorage.setItem(DIRTY_KEY, '1');
        setStatus(navigator.onLine ? 'pending' : 'offline', navigator.onLine ? 'Alterações aguardando envio' : 'Offline · alterações guardadas');
        clearTimeout(dirtyTimer);
        dirtyTimer = setTimeout(() => sync().catch(() => {}), immediate ? 0 : 700);
    }

    async function readJsonResponse(response) {
        const body = await response.text();
        try { return JSON.parse(body); }
        catch (error) {
            throw new Error('A nuvem devolveu uma resposta inválida para Etiquetas.');
        }
    }

    function request(url, options = {}) {
        return global.AloCloud?.isEndpoint?.(url)
            ? global.AloCloud.fetch(url, options)
            : fetch(url, options);
    }

    async function requestRemote(baseRevision) {
        const url = new URL(serverUrl());
        url.searchParams.set('action', 'carregar_etiquetas_banco');
        url.searchParams.set('revision', String(baseRevision));
        url.searchParams.set('_', String(Date.now()));
        const response = await request(url.toString(), { cache: 'no-store', redirect: 'follow' });
        if (!response.ok) throw new Error(`Servidor indisponível (${response.status}).`);
        const result = await readJsonResponse(response);
        if (result.status !== 'ok') throw new Error(result.message || 'Não foi possível carregar Etiquetas.');
        return result;
    }

    async function saveRemote(bank, expectedRevision, reuseOperation = true) {
        const response = await request(serverUrl(), {
            method: 'POST',
            redirect: 'follow',
            body: JSON.stringify({
                action: 'salvar_etiquetas_banco',
                dados: bank,
                expectedRevision,
                operationId: reuseOperation ? operationId() : (global.crypto?.randomUUID?.() || `etq_${Date.now()}`)
            })
        });
        if (!response.ok) throw new Error(`Servidor indisponível (${response.status}).`);
        return readJsonResponse(response);
    }

    async function mergeAndSave(remote, baseRevision) {
        const merged = await global.AloL42Module.mergeCloudData(remote);
        if (!merged?.bank) {
            markConfirmed(baseRevision);
            return baseRevision;
        }
        if (!merged.needsUpload) {
            markConfirmed(baseRevision);
            return baseRevision;
        }
        localStorage.setItem(DIRTY_KEY, '1');
        const saved = await saveRemote(merged.bank, baseRevision);
        if (saved.status === 'conflict') return resolveConflict(saved);
        if (saved.status !== 'ok') throw new Error(saved.message || 'Não foi possível salvar Etiquetas.');
        markConfirmed(saved.revision);
        return saved.revision;
    }

    async function resolveConflict(conflict) {
        const merged = await global.AloL42Module.mergeCloudData(conflict.dados);
        localStorage.removeItem(OPERATION_KEY);
        if (!merged?.needsUpload) {
            markConfirmed(conflict.revision);
            return conflict.revision;
        }
        const retry = await saveRemote(merged.bank, conflict.revision);
        if (retry.status !== 'ok') throw new Error('Os dados mudaram novamente durante a sincronização. Tentaremos de novo.');
        markConfirmed(retry.revision);
        return retry.revision;
    }

    async function performSync() {
        const url = serverUrl();
        if (!url) {
            setStatus('local', 'Conecte a conta da nuvem nas configurações');
            return false;
        }
        if (!navigator.onLine) {
            setStatus('offline', isDirty() ? 'Offline · alterações guardadas' : 'Offline');
            return false;
        }
        setStatus('syncing', 'Sincronizando Etiquetas...');
        const localRevision = revision();
        const remote = await requestRemote(localRevision);
        if (remote.changed && remote.dados) {
            await mergeAndSave(remote.dados, Number(remote.revision || 0));
        } else if (isDirty() || Number(remote.revision || 0) === 0) {
            const bank = await global.AloL42Module.getBackup();
            const saved = await saveRemote(bank, Number(remote.revision || localRevision || 0));
            if (saved.status === 'conflict') await resolveConflict(saved);
            else if (saved.status === 'ok') markConfirmed(saved.revision);
            else throw new Error(saved.message || 'Não foi possível salvar Etiquetas.');
        } else {
            markConfirmed(remote.revision);
        }
        setStatus('ok', 'Etiquetas sincronizadas');
        return true;
    }

    function sync() {
        if (syncPromise) return syncPromise;
        syncPromise = performSync().catch(error => {
            setStatus(navigator.onLine ? 'error' : 'offline', error.message || 'Falha ao sincronizar Etiquetas');
            throw error;
        }).finally(() => { syncPromise = null; });
        return syncPromise;
    }

    function startPolling() {
        clearInterval(syncTimer);
        syncTimer = setInterval(() => {
            if (isDirty() || isModuleActive()) sync().catch(() => {});
        }, POLL_INTERVAL_MS);
    }

    function configure(options = {}) {
        if (typeof options.getServerUrl === 'function') getServerUrl = options.getServerUrl;
        if (typeof options.isModuleActive === 'function') isModuleActive = options.isModuleActive;
        startPolling();
        global.addEventListener('online', () => sync().catch(() => {}));
        global.addEventListener('offline', () => setStatus('offline', isDirty() ? 'Offline · alterações guardadas' : 'Offline'));
        setStatus(isDirty() ? 'pending' : 'local', isDirty() ? 'Alterações aguardando envio' : 'Abra Etiquetas para sincronizar');
        return isDirty() ? sync().catch(() => false) : Promise.resolve(true);
    }

    global.AloEtiquetasCloud = Object.freeze({ configure, sync, markDirty, isDirty, revision });
})(window);
