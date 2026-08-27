AloModuleHost.register({
    id: 'compras',
    viewId: 'feiraModule',
    label: 'Lista de Compras',
    storageNamespace: 'compras',
    cloudNamespace: 'compras',
    requiresLogin: true,
    capabilities: ['offline', 'sync', 'operators', 'catalog', 'orders', 'purchases', 'reports']
});
