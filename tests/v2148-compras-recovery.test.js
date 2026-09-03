const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('administrador de Compras nunca fica limitado por categorias', () => {
    const values = new Map();
    const context = vm.createContext({
        console,
        localStorage: {
            getItem: key => values.get(String(key)) ?? null,
            setItem: (key, value) => values.set(String(key), String(value))
        },
        AloFeiraDomain: {
            numeroSeguro: value => Number(value || 0),
            normalizarHistoricoPrecos: value => Array.isArray(value) ? value : []
        }
    });
    vm.runInContext(read('modules/compras/src/scripts/core.js'), context);

    assert.equal(context.getCatsPermitidas({ isAdmin: true, catsPermitidasPedido: ['uma'] }, 'pedido'), null);
    assert.deepEqual(Array.from(context.getCatsPermitidas({ isAdmin: false, catsPermitidasPedido: [] }, 'pedido')), []);
    assert.deepEqual(Array.from(context.getCatsPermitidas({ isAdmin: false, catsPermitidasCompras: ['cat-1'] }, 'compras')), ['cat-1']);
});

test('host só libera Compras depois da hidratação autenticada', () => {
    const host = read('modules/compras/host.js');
    const child = read('modules/compras/src/scripts/app.js');

    assert.match(host, /if \(!url\) return false;/);
    assert.match(host, /configurarNuvemComprasPeloHost\(endpoint, \{ forcar: options\.refreshCloud === true \}\)/);
    assert.match(host, /waitForChild\(\{ requireCloud: true, refreshCloud: true \}\)/);
    assert.match(child, /db\.configs\.dadosBaixados = false;/);
    assert.match(child, /const sincronizou = await sincronizarInicializacao\(\)/);
    assert.match(child, /Não foi possível baixar a Lista de Compras desta conta/);
});

test('restauração confere Compras antes da primeira gravação', () => {
    const app = read('modules/kds/app.js');
    const restore = app.slice(app.indexOf('async function importarDadosFisicos'), app.indexOf('function preencherConfiguracoesBasicas'));
    const preflight = restore.indexOf('AloFeiraModule.ensureCloudReady({ refresh: true })');
    const firstWrite = restore.indexOf('AloApi.migrateBackup');
    const comprasWrite = restore.indexOf('AloFeiraModule.restoreBackup');

    assert.ok(preflight >= 0, 'a restauração precisa validar o módulo Compras');
    assert.ok(firstWrite > preflight, 'a validação deve acontecer antes de alterar KDS ou Checklist');
    assert.ok(comprasWrite > preflight, 'a validação deve acontecer antes de restaurar Compras');
});
