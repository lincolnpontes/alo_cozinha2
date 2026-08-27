AloModuleHost.register({
    id: 'checklist',
    viewId: 'tasksModule',
    label: 'Checklist',
    storageNamespace: 'checklist',
    cloudNamespace: 'checklist',
    capabilities: ['offline', 'outbox', 'sync', 'alerts', 'history', 'photos', 'qr-code']
});
