AloModuleHost.register({
    id: 'l42',
    viewId: 'l42Module',
    label: 'Alô L42',
    storageNamespace: 'l42',
    cloudNamespace: 'l42',
    requiresLogin: true,
    capabilities: ['offline', 'sync', 'labels', 'inventory', 'reports', 'native-camera', 'native-printer'],
    onOpen: () => window.AloL42Module?.open()
});
