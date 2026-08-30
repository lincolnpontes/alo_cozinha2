(function (global) {
    const VERSION = '2.1.18';
    const SCHEMA_VERSION = 2;
    const STORAGE_KEY = 'alo_core_shared_v2';
    const L42_PERMISSION_KEYS = [
        'imprimir', 'estoque', 'darBaixa', 'movimentacao', 'relatorios',
        'produtos', 'categorias', 'estilo', 'configuracoes', 'operadores', 'avancado'
    ];
    const PERSON_EMOJIS = Object.freeze([
        '👤', '🧑', '👩', '👨', '🧑🏻', '🧑🏼', '🧑🏽', '🧑🏾', '🧑🏿',
        '👩🏻', '👩🏼', '👩🏽', '👩🏾', '👩🏿', '👨🏻', '👨🏼', '👨🏽', '👨🏾', '👨🏿',
        '🧑‍🍳', '👩‍🍳', '👨‍🍳', '👩🏻‍🍳', '👩🏼‍🍳', '👩🏽‍🍳', '👩🏾‍🍳', '👩🏿‍🍳',
        '👨🏻‍🍳', '👨🏼‍🍳', '👨🏽‍🍳', '👨🏾‍🍳', '👨🏿‍🍳',
        '🧑‍💼', '👩‍💼', '👨‍💼', '👩🏻‍💼', '👩🏽‍💼', '👩🏿‍💼', '👨🏻‍💼', '👨🏽‍💼', '👨🏿‍💼',
        '🧑‍💻', '👩‍💻', '👨‍💻', '🧑‍🔧', '👩‍🔧', '👨‍🔧', '🧑‍🌾', '👩‍🌾', '👨‍🌾',
        '🧑‍⚕️', '👩‍⚕️', '👨‍⚕️', '🧑‍🏫', '👩‍🏫', '👨‍🏫'
    ]);
    const adapters = new Map();
    const listeners = new Set();
    let deps = { getDatabase: null, markDatabaseChanged: null, openModalTop: null };
    let state = loadLocalState();
    let refreshPromise = null;
    let sourcesLoaded = Boolean(state.migration?.identitiesMerged);
    let comprasCategorySnapshot = [];

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function comparableText(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function hashText(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function stableId(prefix, value) {
        return `${prefix}_${hashText(comparableText(value) || `${Date.now()}_${Math.random()}`)}`;
    }

    function defaultL42Permissions(admin = false) {
        const permissions = {
            acesso: false,
            imprimir: true,
            estoque: true,
            darBaixa: true,
            movimentacao: true,
            relatorios: false,
            produtos: false,
            categorias: false,
            estilo: false,
            configuracoes: false,
            operadores: false,
            avancado: false
        };
        if (admin) {
            permissions.acesso = true;
            L42_PERMISSION_KEYS.forEach(key => { permissions[key] = true; });
        }
        return permissions;
    }

    function defaultPermissions(admin = false) {
        return {
            kds: { configuracoes: admin },
            checklist: { configuracoes: admin, funcionario: false, setorId: '', setorIds: [] },
            compras: { acesso: false, receber: true, comprar: true, categoriasPedido: [], categoriasCompras: [] },
            l42: defaultL42Permissions(admin)
        };
    }

    function normalizeCredentials(credentials) {
        const source = credentials && typeof credentials === 'object' ? credentials : {};
        const alternatives = Array.isArray(source.alternatives) ? source.alternatives : [];
        const unique = [];
        alternatives.forEach(item => {
            if (!item || !item.scheme) return;
            const normalized = {
                scheme: String(item.scheme),
                hash: String(item.hash || ''),
                salt: String(item.salt || ''),
                algorithm: String(item.algorithm || '')
            };
            const signature = JSON.stringify(normalized);
            if ((normalized.hash || normalized.scheme === 'none') && !unique.some(existing => JSON.stringify(existing) === signature)) unique.push(normalized);
        });
        return { alternatives: unique };
    }

    function normalizePerson(person, index = 0) {
        const source = person && typeof person === 'object' ? person : {};
        const name = String(source.nome || source.name || '').trim() || `Pessoa ${index + 1}`;
        const admin = Boolean(source.isAdmin);
        const defaults = defaultPermissions(admin);
        const permissions = source.permissions && typeof source.permissions === 'object' ? source.permissions : {};
        const links = source.links && typeof source.links === 'object' ? source.links : {};
        const normalized = {
            id: String(source.id || stableId('pessoa', name)),
            nome: name,
            emoji: String(source.emoji || '👤'),
            ativo: source.ativo !== false,
            podeEntrar: source.podeEntrar === true,
            isAdmin: admin,
            credentials: normalizeCredentials(source.credentials),
            permissions: {
                kds: { ...defaults.kds, ...(permissions.kds || {}) },
                checklist: { ...defaults.checklist, ...(permissions.checklist || {}) },
                compras: { ...defaults.compras, ...(permissions.compras || {}) },
                l42: { ...defaults.l42, ...(permissions.l42 || {}) }
            },
            links: {
                comprasId: String(links.comprasId || ''),
                l42Nome: String(links.l42Nome || ''),
                checklistId: String(links.checklistId || '')
            },
            atualizadoEm: Number(source.atualizadoEm || 0)
        };
        const checklistAreaIds = Array.isArray(normalized.permissions.checklist.setorIds)
            ? normalized.permissions.checklist.setorIds.map(String).filter(Boolean)
            : [];
        if (!checklistAreaIds.length && normalized.permissions.checklist.setorId) checklistAreaIds.push(String(normalized.permissions.checklist.setorId));
        normalized.permissions.checklist.setorIds = [...new Set(checklistAreaIds)];
        normalized.permissions.checklist.setorId = normalized.permissions.checklist.setorIds.length === 1
            ? normalized.permissions.checklist.setorIds[0]
            : '';
        if (permissions.compras?.acesso === undefined) normalized.permissions.compras.acesso = Boolean(links.comprasId);
        if (permissions.l42?.acesso === undefined) normalized.permissions.l42.acesso = Boolean(links.l42Nome);
        // Etiquetas é um módulo operacional protegido por PIN. O controle específico
        // permanece apenas para as configurações, evitando dois switches concorrentes.
        if (normalized.credentials.alternatives.length) normalized.permissions.l42.acesso = true;
        grantAdminPermissions(normalized);
        refreshDerivedAccess(normalized);
        return normalized;
    }

    function hasProtectedAccess(person) {
        return Boolean(person?.isAdmin
            || person?.permissions?.kds?.configuracoes
            || person?.permissions?.checklist?.configuracoes
            || person?.permissions?.compras?.acesso
            || person?.permissions?.l42?.acesso);
    }

    function refreshDerivedAccess(person) {
        if (person) person.podeEntrar = person.ativo !== false && hasProtectedAccess(person);
        return person?.podeEntrar === true;
    }

    function grantAdminPermissions(person) {
        if (!person?.isAdmin) return person;
        person.permissions.kds.configuracoes = true;
        person.permissions.checklist.configuracoes = true;
        person.permissions.compras.acesso = true;
        person.permissions.compras.receber = true;
        person.permissions.compras.comprar = true;
        person.permissions.l42.acesso = true;
        L42_PERMISSION_KEYS.forEach(key => { person.permissions.l42[key] = true; });
        person.permissions.l42.operadores = false;
        return person;
    }

    function normalizeProduct(product, index = 0) {
        const source = product && typeof product === 'object' ? product : {};
        const name = String(source.nome || source.name || '').trim() || `Produto ${index + 1}`;
        return {
            id: String(source.id || stableId('produto', name)),
            nome: name,
            ativo: source.ativo !== false,
            sources: source.sources && typeof source.sources === 'object' ? source.sources : {},
            atualizadoEm: Number(source.atualizadoEm || 0)
        };
    }

    function emptyState() {
        return {
            schemaVersion: SCHEMA_VERSION,
            revision: 0,
            updatedAt: 0,
            restaurant: {},
            people: [],
            catalog: [],
            sourceStats: {},
            migration: { identitiesMerged: false, catalogIndexed: false }
        };
    }

    function normalizeState(input) {
        const base = emptyState();
        const source = input && typeof input === 'object' ? input : {};
        return {
            ...base,
            ...source,
            schemaVersion: SCHEMA_VERSION,
            revision: Number(source.revision || 0),
            updatedAt: Number(source.updatedAt || 0),
            restaurant: source.restaurant && typeof source.restaurant === 'object' ? source.restaurant : {},
            people: (Array.isArray(source.people) ? source.people : []).map(normalizePerson),
            catalog: (Array.isArray(source.catalog) ? source.catalog : []).map(normalizeProduct),
            sourceStats: source.sourceStats && typeof source.sourceStats === 'object' ? source.sourceStats : {},
            migration: { ...base.migration, ...(source.migration || {}) }
        };
    }

    function loadLocalState() {
        try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
        catch (error) { return emptyState(); }
    }

    function notify(reason) {
        const detail = Object.freeze({ reason: String(reason || 'updated'), revision: state.revision });
        listeners.forEach(listener => listener(detail));
        global.document?.dispatchEvent?.(new CustomEvent('alo:shared-data-change', { detail }));
    }

    function persist(reason, { cloud = true } = {}) {
        state.schemaVersion = SCHEMA_VERSION;
        state.revision = Number(state.revision || 0) + 1;
        state.updatedAt = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        const database = deps.getDatabase?.();
        if (database) database.coreCompartilhado = clone(state);
        if (cloud) deps.markDatabaseChanged?.();
        notify(reason);
    }

    function useNewestStoredState() {
        const databaseState = deps.getDatabase?.()?.coreCompartilhado;
        const localState = loadLocalState();
        state = Number(databaseState?.revision || 0) > Number(localState.revision || 0)
            ? normalizeState(databaseState)
            : normalizeState(localState);
        const database = deps.getDatabase?.();
        if (database) database.coreCompartilhado = clone(state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function addCredential(person, credential) {
        if (!credential || !credential.scheme || !credential.hash) return;
        const normalized = normalizeCredentials({ alternatives: [credential] }).alternatives[0];
        if (!normalized) return;
        const signature = JSON.stringify(normalized);
        if (!person.credentials.alternatives.some(item => JSON.stringify(item) === signature)) person.credentials.alternatives.push(normalized);
    }

    function findPerson(sourcePerson, moduleId) {
        const sourceId = String(sourcePerson.id || sourcePerson.sourceId || '');
        const byLink = state.people.find(person => {
            if (moduleId === 'compras') return sourceId && person.links.comprasId === sourceId;
            if (moduleId === 'l42') return comparableText(person.links.l42Nome) === comparableText(sourcePerson.nome);
            if (moduleId === 'checklist') return sourceId && person.links.checklistId === sourceId;
            return false;
        });
        return byLink || state.people.find(person => comparableText(person.nome) === comparableText(sourcePerson.nome));
    }

    async function importPerson(sourcePerson, moduleId) {
        if (!sourcePerson || !String(sourcePerson.nome || '').trim()) return false;
        let person = findPerson(sourcePerson, moduleId);
        let changed = false;
        let created = false;
        if (!person) {
            person = normalizePerson({
                id: stableId('pessoa', sourcePerson.nome),
                nome: sourcePerson.nome,
                emoji: sourcePerson.emoji || '👤',
                ativo: sourcePerson.ativo !== false,
                podeEntrar: false,
                isAdmin: Boolean(sourcePerson.isAdmin),
                atualizadoEm: sourcePerson.atualizadoEm
            }, state.people.length);
            state.people.push(person);
            changed = true;
            created = true;
        }
        const importSourceSettings = created || !state.migration.identitiesMerged;

        if (!person.emoji || person.emoji === '👤') person.emoji = sourcePerson.emoji || person.emoji || '👤';
        const needsFirstAdmin = sourcePerson.isAdmin && !state.people.some(item => item.isAdmin);
        if ((importSourceSettings || needsFirstAdmin) && sourcePerson.isAdmin && !person.isAdmin) {
            person.isAdmin = true;
            person.permissions.kds.configuracoes = true;
            person.permissions.checklist.configuracoes = true;
            person.permissions.compras.acesso = true;
            person.permissions.l42.acesso = true;
            L42_PERMISSION_KEYS.forEach(key => { person.permissions.l42[key] = true; });
            changed = true;
        }

        if (moduleId === 'compras') {
            if (person.links.comprasId !== String(sourcePerson.id || '')) { person.links.comprasId = String(sourcePerson.id || ''); changed = true; }
            if (importSourceSettings) {
                const modulePermissions = sourcePerson.permissoesModulos || {};
                person.permissions.compras.acesso = true;
                person.permissions.kds.configuracoes = modulePermissions.kds?.configuracoes ?? person.isAdmin;
                person.permissions.checklist.configuracoes = modulePermissions.checklist?.configuracoes ?? person.isAdmin;
                person.permissions.compras.receber = modulePermissions.compras?.receber !== false;
                person.permissions.compras.comprar = modulePermissions.compras?.comprar !== false;
                person.permissions.compras.categoriasPedido = clone(sourcePerson.catsPermitidasPedido || sourcePerson.catsPermitidas || []);
                person.permissions.compras.categoriasCompras = clone(sourcePerson.catsPermitidasCompras || sourcePerson.catsPermitidas || []);
                if (sourcePerson.senhaHash) addCredential(person, { scheme: 'pbkdf2-sha256', hash: sourcePerson.senhaHash });
                else if (sourcePerson.senha) addCredential(person, { scheme: 'plain-legacy', hash: sourcePerson.senha });
            }
        } else if (moduleId === 'l42') {
            if (person.links.l42Nome !== String(sourcePerson.nome || '')) { person.links.l42Nome = String(sourcePerson.nome || ''); changed = true; }
            if (importSourceSettings) {
                person.permissions.l42.acesso = true;
                person.permissions.l42 = { ...person.permissions.l42, ...(sourcePerson.permissoes || {}) };
                person.permissions.l42.acesso = true;
                if (sourcePerson.senhaCentralHash) addCredential(person, { scheme: 'pbkdf2-sha256', hash: sourcePerson.senhaCentralHash });
                if (sourcePerson.senhaHash && sourcePerson.senhaSalt) {
                    addCredential(person, {
                        scheme: 'l42-pbkdf2-sha256-v1',
                        hash: sourcePerson.senhaHash,
                        salt: sourcePerson.senhaSalt,
                        algorithm: sourcePerson.senhaAlgoritmo || 'pbkdf2-sha256-v1'
                    });
                } else if (sourcePerson.senha) addCredential(person, { scheme: 'plain-legacy', hash: sourcePerson.senha });
            }
        } else if (moduleId === 'checklist') {
            if (person.links.checklistId !== String(sourcePerson.id || '')) { person.links.checklistId = String(sourcePerson.id || ''); changed = true; }
            if (importSourceSettings) {
                person.permissions.checklist.funcionario = true;
                const sourceAreaIds = Array.isArray(sourcePerson.setorIds) ? sourcePerson.setorIds.map(String).filter(Boolean) : [];
                if (!sourceAreaIds.length && sourcePerson.setorId) sourceAreaIds.push(String(sourcePerson.setorId));
                person.permissions.checklist.setorIds = [...new Set(sourceAreaIds)];
                person.permissions.checklist.setorId = person.permissions.checklist.setorIds.length === 1 ? person.permissions.checklist.setorIds[0] : '';
            }
        }
        const previousAccess = person.podeEntrar;
        refreshDerivedAccess(person);
        if (previousAccess !== person.podeEntrar) changed = true;
        person.atualizadoEm = Math.max(Number(person.atualizadoEm || 0), Number(sourcePerson.atualizadoEm || 0));
        return changed;
    }

    function productSourceData(product, moduleId) {
        if (moduleId === 'kds') return { id: product.id || product.nome, categoria: product.categoria || '', areaDestino: product.areaDestino || '' };
        if (moduleId === 'compras') return { id: product.id || '', categoriaId: product.categoriaId || '', unidades: clone(product.unidades || []) };
        if (moduleId === 'l42') return { id: String(product.codigo ?? product.id ?? ''), categoria: product.categoria || '', validadeDias: Number(product.validadeDias || 0) };
        return { id: product.id || product.nome || '' };
    }

    function importProducts(products, moduleId) {
        let changed = false;
        (Array.isArray(products) ? products : []).forEach(product => {
            if (!product || !String(product.nome || '').trim()) return;
            let shared = state.catalog.find(item => comparableText(item.nome) === comparableText(product.nome));
            if (!shared) {
                shared = normalizeProduct({ id: stableId('produto', product.nome), nome: product.nome, ativo: product.ativo !== false });
                state.catalog.push(shared);
                changed = true;
            }
            const nextSource = productSourceData(product, moduleId);
            if (JSON.stringify(shared.sources[moduleId] || {}) !== JSON.stringify(nextSource)) {
                shared.sources[moduleId] = nextSource;
                changed = true;
            }
        });
        return changed;
    }

    async function mergeSnapshot(moduleId, snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return false;
        let changed = false;
        for (const person of (snapshot.people || [])) {
            if (await importPerson(person, moduleId)) changed = true;
        }
        if (importProducts(snapshot.products, moduleId)) changed = true;
        const nextStats = {
            people: Array.isArray(snapshot.people) ? snapshot.people.length : 0,
            products: Array.isArray(snapshot.products) ? snapshot.products.length : 0,
            categories: Array.isArray(snapshot.categories) ? snapshot.categories.length : 0,
            history: Number(snapshot.historyCount || 0)
        };
        if (JSON.stringify(state.sourceStats[moduleId] || {}) !== JSON.stringify(nextStats)) {
            state.sourceStats[moduleId] = nextStats;
            changed = true;
        }
        if (snapshot.restaurant?.nome) {
            const currentTimestamp = Number(state.restaurant?.atualizadoEm || 0);
            const incomingTimestamp = Number(snapshot.restaurant.atualizadoEm || 0);
            const canReplace = !state.restaurant?.nome || incomingTimestamp > currentTimestamp;
            if (canReplace && JSON.stringify(state.restaurant) !== JSON.stringify(snapshot.restaurant)) {
                state.restaurant = clone(snapshot.restaurant);
                changed = true;
            }
        }
        return changed;
    }

    function localChecklistSnapshot() {
        const database = deps.getDatabase?.() || {};
        return {
            people: Array.isArray(database.funcionarios) ? database.funcionarios : [],
            products: [], categories: [], historyCount: 0
        };
    }

    function localKdsSnapshot() {
        const database = deps.getDatabase?.() || {};
        return {
            people: [],
            products: Array.isArray(database.produtos) ? database.produtos : [],
            categories: Array.isArray(database.categorias) ? database.categorias : [],
            historyCount: 0
        };
    }

    async function syncPeopleToModules() {
        const people = clone(state.people);
        const restaurant = clone(state.restaurant);
        const jobs = [];
        adapters.forEach(adapter => {
            const peopleJob = adapter.applyPeople?.(people);
            const restaurantJob = adapter.applyRestaurant?.(restaurant);
            if (peopleJob) jobs.push(peopleJob);
            if (restaurantJob) jobs.push(restaurantJob);
        });
        if (global.AloTasks?.applySharedPeople) jobs.push(global.AloTasks.applySharedPeople(people));
        await Promise.allSettled(jobs);
    }

    async function updateFromModule(moduleId, snapshot) {
        const before = JSON.stringify(state);
        await mergeSnapshot(String(moduleId), snapshot);
        if (JSON.stringify(state) !== before) persist(`${moduleId}-updated`);
        await syncPeopleToModules();
        return describe();
    }

    async function refreshSources({ includeFrames = true, push = true } = {}) {
        if (refreshPromise) return refreshPromise;
        refreshPromise = (async () => {
            const before = JSON.stringify(state);
            await mergeSnapshot('checklist', localChecklistSnapshot());
            await mergeSnapshot('kds', localKdsSnapshot());
            if (includeFrames) {
                const snapshots = await Promise.allSettled([...adapters.entries()].map(async ([id, adapter]) => [id, await adapter.getSnapshot?.()]));
                for (const result of snapshots) {
                    if (result.status === 'fulfilled' && result.value?.[1]) await mergeSnapshot(result.value[0], result.value[1]);
                }
            }
            state.migration.identitiesMerged = state.people.length > 0;
            state.migration.catalogIndexed = state.catalog.length > 0;
            if (JSON.stringify(state) !== before) persist('sources-merged');
            if (push) await syncPeopleToModules();
            sourcesLoaded = true;
            return describe();
        })().finally(() => { refreshPromise = null; });
        return refreshPromise;
    }

    function registerAdapter(moduleId, adapter) {
        const id = String(moduleId || '').trim();
        if (!id || !adapter || typeof adapter !== 'object') throw new TypeError('Adaptador compartilhado inválido.');
        adapters.set(id, adapter);
        return () => adapters.delete(id);
    }

    function configure(options = {}) {
        deps = { ...deps, ...options };
        useNewestStoredState();
        return describe();
    }

    async function ensureReady() {
        if (!sourcesLoaded) await refreshSources({ includeFrames: true, push: true });
        return describe();
    }

    function safePerson(person) {
        return {
            id: person.id,
            nome: person.nome,
            emoji: person.emoji || '👤',
            ativo: person.ativo !== false,
            podeEntrar: person.podeEntrar === true,
            isAdmin: Boolean(person.isAdmin),
            possuiPin: person.credentials.alternatives.length > 0,
            permissions: clone(person.permissions),
            podeConfigurarKds: Boolean(person.permissions.kds.configuracoes),
            podeConfigurarChecklist: Boolean(person.permissions.checklist.configuracoes),
            podeAcessarCompras: Boolean(person.permissions.compras.acesso || person.isAdmin),
            podeAcessarEtiquetas: Boolean(person.permissions.l42.acesso || person.isAdmin),
            podeConfigurarEtiquetas: Boolean(person.permissions.l42.configuracoes || person.isAdmin),
            podeConfigurarL42: Boolean(person.permissions.l42.configuracoes || person.isAdmin)
        };
    }

    async function derivePin(pin, salt, iterations) {
        if (!global.crypto?.subtle) throw new Error('Criptografia segura indisponível neste aparelho.');
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin || '')), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
        return new Uint8Array(bits);
    }

    function bytesToBase64(bytes) {
        let binary = '';
        bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary);
    }

    function base64ToBytes(value) {
        const binary = atob(String(value || ''));
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    }

    async function createPinHash(pin) {
        const value = String(pin || '').trim();
        if (!value) return null;
        const iterations = 150000;
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const hash = await derivePin(value, salt, iterations);
        return { scheme: 'pbkdf2-sha256', hash: `pbkdf2$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hash)}` };
    }

    async function verifyCredential(pin, credential) {
        if (!credential) return false;
        if (credential.scheme === 'plain-legacy') return String(pin || '') === credential.hash;
        if (credential.scheme === 'pbkdf2-sha256') {
            const parts = String(credential.hash || '').split('$');
            if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
            const expected = base64ToBytes(parts[3]);
            const calculated = await derivePin(pin, base64ToBytes(parts[2]), Number(parts[1]));
            if (expected.length !== calculated.length) return false;
            let difference = 0;
            for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ calculated[index];
            return difference === 0;
        }
        if (credential.scheme === 'l42-pbkdf2-sha256-v1') {
            const expected = base64ToBytes(credential.hash);
            const calculated = await derivePin(pin, base64ToBytes(credential.salt), 120000);
            if (expected.length !== calculated.length) return false;
            let difference = 0;
            for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ calculated[index];
            return difference === 0;
        }
        return false;
    }

    function personCanUse(person, purpose = '') {
        if (!purpose) return true;
        if (person.isAdmin) return true;
        if (purpose === 'compras') return person.permissions.compras.acesso === true;
        if (purpose === 'l42') return person.permissions.l42.acesso === true;
        if (purpose === 'kds') return person.permissions.kds.configuracoes === true;
        if (purpose === 'checklist') return person.permissions.checklist.configuracoes === true;
        if (purpose === 'kds_operacional' || purpose === 'checklist_operacional') return person.permissions.checklist.funcionario === true;
        if (purpose === 'painel') return person.isAdmin === true;
        return true;
    }

    async function listLoginPeople(purpose = '') {
        await ensureReady();
        const operational = purpose === 'kds_operacional' || purpose === 'checklist_operacional';
        return state.people.filter(person => person.ativo !== false && (operational || person.podeEntrar === true) && personCanUse(person, purpose))
            .sort((a, b) => a.nome.localeCompare(b.nome))
            .map(safePerson);
    }

    async function authenticate(id, pin) {
        await ensureReady();
        const person = state.people.find(item => item.id === id && item.ativo !== false);
        if (!person) return { ok: false, reason: 'not_found' };
        const credentials = person.credentials.alternatives;
        let valid = credentials.length === 0 && String(pin || '') === '';
        for (const credential of credentials) {
            if (await verifyCredential(String(pin || ''), credential)) { valid = true; break; }
        }
        if (!valid) return { ok: false, reason: 'invalid_pin' };
        return { ok: true, operador: safePerson(person) };
    }

    async function activateForModule(moduleId, personId) {
        const person = state.people.find(item => item.id === personId && item.ativo !== false);
        if (!person) throw new Error('Pessoa não encontrada.');
        if (!personCanUse(person, moduleId)) throw new Error('Esta pessoa não tem acesso a este módulo.');
        const adapter = adapters.get(moduleId);
        await adapter?.applyPeople?.(clone(state.people));
        await adapter?.activatePerson?.(clone(person));
        localStorage.setItem(`alo_core_last_person_${moduleId}`, person.id);
        return safePerson(person);
    }

    async function logoutModule(moduleId) {
        await adapters.get(moduleId)?.logout?.();
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function renderPeopleManager() {
        const list = document.getElementById('sharedPeopleList');
        if (!list) return;
        const people = [...state.people].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));
        list.innerHTML = people.length ? people.map(person => {
            const badges = [
                person.permissions.checklist.funcionario ? '<span>Funcionário</span>' : '',
                person.permissions.compras.acesso ? '<span>Compras</span>' : '',
                person.permissions.l42.acesso ? '<span>Etiquetas</span>' : '',
                person.isAdmin ? '<span>Administrador</span>' : ''
            ].filter(Boolean).join('');
            return `<article class="shared-person-item ${person.ativo ? '' : 'inactive'}"><div class="shared-person-main"><b>${escapeHtml(person.emoji)} ${escapeHtml(person.nome)}</b><div class="shared-person-badges">${badges || '<span>Sem acesso operacional</span>'}</div></div><button type="button" onclick="AloSharedData.openPersonForm('${escapeHtml(person.id)}')" aria-label="Editar ${escapeHtml(person.nome)}" title="Editar">✏️</button></article>`;
        }).join('') : '<div class="shared-data-empty">Nenhuma pessoa cadastrada.</div>';
        const summary = document.getElementById('sharedDataSummary');
        if (summary) {
            const loginCount = state.people.filter(person => person.ativo && hasProtectedAccess(person)).length;
            const employeeCount = state.people.filter(person => person.ativo && person.permissions.checklist.funcionario).length;
            summary.textContent = `${employeeCount} funcionário(s) · ${loginCount} acesso(s) ao aplicativo`;
        }
    }

    async function openManager() {
        global.fecharModal?.('modalPainelUnificado');
        const modal = document.getElementById('modalPessoasCompartilhadas');
        if (!modal) return;
        const list = document.getElementById('sharedPeopleList');
        if (list) list.innerHTML = '<div class="shared-data-empty">Unificando cadastros...</div>';
        deps.openModalTop?.('modalPessoasCompartilhadas') || (modal.style.display = 'flex');
        try { await ensureReady(); }
        catch (error) {
            if (list) list.innerHTML = `<div class="shared-data-empty danger">${escapeHtml(error.message || 'Não foi possível conferir os módulos.')}</div>`;
        }
        renderPeopleManager();
    }

    function closeManager() {
        global.fecharModal?.('modalPessoasCompartilhadas');
        global.abrirPainelControle?.();
    }

    function setCheckbox(id, checked) {
        const element = document.getElementById(id);
        if (element) element.checked = Boolean(checked);
    }

    function selectPersonEmoji(emoji) {
        const selected = PERSON_EMOJIS.includes(emoji) ? emoji : '👤';
        const input = document.getElementById('sharedPersonEmoji');
        if (input) input.value = selected;
        const trigger = document.getElementById('sharedPersonEmojiButton');
        if (trigger) trigger.textContent = selected;
        document.querySelectorAll('#sharedPersonEmojiGrid [data-person-emoji]').forEach(button => {
            const active = button.dataset.personEmoji === selected;
            button.classList.toggle('selected', active);
            button.setAttribute('aria-selected', String(active));
        });
        togglePersonEmojiPicker(false);
    }

    function toggleFloatingPicker(pickerId, buttonId, requested) {
        const picker = document.getElementById(pickerId);
        const button = document.getElementById(buttonId);
        if (!picker || !button) return;
        const open = requested === undefined ? picker.style.display === 'none' : Boolean(requested);
        picker.style.display = open ? 'block' : 'none';
        button.setAttribute('aria-expanded', String(open));
    }

    function togglePersonEmojiPicker(requested) {
        toggleFloatingPicker('sharedPersonEmojiPicker', 'sharedPersonEmojiButton', requested);
        if (requested !== false) toggleComprasCategories(false);
    }

    function updatePersonPinButton() {
        const button = document.getElementById('sharedPersonPinButton');
        const input = document.getElementById('sharedPersonPin');
        const removing = document.getElementById('sharedPersonPinRemove')?.value === '1';
        if (!button || !input) return;
        button.textContent = removing ? 'PIN será removido' : (input.value ? 'Novo PIN pronto' : (button.dataset.hasPin === '1' ? 'Alterar PIN' : 'PIN de acesso'));
    }

    let personPinSnapshot = { value:'', remove:'0' };
    function togglePersonPinPicker(requested) {
        const picker = document.getElementById('sharedPersonPinPicker');
        const opening = requested === undefined ? picker?.style.display === 'none' : Boolean(requested);
        if (opening) personPinSnapshot = {
            value: document.getElementById('sharedPersonPin')?.value || '',
            remove: document.getElementById('sharedPersonPinRemove')?.value || '0'
        };
        toggleFloatingPicker('sharedPersonPinPicker', 'sharedPersonPinButton', requested);
        if (opening) {
            togglePersonEmojiPicker(false);
            toggleComprasCategories(false);
            setTimeout(() => document.getElementById('sharedPersonPin')?.focus(), 40);
        }
    }

    function updatePersonPinDraft() {
        const removing = document.getElementById('sharedPersonPinRemove');
        if (removing) removing.value = '0';
        updatePersonPinButton();
    }

    function removePersonPinDraft() {
        const input = document.getElementById('sharedPersonPin');
        const removing = document.getElementById('sharedPersonPinRemove');
        if (input) input.value = '';
        if (removing) removing.value = '1';
        updatePersonPinButton();
        togglePersonPinPicker(false);
    }

    function confirmPersonPinDraft() {
        const input = document.getElementById('sharedPersonPin');
        if (input?.value && input.value.length < 4) {
            global.AloUiDialog?.notice('Use pelo menos 4 dígitos no PIN.', { title:'PIN muito curto', confirmText:'Entendi' });
            return;
        }
        updatePersonPinButton();
        togglePersonPinPicker(false);
    }

    function cancelPersonPinDraft() {
        const input = document.getElementById('sharedPersonPin');
        const removing = document.getElementById('sharedPersonPinRemove');
        if (input) input.value = personPinSnapshot.value;
        if (removing) removing.value = personPinSnapshot.remove;
        updatePersonPinButton();
        togglePersonPinPicker(false);
    }

    function updateComprasCategorySummary() {
        const order = document.querySelectorAll('#sharedPersonComprasCategories [data-category-order]:checked').length;
        const shopping = document.querySelectorAll('#sharedPersonComprasCategories [data-category-shopping]:checked').length;
        const button = document.getElementById('sharedPersonComprasCategoryButton');
        if (button) button.setAttribute('aria-label', `Permissões por categoria: ${order} para pedir e ${shopping} para comprar`);
    }

    function toggleComprasCategories(requested) {
        const picker = document.getElementById('sharedPersonComprasCategoryPicker');
        const button = document.getElementById('sharedPersonComprasCategoryButton');
        if (!picker || !button) return;
        const open = requested === undefined ? picker.style.display !== 'flex' : Boolean(requested);
        if (open) comprasCategorySnapshot = [...document.querySelectorAll('#sharedPersonComprasCategories input')].map(input => input.checked);
        picker.style.display = open ? 'flex' : 'none';
        button.setAttribute('aria-expanded', String(open));
        if (open) {
            togglePersonEmojiPicker(false);
            togglePersonPinPicker(false);
        }
    }

    function saveComprasCategories() {
        updateComprasCategorySummary();
        toggleComprasCategories(false);
    }

    function cancelComprasCategories() {
        [...document.querySelectorAll('#sharedPersonComprasCategories input')].forEach((input, index) => { input.checked = Boolean(comprasCategorySnapshot[index]); });
        updateComprasCategorySummary();
        toggleComprasCategories(false);
    }

    function renderPersonEmojiGrid(emoji) {
        const grid = document.getElementById('sharedPersonEmojiGrid');
        if (!grid) return;
        const selected = PERSON_EMOJIS.includes(emoji) ? emoji : '👤';
        grid.innerHTML = PERSON_EMOJIS.map(option => `<button type="button" role="option" data-person-emoji="${option}" aria-label="Escolher ${option}" aria-selected="${option === selected}" class="${option === selected ? 'selected' : ''}" onclick="AloSharedData.selectPersonEmoji('${option}')">${option}</button>`).join('');
        selectPersonEmoji(selected);
    }

    async function renderComprasCategories(person, isNew) {
        const container = document.getElementById('sharedPersonComprasCategories');
        if (!container) return;
        container.innerHTML = '<div class="shared-category-empty">Carregando categorias...</div>';
        let categories = [];
        try {
            const adapter = adapters.get('compras');
            categories = clone(await adapter?.getCategories?.() || []);
        } catch (error) {}
        categories = categories.filter(category => category && category.ativo !== false && category.id);
        if (!categories.length) {
            container.innerHTML = '<div class="shared-category-empty">Nenhuma categoria cadastrada em Compras.</div>';
            updateComprasCategorySummary();
            return;
        }
        const orderAllowed = new Set(person.permissions.compras.categoriasPedido || []);
        const shoppingAllowed = new Set(person.permissions.compras.categoriasCompras || []);
        container.innerHTML = categories.map(category => {
            const id = escapeHtml(category.id);
            const name = escapeHtml(category.nome || 'Categoria');
        const orderChecked = orderAllowed.has(category.id) ? 'checked' : '';
        const shoppingChecked = shoppingAllowed.has(category.id) ? 'checked' : '';
            return `<div class="shared-category-row" data-category-id="${id}"><span>${name}</span><label class="shared-category-choice" title="Pode pedir ${name}"><input type="checkbox" data-category-order ${orderChecked} aria-label="Pedir ${name}" onchange="AloSharedData.updateComprasCategorySummary()"><span aria-hidden="true">✓</span></label><label class="shared-category-choice" title="Pode comprar ${name}"><input type="checkbox" data-category-shopping ${shoppingChecked} aria-label="Comprar ${name}" onchange="AloSharedData.updateComprasCategorySummary()"><span aria-hidden="true">✓</span></label></div>`;
        }).join('');
        updateComprasCategorySummary();
    }

    async function openPersonForm(id = '') {
        const person = state.people.find(item => item.id === id) || normalizePerson({
            id: '', nome: '', emoji: '👤', ativo: true, podeEntrar: false, isAdmin: false,
            permissions: { checklist: { funcionario: true }, compras: { acesso:false, receber:false, comprar:false, categoriasPedido:[], categoriasCompras:[] } }
        });
        global.fecharModal?.('modalPessoasCompartilhadas');
        document.getElementById('sharedPersonId').value = id;
        document.getElementById('sharedPersonName').value = id ? person.nome : '';
        renderPersonEmojiGrid(person.emoji || '👤');
        document.getElementById('sharedPersonPin').value = '';
        document.getElementById('sharedPersonPin').placeholder = '';
        const pinHint = document.getElementById('sharedPersonPinHint');
        if (pinHint) pinHint.textContent = id && person.credentials.alternatives.length
            ? 'Deixe em branco para manter o PIN atual.'
            : 'Use pelo menos 4 dígitos.';
        document.getElementById('sharedPersonPinRemove').value = '0';
        const pinButton = document.getElementById('sharedPersonPinButton');
        if (pinButton) pinButton.dataset.hasPin = person.credentials.alternatives.length ? '1' : '0';
        updatePersonPinButton();
        setCheckbox('sharedPersonAdmin', person.isAdmin);
        setCheckbox('sharedPersonEmployee', person.permissions.checklist.funcionario);
        const areaGrid = document.getElementById('sharedPersonChecklistAreas');
        if (areaGrid) {
            const selectedAreas = new Set(person.permissions.checklist.setorIds || (person.permissions.checklist.setorId ? [person.permissions.checklist.setorId] : []));
            const areas = (deps.getDatabase?.()?.setoresTarefas || []).filter(area => area.ativo !== false || selectedAreas.has(area.id));
            areaGrid.innerHTML = areas.length ? areas.map(area => `<label class="shared-area-choice"><input type="checkbox" value="${escapeHtml(area.id)}" ${selectedAreas.has(area.id) ? 'checked' : ''}><span>${escapeHtml(area.emoji || '📍')} ${escapeHtml(area.nome)}</span></label>`).join('') : '<span class="shared-area-choice-empty">Nenhum setor cadastrado.</span>';
        }
        setCheckbox('sharedPersonKdsConfig', person.permissions.kds.configuracoes);
        setCheckbox('sharedPersonChecklistConfig', person.permissions.checklist.configuracoes);
        setCheckbox('sharedPersonComprasReceive', person.permissions.compras.receber);
        setCheckbox('sharedPersonComprasBuy', person.permissions.compras.comprar);
        setCheckbox('sharedPersonLabelsConfig', person.permissions.l42.configuracoes);
        await renderComprasCategories(person, !id);
        toggleAccessFields();
        toggleEmployeeFields();
        const activeButton = document.getElementById('sharedPersonActiveAction');
        if (activeButton) {
            activeButton.style.display = id ? 'inline-flex' : 'none';
            activeButton.textContent = person.ativo ? 'Desativar' : 'Ativar';
            activeButton.className = person.ativo ? 'btn-danger' : 'btn-action';
        }
        deps.openModalTop?.('modalPessoaCompartilhada') || (document.getElementById('modalPessoaCompartilhada').style.display = 'flex');
    }

    function toggleAccessFields() {
        const admin = document.getElementById('sharedPersonAdmin')?.checked;
        const labelsConfig = document.getElementById('sharedPersonLabelsConfig')?.checked;
        const comprasFields = document.getElementById('sharedPersonComprasFields');
        if (comprasFields) comprasFields.style.display = 'grid';
        const labelsFields = document.getElementById('sharedPersonLabelsFields');
        if (labelsFields) labelsFields.style.display = 'grid';
    }

    function toggleEmployeeFields() {
        const enabled = document.getElementById('sharedPersonEmployee')?.checked;
        const fields = document.getElementById('sharedPersonEmployeeFields');
        if (fields) fields.style.display = enabled ? 'block' : 'none';
    }

    function backToManager() {
        global.fecharModal?.('modalPessoaCompartilhada');
        renderPeopleManager();
        deps.openModalTop?.('modalPessoasCompartilhadas') || (document.getElementById('modalPessoasCompartilhadas').style.display = 'flex');
    }

    async function savePersonForm() {
        const id = document.getElementById('sharedPersonId').value;
        const name = document.getElementById('sharedPersonName').value.trim();
        const emoji = document.getElementById('sharedPersonEmoji').value.trim() || '👤';
        const pin = document.getElementById('sharedPersonPin').value.trim();
        const admin = document.getElementById('sharedPersonAdmin').checked;
        const kdsConfig = document.getElementById('sharedPersonKdsConfig').checked;
        const checklistConfig = document.getElementById('sharedPersonChecklistConfig').checked;
        const comprasReceive = document.getElementById('sharedPersonComprasReceive').checked;
        const comprasBuy = document.getElementById('sharedPersonComprasBuy').checked;
        const categoriasPedido = [...document.querySelectorAll('#sharedPersonComprasCategories [data-category-order]:checked')].map(input => input.closest('[data-category-id]').dataset.categoryId);
        const categoriasCompras = [...document.querySelectorAll('#sharedPersonComprasCategories [data-category-shopping]:checked')].map(input => input.closest('[data-category-id]').dataset.categoryId);
        const comprasAccess = Boolean(admin || comprasReceive || comprasBuy || categoriasPedido.length || categoriasCompras.length);
        if (!name) return global.AloUiDialog?.notice('Informe o nome da pessoa.', { title: 'Nome necessário', confirmText: 'Entendi' });
        if (pin && pin.length < 4) return global.AloUiDialog?.notice('Use pelo menos 4 dígitos no PIN.', { title: 'PIN muito curto', confirmText: 'Entendi' });
        if (state.people.some(person => person.id !== id && comparableText(person.nome) === comparableText(name))) {
            return global.AloUiDialog?.notice('Já existe uma pessoa com esse nome.', { title: 'Cadastro duplicado', confirmText: 'Entendi' });
        }
        let person = state.people.find(item => item.id === id);
        if (!person) {
            person = normalizePerson({ id: stableId('pessoa', `${name}_${Date.now()}`), nome: name, ativo: true });
            state.people.push(person);
        }
        person.nome = name;
        person.emoji = emoji;
        person.isAdmin = admin;
        person.permissions.kds.configuracoes = kdsConfig;
        person.permissions.checklist.configuracoes = checklistConfig;
        person.permissions.checklist.funcionario = document.getElementById('sharedPersonEmployee').checked;
        person.permissions.checklist.setorIds = person.permissions.checklist.funcionario
            ? [...document.querySelectorAll('#sharedPersonChecklistAreas input:checked')].map(input => String(input.value)).filter(Boolean)
            : [];
        person.permissions.checklist.setorId = person.permissions.checklist.setorIds.length === 1
            ? person.permissions.checklist.setorIds[0]
            : '';
        person.permissions.compras.acesso = comprasAccess;
        person.permissions.compras.receber = comprasReceive;
        person.permissions.compras.comprar = comprasBuy;
        person.permissions.compras.categoriasPedido = categoriasPedido;
        person.permissions.compras.categoriasCompras = categoriasCompras;
        const labelsConfig = document.getElementById('sharedPersonLabelsConfig').checked;
        const labelsAccess = Boolean(admin || pin || person.credentials.alternatives.length || labelsConfig);
        person.permissions.l42.acesso = labelsAccess;
        ['imprimir', 'estoque', 'darBaixa', 'movimentacao', 'relatorios'].forEach(key => { person.permissions.l42[key] = labelsAccess; });
        ['produtos', 'categorias', 'estilo', 'configuracoes', 'avancado'].forEach(key => { person.permissions.l42[key] = labelsConfig; });
        person.permissions.l42.operadores = false;
        if (document.getElementById('sharedPersonPinRemove').value === '1') person.credentials = { alternatives: [] };
        else if (pin) person.credentials = { alternatives: [await createPinHash(pin)] };
        grantAdminPermissions(person);
        refreshDerivedAccess(person);
        person.atualizadoEm = Date.now();
        persist('person-saved');
        await syncPeopleToModules();
        backToManager();
    }

    async function toggleCurrentPersonActive() {
        const id = document.getElementById('sharedPersonId').value;
        const person = state.people.find(item => item.id === id);
        if (!person) return;
        const activating = person.ativo === false;
        if (!activating && person.isAdmin && state.people.filter(item => item.ativo && item.isAdmin && item.id !== id).length === 0) {
            return global.AloUiDialog?.notice('Mantenha pelo menos um administrador ativo.', { title: 'Administrador necessário', confirmText: 'Entendi' });
        }
        const confirmed = await global.AloUiDialog?.confirm(`${activating ? 'Ativar' : 'Desativar'} “${person.nome}”?${activating ? '' : ' Os registros anteriores continuarão preservados.'}`, {
            title: `${activating ? 'Ativar' : 'Desativar'} pessoa`, icon: '👤', confirmText: activating ? 'Ativar' : 'Desativar', tone: activating ? 'default' : 'danger'
        });
        if (!confirmed) return;
        person.ativo = activating;
        refreshDerivedAccess(person);
        person.atualizadoEm = Date.now();
        persist(activating ? 'person-activated' : 'person-deactivated');
        await syncPeopleToModules();
        backToManager();
    }

    async function getModuleData(moduleId) {
        const adapter = adapters.get(String(moduleId));
        if (!adapter?.getFullData) throw new Error(`O módulo ${moduleId} não expõe seus dados ao núcleo.`);
        return adapter.getFullData();
    }

    async function getUnifiedData() {
        const moduleEntries = await Promise.all([...adapters.entries()].map(async ([id, adapter]) => {
            if (!adapter.getFullData) return [id, null];
            return [id, await adapter.getFullData()];
        }));
        return {
            appVersion: VERSION,
            schemaVersion: SCHEMA_VERSION,
            shared: clone(state),
            kdsChecklist: {
                database: clone(deps.getDatabase?.() || {}),
                runtime: clone(global.AloTasks?.getBackupData?.() || {})
            },
            modules: Object.fromEntries(moduleEntries)
        };
    }

    function getCatalogIndex() {
        return clone(state.catalog);
    }

    function getBackup() {
        return clone(state);
    }

    function getCloudData() {
        const compact = clone(state);
        // O índice é reconstruído pelos adaptadores e não consome a cota reduzida
        // do PropertiesService usado pelo backend atual.
        compact.catalog = [];
        return compact;
    }

    function applyCloudState(payload) {
        const incoming = normalizeState(payload);
        if (Number(incoming.revision || 0) <= Number(state.revision || 0)) return false;
        state = incoming;
        sourcesLoaded = Boolean(state.migration?.identitiesMerged);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        const database = deps.getDatabase?.();
        if (database) database.coreCompartilhado = clone(state);
        notify('cloud-state-applied');
        syncPeopleToModules().catch(() => {});
        return true;
    }

    async function restoreBackup(payload) {
        state = normalizeState(payload);
        persist('shared-backup-restored');
        await syncPeopleToModules();
        return describe();
    }

    function describe() {
        return {
            appVersion: VERSION,
            schemaVersion: SCHEMA_VERSION,
            revision: state.revision,
            people: state.people.length,
            loginPeople: state.people.filter(person => person.ativo && person.podeEntrar).length,
            employees: state.people.filter(person => person.ativo && person.permissions.checklist.funcionario).length,
            catalog: state.catalog.length,
            sourceStats: clone(state.sourceStats)
        };
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('O listener precisa ser uma função.');
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    global.AloSharedData = Object.freeze({
        VERSION, SCHEMA_VERSION, L42_PERMISSION_KEYS, PERSON_EMOJIS,
        configure, registerAdapter, ensureReady, refreshSources, updateFromModule, describe, subscribe,
        listLoginPeople, authenticate, activateForModule, logoutModule,
        openManager, closeManager, openPersonForm, selectPersonEmoji, togglePersonEmojiPicker, togglePersonPinPicker,
        updatePersonPinDraft, removePersonPinDraft, confirmPersonPinDraft, cancelPersonPinDraft, toggleComprasCategories,
        saveComprasCategories, cancelComprasCategories, updateComprasCategorySummary, toggleAccessFields, toggleEmployeeFields, backToManager,
        savePersonForm, toggleCurrentPersonActive, renderPeopleManager,
        getModuleData, getUnifiedData, getCatalogIndex,
        getBackup, getCloudData, applyCloudState, restoreBackup
    });
})(window);
