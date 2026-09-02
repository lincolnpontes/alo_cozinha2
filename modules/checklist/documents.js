(function (global) {
    const STORAGE_KEY = 'alo_checklist_documents_v1';
    const POLL_MS = 9000;
    const MAX_PDF_BYTES = 3 * 1024 * 1024;
    const CATEGORIES = ['Empresa e Fiscal', 'Licenças', 'Sanitário', 'Pessoas', 'Água', 'Pragas', 'Incêndio', 'Ambiental', 'Resíduos', 'Operação', 'Outros'];
    const CATALOG = [
        ['ato-constitutivo', 'Contrato social ou ato constitutivo', 'Empresa e Fiscal', 'Federal/Estadual', 'Guarde o documento registrado e suas alterações ou consolidação mais recente. Para MEI, use o CCMEI.', 'https://www.gov.br/pt-br/servicos/inscrever-no-cnpj'],
        ['cnpj-comprovante', 'Comprovante de inscrição e situação cadastral no CNPJ', 'Empresa e Fiscal', 'Federal', 'Comprovante atualizado dos dados e da situação cadastral da pessoa jurídica.', 'https://www.gov.br/empresas-e-negocios/pt-br/redesim/comprovantes'],
        ['inscricao-estadual-icms', 'Inscrição estadual e cadastro no ICMS', 'Empresa e Fiscal', 'Estadual/Condicional', 'Aplicável às atividades sujeitas ao ICMS. A obrigação e a consulta dependem da Secretaria da Fazenda do estado.', 'https://antigo.redesim.gov.br/servicos/servicos-para-pj/inscricoes-tributarias/orientacoes'],
        ['inscricao-municipal', 'Inscrição municipal', 'Empresa e Fiscal', 'Municipal', 'Identificação da empresa perante a administração tributária municipal; mantenha o comprovante do estabelecimento.', 'https://www.gov.br/empresas-e-negocios/pt-br/redesim/ajuda/inscrever'],
        ['certidao-federal', 'Certidão de regularidade fiscal federal', 'Empresa e Fiscal', 'Federal', 'Certidão conjunta da Receita Federal e PGFN, incluindo tributos federais, Dívida Ativa da União e contribuições previdenciárias.', 'https://www.gov.br/receitafederal/pt-br/servicos/certidoes/emitir-certidao/emitir-certidao/'],
        ['certidao-estadual', 'Certidão de regularidade fiscal estadual', 'Empresa e Fiscal', 'Estadual', 'Emita na Secretaria da Fazenda do estado onde o estabelecimento está inscrito e acompanhe a validade informada no documento.', 'https://www.gov.br/empresas-e-negocios/pt-br/redesim/ajuda/inscrever'],
        ['certidao-municipal', 'Certidão de regularidade fiscal municipal', 'Empresa e Fiscal', 'Municipal', 'Emita na prefeitura ou Secretaria Municipal da Fazenda responsável pelo cadastro do estabelecimento.', 'https://www.gov.br/empresas-e-negocios/pt-br/redesim/ajuda/inscrever'],
        ['cndt', 'Certidão Negativa de Débitos Trabalhistas', 'Empresa e Fiscal', 'Trabalhista', 'Comprova a situação perante o Banco Nacional de Devedores Trabalhistas; a certidão nacional possui validade própria.', 'https://www.tst.jus.br/web/acesso-a-informacao/carta-de-servicos-a-cidadania/servicos-processuais/cndt'],
        ['regularidade-fgts', 'Certificado de Regularidade do FGTS', 'Empresa e Fiscal', 'Trabalhista', 'Comprova a regularidade do empregador perante o FGTS. Consulte e renove conforme a validade do CRF.', 'https://www.caixa.gov.br/empresa/pagamentos-recebimentos/pagamentos/fgts/Paginas/default.aspx'],
        ['simples-nacional', 'Comprovante de opção pelo Simples Nacional', 'Empresa e Fiscal', 'Federal/Condicional', 'Mantenha o comprovante quando a empresa for optante pelo Simples Nacional ou SIMEI.', 'https://www8.receita.fazenda.gov.br/SIMPLESNACIONAL/Servicos/Grupo.aspx?grp=4'],
        ['alvara-sanitario', 'Alvará sanitário', 'Licenças', 'Municipal/Estadual', 'Conforme o licenciamento sanitário local.', 'https://www.gov.br/anvisa/pt-br/assuntos/alimentos/controle-sanitario/'],
        ['alvara-funcionamento', 'Alvará de funcionamento', 'Licenças', 'Municipal', 'Exigência e validade definidas pelo município e pelo enquadramento de risco.', 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/lei/l13874.htm'],
        ['bombeiros', 'Licença do Corpo de Bombeiros', 'Incêndio', 'Estadual', 'AVCB, CLCB ou documento equivalente, conforme a legislação estadual.', 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2017/lei/l13425.htm'],
        ['estanqueidade', 'Teste de estanqueidade do gás', 'Incêndio', 'Condicional', 'Aplicável quando houver instalação de gás e exigência do Corpo de Bombeiros ou do município.', 'https://www.mg.gov.br/servico/renovar-o-avcb-ou-clcb'],
        ['licenca-ambiental', 'Licença ambiental', 'Ambiental', 'Condicional', 'Depende do porte, da localização e do enquadramento pelo órgão ambiental.', 'https://conama.mma.gov.br/?option=com_sisconama&task=arquivo.download&id=237'],
        ['manual-boas-praticas', 'Manual de Boas Práticas', 'Sanitário', 'Federal', 'Deve refletir a estrutura e os processos reais do estabelecimento e permanecer atualizado.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html'],
        ['pops', 'Procedimentos Operacionais Padronizados', 'Sanitário', 'Federal', 'Inclui higienização, pragas, reservatório e higiene e saúde dos manipuladores.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html'],
        ['controle-pragas', 'Controle preventivo de pragas', 'Pragas', 'Federal', 'Mantenha o POP, as ocorrências e as medidas preventivas e corretivas.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html'],
        ['certificado-pragas', 'Certificado de desinsetização e desratização', 'Pragas', 'Condicional', 'Necessário quando houver controle químico realizado por empresa especializada.', 'https://www.in.gov.br/en/web/dou/-/resolucao-rdc-n-622-de-9-de-marco-de-2022-386107395'],
        ['reservatorio', 'Limpeza de caixa-d’água ou cisterna', 'Água', 'Federal', 'A RDC 216 estabelece intervalo máximo de seis meses para higienização do reservatório.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html'],
        ['potabilidade', 'Laudo de potabilidade da água', 'Água', 'Condicional', 'Semestral quando for usada solução alternativa de abastecimento; regras locais podem ampliar o controle.', 'https://bvsms.saude.gov.br/bvs/saudelegis/gm/2021/prt0888_24_05_2021_rep.html'],
        ['saude-manipuladores', 'Controle de saúde dos manipuladores', 'Pessoas', 'Federal', 'Registre o controle ocupacional sem expor resultados clínicos a pessoas não autorizadas.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html', true],
        ['capacitacao', 'Capacitação em boas práticas', 'Pessoas', 'Federal', 'Mantenha data, conteúdo, carga horária, participantes e responsável pela capacitação.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html'],
        ['aso', 'Atestados de Saúde Ocupacional', 'Pessoas', 'Trabalhista', 'Documento sensível. Registre apenas aptidão, data e próxima revisão na visualização geral.', 'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadoras-vigentes/nr-07-atualizada-2022-1.pdf', true],
        ['pcmso', 'PCMSO', 'Pessoas', 'Condicional', 'Aplicabilidade e revisão seguem a NR-7 e os riscos ocupacionais identificados.', 'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadoras-vigentes/nr-07-atualizada-2022-1.pdf', true],
        ['pgr', 'PGR e inventário de riscos', 'Pessoas', 'Trabalhista', 'Reúne riscos como calor, cortes, queimaduras, produtos químicos, ergonomia e ruído.', 'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadoras-vigentes/'],
        ['pgrs', 'Plano de Gerenciamento de Resíduos', 'Resíduos', 'Condicional', 'Depende da natureza, composição e volume dos resíduos e da regra local.', 'https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2010/lei/l12305.htm'],
        ['destinacao-residuos', 'Comprovantes de destinação de resíduos', 'Resíduos', 'Condicional', 'Guarde comprovantes de óleo usado, recicláveis e resíduos especiais quando aplicável.', 'https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2010/lei/l12305.htm'],
        ['manutencao-calibracao', 'Manutenção e calibração de equipamentos', 'Operação', 'Federal', 'Registre as manutenções e calibrações necessárias ao controle do processo.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html'],
        ['temperaturas', 'Controle de temperaturas', 'Operação', 'Federal', 'Registros devem acompanhar os processos realizados e ser guardados pelo prazo sanitário aplicável.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html'],
        ['recebimento-rastreabilidade', 'Recebimento e rastreabilidade', 'Operação', 'Recomendado', 'Organize fornecedor, lote, validade, temperatura e condição dos produtos recebidos.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html'],
        ['responsavel-manipulacao', 'Responsável pela manipulação', 'Pessoas', 'Federal', 'Identifique o proprietário ou funcionário designado e comprovadamente capacitado.', 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html']
    ].map(([templateId, nome, categoria, alcance, orientacao, fonte, sensivel = false]) => ({ templateId, nome, categoria, alcance, orientacao, fonte, sensivel }));

    let deps = { getUrl: () => '', getTasks: () => [], openModalTop: null, onSyncState: null };
    let state = loadState();
    let syncPromise = null;
    let pollTimer = null;
    let pendingFile = null;
    let removeFile = false;
    let formMode = 'view';
    let viewerDocumentId = '';
    let viewerScale = 1;
    const filePreviewCache = new Map();
    const filePreviewLoading = new Set();

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function id(prefix) { return `${prefix}_${global.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`; }
    function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character])); }
    function normalizeSearch(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
    function normalizeDocument(document) {
        const source = document && typeof document === 'object' ? document : {};
        return {
            id: String(source.id || id('documento')),
            templateId: String(source.templateId || ''),
            nome: String(source.nome || ''),
            categoria: CATEGORIES.includes(source.categoria) ? source.categoria : 'Outros',
            alcance: String(source.alcance || 'Local'),
            orientacao: String(source.orientacao || ''),
            fonte: String(source.fonte || ''),
            sensivel: source.sensivel === true,
            orgao: String(source.orgao || ''),
            numero: String(source.numero || ''),
            emitidoEm: String(source.emitidoEm || ''),
            venceEm: String(source.venceEm || ''),
            observacoes: String(source.observacoes || ''),
            tarefaId: String(source.tarefaId || ''),
            arquivo: source.arquivo && typeof source.arquivo === 'object' ? {
                nome: String(source.arquivo.nome || ''), mime: String(source.arquivo.mime || ''), tamanho: Number(source.arquivo.tamanho || 0), atualizadoEm: Number(source.arquivo.atualizadoEm || 0), demoUrl: String(source.arquivo.demoUrl || '')
            } : null,
            atualizadoEm: Number(source.atualizadoEm || Date.now()),
            revisao: Number(source.revisao || 1),
            excluido: source.excluido === true,
            personalizado: source.personalizado === true
        };
    }
    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return { documents:Array.isArray(saved.documents) ? saved.documents.map(normalizeDocument) : [], outbox:Array.isArray(saved.outbox) ? saved.outbox : [], revision:Number(saved.revision || 0) };
        } catch (error) { return { documents:[], outbox:[], revision:0 }; }
    }
    function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    function catalogDocument(template) {
        return normalizeDocument({ id:`documento_modelo_${template.templateId}`, ...template, revisao:0, atualizadoEm:0 });
    }
    function visibleDocuments() {
        const savedByTemplate = new Map(state.documents.filter(item => item.templateId).map(item => [item.templateId, item]));
        const catalog = CATALOG.map(template => savedByTemplate.get(template.templateId) || catalogDocument(template)).filter(item => !item.excluido);
        const custom = state.documents.filter(item => !item.templateId && !item.excluido);
        return catalog.concat(custom);
    }
    function setSyncStatus(status, title) {
        const indicator = document.getElementById('checklistDocumentSyncState');
        if (indicator) { indicator.className = `technical-sheet-sync-state ${status || ''}`; indicator.title = title || ''; }
        deps.onSyncState?.({ status:status || '', title:title || '', pendingCount:state.outbox.length });
    }
    function statusFor(document) {
        if (!document.arquivo && !document.numero && !document.emitidoEm) return { key:'pendente', label:'Pendente' };
        if (!document.venceEm) return { key:'sem-validade', label:'Sem validade' };
        const expiry = new Date(`${document.venceEm}T23:59:59`).getTime();
        if (!Number.isFinite(expiry)) return { key:'sem-validade', label:'Sem validade' };
        const days = Math.ceil((expiry - Date.now()) / 86400000);
        if (days < 0) return { key:'vencido', label:'Vencido' };
        if (days <= 30) return { key:'vencendo', label:`Vence em ${days}d` };
        return { key:'em-dia', label:'Em dia' };
    }
    function taskName(taskId) {
        const task = deps.getTasks().find(item => String(item.id) === String(taskId));
        return task?.nome || '';
    }
    function isImageDocument(record) { return Boolean(record?.arquivo?.mime?.startsWith('image/')); }
    function demoFile(record) {
        const relative = String(record?.arquivo?.demoUrl || '');
        if (!relative || !global.AloDemo?.isActive?.()) return null;
        return { dataUrl:new URL(relative, document.baseURI).toString(), name:record.arquivo.nome, mime:record.arquivo.mime };
    }
    async function loadFilePreview(record) {
        if (!isImageDocument(record)) return '';
        const localDemo = demoFile(record);
        if (localDemo) return localDemo.dataUrl;
        if (!deps.getUrl()) return '';
        if (filePreviewCache.has(record.id)) return filePreviewCache.get(record.id);
        if (filePreviewLoading.has(record.id)) return '';
        filePreviewLoading.add(record.id);
        try {
            const file = await global.AloApi.getChecklistDocumentFile(deps.getUrl(), record.id, true);
            const dataUrl = file?.dataUrl || file?.data || file?.arquivo || '';
            if (dataUrl) filePreviewCache.set(record.id, dataUrl);
            return dataUrl;
        } catch (error) { return ''; }
        finally { filePreviewLoading.delete(record.id); }
    }
    function render() {
        const target = document.getElementById('checklistDocumentsList');
        if (!target) return;
        const query = normalizeSearch(document.getElementById('checklistDocumentsSearch')?.value);
        const documents = visibleDocuments().filter(document => Boolean(document.arquivo) && (!query || normalizeSearch(`${document.nome} ${document.orgao} ${taskName(document.tarefaId)}`).includes(query)))
            .sort((left, right) => left.nome.localeCompare(right.nome));
        target.innerHTML = documents.length ? documents.map(document => {
            const status = statusFor(document);
            const linkedTask = taskName(document.tarefaId);
            return `<button type="button" class="document-card ${status.key}" onclick="AloChecklistDocuments.openDetail('${escapeHtml(document.id)}')"><span class="document-card-icon registered" aria-hidden="true">📄</span><span class="document-card-copy"><strong>${escapeHtml(document.nome)}</strong>${linkedTask ? `<span>Atividade: ${escapeHtml(linkedTask)}</span>` : ''}<small class="registered">Documento cadastrado</small></span><span class="document-status ${status.key}">${escapeHtml(status.label)}</span></button>`;
        }).join('') : '<div class="tasks-empty">Nenhum documento cadastrado.</div>';
    }
    function activate() { render(); syncNow().catch(() => {}); }
    function findDocument(documentId) { return visibleDocuments().find(document => document.id === documentId); }
    function taskOptions(selected) {
        const tasks = deps.getTasks().filter(task => task && task.ativa !== false && task.id && task.nome).sort((left, right) => String(left.nome).localeCompare(String(right.nome)));
        return `<option value="">Sem atividade vinculada</option>${tasks.map(task => `<option value="${escapeHtml(task.id)}" ${String(task.id) === String(selected) ? 'selected' : ''}>${escapeHtml(task.nome)}</option>`).join('')}`;
    }
    function displayFileState(documentRecord) {
        const file = pendingFile || documentRecord?.arquivo;
        const target = document.getElementById('checklistDocumentFileState');
        if (target) target.textContent = file ? `${file.mime === 'application/pdf' ? 'PDF' : 'Imagem'} · ${file.name || file.nome || 'Arquivo'}${file.size || file.tamanho ? ` · ${Math.max(1, Math.round(Number(file.size || file.tamanho) / 1024))} KB` : ''}` : 'Nenhum arquivo anexado';
        const hasFile = Boolean(file) && !removeFile;
        const open = document.getElementById('checklistDocumentOpenFile');
        const remove = document.getElementById('checklistDocumentRemoveFile');
        if (open) open.style.display = hasFile ? 'inline-flex' : 'none';
        if (remove) remove.style.display = hasFile ? 'inline-flex' : 'none';
    }
    function openManager() {
        document.getElementById('modalConfigTasksMenu').style.display = 'none';
        renderManager();
        deps.openModalTop?.('modalChecklistDocumentsManager') || (document.getElementById('modalChecklistDocumentsManager').style.display = 'flex');
    }
    function closeManager() {
        document.getElementById('modalChecklistDocumentsManager').style.display = 'none';
        global.AloTasks?.openSettingsMenu?.();
    }
    function renderManager() {
        const target = document.getElementById('checklistDocumentsManagerList');
        if (!target) return;
        const query = normalizeSearch(document.getElementById('checklistDocumentsManagerSearch')?.value);
        const documents = visibleDocuments().filter(document => !query || normalizeSearch(`${document.nome} ${document.orgao} ${taskName(document.tarefaId)}`).includes(query))
            .sort((left, right) => left.nome.localeCompare(right.nome));
        target.innerHTML = documents.length ? documents.map(document => {
            const linkedTask = taskName(document.tarefaId);
            const missingFile = !document.arquivo;
            return `<button type="button" class="technical-manager-item document-manager-item ${missingFile ? 'missing-document' : ''}" onclick="AloChecklistDocuments.openForm('${escapeHtml(document.id)}', 'manager')">${missingFile ? '<span class="document-manager-empty" aria-hidden="true">∅</span>' : ''}<span class="document-manager-copy"><strong>${escapeHtml(document.nome)}</strong><small>${linkedTask ? `Atividade: ${escapeHtml(linkedTask)}` : statusFor(document).label}</small></span><b aria-hidden="true">✎</b></button>`;
        }).join('') : '<div class="tasks-empty">Nenhum documento encontrado.</div>';
    }
    function formatDate(value) {
        if (!value) return 'Não informado';
        const [year, month, day] = String(value).split('-');
        return year && month && day ? `${day}/${month}/${year}` : String(value);
    }
    async function openDetail(documentId) {
        const record = findDocument(documentId);
        if (!record) return;
        const linkedTask = taskName(record.tarefaId) || 'Sem atividade vinculada';
        const status = statusFor(record);
        const body = document.getElementById('checklistDocumentDetailBody');
        document.getElementById('checklistDocumentDetailTitle').textContent = record.nome;
        body.innerHTML = `<div class="document-detail-grid"><div class="document-detail-field"><small>Status</small><strong>${escapeHtml(status.label)}</strong></div><div class="document-detail-field"><small>Atividade relacionada</small><strong>${escapeHtml(linkedTask)}</strong></div><div class="document-detail-field"><small>Órgão ou responsável</small><strong>${escapeHtml(record.orgao || 'Não informado')}</strong></div><div class="document-detail-field"><small>Número</small><strong>${escapeHtml(record.numero || 'Não informado')}</strong></div><div class="document-detail-field"><small>Emissão</small><strong>${escapeHtml(formatDate(record.emitidoEm))}</strong></div><div class="document-detail-field"><small>Validade</small><strong>${escapeHtml(formatDate(record.venceEm))}</strong></div></div>${record.observacoes ? `<div class="document-detail-notes">${escapeHtml(record.observacoes)}</div>` : ''}${record.arquivo ? (isImageDocument(record) ? `<div id="checklistDocumentDetailPreview" class="document-detail-preview"><span>Carregando imagem...</span></div>` : `<button class="document-detail-file" type="button" onclick="AloChecklistDocuments.openFile('${escapeHtml(record.id)}')">Abrir ${escapeHtml(record.arquivo.nome || 'PDF')}</button>`) : '<div class="document-detail-notes">Nenhum arquivo anexado.</div>'}`;
        const edit = document.getElementById('checklistDocumentDetailEdit');
        edit.onclick = () => {
            document.getElementById('modalChecklistDocumentDetail').style.display = 'none';
            openForm(record.id, 'manager');
        };
        deps.openModalTop?.('modalChecklistDocumentDetail') || (document.getElementById('modalChecklistDocumentDetail').style.display = 'flex');
        if (isImageDocument(record)) {
            const dataUrl = await loadFilePreview(record);
            const preview = document.getElementById('checklistDocumentDetailPreview');
            if (preview) preview.innerHTML = dataUrl ? `<button type="button" class="document-detail-image-button" onclick="AloChecklistDocuments.openImageViewer('${escapeHtml(record.id)}')" aria-label="Ampliar documento"><img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(record.nome)}"><span>Toque para ampliar</span></button><button type="button" class="document-detail-share" onclick="AloChecklistDocuments.shareFile('${escapeHtml(record.id)}')" aria-label="Compartilhar documento" title="Compartilhar"><span class="document-share-icon" aria-hidden="true"></span></button>` : '<span>Imagem indisponível.</span>';
        }
    }
    function closeDetail() { document.getElementById('modalChecklistDocumentDetail').style.display = 'none'; }
    function updateViewerScale() {
        const image = document.getElementById('checklistDocumentViewerImage');
        const label = document.getElementById('checklistDocumentViewerZoom');
        if (image) image.style.transform = `scale(${viewerScale})`;
        if (label) label.textContent = `${Math.round(viewerScale * 100)}%`;
    }
    async function openImageViewer(documentId) {
        const record = findDocument(documentId);
        if (!isImageDocument(record)) return;
        viewerDocumentId = record.id;
        viewerScale = 1;
        const title = document.getElementById('checklistDocumentViewerTitle');
        const image = document.getElementById('checklistDocumentViewerImage');
        if (title) title.textContent = record.nome;
        if (image) { image.removeAttribute('src'); image.alt = record.nome; }
        deps.openModalTop?.('modalChecklistDocumentViewer') || (document.getElementById('modalChecklistDocumentViewer').style.display = 'flex');
        updateViewerScale();
        const dataUrl = await loadFilePreview(record);
        if (image && dataUrl) image.src = dataUrl;
    }
    function closeImageViewer() {
        document.getElementById('modalChecklistDocumentViewer').style.display = 'none';
        viewerDocumentId = '';
        viewerScale = 1;
    }
    function changeImageZoom(delta) {
        viewerScale = Math.max(0.75, Math.min(4, Math.round((viewerScale + Number(delta || 0)) * 100) / 100));
        updateViewerScale();
    }
    async function blobToBase64(blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
        }
        return btoa(binary);
    }
    async function shareFile(documentId = '') {
        const record = findDocument(documentId || viewerDocumentId);
        if (!record?.arquivo) return;
        try {
            const remote = demoFile(record) || await global.AloApi.getChecklistDocumentFile(deps.getUrl(), record.id, true);
            const dataUrl = remote?.dataUrl || remote?.data || remote?.arquivo || '';
            if (!dataUrl) throw new Error('Arquivo não encontrado.');
            const blob = await (await fetch(dataUrl)).blob();
            const name = remote?.name || remote?.nome || record.arquivo.nome || 'documento';
            if (global.AloNative && typeof global.AloNative.shareDocumentBase64 === 'function') {
                const result = JSON.parse(global.AloNative.shareDocumentBase64(
                    await blobToBase64(blob),
                    blob.type || record.arquivo.mime || 'application/octet-stream',
                    name,
                    `Compartilhar ${record.nome}`
                ));
                if (!result?.ok) throw new Error(result?.error || 'Não foi possível abrir o compartilhamento.');
                return;
            }
            const file = new File([blob], name, { type:blob.type || record.arquivo.mime || 'application/octet-stream' });
            if (navigator.share && navigator.canShare?.({ files:[file] })) {
                await navigator.share({ files:[file], title:record.nome });
                return;
            }
            const blobUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = blobUrl; anchor.download = name; anchor.click();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            global.AloUiDialog?.notice('Este navegador não oferece o menu de compartilhamento. O arquivo foi baixado.', { title:'Compartilhamento indisponível', confirmText:'Entendi' });
        } catch (error) {
            if (error?.name !== 'AbortError') global.AloUiDialog?.notice(error.message || 'Não foi possível compartilhar o documento.', { title:'Compartilhamento indisponível', confirmText:'Entendi' });
        }
    }
    function setFormReadOnly(readOnly) {
        ['checklistDocumentName','checklistDocumentTask','checklistDocumentIssuer','checklistDocumentNumber','checklistDocumentIssuedAt','checklistDocumentExpiresAt','checklistDocumentNotes'].forEach(id => {
            const field = document.getElementById(id);
            if (field) field.disabled = readOnly;
        });
        document.querySelectorAll('#modalChecklistDocument .task-photo-pick').forEach(button => { button.style.display = readOnly ? 'none' : ''; });
        const save = document.getElementById('checklistDocumentSave');
        if (save) save.style.display = readOnly ? 'none' : '';
        const removeDocument = document.getElementById('checklistDocumentDelete');
        if (removeDocument && readOnly) removeDocument.style.display = 'none';
        const remove = document.getElementById('checklistDocumentRemoveFile');
        if (remove && readOnly) remove.style.display = 'none';
    }
    function openForm(documentId = '', mode = 'manager') {
        formMode = mode;
        if (mode === 'manager') document.getElementById('modalChecklistDocumentsManager').style.display = 'none';
        const record = findDocument(documentId) || normalizeDocument({ id:id('documento'), categoria:'Outros', personalizado:true });
        document.getElementById('checklistDocumentFormTitle').textContent = documentId ? 'Documento' : 'Novo Documento';
        document.getElementById('checklistDocumentId').value = record.id;
        document.getElementById('checklistDocumentName').value = record.nome;
        document.getElementById('checklistDocumentTask').innerHTML = taskOptions(record.tarefaId);
        document.getElementById('checklistDocumentIssuer').value = record.orgao;
        document.getElementById('checklistDocumentNumber').value = record.numero;
        document.getElementById('checklistDocumentIssuedAt').value = record.emitidoEm;
        document.getElementById('checklistDocumentExpiresAt').value = record.venceEm;
        document.getElementById('checklistDocumentNotes').value = record.observacoes;
        const legal = document.getElementById('checklistDocumentLegalNote');
        legal.innerHTML = `<strong>${escapeHtml(record.alcance)}</strong> · ${escapeHtml(record.orientacao || 'Documento criado pelo estabelecimento.')}${record.fonte ? ` <a href="${escapeHtml(record.fonte)}" target="_blank" rel="noopener">Fonte oficial</a>` : ''}`;
        document.getElementById('checklistDocumentDelete').style.display = record.personalizado && documentId ? 'block' : 'none';
        pendingFile = null;
        removeFile = false;
        displayFileState(record);
        setFormReadOnly(mode === 'view');
        deps.openModalTop?.('modalChecklistDocument') || (document.getElementById('modalChecklistDocument').style.display = 'flex');
    }
    function closeForm(reopen = true) {
        document.getElementById('modalChecklistDocument').style.display = 'none';
        if (reopen && formMode === 'manager') openManager();
    }
    function readAsDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.')); reader.readAsDataURL(file); }); }
    async function handleFile(input) {
        const file = input?.files?.[0];
        if (!file) return;
        try {
            if (file.type === 'application/pdf') {
                if (file.size > MAX_PDF_BYTES) throw new Error('O PDF deve ter no máximo 3 MB. Reduza o arquivo antes de anexar.');
                pendingFile = { dataUrl:await readAsDataUrl(file), name:file.name || 'documento.pdf', mime:file.type, size:file.size };
            } else if (file.type.startsWith('image/')) {
                const dataUrl = await global.AloTasks.compressPhoto(file, { maxDimension:1920, quality:.74, maxDataUrl:4200000 });
                pendingFile = { dataUrl, name:(file.name || 'documento.jpg').replace(/\.[^.]+$/, '.jpg'), mime:'image/jpeg', size:Math.round(dataUrl.length * .75) };
            } else throw new Error('Anexe uma imagem ou um arquivo PDF.');
            removeFile = false;
            displayFileState(findDocument(document.getElementById('checklistDocumentId').value));
        } catch (error) {
            global.AloUiDialog?.notice(error.message || 'Não foi possível preparar o arquivo.', { title:'Arquivo não carregado', confirmText:'Entendi' });
        } finally { input.value = ''; }
    }
    function removeFileDraft() { pendingFile = null; removeFile = true; displayFileState(null); }
    function draftFromForm() {
        const current = findDocument(document.getElementById('checklistDocumentId').value);
        return normalizeDocument({
            ...(current || {}), id:document.getElementById('checklistDocumentId').value || id('documento'),
            nome:document.getElementById('checklistDocumentName').value.trim(), tarefaId:document.getElementById('checklistDocumentTask').value,
            orgao:document.getElementById('checklistDocumentIssuer').value.trim(), numero:document.getElementById('checklistDocumentNumber').value.trim(),
            emitidoEm:document.getElementById('checklistDocumentIssuedAt').value, venceEm:document.getElementById('checklistDocumentExpiresAt').value,
            observacoes:document.getElementById('checklistDocumentNotes').value.trim(), personalizado:current ? current.personalizado : true
        });
    }
    function queueDocument(document) {
        state.documents = state.documents.filter(item => item.id !== document.id).concat(document);
        state.outbox = state.outbox.filter(item => item.documento.id !== document.id).concat({ operationId:id('op'), documento:clone(document) });
        saveState(); render(); setSyncStatus('syncing', 'Alterações aguardando envio'); syncNow().catch(() => {});
    }
    async function saveForm() {
        const draft = draftFromForm();
        if (!draft.nome) return global.AloUiDialog?.notice('Informe o nome do documento.', { title:'Nome necessário', confirmText:'Entendi' });
        const current = findDocument(draft.id);
        if ((pendingFile || removeFile) && !deps.getUrl()) return global.AloUiDialog?.notice('Configure a nuvem antes de salvar o arquivo.', { title:'Nuvem necessária', confirmText:'Entendi' });
        try {
            if (pendingFile) {
                await global.AloApi.uploadChecklistDocument(deps.getUrl(), draft.id, pendingFile.dataUrl, pendingFile.name);
                draft.arquivo = { nome:pendingFile.name, mime:pendingFile.mime, tamanho:pendingFile.size, atualizadoEm:Date.now() };
                if (pendingFile.mime?.startsWith('image/')) filePreviewCache.set(draft.id, pendingFile.dataUrl);
            } else if (removeFile) {
                await global.AloApi.deleteChecklistDocument(deps.getUrl(), draft.id);
                draft.arquivo = null;
                filePreviewCache.delete(draft.id);
            } else draft.arquivo = current?.arquivo || null;
        } catch (error) {
            return global.AloUiDialog?.notice('O arquivo não foi enviado. O cadastro permaneceu aberto.', { title:'Arquivo não enviado', confirmText:'Entendi' });
        }
        draft.revisao = Number(current?.revisao || 0) + 1;
        draft.atualizadoEm = Date.now();
        queueDocument(draft); closeForm(false); openManager();
    }
    async function deleteCurrent() {
        const current = findDocument(document.getElementById('checklistDocumentId').value);
        if (!current?.personalizado) return;
        const confirmed = await global.AloUiDialog?.confirm(`Excluir “${current.nome}”?`, { title:'Excluir documento', icon:'×', tone:'danger', confirmText:'Excluir' });
        if (!confirmed) return;
        if (current.arquivo && deps.getUrl()) global.AloApi.deleteChecklistDocument(deps.getUrl(), current.id).catch(() => {});
        filePreviewCache.delete(current.id);
        queueDocument({ ...current, excluido:true, revisao:Number(current.revisao || 0) + 1, atualizadoEm:Date.now() }); closeForm(false); openManager();
    }
    async function openFile(documentId = '') {
        const current = findDocument(documentId || document.getElementById('checklistDocumentId').value);
        try {
            const file = pendingFile || demoFile(current) || await global.AloApi.getChecklistDocumentFile(deps.getUrl(), current.id, true);
            const dataUrl = file.dataUrl || file.data || file.arquivo;
            if (!dataUrl) throw new Error('Arquivo não encontrado.');
            const response = await fetch(dataUrl);
            const blobUrl = URL.createObjectURL(await response.blob());
            const anchor = document.createElement('a');
            anchor.href = blobUrl; anchor.target = '_blank'; anchor.rel = 'noopener'; anchor.download = file.name || file.nome || current.arquivo?.nome || 'documento';
            anchor.click(); setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        } catch (error) { global.AloUiDialog?.notice(error.message || 'Não foi possível abrir o arquivo.', { title:'Arquivo indisponível', confirmText:'Entendi' }); }
    }
    function mergeRemote(remote) {
        const remoteById = new Map((Array.isArray(remote) ? remote : []).map(normalizeDocument).map(document => [document.id, document]));
        const local = new Map(state.documents.map(document => [document.id, document]));
        remoteById.forEach(document => {
            const current = local.get(document.id);
            const pending = state.outbox.some(item => item.documento.id === document.id && Number(item.documento.revisao) > Number(document.revisao));
            if (!pending && (!current || Number(document.revisao) > Number(current.revisao) || (Number(document.revisao) === Number(current.revisao) && document.atualizadoEm > current.atualizadoEm))) local.set(document.id, document);
        });
        state.documents = [...local.values()];
        state.outbox = state.outbox.filter(operation => { const confirmed = remoteById.get(operation.documento.id); return !confirmed || Number(confirmed.revisao) < Number(operation.documento.revisao); });
    }
    async function getRemote(revision) {
        const url = new URL(deps.getUrl());
        url.searchParams.set('action', 'sincronizar_documentos');
        if (revision !== '') url.searchParams.set('revision', String(revision));
        url.searchParams.set('cb', String(Date.now()));
        const response = global.AloCloud?.isEndpoint?.(url.toString())
            ? await global.AloCloud.fetch(url.toString(), { cache:'no-store' })
            : await fetch(url.toString(), { cache:'no-store' });
        if (!response.ok) throw new Error('Servidor indisponível.');
        const result = await response.json();
        if (result.status !== 'ok') throw new Error(result.message || 'Documentos não sincronizados.');
        return result;
    }
    async function performSync() {
        if (global.AloDemo?.isActive?.()) {
            state.outbox = [];
            saveState(); render();
            setSyncStatus('ok', 'Dados fictícios salvos neste aparelho');
            return true;
        }
        if (!deps.getUrl() || !navigator.onLine) { setSyncStatus('error', 'Sem conexão com o servidor'); return false; }
        if (state.outbox.length) setSyncStatus('syncing', 'Sincronizando documentos');
        if (state.outbox.length) {
            await global.AloApi.post(deps.getUrl(), { action:'salvar_documentos_lote', operacoes:state.outbox.slice(0, 30) });
            const confirmation = await getRemote('');
            if (!Array.isArray(confirmation.documentos)) throw new Error('A nuvem não devolveu os documentos esperados.');
            mergeRemote(confirmation.documentos);
            state.revision = Number(confirmation.revision || state.revision);
            if (state.outbox.length) throw new Error('A nuvem não confirmou as alterações dos documentos.');
        }
        const result = await getRemote(state.revision);
        if (result.changed && !Array.isArray(result.documentos)) throw new Error('A nuvem não devolveu os documentos esperados.');
        if (result.changed) mergeRemote(result.documentos);
        state.revision = Number(result.revision || state.revision);
        saveState(); render();
        setSyncStatus(state.outbox.length ? 'syncing' : 'ok', state.outbox.length ? 'Alterações aguardando confirmação' : 'Documentos sincronizados');
        return !state.outbox.length;
    }
    function syncNow() {
        if (syncPromise) return syncPromise;
        syncPromise = performSync().catch(error => { setSyncStatus('error', error.message); throw error; }).finally(() => { syncPromise = null; });
        return syncPromise;
    }
    function configure(options = {}) {
        deps = { ...deps, ...options };
        clearInterval(pollTimer);
        pollTimer = setInterval(() => { if (state.outbox.length || document.getElementById('checklistDocumentsView')?.style.display !== 'none') syncNow().catch(() => {}); }, POLL_MS);
        render();
        setSyncStatus(state.outbox.length ? 'syncing' : (navigator.onLine ? 'ok' : 'error'), state.outbox.length ? 'Alterações aguardando confirmação' : 'Documentos sincronizados');
    }
    function getBackup() { return { schemaVersion:1, ...clone(state) }; }
    function restoreBackup(backup) {
        if (!backup || !Array.isArray(backup.documents)) return false;
        state = { documents:backup.documents.map(normalizeDocument), outbox:Array.isArray(backup.outbox) ? backup.outbox : [], revision:Number(backup.revision || 0) };
        saveState(); render(); return true;
    }

    global.AloChecklistDocuments = Object.freeze({ configure, activate, render, openManager, closeManager, renderManager, openForm, closeForm, openDetail, closeDetail, openImageViewer, closeImageViewer, changeImageZoom, shareFile, handleFile, removeFileDraft, saveForm, deleteCurrent, openFile, syncNow, getBackup, restoreBackup });
})(window);
