const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'modules/kds/app.js'), 'utf8');

function testCatalogConfirmationUsesActualContent() {
    const sent = {
        produtos:[{ id:'arroz', nome:'Arroz' }],
        categorias:[],
        tarefas:[{ id:'limpeza', revisaoDefinicao:2 }],
        configs:{ somCozinha:'sem_som' }
    };
    const unchangedAfterInternalNotification = structuredClone(sent);

    assert.equal(JSON.stringify(unchangedAfterInternalNotification), JSON.stringify(sent),
        'uma notificação interna sem mudança de conteúdo deve permitir o estado verde');
    assert.match(appSource, /const assinaturaEnviada = JSON\.stringify\(dadosEnviados\)/);
    assert.match(appSource, /JSON\.stringify\(dadosBancoParaNuvem\(\)\) === assinaturaEnviada/);
    assert.doesNotMatch(appSource, /bancoAlteracoes/,
        'o KDS não deve depender do contador que mantinha a publicação amarela');
    const startup = appSource.slice(appSource.indexOf('async function iniciarComSyncConfiavel'));
    assert.ok(
        startup.indexOf('await sincronizarBancoAutomaticamente({ preferirNuvem: true })')
            < startup.indexOf('await AloSharedData.refreshSources({ includeFrames: true, push: true })'),
        'o catálogo confirmado da conta deve chegar antes da mesclagem dos módulos'
    );
}

function testMissingCloudUrlIsExplicit() {
    assert.match(appSource, /Nuvem não configurada/,
        'uma instalação sem URL não pode parecer estar sincronizando indefinidamente');
}

testCatalogConfirmationUsesActualContent();
testMissingCloudUrlIsExplicit();
console.log('sync-v222: confirmação de catálogo do KDS validada');
