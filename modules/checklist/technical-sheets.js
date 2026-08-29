(function (global) {
    const STORAGE_KEY = 'alo_checklist_technical_sheets_v1';
    const POLL_MS = 9000;
    let deps = { getUrl: () => '', getAreas: () => [], openModalTop: null };
    let state = loadState();
    let purchaseProducts = [];
    let formIngredients = [];
    let syncPromise = null;
    let pollTimer = null;

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function id(prefix) { return `${prefix}_${global.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`; }
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
    }
    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return {
                sheets: Array.isArray(saved.sheets) ? saved.sheets.map(normalizeSheet) : [],
                outbox: Array.isArray(saved.outbox) ? saved.outbox : [],
                revision: Number(saved.revision || 0)
            };
        } catch (error) { return { sheets: [], outbox: [], revision: 0 }; }
    }
    function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    function normalizeSheet(sheet) {
        const source = sheet && typeof sheet === 'object' ? sheet : {};
        return {
            id: String(source.id || id('ficha')),
            nome: String(source.nome || ''),
            categoria: String(source.categoria || ''),
            setorId: String(source.setorId || ''),
            rendimento: Number(source.rendimento || 0),
            rendimentoUnidade: String(source.rendimentoUnidade || 'g'),
            porcao: Number(source.porcao || 0),
            porcaoUnidade: String(source.porcaoUnidade || 'g'),
            precoVenda: Number(source.precoVenda || 0),
            cmvDesejado: Number(source.cmvDesejado || 30),
            ingredientes: Array.isArray(source.ingredientes) ? source.ingredientes.map(item => ({
                id: String(item.id || id('insumo')),
                produtoId: String(item.produtoId || ''),
                nome: String(item.nome || ''),
                quantidade: Number(item.quantidade || 0),
                unidade: String(item.unidade || 'g'),
                perda: Math.max(0, Math.min(95, Number(item.perda || 0)))
            })) : [],
            preparo: String(source.preparo || ''),
            atualizadoEm: Number(source.atualizadoEm || Date.now()),
            revisao: Number(source.revisao || 1),
            excluida: source.excluida === true
        };
    }
    function activeSheets() { return state.sheets.filter(sheet => !sheet.excluida); }
    function areaName(areaId) {
        const area = deps.getAreas().find(item => item.id === areaId);
        return area ? `${area.emoji || '📍'} ${area.nome}` : 'Sem setor';
    }
    function setSyncStatus(status, title) {
        const indicator = document.getElementById('technicalSheetSyncState');
        if (!indicator) return;
        indicator.className = `technical-sheet-sync-state ${status || ''}`;
        indicator.title = title || '';
    }

    async function refreshPurchaseProducts() {
        try {
            const data = await global.AloSharedData?.getModuleData?.('compras');
            const bank = data?.dados || data || {};
            purchaseProducts = (Array.isArray(bank.produtos) ? bank.produtos : []).filter(product => product && product.ativo !== false);
        } catch (error) { purchaseProducts = purchaseProducts || []; }
        return purchaseProducts;
    }
    function priceTimestamp(record) {
        const numeric = Number(record?.atualizadoEm || record?.criadoEm || record?.timestamp || 0);
        if (numeric) return numeric;
        const parsed = Date.parse(record?.data || '');
        return Number.isFinite(parsed) ? parsed : 0;
    }
    function latestPrice(product) {
        const prices = (Array.isArray(product?.historicoPrecos) ? product.historicoPrecos : [])
            .filter(record => Number(record?.preco) > 0)
            .sort((left, right) => priceTimestamp(right) - priceTimestamp(left));
        return prices[0] || null;
    }
    function unitInfo(unit) {
        const normalized = String(unit || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const units = {
            g: ['massa', 1], grama: ['massa', 1], gramas: ['massa', 1],
            kg: ['massa', 1000], quilo: ['massa', 1000], quilos: ['massa', 1000],
            ml: ['volume', 1], l: ['volume', 1000], litro: ['volume', 1000], litros: ['volume', 1000],
            un: ['unidade', 1], unidade: ['unidade', 1], unidades: ['unidade', 1]
        };
        return units[normalized] || ['livre', 1, normalized];
    }
    function convertQuantity(quantity, fromUnit, toUnit) {
        const from = unitInfo(fromUnit);
        const to = unitInfo(toUnit);
        if (from[0] !== to[0]) return null;
        if (from[0] === 'livre' && from[2] !== to[2]) return null;
        return Number(quantity || 0) * from[1] / to[1];
    }
    function calculate(sheet) {
        let total = 0;
        const missing = [];
        const details = sheet.ingredientes.map(ingredient => {
            const product = purchaseProducts.find(item => String(item.id) === String(ingredient.produtoId));
            const price = latestPrice(product);
            const gross = ingredient.quantidade / Math.max(.05, 1 - ingredient.perda / 100);
            if (!product || !price) {
                missing.push(ingredient.nome || 'Insumo sem nome');
                return { ...ingredient, cost: null, price: null };
            }
            const priceQuantity = convertQuantity(gross, ingredient.unidade, price.unidade || ingredient.unidade);
            if (priceQuantity === null) {
                missing.push(`${ingredient.nome} · conferir unidade`);
                return { ...ingredient, cost: null, price };
            }
            const cost = priceQuantity * Number(price.preco || 0);
            total += cost;
            return { ...ingredient, cost, price };
        });
        const yieldInPortionUnit = convertQuantity(sheet.rendimento, sheet.rendimentoUnidade, sheet.porcaoUnidade);
        const portions = yieldInPortionUnit !== null && sheet.porcao > 0 ? yieldInPortionUnit / sheet.porcao : 0;
        const portionCost = portions > 0 ? total / portions : 0;
        const cmv = sheet.precoVenda > 0 ? portionCost / sheet.precoVenda * 100 : 0;
        const suggested = sheet.cmvDesejado > 0 ? portionCost / (sheet.cmvDesejado / 100) : 0;
        return { total, portions, portionCost, cmv, suggested, missing, details };
    }
    function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }

    function showView(view) {
        const sheets = view === 'sheets';
        document.querySelector('#tasksModule .tasks-toolbar').style.display = sheets ? 'none' : '';
        document.querySelector('#tasksModule .tasks-scroll').style.display = sheets ? 'none' : '';
        document.getElementById('technicalSheetsView').style.display = sheets ? 'block' : 'none';
        document.getElementById('checklistActivitiesTab').classList.toggle('active', !sheets);
        document.getElementById('checklistSheetsTab').classList.toggle('active', sheets);
        document.getElementById('checklistActivitiesTab').setAttribute('aria-selected', String(!sheets));
        document.getElementById('checklistSheetsTab').setAttribute('aria-selected', String(sheets));
        if (sheets) { refreshPurchaseProducts().then(render); syncNow().catch(() => {}); render(); }
    }
    function openManager() {
        document.getElementById('modalConfigTasksMenu').style.display = 'none';
        global.AloTasks?.openModule?.('tasks');
        showView('sheets');
    }
    function render() {
        const list = document.getElementById('technicalSheetsList');
        if (!list) return;
        const query = String(document.getElementById('technicalSheetsSearch')?.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const visible = activeSheets().filter(sheet => !query || `${sheet.nome} ${sheet.categoria} ${areaName(sheet.setorId)}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query));
        const incomplete = visible.filter(sheet => calculate(sheet).missing.length).length;
        document.getElementById('technicalSheetsSummary').textContent = `${visible.length} ${visible.length === 1 ? 'ficha' : 'fichas'}${incomplete ? ` · ${incomplete} com custo incompleto` : ''}`;
        list.innerHTML = visible.length ? visible.sort((a, b) => a.nome.localeCompare(b.nome)).map(sheet => {
            const cost = calculate(sheet);
            return `<button class="technical-sheet-card" type="button" onclick="AloTechnicalSheets.openDetail('${escapeHtml(sheet.id)}')"><span class="technical-sheet-card-icon">🍽️</span><span class="technical-sheet-card-copy"><strong>${escapeHtml(sheet.nome)}</strong><span>${escapeHtml(sheet.categoria || 'Sem categoria')} · ${escapeHtml(areaName(sheet.setorId))}</span><small>${escapeHtml(sheet.rendimento)} ${escapeHtml(sheet.rendimentoUnidade)} · ${cost.portions ? `${cost.portions.toLocaleString('pt-BR', { maximumFractionDigits:1 })} porções` : 'rendimento cadastrado'}</small></span><span class="technical-sheet-card-cost ${cost.missing.length ? 'incomplete' : ''}">${cost.missing.length ? 'Custo incompleto' : money(cost.portionCost)}</span></button>`;
        }).join('') : '<div class="tasks-empty">Nenhuma ficha técnica cadastrada.</div>';
    }

    function areaOptions(selected) {
        return deps.getAreas().filter(area => area.ativo !== false).map(area => `<option value="${escapeHtml(area.id)}" ${area.id === selected ? 'selected' : ''}>${escapeHtml(area.emoji || '📍')} ${escapeHtml(area.nome)}</option>`).join('');
    }
    function productOptions() {
        return purchaseProducts.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome))).map(product => `<option value="${escapeHtml(product.nome)}"></option>`).join('');
    }
    function readIngredients() {
        return [...document.querySelectorAll('#technicalSheetIngredients .technical-ingredient-row')].map(row => {
            const name = row.querySelector('[data-ingredient-name]').value.trim();
            const product = purchaseProducts.find(item => String(item.nome).toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
            return {
                id: row.dataset.ingredientId || id('insumo'), produtoId: product?.id || '', nome: product?.nome || name,
                quantidade: Number(row.querySelector('[data-ingredient-quantity]').value || 0),
                unidade: row.querySelector('[data-ingredient-unit]').value || 'g',
                perda: Number(row.querySelector('[data-ingredient-loss]').value || 0)
            };
        }).filter(item => item.nome || item.quantidade);
    }
    function renderIngredients() {
        const container = document.getElementById('technicalSheetIngredients');
        if (!formIngredients.length) formIngredients = [{ id:id('insumo'), produtoId:'', nome:'', quantidade:0, unidade:'g', perda:0 }];
        container.innerHTML = `<datalist id="technicalProductOptions">${productOptions()}</datalist>` + formIngredients.map(ingredient => `<div class="technical-ingredient-row" data-ingredient-id="${escapeHtml(ingredient.id)}"><div><label>Produto de Compras ou insumo</label><input data-ingredient-name list="technicalProductOptions" value="${escapeHtml(ingredient.nome)}" oninput="AloTechnicalSheets.previewCost()"></div><div><label>Quantidade</label><input data-ingredient-quantity type="number" min="0" step="0.01" inputmode="decimal" value="${ingredient.quantidade || ''}" oninput="AloTechnicalSheets.previewCost()"></div><div><label>Unidade</label><select data-ingredient-unit onchange="AloTechnicalSheets.previewCost()">${['g','kg','ml','L','un'].map(unit => `<option ${ingredient.unidade === unit ? 'selected' : ''}>${unit}</option>`).join('')}</select></div><div class="technical-loss"><label>Perda %</label><input data-ingredient-loss type="number" min="0" max="95" step="1" value="${ingredient.perda || 0}" oninput="AloTechnicalSheets.previewCost()"></div><button type="button" onclick="AloTechnicalSheets.removeIngredient('${escapeHtml(ingredient.id)}')" aria-label="Remover ingrediente">×</button></div>`).join('');
    }
    function draftFromForm() {
        return normalizeSheet({
            id: document.getElementById('technicalSheetId').value || id('ficha'),
            nome: document.getElementById('technicalSheetName').value.trim(),
            categoria: document.getElementById('technicalSheetCategory').value.trim(),
            setorId: document.getElementById('technicalSheetArea').value,
            rendimento: document.getElementById('technicalSheetYield').value,
            rendimentoUnidade: document.getElementById('technicalSheetYieldUnit').value,
            porcao: document.getElementById('technicalSheetPortion').value,
            porcaoUnidade: document.getElementById('technicalSheetPortionUnit').value,
            precoVenda: document.getElementById('technicalSheetSalePrice').value,
            cmvDesejado: document.getElementById('technicalSheetTargetCmv').value,
            ingredientes: readIngredients(), preparo: document.getElementById('technicalSheetPreparation').value
        });
    }
    function previewCost() {
        const target = document.getElementById('technicalSheetCostPreview');
        if (!target) return;
        const cost = calculate(draftFromForm());
        target.innerHTML = `<div class="technical-cost-metric"><small>Custo do lote</small><strong>${money(cost.total)}</strong></div><div class="technical-cost-metric"><small>Custo por porção</small><strong>${money(cost.portionCost)}</strong></div><div class="technical-cost-metric"><small>CMV atual</small><strong>${cost.cmv ? `${cost.cmv.toFixed(1)}%` : '—'}</strong></div><div class="technical-cost-metric"><small>Preço sugerido</small><strong>${cost.suggested ? money(cost.suggested) : '—'}</strong></div>${cost.missing.length ? `<div class="technical-cost-warning">Custo incompleto: ${escapeHtml(cost.missing.join(', '))}. Cadastre preço e unidade em Lista de Compras.</div>` : ''}`;
    }
    async function openForm(sheetId = '') {
        await refreshPurchaseProducts();
        const sheet = state.sheets.find(item => item.id === sheetId && !item.excluida) || normalizeSheet({ id:id('ficha'), cmvDesejado:30, ingredientes:[] });
        document.getElementById('technicalSheetTitle').textContent = sheetId ? 'Editar Ficha Técnica' : 'Nova Ficha Técnica';
        document.getElementById('technicalSheetId').value = sheet.id;
        document.getElementById('technicalSheetName').value = sheet.nome;
        document.getElementById('technicalSheetCategory').value = sheet.categoria;
        document.getElementById('technicalSheetArea').innerHTML = areaOptions(sheet.setorId);
        document.getElementById('technicalSheetYield').value = sheet.rendimento || '';
        document.getElementById('technicalSheetYieldUnit').value = sheet.rendimentoUnidade;
        document.getElementById('technicalSheetPortion').value = sheet.porcao || '';
        document.getElementById('technicalSheetPortionUnit').value = sheet.porcaoUnidade;
        document.getElementById('technicalSheetSalePrice').value = sheet.precoVenda || '';
        document.getElementById('technicalSheetTargetCmv').value = sheet.cmvDesejado || 30;
        document.getElementById('technicalSheetPreparation').value = sheet.preparo;
        document.getElementById('technicalSheetDelete').style.display = sheetId ? 'block' : 'none';
        formIngredients = clone(sheet.ingredientes);
        renderIngredients(); previewCost();
        deps.openModalTop?.('modalTechnicalSheet') || (document.getElementById('modalTechnicalSheet').style.display = 'flex');
    }
    function closeForm() { document.getElementById('modalTechnicalSheet').style.display = 'none'; }
    function addIngredient() { formIngredients = readIngredients(); formIngredients.push({ id:id('insumo'), produtoId:'', nome:'', quantidade:0, unidade:'g', perda:0 }); renderIngredients(); }
    function removeIngredient(ingredientId) { formIngredients = readIngredients().filter(item => item.id !== ingredientId); renderIngredients(); previewCost(); }
    function queueSheet(sheet) {
        state.sheets = state.sheets.filter(item => item.id !== sheet.id).concat(sheet);
        state.outbox = state.outbox.filter(item => item.ficha.id !== sheet.id).concat({ operationId:id('op'), ficha:clone(sheet) });
        saveState(); render(); setSyncStatus('syncing', 'Alterações aguardando envio');
        syncNow().catch(() => {});
    }
    function saveForm() {
        const draft = draftFromForm();
        if (!draft.nome || !draft.setorId) return global.AloUiDialog?.notice('Informe o nome e o setor da ficha.', { title:'Dados necessários', confirmText:'Entendi' });
        if (!draft.rendimento || !draft.porcao) return global.AloUiDialog?.notice('Informe o rendimento e o tamanho da porção.', { title:'Rendimento necessário', confirmText:'Entendi' });
        if (!draft.ingredientes.length) return global.AloUiDialog?.notice('Adicione pelo menos um ingrediente.', { title:'Ingrediente necessário', confirmText:'Entendi' });
        const current = state.sheets.find(item => item.id === draft.id);
        draft.revisao = Number(current?.revisao || 0) + 1;
        draft.atualizadoEm = Date.now();
        queueSheet(draft); closeForm(); showView('sheets');
    }
    async function deleteCurrent() {
        const current = state.sheets.find(item => item.id === document.getElementById('technicalSheetId').value);
        if (!current) return;
        const confirmed = await global.AloUiDialog?.confirm(`Excluir a ficha “${current.nome}”?`, { title:'Excluir ficha', icon:'×', tone:'danger', confirmText:'Excluir' });
        if (!confirmed) return;
        queueSheet({ ...current, excluida:true, revisao:Number(current.revisao || 0) + 1, atualizadoEm:Date.now() });
        closeForm();
    }
    function openDetail(sheetId) {
        const sheet = state.sheets.find(item => item.id === sheetId && !item.excluida);
        if (!sheet) return;
        const cost = calculate(sheet);
        document.getElementById('technicalSheetDetailTitle').textContent = sheet.nome;
        document.getElementById('technicalSheetDetailBody').innerHTML = `<div class="technical-detail-summary"><div><small>Rendimento</small><strong>${escapeHtml(sheet.rendimento)} ${escapeHtml(sheet.rendimentoUnidade)}</strong></div><div><small>Custo do lote</small><strong>${cost.missing.length ? 'Incompleto' : money(cost.total)}</strong></div><div><small>Custo por porção</small><strong>${cost.missing.length ? 'Incompleto' : money(cost.portionCost)}</strong></div></div><h3>Ingredientes</h3><ul class="technical-detail-list">${cost.details.map(item => `<li><strong>${escapeHtml(item.nome)}</strong> · ${escapeHtml(item.quantidade)} ${escapeHtml(item.unidade)}${item.perda ? ` · perda ${item.perda}%` : ''}${item.cost !== null ? ` · ${money(item.cost)}` : ' · sem custo'}</li>`).join('')}</ul><h3>Preparo</h3><ol class="technical-detail-list">${String(sheet.preparo || 'Preparo não informado.').split(/\r?\n/).filter(Boolean).map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>${cost.missing.length ? `<div class="technical-cost-warning">O total não inclui: ${escapeHtml(cost.missing.join(', '))}.</div>` : ''}`;
        document.getElementById('technicalSheetDetailEdit').onclick = () => { document.getElementById('modalTechnicalSheetDetail').style.display = 'none'; openForm(sheet.id); };
        deps.openModalTop?.('modalTechnicalSheetDetail') || (document.getElementById('modalTechnicalSheetDetail').style.display = 'flex');
    }

    function mergeRemote(remote) {
        const remoteById = new Map((Array.isArray(remote) ? remote : []).map(normalizeSheet).map(sheet => [sheet.id, sheet]));
        const local = new Map(state.sheets.map(sheet => [sheet.id, sheet]));
        remoteById.forEach(sheet => {
            const current = local.get(sheet.id);
            const pending = state.outbox.some(item => item.ficha.id === sheet.id && Number(item.ficha.revisao) > Number(sheet.revisao));
            if (!pending && (!current || Number(sheet.revisao) > Number(current.revisao) || (Number(sheet.revisao) === Number(current.revisao) && sheet.atualizadoEm > current.atualizadoEm))) local.set(sheet.id, sheet);
        });
        state.sheets = [...local.values()];
        state.outbox = state.outbox.filter(operation => {
            const confirmed = remoteById.get(operation.ficha.id);
            return !confirmed || Number(confirmed.revisao) < Number(operation.ficha.revisao);
        });
    }
    async function getRemote(revision) {
        const url = new URL(deps.getUrl());
        url.searchParams.set('action', 'sincronizar_fichas_tecnicas');
        if (revision !== '') url.searchParams.set('revision', String(revision));
        url.searchParams.set('cb', String(Date.now()));
        const response = await fetch(url.toString(), { cache:'no-store' });
        if (!response.ok) throw new Error('Servidor indisponível.');
        const result = await response.json();
        if (result.status !== 'ok') throw new Error(result.message || 'Fichas não sincronizadas.');
        return result;
    }
    async function performSync() {
        if (!deps.getUrl() || !navigator.onLine) { setSyncStatus('error', 'Sem conexão com o servidor'); return false; }
        setSyncStatus('syncing', 'Sincronizando fichas técnicas');
        if (state.outbox.length) {
            await global.AloApi.post(deps.getUrl(), { action:'salvar_fichas_tecnicas_lote', operacoes:state.outbox.slice(0, 30) });
            for (let attempt = 0; attempt < 5 && state.outbox.length; attempt += 1) {
                await new Promise(resolve => setTimeout(resolve, 500 + (attempt * 250)));
                const confirmation = await getRemote('');
                mergeRemote(confirmation.fichas || []);
                state.revision = Number(confirmation.revision || state.revision);
            }
        }
        const result = await getRemote(state.revision);
        if (result.changed) mergeRemote(result.fichas || []);
        state.revision = Number(result.revision || state.revision);
        saveState(); render();
        setSyncStatus(state.outbox.length ? 'syncing' : 'ok', state.outbox.length ? 'Alterações aguardando confirmação' : 'Fichas técnicas sincronizadas');
        return !state.outbox.length;
    }
    function syncNow() {
        if (syncPromise) return syncPromise;
        syncPromise = performSync().catch(error => { setSyncStatus('error', error.message); throw error; }).finally(() => { syncPromise = null; });
        return syncPromise;
    }
    function configure(options = {}) {
        deps = { ...deps, ...options };
        clearInterval(pollTimer);
        pollTimer = setInterval(() => {
            if (state.outbox.length || document.getElementById('technicalSheetsView')?.style.display !== 'none') syncNow().catch(() => {});
        }, POLL_MS);
        render();
    }
    function getBackup() { return { schemaVersion:1, ...clone(state) }; }
    function restoreBackup(backup) {
        if (!backup || !Array.isArray(backup.sheets)) return false;
        state = { sheets:backup.sheets.map(normalizeSheet), outbox:Array.isArray(backup.outbox) ? backup.outbox : [], revision:Number(backup.revision || 0) };
        saveState(); render(); return true;
    }

    global.AloTechnicalSheets = Object.freeze({
        configure, showView, openManager, render, openForm, closeForm, addIngredient, removeIngredient,
        previewCost, saveForm, deleteCurrent, openDetail, syncNow, getBackup, restoreBackup, calculate
    });
})(window);
