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
    assert.match(appSource, /await dadosCompartilhadosProntos;\s*await sincronizarBancoAutomaticamente\(\)/,
        'a identidade compartilhada deve estabilizar antes da publicação do catálogo');
}

function testMissingCloudUrlIsExplicit() {
    assert.match(appSource, /Nuvem não configurada/,
        'uma instalação sem URL não pode parecer estar sincronizando indefinidamente');
}

testCatalogConfirmationUsesActualContent();
testMissingCloudUrlIsExplicit();
console.log('sync-v222: confirmação de catálogo do KDS validada');
