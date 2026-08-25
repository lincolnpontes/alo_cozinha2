(function (global) {
    const STORAGE_KEY = 'alofeira_v1';
    let getServerUrl = () => '';

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
            const frame = document.getElementById('feiraFrame');
            if (frame?.getAttribute('src')) frame.contentWindow.location.reload();
        }
        return changed;
    }

    function reloadFrame() {
        const frame = document.getElementById('feiraFrame');
        if (!frame) return;
        const source = frame.dataset.src || 'modules/alo-feira/index.html?v=2.1.0';
        if (!frame.getAttribute('src')) frame.setAttribute('src', source);
        else frame.contentWindow.location.reload();
    }

    function open() {
        syncServerUrl();
        const frame = document.getElementById('feiraFrame');
        if (!frame) return;
        if (!frame.getAttribute('src')) frame.setAttribute('src', frame.dataset.src);
    }

    function pickImportFile() {
        document.getElementById('feiraImportInput')?.click();
    }

    async function importBackup(event) {
        const input = event.currentTarget;
        const file = input.files && input.files[0];
        if (!file) return;

        try {
            const imported = JSON.parse(await file.text());
            if (!imported || imported.app_id !== 'alofeira') {
                throw new Error('Este arquivo não é um backup válido do Alô Feira.');
            }

            const confirmed = await global.AloUiDialog.confirm(
                'Os dados atuais do módulo Alô Feira neste aparelho serão substituídos. KDS e Checklist não serão alterados.',
                {
                    title: 'Importar dados do Alô Feira',
                    icon: '⬆',
                    confirmText: 'Importar',
                    tone: 'default'
                }
            );
            if (!confirmed) return;

            const current = readBank();
            imported.app_id = 'alofeira';
            imported.schemaVersion = 2;
            imported.configs = imported.configs && typeof imported.configs === 'object' ? imported.configs : {};
            imported.configs.url = unifiedUrl();
            imported.configs.colabAtivoId = current?.configs?.colabAtivoId || null;
            imported.configs.modo = current?.configs?.modo || imported.configs.modo || 'pedido';
            const importedAt = Date.now();
            imported.configs.ultimaMudancaLocal = importedAt;
            imported.configs.atualizadoEm = importedAt;
            imported.configs.backendComControleRevisao = false;
            imported.configs.importacaoInicialPendente = true;
            imported.configs.syncPendente = true;
            imported.restaurante = imported.restaurante && typeof imported.restaurante === 'object' ? imported.restaurante : {};
            imported.restaurante.atualizadoEm = importedAt;
            ['produtos', 'categorias', 'fornecedores', 'colaboradores'].forEach(name => {
                if (!Array.isArray(imported[name])) imported[name] = [];
                imported[name].forEach(item => { if (item && typeof item === 'object') item.atualizadoEm = importedAt; });
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
            reloadFrame();

            await global.AloUiDialog.notice(
                'Dados importados somente para o Alô Feira. A sincronização usará a mesma nuvem dos outros módulos.',
                { title: 'Importação concluída', icon: '✓', confirmText: 'Entendi' }
            );
        } catch (error) {
            await global.AloUiDialog.notice(error.message || 'Não foi possível importar este arquivo.', {
                title: 'Importação não concluída', icon: '!', tone: 'danger', confirmText: 'Entendi'
            });
        } finally {
            input.value = '';
        }
    }

    function configure(options = {}) {
        if (typeof options.getServerUrl === 'function') getServerUrl = options.getServerUrl;
        syncServerUrl();
    }

    global.AloFeiraModule = Object.freeze({ configure, open, pickImportFile, importBackup, syncServerUrl });
})(window);
