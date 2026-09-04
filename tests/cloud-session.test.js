const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'core/cloud.js'), 'utf8');
const SESSION_KEY = 'alo_supabase_session_v1';

function session(overrides = {}) {
    return {
        access_token: 'access-old',
        refresh_token: 'refresh-old',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'user-1', email: 'teste@example.com' },
        ...overrides
    };
}

let harnessSequence = 0;

function createHarness({ storage = new Map(), initialSession = session(), fetch }) {
    harnessSequence += 1;
    if (initialSession && !storage.has(SESSION_KEY)) storage.set(SESSION_KEY, JSON.stringify(initialSession));
    const listeners = new Map();
    const window = {
        fetch,
        setTimeout,
        clearTimeout,
        Headers,
        location: { search: '', href: 'https://example.test/' },
        crypto: { randomUUID: () => `tab-${harnessSequence}` },
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
            getItem(key) { return storage.get(String(key)) ?? null; },
            setItem(key, value) { storage.set(String(key), String(value)); },
            removeItem(key) { storage.delete(String(key)); }
        },
        Headers,
        URL,
        URLSearchParams,
        CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        setTimeout,
        clearTimeout
    });
    vm.runInContext(source, context);
    return { window, storage, listeners };
}

test('requisições simultâneas na mesma aba renovam a sessão uma só vez', async () => {
    let refreshCalls = 0;
    let dataCalls = 0;
    const initialSession = session();
    const harness = createHarness({
        initialSession,
        fetch: async (url, options = {}) => {
            if (String(url).includes('/auth/v1/token?grant_type=refresh_token')) {
                refreshCalls += 1;
                await new Promise(resolve => setTimeout(resolve, 15));
                return Response.json({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600, user: initialSession.user });
            }
            dataCalls += 1;
            const authorization = new Headers(options.headers || {}).get('Authorization');
            return Response.json({ status: authorization === 'Bearer access-new' ? 'ok' : 'expired' }, { status: authorization === 'Bearer access-new' ? 200 : 401 });
        }
    });

    const endpoint = harness.window.AloCloud.endpoint;
    const [first, second] = await Promise.all([
        harness.window.AloCloud.fetch(`${endpoint}?action=sincronizar`),
        harness.window.AloCloud.fetch(`${endpoint}?action=carregar_banco`)
    ]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(refreshCalls, 1);
    assert.equal(dataCalls, 4);
    const persisted = JSON.parse(harness.storage.get(SESSION_KEY));
    assert.equal(persisted.access_token, 'access-new');
    assert.equal(persisted.refresh_token, 'refresh-new');
});

test('duas abas compartilham a renovação sem reutilizar o refresh token', async () => {
    const storage = new Map([[SESSION_KEY, JSON.stringify(session())]]);
    let refreshCalls = 0;
    const fetch = async (url, options = {}) => {
        if (String(url).includes('/auth/v1/token?grant_type=refresh_token')) {
            refreshCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 40));
            return Response.json({ access_token: 'access-shared', refresh_token: 'refresh-shared', expires_in: 3600, user: session().user });
        }
        const authorization = new Headers(options.headers || {}).get('Authorization');
        return Response.json({}, { status: authorization === 'Bearer access-shared' ? 200 : 401 });
    };
    const firstTab = createHarness({ storage, initialSession: null, fetch });
    const secondTab = createHarness({ storage, initialSession: null, fetch });

    const [first, second] = await Promise.all([
        firstTab.window.AloCloud.fetch(`${firstTab.window.AloCloud.endpoint}?action=sincronizar`),
        secondTab.window.AloCloud.fetch(`${secondTab.window.AloCloud.endpoint}?action=sincronizar`)
    ]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(refreshCalls, 1, 'abas concorrentes não podem consumir o mesmo refresh token duas vezes');
    assert.equal(JSON.parse(storage.get(SESSION_KEY)).refresh_token, 'refresh-shared');
});

test('refresh token inválido encerra a sessão uma vez e não cria tempestade de tentativas', async () => {
    let refreshCalls = 0;
    const harness = createHarness({
        fetch: async url => {
            if (String(url).includes('/auth/v1/token?grant_type=refresh_token')) {
                refreshCalls += 1;
                return Response.json({ error_code: 'refresh_token_not_found', message: 'Refresh Token Not Found' }, { status: 400 });
            }
            return Response.json({}, { status: 401 });
        }
    });

    await assert.rejects(() => harness.window.AloCloud.fetch(`${harness.window.AloCloud.endpoint}?action=carregar_banco`), /Refresh Token Not Found/);
    assert.equal(harness.storage.has(SESSION_KEY), false);
    await assert.rejects(() => harness.window.AloCloud.fetch(`${harness.window.AloCloud.endpoint}?action=carregar_banco`), /Conecte a conta/);
    assert.equal(refreshCalls, 1, 'uma sessão encerrada não pode continuar chamando o Auth');
});

test('Realtime usa o token do app sem iniciar um segundo renovador automático', () => {
    assert.match(source, /autoRefreshToken:\s*false/);
    assert.match(source, /realtime\.setAuth\(session\.access_token\)/);
    assert.doesNotMatch(source, /auth\.setSession/);
});
