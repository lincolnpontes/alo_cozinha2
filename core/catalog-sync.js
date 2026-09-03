(function (global) {
    const RECEIPT_KEY = '_catalogSyncReceipt';

    function comparableConfigs(configs) {
        const clean = { ...(configs || {}) };
        delete clean[RECEIPT_KEY];
        return clean;
    }

    function comparable(bank) {
        return {
            produtos: bank.produtos || [],
            categorias: bank.categorias || [],
            obsPedidos: bank.obsPedidos || [],
            obsCancelamentos: bank.obsCancelamentos || [],
            areas: bank.areas || [],
            setoresTarefas: bank.setoresTarefas || [],
            funcionarios: bank.funcionarios || [],
            tarefas: bank.tarefas || [],
            coreCompartilhado: bank.coreCompartilhado || null,
            configsTarefas: bank.configsTarefas || {},
            configs: comparableConfigs(bank.configs)
        };
    }

    function canonical(value, path = '') {
        if (Array.isArray(value)) {
            const items = value.map(item => canonical(item, path));
            if (path === 'tarefas') {
                return items.sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || '')));
            }
            return items;
        }
        if (!value || typeof value !== 'object') return value;
        return Object.keys(value).sort().reduce((result, key) => {
            result[key] = canonical(value[key], path ? `${path}.${key}` : key);
            return result;
        }, {});
    }

    function taskVersion(task) {
        const value = task?.revisaoDefinicao ?? task?.atualizadoEm ?? 0;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
        const timestamp = Date.parse(String(value || ''));
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function mergeTaskDefinitions(localTasks, remoteTasks) {
        const merged = new Map((Array.isArray(localTasks) ? localTasks : []).filter(task => task?.id).map(task => [String(task.id), task]));
        (Array.isArray(remoteTasks) ? remoteTasks : []).forEach(remote => {
            if (!remote?.id) return;
            const id = String(remote.id);
            const local = merged.get(id);
            if (!local || taskVersion(remote) > taskVersion(local)) merged.set(id, remote);
        });
        return [...merged.values()];
    }

    function isEqual(bank, data) {
        const remote = comparable(bank);
        const desired = comparable(data);
        const remoteTasks = new Map((Array.isArray(remote.tarefas) ? remote.tarefas : []).map(task => [String(task?.id || ''), { value:canonical(task), version:taskVersion(task) }]));
        const desiredTasksConfirmed = (Array.isArray(desired.tarefas) ? desired.tarefas : []).every(task => {
            const confirmed = remoteTasks.get(String(task?.id || ''));
            return confirmed && (
                JSON.stringify(confirmed.value) === JSON.stringify(canonical(task))
                || confirmed.version > taskVersion(task)
            );
        });
        if (!desiredTasksConfirmed) return false;
        remote.tarefas = [];
        desired.tarefas = [];
        return JSON.stringify(canonical(remote)) === JSON.stringify(canonical(desired));
    }

    function createChangeTracker() {
        let revision = 0;
        return Object.freeze({
            mark() { revision += 1; return revision; },
            snapshot() { return revision; },
            unchangedSince(snapshot) { return revision === Number(snapshot); }
        });
    }

    function shouldHydrateRemoteBeforePublish(localBank, remoteBank) {
        const localRevision = Number(localBank?.configs?.revisaoBanco || 0);
        const remoteRevision = Number(remoteBank?._revision || 0);
        const localHasCatalog = (Array.isArray(localBank?.produtos) && localBank.produtos.length > 0)
            || (Array.isArray(localBank?.categorias) && localBank.categorias.length > 0);
        const remoteHasCatalog = (Array.isArray(remoteBank?.produtos) && remoteBank.produtos.length > 0)
            || (Array.isArray(remoteBank?.categorias) && remoteBank.categorias.length > 0);
        return remoteRevision > localRevision && remoteHasCatalog && !localHasCatalog;
    }

    async function publish({ api, url, data, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), createReceipt }) {
        let sent = false;
        let sharedSupported = false;
        let lastRevision = 0;
        let lastBank = null;
        const receipt = typeof createReceipt === 'function'
            ? String(createReceipt())
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        for (let publishAttempt = 0; publishAttempt < 2; publishAttempt += 1) {
            const current = await api.getBank(url);
            if (!current || Array.isArray(current) || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, '_revision')) {
                throw new Error('Banco incompatível.');
            }
            lastBank = current;
            lastRevision = Number(current._revision || 0);
            sharedSupported = Boolean(current._capabilities?.dadosCompartilhados);
            const dataForServer = {
                ...data,
                configs: { ...(data.configs || {}), [RECEIPT_KEY]:receipt }
            };
            if (!sharedSupported) delete dataForServer.coreCompartilhado;
            if (isEqual(current, data)) {
                return { confirmed:true, revision:lastRevision, sent, sharedSupported, bank:current };
            }
            await api.post(url, {
                action: 'salvar_banco',
                dados: dataForServer,
                expectedRevision: lastRevision
            });
            sent = true;
            for (const delay of [250, 550, 900]) {
                await wait(delay);
                const confirmed = await api.getBank(url);
                lastBank = confirmed;
                lastRevision = Number(confirmed?._revision || lastRevision);
                const confirmedReceipt = String(confirmed?.configs?.[RECEIPT_KEY] || '') === receipt;
                if (confirmedReceipt || isEqual(confirmed, dataForServer)) {
                    return { confirmed:true, revision:lastRevision, sent:true, sharedSupported, bank:confirmed };
                }
            }
        }
        return { confirmed:false, revision:lastRevision, sent, sharedSupported, bank:lastBank };
    }

    global.AloCatalogSync = Object.freeze({
        isEqual,
        publish,
        createChangeTracker,
        mergeTaskDefinitions,
        shouldHydrateRemoteBeforePublish
    });
})(window);
