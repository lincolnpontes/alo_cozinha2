const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, window: {}, Date, Math });
vm.runInContext(fs.readFileSync(path.join(root, 'core/catalog-sync.js'), 'utf8'), context);

function bank(products = []) {
    return {
        produtos:products,
        categorias:[], obsPedidos:[], obsCancelamentos:[], areas:[],
        setoresTarefas:[], funcionarios:[], tarefas:[], coreCompartilhado:null,
        configsTarefas:{}, configs:{}
    };
}

async function testReceiptConfirmsTheExactPublication() {
    const sync = context.window.AloCatalogSync;
    const desired = bank([{ id:'arroz', nome:'Arroz' }]);
    let remote = { ...bank(), _revision:1, _capabilities:{ dadosCompartilhados:true } };
    const api = {
        async getBank() { return structuredClone(remote); },
        async post(_url, payload) {
            remote = {
                ...structuredClone(payload.dados),
                configs:{ ...structuredClone(payload.dados.configs), serverManaged:true },
                _revision:2,
                _capabilities:{ dadosCompartilhados:true }
            };
        }
    };
    const result = await sync.publish({
        api,
        url:'https://example.test',
        data:desired,
        wait:async () => {},
        createReceipt:() => 'receipt-this-device'
    });
    assert.equal(result.confirmed, true, 'o recibo devolvido pelo backend deve confirmar este envio');
    assert.equal(result.sent, true);
    assert.equal(result.bank.configs._catalogSyncReceipt, 'receipt-this-device');
}

async function testAnotherDeviceReceiptDoesNotConfirm() {
    const sync = context.window.AloCatalogSync;
    const desired = bank([{ id:'arroz', nome:'Arroz' }]);
    const remote = {
        ...bank([{ id:'feijao', nome:'Feijão' }]),
        configs:{ _catalogSyncReceipt:'receipt-other-device' },
        _revision:9,
        _capabilities:{ dadosCompartilhados:true }
    };
    const api = {
        async getBank() { return structuredClone(remote); },
        async post() {}
    };
    const result = await sync.publish({
        api,
        url:'https://example.test',
        data:desired,
        wait:async () => {},
        createReceipt:() => 'receipt-this-device'
    });
    assert.equal(result.confirmed, false, 'o recibo de outro aparelho não pode produzir um verde falso');
}

Promise.all([testReceiptConfirmsTheExactPublication(), testAnotherDeviceReceiptDoesNotConfirm()])
    .then(() => console.log('Recibo de sincronização do KDS v2.1.40 validado.'))
    .catch(error => { console.error(error); process.exitCode = 1; });
