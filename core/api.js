(function (global) {
    function buildUrl(baseUrl, params = {}) {
        const url = new URL(baseUrl);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
        });
        url.searchParams.set('cb', Date.now().toString());
        return url.toString();
    }

    function request(url, options = {}) {
        return global.AloCloud?.isEndpoint?.(url)
            ? global.AloCloud.fetch(url, options)
            : fetch(url, options);
    }

    async function readJson(response, fallbackMessage) {
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; }
        catch (error) { throw new Error('A nuvem devolveu uma resposta inválida.'); }
        if (!response.ok) throw new Error(data?.message || fallbackMessage || 'Servidor indisponível.');
        return data;
    }

    async function post(baseUrl, payload) {
        if (!baseUrl) throw new Error('Conecte a conta da nuvem nas configurações.');
        const response = await request(baseUrl, {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        return readJson(response, 'A nuvem não confirmou a gravação.');
    }

    async function sync(baseUrl, revision) {
        const response = await request(buildUrl(baseUrl, { action: 'sincronizar', revision }), { cache: 'no-store' });
        return readJson(response, 'Servidor indisponível.');
    }

    async function getBank(baseUrl) {
        const response = await request(buildUrl(baseUrl, { action: 'carregar_banco' }), { cache: 'no-store' });
        return readJson(response, 'Não foi possível carregar o cardápio.');
    }

    async function getHistory(baseUrl, start, end) {
        const response = await request(buildUrl(baseUrl, { action: 'historico', start, end }), { cache: 'no-store' });
        return readJson(response, 'Não foi possível carregar o histórico.');
    }

    async function syncActivities(baseUrl, revision) {
        const response = await request(buildUrl(baseUrl, { action: 'sincronizar_atividades', revision }), { cache: 'no-store' });
        return readJson(response, 'Não foi possível sincronizar as tarefas.');
    }

    async function getActivityHistory(baseUrl, start, end) {
        const response = await request(buildUrl(baseUrl, { action: 'historico_atividades', start, end }), { cache: 'no-store' });
        return readJson(response, 'Não foi possível carregar o histórico de tarefas.');
    }

    async function uploadTaskPhoto(baseUrl, taskId, dataUrl) {
        return post(baseUrl, { action: 'salvar_foto_tarefa', tarefaId: taskId, imagem: dataUrl });
    }

    async function deleteTaskPhoto(baseUrl, taskId) {
        return post(baseUrl, { action: 'excluir_foto_tarefa', tarefaId: taskId });
    }

    async function getTaskPhoto(baseUrl, taskId) {
        const response = await request(buildUrl(baseUrl, { action: 'foto_tarefa', tarefaId: taskId }), { cache: 'no-store' });
        return readJson(response, 'Não foi possível carregar a foto.');
    }

    async function uploadChecklistDocument(baseUrl, documentId, dataUrl, fileName) {
        return post(baseUrl, { action: 'salvar_arquivo_documento', documentoId: documentId, arquivo: dataUrl, nomeArquivo: fileName });
    }

    async function deleteChecklistDocument(baseUrl, documentId) {
        return post(baseUrl, { action: 'excluir_arquivo_documento', documentoId: documentId });
    }

    async function getChecklistDocumentFile(baseUrl, documentId, includeData = true) {
        const response = await request(buildUrl(baseUrl, { action: 'arquivo_documento', documentoId: documentId, dados: includeData ? '1' : '0' }), { cache: 'no-store' });
        return readJson(response, 'Não foi possível carregar o documento.');
    }

    async function getMigrationStatus(baseUrl, migrationId) {
        const response = await request(buildUrl(baseUrl, { action: 'status_migracao', migrationId }), { cache: 'no-store' });
        return readJson(response, 'Não foi possível conferir a migração.');
    }

    async function migrateBackup(baseUrl, payload, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
        const immediate = await post(baseUrl, { action: 'importar_backup', ...payload });
        if (immediate && ['ok', 'error', 'conflict'].includes(immediate.status)) return immediate;
        for (let attempt = 0; attempt < 120; attempt += 1) {
            await wait(attempt === 0 ? 500 : 1000);
            const report = await getMigrationStatus(baseUrl, payload.migrationId);
            if (report && ['ok', 'error', 'conflict'].includes(report.status)) return report;
        }
        throw new Error('A migração demorou além do esperado. Tente conferir novamente.');
    }

    global.AloApi = Object.freeze({ buildUrl, post, sync, getBank, getHistory, syncActivities, getActivityHistory, uploadTaskPhoto, deleteTaskPhoto, getTaskPhoto, uploadChecklistDocument, deleteChecklistDocument, getChecklistDocumentFile, getMigrationStatus, migrateBackup });
})(window);
