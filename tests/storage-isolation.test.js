const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

class MemoryStorage {
    constructor(entries = []) { this.entries = new Map(entries); }
    get length() { return this.entries.size; }
    getItem(key) { return this.entries.has(String(key)) ? this.entries.get(String(key)) : null; }
    setItem(key, value) { this.entries.set(String(key), String(value)); }
    removeItem(key) { this.entries.delete(String(key)); }
    clear() { this.entries.clear(); }
    key(index) { return Array.from(this.entries.keys())[index] ?? null; }
}

class MemoryIdbFactory {
    constructor() { this.opened = []; this.deleted = []; }
    open(name, version) { this.opened.push({ name, version }); return { name, version }; }
    deleteDatabase(name) { this.deleted.push(name); return { name }; }
}

function accountSession(id, email) {
    return JSON.stringify({
        access_token: `access-${id}`,
        refresh_token: `refresh-${id}`,
        user: { id, email }
    });
}

const accountA = accountSession('account-a', 'a@example.test');
const accountB = accountSession('account-b', 'b@example.test');
const localStorage = new MemoryStorage([
    ['alo_supabase_session_v1', accountA],
    ['alofeira_v1', JSON.stringify({ origem: 'aplicativo-antigo' })]
]);
const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Storage: MemoryStorage,
    localStorage,
    sessionStorage: new MemoryStorage(),
    IDBFactory: MemoryIdbFactory,
    indexedDB: new MemoryIdbFactory()
});
context.window = context;

vm.runInContext(fs.readFileSync(path.join(root, 'core', 'storage-scope.js'), 'utf8'), context);

assert.equal(localStorage.getItem('alo_supabase_session_v1'), null, 'o Alô Cozinha não deve herdar sessão sem namespace de outro aplicativo');
localStorage.setItem('alo_supabase_session_v1', accountA);
assert.equal(localStorage.entries.get('alo_cozinha2:global:alo_supabase_session_v1'), accountA);
assert.equal(localStorage.getItem('alofeira_v1'), null, 'o Alô Cozinha não pode ler o banco local do Alô Feira antigo');

localStorage.setItem('alofeira_v1', JSON.stringify({ origem: 'alo-cozinha', conta: 'a' }));
assert.equal(
    localStorage.entries.get('alo_cozinha2:owner:account-a:alofeira_v1'),
    JSON.stringify({ origem: 'alo-cozinha', conta: 'a' })
);
assert.equal(
    localStorage.entries.get('alofeira_v1'),
    JSON.stringify({ origem: 'aplicativo-antigo' }),
    'a gravação nova não pode sobrescrever o aplicativo antigo'
);

localStorage.setItem('alo_supabase_session_v1', accountB);
assert.equal(localStorage.getItem('alofeira_v1'), null, 'uma conta não pode enxergar o cache local de outra conta');
localStorage.setItem('alofeira_v1', JSON.stringify({ origem: 'alo-cozinha', conta: 'b' }));
assert.equal(localStorage.entries.has('alo_cozinha2:owner:account-b:alofeira_v1'), true);

localStorage.setItem('alo_supabase_session_v1', accountA);
assert.deepEqual(JSON.parse(localStorage.getItem('alofeira_v1')), { origem: 'alo-cozinha', conta: 'a' });

context.indexedDB.open('alo_cozinha_operacao', 1);
assert.equal(context.indexedDB.opened[0].name, 'alo_cozinha2:owner:account-a:idb:alo_cozinha_operacao');

localStorage.setItem('alo_demo_mode_v1', '1');
localStorage.setItem('kds_v1_db', '{"demo":true}');
assert.equal(localStorage.entries.get('alo_cozinha2:owner:demo:kds_v1_db'), '{"demo":true}');
assert.equal(localStorage.getItem('alofeira_v1'), null, 'o modo demonstração deve ficar fora da conta real');

const rootWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const labelsHost = fs.readFileSync(path.join(root, 'modules', 'l42', 'host.js'), 'utf8');
const labelsPage = fs.readFileSync(path.join(root, 'modules', 'l42', 'index.html'), 'utf8');
const purchasesPage = fs.readFileSync(path.join(root, 'modules', 'compras', 'index.html'), 'utf8');
assert.equal(rootWorker.includes("const CACHE_PREFIX = 'alo-cozinha2-'"), true);
assert.equal(rootWorker.includes('key.startsWith(CACHE_PREFIX)'), true);
assert.equal(labelsHost.includes('restore-legacy-storage'), false, 'Etiquetas não deve importar armazenamento legado');
assert.equal(labelsPage.includes('async function requisicaoSupabase(path,opcoes={}){\n    throw new Error'), true, 'Etiquetas não deve acessar o Supabase fora do núcleo');
assert.equal(labelsPage.includes('../../core/storage-scope.js'), true);
assert.equal(purchasesPage.includes('../../core/storage-scope.js'), true);

console.log('Isolamento local do Alô Cozinha validado.');
