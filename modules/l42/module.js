AloModuleHost.register({
    id: 'l42',
    viewId: 'l42Module',
    label: 'Etiquetas',
    storageNamespace: 'l42',
    cloudNamespace: 'etiquetas',
    requiresLogin: true,
    capabilities: ['offline', 'sync', 'labels', 'inventory', 'reports', 'native-camera', 'native-printer'],
    onOpen: () => window.AloL42Module?.open()
});
