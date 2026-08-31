const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, window: {} });
vm.runInContext(fs.readFileSync(path.join(root, 'core/catalog-sync.js'), 'utf8'), context);

async function testCatalogPublicationAndConcurrentEdit() {
    const sync = context.window.AloCatalogSync;
    const tracker = sync.createChangeTracker();
    const desired = {
        produtos: [{ id:'arroz', nome:'Arroz' }],
        categorias: [], obsPedidos: [], obsCancelamentos: [], areas: [],
        setoresTarefas: [], funcionarios: [], tarefas: [], coreCompartilhado: null,
        configsTarefas: {}, configs: { somCozinha:'sem_som' }
    };
    let remote = { _revision:1, _capabilities:{ dadosCompartilhados:true }, produtos:[] };
    const sentAtRevision = tracker.snapshot();
    const api = {
        async getBank() { return structuredClone(remote); },
        async post(_url, payload) {
            tracker.mark();
            remote = { ...structuredClone(payload.dados), _revision:2, _capabilities:{ dadosCompartilhados:true } };
        }
    };

    const result = await sync.publish({ api, url:'https://example.test', data:desired, wait:async () => {} });
    assert.equal(result.confirmed, true, 'o catálogo precisa ser confirmado pelo servidor');
    assert.equal(tracker.unchangedSince(sentAtRevision), false, 'uma edição feita durante o envio deve continuar pendente');

    const nextRevision = tracker.snapshot();
    const second = await sync.publish({ api, url:'https://example.test', data:desired, wait:async () => {} });
    assert.equal(second.confirmed, true);
    assert.equal(second.sent, false, 'um catálogo já confirmado não deve ser reenviado');
    assert.equal(tracker.unchangedSince(nextRevision), true, 'sem nova edição, a bolinha pode ficar verde');
}

testCatalogPublicationAndConcurrentEdit()
    .then(() => console.log('Sincronização de catálogo do KDS v2.1.28 validada.'))
    .catch(error => { console.error(error); process.exitCode = 1; });
