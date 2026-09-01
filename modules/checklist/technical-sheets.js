(function (global) {
    const STORAGE_KEY = 'alo_checklist_technical_sheets_v1';
    const CATEGORY_RECORD_ID = '__categorias_fichas_tecnicas__';
    const POLL_MS = 9000;
    let deps = { getUrl: () => '', getAreas: () => [], openModalTop: null, onSyncState: null };
    let state = loadState();
    let purchaseProducts = [];
    let purchaseSuppliers = [];
    let labelProducts = [];
    let formIngredients = [];
    let syncPromise = null;
    let pollTimer = null;
    let pendingPhoto = '';
    let removePhoto = false;
    let ingredientSearchTargetId = '';
    let ingredientSearchReturnQuery = '';
    let priceEditorTargetId = '';
    let selectedCategory = 'Todas';
    let managerCategory = 'Todas';
    let labelPickerCategory = 'Todas';
    let formReturnTarget = 'view';
    let categoryColorTarget = '';
    let categoryColorDraft = { background:'#7b3fb5', text:'#ffffff' };
    let detailScaleSheetId = '';
    let detailScaleIngredientId = '';
    let detailScaleRatio = 1;
    let detailScaleOpen = false;
    let detailReturnModule = '';
    const photoCache = new Map();
    const CATEGORY_PALETTE = ['#7b3fb5', '#087f68', '#1d6fb8', '#c0522f', '#a02f5f', '#657b24', '#9a6713', '#47606f', '#8b3f32', '#356b4f', '#6d4a9e', '#247a87'];

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
                revision: Number(saved.revision || 0),
                categories: Array.isArray(saved.categories) ? saved.categories.map(String).filter(Boolean) : [],
                categoryColors: normalizeCategoryColors(saved.categoryColors),
                categoryTextColors: normalizeCategoryTextColors(saved.categoryTextColors),
                categoriesRevision: Number(saved.categoriesRevision || 0),
                categoriesUpdatedAt: Number(saved.categoriesUpdatedAt || 0)
            };
        } catch (error) { return { sheets: [], outbox: [], revision: 0, categories:[], categoryColors:{}, categoryTextColors:{}, categoriesRevision:0, categoriesUpdatedAt:0 }; }
    }
    function safeColor(value, fallback = '#7b3fb5') {
        const color = String(value || '').trim();
        return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
    }
    function normalizeCategoryColors(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return Object.fromEntries(Object.entries(value).map(([name, color]) => [String(name), safeColor(color)]));
    }
    function normalizeCategoryTextColors(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return Object.fromEntries(Object.entries(value).map(([name, color]) => [String(name), safeColor(color, '#ffffff')]));
    }
    function readableTextColor(background) {
        const hex = safeColor(background).slice(1);
        const red = parseInt(hex.slice(0, 2), 16);
        const green = parseInt(hex.slice(2, 4), 16);
        const blue = parseInt(hex.slice(4, 6), 16);
        return ((red * 299 + green * 587 + blue * 114) / 1000) > 155 ? '#1f2933' : '#ffffff';
    }
    function categoryColor(category) {
        const name = String(category || '');
        if (state?.categoryColors?.[name]) return safeColor(state.categoryColors[name]);
        let hash = 0;
        for (let index = 0; index < name.length; index += 1) hash = ((hash << 5) - hash + name.charCodeAt(index)) | 0;
        return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length] || CATEGORY_PALETTE[0];
    }
    function categoryTextColor(category) {
        return safeColor(state?.categoryTextColors?.[String(category || '')] || readableTextColor(categoryColor(category)), readableTextColor(categoryColor(category)));
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
                perda: Math.max(0, Math.min(95, Number(item.perda || 0))),
                precoInformado: Number(item.precoInformado || 0),
                precoUnidade: String(item.precoUnidade || ''),
                fornecedorId: String(item.fornecedorId || '')
            })) : [],
            preparo: String(source.preparo || ''),
            etiquetaProdutoCodigo: source.etiquetaProdutoCodigo == null ? '' : String(source.etiquetaProdutoCodigo),
            etiquetaProdutoNome: String(source.etiquetaProdutoNome || ''),
            fotoReferencia: source.fotoReferencia === true,
            atualizadoEm: Number(source.atualizadoEm || Date.now()),
            revisao: Number(source.revisao || 1),
            excluida: source.excluida === true
        };
    }
    function activeSheets() { return state.sheets.filter(sheet => !sheet.excluida); }
    function isAreaImage(value) {
        return /^assets\/areas\/[a-z0-9-]+\.(?:svg|png)$/.test(String(value || ''));
    }
    function areaName(areaId) {
        const area = deps.getAreas().find(item => item.id === areaId);
        return area ? String(area.nome || 'Sem setor') : 'Sem setor';
    }
    function areaOptionLabel(area) {
        const visual = isAreaImage(area?.emoji) ? '' : String(area?.emoji || '📍');
        return `${visual ? `${visual} ` : ''}${String(area?.nome || 'Sem setor')}`;
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
            const bank = data?.app_id === 'alofeira' ? data : (data?.dados || data || {});
            const categoriesById = new Map((Array.isArray(bank.categorias) ? bank.categorias : []).map(category => [String(category.id), String(category.nome || '')]));
            purchaseProducts = (Array.isArray(bank.produtos) ? bank.produtos : [])
                .filter(product => product && product.ativo !== false && product.id && product.nome)
                .map(product => ({ ...product, categoriaNome:categoriesById.get(String(product.categoria)) || '' }));
            purchaseSuppliers = (Array.isArray(bank.fornecedores) ? bank.fornecedores : [])
                .filter(supplier => supplier && supplier.ativo !== false && supplier.id && supplier.nome)
                .sort((left, right) => String(left.nome).localeCompare(String(right.nome)));
        } catch (error) {
            purchaseProducts = purchaseProducts || [];
            purchaseSuppliers = purchaseSuppliers || [];
        }
        return purchaseProducts;
    }
    async function refreshLabelProducts() {
        try {
            const products = await global.AloL42Module?.getProducts?.();
            if (Array.isArray(products)) {
                labelProducts = products
                    .filter(product => product && product.codigo != null && product.nome)
                    .map(product => ({
                        codigo:String(product.codigo),
                        nome:String(product.nome),
                        categoria:String(product.categoria || ''),
                        categoriaCor:safeColor(product.categoriaCor || '#1565c0', '#1565c0'),
                        categoriaCorTexto:safeColor(product.categoriaCorTexto || '#ffffff', '#ffffff'),
                        fichasTecnicas:Array.isArray(product.fichasTecnicas) ? product.fichasTecnicas : []
                    }))
                    .sort((left, right) => left.nome.localeCompare(right.nome));
            }
        } catch (error) {
            labelProducts = labelProducts || [];
        }
        return labelProducts;
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
            const savedPrice = latestPrice(product);
            const price = Number(ingredient.precoInformado || 0) > 0
                ? { preco:Number(ingredient.precoInformado), unidade:ingredient.precoUnidade || ingredient.unidade, fornecedorId:ingredient.fornecedorId || '' }
                : savedPrice;
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

    function showView(view, acessoConfirmado = false, preservePurchaseProducts = false) {
        if (view === 'documents' && !acessoConfirmado && global.solicitarAcessoChecklist?.('documentos') === false) return;
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
        if (sheets) {
            if (!preservePurchaseProducts) refreshPurchaseProducts().then(render);
            syncNow().catch(() => {});
            render();
        }
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
        return [...new Set([...(state.categories || []), ...activeSheets().map(sheet => sheet.categoria.trim())].filter(Boolean))]
            .sort((left, right) => left.localeCompare(right));
    }
    function categoryButtons(targetId, current, setter) {
        const target = document.getElementById(targetId);
        if (!target) return;
        const values = ['Todas', ...categories()];
        target.innerHTML = values.map(category => {
            const encoded = encodeURIComponent(category).replace(/'/g, '%27');
            const color = category === 'Todas' ? '#56676d' : categoryColor(category);
            const textColor = category === 'Todas' ? '#ffffff' : categoryTextColor(category);
            return `<button type="button" class="${category === current ? 'active' : ''}" style="--category-color:${escapeHtml(color)};--category-text-color:${escapeHtml(textColor)}" onclick="AloTechnicalSheets.${setter}(decodeURIComponent('${encoded}'))">${escapeHtml(category)}</button>`;
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
        list.innerHTML = visible.length ? visible.sort((a, b) => a.nome.localeCompare(b.nome)).map(sheet => {
            const cost = calculate(sheet);
            return `<button class="technical-sheet-card" style="--category-color:${escapeHtml(categoryColor(sheet.categoria))}" type="button" onclick="AloTechnicalSheets.openDetail('${escapeHtml(sheet.id)}')"><span class="technical-sheet-card-icon">🍽️</span><span class="technical-sheet-card-copy"><strong>${escapeHtml(sheet.nome)}</strong><span>${escapeHtml(sheet.categoria || 'Sem categoria')} · ${escapeHtml(areaName(sheet.setorId))}</span></span><span class="technical-sheet-card-cost ${cost.missing.length ? 'incomplete' : ''}">${cost.missing.length ? 'Custo incompleto' : money(cost.portionCost)}</span></button>`;
        }).join('') : '<div class="tasks-empty">Nenhuma ficha técnica cadastrada.</div>';
    }
    function toggleMainSearch() {
        const box = document.getElementById('technicalSheetsSearchBox');
        const input = document.getElementById('technicalSheetsSearch');
        const button = document.getElementById('technicalSheetsSearchButton');
        if (!box || !input || !button) return;
        const open = box.style.display === 'flex';
        if (open || input.value) {
            input.value = '';
            box.style.display = 'none';
            button.classList.remove('active');
            render();
            return;
        }
        box.style.display = 'flex';
        button.classList.add('active');
        setTimeout(() => input.focus({ preventScroll:true }), 60);
    }
    function clearMainSearch() {
        const box = document.getElementById('technicalSheetsSearchBox');
        const input = document.getElementById('technicalSheetsSearch');
        const button = document.getElementById('technicalSheetsSearchButton');
        if (input) input.value = '';
        if (box) box.style.display = 'none';
        button?.classList.remove('active');
        render();
    }
    function setCategory(category) { selectedCategory = category || 'Todas'; render(); }
    function setManagerCategory(category) { managerCategory = category || 'Todas'; renderManager(); }
    function getLinkOptions() {
        return activeSheets().sort((left, right) => left.nome.localeCompare(right.nome)).map(sheet => ({
            id:sheet.id,
            nome:sheet.nome,
            categoria:sheet.categoria,
            setorId:sheet.setorId,
            setorNome:areaName(sheet.setorId),
            etiquetaProdutoCodigo:sheet.etiquetaProdutoCodigo,
            etiquetaProdutoNome:sheet.etiquetaProdutoNome
        }));
    }
    function renderManager() {
        const target = document.getElementById('technicalSheetsManagerList');
        if (!target) return;
        categoryButtons('technicalSheetsManagerCategories', managerCategory, 'setManagerCategory');
        const visible = filteredSheets(document.getElementById('technicalSheetsManagerSearch')?.value, managerCategory);
        target.innerHTML = visible.length ? visible.sort((a, b) => a.nome.localeCompare(b.nome)).map(sheet => `<div class="technical-manager-item" style="--category-color:${escapeHtml(categoryColor(sheet.categoria))}"><button type="button" onclick="AloTechnicalSheets.openForm('${escapeHtml(sheet.id)}', 'manager')"><span><strong>${escapeHtml(sheet.nome)}</strong><small>${escapeHtml(sheet.categoria || 'Sem categoria')} · ${escapeHtml(areaName(sheet.setorId))}</small></span></button><div class="technical-manager-actions"><button type="button" onclick="AloTechnicalSheets.duplicateSheet('${escapeHtml(sheet.id)}')" aria-label="Duplicar ficha" title="Duplicar ficha">⧉</button><button type="button" onclick="AloTechnicalSheets.openForm('${escapeHtml(sheet.id)}', 'manager')" aria-label="Editar ficha" title="Editar ficha">✎</button></div></div>`).join('') : '<div class="tasks-empty">Nenhuma ficha técnica encontrada.</div>';
    }

    function renderCategoryManager() {
        const target = document.getElementById('technicalSheetCategoryManagerList');
        if (!target) return;
        const values = categories();
        target.innerHTML = values.length ? values.map(category => {
            const encoded = encodeURIComponent(category).replace(/'/g, '%27');
            const inUse = activeSheets().some(sheet => sheet.categoria === category);
            return `<div class="technical-category-item" style="--category-color:${escapeHtml(categoryColor(category))};--category-text-color:${escapeHtml(categoryTextColor(category))}"><span class="technical-category-name"><strong>${escapeHtml(category)}</strong></span><div><button type="button" onclick="AloTechnicalSheets.openCategoryColor(decodeURIComponent('${encoded}'))" aria-label="Editar ${escapeHtml(category)}" title="Editar nome e cores">✎</button><button type="button" onclick="AloTechnicalSheets.deleteCategory(decodeURIComponent('${encoded}'))" aria-label="Excluir ${escapeHtml(category)}" ${inUse ? 'disabled title="Categoria em uso"' : ''}>🗑️</button></div></div>`;
        }).join('') : '<div class="tasks-empty">Nenhuma categoria cadastrada.</div>';
    }
    function openCategoryManager() {
        document.getElementById('modalTechnicalSheetsManager').style.display = 'none';
        renderCategoryManager();
        deps.openModalTop?.('modalTechnicalSheetCategories') || (document.getElementById('modalTechnicalSheetCategories').style.display = 'flex');
    }
    function closeCategoryManager() {
        document.getElementById('modalTechnicalSheetCategories').style.display = 'none';
        openManager();
    }
    function categoryRecord() {
        return {
            id:CATEGORY_RECORD_ID,
            tipo:'categorias',
            categorias:[...(state.categories || [])],
            categoryColors:{ ...state.categoryColors },
            categoryTextColors:{ ...state.categoryTextColors },
            revisao:Number(state.categoriesRevision || 0),
            atualizadoEm:Number(state.categoriesUpdatedAt || 0),
            excluida:false
        };
    }
    function queueCategories(values, colors = state.categoryColors, textColors = state.categoryTextColors) {
        state.categories = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
        state.categoryColors = Object.fromEntries(state.categories.map(category => [category, safeColor(colors?.[category] || categoryColor(category))]));
        state.categoryTextColors = Object.fromEntries(state.categories.map(category => {
            const background = state.categoryColors[category];
            return [category, safeColor(textColors?.[category] || readableTextColor(background), readableTextColor(background))];
        }));
        state.categoriesRevision = Number(state.categoriesRevision || 0) + 1;
        state.categoriesUpdatedAt = Date.now();
        const record = categoryRecord();
        state.outbox = state.outbox.filter(item => item.ficha?.id !== CATEGORY_RECORD_ID).concat({ operationId:id('op'), ficha:record });
        saveState();
        render(); renderManager(); renderCategoryManager();
        setSyncStatus('syncing', 'Categorias aguardando envio');
        syncNow().catch(() => {});
    }
    async function createCategory() {
        const name = await global.AloUiDialog?.prompt('', { title:'Nova categoria', inputLabel:'Nome', placeholder:'Ex: Molhos', confirmText:'Criar' });
        if (!name) return;
        if (categories().some(category => normalizedSearch(category) === normalizedSearch(name))) {
            return global.AloUiDialog?.notice('Essa categoria já existe.', { title:'Categoria existente', confirmText:'Entendi' });
        }
        const nextColor = CATEGORY_PALETTE[categories().length % CATEGORY_PALETTE.length];
        queueCategories([...(state.categories || []), name], { ...state.categoryColors, [name]:nextColor }, { ...state.categoryTextColors, [name]:readableTextColor(nextColor) });
        openCategoryColor(name);
    }
    function renameCategory(current) { openCategoryColor(current); }
    async function deleteCategory(category) {
        if (activeSheets().some(sheet => sheet.categoria === category)) return;
        const confirmed = await global.AloUiDialog?.confirm(`Excluir a categoria “${category}”?`, { title:'Excluir categoria', icon:'×', tone:'danger', confirmText:'Excluir' });
        if (confirmed) {
            const colors = { ...state.categoryColors };
            const textColors = { ...state.categoryTextColors };
            delete colors[category];
            delete textColors[category];
            queueCategories((state.categories || []).filter(item => item !== category), colors, textColors);
        }
    }

    function openCategoryColor(category) {
        categoryColorTarget = String(category || '');
        if (!categoryColorTarget) return;
        document.getElementById('modalTechnicalSheetCategories').style.display = 'none';
        categoryColorDraft = { background:categoryColor(categoryColorTarget), text:categoryTextColor(categoryColorTarget) };
        const name = document.getElementById('technicalCategoryEditName');
        if (name) name.value = categoryColorTarget;
        const background = document.getElementById('technicalCategoryBackgroundColor');
        const text = document.getElementById('technicalCategoryTextColor');
        if (background) background.value = categoryColorDraft.background;
        if (text) text.value = categoryColorDraft.text;
        previewCategoryColor();
        deps.openModalTop?.('modalTechnicalCategoryColor') || (document.getElementById('modalTechnicalCategoryColor').style.display = 'flex');
    }
    function closeCategoryColor() {
        document.getElementById('modalTechnicalCategoryColor').style.display = 'none';
        categoryColorTarget = '';
        renderCategoryManager();
        deps.openModalTop?.('modalTechnicalSheetCategories') || (document.getElementById('modalTechnicalSheetCategories').style.display = 'flex');
    }
    function previewCategoryColor() {
        categoryColorDraft = {
            background:safeColor(document.getElementById('technicalCategoryBackgroundColor')?.value || categoryColorDraft.background),
            text:safeColor(document.getElementById('technicalCategoryTextColor')?.value || categoryColorDraft.text, '#ffffff')
        };
        const preview = document.getElementById('technicalCategoryColorPreview');
        if (preview) {
            preview.textContent = document.getElementById('technicalCategoryEditName')?.value.trim() || categoryColorTarget;
            preview.style.background = categoryColorDraft.background;
            preview.style.color = categoryColorDraft.text;
        }
    }
    function saveCategoryColors() {
        if (!categoryColorTarget) return;
        previewCategoryColor();
        const current = categoryColorTarget;
        const name = String(document.getElementById('technicalCategoryEditName')?.value || '').trim();
        if (!name) return global.AloUiDialog?.notice('Informe o nome da categoria.', { title:'Nome necessário', confirmText:'Entendi' });
        if (categories().some(category => category !== current && normalizedSearch(category) === normalizedSearch(name))) {
            return global.AloUiDialog?.notice('Essa categoria já existe.', { title:'Categoria existente', confirmText:'Entendi' });
        }
        if (name !== current) state.sheets = state.sheets.map(sheet => sheet.categoria === current ? { ...sheet, categoria:name } : sheet);
        const colors = { ...state.categoryColors };
        const textColors = { ...state.categoryTextColors };
        delete colors[current];
        delete textColors[current];
        colors[name] = categoryColorDraft.background;
        textColors[name] = categoryColorDraft.text;
        queueCategories(
            (state.categories || []).map(category => category === current ? name : category).concat(name),
            colors,
            textColors
        );
        if (name !== current) state.sheets.filter(sheet => sheet.categoria === name).forEach(sheet => queueSheet({ ...sheet, revisao:Number(sheet.revisao || 0) + 1, atualizadoEm:Date.now() }));
        closeCategoryColor();
    }

    function areaOptions(selected) {
        return deps.getAreas().filter(area => area.ativo !== false || area.id === selected).map(area => `<option value="${escapeHtml(area.id)}" ${area.id === selected ? 'selected' : ''}>${escapeHtml(areaOptionLabel(area))}</option>`).join('');
    }
    function updateLabelProductNote() {
        const field = document.getElementById('technicalSheetLabelProduct');
        const name = document.getElementById('technicalSheetLabelProductName');
        const category = document.getElementById('technicalSheetLabelProductCategory');
        if (!field) return;
        const product = labelProducts.find(item => item.codigo === String(field.value || ''));
        if (name) name.textContent = product?.nome || field.dataset.fallbackName || 'Nenhum produto vinculado';
        if (category) {
            category.textContent = product?.categoria || (field.value ? 'Produto indisponível' : 'A impressão usará uma etiqueta avulsa');
            category.style.setProperty('--label-category-color', product?.categoriaCor || '#7b3fb5');
        }
    }
    function labelCategories() {
        return [...new Set(labelProducts.map(product => product.categoria).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    }
    function openLabelProductPicker() {
        labelPickerCategory = 'Todas';
        const search = document.getElementById('technicalLabelProductSearch');
        if (search) search.value = '';
        document.getElementById('modalTechnicalSheet').style.display = 'none';
        renderLabelProductPicker();
        deps.openModalTop?.('modalTechnicalLabelProductPicker') || (document.getElementById('modalTechnicalLabelProductPicker').style.display = 'flex');
    }
    function closeLabelProductPicker() {
        document.getElementById('modalTechnicalLabelProductPicker').style.display = 'none';
        document.getElementById('modalTechnicalSheet').style.display = 'flex';
    }
    function setLabelProductCategory(category) {
        labelPickerCategory = category || 'Todas';
        renderLabelProductPicker();
    }
    function renderLabelProductPicker() {
        const categoriesTarget = document.getElementById('technicalLabelProductCategories');
        const list = document.getElementById('technicalLabelProductList');
        if (!categoriesTarget || !list) return;
        const selected = String(document.getElementById('technicalSheetLabelProduct')?.value || '');
        const query = normalizedSearch(document.getElementById('technicalLabelProductSearch')?.value || '');
        const values = ['Todas', ...labelCategories()];
        categoriesTarget.innerHTML = values.map(category => {
            const encoded = encodeURIComponent(category).replace(/'/g, '%27');
            const sample = labelProducts.find(product => product.categoria === category);
            return `<button type="button" class="${labelPickerCategory === category ? 'active' : ''}" style="--label-category-color:${escapeHtml(sample?.categoriaCor || '#62737a')}" onclick="AloTechnicalSheets.setLabelProductCategory(decodeURIComponent('${encoded}'))">${escapeHtml(category)}</button>`;
        }).join('');
        const products = labelProducts.filter(product => (labelPickerCategory === 'Todas' || product.categoria === labelPickerCategory)
            && (!query || normalizedSearch(`${product.nome} ${product.categoria}`).includes(query)));
        const unlink = `<button type="button" class="technical-label-picker-option avulsa ${selected ? '' : 'selected'}" onclick="AloTechnicalSheets.selectLabelProduct('')"><span class="technical-label-picker-avatar">＋</span><span><strong>Etiqueta avulsa</strong><small>Sem produto correspondente</small></span><b>${selected ? '›' : '✓'}</b></button>`;
        list.innerHTML = unlink + products.map(product => `<button type="button" class="technical-label-picker-option ${selected === product.codigo ? 'selected' : ''}" style="--label-category-color:${escapeHtml(product.categoriaCor)};--label-category-text:${escapeHtml(product.categoriaCorTexto)}" onclick="AloTechnicalSheets.selectLabelProduct('${escapeHtml(product.codigo)}')"><span class="technical-label-picker-avatar">${escapeHtml(product.nome.charAt(0).toUpperCase())}</span><span><strong>${escapeHtml(product.nome)}</strong><small>${escapeHtml(product.categoria || 'Sem categoria')}</small></span><b>${selected === product.codigo ? '✓' : '›'}</b></button>`).join('');
    }
    function selectLabelProduct(code) {
        const field = document.getElementById('technicalSheetLabelProduct');
        if (!field) return;
        const requestedCode = String(code || '');
        const product = String(field.value || '') === requestedCode ? null : labelProducts.find(item => item.codigo === requestedCode);
        field.value = product?.codigo || '';
        field.dataset.fallbackName = product?.nome || '';
        updateLabelProductNote();
        closeLabelProductPicker();
    }
    function readIngredients(includeEmpty = false) {
        const ingredients = [...document.querySelectorAll('#technicalSheetIngredients .technical-ingredient-row')].map(row => {
            const name = row.querySelector('[data-ingredient-name]').value.trim();
            const product = purchaseProducts.find(item => String(item.id) === String(row.dataset.productId))
                || purchaseProducts.find(item => String(item.nome).toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
            return {
                id: row.dataset.ingredientId || id('insumo'), produtoId: product?.id || '', nome: product?.nome || name,
                quantidade: Number(row.querySelector('[data-ingredient-quantity]').value || 0),
                unidade: row.querySelector('[data-ingredient-unit]').value || 'g',
                perda: Number(row.querySelector('[data-ingredient-loss]').value || 0),
                precoInformado: Number(row.querySelector('[data-ingredient-price]')?.value || 0),
                precoUnidade: String(row.querySelector('[data-ingredient-price-unit]')?.value || ''),
                fornecedorId: String(row.querySelector('[data-ingredient-supplier]')?.value || '')
            };
        });
        return includeEmpty ? ingredients : ingredients.filter(item => item.nome || item.quantidade);
    }
    function supplierOptions(selected) {
        return `<option value="">Fornecedor</option>${purchaseSuppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}" ${String(supplier.id) === String(selected) ? 'selected' : ''}>${escapeHtml(supplier.nome)}</option>`).join('')}`;
    }
    function renderIngredients() {
        const container = document.getElementById('technicalSheetIngredients');
        if (!formIngredients.length) formIngredients = [{ id:id('insumo'), produtoId:'', nome:'', quantidade:0, unidade:'g', perda:0 }];
        container.innerHTML = formIngredients.map((ingredient, index) => {
            const product = purchaseProducts.find(item => String(item.id) === String(ingredient.produtoId));
            const price = latestPrice(product);
            const currentPrice = Number(ingredient.precoInformado || 0) || Number(price?.preco || 0);
            const currentSupplier = ingredient.fornecedorId || price?.fornecedorId || '';
            const priceUnit = price?.unidade || ingredient.unidade || 'un';
            const priceLabel = currentPrice ? `${money(currentPrice)} / ${priceUnit}` : 'Informar preço';
            return `<div class="technical-ingredient-row" data-ingredient-id="${escapeHtml(ingredient.id)}" data-product-id="${escapeHtml(ingredient.produtoId)}"><div class="technical-ingredient-main"><div class="technical-ingredient-product"><label>Ingrediente ${index + 1}</label><input data-ingredient-name value="${escapeHtml(ingredient.nome)}" placeholder="Selecionar ingrediente" readonly onclick="AloTechnicalSheets.openIngredientSearch('${escapeHtml(ingredient.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();AloTechnicalSheets.openIngredientSearch('${escapeHtml(ingredient.id)}')}" aria-label="Escolher ingrediente"><button class="technical-ingredient-search-button" type="button" onclick="AloTechnicalSheets.openIngredientSearch('${escapeHtml(ingredient.id)}')" aria-label="Procurar ingrediente" title="Procurar ingrediente">🔍</button></div><div class="technical-quantity"><label>Qtde.</label><input data-ingredient-quantity type="number" min="0" step="0.01" inputmode="decimal" value="${ingredient.quantidade || ''}" oninput="AloTechnicalSheets.previewCost()"></div><div><label>Unidade</label><select data-ingredient-unit onchange="AloTechnicalSheets.previewCost()">${['g','kg','ml','L','un'].map(unit => `<option ${ingredient.unidade === unit ? 'selected' : ''}>${unit}</option>`).join('')}</select></div></div><div class="technical-ingredient-cost-row"><div class="technical-loss"><label>Perda %</label><input data-ingredient-loss type="number" min="0" max="95" step="1" value="${ingredient.perda || 0}" oninput="AloTechnicalSheets.previewCost()"></div><div class="technical-ingredient-price-field"><label>Preço</label><input data-ingredient-price type="hidden" value="${currentPrice || ''}"><input data-ingredient-price-unit type="hidden" value="${escapeHtml(ingredient.precoUnidade || priceUnit)}"><input data-ingredient-supplier type="hidden" value="${escapeHtml(currentSupplier)}"><button class="technical-ingredient-price-button" type="button" onclick="AloTechnicalSheets.openPriceEditor('${escapeHtml(ingredient.id)}')"><span>${escapeHtml(priceLabel)}</span><b aria-hidden="true">✎</b></button></div><button class="technical-ingredient-remove" type="button" onclick="AloTechnicalSheets.removeIngredient('${escapeHtml(ingredient.id)}')">Excluir</button></div></div>`;
        }).join('');
    }
    function categoryOptions(selected) {
        const values = categories();
        if (selected && !values.includes(selected)) values.push(selected);
        return `<option value="">Selecione</option>${values.sort((left, right) => left.localeCompare(right)).map(category => `<option value="${escapeHtml(category)}" ${category === selected ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}`;
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
            const detail = price ? `${money(price.preco)} / ${price.unidade || 'un'}` : '';
            return `<button type="button" onclick="AloTechnicalSheets.selectIngredientProduct('${escapeHtml(product.id)}')"><strong>${escapeHtml(product.nome || 'Produto')}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</button>`;
        }).join('') : '<div class="tasks-empty">Nenhum ingrediente encontrado.</div>';
    }
    function selectIngredientProduct(productId) {
        const product = purchaseProducts.find(item => String(item.id) === String(productId));
        if (!product || !ingredientSearchTargetId) return;
        const price = latestPrice(product);
        formIngredients = formIngredients.map(ingredient => ingredient.id === ingredientSearchTargetId ? { ...ingredient, produtoId:product.id, nome:product.nome, precoInformado:Number(price?.preco || 0), precoUnidade:String(price?.unidade || ''), fornecedorId:String(price?.fornecedorId || '') } : ingredient);
        renderIngredients();
        previewCost();
        closeIngredientSearch();
    }
    function closeIngredientSearch() {
        const modal = document.getElementById('modalTechnicalIngredientSearch');
        if (modal) modal.style.display = 'none';
        ingredientSearchTargetId = '';
    }
    async function createPurchaseIngredient() {
        formIngredients = readIngredients(true);
        ingredientSearchReturnQuery = String(document.getElementById('technicalIngredientSearch')?.value || '');
        document.getElementById('modalTechnicalIngredientSearch').style.display = 'none';
        document.getElementById('modalTechnicalSheet').style.display = 'none';
        try {
            if (typeof global.AloFeiraModule?.createProductForIngredient !== 'function') throw new Error('A Lista de Compras ainda não está pronta para cadastrar ingredientes.');
            await global.AloFeiraModule.createProductForIngredient();
        } catch (error) {
            returnFromPurchaseProduct(null);
            global.AloUiDialog?.notice(error.message || 'Não foi possível abrir o cadastro da Lista de Compras.', { title:'Cadastro não aberto', confirmText:'Entendi' });
        }
    }
    function returnFromPurchaseProduct(product) {
        if (product?.id && product?.nome) {
            purchaseProducts = purchaseProducts.filter(item => String(item.id) !== String(product.id)).concat(clone(product));
            ingredientSearchReturnQuery = String(product.nome);
        }
        global.AloTasks?.openModule('tasks');
        showView('sheets', true, true);
        document.getElementById('modalTechnicalSheet').style.display = 'flex';
        const input = document.getElementById('technicalIngredientSearch');
        if (input) input.value = ingredientSearchReturnQuery;
        renderIngredientSearch();
        document.getElementById('modalTechnicalIngredientSearch').style.display = 'flex';
        setTimeout(() => input?.focus(), 30);
    }
    function openPriceEditor(ingredientId) {
        formIngredients = readIngredients(true);
        const ingredient = formIngredients.find(item => item.id === ingredientId);
        const product = purchaseProducts.find(item => String(item.id) === String(ingredient?.produtoId));
        if (!ingredient || !product) {
            return global.AloUiDialog?.notice('Escolha primeiro o ingrediente da Lista de Compras.', { title:'Ingrediente necessário', confirmText:'Entendi' });
        }
        priceEditorTargetId = ingredientId;
        const price = latestPrice(product);
        document.getElementById('technicalIngredientPriceProduct').innerHTML = `<strong>${escapeHtml(product.nome)}</strong><span>Cadastro vinculado à Lista de Compras</span>`;
        document.getElementById('technicalIngredientPriceValue').value = Number(ingredient.precoInformado || 0) || Number(price?.preco || 0) || '';
        document.getElementById('technicalIngredientPriceUnit').value = ingredient.precoUnidade || price?.unidade || ingredient.unidade || 'un';
        document.getElementById('technicalIngredientPriceSupplier').innerHTML = supplierOptions(ingredient.fornecedorId || price?.fornecedorId || '');
        const modal = document.getElementById('modalTechnicalIngredientPrice');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => document.getElementById('technicalIngredientPriceValue')?.focus(), 30);
    }
    function closePriceEditor() {
        const modal = document.getElementById('modalTechnicalIngredientPrice');
        if (modal) modal.style.display = 'none';
        priceEditorTargetId = '';
    }
    async function savePriceEditor() {
        const ingredient = formIngredients.find(item => item.id === priceEditorTargetId);
        const product = purchaseProducts.find(item => String(item.id) === String(ingredient?.produtoId));
        const value = Number(document.getElementById('technicalIngredientPriceValue')?.value || 0);
        const unit = document.getElementById('technicalIngredientPriceUnit')?.value || ingredient?.unidade || 'un';
        const supplierId = document.getElementById('technicalIngredientPriceSupplier')?.value || '';
        if (!ingredient || !product) return closePriceEditor();
        if (!(value > 0)) return global.AloUiDialog?.notice('Informe um preço maior que zero.', { title:'Preço necessário', confirmText:'Entendi' });
        try {
            if (typeof global.AloFeiraModule?.registerProductPrice !== 'function') throw new Error('A Lista de Compras ainda não está pronta para receber preços.');
            await global.AloFeiraModule.registerProductPrice(product.id, { preco:value, unidade:unit, fornecedorId:supplierId });
            formIngredients = formIngredients.map(item => item.id === priceEditorTargetId ? { ...item, precoInformado:value, precoUnidade:unit, fornecedorId:supplierId } : item);
            await refreshPurchaseProducts();
            closePriceEditor();
            renderIngredients();
            previewCost();
        } catch (error) {
            global.AloUiDialog?.notice(error.message || 'Não foi possível registrar o preço na Lista de Compras.', { title:'Preço não salvo', confirmText:'Entendi' });
        }
    }
    async function saveIngredientPrices(ingredients) {
        if (ingredients.some(ingredient => Number(ingredient.precoInformado || 0) > 0) && typeof global.AloFeiraModule?.registerProductPrice !== 'function') {
            throw new Error('A Lista de Compras ainda não está pronta para receber preços.');
        }
        for (const ingredient of ingredients) {
            const product = purchaseProducts.find(item => String(item.id) === String(ingredient.produtoId));
            const informed = Number(ingredient.precoInformado || 0);
            if (!product || !informed) continue;
            const current = latestPrice(product);
            const informedUnit = ingredient.precoUnidade || ingredient.unidade;
            const samePrice = Math.abs(Number(current?.preco || 0) - informed) < .0001;
            const sameUnit = String(current?.unidade || informedUnit) === String(informedUnit);
            const sameSupplier = String(current?.fornecedorId || '') === String(ingredient.fornecedorId || '');
            if (samePrice && sameUnit && sameSupplier) continue;
            await global.AloFeiraModule?.registerProductPrice?.(product.id, {
                preco:informed,
                unidade:informedUnit,
                fornecedorId:ingredient.fornecedorId || ''
            });
        }
    }
    function draftFromForm() {
        const labelProductField = document.getElementById('technicalSheetLabelProduct');
        const labelProductCode = labelProductField?.value || '';
        const labelProduct = labelProducts.find(product => product.codigo === String(labelProductCode));
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
            etiquetaProdutoCodigo: labelProductCode,
            etiquetaProdutoNome: labelProductCode ? labelProduct?.nome || labelProductField?.dataset.fallbackName || '' : '',
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
    async function duplicateSheet(sheetId) {
        const source = state.sheets.find(item => item.id === sheetId && !item.excluida);
        if (!source) return;
        const copy = normalizeSheet({
            ...clone(source),
            id:id('ficha'),
            nome:`${source.nome} (cópia)`,
            etiquetaProdutoCodigo:'',
            etiquetaProdutoNome:'',
            fotoReferencia:false,
            revisao:0,
            atualizadoEm:Date.now()
        });
        await openForm('', 'manager', copy);
    }
    async function openForm(sheetId = '', returnTarget = 'view', preset = null) {
        await Promise.all([refreshPurchaseProducts(), refreshLabelProducts()]);
        formReturnTarget = returnTarget;
        if (returnTarget === 'manager') document.getElementById('modalTechnicalSheetsManager').style.display = 'none';
        const sheet = preset || state.sheets.find(item => item.id === sheetId && !item.excluida) || normalizeSheet({ id:id('ficha'), cmvDesejado:30, ingredientes:[] });
        document.getElementById('technicalSheetTitle').textContent = sheetId ? 'Editar Ficha Técnica' : (preset ? 'Duplicar Ficha Técnica' : 'Nova Ficha Técnica');
        document.getElementById('technicalSheetId').value = sheet.id;
        document.getElementById('technicalSheetName').value = sheet.nome;
        document.getElementById('technicalSheetCategory').innerHTML = categoryOptions(sheet.categoria);
        document.getElementById('technicalSheetArea').innerHTML = areaOptions(sheet.setorId);
        const labelProductField = document.getElementById('technicalSheetLabelProduct');
        labelProductField.value = sheet.etiquetaProdutoCodigo || '';
        labelProductField.dataset.fallbackName = sheet.etiquetaProdutoNome || '';
        updateLabelProductNote();
        document.getElementById('technicalSheetYield').value = sheet.rendimento || '';
        document.getElementById('technicalSheetYieldUnit').value = sheet.rendimentoUnidade;
        document.getElementById('technicalSheetPortion').value = sheet.porcao || '';
        document.getElementById('technicalSheetPortionUnit').value = sheet.porcaoUnidade;
        document.getElementById('technicalSheetSalePrice').value = sheet.precoVenda || '';
        document.getElementById('technicalSheetTargetCmv').value = sheet.cmvDesejado || 30;
        document.getElementById('technicalSheetPreparation').innerHTML = global.AloTasks?.sanitizeRichHtml?.(sheet.preparo) || escapeHtml(sheet.preparo);
        document.getElementById('technicalSheetDelete').style.display = sheetId ? 'inline-flex' : 'none';
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
    async function removeIngredient(ingredientId) {
        const ingredient = readIngredients(true).find(item => item.id === ingredientId);
        const confirmed = await global.AloUiDialog?.confirm(
            `Excluir ${ingredient?.nome ? `“${ingredient.nome}”` : 'este ingrediente'} da ficha técnica?`,
            { title:'Excluir ingrediente', icon:'×', tone:'danger', confirmText:'Excluir' }
        );
        if (!confirmed) return;
        formIngredients = readIngredients(true).filter(item => item.id !== ingredientId);
        renderIngredients();
        previewCost();
    }
    function queueSheet(sheet) {
        state.sheets = state.sheets.filter(item => item.id !== sheet.id).concat(sheet);
        state.outbox = state.outbox.filter(item => item.ficha.id !== sheet.id).concat({ operationId:id('op'), ficha:clone(sheet) });
        saveState(); render(); setSyncStatus('syncing', 'Alterações aguardando envio');
        syncNow().catch(() => {});
    }
    async function syncLabelLink(sheet, previous) {
        if (!sheet.etiquetaProdutoCodigo && !previous?.etiquetaProdutoCodigo) return;
        if (typeof global.AloL42Module?.linkTechnicalSheet !== 'function') {
            if (sheet.etiquetaProdutoCodigo || previous?.etiquetaProdutoCodigo) throw new Error('O módulo Etiquetas ainda não está pronto para salvar o vínculo.');
            return;
        }
        const result = await global.AloL42Module.linkTechnicalSheet({
            fichaId:sheet.id,
            fichaNome:sheet.nome,
            produtoCodigo:sheet.etiquetaProdutoCodigo || '',
            produtoAnteriorCodigo:previous?.etiquetaProdutoCodigo || ''
        });
        if (!result || result.status !== 'ok') throw new Error(result?.message || 'O vínculo com Etiquetas não foi salvo.');
    }
    async function saveForm() {
        const draft = draftFromForm();
        if (!draft.nome || !draft.setorId) return global.AloUiDialog?.notice('Informe o nome e o setor da ficha.', { title:'Dados necessários', confirmText:'Entendi' });
        if (!draft.rendimento || !draft.porcao) return global.AloUiDialog?.notice('Informe o rendimento e o tamanho da porção.', { title:'Rendimento necessário', confirmText:'Entendi' });
        if (!draft.ingredientes.length) return global.AloUiDialog?.notice('Adicione pelo menos um ingrediente.', { title:'Ingrediente necessário', confirmText:'Entendi' });
        const current = state.sheets.find(item => item.id === draft.id);
        try {
            await saveIngredientPrices(draft.ingredientes);
            draft.ingredientes = draft.ingredientes.map(({ precoInformado, precoUnidade, fornecedorId, ...ingredient }) => ingredient);
            await refreshPurchaseProducts();
        } catch (error) {
            return global.AloUiDialog?.notice(error.message || 'O preço não foi registrado na Lista de Compras.', { title:'Preço não salvo', confirmText:'Entendi' });
        }
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
        try {
            await syncLabelLink(draft, current);
        } catch (error) {
            return global.AloUiDialog?.notice(error.message || 'O vínculo com Etiquetas não foi salvo.', { title:'Ficha não salva', confirmText:'Entendi' });
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
        try {
            await syncLabelLink({ ...current, etiquetaProdutoCodigo:'', etiquetaProdutoNome:'' }, current);
        } catch (error) {
            return global.AloUiDialog?.notice(error.message || 'Não foi possível remover o vínculo em Etiquetas.', { title:'Ficha não excluída', confirmText:'Entendi' });
        }
        queueSheet({ ...current, excluida:true, revisao:Number(current.revisao || 0) + 1, atualizadoEm:Date.now() });
        closeForm(false);
        if (formReturnTarget === 'manager') openManager(); else showView('sheets');
    }
    async function printLabel(sheetId) {
        const sheet = state.sheets.find(item => item.id === sheetId && !item.excluida);
        if (!sheet) return;
        document.getElementById('modalTechnicalSheetDetail').style.display = 'none';
        try {
            if (typeof global.abrirEtiquetaDaFicha !== 'function') throw new Error('O módulo Etiquetas ainda não está pronto.');
            await global.abrirEtiquetaDaFicha({ fichaId:sheet.id, nome:sheet.nome, codigo:sheet.etiquetaProdutoCodigo || '', returnTo:detailReturnModule });
        } catch (error) {
            global.AloUiDialog?.notice(error.message || 'Não foi possível abrir a etiqueta.', { title:'Etiqueta não aberta', confirmText:'Entendi' });
        }
    }
    function scaledSheet(sheet, ratio) {
        const factor = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
        return normalizeSheet({
            ...clone(sheet),
            rendimento:Number(sheet.rendimento || 0) * factor,
            ingredientes:sheet.ingredientes.map(ingredient => ({ ...ingredient, quantidade:Number(ingredient.quantidade || 0) * factor }))
        });
    }
    function detailScaleMarkup(sheet) {
        if (!sheet.ingredientes.length) return '';
        const selected = sheet.ingredientes.find(ingredient => ingredient.id === detailScaleIngredientId) || sheet.ingredientes[0];
        detailScaleIngredientId = selected.id;
        const adjustedQuantity = Number(selected.quantidade || 0) * detailScaleRatio;
        return `<section class="technical-recipe-scaler"><div class="technical-recipe-scaler-controls"><div class="form-group"><label for="technicalScaleIngredient">Ingrediente-base:</label><select id="technicalScaleIngredient" onchange="AloTechnicalSheets.updateDetailScaleBase()">${sheet.ingredientes.map(ingredient => `<option value="${escapeHtml(ingredient.id)}" ${ingredient.id === selected.id ? 'selected' : ''}>${escapeHtml(ingredient.nome || 'Ingrediente')}</option>`).join('')}</select></div><div class="form-group"><label for="technicalScaleQuantity">Nova quantidade:</label><div class="technical-scale-quantity"><input id="technicalScaleQuantity" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escapeHtml(Number(adjustedQuantity.toFixed(3)))}" onfocus="this.select()" onclick="this.select()"><span id="technicalScaleUnit">${escapeHtml(selected.unidade)}</span></div></div></div><div class="technical-scale-result"><span>${detailScaleRatio !== 1 ? `Quantidade ajustada em ${detailScaleRatio.toLocaleString('pt-BR', { maximumFractionDigits:2 })}×` : ''}</span><div>${detailScaleRatio !== 1 ? '<button type="button" class="technical-scale-reset" onclick="AloTechnicalSheets.resetDetailScale()">Usar original</button>' : ''}<button type="button" class="technical-scale-apply" onclick="AloTechnicalSheets.applyDetailScale()">Aplicar</button></div></div></section>`;
    }
    function renderDetailBody(sheet) {
        const adjusted = scaledSheet(sheet, detailScaleRatio);
        const cost = calculate(adjusted);
        const preparation = global.AloTasks?.sanitizeRichHtml?.(sheet.preparo || 'Preparo não informado.') || escapeHtml(sheet.preparo || 'Preparo não informado.');
        document.getElementById('technicalSheetDetailBody').innerHTML = `${sheet.fotoReferencia ? '<div id="technicalSheetDetailPhoto" class="task-reference-photo"><span>Carregando foto...</span></div>' : ''}<div class="technical-detail-summary"><div><small>Rendimento</small><strong>${Number(adjusted.rendimento || 0).toLocaleString('pt-BR', { maximumFractionDigits:2 })} ${escapeHtml(adjusted.rendimentoUnidade)}</strong></div><div><small>Porções</small><strong>${cost.portions ? cost.portions.toLocaleString('pt-BR', { maximumFractionDigits:1 }) : '—'}</strong></div><div><small>Custo do lote</small><strong>${cost.missing.length ? 'Incompleto' : money(cost.total)}</strong></div><div><small>Custo por porção</small><strong>${cost.missing.length ? 'Incompleto' : money(cost.portionCost)}</strong></div></div><div class="technical-detail-section-heading"><h3>Ingredientes</h3><div>${detailScaleRatio !== 1 ? '<span>Quantidade ajustada</span>' : ''}<button type="button" onclick="AloTechnicalSheets.toggleDetailScale()">Alterar quantidade</button></div></div>${detailScaleOpen ? detailScaleMarkup(sheet) : ''}<ul class="technical-detail-list">${cost.details.map(item => `<li><strong>${escapeHtml(item.nome)}</strong> · ${Number(item.quantidade || 0).toLocaleString('pt-BR', { maximumFractionDigits:3 })} ${escapeHtml(item.unidade)}${item.perda ? ` · perda ${item.perda}%` : ''}${item.cost !== null ? ` · ${money(item.cost)}` : ' · sem custo'}</li>`).join('')}</ul><h3>Preparo</h3><div class="task-procedure-content technical-preparation-content">${preparation}</div>${cost.missing.length ? `<div class="technical-cost-warning">O total não inclui: ${escapeHtml(cost.missing.join(', '))}.</div>` : ''}`;
        if (sheet.fotoReferencia) resolvePhoto(sheet.id).then(url => { const target = document.getElementById('technicalSheetDetailPhoto'); if (!target) return; if (!url) target.remove(); else target.innerHTML = `<img src="${escapeHtml(url)}" alt="Foto da ficha técnica">`; }).catch(() => document.getElementById('technicalSheetDetailPhoto')?.remove());
    }
    function updateDetailScaleBase() {
        const sheet = state.sheets.find(item => item.id === detailScaleSheetId && !item.excluida);
        const ingredientId = document.getElementById('technicalScaleIngredient')?.value || '';
        const ingredient = sheet?.ingredientes.find(item => item.id === ingredientId);
        if (!ingredient) return;
        detailScaleIngredientId = ingredient.id;
        const input = document.getElementById('technicalScaleQuantity');
        const unit = document.getElementById('technicalScaleUnit');
        if (input) input.value = Number((Number(ingredient.quantidade || 0) * detailScaleRatio).toFixed(3));
        if (unit) unit.textContent = ingredient.unidade;
    }
    function toggleDetailScale() {
        const sheet = state.sheets.find(item => item.id === detailScaleSheetId && !item.excluida);
        if (!sheet) return;
        detailScaleOpen = !detailScaleOpen;
        renderDetailBody(sheet);
    }
    function applyDetailScale() {
        const sheet = state.sheets.find(item => item.id === detailScaleSheetId && !item.excluida);
        const ingredient = sheet?.ingredientes.find(item => item.id === (document.getElementById('technicalScaleIngredient')?.value || detailScaleIngredientId));
        const target = Number(document.getElementById('technicalScaleQuantity')?.value || 0);
        if (!ingredient || !(Number(ingredient.quantidade) > 0) || !(target > 0)) return global.AloUiDialog?.notice('Informe uma quantidade maior que zero.', { title:'Quantidade necessária', confirmText:'Entendi' });
        detailScaleIngredientId = ingredient.id;
        detailScaleRatio = target / Number(ingredient.quantidade);
        detailScaleOpen = false;
        renderDetailBody(sheet);
    }
    function resetDetailScale() {
        const sheet = state.sheets.find(item => item.id === detailScaleSheetId && !item.excluida);
        if (!sheet) return;
        detailScaleRatio = 1;
        detailScaleOpen = false;
        renderDetailBody(sheet);
    }
    function closeDetail() {
        document.getElementById('modalTechnicalSheetDetail').style.display = 'none';
        const returnModule = detailReturnModule;
        detailReturnModule = '';
        if (returnModule === 'l42') global.AloTasks?.openModule?.('l42');
    }
    function openDetail(sheetId, options = {}) {
        const sheet = state.sheets.find(item => item.id === sheetId && !item.excluida);
        if (!sheet) return;
        detailReturnModule = String(options.returnTo || '');
        detailScaleSheetId = sheet.id;
        detailScaleIngredientId = sheet.ingredientes[0]?.id || '';
        detailScaleRatio = 1;
        detailScaleOpen = false;
        document.getElementById('technicalSheetDetailTitle').textContent = sheet.nome;
        renderDetailBody(sheet);
        document.getElementById('technicalSheetDetailLabel').onclick = () => printLabel(sheet.id);
        document.getElementById('technicalSheetDetailEdit').onclick = () => { document.getElementById('modalTechnicalSheetDetail').style.display = 'none'; openForm(sheet.id); };
        deps.openModalTop?.('modalTechnicalSheetDetail') || (document.getElementById('modalTechnicalSheetDetail').style.display = 'flex');
    }

    function updateLabelProductReference(reference = {}) {
        const oldCode = String(reference.oldCode || '');
        const newCode = String(reference.newCode || '');
        if (!oldCode) return false;
        const changed = [];
        state.sheets = state.sheets.map(sheet => {
            if (sheet.excluida || String(sheet.etiquetaProdutoCodigo || '') !== oldCode) return sheet;
            const nextName = newCode ? String(reference.name || sheet.etiquetaProdutoNome || '') : '';
            if (String(sheet.etiquetaProdutoCodigo || '') === newCode && String(sheet.etiquetaProdutoNome || '') === nextName) return sheet;
            const updated = normalizeSheet({
                ...sheet,
                etiquetaProdutoCodigo:newCode,
                etiquetaProdutoNome:nextName,
                revisao:Number(sheet.revisao || 0) + 1,
                atualizadoEm:Date.now()
            });
            changed.push(updated);
            return updated;
        });
        if (!changed.length) return false;
        changed.forEach(sheet => {
            state.outbox = state.outbox.filter(item => item.ficha.id !== sheet.id).concat({ operationId:id('op'), ficha:clone(sheet) });
        });
        saveState();
        render();
        setSyncStatus('syncing', 'Vínculo com Etiquetas aguardando envio');
        syncNow().catch(() => {});
        return true;
    }

    function mergeRemote(remote) {
        const records = Array.isArray(remote) ? remote : [];
        const remoteCategoryRecord = records.find(record => String(record?.id) === CATEGORY_RECORD_ID);
        if (remoteCategoryRecord) {
            const remoteRevision = Number(remoteCategoryRecord.revisao || 0);
            const remoteUpdatedAt = Number(remoteCategoryRecord.atualizadoEm || 0);
            const hasNewerCategories = remoteRevision > Number(state.categoriesRevision || 0)
                || (remoteRevision === Number(state.categoriesRevision || 0) && remoteUpdatedAt > Number(state.categoriesUpdatedAt || 0));
            const categoriesPending = state.outbox.some(item => item.ficha?.id === CATEGORY_RECORD_ID && Number(item.ficha.revisao || 0) > remoteRevision);
            if (hasNewerCategories && !categoriesPending) {
                state.categories = Array.isArray(remoteCategoryRecord.categorias) ? remoteCategoryRecord.categorias.map(String).filter(Boolean) : [];
                state.categoryColors = normalizeCategoryColors(remoteCategoryRecord.categoryColors);
                state.categoryTextColors = normalizeCategoryTextColors(remoteCategoryRecord.categoryTextColors);
                state.categoriesRevision = remoteRevision;
                state.categoriesUpdatedAt = remoteUpdatedAt;
            }
        }
        const remoteById = new Map(records.filter(record => String(record?.id) !== CATEGORY_RECORD_ID).map(normalizeSheet).map(sheet => [sheet.id, sheet]));
        const local = new Map(state.sheets.map(sheet => [sheet.id, sheet]));
        remoteById.forEach(sheet => {
            const current = local.get(sheet.id);
            const pending = state.outbox.some(item => item.ficha.id === sheet.id && Number(item.ficha.revisao) > Number(sheet.revisao));
            if (!pending && (!current || Number(sheet.revisao) > Number(current.revisao) || (Number(sheet.revisao) === Number(current.revisao) && sheet.atualizadoEm > current.atualizadoEm))) local.set(sheet.id, sheet);
        });
        state.sheets = [...local.values()];
        state.outbox = state.outbox.filter(operation => {
            if (operation.ficha?.id === CATEGORY_RECORD_ID) {
                return !remoteCategoryRecord || Number(remoteCategoryRecord.revisao || 0) < Number(operation.ficha.revisao || 0);
            }
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
                if (!Array.isArray(confirmation.fichas)) throw new Error('Atualize a implantação do Google Apps Script para sincronizar fichas técnicas.');
                mergeRemote(confirmation.fichas);
                state.revision = Number(confirmation.revision || state.revision);
            }
            if (state.outbox.length) throw new Error('A nuvem não confirmou as alterações das fichas técnicas.');
        }
        const result = await getRemote(state.revision);
        if (result.changed && !Array.isArray(result.fichas)) throw new Error('Atualize a implantação do Google Apps Script para sincronizar fichas técnicas.');
        if (result.changed) mergeRemote(result.fichas);
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
        state = {
            sheets:backup.sheets.map(normalizeSheet),
            outbox:Array.isArray(backup.outbox) ? backup.outbox : [],
            revision:Number(backup.revision || 0),
            categories:Array.isArray(backup.categories) ? backup.categories.map(String).filter(Boolean) : [],
            categoryColors:normalizeCategoryColors(backup.categoryColors),
            categoryTextColors:normalizeCategoryTextColors(backup.categoryTextColors),
            categoriesRevision:Number(backup.categoriesRevision || 0),
            categoriesUpdatedAt:Number(backup.categoriesUpdatedAt || 0)
        };
        saveState(); render(); return true;
    }

    global.AloTechnicalSheets = Object.freeze({
        configure, showView, openManager, closeManager, render, toggleMainSearch, clearMainSearch, renderManager, setCategory, setManagerCategory, getLinkOptions, openCategoryManager, closeCategoryManager, renderCategoryManager, createCategory, renameCategory, deleteCategory, openCategoryColor, closeCategoryColor, previewCategoryColor, saveCategoryColors, openForm, duplicateSheet, closeForm, addIngredient, removeIngredient,
        openIngredientSearch, renderIngredientSearch, selectIngredientProduct, closeIngredientSearch, createPurchaseIngredient, returnFromPurchaseProduct, openPriceEditor, closePriceEditor, savePriceEditor, updateLabelProductNote,
        openLabelProductPicker, closeLabelProductPicker, setLabelProductCategory, renderLabelProductPicker, selectLabelProduct,
        previewCost, saveForm, deleteCurrent, openDetail, closeDetail, printLabel, toggleDetailScale, updateDetailScaleBase, applyDetailScale, resetDetailScale, updateLabelProductReference, handlePhoto, removePhotoDraft, syncNow, getBackup, restoreBackup, calculate
    });
})(window);
