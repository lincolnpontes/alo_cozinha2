(function (global) {
    const APP_NAMESPACE = 'alo_cozinha2';
    const SESSION_KEY = 'alo_supabase_session_v1';
    const DEMO_KEY = 'alo_demo_mode_v1';
    const GLOBAL_KEYS = new Set([
        SESSION_KEY,
        DEMO_KEY,
        'alo_cloud_device_id_v1',
        'alo_auth_login_guard_v1'
    ]);
    const storage = global.localStorage;
    const storagePrototype = global.Storage?.prototype;
    const idbPrototype = global.IDBFactory?.prototype;

    if (!storage || !storagePrototype || global.AloStorageScope) return;

    const nativeStorage = {
        getItem: storagePrototype.getItem,
        setItem: storagePrototype.setItem,
        removeItem: storagePrototype.removeItem,
        clear: storagePrototype.clear,
        key: storagePrototype.key
    };
    const globalPrefix = `${APP_NAMESPACE}:global:`;
    const ownerPrefix = `${APP_NAMESPACE}:owner:`;
    let cachedSession = null;
    let cachedOwner = 'signed-out';

    function rawGet(key) {
        try { return nativeStorage.getItem.call(storage, key); }
        catch (error) { return null; }
    }

    function normalizeOwner(value) {
        return encodeURIComponent(String(value || 'signed-out')).replace(/%/g, '_');
    }

    function currentOwner() {
        if (rawGet(`${globalPrefix}${DEMO_KEY}`) === '1') return 'demo';
        const rawSession = rawGet(`${globalPrefix}${SESSION_KEY}`) || '';
        if (rawSession === cachedSession) return cachedOwner;
        cachedSession = rawSession;
        cachedOwner = 'signed-out';
        try {
            const parsed = JSON.parse(rawSession || 'null');
            if (parsed?.user?.id) cachedOwner = normalizeOwner(parsed.user.id);
        } catch (error) {}
        return cachedOwner;
    }

    function partitionPrefix() {
        return `${ownerPrefix}${currentOwner()}:`;
    }

    function physicalKey(key) {
        const logical = String(key);
        return GLOBAL_KEYS.has(logical)
            ? `${globalPrefix}${logical}`
            : `${partitionPrefix()}${logical}`;
    }

    function visibleKeys(target) {
        const prefixes = [globalPrefix, partitionPrefix()];
        const result = [];
        const seen = new Set();
        let length = 0;
        try { length = target.length; } catch (error) {}
        for (let index = 0; index < length; index += 1) {
            const rawKey = nativeStorage.key.call(target, index);
            const prefix = prefixes.find(candidate => rawKey?.startsWith(candidate));
            if (!prefix) continue;
            const logical = rawKey.slice(prefix.length);
            if (!seen.has(logical)) {
                seen.add(logical);
                result.push(logical);
            }
        }
        return result;
    }

    storagePrototype.getItem = function (key) {
        return nativeStorage.getItem.call(this, this === storage ? physicalKey(key) : key);
    };
    storagePrototype.setItem = function (key, value) {
        return nativeStorage.setItem.call(this, this === storage ? physicalKey(key) : key, value);
    };
    storagePrototype.removeItem = function (key) {
        return nativeStorage.removeItem.call(this, this === storage ? physicalKey(key) : key);
    };
    storagePrototype.key = function (index) {
        if (this !== storage) return nativeStorage.key.call(this, index);
        return visibleKeys(this)[Number(index)] ?? null;
    };
    storagePrototype.clear = function () {
        if (this !== storage) return nativeStorage.clear.call(this);
        const prefix = partitionPrefix();
        const keys = [];
        for (let index = 0; index < this.length; index += 1) {
            const key = nativeStorage.key.call(this, index);
            if (key?.startsWith(prefix)) keys.push(key);
        }
        keys.forEach(key => nativeStorage.removeItem.call(this, key));
    };

    if (idbPrototype) {
        const nativeOpen = idbPrototype.open;
        const nativeDeleteDatabase = idbPrototype.deleteDatabase;
        const scopedDatabaseName = name => `${APP_NAMESPACE}:owner:${currentOwner()}:idb:${String(name)}`;
        idbPrototype.open = function (name, version) {
            const scopedName = this === global.indexedDB ? scopedDatabaseName(name) : name;
            return version === undefined
                ? nativeOpen.call(this, scopedName)
                : nativeOpen.call(this, scopedName, version);
        };
        idbPrototype.deleteDatabase = function (name) {
            const scopedName = this === global.indexedDB ? scopedDatabaseName(name) : name;
            return nativeDeleteDatabase.call(this, scopedName);
        };
    }

    global.AloStorageScope = Object.freeze({
        namespace: APP_NAMESPACE,
        owner: currentOwner,
        physicalKey,
        ownsPhysicalKey: (rawKey, logicalKey) => String(rawKey || '') === physicalKey(logicalKey)
    });

    if (global.navigator && 'serviceWorker' in global.navigator) {
        const insideModule = /\/modules\/(?:compras|l42)\//.test(global.location.pathname);
        const appRoot = new URL(insideModule ? '../../' : './', global.location.href).href;
        global.navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations
                .filter(registration => registration.scope.startsWith(appRoot) && registration.scope !== appRoot)
                .forEach(registration => registration.unregister().catch(() => {}));
        }).catch(() => {});
    }
})(window);
