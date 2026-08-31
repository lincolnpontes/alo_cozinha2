const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadScript(context, file) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

function createSyncHarness() {
    const localOrders = new Map();
    const operations = new Map();
    const meta = new Map();
    const remoteOrders = new Map();
    const postPayloads = [];
    const requestLog = [];
    let revision = 1;
    let failPost = false;
    let syncBlocker = null;

    const storage = {
        async openDatabase() {},
        async migrateLegacy() {},
        async getAllOrders() { return [...localOrders.values()]; },
        async getAllOperations() { return [...operations.values()]; },
        async getMeta(key, fallback) { return meta.has(key) ? meta.get(key) : fallback; },
        async putMeta(key, value) { meta.set(key, value); },
        async putOrders(orders) { orders.forEach(order => localOrders.set(order.id, order)); },
        async deleteOrders(ids) { ids.map(String).forEach(id => localOrders.delete(id)); },
        async putOrderAndOperation(order, operation) {
            localOrders.set(order.id, order);
            operations.set(operation.operationId, operation);
        },
        async replaceStatusOperation(order, operation) {
            localOrders.set(order.id, order);
            [...operations.values()].forEach(item => {
                if (item.orderId === operation.orderId && item.type === 'status') operations.delete(item.operationId);
            });
            operations.set(operation.operationId, operation);
        },
        async deleteOrdersAndQueue(ids, operation, clearAll) {
            if (clearAll) {
                localOrders.clear();
                operations.clear();
            } else {
                ids.map(String).forEach(id => {
                    localOrders.delete(id);
                    [...operations.values()].forEach(item => {
                        if (String(item.orderId) === id) operations.delete(item.operationId);
                    });
                });
            }
            operations.set(operation.operationId, operation);
        },
        async updateOperation(operation) { operations.set(operation.operationId, operation); },
        async removeOperations(ids) { ids.forEach(id => operations.delete(id)); }
    };

    const logic = {
        ACTIVE_STATUSES: new Set(['pendente', 'fazendo']),
        createId: prefix => `${prefix}_${Math.random().toString(16).slice(2)}`,
        isToday: value => new Date(value).toDateString() === new Date().toDateString(),
        isStatusFinal: status => ['enviado', 'buscar', 'cancelado', 'concluido'].includes(status),
        statusRank: status => ({ pendente: 1, fazendo: 2, enviado: 3, buscar: 3, cancelado: 4, concluido: 5 })[status] || 0,
        normalizeOrder: order => ({
            id: String(order.id), produto: order.produto || '', status: order.status || 'pendente',
            timestamp: order.timestamp || new Date().toISOString(), finalizadoEm: order.finalizadoEm || '',
            motivo: order.motivo || '', atualizadoEm: order.atualizadoEm || order.timestamp || new Date().toISOString(),
            revisao: Number(order.revisao || 0), operacaoId: order.operacaoId || '',
            areaOrigem: order.areaOrigem || 'panelas', areaDestino: order.areaDestino || 'cozinha',
            alertaReconhecidoEm: order.alertaReconhecidoEm || '',
            syncState: order.syncState || 'confirmed', localOnly: Boolean(order.localOnly)
        })
    };

    const api = {
        async sync() {
            requestLog.push('get');
            if (syncBlocker) {
                const blocker = syncBlocker;
                blocker.markStarted();
                await blocker.promise;
                if (syncBlocker === blocker) syncBlocker = null;
            }
            return {
                status: 'ok', changed: true, revision,
                capabilities: { novoPedidoLote: true, reconhecimentoAlerta: true },
                pedidos: [...remoteOrders.values()]
            };
        },
        async post(url, payload) {
            requestLog.push(`post:${payload.action}`);
            postPayloads.push(payload);
            if (failPost) throw new Error('offline');
            if (payload.action === 'novo_pedido') {
                remoteOrders.set(String(payload.id), {
                    id: String(payload.id), produto: payload.produto, status: 'pendente',
                    timestamp: new Date().toISOString(), areaOrigem: payload.areaOrigem,
                    areaDestino: payload.areaDestino, operacaoId: payload.operationId
                });
            } else if (payload.action === 'novo_pedido_lote') {
                payload.pedidos.forEach(order => {
                    remoteOrders.set(String(order.id), {
                        id: String(order.id), produto: order.produto, status: 'pendente', revisao: revision + 1,
                        timestamp: new Date().toISOString(), areaOrigem: order.areaOrigem,
                        areaDestino: order.areaDestino, operacaoId: order.operationId
                    });
                });
            } else if (payload.action === 'atualizar_status_lote') {
                payload.updates.forEach(update => {
                    const order = remoteOrders.get(String(update.id));
                    if (!order) return;
                    if (update.expectedStatus && order.status !== update.expectedStatus) return;
                    if (update.expectedOrderRevision !== undefined && Number(order.revisao || 0) > Number(update.expectedOrderRevision)) return;
                    remoteOrders.set(String(update.id), {
                        ...order,
                        status: update.novoStatus,
                        motivo: update.motivo || '',
                        operacaoId: update.operationId,
                        revisao: revision + 1
                    });
                });
            } else if (payload.action === 'reconhecer_alerta') {
                const order = remoteOrders.get(String(payload.id));
                if (order) remoteOrders.set(String(payload.id), {
                    ...order,
                    status: order.status === 'buscar' ? 'concluido' : order.status,
                    alertaReconhecidoEm: payload.reconhecidoEm || new Date().toISOString(),
                    operacaoId: payload.operationId,
                    revisao: revision + 1
                });
            } else if (payload.action === 'reconhecer_alertas_lote') {
                payload.reconhecimentos.forEach(acknowledgement => {
                    const order = remoteOrders.get(String(acknowledgement.id));
                    if (!order) return;
                    remoteOrders.set(String(acknowledgement.id), {
                        ...order,
                        status: order.status === 'buscar' ? 'concluido' : order.status,
                        alertaReconhecidoEm: acknowledgement.reconhecidoEm || new Date().toISOString(),
                        operacaoId: acknowledgement.operationId,
                        revisao: revision + 1
                    });
                });
            } else if (payload.action === 'excluir_pedido') {
                remoteOrders.delete(String(payload.id));
            } else if (payload.action === 'excluir_hoje' || payload.action === 'excluir_tudo') {
                payload.ids.forEach(id => remoteOrders.delete(String(id)));
            }
            revision += 1;
        }
    };

    const context = vm.createContext({
        console,
        setTimeout,
        clearTimeout,
        Math,
        Date,
        navigator: { onLine: true },
        document: { visibilityState: 'visible', addEventListener() {} },
        addEventListener() {},
        AloStorage: storage,
        AloLogic: logic,
        AloApi: api
    });
    context.window = context;
    loadScript(context, 'modules/kds/sync.js');

    const manager = new context.AloSync({ getUrl: () => 'https://server.test', onOrders() {}, onState() {} });
    manager.schedule = () => {};

    return {
        manager,
        localOrders,
        operations,
        remoteOrders,
        postPayloads,
        requestLog,
        blockNextSync() {
            let release;
            let markStarted;
            const started = new Promise(resolve => { markStarted = resolve; });
            const promise = new Promise(resolve => { release = resolve; });
            syncBlocker = { promise, markStarted };
            return { started, release };
        },
        setFailPost(value) { failPost = value; }
    };
}

