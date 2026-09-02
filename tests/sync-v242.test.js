const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
let operations = [];
const context = vm.createContext({
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    navigator: { onLine: true },
    document: { visibilityState: 'visible', addEventListener() {} },
    window: {
        crypto: { randomUUID: () => 'test-id' },
        addEventListener() {},
        AloStorage: {
            async getAllOperations() { return structuredClone(operations); },
            async updateOperation(operation) {
                const index = operations.findIndex(item => item.operationId === operation.operationId);
                if (index >= 0) operations[index] = structuredClone(operation);
            },
            async removeOperations(ids) {
                operations = operations.filter(item => !ids.includes(item.operationId));
            }
        }
    }
});

vm.runInContext(fs.readFileSync(path.join(root, 'modules/kds/logic.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'modules/kds/sync.js'), 'utf8'), context);

function manager() {
    const instance = new context.window.AloSync({ getUrl: () => 'https://example.test' });
    let immediateFlushes = 0;
    instance.queueImmediateFlush = () => { immediateFlushes += 1; };
    return { instance, immediateFlushes: () => immediateFlushes };
}

async function testStatusConflictGetsRebasedAndRetried() {
    operations = [{
        operationId: 'status-1', type: 'status', orderId: 'pedido-1', attempts: 1,
        submittedAt: Date.now(), nextAttemptAt: Date.now() + 2500, lastError: '',
        payload: { id: 'pedido-1', novoStatus: 'buscar', expectedStatus: 'fazendo', expectedOrderRevision: 1, operationId: 'status-1' }
    }];
    const { instance, immediateFlushes } = manager();
    await instance.reconcile([{ id: 'pedido-1', produto: 'Feijão', status: 'fazendo', timestamp: new Date().toISOString(), revisao: 2 }], true);
    assert.equal(operations.length, 1, 'a mudança não pode ser descartada após conflito');
    assert.equal(operations[0].payload.expectedOrderRevision, 2);
    assert.equal(operations[0].nextAttemptAt, 0);
    assert.equal(immediateFlushes(), 1, 'o retry deve começar imediatamente');
}

async function testEarlyAcknowledgementIsNotLost() {
    operations = [{
        operationId: 'ack-1', type: 'acknowledgement', orderId: 'pedido-2', attempts: 1,
        submittedAt: Date.now(), nextAttemptAt: Date.now() + 2500, lastError: '',
        payload: { id: 'pedido-2', reconhecidoEm: new Date().toISOString(), expectedStatus: 'buscar', expectedOrderRevision: 3, receiptAttempt: 0, operationId: 'ack-1' }
    }];
    const { instance, immediateFlushes } = manager();
    await instance.reconcile([{ id: 'pedido-2', produto: 'Arroz', status: 'fazendo', timestamp: new Date().toISOString(), revisao: 4 }], true);
    assert.equal(operations.length, 1, 'o ciente deve aguardar o estado buscar');
    assert.equal(operations[0].payload.receiptAttempt, 1, 'o retry precisa de um novo recibo idempotente');
    assert.equal(operations[0].payload.expectedStatus, 'fazendo');
    assert.equal(immediateFlushes(), 1);

    await instance.reconcile([{ id: 'pedido-2', produto: 'Arroz', status: 'concluido', alertaReconhecidoEm: new Date().toISOString(), timestamp: new Date().toISOString(), revisao: 5 }], true);
    assert.equal(operations.length, 0, 'o ciente só sai da fila depois da confirmação remota');
}

function testServerReceiptUsesAttemptFingerprint() {
    const source = fs.readFileSync(path.join(root, 'supabase/functions/alo-cozinha-sync/index.ts'), 'utf8');
    assert.match(source, /function operationFingerprint/);
    assert.match(source, /expectedOrderRevision/);
    assert.match(source, /receiptAttempt/);
    assert.match(source, /operationFingerprint\(payload, direct\)/, 'envios unitários também precisam variar o recibo');
}

function testKitchenRendersAcknowledgedOrder() {
    const source = fs.readFileSync(path.join(root, 'modules/kds/app.js'), 'utf8');
    assert.match(source, /p\.status === 'concluido'/);
    assert.match(source, /statusTxt = 'Retirado'/);
}

async function run() {
    await testStatusConflictGetsRebasedAndRetried();
    await testEarlyAcknowledgementIsNotLost();
    testServerReceiptUsesAttemptFingerprint();
    testKitchenRendersAcknowledgedOrder();
    console.log('Corridas de sincronização do KDS v2.1.45 validadas.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
