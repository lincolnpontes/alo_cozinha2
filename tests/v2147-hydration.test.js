const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('catálogo remoto mais novo não pode ser substituído por cache vazio', () => {
    const context = vm.createContext({ console, setTimeout, clearTimeout });
    context.window = context;
    vm.runInContext(read('core/catalog-sync.js'), context);

    const remote = { _revision: 2881, produtos: Array.from({ length: 44 }, (_, id) => ({ id })), categorias: [{ id: 'cat' }] };
    const emptyLocal = { produtos: [], categorias: [], configs: { revisaoBanco: 2880, bancoPendente: true } };
    const populatedLocal = { produtos: [{ id: 'local' }], categorias: [], configs: { revisaoBanco: 2880, bancoPendente: true } };

    assert.equal(context.AloCatalogSync.shouldHydrateRemoteBeforePublish(emptyLocal, remote), true);
    assert.equal(context.AloCatalogSync.shouldHydrateRemoteBeforePublish(populatedLocal, remote), false);
    assert.equal(context.AloCatalogSync.shouldHydrateRemoteBeforePublish(emptyLocal, { ...remote, _revision: 2880 }), false);
    assert.equal(context.AloCatalogSync.shouldHydrateRemoteBeforePublish(emptyLocal, { _revision: 2881, produtos: [], categorias: [] }), false);
});

test('primeiro carregamento baixa a conta antes de mesclar KDS e Compras', () => {
    const app = read('modules/kds/app.js');
    const startup = app.slice(app.indexOf('async function iniciarComSyncConfiavel'));
    const pull = startup.indexOf('await sincronizarBancoAutomaticamente({ preferirNuvem: true })');
    const merge = startup.indexOf('await integrarFontesCompartilhadas()');

    assert.ok(pull >= 0 && merge > pull, 'a hidratação remota deve preceder a integração entre módulos');
    assert.match(app, /window\.addEventListener\('alo:cloud-ready'/);
    assert.match(app, /if \(bancoSyncEmAndamento\) \{\s*agendarIntegracaoInicialDaNuvem\(tentativa \+ 1\)/);
    assert.match(app, /shouldHydrateRemoteBeforePublish\(db, nuvemAtual\)/);
    assert.match(app, /applyCloudState\(nuvemDB\.coreCompartilhado, \{ force: true \}\)/);
});

test('estado compartilhado confirmado pela nuvem substitui cache parcial de revisão maior', () => {
    const values = new Map([
        ['alo_core_shared_v2', JSON.stringify({
            schemaVersion: 2,
            revision: 99,
            migration: { identitiesMerged: true },
            people: [{ id: 'parcial', nome: 'Parcial' }]
        })]
    ]);
    const localStorage = {
        getItem: key => values.get(String(key)) ?? null,
        setItem: (key, value) => values.set(String(key), String(value)),
        removeItem: key => values.delete(String(key))
    };
    const context = vm.createContext({
        console,
        localStorage,
        CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        document: { dispatchEvent() {} }
    });
    context.window = context;
    vm.runInContext(read('core/shared-data.js'), context);

    const applied = context.AloSharedData.applyCloudState({
        schemaVersion: 2,
        revision: 7,
        migration: { identitiesMerged: true },
        people: [{ id: 'um', nome: 'Um' }, { id: 'dois', nome: 'Dois' }]
    }, { force: true });

    assert.equal(applied, true);
    assert.equal(context.AloSharedData.describe().people, 2);
    assert.deepEqual(Array.from(context.AloSharedData.getBackup().people, person => person.id), ['um', 'dois']);
});
