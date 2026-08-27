AloModuleHost.register({
    id: 'kds',
    viewId: 'kdsModule',
    label: 'KDS',
    storageNamespace: 'kds',
    cloudNamespace: 'kds',
    capabilities: ['offline', 'outbox', 'sync', 'alerts', 'history']
});
