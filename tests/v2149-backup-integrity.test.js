const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('backup compartilhado preserva restaurante, logomarca e emoji do funcionário', async () => {
    const storage = new Map();
    const window = {
        document: { dispatchEvent() {} },
        alert() {},
        setTimeout,
        clearTimeout
    };
    const context = vm.createContext({
        console,
        window,
        document: window.document,
        localStorage: {
            getItem: key => storage.get(String(key)) ?? null,
            setItem: (key, value) => storage.set(String(key), String(value)),
            removeItem: key => storage.delete(String(key))
        },
        CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        setTimeout,
        clearTimeout
    });
    vm.runInContext(read('core/shared-data.js'), context);

    const payload = {
        schemaVersion: 2,
        revision: 8,
        restaurant: {
            nome: 'Restaurante Teste',
            cidade: 'João Pessoa',
            logo: { dataUrl: 'data:image/webp;base64,TE9HTw==', nome: 'logo.webp' }
        },
        people: [{ id: 'p1', nome: 'Lincoln', emoji: '🧑‍🍳', ativo: true, isAdmin: true }],
        catalog: [],
        sourceStats: {},
        migration: { identitiesMerged: true, catalogIndexed: true }
    };
    await window.AloSharedData.restoreBackup(payload);
    const backup = window.AloSharedData.getBackup();

    assert.equal(backup.restaurant.nome, 'Restaurante Teste');
    assert.equal(backup.restaurant.logo.dataUrl, payload.restaurant.logo.dataUrl);
    assert.equal(backup.people[0].emoji, '🧑‍🍳');
    assert.equal(backup.people[0].isAdmin, true);
});

test('download de mídias para backup pede o conteúdo binário ao Supabase', async () => {
    const requested = [];
    const window = {
        AloCloud: {
            isEndpoint: () => true,
            fetch: async url => {
                requested.push(String(url));
                return Response.json({ status: 'ok', encontrada: true, dataUrl: 'data:image/jpeg;base64,AA==' });
            }
        }
    };
    const context = vm.createContext({ window, fetch, URL, Date, setTimeout, clearTimeout });
    vm.runInContext(read('core/api.js'), context);

    await window.AloApi.getTaskPhoto('https://example.test/functions/v1/sync', 'task-1', true);
    await window.AloApi.getChecklistDocumentFile('https://example.test/functions/v1/sync', 'doc-1', true);
    assert.equal(new URL(requested[0]).searchParams.get('dados'), '1');
    assert.equal(new URL(requested[1]).searchParams.get('dados'), '1');
});

test('backup completo inclui áreas, funcionários, mídias e rotinas de restauração', () => {
    const app = read('modules/kds/app.js');
    const edge = read('supabase/functions/alo-cozinha-sync/index.ts');
    const comprasSync = read('modules/compras/src/scripts/sync.js');

    assert.match(app, /schemaVersion:\s*4/);
    assert.match(app, /compartilhado:\s*AloSharedData\.getBackup\(\)/);
    assert.match(app, /media:\s*\{ taskPhotos \}/);
    assert.match(app, /areas:\s*banco\.areas/);
    assert.match(app, /funcionarios:\s*banco\.funcionarios/);
    assert.match(app, /restoreBackupWithMedia/);
    assert.match(edge, /url\.searchParams\.get\("dados"\) === "1"/);
    assert.match(edge, /dataUrlForFile/);
    assert.match(comprasSync, /'agruparComprasPorStatus'/, 'o agrupamento de Compras deve permanecer local');
});

test('recursos operacionais da v2.1.49 permanecem ligados aos módulos corretos', () => {
    const kds = read('modules/kds/app.js');
    const comprasHost = read('modules/compras/host.js');
    const comprasCore = read('modules/compras/src/scripts/core.js');
    const comprasCatalogo = read('modules/compras/src/scripts/catalog.js');
    const etiquetas = read('modules/l42/index.html');

    assert.match(kds, /KDS_VIEW_KEY\s*=\s*'alo_kds_product_view_v1'/);
    assert.match(kds, /classList\.toggle\('kds-grid-view'/);
    assert.match(kds, /virBuscarAtivo:\s*true/);
    assert.match(kds, /db\.configs\.virBuscarAtivo\s*!==\s*false/);

    assert.match(comprasHost, /comprasReceiveModeEnabled/);
    assert.match(comprasCore, /modoReceberAtivo:\s*false/);
    assert.match(comprasCore, /estoqueMinimo/);
    assert.match(comprasCore, /estoqueMaximo/);
    assert.match(comprasCatalogo, /limitesEstoque/);

    assert.match(etiquetas, /const paletasDeCores=\{\s*transparente:/);
    assert.doesNotMatch(etiquetas, /paletasDeCores\.(?:azul|verde|escuro|claro)/);
});