async function testAcceptAndConfirm() {
    const harness = createSyncHarness();
    const order = { id: '1', produto: 'Feijão', status: 'pendente', timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set('1', order);
    harness.remoteOrders.set('1', order);

    await harness.manager.enqueueStatus('1', 'fazendo');
    assert.equal(harness.manager.orders[0].status, 'fazendo');
    await harness.manager.syncNow(true);
    assert.equal(harness.remoteOrders.get('1').status, 'fazendo');
    assert.equal(harness.operations.size, 0);
}

async function testOfflineRetry() {
    const harness = createSyncHarness();
    const order = { id: '2', produto: 'Arroz', status: 'pendente', timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set('2', order);
    harness.remoteOrders.set('2', order);

    await harness.manager.enqueueStatus('2', 'fazendo');
    harness.setFailPost(true);
    await harness.manager.syncNow(true);
    assert.equal(harness.operations.size, 1);
    assert.equal(harness.manager.orders[0].status, 'fazendo');

    harness.setFailPost(false);
    for (const operation of harness.operations.values()) operation.nextAttemptAt = 0;
    await harness.manager.syncNow(true);
    assert.equal(harness.remoteOrders.get('2').status, 'fazendo');
    assert.equal(harness.operations.size, 0);
}

async function testDeleteDoesNotReturn() {
    const harness = createSyncHarness();
    const order = { id: '3', produto: 'Couve', status: 'pendente', timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set('3', order);
    harness.remoteOrders.set('3', order);

    await harness.manager.enqueueDelete('3');
    assert.equal(harness.manager.orders.length, 0);
    await harness.manager.syncNow(true);
    assert.equal(harness.remoteOrders.has('3'), false);
    assert.equal(harness.manager.orders.length, 0);
    assert.equal(harness.operations.size, 0);
}

async function testNewOrderKeepsAreaRoute() {
    const harness = createSyncHarness();
    const local = await harness.manager.enqueueNewOrder({
        produto: 'Suco', areaOrigem: 'caixa', areaDestino: 'bar'
    });
    assert.equal(local.areaOrigem, 'caixa');
    assert.equal(local.areaDestino, 'bar');
    const operation = [...harness.operations.values()][0];
    assert.equal(operation.payload.areaOrigem, 'caixa');
    assert.equal(operation.payload.areaDestino, 'bar');
    await harness.manager.syncNow(true);
    const remote = harness.remoteOrders.get(local.id);
    assert.equal(remote.areaOrigem, 'caixa');
    assert.equal(remote.areaDestino, 'bar');

    const second = await harness.manager.enqueueNewOrder({
        produto: 'Suco', areaOrigem: 'panelas', areaDestino: 'bar'
    });
    assert.notEqual(second.id, local.id);
    await harness.manager.syncNow(true);
    assert.equal(harness.remoteOrders.get(second.id).areaOrigem, 'panelas');
    assert.equal(harness.remoteOrders.get(second.id).areaDestino, 'bar');
}

async function testNewOrdersUseSingleBatch() {
    const harness = createSyncHarness();
    harness.manager.serverProtocol = 'modern';
    harness.manager.supportsCreateBatch = true;
    await harness.manager.enqueueNewOrder({ produto: 'Feijão', areaOrigem: 'panelas', areaDestino: 'cozinha' });
    await harness.manager.enqueueNewOrder({ produto: 'Arroz', areaOrigem: 'panelas', areaDestino: 'cozinha' });
    await harness.manager.enqueueNewOrder({ produto: 'Couve', areaOrigem: 'panelas', areaDestino: 'cozinha' });

    await harness.manager.syncNow(true, true);

    assert.equal(harness.postPayloads.length, 1, 'pedidos acumulados devem usar uma única chamada');
    assert.equal(harness.postPayloads[0].action, 'novo_pedido_lote');
    assert.equal(harness.postPayloads[0].pedidos.length, 3);
    assert.deepEqual(harness.requestLog.slice(0, 2), ['post:novo_pedido_lote', 'get'], 'o envio deve acontecer antes da confirmação');
    assert.equal(harness.remoteOrders.size, 3);
    assert.equal(harness.operations.size, 0);
}

async function testNewOrderDoesNotWaitForSlowPull() {
    const harness = createSyncHarness();
    harness.manager.serverProtocol = 'modern';
    harness.manager.supportsCreateBatch = true;
    const gate = harness.blockNextSync();
    const slowPull = harness.manager.syncNow(false, true);
    await gate.started;

    const local = await harness.manager.enqueueNewOrder({
        produto: 'Feijão', areaOrigem: 'panelas', areaDestino: 'cozinha'
    });
    await new Promise(resolve => setTimeout(resolve, 25));

    assert.equal(
        harness.postPayloads.some(payload => payload.action === 'novo_pedido'),
        true,
        'um pedido novo deve sair mesmo quando uma leitura anterior ainda está lenta'
    );
    gate.release();
    await slowPull;
    assert.equal(harness.remoteOrders.has(local.id), true);
    assert.equal(harness.operations.size, 0);
}

async function testSuccessfulPostTurnsIndicatorGreenBeforeFullPull() {
    const harness = createSyncHarness();
    harness.manager.queueImmediateFlush = () => {};
    const order = await harness.manager.enqueueNewOrder({
        produto: 'Caldo', areaOrigem: 'panelas', areaDestino: 'cozinha'
    });
    assert.equal(await harness.manager.getPendingCount(), 1);

    await harness.manager.flushPendingOperations();

    const operation = [...harness.operations.values()][0];
    assert.equal(Number(operation.submittedAt) > 0, true, 'o POST concluído deve ser reconhecido sem esperar uma segunda leitura');
    assert.equal(await harness.manager.getPendingCount(), 0, 'a bolinha deve ficar verde logo após o POST terminar');
    assert.equal(harness.manager.orders.find(item => item.id === order.id).syncState, 'submitted');
    assert.equal(harness.operations.size, 1, 'a operação deve continuar guardada até a verificação posterior');

    await harness.manager.pull(true);
    assert.equal(harness.operations.size, 0, 'a leitura posterior deve apenas encerrar a garantia durável');
}

async function testNewOrderJumpsAheadOfOldQueue() {
    const harness = createSyncHarness();
    for (let index = 0; index < 25; index += 1) {
        harness.operations.set(`status-antigo-${index}`, {
            operationId: `status-antigo-${index}`,
            type: 'status',
            orderId: `antigo-${index}`,
            payload: { id: `antigo-${index}`, novoStatus: 'fazendo', operationId: `status-antigo-${index}` },
            createdAt: index,
            attempts: 0,
            nextAttemptAt: 0
        });
    }
    await harness.manager.enqueueNewOrder({ produto: 'Arroz', areaOrigem: 'panelas', areaDestino: 'cozinha' });
    await harness.manager.flushPendingOperations();

    assert.equal(harness.postPayloads[0].action, 'novo_pedido', 'pedido novo deve ter prioridade sobre operações antigas');
}

async function testRapidAcceptsSurviveStaleHigherRevisionPull() {
    const harness = createSyncHarness();
    harness.manager.queueImmediateFlush = () => {};
    const orders = ['rapido-1', 'rapido-2', 'rapido-3'].map((id, index) => ({
        id,
        produto: `Produto ${index + 1}`,
        status: 'pendente',
        revisao: 10 + index,
        timestamp: new Date().toISOString()
    }));
    harness.manager.orders = orders.map(order => ({ ...order }));
    orders.forEach(order => {
        harness.localOrders.set(order.id, { ...order });
        harness.remoteOrders.set(order.id, { ...order, revisao: order.revisao + 20 });
    });

    await Promise.all(orders.map(order => harness.manager.enqueueStatus(order.id, 'fazendo')));
    await harness.manager.pull(true);

    assert.equal(
        harness.manager.orders.map(order => order.status).join(','),
        'fazendo,fazendo,fazendo',
        'uma leitura antiga não pode desfazer aceitações rápidas'
    );
    assert.equal(harness.operations.size, 3, 'as três intenções devem continuar protegidas na fila');
    [...harness.operations.values()].forEach(operation => {
        assert.equal(
            operation.payload.expectedOrderRevision,
            harness.remoteOrders.get(operation.orderId).revisao,
            'cada operação deve ser rebaseada na revisão remota atual'
        );
        assert.equal(operation.nextAttemptAt, 0);
    });

    await harness.manager.flushPendingOperations();
    await harness.manager.pull(true);
    assert.equal([...harness.remoteOrders.values()].map(order => order.status).join(','), 'fazendo,fazendo,fazendo');
    assert.equal(harness.operations.size, 0, 'a fila só deve limpar depois da confirmação dos três pedidos');
}

async function testAlertAcknowledgementIsConfirmedByServer() {
    const harness = createSyncHarness();
    const order = {
        id: 'buscar-1', produto: 'Batata', status: 'buscar', revisao: 4,
        timestamp: new Date().toISOString(), finalizadoEm: new Date().toISOString()
    };
    harness.manager.orders = [order];
    harness.localOrders.set(order.id, order);
    harness.remoteOrders.set(order.id, order);
    harness.manager.supportsAlertAcknowledgement = true;

    await harness.manager.enqueueAcknowledgement(order.id);
    assert.notEqual(harness.manager.orders[0].alertaReconhecidoEm, '', 'o alarme deve parar imediatamente neste aparelho');
    assert.equal(harness.manager.orders[0].status, 'concluido', 'confirmar a retirada deve encerrar o pedido localmente');
    await harness.manager.flushPendingOperations();
    await harness.manager.pull(true);

    assert.notEqual(harness.remoteOrders.get(order.id).alertaReconhecidoEm, '', 'a ciência deve ser gravada para os outros aparelhos');
    assert.equal(harness.remoteOrders.get(order.id).status, 'concluido', 'o outro aparelho deve receber um estado que encerra o alarme');
    assert.equal(harness.operations.size, 0);

    await harness.manager.enqueueStatus(order.id, 'fazendo');
    assert.equal(harness.manager.orders[0].alertaReconhecidoEm, '', 'uma nova etapa deve limpar a ciência do alerta anterior');
    await harness.manager.flushPendingOperations();
    await harness.manager.pull(true);
    assert.equal(harness.operations.size, 0);
}

async function testAlertAcknowledgementRetriesAfterOfflineFailure() {
    const harness = createSyncHarness();
    const order = {
        id: 'buscar-offline', produto: 'Couve', status: 'buscar', revisao: 2,
        timestamp: new Date().toISOString(), finalizadoEm: new Date().toISOString()
    };
    harness.manager.orders = [order];
    harness.localOrders.set(order.id, order);
    harness.remoteOrders.set(order.id, order);
    harness.manager.queueImmediateFlush = () => {};
    await harness.manager.enqueueAcknowledgement(order.id);

    harness.setFailPost(true);
    await assert.rejects(() => harness.manager.flushPendingOperations());
    assert.equal(harness.operations.size, 1, 'a ciência deve permanecer na fila quando a rede falhar');

    harness.setFailPost(false);
    for (const operation of harness.operations.values()) operation.nextAttemptAt = 0;
    await harness.manager.syncNow(true, true);
    assert.notEqual(harness.remoteOrders.get(order.id).alertaReconhecidoEm, '');
    assert.equal(harness.operations.size, 0);
}

async function testOldServerFallsBackToIndividualOrders() {
    const harness = createSyncHarness();
    harness.manager.serverProtocol = 'modern';
    harness.manager.supportsCreateBatch = false;
    await harness.manager.enqueueNewOrder({ produto: 'Feijão', areaOrigem: 'panelas', areaDestino: 'cozinha' });
    await harness.manager.enqueueNewOrder({ produto: 'Arroz', areaOrigem: 'panelas', areaDestino: 'cozinha' });

    await harness.manager.syncNow(true, true);

    assert.deepEqual(harness.postPayloads.map(payload => payload.action), ['novo_pedido', 'novo_pedido']);
    assert.equal(harness.remoteOrders.size, 2);
    assert.equal(harness.operations.size, 0);
}

async function testSameStatusFromAnotherDeviceClearsQueue() {
    const harness = createSyncHarness();
    const order = { id: 'multi-1', produto: 'Feijão', status: 'pendente', revisao: 4, timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set(order.id, order);
    harness.remoteOrders.set(order.id, order);

    await harness.manager.enqueueStatus(order.id, 'fazendo');
    harness.remoteOrders.set(order.id, { ...order, status: 'fazendo', revisao: 5, operacaoId: 'outro_aparelho' });
    await harness.manager.syncNow(false, true);

    assert.equal(harness.operations.size, 0, 'o mesmo estado confirmado por outro aparelho deve limpar a fila');
    assert.equal(harness.manager.orders[0].status, 'fazendo');
    assert.equal(harness.manager.orders[0].syncState, 'confirmed');
}

async function testNewerRemoteActionWinsOverStaleTablet() {
    const harness = createSyncHarness();
    const order = { id: 'multi-2', produto: 'Arroz', status: 'pendente', revisao: 8, timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set(order.id, order);
    harness.remoteOrders.set(order.id, order);

    await harness.manager.enqueueStatus(order.id, 'fazendo');
    harness.remoteOrders.set(order.id, {
        ...order,
        status: 'enviado',
        revisao: 9,
        operacaoId: 'acao_mais_nova',
        finalizadoEm: new Date().toISOString()
    });
    await harness.manager.syncNow(true, true);

    assert.equal(harness.operations.size, 0, 'uma ação atrasada não deve permanecer reenviando');
    assert.equal(harness.manager.orders[0].status, 'enviado', 'o estado mais novo do servidor deve prevalecer');
    assert.equal(harness.remoteOrders.get(order.id).status, 'enviado');
}

async function testSendOrPickupSurvivesRemotePreparingRollback() {
    const harness = createSyncHarness();
    harness.manager.queueImmediateFlush = () => {};
    const order = { id: 'final-rollback', produto: 'Caldo', status: 'fazendo', revisao: 12, timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set(order.id, order);
    harness.remoteOrders.set(order.id, order);

    await harness.manager.enqueueStatus(order.id, 'buscar');
    harness.remoteOrders.set(order.id, { ...order, status: 'pendente', revisao: 18, operacaoId: 'leitura_atrasada' });
    await harness.manager.pull(true);

    assert.equal(harness.manager.orders[0].status, 'buscar', 'uma leitura atrasada não pode devolver Vir buscar para Em preparo ou Pendente');
    assert.equal(harness.operations.size, 1, 'a intenção final precisa continuar na fila');
    const operation = [...harness.operations.values()][0];
    assert.equal(operation.payload.expectedStatus, 'pendente', 'a operação deve se adaptar ao estado atual do servidor');
    assert.equal(operation.payload.expectedOrderRevision, 18);

    await harness.manager.flushPendingOperations();
    await harness.manager.pull(true);
    assert.equal(harness.remoteOrders.get(order.id).status, 'buscar');
    assert.equal(harness.operations.size, 0);
}

async function testOldOrphanQueueIsCleaned() {
    const harness = createSyncHarness();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const order = { id: 'orphan-1', produto: 'Chá', status: 'fazendo', revisao: 2, timestamp: yesterday };
    harness.manager.orders = [order];
    harness.localOrders.set(order.id, order);
    harness.operations.set('old-status', {
        operationId: 'old-status',
        type: 'status',
        orderId: order.id,
        payload: { id: order.id, novoStatus: 'fazendo' },
        createdAt: Date.now() - 120000,
        attempts: 3,
        nextAttemptAt: Date.now() + 60000
    });

    await harness.manager.syncNow(false, true);

    assert.equal(harness.operations.size, 0, 'pendência antiga sem pedido no servidor deve ser removida');
    assert.equal(harness.manager.orders.length, 0, 'pedido ativo órfão não deve reaparecer no aparelho');
}

function testAppsScriptRejectsStaleStatus() {
    const context = vm.createContext({ console, Date, Set });
    loadScript(context, 'google-apps-script.gs');
    context.testRow = ['srv-1', 'Feijão', 'fazendo', new Date().toISOString(), '', '', '', 5, 'acao_atual', 'panelas', 'cozinha', ''];

    const staleApplied = vm.runInContext(
        "applyStatus_(testRow, 'enviado', '', 'acao_atrasada', 'pendente', 4, 6)",
        context
    );
    assert.equal(staleApplied, false);
    assert.equal(context.testRow[2], 'fazendo');

    const currentApplied = vm.runInContext(
        "applyStatus_(testRow, 'enviado', '', 'acao_valida', 'fazendo', 5, 6)",
        context
    );
    assert.equal(currentApplied, true);
    assert.equal(context.testRow[2], 'enviado');
    assert.equal(context.testRow[7], 6);
}

function testAppsScriptAcknowledgesAlertOnce() {
    const context = vm.createContext({ console, Date, Set });
    loadScript(context, 'google-apps-script.gs');
    context.testRow = [
        'srv-alerta', 'Batata', 'buscar', new Date().toISOString(), new Date().toISOString(), '',
        '', 5, 'acao_buscar', 'panelas', 'cozinha', ''
    ];
    const first = vm.runInContext(
        "applyAlertAcknowledgement_(testRow, '2026-08-25T12:00:00.000Z', 'ciencia-1', 6)",
        context
    );
    assert.equal(first, true);
    assert.equal(context.testRow[2], 'concluido');
    assert.equal(context.testRow[11], '2026-08-25T12:00:00.000Z');
    assert.equal(context.testRow[7], 6);

    const repeated = vm.runInContext(
        "applyAlertAcknowledgement_(testRow, '2026-08-25T12:01:00.000Z', 'ciencia-2', 7)",
        context
    );
    assert.equal(repeated, false, 'repetir a ciência não deve criar nova alteração');
    assert.equal(context.testRow[7], 6);

    const reopened = vm.runInContext(
        "applyStatus_(testRow, 'fazendo', '', 'reabrir', 'concluido', 6, 7)",
        context
    );
    assert.equal(reopened, true);
    assert.equal(context.testRow[11], '', 'uma nova etapa deve poder gerar um novo alerta depois');

    const ignored = vm.runInContext(
        "applyAlertAcknowledgement_(testRow, '2026-08-25T12:02:00.000Z', 'ciencia-invalida', 8)",
        context
    );
    assert.equal(ignored, false, 'não deve reconhecer alerta quando o pedido não está aguardando retirada ou cancelado');

    context.cancelledRow = [
        'srv-cancelado', 'Couve', 'cancelado', new Date().toISOString(), new Date().toISOString(), 'Acabou',
        '', 8, 'acao_cancelar', 'panelas', 'cozinha', ''
    ];
    const cancelledAck = vm.runInContext(
        "applyAlertAcknowledgement_(cancelledRow, '2026-08-25T12:03:00.000Z', 'ciencia-cancelada', 9)",
        context
    );
    assert.equal(cancelledAck, true);
    assert.equal(context.cancelledRow[2], 'cancelado', 'confirmar um cancelamento não deve alterar seu status histórico');
}

function testStandaloneAppsScriptCreatesAndReusesSpreadsheet() {
    const scriptProperties = new Map();
    const createdSpreadsheet = { getId() { return 'planilha-criada'; } };
    const scriptLock = { name: 'script-lock' };
    let created = 0;
    let opened = 0;
    const context = vm.createContext({
        console,
        Date,
        Set,
        PropertiesService: {
            getDocumentProperties() { return null; },
            getScriptProperties() {
                return {
                    getProperty(key) { return scriptProperties.get(key) || null; },
                    setProperty(key, value) { scriptProperties.set(key, String(value)); }
                };
            }
        },
        SpreadsheetApp: {
            getActiveSpreadsheet() { return null; },
            create(name) {
                created += 1;
                assert.equal(name, 'Alô Cozinha - Banco de Dados');
                return createdSpreadsheet;
            },
            openById(id) {
                opened += 1;
                assert.equal(id, 'planilha-criada');
                return createdSpreadsheet;
            }
        },
        LockService: {
            getDocumentLock() { return null; },
            getScriptLock() { return scriptLock; }
        }
    });
    loadScript(context, 'google-apps-script.gs');

    assert.equal(vm.runInContext('getSpreadsheet_().getId()', context), 'planilha-criada');
    assert.equal(scriptProperties.get('kds_spreadsheet_id'), 'planilha-criada');
    assert.equal(vm.runInContext('getSpreadsheet_().getId()', context), 'planilha-criada');
    assert.equal(created, 1, 'a planilha independente deve ser criada uma única vez');
    assert.equal(opened, 1, 'as próximas chamadas devem reutilizar a planilha salva');
    assert.equal(vm.runInContext('getLock_()', context), scriptLock);
}

async function testBackupMigrationWaitsForSlowServer() {
    let polls = 0;
    const context = vm.createContext({ console, Date, URL });
    context.window = context;
    context.fetch = async (url, options = {}) => {
        if (options.method === 'POST') return { ok: true };
        polls += 1;
        return {
            ok: true,
            async json() {
                return polls <= 25 ? { status: 'processing' } : { status: 'ok', pedidosImportados: 0, pedidosIgnorados: 3421 };
            }
        };
    };
    loadScript(context, 'core/api.js');
    const result = await context.AloApi.migrateBackup(
        'https://script.google.com/macros/s/teste/exec',
        { migrationId: 'backup_teste', expectedRevision: 2, dados: {}, pedidos: [] },
        async () => {}
    );
    assert.equal(result.status, 'ok');
    assert.equal(polls, 26, 'a confirmação deve continuar depois do antigo limite de 20 tentativas');
}

function testAppsScriptAppendsOrderBatchOnce() {
    const properties = new Map([['kds_pedidos_revision', '7']]);
    const writes = [];
    const context = vm.createContext({
        console,
        Date,
        Set,
        PropertiesService: {
            getDocumentProperties() {
                return {
                    getProperty(key) { return properties.get(key) || null; },
                    setProperty(key, value) { properties.set(key, String(value)); }
                };
            }
        }
    });
    loadScript(context, 'google-apps-script.gs');
    context.testSheet = {
        getLastRow() { return 1; },
        getRange(row, column, rowCount, columnCount) {
            return { setValues(values) { writes.push({ row, column, rowCount, columnCount, values }); } };
        }
    };
    context.testBatch = [
        { id: 'lote-1', produto: 'Feijão', areaOrigem: 'panelas', areaDestino: 'cozinha' },
        { id: 'lote-2', produto: 'Arroz', areaOrigem: 'panelas', areaDestino: 'cozinha' },
        { id: 'lote-1', produto: 'Duplicado', areaOrigem: 'panelas', areaDestino: 'cozinha' }
    ];

    const result = vm.runInContext('appendNewOrders_(testSheet, testBatch)', context);
    assert.equal(result.count, 2);
    assert.equal(result.revision, 9);
    assert.equal(writes.length, 1, 'o lote deve gerar uma única gravação na planilha');
    assert.equal(writes[0].values.length, 2);
}

function testOperationalSyncUsesCurrentShiftAndLeavesOldOrdersInHistory() {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const rows = Array.from({ length: 600 }, (_, index) => [
        `pedido-${index}`,
        `Produto ${index}`,
        index === 0 ? 'pendente' : 'concluido',
        (index < 300 ? yesterday : today).toISOString(),
        (index < 300 ? yesterday : today).toISOString(),
        '',
        (index < 300 ? yesterday : today).toISOString(),
        index + 1,
        '',
        'panelas',
        'cozinha',
        ''
    ]);
    const fullWidthReads = [];
    const properties = new Map();
    let timestampScans = 0;
    const formatDay = value => {
        const date = new Date(value);
        return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
    };
    const context = vm.createContext({
        console,
        Date,
        Set,
        Utilities: { formatDate: value => formatDay(value) },
        Session: { getScriptTimeZone: () => 'UTC' },
        PropertiesService: {
            getDocumentProperties() {
                return {
                    getProperty(key) { return properties.get(key) || null; },
                    setProperty(key, value) { properties.set(key, String(value)); }
                };
            }
        }
    });
    loadScript(context, 'google-apps-script.gs');
    context.testSheet = {
        getLastRow() { return rows.length + 1; },
        getRange(row, column, rowCount, columnCount) {
            if (column === 1 && columnCount === 12) fullWidthReads.push(rowCount);
            if (column === 4 && columnCount === 1) timestampScans += 1;
            const values = rows.slice(row - 2, row - 2 + rowCount).map(source => source.slice(column - 1, column - 1 + columnCount));
            return {
                getValues() { return values.map(value => value.slice()); },
                createTextFinder(pattern) {
                    let regexEnabled = false;
                    return {
                        useRegularExpression(value) { regexEnabled = value; return this; },
                        findAll() {
                            const matcher = regexEnabled ? new RegExp(pattern) : null;
                            const cells = [];
                            values.forEach((value, index) => {
                                const text = String(value[0]);
                                if ((matcher && matcher.test(text)) || (!matcher && text === pattern)) {
                                    cells.push({ getRow: () => row + index, getValue: () => text });
                                }
                            });
                            return cells;
                        }
                    };
                }
            };
        }
    };

    const visible = vm.runInContext('pedidosVisiveis_(testSheet)', context);
    assert.equal(visible.some(order => order.id === 'pedido-0'), false, 'pedido de expediente antigo deve ficar apenas no histórico');
    assert.equal(Math.max(...fullWidthReads), 300, 'a sincronização deve carregar todos os pedidos do dia, sem corte arbitrário');
    vm.runInContext('pedidosVisiveis_(testSheet)', context);
    assert.equal(timestampScans, 1, 'a primeira linha do expediente deve ser localizada apenas uma vez por dia');
}

function testBackupMigrationIsIdempotentAndPreservesHistory() {
    const properties = new Map([['kds_pedidos_revision', '10']]);
    const rows = [[
        'pedido-existente', 'Arroz', 'enviado', '2026-08-01T10:00:00.000Z',
        '2026-08-01T10:05:00.000Z', '', '2026-08-01T10:05:00.000Z', 10, '', 'panelas', 'cozinha'
    ]];
    const context = vm.createContext({
        console,
        Date,
        Set,
        PropertiesService: {
            getDocumentProperties() {
                return {
                    getProperty(key) { return properties.get(key) || null; },
                    setProperty(key, value) { properties.set(key, String(value)); }
                };
            }
        }
    });
    loadScript(context, 'google-apps-script.gs');
    context.testSheet = {
        getLastRow() { return rows.length + 1; },
        getRange(row, column, rowCount) {
            return {
                getValues() { return rows.slice(row - 2, row - 2 + rowCount).map(values => values.slice()); },
                setValues(values) {
                    values.forEach((valuesRow, index) => { rows[row - 2 + index] = valuesRow.slice(); });
                }
            };
        }
    };
    context.backupOrders = [
        { id: 'pedido-existente', produto: 'Arroz', status: 'enviado', timestamp: '2026-08-01T10:00:00.000Z' },
        { id: 'pedido-cancelado', produto: 'Chá', status: 'cancelado', timestamp: '2026-08-02T09:00:00.000Z', finalizadoEm: '2026-08-02T09:03:00.000Z', motivo: 'Acabou', areaOrigem: 'bar', areaDestino: 'cozinha' },
        { id: 'pedido-buscar', produto: 'Batata', status: 'buscar', timestamp: '2026-08-03T12:00:00.000Z', finalizadoEm: '2026-08-03T12:07:00.000Z', areaOrigem: 'delivery', areaDestino: 'cozinha' }
    ];

    const first = vm.runInContext('importBackupOrders_(testSheet, backupOrders)', context);
    assert.equal(first.imported, 2);
    assert.equal(first.ignored, 1);
    assert.equal(rows.length, 3);
    assert.equal(rows[1][2], 'cancelado');
    assert.equal(rows[1][3], '2026-08-02T09:00:00.000Z');
    assert.equal(rows[1][5], 'Acabou');
    assert.equal(rows[1][9], 'bar');

    const repeated = vm.runInContext('importBackupOrders_(testSheet, backupOrders)', context);
    assert.equal(repeated.imported, 0);
    assert.equal(repeated.ignored, 3);
    assert.equal(rows.length, 3, 'repetir o backup não pode duplicar pedidos');
}

function testAppsScriptKeepsActivityIdempotentAndRejectsStaleStatus() {
    const properties = new Map([['kds_atividades_revision', '0']]);
    const rows = [];
    const context = vm.createContext({
        console,
        Date,
        Set,
        PropertiesService: {
            getDocumentProperties() {
                return {
                    getProperty(key) { return properties.get(key) || null; },
                    setProperty(key, value) { properties.set(key, String(value)); }
                };
            }
        }
    });
    loadScript(context, 'google-apps-script.gs');
    context.testSheet = {
        getLastRow() { return rows.length + 1; },
        getRange(row, column, rowCount) {
            return {
                getValues() { return rows.slice(row - 2, row - 2 + rowCount).map(values => values.slice()); },
                setValues(values) {
                    values.forEach((item, index) => { rows[row - 2 + index] = item.slice(); });
                }
            };
        }
    };
    context.activityPending = {
        id: 'atividade-1', tarefaId: 'tarefa-1', nome: 'Limpar chapa', setorId: 'cozinha',
        status: 'pendente', data: '2026-08-04', horario: '18:00', operacaoId: 'op-1',
        atualizadoEm: '2026-08-04T18:00:00.000Z', permiteRemarcacao: true,
        registroPop: true, procedimento: 'Lavar, aplicar produto e registrar.',
        funcionarioNome: 'Ana', remarcadoDe: '2026-08-03', remarcadoEm: '2026-08-03T12:00:00.000Z'
    };
    context.activityStarted = {
        ...context.activityPending, status: 'em_execucao', expectedStatus: 'pendente',
        operacaoId: 'op-2', iniciadoEm: '2026-08-04T18:01:00.000Z',
        atualizadoEm: '2026-08-04T18:01:00.000Z'
    };
    context.activityStale = {
        ...context.activityPending, status: 'concluida', expectedStatus: 'pendente',
        operacaoId: 'op-3', atualizadoEm: '2026-08-04T18:02:00.000Z'
    };

    const inserted = vm.runInContext('saveActivities_(testSheet, [activityPending])', context);
    assert.equal(inserted.count, 1);
    assert.equal(rows[0][5], 'pendente');
    assert.equal(rows[0][18], true);
    assert.equal(rows[0][19], true);
    assert.equal(rows[0][20], 'Lavar, aplicar produto e registrar.');
    assert.equal(rows[0][21], 'Ana');
    assert.equal(rows[0][22], '2026-08-03');

    const duplicate = vm.runInContext('saveActivities_(testSheet, [activityPending])', context);
    assert.equal(duplicate.count, 0, 'a mesma operacao nao pode duplicar a atividade');

    const started = vm.runInContext('saveActivities_(testSheet, [activityStarted])', context);
    assert.equal(started.count, 1);
    assert.equal(rows[0][5], 'em_execucao');

    const stale = vm.runInContext('saveActivities_(testSheet, [activityStale])', context);
    assert.equal(stale.count, 0, 'status antigo de outro aparelho nao deve sobrescrever o atual');
    assert.equal(rows[0][5], 'em_execucao');
}

function testOldClientPreservesV2TaskCatalog() {
    const originalBank = {
        produtos: [{ nome: 'Feijao' }], categorias: [], obsPedidos: [], obsCancelamentos: [], areas: [],
        setoresTarefas: [{ id: 'cozinha', nome: 'Cozinha' }],
        funcionarios: [{ id: 'ana', nome: 'Ana', cargo: 'Auxiliar' }],
        tarefas: [{ id: 'limpar', nome: 'Limpar chapa' }],
        configsTarefas: { som: 'beep', volume: '80' }, configs: {}
    };
    const properties = new Map([
        ['kds_banco_revision', '9'],
        ['kds_banco', JSON.stringify(originalBank)]
    ]);
    const context = vm.createContext({
        console,
        Date,
        Set,
        PropertiesService: {
            getDocumentProperties() {
                return {
                    getProperty(key) { return properties.get(key) || null; },
                    setProperty(key, value) { properties.set(key, String(value)); }
                };
            }
        }
    });
    loadScript(context, 'google-apps-script.gs');
    context.oldClientBank = {
        produtos: [{ nome: 'Arroz' }], categorias: [], obsPedidos: [], obsCancelamentos: [], areas: [], configs: {}
    };

    const result = vm.runInContext('salvarBanco_(oldClientBank, 9)', context);
    const saved = JSON.parse(properties.get('kds_banco'));
    assert.equal(result.status, 'ok');
    assert.equal(result.revision, 10);
    assert.equal(saved.produtos[0].nome, 'Arroz');
    assert.deepEqual(saved.setoresTarefas, originalBank.setoresTarefas);
    assert.deepEqual(saved.funcionarios, originalBank.funcionarios);
    assert.deepEqual(saved.tarefas, originalBank.tarefas);
    assert.deepEqual(saved.configsTarefas, originalBank.configsTarefas);
}

function testPasswordDialogsHaveExplicitConfirmation() {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'modules', 'kds', 'app.js'), 'utf8');
    [
        'confirmarSenhaModo()',
        'confirmarSenhaAdmin()',
        'confirmarSenhaAvancada()'
    ].forEach(handler => {
        assert.equal(html.includes('onclick="' + handler + '"'), true, handler + ' precisa de botao visivel');
        assert.equal(html.includes('event.preventDefault(); ' + handler), true, handler + ' precisa funcionar com Enter');
        assert.equal(app.includes('function ' + handler), true, handler + ' precisa estar implementada');
    });
    assert.equal((html.match(/class="senha-feedback"/g) || []).length, 3);
    assert.equal(html.includes('id="operadorAdmin"'), true, 'o login deve identificar o operador');
    assert.equal(html.includes('id="modalSenhaAcao"'), false, 'a senha mestra não deve proteger ações comuns');
    assert.equal(app.includes('Senha incorreta. Tente novamente.'), true);
}

function testV2027TaskExperience() {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const tasks = fs.readFileSync(path.join(root, 'modules', 'checklist', 'app.js'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'modules', 'kds', 'app.js'), 'utf8');
    const sync = fs.readFileSync(path.join(root, 'modules', 'kds', 'sync.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'modules', 'checklist', 'styles.css'), 'utf8');
    const kdsCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'core', 'ui-dialog.js'), 'utf8');
    const gas = fs.readFileSync(path.join(root, 'google-apps-script.gs'), 'utf8');
    const templates = fs.readFileSync(path.join(root, 'modules', 'checklist', 'templates.js'), 'utf8');
    const comprasHtml = fs.readFileSync(path.join(root, 'modules', 'compras', 'index.html'), 'utf8');
    const comprasSync = fs.readFileSync(path.join(root, 'modules', 'compras', 'src', 'scripts', 'sync.js'), 'utf8');
    const comprasApp = fs.readFileSync(path.join(root, 'modules', 'compras', 'src', 'scripts', 'app.js'), 'utf8');
    const comprasHost = fs.readFileSync(path.join(root, 'modules', 'compras', 'host.js'), 'utf8');
    const panel = html.slice(html.indexOf('id="modalPainelUnificado"'), html.indexOf('id="modalConfigKds"'));
    const kdsSettings = html.slice(html.indexOf('id="modalConfigKds"'), html.indexOf('id="modalConfigTasksMenu"'));
    const taskSettings = html.slice(html.indexOf('id="modalConfigTasksMenu"'), html.indexOf('id="modalTaskHygieneLibrary"'));

    assert.equal(html.includes('KDS - Sistema de Pedidos'), true);
    assert.equal(html.includes('📤 Exportar backup completo'), true);
    assert.equal(html.includes('📥 Restaurar backup'), true);
    assert.equal(html.includes('📥 Restaurar KDS e Checklist'), false);
    assert.equal(html.includes('📥 Restaurar Compras'), false);
    assert.equal(html.includes("renderizarMetricasDetalhes('tudo')"), true);
    assert.equal(html.includes('Histórico completo'), true);
    assert.equal(app.includes("periodo === 'tudo'"), true);
    assert.equal(fs.readFileSync(path.join(root, 'core', 'api.js'), 'utf8').includes('attempt < 120'), true);
    assert.equal(app.includes("url: current.configs.url"), true, 'a migração deve preservar a URL nova');
    assert.equal(app.includes("AloApi.migrateBackup"), true, 'o backup deve ser confirmado pelo novo servidor');
    assert.equal(gas.includes("action === 'importar_backup'"), true);
    assert.equal(gas.includes("action === 'status_migracao'"), true);
    assert.equal(gas.includes('PropertiesService.getScriptProperties()'), true);
    assert.equal(gas.includes("SpreadsheetApp.create(NOME_PLANILHA_DADOS)"), true);
    assert.equal(gas.includes('LockService.getScriptLock()'), true);
    assert.equal(sync.includes('queueImmediateFlush'), true, 'pedidos novos devem usar o canal urgente de envio');
    assert.equal(sync.includes("priority = { create: 0, acknowledgement: 0"), true, 'pedidos e ciências devem furar filas antigas');
    assert.equal(gas.includes("action === 'reconhecer_alerta'"), true, 'a ciência das Panelas deve ser compartilhada pelo servidor');
    assert.equal(gas.includes('PROP_PEDIDOS_SHIFT_START_PREFIX'), true, 'a sincronização operacional deve localizar o expediente sem limite numérico');
    assert.equal(gas.includes('PEDIDOS_SHIFT_START_HOUR = 4'), true, 'o expediente deve atravessar a madrugada sem carregar pedidos antigos');
    assert.equal(kdsCss.includes('"conteudo origem"'), true, 'no celular o emoji da origem deve ficar no canto superior direito do cartão');
    assert.equal(kdsCss.includes('.pedido-meta-acoes { display: contents; }'), true, 'a origem e as ações devem ocupar áreas diferentes da grade móvel');
    assert.equal(kdsCss.includes('.btn-pedido-acao { min-width: 0; flex: 1 1 0; }'), true, 'as três ações devem caber na mesma linha no celular');
    assert.equal(app.includes('function pedidosParaCacheLocal()'), true);
    assert.equal(app.includes("localStorage.removeItem('kds_pedidos_local')"), true);
    assert.equal(app.includes('pedidosServidor = Array.isArray(importedData.pedidos)'), false, 'a migração não deve copiar todo o histórico para o localStorage');
    assert.equal((html.match(/<strong>Checklist<\/strong>/g) || []).length, 1, 'Checklist deve aparecer na tela inicial, não no cabeçalho');
    assert.equal(html.includes('<strong>KDS</strong>'), false, 'o cabeçalho deve usar apenas a imagem do módulo');
    assert.equal(html.includes('Pedidos por Área'), false);
    assert.equal(html.includes('Rotinas e tarefas'), false);
    assert.equal((html.match(/class="module-nav-button"/g) || []).length, 3, 'cada módulo deve ter retorno compacto no próprio título');
    assert.equal(panel.includes("abrirGerenciar('areas')"), true, 'setores devem ser administrados no painel central');
    assert.equal(panel.includes("openManager('restaurante', 'central')"), true, 'dados do restaurante devem ficar no painel central');
    assert.equal(panel.includes('AloSharedData.openManager()'), true, 'funcionários e acessos devem ficar no núcleo compartilhado');
    assert.equal(kdsSettings.includes("abrirGerenciar('areas')"), false, 'o KDS não deve manter um segundo gerenciador de áreas');
    assert.equal(taskSettings.includes('manageTaskAreas'), false, 'o Checklist não deve manter um segundo gerenciador de setores');
    assert.equal(html.includes('data-task-tab="total"'), true);
    assert.equal(html.includes('data-task-tab="pendentes"'), true);
    assert.equal(html.includes('data-task-tab="em_execucao"'), true);
    assert.equal(html.includes('id="modalTaskFinished"'), true);
    assert.equal(html.includes('id="modalTaskPop"'), true);
    assert.equal(html.includes('id="modalTaskReschedule"'), true);
    assert.equal((html.match(/class="module-header-switch/g) || []).length, 0);
    assert.equal((html.match(/class="module-context-name"/g) || []).length, 0, 'o nome do módulo não deve ser repetido no centro');
    assert.equal(html.includes('aria-label="Trocar de módulo"'), false);
    assert.equal(tasks.includes('function undoFinishedTask(targetStatus)'), true);
    assert.equal(tasks.includes('function openReschedule(id)'), true);
    assert.equal(tasks.includes('function confirmPopCompletion()'), true);
    assert.equal(tasks.includes('onclick="AloTasks.openTaskDetails'), true, 'o corpo do cartao deve abrir somente os detalhes');
    assert.equal(tasks.includes('event.stopPropagation();AloTasks.startTask'), true, 'iniciar nao pode disparar o clique do cartao');
    assert.equal(tasks.includes('event.stopPropagation();AloTasks.completeTask'), true, 'concluir nao pode disparar o clique do cartao');
    assert.equal(tasks.includes('taskEmployeeRole'), false, 'o cadastro nao pode pedir cargo');
    assert.equal(tasks.includes('employee.cargo'), false, 'o cargo nao pode aparecer no modulo de tarefas');
    assert.equal(tasks.includes("const today = filtered.filter(activity => activity.data === todayKey())"), true, 'todas as abas devem partir do mesmo dia');
    assert.equal(tasks.includes("items: today.filter(activity => activity.status === 'pendente'"), true, 'Pendentes deve contar apenas as pendencias de hoje');
    assert.equal(tasks.includes("items: today.filter(activity => activity.status === 'concluida')"), true, 'Concluidas deve contar apenas as conclusoes de hoje');
    assert.equal(tasks.includes('inOneHour'), false, 'Hoje deve mostrar todas as atividades do dia');
    assert.equal(tasks.includes('}, 3500);'), true, 'o lembrete deve desaparecer rapidamente dentro do modulo');
    assert.equal(tasks.includes('remarcadoDe: activity.remarcadoDe || activity.data'), true, 'remarcacoes sucessivas devem preservar a data original');
    assert.equal(tasks.includes("selectedTab = 'total'"), true, 'o lembrete deve abrir a aba Total');
    assert.equal(tasks.includes('function procedureHtml(value, requestedFormat'), true, 'procedimentos devem aceitar formato explicito');
    assert.equal(tasks.includes('function openTaskHistory(taskId)'), true, 'relatorios devem abrir o historico por tarefa');
    assert.equal(tasks.includes('Aguardando confirmação'), false, 'cartoes nao devem ocupar espaco com confirmacao de sincronizacao');
    assert.equal(tasks.includes('function returnTaskToPending()'), true, 'uma tarefa em execucao deve poder voltar para pendente');
    assert.equal(tasks.includes('function procedurePreview'), false, 'procedimento nao deve aparecer nos cartoes operacionais');
    assert.equal(tasks.includes('task-completed-meta'), false, 'duracao e POP nao devem aparecer nos cartoes operacionais');
    assert.equal(tasks.includes('Registros POP'), false, 'POP deve ficar integrado ao historico da tarefa');
    assert.equal(tasks.includes('function changeReportArea(value)'), true, 'relatorios precisam de filtro por area');
    assert.equal(tasks.includes('task-report-area-section'), true, 'relatorios precisam agrupar tarefas por area');
    assert.equal(html.indexOf('id="modalTaskHistory"') > html.indexOf('id="modalTaskReports"'), true, 'historico deve ficar acima do relatorio');
    assert.equal(css.includes('#modalTaskHistory { z-index: 1300; }'), true, 'historico precisa de camada superior');
    assert.equal(gas.includes("'ProcedimentoFormato'"), true, 'o formato do procedimento precisa sincronizar entre aparelhos');
    assert.equal(html.includes('id="tasksAreaPickerOptions"'), true, 'o setor das atividades deve ser trocado no cabecalho');
    assert.equal((html.match(/class="module-nav-back"/g) || []).length, 3, 'o retorno deve usar uma indicação simples integrada ao módulo');
    assert.equal(html.includes('class="module-home-return"'), false, 'a seta circular antiga deve ser removida');
    assert.equal(html.includes('<div class="module-home-version">v2.1.31</div>'), true, 'a tela inicial deve mostrar a versão');
    assert.equal(html.includes('Senha de Segurança'), true);
    assert.equal(html.includes('Senha Mestra'), false);
    assert.equal(app.includes("senhaMestra: \"\""), false, 'o aplicativo cru não deve trazer senha definida no código');
    assert.equal(app.includes("ULTIMO_OPERADOR_LOGIN_KEY = 'alo_ultimo_operador_login_v1'"), true, 'o último operador deve ser lembrado apenas neste aparelho');
    assert.equal(app.includes('function obterAreasUnificadas()'), true, 'a tela central deve mesclar setores sem trocar seus IDs');
    assert.equal(app.includes("grupo.checklist && grupo.checklist.ativo !== false"), true, 'um setor do KDS sem vínculo real não pode aparecer como Checklist');
    assert.equal(comprasHtml.includes('id="colabConfigKds"'), true);
    assert.equal(comprasHtml.includes('id="colabConfigChecklist"'), true);
    assert.equal(comprasHtml.includes('id="colabComprasReceber"'), true);
    assert.equal(comprasHtml.includes('id="colabComprasComprar"'), true);
    assert.equal(comprasHtml.includes('id="colabApenasReceber"'), false, 'a permissão antiga não deve continuar na interface');
    assert.equal(comprasHtml.includes("abrirGerenciar('restaurante')"), false, 'Compras não deve duplicar os dados do restaurante');
    assert.equal(comprasHtml.includes("abrirGerenciar('colaboradores')"), false, 'Compras não deve duplicar o gerenciador de operadores');
    assert.equal(comprasApp.includes('podeConfigurarKds'), true);
    assert.equal(sync.includes('serverIsBehindRequestedState'), true, 'leituras atrasadas não podem rebaixar um status solicitado');
    assert.equal(css.includes('.module-nav-icon { width: 56px;'), true, 'as imagens dos módulos devem ganhar destaque sem aumentar o cabeçalho');
    assert.equal((html.match(/assets\/module-kds\.png\?v=2\.1\.10/g) || []).length, 3, 'o KDS deve usar sua imagem própria no início, no cabeçalho e nos acessos');
    assert.equal((html.match(/assets\/module-checklist\.png\?v=2\.1\.10/g) || []).length, 3, 'o Checklist deve usar sua imagem própria no início, no cabeçalho e nos acessos');
    assert.equal(fs.existsSync(path.join(root, 'assets', 'module-kds.png')), true);
    assert.equal(fs.existsSync(path.join(root, 'assets', 'module-checklist.png')), true);
    assert.equal((html.match(/assets\/module-feira\.png\?v=2\.1\.10/g) || []).length, 3, 'a Lista de Compras deve usar sua imagem própria no início, no cabeçalho e nos acessos');
    assert.equal(fs.existsSync(path.join(root, 'assets', 'module-feira.png')), true);
    assert.equal(fs.existsSync(path.join(root, 'modules', 'compras', 'index.html')), true, 'a Lista de Compras completa deve acompanhar o app');
    assert.equal(html.includes('<strong>Lista de Compras</strong>'), true, 'a tela inicial deve usar o novo nome do módulo');
    assert.equal(html.includes('id="feiraImportInput"'), false, 'a importação temporária deve ser removida após a migração');
    assert.equal(html.includes('id="modalConfigCompras"'), true, 'as configurações de Compras devem ficar no painel principal');
    assert.equal(html.includes('Funcionários e Acessos'), true, 'o cadastro central deve separar vínculo de trabalho e login');
    assert.equal(html.includes('embedded=1'), true, 'o módulo integrado deve ocultar o segundo cabeçalho');
    assert.equal(comprasHtml.includes('Configurações Avançadas'), false, 'Compras não deve manter um painel avançado próprio');
    assert.equal(comprasHtml.includes('Forçar Atualização do App'), false, 'a atualização deve ficar centralizada no app principal');
    assert.equal(comprasSync.includes('nuvemFeiraEstaVirgem(remotoBruto) && bancoTemConteudoCompartilhado(localNormalizado)'), true, 'uma nuvem virgem não pode apagar dados locais de Compras');
    assert.equal(comprasSync.includes('async function restaurarBackupComprasPeloHost'), true, 'o backup de Compras deve ser gravado e conferido pelo módulo');
    assert.equal(comprasSync.includes('assinaturaRestauracaoCompras(db) !== assinaturaRestauracaoCompras(nuvemConferida)'), true, 'a restauração só pode concluir após conferir todo o banco');
    assert.equal(comprasApp.includes('async function autenticarOperadorComprasPeloHost'), true, 'o iframe deve validar PIN sem expor hashes ao host');
    assert.equal(comprasApp.includes('async function encerrarSessaoComprasPeloHost'), true, 'o iframe deve apagar a sessão ao sair');
    assert.equal(comprasApp.includes('ocultarSplash(true)'), true, 'Compras integrado não deve exibir uma segunda splash');
    assert.equal(comprasHost.includes('async function getBackup()'), true, 'o host deve fornecer Compras ao backup único');
    assert.equal(app.includes("format: 'backup_completo'"), true, 'o app deve gerar um arquivo único para todos os módulos');
    assert.equal(app.includes('atividades,'), true, 'o backup completo deve incluir o histórico do Checklist');
    assert.equal(gas.includes('atividadesImportadas: activityResult.count'), true, 'o Apps Script deve restaurar o histórico do Checklist');
    assert.equal(gas.includes("const SHEET_FEIRA_BANCO = 'Alô Feira - Banco'"), true, 'a Lista de Compras deve preservar a aba já usada na mesma implantação');
    assert.equal(gas.includes("e.parameter.app === 'alofeira'"), true, 'a URL única deve rotear as leituras da Lista de Compras');
    assert.equal(gas.includes("action === 'excluir_historico_atividades'"), true, 'o histórico do Checklist deve poder ser apagado separadamente');
    assert.equal(gas.includes('revision: getAtividadesRevision_()'), true, 'a exclusão do Checklist deve ser confirmada por revisão na leitura seguinte');
    assert.equal(app.includes("confirmation?.revision === undefined"), true, 'o app não deve confirmar limpeza usando um Apps Script antigo');
    assert.equal(app.includes("function excluirHistoricoModulo(modulo)"), true, 'o painel principal deve apagar históricos por módulo');
    assert.equal(tasks.includes('function clearHistoryLocal()'), true, 'o Checklist deve limpar seu cache após a exclusão confirmada');
    assert.equal((html.match(/class="app-sync-indicator/g) || []).length, 3, 'os três módulos devem compartilhar o indicador de sincronização');
    assert.equal(html.includes('>↻</button>'), false, 'nenhum módulo deve exibir seta no lugar da bolinha de conexão');
    assert.equal(html.includes('id="tasksSyncIndicator" class="app-sync-indicator offline"'), true, 'o Checklist deve iniciar com estado vermelho, nunca com seta');
    assert.equal(tasks.includes("indicator.innerText = '↻'"), false, 'a sincronização do Checklist não deve trocar a bolinha por seta');
    assert.equal(tasks.includes("let finalSyncState = 'online'"), true, 'o resultado real do servidor deve definir a cor final');
    assert.equal(tasks.includes('setSyncIndicator(finalSyncState)'), true, 'falha no servidor deve permanecer vermelha mesmo com Wi-Fi');
    assert.equal(css.includes('min-height: 52px;') && css.includes('padding: 6px 10px;'), true, 'o cabeçalho do Checklist deve ter a mesma altura do KDS');
    assert.equal(css.includes('#mainHeader .header-area-picker { width: fit-content; max-width: 100%; }'), true, 'os seletores móveis devem acompanhar o nome do setor');
    assert.equal(kdsCss.includes('.header-area-emoji { display: none; }'), false, 'o emoji do setor não pode sumir no celular');
    assert.equal(html.includes('id="tasksSummary"'), false, 'a faixa redundante de resumo deve ser removida');
    assert.equal(html.includes('id="taskTabTotalCount"'), true, 'Total deve mostrar sua contagem na aba');
    assert.equal(html.includes('id="taskTabPendingCount"'), true, 'Pendentes deve mostrar sua contagem na aba');
    assert.equal(html.includes('id="taskTabRunningCount"'), true, 'Em execucao deve mostrar sua contagem na aba');
    assert.equal(html.includes('id="taskTabCompletedCount"'), true, 'Concluidas deve mostrar sua contagem na aba');
    assert.equal(html.includes("abrirLoginAdmin('kds')"), true, 'o KDS deve abrir somente suas configuracoes');
    assert.equal(html.includes("abrirLoginAdmin('tasks')"), true, 'Atividades deve abrir somente suas configuracoes');
    assert.equal(html.includes('onclick="abrirModuloCompras()"'), true, 'Compras deve pedir login antes de abrir');
    assert.equal(app.includes('AloSharedData.listLoginPeople(finalidade)'), true, 'o login deve usar os acessos compartilhados filtrados pelo módulo');
    assert.equal(app.includes("AloSharedData.logoutModule('compras')"), true, 'a sessão de Compras deve terminar ao sair do módulo');
    assert.equal(app.includes("AloSharedData.logoutModule('l42')"), true, 'a sessão do L42 deve terminar ao sair do módulo');
    assert.equal(app.includes("|| (db.configs.senhaMestra"), false, 'a senha mestra não deve servir de atalho operacional');
    const comprasSettings = html.slice(html.indexOf('id="modalConfigCompras"'), html.indexOf('id="modalConfigKds"'));
    assert.equal(comprasSettings.includes('Dados do Restaurante'), false, 'dados do restaurante devem ficar no painel central');
    assert.equal(comprasSettings.includes('Gerenciar Operadores'), false, 'operadores devem ficar no painel central');
    assert.equal(panel.includes("openManager('restaurante', 'central')"), true, 'o painel central deve administrar o restaurante');
    assert.equal(panel.includes('AloSharedData.openManager()'), true, 'o painel central deve administrar funcionários e acessos');
    assert.equal(html.includes('module-choice-settings'), true, 'a tela inicial deve oferecer o painel completo');
    assert.equal(tasks.includes('function formatRichEditor(editorId, command)'), true, 'o procedimento deve usar editor formatado');
    assert.equal(tasks.includes('function cycleRichEditorAlignment(editorId, button)'), true, 'o editor deve ter um unico controle ciclico de alinhamento');
    assert.equal(tasks.includes("format === 'rico' || hasRichMarkup(value)"), true, 'procedimentos antigos com HTML devem ser reconhecidos');
    assert.equal(tasks.includes('function normalizeRichEditorLists(editor)'), true, 'trocar marcadores nao pode criar itens vazios');
    assert.equal(tasks.includes('function insertEmptyList(editor, command)'), true, 'a primeira linha deve mostrar o marcador antes da digitacao');
    assert.equal(tasks.includes('emptyItem.contains(selectionNode)'), true, 'o marcador vazio ativo deve continuar visivel');
    assert.equal(tasks.includes('Array.from(currentList.children).forEach'), false, 'alinhamento nao pode afetar a lista inteira');
    assert.equal(tasks.includes("procedimentoFormato: 'rico'"), true, 'o formato rico deve ser salvo');
    assert.equal(html.includes('id="taskPopObservation" class="task-rich-editor" contenteditable="true"'), true, 'a observacao POP deve usar o editor fixo');
    assert.equal(html.includes('<textarea id="taskPopObservation"'), false, 'a observacao nao deve ser redimensionavel');
    assert.equal(tasks.includes("title=\"Não foi feita\">❌"), true, 'nao realizada deve usar o X vermelho');
    assert.equal(tasks.includes('function toggleTaskStatusEditMenu()'), true, 'o lapis deve abrir as correcoes de estado');
    assert.equal(tasks.includes('function positionTaskStatusEditMenu()'), true, 'as correcoes devem abrir junto ao lapis');
    assert.equal(tasks.includes("runTaskDetailAction('start')"), true, 'detalhes pendentes devem permitir iniciar');
    assert.equal(tasks.includes("runTaskDetailAction('complete')"), true, 'detalhes devem permitir concluir');
    assert.equal(tasks.includes('const procedure = item.procedimento'), false, 'o historico nao deve repetir o procedimento');
    assert.equal(css.includes('.task-detail-status.running { color: #733fa0; }'), true, 'Em execucao deve aparecer em roxo');
    assert.equal(app.includes("let destinoConfiguracoes = 'painel'"), true, 'o painel deve lembrar de onde as configuracoes foram abertas');
    assert.equal(app.includes("destinoConfiguracoes === 'tasks'"), true, 'as configuracoes de atividades devem voltar ao modulo');
    assert.equal(css.includes('background: rgba(238, 87, 87, .14)'), true);
    assert.equal(css.includes('background: rgba(126, 78, 166, .13)'), true);
    assert.equal(css.includes('background: rgba(42, 157, 127, .12)'), true);
    assert.equal(html.includes('id="areaPickerOptions"'), true, 'o KDS deve usar seletor de area com emojis');
    assert.equal(app.includes('function selecionarAreaCabecalho(areaId)'), true, 'o seletor visual deve trocar a area');
    assert.equal(ui.includes('global.AloUiDialog'), true, 'dialogos do app devem substituir caixas do navegador');
    assert.equal(ui.includes("classList.toggle('compact'"), true, 'confirmacoes curtas devem usar o modo compacto');
    assert.equal(tasks.includes("confirmText: 'Confirmar', compact: true"), true, 'nao realizada deve ter confirmacao enxuta');
    assert.equal(tasks.includes("className: 'running'"), true, 'separadores devem receber estado visual');
    assert.equal(app.includes("title.textContent = 'Trocar área'"), true, 'seletor do KDS deve identificar a troca de area');
    assert.equal(app.includes("role.textContent = area.tipo === 'recebimento'"), true, 'seletor do KDS deve explicar a funcao da area');
    assert.equal(tasks.includes('function getTaskSchedules(task)'), true, 'tarefas antigas devem migrar para programacoes');
    assert.equal(tasks.includes('getTaskSchedules(task).forEach((schedule, index)'), true, 'uma tarefa deve gerar varias ocorrencias no dia');
    assert.equal(tasks.includes("recorrencia === 'intervalo_meses'"), true, 'frequencias longas devem atender higienizacao semestral');
    assert.equal(tasks.includes('function openScheduleEditor(index = -1)'), true, 'cadastro deve permitir varios horarios');
    assert.equal(tasks.includes('＋ Cadastrar horário'), true);
    assert.equal(tasks.includes('isNewTask ? [] : getTaskSchedules(task)'), true, 'tarefa nova nao pode ganhar horario automatico');
    assert.equal(tasks.includes("horario: '', recorrencia: ''"), true, 'novo horario deve exigir escolhas explicitas');
    assert.equal(tasks.includes('>4 meses</option>'), true, 'a frequencia deve oferecer intervalo de quatro meses');
    assert.equal(tasks.includes('Você pode cadastrar manhã, noite ou dias diferentes.'), false, 'microcopy redundante deve ser removida');
    assert.equal(tasks.includes('Mostre como o prato, o salão ou a montagem deve ficar.'), false, 'a foto nao precisa de texto auxiliar redundante');
    assert.equal(html.includes('Atividade no horário'), false, 'o alarme deve destacar apenas a tarefa e seus dados');
    assert.equal(tasks.includes('task-toggle-row task-alarm-toggle'), true, 'o alarme deve usar switch moderno');
    assert.equal((tasks.match(/class="task-toggle-row"/g) || []).length >= 3, true, 'as opcoes da tarefa devem usar switches modernos');
    const tasksSettings = html.slice(html.indexOf('id="modalConfigTasksMenu"'), html.indexOf('id="modalTaskHygieneLibrary"'));
    const taskManager = html.slice(html.indexOf('id="modalTasksManager"'), html.indexOf('id="modalTaskForm"'));
    assert.equal(tasksSettings.includes('Modelos Sanitários'), false, 'modelos nao devem ficar soltos nas configuracoes');
    assert.equal(taskManager.includes('Modelos Sanitários'), true, 'modelos devem ficar dentro de Gerenciar Tarefas');
    assert.equal(html.includes('Setores do Estabelecimento'), true, 'setores devem representar o estabelecimento inteiro');
    assert.equal(tasksSettings.includes('👤 Funcionários'), false, 'funcionarios nao devem ficar soltos nas configuracoes');
    assert.equal(taskManager.includes('id="tasksManagerEmployees"'), true, 'funcionarios devem ficar dentro dos setores');
    assert.equal(tasks.includes("managerType === 'employees'"), true, 'voltar de funcionarios deve retornar aos setores');
    assert.equal(tasks.includes('onfocus="this.select()" onclick="this.select()"'), true, 'tempo esperado deve selecionar o valor ao receber foco');
    assert.equal(tasks.includes('function adjustHeaderAreaName'), true, 'Checklist deve adaptar nomes longos de setor');
    assert.equal(app.includes('function ajustarNomeAreaCabecalho'), true, 'KDS deve usar o mesmo ajuste de nomes longos');
    assert.equal(css.includes('--area-name-size-mobile'), true, 'o tamanho adaptativo deve funcionar no celular');
    assert.equal(css.includes('.tasks-area-picker { width: fit-content;'), true, 'o seletor do Checklist deve ser compacto e adaptavel');
    assert.equal(css.includes('#mainHeader .header-area-picker { width: fit-content;'), true, 'o KDS deve manter o seletor compacto');
    assert.equal(css.includes('max-width: min(260px, 100%)'), true, 'nomes longos devem ter espaco adicional sem alargar nomes curtos');
    assert.equal(css.includes('height: min(760px, 92vh)'), true, 'a biblioteca sanitaria nao deve mudar a posicao superior ao filtrar');
    assert.equal(css.includes('align-content: start'), true, 'somente a lista dos modelos deve variar de altura');
    assert.equal(app.includes("const STORAGE_KDS_SELECTED_AREA = 'alo_kds_selected_area_v1'"), true, 'o setor do KDS deve ser local ao equipamento');
    assert.equal(app.includes('localStorage.setItem(STORAGE_KDS_SELECTED_AREA, area.id)'), true, 'a troca de setor do KDS deve ser lembrada localmente');
    assert.equal(tasks.includes("const STORAGE_SELECTED_AREA = 'alo_tasks_selected_area_v2'"), true, 'o Checklist deve guardar seu setor localmente');
    assert.equal(tasks.includes('matchingArea'), false, 'KDS e Checklist nao devem associar setores automaticamente');
    assert.equal(tasks.includes("let selectedArea = localStorage.getItem(STORAGE_SELECTED_AREA) || 'todos'"), true, 'o Checklist deve manter uma preferencia local independente');
    assert.equal(html.includes('↩ Voltar para pendente'), true, 'a correcao de estado deve explicar seu efeito');
    assert.equal(tasks.includes("choices.classList.toggle('single-action', !isFinished)"), true, 'o menu com uma unica correcao deve ficar compacto');
    assert.equal(css.includes('.task-finished-choices.single-action { width: min(180px'), true, 'o botao isolado deve manter o tamanho de uma opcao');
    assert.equal((html.match(/class="header-area-chevron" aria-hidden="true">▾/g) || []).length, 3, 'KDS, Checklist e Compras devem usar o mesmo indicador de abertura');
    assert.equal(html.includes('>⌄</span>'), false, 'o indicador antigo deve ser removido');
    assert.equal(html.includes('<span>✓</span> Concluído'), true, 'o alarme deve usar Concluído');
    assert.equal(tasks.includes('✓ Concluído</button>'), true, 'os botoes das tarefas devem usar Concluído');
    assert.equal(html.includes('id="taskHygieneFilters"'), true, 'modelos sanitarios devem possuir filtros objetivos');
    assert.equal(tasks.includes('function setHygieneGroup(group)'), true, 'os filtros sanitarios devem ser funcionais');
    assert.equal(templates.includes('triagem_saude_manipuladores'), true, 'RDC 216 exige controle de saude dos manipuladores');
    assert.equal(templates.includes('inspecionar_pragas'), true, 'RDC 216 exige controle integrado de pragas');
    assert.equal(templates.includes('manejar_residuos'), true, 'RDC 216 exige manejo de residuos');
    assert.equal(templates.includes('revisar_manual_pops'), true, 'RDC 216 exige Manual de Boas Praticas e POPs');
    assert.equal((templates.match(/group: '/g) || []).length >= 20, true, 'a biblioteca deve cobrir os principais controles sanitarios');
    assert.equal(html.includes('Revise produtos, responsáveis e horários antes de usar.'), false, 'a biblioteca nao deve abrir com microcopy redundante');
    assert.equal(html.includes('task-alarm-switch'), false, 'alarme gigante deve sair do formulario principal');
    assert.equal(html.includes('id="modalTaskHygieneLibrary"'), true);
    assert.equal(templates.includes('higienizar_reservatorio'), true);
    assert.equal(templates.includes('tempo de contato do fabricante'), true);
    assert.equal(tasks.includes('function compressTaskPhoto(file)'), true);
    assert.equal(gas.includes("action === 'salvar_foto_tarefa'"), true);
    assert.equal(html.includes('id="modalTaskQr"'), true);
    assert.equal(tasks.includes("url.searchParams.set('consulta', 'tarefa')"), true);
    assert.equal(tasks.includes('function openPublicTaskFromUrl()'), true);
    assert.equal(gas.includes("'ProcedimentoFormato', 'ProgramacaoId'"), true);
    const appWithoutDialogApi = app.replaceAll('AloUiDialog.confirm(', '').replaceAll('AloUiDialog.prompt(', '');
    const tasksWithoutDialogApi = tasks.replaceAll('global.AloUiDialog.confirm(', '');
    assert.equal(/\bconfirm\(/.test(appWithoutDialogApi) || /\bprompt\(/.test(appWithoutDialogApi) || /\bconfirm\(/.test(tasksWithoutDialogApi), false, 'nao pode restar dialogo nativo');
}

function testAudioMode() {
    let playCount = 0;
    let playerLoop = false;
    const classes = new Set();
    class FakeAudio {
        constructor() { this.paused = true; this.src = ''; this._loop = false; this.currentTime = 0; }
        set loop(value) { this._loop = Boolean(value); playerLoop = this._loop; }
        get loop() { return this._loop; }
        play() { this.paused = false; playCount += 1; return Promise.resolve(); }
        pause() { this.paused = true; }
    }
    const header = { classList: { add: value => classes.add(value), remove: (...values) => values.forEach(value => classes.delete(value)) } };
    const context = vm.createContext({
        console,
        Audio: FakeAudio,
        Math,
        Date,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        navigator: {},
        document: { getElementById: id => id === 'mainHeader' ? header : null },
        AloLogic: { isToday: () => true }
    });
    context.window = context;
    loadScript(context, 'modules/kds/audio.js');
    context.AloAudio.manage({
        mode: 'cozinha',
        configs: { somCozinha: 'alarme', volumeCozinha: 100 },
        orders: [{ id: '4', status: 'pendente', timestamp: new Date().toISOString() }],
        knownIds: new Set()
    });
    assert.equal(classes.has('alerta-pisca'), true);
    assert.equal(playCount, 1);
    assert.equal(playerLoop, true, 'o alarme da cozinha deve continuar ate o pedido ser aceito');
    context.AloAudio.stop();

    context.AloAudio.manage({
        mode: 'cozinha',
        configs: { somCozinha: 'sem_som', volumeCozinha: 100 },
        orders: [{ id: '4', status: 'pendente', timestamp: new Date().toISOString() }],
        knownIds: new Set()
    });
    assert.equal(classes.has('alerta-pisca'), true, 'sem som deve manter o aviso visual da cozinha');
    assert.equal(playCount, 1, 'sem som nao deve reproduzir audio na cozinha');
    context.AloAudio.stop();

    const finalizedAt = new Date().toISOString();
    context.AloAudio.manage({
        mode: 'panelas',
        configs: { somPanelas: 'sem_som', volumePanelas: 70 },
        orders: [{ id: '5', status: 'cancelado', finalizadoEm: finalizedAt }],
        knownIds: new Set()
    });
    assert.equal(classes.has('alerta-pisca-buscar'), true);
    assert.equal(playCount, 2, 'cancelamento novo deve beepar mesmo com o som comum desativado');
    assert.equal(playerLoop, true, 'o aviso das panelas deve continuar até alguém confirmar');

    context.AloAudio.manage({
        mode: 'panelas',
        configs: { somPanelas: 'beep', volumePanelas: 70 },
        orders: [{ id: '5', status: 'cancelado', finalizadoEm: finalizedAt }],
        knownIds: new Set()
    });
    assert.equal(playCount, 2, 'a sincronizacao nao deve reiniciar o mesmo aviso');
    assert.equal(classes.has('alerta-pisca-buscar'), true, 'o alerta visual deve continuar ate a ciencia');
    assert.equal(playerLoop, true, 'o beep deve permanecer em loop enquanto a retirada não for confirmada');

    context.AloAudio.manage({
        mode: 'panelas',
        configs: { somPanelas: 'sem_som', volumePanelas: 70 },
        orders: [{ id: '5', status: 'cancelado', finalizadoEm: finalizedAt }],
        knownIds: new Set(['5'])
    });
    assert.equal(classes.has('alerta-pisca-buscar'), false);
    assert.equal(playerLoop, false, 'a ciência deve encerrar imediatamente o áudio contínuo');

    context.AloAudio.manage({
        mode: 'panelas',
        configs: { somPanelas: 'beep', volumePanelas: 70 },
        orders: [{ id: 'outro-aparelho', status: 'buscar', finalizadoEm: finalizedAt, alertaReconhecidoEm: new Date().toISOString() }],
        knownIds: new Set()
    });
    assert.equal(classes.has('alerta-pisca-buscar'), false, 'a ciência recebida de outro aparelho deve encerrar o alerta');

    context.AloAudio.manage({
        mode: 'panelas',
        configs: { somPanelas: 'sem_som', volumePanelas: 70 },
        orders: [{ id: '6', status: 'buscar', finalizadoEm: new Date().toISOString() }],
        knownIds: new Set()
    });
    assert.equal(classes.has('alerta-pisca-buscar'), true, 'sem som deve manter o aviso visual das panelas');
    assert.equal(playCount, 2, 'sem som nao deve reproduzir audio ao mandar buscar');
    context.AloAudio.stop();
}

async function testCatalogAutoPublish() {
    let revision = 4;
    let postCount = 0;
    let remote = { _revision: revision, produtos: [], categorias: [], obsPedidos: [], obsCancelamentos: [], areas: [], setoresTarefas: [], funcionarios: [], tarefas: [], configsTarefas: {}, configs: {} };
    let conflict = false;
    const context = vm.createContext({ console, setTimeout, clearTimeout });
    context.window = context;
    loadScript(context, 'core/catalog-sync.js');

    const api = {
        async getBank() { return JSON.parse(JSON.stringify(remote)); },
        async post(url, payload) {
            postCount += 1;
            if (conflict) {
                revision += 1;
                remote = { ...remote, _revision: revision, produtos: [{ nome: 'Outro aparelho' }] };
                return;
            }
            revision += 1;
            remote = { ...JSON.parse(JSON.stringify(payload.dados)), _revision: revision };
        }
    };
    const data = {
        produtos: [{ nome: 'Feijão' }], categorias: [], obsPedidos: [], obsCancelamentos: [], areas: [],
        setoresTarefas: [], funcionarios: [], tarefas: [], configsTarefas: {}, configs: { volumeCozinha: '100' }
    };

    const published = await context.AloCatalogSync.publish({ api, url: 'https://server.test', data, wait: async () => {} });
    assert.equal(published.confirmed, true);
    assert.equal(published.revision, 5);
    assert.equal(postCount, 1);

    const alreadyCurrent = await context.AloCatalogSync.publish({ api, url: 'https://server.test', data, wait: async () => {} });
    assert.equal(alreadyCurrent.confirmed, true);
    assert.equal(alreadyCurrent.sent, false);
    assert.equal(postCount, 1);

    const withSharedCore = { ...data, coreCompartilhado: { people: [{ id: 'p1' }], revision: 1 } };
    const compatibleOldBackend = await context.AloCatalogSync.publish({ api, url: 'https://server.test', data: withSharedCore, wait: async () => {} });
    assert.equal(compatibleOldBackend.confirmed, true, 'backend antigo não deve prender a publicação do cardápio');
    assert.equal(compatibleOldBackend.sent, false);
    assert.equal(remote.coreCompartilhado, undefined);

    remote._capabilities = { dadosCompartilhados: true };
    const publishedSharedCore = await context.AloCatalogSync.publish({ api, url: 'https://server.test', data: withSharedCore, wait: async () => {} });
    assert.equal(publishedSharedCore.confirmed, true);
    assert.equal(remote.coreCompartilhado.people[0].id, 'p1', 'backend atualizado deve receber a identidade central');

    conflict = true;
    const changedData = { ...data, produtos: [{ nome: 'Arroz' }] };
    const conflicted = await context.AloCatalogSync.publish({ api, url: 'https://server.test', data: changedData, wait: async () => {} });
    assert.equal(conflicted.confirmed, false);
}

function testComprasHasIndependentOperationalPermissions() {
    const context = vm.createContext({ console, Date, Map, Set });
    loadScript(context, 'modules/compras/src/scripts/domain.js');

    const somenteReceber = { receber: true, comprar: false };
    const somenteComprar = { receber: false, comprar: true };
    const pendente = { idUnico: 'pendente', status: 'pendente', excluido: false };
    const aguardandoEntrega = { idUnico: 'fornecedor', status: 'pedido_forn', excluido: false };

    assert.equal(context.AloFeiraDomain.aplicarTransicao({ ...pendente }, 'comprado', 10, somenteReceber).ok, false);
    assert.equal(context.AloFeiraDomain.aplicarTransicao({ ...pendente }, 'pedido_forn', 10, somenteReceber).ok, false);
    assert.equal(context.AloFeiraDomain.aplicarTransicao({ ...aguardandoEntrega }, 'entregue', 10, somenteReceber).ok, true);
    assert.equal(context.AloFeiraDomain.aplicarTransicao({ ...pendente }, 'pedido_forn', 10, somenteComprar).ok, true);
    assert.equal(context.AloFeiraDomain.aplicarTransicao({ ...aguardandoEntrega }, 'entregue', 10, somenteComprar).ok, false);
}

function testComprasUsesUnifiedHost() {
    const storage = new Map([
        ['kds_banco', '{"produtos":[{"nome":"Feijão"}]}'],
        ['kds_pedidos_local', '[{"id":"pedido-kds"}]']
    ]);
    const frame = {
        dataset: { src: 'modules/compras/index.html?v=2.1.31' },
        getAttribute() { return ''; },
        setAttribute() {},
        addEventListener() {}
    };
    const context = vm.createContext({
        console,
        Date,
        JSON,
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, value); }
        },
        document: {
            getElementById(id) { return id === 'feiraFrame' ? frame : null; },
            addEventListener() {},
            querySelector() { return null; },
            querySelectorAll() { return []; }
        }
    });
    context.window = context;
    loadScript(context, 'modules/compras/host.js');
    context.AloFeiraModule.configure({ getServerUrl: () => 'https://script.google.com/macros/s/unificado/exec' });

    const feira = JSON.parse(storage.get('alofeira_v1'));
    assert.equal(feira.configs.url, 'https://script.google.com/macros/s/unificado/exec');
    assert.equal(feira.app_id, 'alofeira');
    assert.equal(storage.get('kds_banco'), '{"produtos":[{"nome":"Feijão"}]}');
    assert.equal(storage.get('kds_pedidos_local'), '[{"id":"pedido-kds"}]');
    assert.equal(context.AloFeiraModule.importBackup, undefined, 'a importação temporária não deve continuar exposta');
    assert.equal(typeof context.AloFeiraModule.prepareLogin, 'function', 'o host deve carregar os operadores para o login único');
    assert.equal(typeof context.AloFeiraModule.authenticateOperator, 'function', 'o host deve validar o operador no banco de Compras');
    assert.equal(typeof context.AloFeiraModule.logout, 'function', 'o host deve encerrar a sessão ao sair de Compras');
    assert.equal(typeof context.AloFeiraModule.getBackup, 'function', 'Compras deve participar do backup completo');
    assert.equal(typeof context.AloFeiraModule.restoreBackup, 'function', 'Compras deve participar da restauração única');
}

function testV217ModuleArchitecture() {
    const views = new Map([
        ['moduleHome', { style: {} }],
        ['kdsModule', { style: {} }],
        ['tasksModule', { style: {} }],
        ['feiraModule', { style: {} }],
        ['l42Module', { style: {} }]
    ]);
    const closedSessions = [];
    const context = vm.createContext({
        console,
        CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        document: {
            getElementById(id) { return views.get(id) || null; },
            dispatchEvent() {}
        },
        encerrarSessaoModulo(module) { closedSessions.push(module); }
    });
    context.window = context;
    loadScript(context, 'core/module-host.js');
    loadScript(context, 'core/data-contracts.js');
    loadScript(context, 'modules/kds/module.js');
    loadScript(context, 'modules/checklist/module.js');
    loadScript(context, 'modules/compras/module.js');
    loadScript(context, 'modules/l42/module.js');

    assert.deepEqual(Array.from(context.AloModuleHost.list(), module => module.id), ['kds', 'checklist', 'compras', 'l42']);
    context.AloModuleHost.open('tasks');
    assert.equal(views.get('tasksModule').style.display, 'flex', 'o alias antigo deve abrir o Checklist pelo host');
    assert.equal(views.get('kdsModule').style.display, 'none');
    context.AloModuleHost.open('feira');
    assert.equal(views.get('feiraModule').style.display, 'flex', 'o alias antigo deve abrir Compras pelo host');
    context.AloModuleHost.showHome();
    assert.equal(views.get('moduleHome').style.display, 'flex');
    context.AloModuleHost.open('l42');
    assert.equal(views.get('l42Module').style.display, 'flex', 'o L42 deve abrir como módulo independente');
    context.AloModuleHost.showHome();
    assert.deepEqual(closedSessions, ['compras', 'l42'], 'o host deve encerrar a sessão do módulo protegido ao sair');

    const contracts = context.AloDataContracts.describe();
    assert.equal(contracts.appVersion, '2.1.31');
    assert.equal(context.AloDataContracts.get('kds').localStorage.includes('kds_v1_db'), true);
    assert.equal(context.AloDataContracts.get('checklist').localStorage.includes('alo_tasks_outbox_v2'), true);
    assert.equal(context.AloDataContracts.get('compras').localStorage.includes('alofeira_v1'), true);
    assert.equal(context.AloDataContracts.get('l42').localStorage.includes('etiquetadora_db'), true);

    [
        'core/api.js', 'core/catalog-sync.js', 'core/ui-dialog.js', 'core/shared-data.js',
        'modules/kds/app.js', 'modules/kds/sync.js',
        'modules/checklist/app.js', 'modules/checklist/styles.css',
        'modules/compras/index.html', 'modules/compras/host.js',
        'modules/l42/index.html', 'modules/l42/host.js', 'modules/l42/module.js',
        'android/app/src/main/java/com/aloetiqueta/l42/MainActivity.java'
    ].forEach(file => assert.equal(fs.existsSync(path.join(root, file)), true, `${file} deve existir`));
    ['app.js', 'tasks.js', 'sync.js', 'api.js', 'feira-module.js', 'modules/alo-feira/index.html']
        .forEach(file => assert.equal(fs.existsSync(path.join(root, file)), false, `${file} não deve continuar duplicado na raiz`));

    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const shellCache = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
    assert.equal(html.includes('core/module-host.js?v=2.1.31'), true);
    assert.equal(html.includes('core/shared-data.js?v=2.1.31'), true);
    assert.equal(html.includes('modules/compras/index.html?embedded=1&amp;v=2.1.31'), true);
    assert.equal(html.includes('modules/l42/index.html?embedded=1&amp;v=2.1.31'), true);
    assert.equal(html.includes('modules/l42/icon.png?v=2.1.31'), true);
    assert.equal(shellCache.includes('./modules/checklist/app.js?v=2.1.31'), true);
    assert.equal(shellCache.includes('./core/shared-data.js?v=2.1.31'), true);
    assert.equal(shellCache.includes('./modules/compras/index.html'), true);
    assert.equal(shellCache.includes('./modules/l42/index.html'), true);
    assert.equal(fs.existsSync(path.join(root, 'modules', 'l42', 'icon.png')), true);
    const l42Html = fs.readFileSync(path.join(root, 'modules', 'l42', 'index.html'), 'utf8');
    const l42Host = fs.readFileSync(path.join(root, 'modules', 'l42', 'host.js'), 'utf8');
    assert.equal(l42Html.includes("parent.postMessage({source:'alo-l42',type:'ready'}"), true, 'o iframe deve avisar quando está pronto');
    assert.equal(l42Host.includes("global.receberQrsNativos"), true, 'o retorno da câmera nativa deve alcançar o iframe');
    assert.equal(l42Host.includes("global.receberLinkAutenticacaoSupabase"), true, 'o deep link Supabase deve alcançar o iframe');
    assert.equal(html.indexOf('core/module-host.js') < html.indexOf('modules/kds/module.js'), true, 'o núcleo deve carregar antes dos módulos');
}

function testV219UnifiedPeopleAndDataHub() {
    const shared = fs.readFileSync(path.join(root, 'core', 'shared-data.js'), 'utf8');
    const checklist = fs.readFileSync(path.join(root, 'modules', 'checklist', 'app.js'), 'utf8');
    const compras = fs.readFileSync(path.join(root, 'modules', 'compras', 'src', 'scripts', 'app.js'), 'utf8');
    const l42 = fs.readFileSync(path.join(root, 'modules', 'l42', 'index.html'), 'utf8');
    const l42Cloud = fs.readFileSync(path.join(root, 'modules', 'l42', 'cloud.js'), 'utf8');
    const kds = fs.readFileSync(path.join(root, 'modules', 'kds', 'app.js'), 'utf8');
    const checklistStyles = fs.readFileSync(path.join(root, 'modules', 'checklist', 'styles.css'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const shellCache = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
    const gas = fs.readFileSync(path.join(root, 'google-apps-script.gs'), 'utf8');
    const etiquetasSave = gas.slice(gas.indexOf('function salvarEtiquetasBanco_'), gas.indexOf('function handleEtiquetasGet_'));

    assert.equal(shared.includes('function hasProtectedAccess(person)'), true, 'login deve ser derivado somente de acessos protegidos');
    assert.equal(shared.includes('person.permissions.checklist.funcionario'), true, 'funcionário deve ser independente do login');
    assert.equal(shared.includes('person.podeEntrar === true && personCanUse(person, purpose)'), true, 'somente acessos habilitados para o módulo podem aparecer no login');
    assert.equal(shared.includes("person.credentials = { alternatives: [] }"), false, 'desligar o login não deve destruir o PIN criptografado');
    assert.equal(shared.includes('async function getUnifiedData()'), true, 'o núcleo deve expor os dados dos módulos por um único hub');
    assert.equal(shared.includes('await adapter?.applyPeople?.(clone(state.people))'), true, 'o módulo deve receber os acessos centrais antes de abrir a sessão');
    assert.equal(checklist.includes('global.AloSharedData.openManager()'), true, 'o Checklist deve usar o cadastro central de pessoas');
    assert.equal(compras.includes('const acessos = recebidas.filter'), true, 'funcionários sem login não devem virar operadores de Compras');
    assert.equal(l42.includes("window.parent.AloSharedData.openManager()"), true, 'o L42 deve abrir o cadastro central de pessoas');
    assert.equal(gas.includes('coreCompartilhado: valorEnviadoOuAtual'), true, 'a identidade compartilhada deve ser persistida no backend atual');
    assert.equal(html.includes('Configurações Etiquetas'), true, 'Etiquetas deve ter configurações no painel central');
    assert.equal(html.includes('Pode entrar no aplicativo'), false, 'o formulário não deve expor um controle de login redundante');
    assert.equal(html.includes('Cadastro ativo'), false, 'ativar e desativar deve ser uma ação do cadastro');
    assert.equal(html.includes('id="sharedPersonComprasReceive"'), true, 'Compras deve manter permissão para receber');
    assert.equal(html.includes('id="sharedPersonComprasBuy"'), true, 'Compras deve manter permissão para comprar');
    assert.equal(html.includes('id="sharedPersonComprasCategories"'), true, 'Compras deve manter permissões por categoria');
    assert.equal(html.includes('id="sharedPersonLabelsConfig"'), true, 'Etiquetas deve controlar somente o acesso à engrenagem');
    assert.equal(html.indexOf('sharedPersonEmployee') < html.indexOf('sharedPersonAdmin'), true, 'Administrador deve aparecer abaixo de Funcionário');
    assert.equal(l42.includes('1999'), false, 'Etiquetas não deve manter uma senha administrativa fixa no código');
    assert.equal(kds.includes("destinoLoginOperador === 'etiquetas' && sessaoPodeConfigurarEtiquetas"), true, 'a sessão autorizada de Etiquetas deve abrir suas configurações sem novo login');
    assert.match(checklistStyles, /\.module-home\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?z-index:\s*700;[\s\S]*?display:\s*flex;/, 'a tela de módulos deve nascer centralizada no desktop');
    assert.equal(checklistStyles.includes('overflow-y: auto;'), true, 'a tela de módulos deve rolar em celulares baixos');
    assert.equal(checklistStyles.includes('touch-action: pan-y;'), true, 'a tela de módulos deve aceitar o deslizamento vertical por toque');
    assert.match(l42, /if\(!window\.ALO_L42_EMBEDDED\)\s*\{\s*iniciarSupabaseApp\(\)/, 'o módulo incorporado não deve iniciar um segundo backend');
    assert.equal(l42.includes("window.parent.AloL42Module?.backToSettings?.()"), true, 'as configurações incorporadas devem voltar ao painel central');
    assert.equal(l42Cloud.includes("action: 'salvar_etiquetas_banco'"), true, 'Etiquetas deve salvar no backend unificado');
    assert.equal(l42Cloud.includes("url.searchParams.set('action', 'carregar_etiquetas_banco')"), true, 'Etiquetas deve carregar do backend unificado');
    assert.equal(l42Cloud.includes('expectedRevision'), true, 'Etiquetas deve usar controle otimista de revisão');
    assert.equal(gas.includes("SHEET_ETIQUETAS_BANCO = 'Etiquetas - Banco'"), true, 'o Apps Script deve reservar armazenamento próprio para Etiquetas');
    assert.equal(gas.includes('Utilities.gzip'), true, 'o banco de Etiquetas deve ser compactado antes da gravação');
    assert.equal(gas.includes("Utilities.newBlob(compressed, 'application/x-gzip', 'etiquetas.json.gz')"), true, 'a descompactação deve receber um blob gzip válido');
    assert.equal(gas.includes('PROP_ETIQUETAS_ACTIVE_SLOT'), true, 'a troca do banco deve usar slots atômicos');
    assert.equal(gas.includes('const fallbackSlot = slot === \'A\' ? \'B\' : \'A\';'), true, 'a leitura deve recuperar o slot anterior se o ativo estiver corrompido');
    assert.equal(etiquetasSave.includes('sheet.clearContents()'), false, 'a gravação não pode apagar o slot confirmado antes de validar o novo');
    assert.equal(etiquetasSave.includes('limparEtiquetasSlot_(sheet, nextSlot)'), true, 'somente o slot inativo deve ser preparado para a nova gravação');
    assert.equal(gas.includes("action === 'salvar_etiquetas_banco'"), true, 'o Apps Script deve aceitar gravação de Etiquetas');
    assert.equal(shellCache.includes('./modules/l42/cloud.js?v=2.1.31'), true, 'a sincronização de Etiquetas deve funcionar offline após o primeiro carregamento');
}

async function testEmployeeCanExistWithoutLogin() {
    const storage = new Map();
    const database = {
        funcionarios: [{ id: 'func_maria', nome: 'Maria', setorId: 'cozinha', ativo: true }],
        produtos: [],
        categorias: []
    };
    const context = vm.createContext({
        console,
        Date,
        Map,
        Set,
        Promise,
        JSON,
        CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, value); }
        },
        document: { dispatchEvent() {} }
    });
    context.window = context;
    loadScript(context, 'core/shared-data.js');
    context.AloSharedData.configure({ getDatabase: () => database, markDatabaseChanged() {} });
    await context.AloSharedData.refreshSources({ includeFrames: false, push: false });

    const shared = context.AloSharedData.getBackup();
    assert.equal(shared.people.length, 1);
    assert.equal(shared.people[0].nome, 'Maria');
    assert.equal(shared.people[0].permissions.checklist.funcionario, true, 'Maria deve continuar disponível como funcionária');
    assert.equal(shared.people[0].podeEntrar, false, 'ser funcionária não deve habilitar login automaticamente');
    assert.equal((await context.AloSharedData.listLoginPeople()).length, 0, 'funcionário sem acesso não pode aparecer no login');
}

async function testLoginPeopleAreFilteredByModule() {
    const storage = new Map();
    const context = vm.createContext({
        console,
        Date,
        Map,
        Set,
        Promise,
        JSON,
        CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, value); }
        },
        document: { dispatchEvent() {} }
    });
    context.window = context;
    loadScript(context, 'core/shared-data.js');
    context.AloSharedData.configure({ getDatabase: () => ({ produtos: [], categorias: [], funcionarios: [] }), markDatabaseChanged() {} });
    await context.AloSharedData.restoreBackup({
        people: [
            { id: 'maria', nome: 'Maria', permissions: { checklist: { funcionario: true } } },
            { id: 'joao', nome: 'João', permissions: { compras: { acesso: true } } },
            { id: 'bia', nome: 'Bia', permissions: { l42: { acesso: true } } },
            { id: 'ana', nome: 'Ana', isAdmin: true }
        ]
    });

    assert.deepEqual(Array.from(await context.AloSharedData.listLoginPeople(), person => person.id).sort(), ['ana', 'bia', 'joao']);
    assert.deepEqual(Array.from(await context.AloSharedData.listLoginPeople('compras'), person => person.id).sort(), ['ana', 'joao']);
    assert.deepEqual(Array.from(await context.AloSharedData.listLoginPeople('l42'), person => person.id).sort(), ['ana', 'bia']);
    assert.deepEqual(Array.from(await context.AloSharedData.listLoginPeople('painel'), person => person.id), ['ana']);
    const admin = context.AloSharedData.getBackup().people.find(person => person.id === 'ana');
    assert.equal(admin.permissions.compras.acesso, true, 'administrador deve aparecer com Compras habilitado');
    assert.equal(admin.permissions.l42.acesso, true, 'administrador deve aparecer com Etiquetas habilitado');
}

function testV2110AccessSyncAndApkPolish() {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
    const shared = fs.readFileSync(path.join(root, 'core', 'shared-data.js'), 'utf8');
    const comprasCore = fs.readFileSync(path.join(root, 'modules', 'compras', 'src', 'scripts', 'core.js'), 'utf8');
    const comprasActions = [
        'modules/compras/src/scripts/orders.js',
        'modules/compras/src/scripts/purchases.js',
        'modules/compras/src/scripts/purchase-details.js'
    ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
    const comprasStyles = fs.readFileSync(path.join(root, 'modules', 'checklist', 'styles.css'), 'utf8');
    const l42 = fs.readFileSync(path.join(root, 'modules', 'l42', 'index.html'), 'utf8');
    const l42Cloud = fs.readFileSync(path.join(root, 'modules', 'l42', 'cloud.js'), 'utf8');
    const shellCache = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
    const kds = fs.readFileSync(path.join(root, 'modules', 'kds', 'app.js'), 'utf8');
    const androidMain = fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'aloetiqueta', 'l42', 'MainActivity.java'), 'utf8');
    const androidBuild = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
    const apkScript = fs.readFileSync(path.join(root, 'build-apk.ps1'), 'utf8');
    const emojiCatalog = shared.slice(shared.indexOf('const PERSON_EMOJIS'), shared.indexOf('];', shared.indexOf('const PERSON_EMOJIS')) + 2);

    assert.equal(html.includes('Abrir Configurações KDS'), true);
    assert.equal(html.includes('Abrir Configurações Checklist'), true);
    assert.equal(html.includes('Abrir Configurações Etiquetas'), true);
    assert.equal(html.includes('🛒 Receber no modo Compras'), false, 'as permissões de Compras não devem ganhar emojis avulsos');
    assert.equal(html.includes('🧾 Comprar no modo Compras'), false, 'as permissões de Compras não devem ganhar emojis avulsos');
    assert.equal(html.includes('id="sharedPersonEmojiGrid"'), true, 'o seletor de pessoa deve usar uma grade compacta');
    assert.equal(emojiCatalog.includes('🧹') || emojiCatalog.includes('🏍') || emojiCatalog.includes('📄'), false, 'a grade deve conter apenas pessoas e funções');
    assert.equal(styles.includes('#sharedPersonActiveAction.btn-action { background: #238636; }'), true, 'Ativar deve ser verde');
    assert.equal(styles.includes('.shared-person-actions button { align-items: center; justify-content: center; text-align: center; }'), true, 'os botões de estado devem centralizar o texto');

    assert.equal(comprasCore.includes('if(colabLogado.isAdmin) return null'), false, 'administrador também deve respeitar categorias habilitadas');
    assert.equal(comprasCore.includes('function podeUsarProdutoCompras'), true);
    assert.equal((comprasActions.match(/podeUsarProdutoCompras/g) || []).length >= 6, true, 'entrada, edição e compra devem validar a categoria');
    assert.equal(comprasStyles.includes('max-width: clamp(76px, calc(100vw - 266px), 138px)'), true, 'o nome do operador deve ocupar o espaço móvel disponível');

    assert.equal(l42.includes("className='app-sync-indicator local'"), true, 'Etiquetas deve usar o mesmo indicador dos módulos');
    assert.equal(l42.includes("parent.AloEtiquetasCloud?.sync?.()"), true, 'a bolinha de Etiquetas deve permitir nova sincronização');
    assert.equal(l42Cloud.includes('O Google Apps Script atual ainda não aceita a sincronização de Etiquetas'), true, 'backend antigo deve produzir um erro útil');
    assert.equal(l42.includes('assets/qr-reader.svg?v=2.1.31'), true);
    assert.equal(l42.includes('assets/printer-controls.svg?v=2.1.31'), true);
    assert.equal(fs.existsSync(path.join(root, 'modules', 'l42', 'assets', 'qr-reader.svg')), true);
    assert.equal(fs.existsSync(path.join(root, 'modules', 'l42', 'assets', 'printer-controls.svg')), true);
    assert.equal(shellCache.includes('./modules/l42/assets/qr-reader.svg?v=2.1.31'), true);
    assert.equal(shellCache.includes('./modules/l42/assets/printer-controls.svg?v=2.1.31'), true);

    assert.equal(kds.includes('AloL42Module.getBackup()'), true, 'o backup único deve coletar Etiquetas');
    assert.match(kds, /\n\s+l42,\r?\n/, 'o arquivo completo deve conter a seção Etiquetas');
    assert.equal(androidMain.includes('webView.loadUrl("file:///android_asset/index.html")'), true, 'o APK deve abrir os arquivos empacotados');
    assert.equal(androidMain.includes('WebView.OVER_SCROLL_NEVER'), true, 'o APK não deve atualizar por gesto de puxar');
    assert.equal(styles.includes('overscroll-behavior: none'), true);
    assert.equal(androidBuild.includes('versionCode 58'), true);
    assert.equal(androidBuild.includes('versionName "2.1.31"'), true);
    assert.equal(apkScript.includes('Alo-Cozinha-v2.1.31.apk'), true);
}

(async () => {
    await testAcceptAndConfirm();
    await testOfflineRetry();
    await testDeleteDoesNotReturn();
    await testNewOrderKeepsAreaRoute();
    await testNewOrdersUseSingleBatch();
    await testNewOrderDoesNotWaitForSlowPull();
    await testSuccessfulPostTurnsIndicatorGreenBeforeFullPull();
    await testNewOrderJumpsAheadOfOldQueue();
    await testRapidAcceptsSurviveStaleHigherRevisionPull();
    await testAlertAcknowledgementIsConfirmedByServer();
    await testAlertAcknowledgementRetriesAfterOfflineFailure();
    await testOldServerFallsBackToIndividualOrders();
    await testSameStatusFromAnotherDeviceClearsQueue();
    await testNewerRemoteActionWinsOverStaleTablet();
    await testSendOrPickupSurvivesRemotePreparingRollback();
    await testOldOrphanQueueIsCleaned();
    testAppsScriptRejectsStaleStatus();
    testAppsScriptAcknowledgesAlertOnce();
    testStandaloneAppsScriptCreatesAndReusesSpreadsheet();
    await testBackupMigrationWaitsForSlowServer();
    testAppsScriptAppendsOrderBatchOnce();
    testOperationalSyncUsesCurrentShiftAndLeavesOldOrdersInHistory();
    testBackupMigrationIsIdempotentAndPreservesHistory();
    testAppsScriptKeepsActivityIdempotentAndRejectsStaleStatus();
    testOldClientPreservesV2TaskCatalog();
    testPasswordDialogsHaveExplicitConfirmation();
    testV2027TaskExperience();
    testAudioMode();
    await testCatalogAutoPublish();
    testComprasHasIndependentOperationalPermissions();
    testComprasUsesUnifiedHost();
    testV217ModuleArchitecture();
    testV219UnifiedPeopleAndDataHub();
    await testEmployeeCanExistWithoutLogin();
    await testLoginPeopleAreFilteredByModule();
    testV2110AccessSyncAndApkPolish();
    console.log('Testes críticos da v2.1.31 passaram.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
