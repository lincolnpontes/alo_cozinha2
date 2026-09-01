const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const etiquetas = fs.readFileSync(path.join(root, 'modules', 'l42', 'index.html'), 'utf8');

assert.equal(
    shell.includes("AloL42Module.openSettings('categorias')"),
    false,
    'Categorias nao deve aparecer duas vezes nas configuracoes de Etiquetas.'
);
assert.equal(shell.includes("AloL42Module.openSettings('produtos')"), true);
assert.equal(shell.includes("AloL42Module.openSettings('etiquetas')"), true);
assert.equal(shell.includes("AloL42Module.openSettings('basicas')"), true);

assert.match(etiquetas, /function voltarConfiguracoesEtiquetasIntegradas\(\)/);
assert.match(
    etiquetas,
    /function abrirPainelUnificadoComNivel\(mestre\)\{\s*if\(voltarConfiguracoesEtiquetasIntegradas\(\)\)return;/
);
assert.match(
    etiquetas,
    /if\(tipoGerenciarAtual==='categorias'&&origemGerenciarCategorias==='produtos'\)[\s\S]*?abrirGerenciar\('produtos'\);[\s\S]*?if\(voltarConfiguracoesEtiquetasIntegradas\(\)\)return;/
);
assert.match(etiquetas, /if\(!window\.ALO_L42_EMBEDDED\)\{\s*window\.history\.pushState/);
assert.equal(etiquetas.includes('id="modalPainelUnificado"'), false, 'O painel Etiquetas v1 deve sair do HTML.');
assert.equal(etiquetas.includes('Etiquetas - v1'), false, 'O titulo legado nao deve permanecer.');
assert.equal(etiquetas.includes('id="modalLoginAdmin"'), false, 'O login administrativo antigo deve sair do HTML.');
assert.equal(etiquetas.includes('id="modalTemaRapido"'), false, 'O seletor de tema antigo deve sair do HTML.');

[
    'modalListagem',
    'modalFormProduto',
    'modalFormCategoria',
    'modalImprimir',
    'modalGerenciarEtiquetas',
    'modalEstoqueAtivo',
    'modalLeitorQR'
].forEach(id => assert.equal(etiquetas.includes(`id="${id}"`), true, `${id} deve ser preservado.`));

console.log('Navegacao integrada de Etiquetas validada.');
