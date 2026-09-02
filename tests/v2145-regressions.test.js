const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Etiquetas preserva a interface integrada apos atualizar cadastros', () => {
    const source = read('modules/l42/index.html');
    assert.match(source, /function aprimorarCabecalhoHome\(\)\{\s*if\(window\.ALO_L42_EMBEDDED\)/);
    assert.match(source, /window\.garantirInterfaceEtiquetasIntegrada=\(\)=>\{/);
    assert.match(source, /abrirModal\('modalListagem'\);\s*if\(window\.ALO_L42_EMBEDDED\)configurarVoltaEtiquetasHost\('modalListagem'\)/);
    assert.match(source, /html\.alo-l42-embedded #modalPainelUnificado\{display:none!important;visibility:hidden!important;pointer-events:none!important\}/);
});

test('login combina Turnstile com bloqueio depois de tres senhas incorretas', () => {
    const cloud = read('core/cloud.js');
    const page = read('index.html');
    const android = read('android/app/src/main/java/com/aloetiqueta/l42/MainActivity.java');
    assert.match(page, /alo-turnstile-site-key/);
    assert.match(page, /id="cloudAccessTurnstile"/);
    assert.match(cloud, /gotrue_meta_security:\s*\{ captcha_token: token \}/);
    assert.match(cloud, /const LOGIN_MAX_ATTEMPTS = 3/);
    assert.match(cloud, /const LOGIN_LOCK_MS = 5 \* 60 \* 1000/);
    assert.match(cloud, /function registerInvalidLogin\(\)/);
    assert.match(cloud, /Login bloqueado temporariamente/);
    assert.match(android, /WebViewAssetLoader/);
    assert.match(android, /https:\/\/appassets\.androidplatform\.net\/assets\/index\.html/);
    assert.match(cloud, /continueAccountActionFromAccess\(\{ create \}\)/);
    assert.match(cloud, /continueAccountActionFromAccess\(\{ recoverPassword: true \}\)/);
    assert.doesNotMatch(cloud, /connectFromSettings[\s\S]{0,500}await signIn/);
});

test('acoes demonstrativas de Etiquetas usam capitalizacao final', () => {
    const demo = read('core/demo.js');
    assert.equal(demo.includes("acaoPadrao: 'produzido'"), false);
    assert.equal(demo.includes("acaoPadrao: 'Produzido'"), true);
});
