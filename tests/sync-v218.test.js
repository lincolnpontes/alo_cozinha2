const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function load(context, file) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename:file });
}

async function catalogAcceptsServerTaskHistory() {
    const context = vm.createContext({ console, setTimeout, clearTimeout });
    context.window = context;
    load(context, 'core/catalog-sync.js');
    const desired = { produtos:[], categorias:[], obsPedidos:[], obsCancelamentos:[], areas:[], setoresTarefas:[], funcionarios:[], tarefas:[{ id:'atual', nome:'Atual', revisaoDefinicao:2 }], configsTarefas:{}, configs:{} };
    let remote = { ...JSON.parse(JSON.stringify(desired)), _revision:8, tarefas:[{ id:'antiga', nome:'Histórico', revisaoDefinicao:1 }, ...desired.tarefas] };
    let posts = 0;
    const api = {
        async getBank() { return JSON.parse(JSON.stringify(remote)); },
        async post() { posts += 1; }
    };
    const result = await context.AloCatalogSync.publish({ api, url:'https://example.test', data:desired, wait:async () => {} });
    assert.equal(result.confirmed, true);
    assert.equal(posts, 0, 'tarefa histórica preservada pelo servidor não pode prender a fila local');
    assert.equal(context.AloCatalogSync.isEqual({ ...remote, produtos:[{ id:'outro' }] }, desired), false, 'diferença real de catálogo deve continuar sendo detectada');
}

function checklistResolvesOldQueues() {
    const context = vm.createContext({ console, Date, Map, Object });
    context.window = context;
    load(context, 'core/checklist-sync.js');
    const creation = { operationId:'op-create', activityId:'a1', payload:{ id:'a1', status:'pendente', alarmeStatus:'aguardando', atualizadoEm:'2026-08-30T10:00:00.000Z' } };
    const existing = { id:'a1', status:'concluida', alarmeStatus:'reconhecido', revisao:9, atualizadoEm:'2026-08-30T10:01:00.000Z' };
    assert.equal(context.AloChecklistSync.reconcileOperations([creation], [existing], '2026-08-30T10:02:00.000Z').length, 0, 'criação antiga deve ceder à atividade já confirmada na nuvem');

    const update = { operationId:'op-update', activityId:'a2', createdAt:1, payload:{ id:'a2', status:'em_execucao', expectedStatus:'pendente', alarmeStatus:'reconhecido', atualizadoEm:'2026-08-30T10:00:00.000Z' } };
    const serverStillPending = { id:'a2', status:'pendente', alarmeStatus:'aguardando', revisao:4, atualizadoEm:'2026-08-30T10:01:00.000Z' };
    const rebased = context.AloChecklistSync.reconcileOperations([update], [serverStillPending], '2026-08-30T10:02:00.000Z');
    assert.equal(rebased.length, 1);
    assert.equal(rebased[0].payload.atualizadoEm, '2026-08-30T10:02:00.000Z', 'edição rejeitada por relógio antigo deve ser reenviada com nova data');
    const confirmed = { ...serverStillPending, status:'em_execucao', alarmeStatus:'reconhecido', revisao:5 };
    assert.equal(context.AloChecklistSync.reconcileOperations(rebased, [confirmed], '2026-08-30T10:03:00.000Z').length, 0);
}

(async () => {
    await catalogAcceptsServerTaskHistory();
    checklistResolvesOldQueues();
    console.log('sync-v218: 5 verificações focadas passaram');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
