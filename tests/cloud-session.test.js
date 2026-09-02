const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const listeners = new Map();
const stored = new Map();
const oldSession = {
    access_token: 'access-old',
    refresh_token: 'refresh-old',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', email: 'teste@example.com' }
};
stored.set('alo_supabase_session_v1', JSON.stringify(oldSession));

let refreshCalls = 0;
let dataCalls = 0;

async function fakeFetch(url, options = {}) {
    if (String(url).includes('/auth/v1/token?grant_type=refresh_token')) {
        refreshCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 15));
        return new Response(JSON.stringify({
            access_token: 'access-new',
            refresh_token: 'refresh-new',
            expires_in: 3600,
            user: oldSession.user
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    dataCalls += 1;
    const authorization = new Headers(options.headers || {}).get('Authorization');
    return new Response(JSON.stringify({ status: authorization === 'Bearer access-new' ? 'ok' : 'expired' }), {
        status: authorization === 'Bearer access-new' ? 200 : 401,
        headers: { 'Content-Type': 'application/json' }
    });
}

const window = {
    fetch: fakeFetch,
    setTimeout,
    clearTimeout,
    Headers,
    location: { search: '', href: 'https://example.test/' },
    crypto: { randomUUID: () => 'device-test' },
    dispatchEvent() {},
    addEventListener(type, handler) { listeners.set(type, handler); },
    AloDemo: { isActive: () => false }
};

const context = vm.createContext({
    console,
    window,
    navigator: { onLine: true },
    document: {
        readyState: 'loading',
        addEventListener() {},
        getElementById() { return null; }
    },
    localStorage: {
        getItem(key) { return stored.get(key) || null; },
        setItem(key, value) { stored.set(key, String(value)); },
        removeItem(key) { stored.delete(key); }
    },
    Headers,
    URL,
    URLSearchParams,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    setTimeout,
    clearTimeout
});

vm.runInContext(fs.readFileSync(path.join(root, 'core/cloud.js'), 'utf8'), context);

async function run() {
    const endpoint = window.AloCloud.endpoint;
    const [first, second] = await Promise.all([
        window.AloCloud.fetch(`${endpoint}?action=sincronizar`),
        window.AloCloud.fetch(`${endpoint}?action=carregar_banco`)
    ]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(refreshCalls, 1, 'requisições simultâneas devem compartilhar uma única renovação');
    assert.equal(dataCalls, 4, 'cada requisição deve tentar uma vez e repetir uma única vez após renovar');
    const persisted = JSON.parse(stored.get('alo_supabase_session_v1'));
    assert.equal(persisted.access_token, 'access-new');
    assert.equal(persisted.refresh_token, 'refresh-new');
    console.log('Recuperação concorrente da sessão Supabase validada.');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
