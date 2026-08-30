(function (global) {
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
            configs: bank.configs || {}
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

    function isEqual(bank, data) {
        const remote = comparable(bank);
        const desired = comparable(data);
        const remoteTasks = new Map((Array.isArray(remote.tarefas) ? remote.tarefas : []).map(task => [String(task?.id || ''), canonical(task)]));
        const desiredTasksConfirmed = (Array.isArray(desired.tarefas) ? desired.tarefas : []).every(task => {
            const confirmed = remoteTasks.get(String(task?.id || ''));
            return confirmed && JSON.stringify(confirmed) === JSON.stringify(canonical(task));
        });
        if (!desiredTasksConfirmed) return false;
        remote.tarefas = [];
        desired.tarefas = [];
        return JSON.stringify(canonical(remote)) === JSON.stringify(canonical(desired));
    }

    async function publish({ api, url, data, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
        let sent = false;
        let sharedSupported = false;
        let lastRevision = 0;
        for (let publishAttempt = 0; publishAttempt < 2; publishAttempt += 1) {
            const current = await api.getBank(url);
            if (!current || Array.isArray(current) || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, '_revision')) {
                throw new Error('Banco incompatível.');
            }
            lastRevision = Number(current._revision || 0);
            sharedSupported = Boolean(current._capabilities?.dadosCompartilhados);
            const dataForServer = sharedSupported ? data : { ...data };
            if (!sharedSupported) delete dataForServer.coreCompartilhado;
            if (isEqual(current, dataForServer)) {
                return { confirmed:true, revision:lastRevision, sent, sharedSupported };
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
                lastRevision = Number(confirmed?._revision || lastRevision);
                if (isEqual(confirmed, dataForServer)) {
                    return { confirmed:true, revision:lastRevision, sent:true, sharedSupported };
                }
            }
        }
        return { confirmed:false, revision:lastRevision, sent, sharedSupported };
    }

    global.AloCatalogSync = Object.freeze({ isEqual, publish });
})(window);
