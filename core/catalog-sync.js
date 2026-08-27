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

    function isEqual(bank, data) {
        return JSON.stringify(comparable(bank)) === JSON.stringify(comparable(data));
    }

    async function publish({ api, url, data, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
        const current = await api.getBank(url);
        if (!current || Array.isArray(current) || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, '_revision')) {
            throw new Error('Banco incompativel.');
        }
        const sharedSupported = Boolean(current._capabilities?.dadosCompartilhados);
        const dataForServer = sharedSupported ? data : { ...data };
        if (!sharedSupported) delete dataForServer.coreCompartilhado;
        if (isEqual(current, dataForServer)) {
            return { confirmed: true, revision: Number(current._revision || 0), sent: false, sharedSupported };
        }

        await api.post(url, {
            action: 'salvar_banco',
            dados: dataForServer,
            expectedRevision: Number(current._revision || 0)
        });
        await wait(650);
        const confirmed = await api.getBank(url);
        return {
            confirmed: isEqual(confirmed, dataForServer),
            revision: Number(confirmed && confirmed._revision || 0),
            sent: true,
            sharedSupported
        };
    }

    global.AloCatalogSync = Object.freeze({ isEqual, publish });
})(window);
