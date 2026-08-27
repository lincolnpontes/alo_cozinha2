(function (global) {
    const modules = new Map();
    const listeners = new Set();
    const aliases = Object.freeze({ tasks: 'checklist', feira: 'compras' });
    let activeId = 'home';

    function canonicalId(id) {
        const value = String(id || '');
        return aliases[value] || value;
    }

    function normalizeDefinition(definition) {
        if (!definition || typeof definition !== 'object') throw new TypeError('Definição de módulo inválida.');
        const id = String(definition.id || '').trim();
        const viewId = String(definition.viewId || '').trim();
        if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new TypeError('O módulo precisa de um id estável.');
        if (!viewId) throw new TypeError(`O módulo ${id} precisa informar viewId.`);
        return Object.freeze({
            id,
            viewId,
            label: String(definition.label || id),
            storageNamespace: String(definition.storageNamespace || id),
            cloudNamespace: String(definition.cloudNamespace || id),
            requiresLogin: Boolean(definition.requiresLogin),
            capabilities: Object.freeze([...(definition.capabilities || [])]),
            onOpen: typeof definition.onOpen === 'function' ? definition.onOpen : null,
            onClose: typeof definition.onClose === 'function' ? definition.onClose : null
        });
    }

    function register(definition) {
        const normalized = normalizeDefinition(definition);
        if (modules.has(normalized.id)) throw new Error(`O módulo ${normalized.id} já foi registrado.`);
        modules.set(normalized.id, normalized);
        return normalized;
    }

    function notify(previousId) {
        const detail = Object.freeze({ current: activeId, previous: previousId });
        listeners.forEach(listener => listener(detail));
        if (typeof global.CustomEvent === 'function' && global.document?.dispatchEvent) {
            global.document.dispatchEvent(new CustomEvent('alo:module-change', { detail }));
        }
    }

    function setVisibleView(viewId) {
        const home = global.document?.getElementById('moduleHome');
        if (home) home.style.display = viewId === 'moduleHome' ? 'flex' : 'none';
        modules.forEach(module => {
            const view = global.document?.getElementById(module.viewId);
            if (view) view.style.display = module.viewId === viewId ? 'flex' : 'none';
        });
    }

    function open(id) {
        const module = modules.get(canonicalId(id));
        if (!module) throw new Error(`Módulo não registrado: ${id}`);
        const previousId = activeId;
        if (previousId !== 'home' && previousId !== module.id) modules.get(previousId)?.onClose?.();
        activeId = module.id;
        setVisibleView(module.viewId);
        module.onOpen?.();
        notify(previousId);
        return module;
    }

    function showHome() {
        const previousId = activeId;
        if (previousId !== 'home') modules.get(previousId)?.onClose?.();
        activeId = 'home';
        setVisibleView('moduleHome');
        global.encerrarSessaoModulo?.(previousId);
        notify(previousId);
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('O listener do host precisa ser uma função.');
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function list() {
        return [...modules.values()];
    }

    function get(id) {
        return modules.get(canonicalId(id)) || null;
    }

    global.AloModuleHost = Object.freeze({ register, open, showHome, subscribe, list, get, active: () => activeId });
})(window);
