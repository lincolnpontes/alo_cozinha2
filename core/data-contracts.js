(function (global) {
    const VERSION = '2.1.44';
    const SHARED_SCHEMA_VERSION = 2;

    const contracts = Object.freeze({
        shared: Object.freeze({
            owner: 'core',
            fields: Object.freeze(['restaurant', 'people', 'catalog', 'sourceStats', 'migration']),
            localStorage: Object.freeze(['alo_core_shared_v2']),
            persistence: 'núcleo local com estado isolado por conta no Supabase',
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
        }),
        l42: Object.freeze({
            owner: 'l42',
            localStorage: Object.freeze(['etiquetadora_db', 'etiquetadora_operadorAtual', 'alo_supabase_session_v1']),
            cloudNamespace: 'etiquetas',
            persistence: 'localStorage com sincronização autenticada no Supabase dos demais módulos',
            futureTablePrefix: 'l42_'
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
