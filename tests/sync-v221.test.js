const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, window: {} });
vm.runInContext(fs.readFileSync(path.join(root, 'core/catalog-sync.js'), 'utf8'), context);

function bankWith(tasks) {
    return {
        produtos: [],
        categorias: [],
        obsPedidos: [],
        obsCancelamentos: [],
        areas: [],
        setoresTarefas: [],
        funcionarios: [],
        tarefas: tasks,
        coreCompartilhado: null,
        configsTarefas: {},
        configs: {}
    };
}

async function testServerNewerTaskIsConfirmedAndPreserved() {
    const sync = context.window.AloCatalogSync;
    const localTask = { id:'task-1', nome:'Versao local', revisaoDefinicao:10 };
    const remoteTask = { id:'task-1', nome:'Versao do servidor', revisaoDefinicao:11 };
    const remote = {
        ...bankWith([remoteTask]),
        _revision:2032,
        _capabilities:{ dadosCompartilhados:true }
    };
    let posts = 0;
    const api = {
        async getBank() { return structuredClone(remote); },
        async post() { posts += 1; }
    };

    assert.equal(sync.isEqual(remote, bankWith([localTask])), true,
        'uma tarefa mais nova preservada pelo servidor deve confirmar a publicacao');

    const result = await sync.publish({ api, url:'https://example.test', data:bankWith([localTask]), wait:async () => {} });
    assert.equal(result.confirmed, true);
    assert.equal(result.sent, false, 'o KDS nao deve republicar indefinidamente a definicao antiga');
    assert.equal(posts, 0);

    const merged = sync.mergeTaskDefinitions([localTask], [remoteTask]);
    assert.equal(merged[0].nome, 'Versao do servidor', 'a tarefa mais nova do servidor deve entrar no aparelho');

    const newerLocal = { ...localTask, nome:'Versao local mais nova', revisaoDefinicao:12 };
    const mergedWithNewerLocal = sync.mergeTaskDefinitions([newerLocal], [remoteTask]);
    assert.equal(mergedWithNewerLocal[0].nome, 'Versao local mais nova', 'uma edicao local mais nova nao pode ser sobrescrita');
}

testServerNewerTaskIsConfirmedAndPreserved()
    .then(() => console.log('Conflito de revisao do KDS v2.1.34 validado.'))
    .catch(error => { console.error(error); process.exitCode = 1; });
