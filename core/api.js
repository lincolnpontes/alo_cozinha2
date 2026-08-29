(function (global) {
    function buildUrl(baseUrl, params = {}) {
        const url = new URL(baseUrl);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
        });
        url.searchParams.set('cb', Date.now().toString());
        return url.toString();
    }

    async function post(baseUrl, payload) {
        if (!baseUrl) throw new Error('URL do servidor não configurada.');
        await fetch(baseUrl, {
            method: 'POST',
            mode: 'no-cors',
            cache: 'no-store',
            body: JSON.stringify(payload)
        });
    }

    async function sync(baseUrl, revision) {
        const response = await fetch(buildUrl(baseUrl, { action: 'sincronizar', revision }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Servidor indisponível.');
        return response.json();
    }

    async function getBank(baseUrl) {
        const response = await fetch(buildUrl(baseUrl, { action: 'carregar_banco' }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível carregar o cardápio.');
        return response.json();
    }

    async function getHistory(baseUrl, start, end) {
        const response = await fetch(buildUrl(baseUrl, { action: 'historico', start, end }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível carregar o histórico.');
        return response.json();
    }

    async function syncActivities(baseUrl, revision) {
        const response = await fetch(buildUrl(baseUrl, { action: 'sincronizar_atividades', revision }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível sincronizar as tarefas.');
        return response.json();
    }

    async function getActivityHistory(baseUrl, start, end) {
        const response = await fetch(buildUrl(baseUrl, { action: 'historico_atividades', start, end }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível carregar o histórico de tarefas.');
        return response.json();
    }

    async function uploadTaskPhoto(baseUrl, taskId, dataUrl) {
        return post(baseUrl, { action: 'salvar_foto_tarefa', tarefaId: taskId, imagem: dataUrl });
    }

    async function deleteTaskPhoto(baseUrl, taskId) {
        return post(baseUrl, { action: 'excluir_foto_tarefa', tarefaId: taskId });
    }

    async function getTaskPhoto(baseUrl, taskId) {
        const response = await fetch(buildUrl(baseUrl, { action: 'foto_tarefa', tarefaId: taskId }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível carregar a foto.');
        return response.json();
    }

    async function uploadChecklistDocument(baseUrl, documentId, dataUrl, fileName) {
        return post(baseUrl, { action: 'salvar_arquivo_documento', documentoId: documentId, arquivo: dataUrl, nomeArquivo: fileName });
    }

    async function deleteChecklistDocument(baseUrl, documentId) {
        return post(baseUrl, { action: 'excluir_arquivo_documento', documentoId: documentId });
    }

    async function getChecklistDocumentFile(baseUrl, documentId, includeData = true) {
        const response = await fetch(buildUrl(baseUrl, { action: 'arquivo_documento', documentoId: documentId, dados: includeData ? '1' : '0' }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível carregar o documento.');
        return response.json();
    }

    async function getMigrationStatus(baseUrl, migrationId) {
        const response = await fetch(buildUrl(baseUrl, { action: 'status_migracao', migrationId }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível conferir a migração.');
        return response.json();
    }

    async function migrateBackup(baseUrl, payload, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
        await post(baseUrl, { action: 'importar_backup', ...payload });
        for (let attempt = 0; attempt < 120; attempt += 1) {
            await wait(attempt === 0 ? 500 : 1000);
            const report = await getMigrationStatus(baseUrl, payload.migrationId);
            if (report && ['ok', 'error', 'conflict'].includes(report.status)) return report;
        }
        throw new Error('A migração demorou além do esperado. Tente conferir novamente.');
    }

    global.AloApi = Object.freeze({ buildUrl, post, sync, getBank, getHistory, syncActivities, getActivityHistory, uploadTaskPhoto, deleteTaskPhoto, getTaskPhoto, uploadChecklistDocument, deleteChecklistDocument, getChecklistDocumentFile, getMigrationStatus, migrateBackup });
})(window);
