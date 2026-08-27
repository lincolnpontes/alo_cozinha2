(function (global) {
    const VERSION = '2.1.6';
    const SHARED_SCHEMA_VERSION = 1;

    const contracts = Object.freeze({
        shared: Object.freeze({
            owner: 'core',
            fields: Object.freeze(['restaurante', 'operadores', 'setores', 'senhaSeguranca', 'urlNuvem']),
            persistence: 'adaptadores dos módulos atuais',
            futureTablePrefix: 'core_'
        }),
        kds: Object.freeze({
            owner: 'kds',
            localStorage: Object.freeze(['kds_v1_db', 'kds_fila_status', 'kds_pedidos_local', 'kds_cientes_local']),
            indexedDb: 'alo_kds_v2',
            cloudNamespace: 'kds',
            futureTablePrefix: 'kds_'
        }),
        checklist: Object.freeze({
            owner: 'checklist',
            localStorage: Object.freeze(['alo_tasks_activities_v2', 'alo_tasks_outbox_v2', 'alo_tasks_revision_v2', 'alo_tasks_selected_area_v2']),
            cloudNamespace: 'checklist',
            futureTablePrefix: 'checklist_'
        }),
        compras: Object.freeze({
            owner: 'compras',
            localStorage: Object.freeze(['alofeira_v1']),
            cloudNamespace: 'compras',
            futureTablePrefix: 'compras_'
        })
    });

    function get(moduleId) {
        return contracts[String(moduleId)] || null;
    }

    function describe() {
        return { appVersion: VERSION, schemaVersion: SHARED_SCHEMA_VERSION, contracts };
    }

    global.AloDataContracts = Object.freeze({ VERSION, SHARED_SCHEMA_VERSION, get, describe });
})(window);
