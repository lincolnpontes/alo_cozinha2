(function (global) {
    const STORAGE_KEY = 'alo_checklist_documents_v1';
    const POLL_MS = 9000;
    const MAX_PDF_BYTES = 3 * 1024 * 1024;
    const CATEGORIES = ['Licenças', 'Sanitário', 'Pessoas', 'Água', 'Pragas', 'Incêndio', 'Ambiental', 'Resíduos', 'Operação', 'Outros'];
    const CATALOG = [
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
                nome: String(source.arquivo.nome || ''), mime: String(source.arquivo.mime || ''), tamanho: Number(source.arquivo.tamanho || 0), atualizadoEm: Number(source.arquivo.atualizadoEm || 0)
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
    function render() {
        const target = document.getElementById('checklistDocumentsList');
        if (!target) return;
        const query = normalizeSearch(document.getElementById('checklistDocumentsSearch')?.value);
        const documents = visibleDocuments().filter(document => !query || normalizeSearch(`${document.nome} ${document.orgao} ${taskName(document.tarefaId)}`).includes(query))
            .sort((left, right) => left.nome.localeCompare(right.nome));
        const statusCounts = documents.reduce((counts, document) => { const status = statusFor(document).key; counts[status] = (counts[status] || 0) + 1; return counts; }, {});
        const summary = document.getElementById('checklistDocumentsSummary');
        if (summary) summary.textContent = `${documents.length} documentos · ${statusCounts.vencido || 0} vencidos · ${statusCounts.vencendo || 0} vencendo`;
        target.innerHTML = documents.length ? documents.map(document => {
            const status = statusFor(document);
            const linkedTask = taskName(document.tarefaId);
            const fileState = document.arquivo ? (document.arquivo.nome || 'Arquivo anexado') : 'Documento ainda não cadastrado';
            return `<button type="button" class="document-card ${status.key}" onclick="AloChecklistDocuments.openForm('${escapeHtml(document.id)}', 'view')"><span class="document-card-icon" aria-hidden="true">${document.sensivel ? '🔒' : '📄'}</span><span class="document-card-copy"><strong>${escapeHtml(document.nome)}</strong>${linkedTask ? `<span>Atividade: ${escapeHtml(linkedTask)}</span>` : ''}<small>${escapeHtml(fileState)}</small></span><span class="document-status ${status.key}">${escapeHtml(status.label)}</span></button>`;
        }).join('') : '<div class="tasks-empty">Nenhum documento encontrado.</div>';
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
            return `<button type="button" class="technical-manager-item document-manager-item" onclick="AloChecklistDocuments.openForm('${escapeHtml(document.id)}', 'manager')"><span><strong>${escapeHtml(document.nome)}</strong><small>${linkedTask ? `Atividade: ${escapeHtml(linkedTask)}` : statusFor(document).label}</small></span><b aria-hidden="true">✎</b></button>`;
        }).join('') : '<div class="tasks-empty">Nenhum documento encontrado.</div>';
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
                const dataUrl = await global.AloTasks.compressPhoto(file);
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
            } else if (removeFile) {
                await global.AloApi.deleteChecklistDocument(deps.getUrl(), draft.id);
                draft.arquivo = null;
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
        queueDocument({ ...current, excluido:true, revisao:Number(current.revisao || 0) + 1, atualizadoEm:Date.now() }); closeForm(false); openManager();
    }
    async function openFile() {
        const current = findDocument(document.getElementById('checklistDocumentId').value);
        try {
            const file = pendingFile || await global.AloApi.getChecklistDocumentFile(deps.getUrl(), current.id, true);
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
        const response = await fetch(url.toString(), { cache:'no-store' });
        if (!response.ok) throw new Error('Servidor indisponível.');
        const result = await response.json();
        if (result.status !== 'ok') throw new Error(result.message || 'Documentos não sincronizados.');
        return result;
    }
    async function performSync() {
        if (!deps.getUrl() || !navigator.onLine) { setSyncStatus('error', 'Sem conexão com o servidor'); return false; }
        if (state.outbox.length) setSyncStatus('syncing', 'Sincronizando documentos');
        if (state.outbox.length) {
            await global.AloApi.post(deps.getUrl(), { action:'salvar_documentos_lote', operacoes:state.outbox.slice(0, 30) });
            const confirmation = await getRemote('');
            if (!Array.isArray(confirmation.documentos)) throw new Error('Atualize a implantação do Google Apps Script para sincronizar documentos.');
            mergeRemote(confirmation.documentos);
            state.revision = Number(confirmation.revision || state.revision);
            if (state.outbox.length) throw new Error('A nuvem não confirmou as alterações dos documentos.');
        }
        const result = await getRemote(state.revision);
        if (result.changed && !Array.isArray(result.documentos)) throw new Error('Atualize a implantação do Google Apps Script para sincronizar documentos.');
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

    global.AloChecklistDocuments = Object.freeze({ configure, activate, render, openManager, closeManager, renderManager, openForm, closeForm, handleFile, removeFileDraft, saveForm, deleteCurrent, openFile, syncNow, getBackup, restoreBackup });
})(window);
