const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const operations = [];
const removed = [];
const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Math,
    Date,
    navigator:{ onLine:true },
    document:{ visibilityState:'visible', addEventListener() {} },
    addEventListener() {},
    AloStorage:{
        async getAllOperations() { return operations.map(item => ({ ...item })); },
        async updateOperation() {},
        async removeOperations(ids) { removed.push(...ids); }
    },
    AloLogic:{ statusRank() { return 0; }, isStatusFinal() { return false; } }
});
context.window = context;
vm.runInContext(fs.readFileSync(path.join(root, 'modules/kds/sync.js'), 'utf8'), context, { filename:'modules/kds/sync.js' });

async function run() {
    const now = Date.now();
    const manager = new context.AloSync({ getUrl:() => 'https://example.test' });

    operations.push({ operationId:'status-confirmado', type:'status', orderId:'antigo', attempts:1, submittedAt:now - 20000, createdAt:now - 30000, payload:{} });
    await manager.reconcile([], true);
    assert.deepEqual(removed, ['status-confirmado'], 'status enviado de pedido que já saiu da janela remota deve deixar a fila');

    operations.length = 0;
    removed.length = 0;
    operations.push({ operationId:'ciencia-confirmada', type:'acknowledgement', orderId:'retirada', attempts:1, submittedAt:now - 20000, createdAt:now - 30000, payload:{} });
    await manager.reconcile([], true);
    assert.deepEqual(removed, ['ciencia-confirmada'], 'ciência enviada de alerta removido deve deixar a fila');

    operations.length = 0;
    removed.length = 0;
    operations.push({ operationId:'criacao-sem-confirmacao', type:'create', orderId:'novo', attempts:2, submittedAt:now - 120000, createdAt:now - 120000, payload:{} });
    await manager.reconcile([], true);
    assert.deepEqual(removed, [], 'pedido novo nunca pode ser descartado sem aparecer na nuvem');

    operations.length = 0;
    removed.length = 0;
    operations.push({ operationId:'status-ainda-recente', type:'status', orderId:'recente', attempts:1, submittedAt:now - 5000, createdAt:now - 6000, payload:{} });
    await manager.reconcile([], true);
    assert.deepEqual(removed, [], 'operação recente deve continuar aguardando confirmação');

    console.log('sync-v219: 4 verificações focadas do KDS passaram');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
