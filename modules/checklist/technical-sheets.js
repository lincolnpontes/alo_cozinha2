(function (global) {
    const STORAGE_KEY = 'alo_checklist_technical_sheets_v1';
    const POLL_MS = 9000;
    let deps = { getUrl: () => '', getAreas: () => [], openModalTop: null, onSyncState: null };
    let state = loadState();
    let purchaseProducts = [];
    let formIngredients = [];
    let syncPromise = null;
    let pollTimer = null;
    let pendingPhoto = '';
    let removePhoto = false;
    let ingredientSearchTargetId = '';
    let selectedCategory = 'Todas';
    let managerCategory = 'Todas';
    let formReturnTarget = 'view';
    const photoCache = new Map();

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
            fotoReferencia: source.fotoReferencia === true,
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
        if (indicator) {
            indicator.className = `technical-sheet-sync-state ${status || ''}`;
            indicator.title = title || '';
        }
        deps.onSyncState?.({ status:status || '', title:title || '', pendingCount:state.outbox.length });
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
        const documents = view === 'documents';
        const activities = !sheets && !documents;
        document.querySelector('#tasksModule .tasks-toolbar').style.display = activities ? '' : 'none';
        document.querySelector('#tasksModule .tasks-scroll').style.display = activities ? '' : 'none';
        document.getElementById('technicalSheetsView').style.display = sheets ? 'block' : 'none';
        document.getElementById('checklistDocumentsView').style.display = documents ? 'block' : 'none';
        [['checklistActivitiesTab', activities], ['checklistSheetsTab', sheets], ['checklistDocumentsTab', documents]].forEach(([id, active]) => {
            const button = document.getElementById(id);
            button?.classList.toggle('active', active);
            button?.setAttribute('aria-selected', String(active));
        });
        if (sheets) { refreshPurchaseProducts().then(render); syncNow().catch(() => {}); render(); }
        if (documents) global.AloChecklistDocuments?.activate();
    }
    function openManager() {
        document.getElementById('modalConfigTasksMenu').style.display = 'none';
        formReturnTarget = 'manager';
        renderManager();
        deps.openModalTop?.('modalTechnicalSheetsManager') || (document.getElementById('modalTechnicalSheetsManager').style.display = 'flex');
    }
    function closeManager() {
        document.getElementById('modalTechnicalSheetsManager').style.display = 'none';
        global.AloTasks?.openSettingsMenu?.();
    }
    function normalizedSearch(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
    function categories() {
        return [...new Set(activeSheets().map(sheet => sheet.categoria.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    }
    function categoryButtons(targetId, current, setter) {
        const target = document.getElementById(targetId);
        if (!target) return;
        const values = ['Todas', ...categories()];
        target.innerHTML = values.map(category => {
            const encoded = encodeURIComponent(category).replace(/'/g, '%27');
            return `<button type="button" class="${category === current ? 'active' : ''}" onclick="AloTechnicalSheets.${setter}(decodeURIComponent('${encoded}'))">${escapeHtml(category)}</button>`;
        }).join('');
    }
    function filteredSheets(query, category) {
        const normalizedQuery = normalizedSearch(query);
        return activeSheets().filter(sheet => (category === 'Todas' || sheet.categoria === category)
            && (!normalizedQuery || normalizedSearch(`${sheet.nome} ${sheet.categoria} ${areaName(sheet.setorId)}`).includes(normalizedQuery)));
    }
    function render() {
        const list = document.getElementById('technicalSheetsList');
        if (!list) return;
        categoryButtons('technicalSheetsCategories', selectedCategory, 'setCategory');
        const visible = filteredSheets(document.getElementById('technicalSheetsSearch')?.value, selectedCategory);
        const incomplete = visible.filter(sheet => calculate(sheet).missing.length).length;
        document.getElementById('technicalSheetsSummary').textContent = `${visible.length} ${visible.length === 1 ? 'ficha' : 'fichas'}${incomplete ? ` · ${incomplete} com custo incompleto` : ''}`;
        list.innerHTML = visible.length ? visible.sort((a, b) => a.nome.localeCompare(b.nome)).map(sheet => {
            const cost = calculate(sheet);
            return `<button class="technical-sheet-card" type="button" onclick="AloTechnicalSheets.openDetail('${escapeHtml(sheet.id)}')"><span class="technical-sheet-card-icon">🍽️</span><span class="technical-sheet-card-copy"><strong>${escapeHtml(sheet.nome)}</strong><span>${escapeHtml(sheet.categoria || 'Sem categoria')} · ${escapeHtml(areaName(sheet.setorId))}</span><small>${escapeHtml(sheet.rendimento)} ${escapeHtml(sheet.rendimentoUnidade)} · ${cost.portions ? `${cost.portions.toLocaleString('pt-BR', { maximumFractionDigits:1 })} porções` : 'rendimento cadastrado'}</small></span><span class="technical-sheet-card-cost ${cost.missing.length ? 'incomplete' : ''}">${cost.missing.length ? 'Custo incompleto' : money(cost.portionCost)}</span></button>`;
        }).join('') : '<div class="tasks-empty">Nenhuma ficha técnica cadastrada.</div>';
    }
    function setCategory(category) { selectedCategory = category || 'Todas'; render(); }
    function setManagerCategory(category) { managerCategory = category || 'Todas'; renderManager(); }
    function renderManager() {
        const target = document.getElementById('technicalSheetsManagerList');
        if (!target) return;
        categoryButtons('technicalSheetsManagerCategories', managerCategory, 'setManagerCategory');
        const visible = filteredSheets(document.getElementById('technicalSheetsManagerSearch')?.value, managerCategory);
        target.innerHTML = visible.length ? visible.sort((a, b) => a.nome.localeCompare(b.nome)).map(sheet => `<button type="button" class="technical-manager-item" onclick="AloTechnicalSheets.openForm('${escapeHtml(sheet.id)}', 'manager')"><span><strong>${escapeHtml(sheet.nome)}</strong><small>${escapeHtml(sheet.categoria || 'Sem categoria')} · ${escapeHtml(areaName(sheet.setorId))}</small></span><b aria-hidden="true">✎</b></button>`).join('') : '<div class="tasks-empty">Nenhuma ficha técnica encontrada.</div>';
    }

    function areaOptions(selected) {
        return deps.getAreas().filter(area => area.ativo !== false).map(area => `<option value="${escapeHtml(area.id)}" ${area.id === selected ? 'selected' : ''}>${escapeHtml(area.emoji || '📍')} ${escapeHtml(area.nome)}</option>`).join('');
    }
    function readIngredients(includeEmpty = false) {
        const ingredients = [...document.querySelectorAll('#technicalSheetIngredients .technical-ingredient-row')].map(row => {
            const name = row.querySelector('[data-ingredient-name]').value.trim();
            const product = purchaseProducts.find(item => String(item.nome).toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
            return {
                id: row.dataset.ingredientId || id('insumo'), produtoId: product?.id || '', nome: product?.nome || name,
                quantidade: Number(row.querySelector('[data-ingredient-quantity]').value || 0),
                unidade: row.querySelector('[data-ingredient-unit]').value || 'g',
                perda: Number(row.querySelector('[data-ingredient-loss]').value || 0)
            };
        });
        return includeEmpty ? ingredients : ingredients.filter(item => item.nome || item.quantidade);
    }
    function renderIngredients() {
        const container = document.getElementById('technicalSheetIngredients');
        if (!formIngredients.length) formIngredients = [{ id:id('insumo'), produtoId:'', nome:'', quantidade:0, unidade:'g', perda:0 }];
        container.innerHTML = formIngredients.map((ingredient, index) => {
            const product = purchaseProducts.find(item => String(item.id) === String(ingredient.produtoId));
            const price = latestPrice(product);
            const priceText = price ? `Último preço: ${money(price.preco)} / ${price.unidade || 'un'}` : (ingredient.nome ? 'Preço não cadastrado em Lista de Compras' : 'Selecione um ingrediente para carregar o preço');
            return `<div class="technical-ingredient-row" data-ingredient-id="${escapeHtml(ingredient.id)}"><div class="technical-ingredient-heading"><strong>Ingrediente ${index + 1}</strong><button type="button" onclick="AloTechnicalSheets.removeIngredient('${escapeHtml(ingredient.id)}')" aria-label="Remover ingrediente ${index + 1}">×</button></div><div class="technical-ingredient-product"><input data-ingredient-name value="${escapeHtml(ingredient.nome)}" placeholder="Selecionar ingrediente" readonly onclick="AloTechnicalSheets.openIngredientSearch('${escapeHtml(ingredient.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();AloTechnicalSheets.openIngredientSearch('${escapeHtml(ingredient.id)}')}" aria-label="Escolher ingrediente"><button class="technical-ingredient-search-button" type="button" onclick="AloTechnicalSheets.openIngredientSearch('${escapeHtml(ingredient.id)}')" aria-label="Procurar ingrediente" title="Procurar ingrediente">🔍</button></div><div class="technical-quantity"><label>Qtde.</label><input data-ingredient-quantity type="number" min="0" step="0.01" inputmode="decimal" value="${ingredient.quantidade || ''}" oninput="AloTechnicalSheets.previewCost()"></div><div><label>Unidade</label><select data-ingredient-unit onchange="AloTechnicalSheets.previewCost()">${['g','kg','ml','L','un'].map(unit => `<option ${ingredient.unidade === unit ? 'selected' : ''}>${unit}</option>`).join('')}</select></div><div class="technical-loss"><label>Perda %</label><input data-ingredient-loss type="number" min="0" max="95" step="1" value="${ingredient.perda || 0}" oninput="AloTechnicalSheets.previewCost()"></div><div class="technical-ingredient-price">${escapeHtml(priceText)}</div></div>`;
        }).join('');
    }
    function openIngredientSearch(ingredientId) {
        formIngredients = readIngredients(true);
        ingredientSearchTargetId = ingredientId;
        const input = document.getElementById('technicalIngredientSearch');
        if (input) input.value = '';
        renderIngredientSearch();
        const modal = document.getElementById('modalTechnicalIngredientSearch');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => input?.focus(), 30);
    }
    function renderIngredientSearch() {
        const target = document.getElementById('technicalIngredientSearchResults');
        if (!target) return;
        const query = String(document.getElementById('technicalIngredientSearch')?.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const products = purchaseProducts.filter(product => !query || `${product.nome || ''} ${product.categoria || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query)).sort((left, right) => String(left.nome).localeCompare(String(right.nome))).slice(0, 80);
        target.innerHTML = products.length ? products.map(product => {
            const price = latestPrice(product);
            const detail = price ? `${money(price.preco)} / ${price.unidade || 'un'}` : (product.categoriaNome || product.categoria || 'Sem preço cadastrado');
            return `<button type="button" onclick="AloTechnicalSheets.selectIngredientProduct('${escapeHtml(product.id)}')"><strong>${escapeHtml(product.nome || 'Produto')}</strong><small>${escapeHtml(detail)}</small></button>`;
        }).join('') : '<div class="tasks-empty">Nenhum ingrediente encontrado.</div>';
    }
    function selectIngredientProduct(productId) {
        const product = purchaseProducts.find(item => String(item.id) === String(productId));
        if (!product || !ingredientSearchTargetId) return;
        formIngredients = formIngredients.map(ingredient => ingredient.id === ingredientSearchTargetId ? { ...ingredient, produtoId:product.id, nome:product.nome } : ingredient);
        renderIngredients();
        previewCost();
        closeIngredientSearch();
    }
    function closeIngredientSearch() {
        const modal = document.getElementById('modalTechnicalIngredientSearch');
        if (modal) modal.style.display = 'none';
        ingredientSearchTargetId = '';
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
            ingredientes: readIngredients(), preparo: global.AloTasks?.sanitizeRichHtml?.(document.getElementById('technicalSheetPreparation').innerHTML) || document.getElementById('technicalSheetPreparation').innerHTML
        });
    }
    function previewCost() {
        const target = document.getElementById('technicalSheetCostPreview');
        if (!target) return;
        const cost = calculate(draftFromForm());
        target.innerHTML = `<div class="technical-cost-metric"><small>Custo do lote</small><strong>${money(cost.total)}</strong></div><div class="technical-cost-metric"><small>Custo por porção</small><strong>${money(cost.portionCost)}</strong></div><div class="technical-cost-metric"><small>CMV atual</small><strong>${cost.cmv ? `${cost.cmv.toFixed(1)}%` : '—'}</strong></div><div class="technical-cost-metric"><small>Preço sugerido</small><strong>${cost.suggested ? money(cost.suggested) : '—'}</strong></div>${cost.missing.length ? `<div class="technical-cost-warning">Custo incompleto: ${escapeHtml(cost.missing.join(', '))}. Cadastre preço e unidade em Lista de Compras.</div>` : ''}`;
    }
    function photoKey(sheetId) { return `ficha_${sheetId}`; }
    function showPhotoPreview(url) {
        const image = document.getElementById('technicalSheetPhotoPreview');
        const empty = document.getElementById('technicalSheetPhotoEmpty');
        const remove = document.getElementById('technicalSheetPhotoRemove');
        if (image) { image.src = url || ''; image.style.display = url ? 'block' : 'none'; }
        if (empty) empty.style.display = url ? 'none' : 'grid';
        if (remove) remove.style.display = url ? 'inline-flex' : 'none';
    }
    async function resolvePhoto(sheetId) {
        if (photoCache.has(sheetId)) return photoCache.get(sheetId);
        if (!deps.getUrl()) return '';
        const response = await global.AloApi.getTaskPhoto(deps.getUrl(), photoKey(sheetId));
        const url = response?.encontrada ? response.url : '';
        if (url) photoCache.set(sheetId, url);
        return url;
    }
    async function handlePhoto(input) {
        try {
            pendingPhoto = await global.AloTasks.compressPhoto(input?.files?.[0]);
            removePhoto = false;
            showPhotoPreview(pendingPhoto);
        } catch (error) {
            global.AloUiDialog?.notice(error.message || 'Não foi possível preparar a foto.', { title:'Foto não carregada', confirmText:'Entendi' });
        } finally { if (input) input.value = ''; }
    }
    function removePhotoDraft() {
        pendingPhoto = '';
        removePhoto = true;
        photoCache.delete(document.getElementById('technicalSheetId')?.value || '');
        showPhotoPreview('');
    }
    async function openForm(sheetId = '', returnTarget = 'view') {
        await refreshPurchaseProducts();
        formReturnTarget = returnTarget;
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
        document.getElementById('technicalSheetPreparation').innerHTML = global.AloTasks?.sanitizeRichHtml?.(sheet.preparo) || escapeHtml(sheet.preparo);
        document.getElementById('technicalSheetDelete').style.display = sheetId ? 'block' : 'none';
        formIngredients = clone(sheet.ingredientes);
        pendingPhoto = '';
        removePhoto = false;
        showPhotoPreview('');
        renderIngredients(); previewCost();
        deps.openModalTop?.('modalTechnicalSheet') || (document.getElementById('modalTechnicalSheet').style.display = 'flex');
        if (sheetId && sheet.fotoReferencia) resolvePhoto(sheet.id).then(showPhotoPreview).catch(() => showPhotoPreview(''));
    }
    function closeForm(reopen = true) {
        document.getElementById('modalTechnicalSheet').style.display = 'none';
        if (reopen && formReturnTarget === 'manager') openManager();
    }
    function addIngredient() { formIngredients = readIngredients(true); formIngredients.push({ id:id('insumo'), produtoId:'', nome:'', quantidade:0, unidade:'g', perda:0 }); renderIngredients(); }
    function removeIngredient(ingredientId) { formIngredients = readIngredients(true).filter(item => item.id !== ingredientId); renderIngredients(); previewCost(); }
    function queueSheet(sheet) {
        state.sheets = state.sheets.filter(item => item.id !== sheet.id).concat(sheet);
        state.outbox = state.outbox.filter(item => item.ficha.id !== sheet.id).concat({ operationId:id('op'), ficha:clone(sheet) });
        saveState(); render(); setSyncStatus('syncing', 'Alterações aguardando envio');
        syncNow().catch(() => {});
    }
    async function saveForm() {
        const draft = draftFromForm();
        if (!draft.nome || !draft.setorId) return global.AloUiDialog?.notice('Informe o nome e o setor da ficha.', { title:'Dados necessários', confirmText:'Entendi' });
        if (!draft.rendimento || !draft.porcao) return global.AloUiDialog?.notice('Informe o rendimento e o tamanho da porção.', { title:'Rendimento necessário', confirmText:'Entendi' });
        if (!draft.ingredientes.length) return global.AloUiDialog?.notice('Adicione pelo menos um ingrediente.', { title:'Ingrediente necessário', confirmText:'Entendi' });
        const current = state.sheets.find(item => item.id === draft.id);
        draft.fotoReferencia = removePhoto ? false : Boolean(pendingPhoto || current?.fotoReferencia);
        if (pendingPhoto || removePhoto) {
            if (!deps.getUrl()) return global.AloUiDialog?.notice('Configure a nuvem antes de salvar uma foto.', { title:'Nuvem necessária', confirmText:'Entendi' });
            try {
                if (pendingPhoto) {
                    await global.AloApi.uploadTaskPhoto(deps.getUrl(), photoKey(draft.id), pendingPhoto);
                    photoCache.set(draft.id, pendingPhoto);
                } else {
                    await global.AloApi.deleteTaskPhoto(deps.getUrl(), photoKey(draft.id));
                    photoCache.delete(draft.id);
                }
            } catch (error) {
                return global.AloUiDialog?.notice('A foto não foi enviada. A ficha foi preservada para você tentar novamente.', { title:'Foto não enviada', confirmText:'Entendi' });
            }
        }
        draft.revisao = Number(current?.revisao || 0) + 1;
        draft.atualizadoEm = Date.now();
        queueSheet(draft);
        const returnTarget = formReturnTarget;
        closeForm(false);
        if (returnTarget === 'manager') openManager(); else showView('sheets');
    }
    async function deleteCurrent() {
        const current = state.sheets.find(item => item.id === document.getElementById('technicalSheetId').value);
        if (!current) return;
        const confirmed = await global.AloUiDialog?.confirm(`Excluir a ficha “${current.nome}”?`, { title:'Excluir ficha', icon:'×', tone:'danger', confirmText:'Excluir' });
        if (!confirmed) return;
        queueSheet({ ...current, excluida:true, revisao:Number(current.revisao || 0) + 1, atualizadoEm:Date.now() });
        closeForm(false);
        if (formReturnTarget === 'manager') openManager(); else showView('sheets');
    }
    function openDetail(sheetId) {
        const sheet = state.sheets.find(item => item.id === sheetId && !item.excluida);
        if (!sheet) return;
        const cost = calculate(sheet);
        document.getElementById('technicalSheetDetailTitle').textContent = sheet.nome;
        const preparation = global.AloTasks?.sanitizeRichHtml?.(sheet.preparo || 'Preparo não informado.') || escapeHtml(sheet.preparo || 'Preparo não informado.');
        document.getElementById('technicalSheetDetailBody').innerHTML = `${sheet.fotoReferencia ? '<div id="technicalSheetDetailPhoto" class="task-reference-photo"><span>Carregando foto...</span></div>' : ''}<div class="technical-detail-summary"><div><small>Rendimento</small><strong>${escapeHtml(sheet.rendimento)} ${escapeHtml(sheet.rendimentoUnidade)}</strong></div><div><small>Custo do lote</small><strong>${cost.missing.length ? 'Incompleto' : money(cost.total)}</strong></div><div><small>Custo por porção</small><strong>${cost.missing.length ? 'Incompleto' : money(cost.portionCost)}</strong></div></div><h3>Ingredientes</h3><ul class="technical-detail-list">${cost.details.map(item => `<li><strong>${escapeHtml(item.nome)}</strong> · ${escapeHtml(item.quantidade)} ${escapeHtml(item.unidade)}${item.perda ? ` · perda ${item.perda}%` : ''}${item.cost !== null ? ` · ${money(item.cost)}` : ' · sem custo'}</li>`).join('')}</ul><h3>Preparo</h3><div class="task-procedure-content technical-preparation-content">${preparation}</div>${cost.missing.length ? `<div class="technical-cost-warning">O total não inclui: ${escapeHtml(cost.missing.join(', '))}.</div>` : ''}`;
        if (sheet.fotoReferencia) resolvePhoto(sheet.id).then(url => { const target = document.getElementById('technicalSheetDetailPhoto'); if (!target) return; if (!url) target.remove(); else target.innerHTML = `<img src="${escapeHtml(url)}" alt="Foto da ficha técnica">`; }).catch(() => document.getElementById('technicalSheetDetailPhoto')?.remove());
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
        setSyncStatus(state.outbox.length ? 'syncing' : (navigator.onLine ? 'ok' : 'error'), state.outbox.length ? 'Alterações aguardando confirmação' : 'Fichas técnicas sincronizadas');
    }
    function getBackup() { return { schemaVersion:1, ...clone(state) }; }
    function restoreBackup(backup) {
        if (!backup || !Array.isArray(backup.sheets)) return false;
        state = { sheets:backup.sheets.map(normalizeSheet), outbox:Array.isArray(backup.outbox) ? backup.outbox : [], revision:Number(backup.revision || 0) };
        saveState(); render(); return true;
    }

    global.AloTechnicalSheets = Object.freeze({
        configure, showView, openManager, closeManager, render, renderManager, setCategory, setManagerCategory, openForm, closeForm, addIngredient, removeIngredient,
        openIngredientSearch, renderIngredientSearch, selectIngredientProduct, closeIngredientSearch,
        previewCost, saveForm, deleteCurrent, openDetail, handlePhoto, removePhotoDraft, syncNow, getBackup, restoreBackup, calculate
    });
})(window);
