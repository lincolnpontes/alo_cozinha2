const SHEET_PEDIDOS = 'Pedidos';
const SHEET_ATIVIDADES = 'Atividades';
const PROP_BANCO = 'kds_banco';
const PROP_BANCO_REVISION = 'kds_banco_revision';
const PROP_PEDIDOS_REVISION = 'kds_pedidos_revision';
const PROP_ATIVIDADES_REVISION = 'kds_atividades_revision';
const PROP_FOTOS_TAREFAS = 'kds_fotos_tarefas';
const PROP_MIGRACAO_PREFIX = 'kds_migracao_';
const PROP_SPREADSHEET_ID = 'kds_spreadsheet_id';
const PROP_PEDIDOS_SHIFT_START_PREFIX = 'kds_pedidos_shift_start_';
const PEDIDOS_SHIFT_START_HOUR = 4;
const PASTA_FOTOS_TAREFAS = 'Alô Cozinha - Fotos das Tarefas';
const NOME_PLANILHA_DADOS = 'Alô Cozinha - Banco de Dados';
const CACHE_PEDIDOS_PREFIX = 'kds_pedidos_visiveis_';
const BASE_HEADERS = ['ID', 'Produto', 'Status', 'Timestamp', 'FinalizadoEm', 'Motivo'];
const EXTRA_HEADERS = ['AtualizadoEm', 'Revisao', 'OperacaoId', 'AreaOrigem', 'AreaDestino', 'AlertaReconhecidoEm'];
const HEADERS_PEDIDOS = BASE_HEADERS.concat(EXTRA_HEADERS);
const FINAL_STATUSES = new Set(['enviado', 'buscar', 'cancelado', 'concluido']);
const VALID_STATUSES = new Set(['pendente', 'fazendo', 'enviado', 'buscar', 'cancelado', 'concluido']);
const HEADERS_ATIVIDADES = [
  'ID', 'TarefaId', 'Nome', 'SetorId', 'FuncionarioId', 'Status', 'Data', 'Horario',
  'IniciadoEm', 'FinalizadoEm', 'DuracaoSegundos', 'AlarmeStatus', 'AtualizadoEm',
  'Revisao', 'OperacaoId', 'Prioridade', 'TempoEsperadoMin', 'Observacao',
  'PermiteRemarcacao', 'RegistroPop', 'Procedimento', 'FuncionarioNome', 'RemarcadoDe', 'RemarcadoEm',
  'ProcedimentoFormato', 'ProgramacaoId'
];
const VALID_ACTIVITY_STATUSES = new Set(['pendente', 'em_execucao', 'concluida', 'nao_realizada', 'cancelada']);

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getProperties_() {
  let documentProperties = null;
  try { documentProperties = PropertiesService.getDocumentProperties(); } catch (error) {}
  return documentProperties || PropertiesService.getScriptProperties();
}

function getLock_() {
  let documentLock = null;
  try { documentLock = LockService.getDocumentLock(); } catch (error) {}
  return documentLock || LockService.getScriptLock();
}

function getSpreadsheet_() {
  let spreadsheet = null;
  try { spreadsheet = SpreadsheetApp.getActiveSpreadsheet(); } catch (error) {}
  const properties = getProperties_();
  if (spreadsheet) {
    if (!properties.getProperty(PROP_SPREADSHEET_ID)) {
      properties.setProperty(PROP_SPREADSHEET_ID, spreadsheet.getId());
    }
    return spreadsheet;
  }

  const savedId = properties.getProperty(PROP_SPREADSHEET_ID);
  if (savedId) {
    try { return SpreadsheetApp.openById(savedId); } catch (error) {}
  }

  spreadsheet = SpreadsheetApp.create(NOME_PLANILHA_DADOS);
  properties.setProperty(PROP_SPREADSHEET_ID, spreadsheet.getId());
  return spreadsheet;
}

function getPedidosSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_PEDIDOS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PEDIDOS);
    sheet.getRange(1, 1, 1, HEADERS_PEDIDOS.length).setValues([HEADERS_PEDIDOS]);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS_PEDIDOS.length).setValues([HEADERS_PEDIDOS]);
    return sheet;
  }

  const headerValues = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS_PEDIDOS.length)).getValues()[0];
  const missingExtraHeaders = EXTRA_HEADERS.some((header, index) => !headerValues[BASE_HEADERS.length + index]);
  if (missingExtraHeaders) {
    sheet.getRange(1, BASE_HEADERS.length + 1, 1, EXTRA_HEADERS.length).setValues([EXTRA_HEADERS]);
  }
  return sheet;
}

function getPedidosData_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, HEADERS_PEDIDOS.length).getValues();
}

function asIso_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}

function orderFromRow_(row) {
  return {
    id: row[0].toString(),
    produto: row[1] || '',
    status: row[2] || 'pendente',
    timestamp: asIso_(row[3]),
    finalizadoEm: asIso_(row[4]),
    motivo: row[5] || '',
    atualizadoEm: asIso_(row[6]) || asIso_(row[3]),
    revisao: Number(row[7] || 0),
    operacaoId: row[8] || '',
    areaOrigem: row[9] || 'panelas',
    areaDestino: row[10] || 'cozinha',
    alertaReconhecidoEm: asIso_(row[11])
  };
}

function getPedidosRevision_() {
  return Number(getProperties_().getProperty(PROP_PEDIDOS_REVISION) || '0');
}

function nextPedidosRevision_() {
  const revision = getPedidosRevision_() + 1;
  getProperties_().setProperty(PROP_PEDIDOS_REVISION, String(revision));
  return revision;
}

function findRecordsById_(sheet) {
  const rows = getPedidosData_(sheet);
  const records = {};
  rows.forEach((values, index) => {
    records[values[0].toString()] = { row: index + 2, values: values };
  });
  return records;
}

function mapaFotosTarefas_() {
  const raw = getProperties_().getProperty(PROP_FOTOS_TAREFAS);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (error) { return {}; }
}

function pastaFotosTarefas_() {
  const folders = DriveApp.getFoldersByName(PASTA_FOTOS_TAREFAS);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(PASTA_FOTOS_TAREFAS);
}

function salvarFotoTarefa_(tarefaId, imagem) {
  const id = String(tarefaId || '').trim();
  const match = String(imagem || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!id || !match) throw new Error('Foto inválida.');
  if (match[2].length > 2400000) throw new Error('A foto ultrapassa o limite permitido.');
  const map = mapaFotosTarefas_();
  if (map[id] && map[id].fileId) {
    try { DriveApp.getFileById(map[id].fileId).setTrashed(true); } catch (error) {}
  }
  const extension = match[1] === 'image/png' ? 'png' : (match[1] === 'image/webp' ? 'webp' : 'jpg');
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], 'tarefa-' + id + '.' + extension);
  const file = pastaFotosTarefas_().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (error) {}
  map[id] = { fileId: file.getId(), atualizadoEm: new Date().toISOString() };
  getProperties_().setProperty(PROP_FOTOS_TAREFAS, JSON.stringify(map));
  return map[id];
}

function excluirFotoTarefa_(tarefaId) {
  const id = String(tarefaId || '').trim();
  const map = mapaFotosTarefas_();
  if (map[id] && map[id].fileId) {
    try { DriveApp.getFileById(map[id].fileId).setTrashed(true); } catch (error) {}
    delete map[id];
    getProperties_().setProperty(PROP_FOTOS_TAREFAS, JSON.stringify(map));
  }
}

function fotoTarefa_(tarefaId) {
  const record = mapaFotosTarefas_()[String(tarefaId || '').trim()];
  if (!record || !record.fileId) return { status: 'ok', encontrada: false };
  return {
    status: 'ok',
    encontrada: true,
    atualizadaEm: record.atualizadoEm || '',
    url: 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(record.fileId) + '&sz=w1200'
  };
}

function asBoolean_(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function findExistingOrderIds_(sheet, ids) {
  const wanted = [...new Set((ids || []).map(String).filter(Boolean))];
  const existing = new Set();
  const lastRow = sheet.getLastRow();
  if (!wanted.length || lastRow < 2) return existing;
  const idRange = sheet.getRange(2, 1, lastRow - 1, 1);
  const escapedIds = wanted.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  idRange.createTextFinder('^(?:' + escapedIds.join('|') + ')$')
    .useRegularExpression(true)
    .findAll()
    .forEach(cell => existing.add(String(cell.getValue())));
  return existing;
}

function findRecordsByIds_(sheet, ids) {
  const wanted = [...new Set((ids || []).map(String).filter(Boolean))];
  const records = {};
  const lastRow = sheet.getLastRow();
  if (!wanted.length || lastRow < 2) return records;
  const idRange = sheet.getRange(2, 1, lastRow - 1, 1);
  const escapedIds = wanted.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  idRange.createTextFinder('^(?:' + escapedIds.join('|') + ')$')
    .useRegularExpression(true)
    .findAll()
    .forEach(cell => {
      const id = String(cell.getValue());
      const row = cell.getRow();
      records[id] = { row: row, values: sheet.getRange(row, 1, 1, HEADERS_PEDIDOS.length).getValues()[0] };
    });
  return records;
}

function appendNewOrders_(sheet, orders) {
  if (!orders || !orders.length) return { count: 0, revision: getPedidosRevision_() };
  const knownIds = findExistingOrderIds_(sheet, orders.map(order => order && order.id));
  const rows = [];
  let revision = getPedidosRevision_();

  orders.forEach(order => {
    if (!order || !order.id || !order.produto) return;
    const id = order.id.toString();
    if (knownIds.has(id)) return;
    knownIds.add(id);
    const now = new Date().toISOString();
    revision += 1;
    rows.push([
      id, order.produto, 'pendente', now, '', '', now, revision, order.operationId || '',
      order.areaOrigem || 'panelas', order.areaDestino || 'cozinha', ''
    ]);
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS_PEDIDOS.length).setValues(rows);
    getProperties_().setProperty(PROP_PEDIDOS_REVISION, String(revision));
  }
  return { count: rows.length, revision: revision };
}

function migrationKey_(migrationId) {
  const safeId = String(migrationId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!safeId) throw new Error('Identificador de migração inválido.');
  return PROP_MIGRACAO_PREFIX + safeId;
}

function saveMigrationStatus_(migrationId, report) {
  getProperties_().setProperty(
    migrationKey_(migrationId),
    JSON.stringify(Object.assign({ atualizadoEm: new Date().toISOString() }, report))
  );
}

function getMigrationStatus_(migrationId) {
  const raw = getProperties_().getProperty(migrationKey_(migrationId));
  if (!raw) return { status: 'not_found' };
  try { return JSON.parse(raw); } catch (error) { return { status: 'error', message: 'Registro de migração inválido.' }; }
}

function importBackupOrders_(sheet, orders) {
  if (!Array.isArray(orders)) throw new Error('A lista de pedidos do backup é inválida.');
  if (orders.length > 10000) throw new Error('O backup ultrapassa o limite de 10.000 pedidos por migração.');

  const knownIds = new Set(Object.keys(findRecordsById_(sheet)));
  const rows = [];
  let ignored = 0;
  let revision = getPedidosRevision_();

  orders.forEach(order => {
    if (!order || !order.id || !order.produto) {
      ignored += 1;
      return;
    }
    const id = String(order.id);
    if (knownIds.has(id)) {
      ignored += 1;
      return;
    }
    knownIds.add(id);
    revision += 1;
    const status = VALID_STATUSES.has(order.status) ? order.status : 'pendente';
    const timestamp = asIso_(order.timestamp) || new Date().toISOString();
    const updatedAt = asIso_(order.atualizadoEm) || asIso_(order.finalizadoEm) || timestamp;
    const finalizedAt = asIso_(order.finalizadoEm);
    rows.push([
      id,
      String(order.produto),
      status,
      timestamp,
      finalizedAt,
      order.motivo || '',
      updatedAt,
      revision,
      order.operacaoId || order.operationId || '',
      order.areaOrigem || 'panelas',
      order.areaDestino || 'cozinha',
      asIso_(order.alertaReconhecidoEm)
    ]);
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS_PEDIDOS.length).setValues(rows);
    getProperties_().setProperty(PROP_PEDIDOS_REVISION, String(revision));
  }
  return { imported: rows.length, ignored: ignored, revision: revision };
}

function importBackup_(sheet, params) {
  const migrationId = params.migrationId;
  saveMigrationStatus_(migrationId, { status: 'processing' });
  try {
    const properties = getProperties_();
    const currentBankRevision = Number(properties.getProperty(PROP_BANCO_REVISION) || '0');
    if (Number(params.expectedRevision || 0) !== currentBankRevision) {
      const conflict = { status: 'conflict', revision: currentBankRevision };
      saveMigrationStatus_(migrationId, conflict);
      return conflict;
    }

    const orders = Array.isArray(params.pedidos) ? params.pedidos : [];
    const activities = Array.isArray(params.atividades) ? params.atividades : [];
    if (activities.length > 10000) throw new Error('O backup ultrapassa o limite de 10.000 atividades por migração.');
    const bankResult = salvarBanco_(params.dados || {}, currentBankRevision);
    if (bankResult.status !== 'ok') {
      saveMigrationStatus_(migrationId, bankResult);
      return bankResult;
    }
    const orderResult = importBackupOrders_(sheet, orders);
    const activityResult = saveActivities_(getAtividadesSheet_(), activities);
    const report = {
      status: 'ok',
      migrationId: String(migrationId),
      produtos: Array.isArray(params.dados && params.dados.produtos) ? params.dados.produtos.length : 0,
      pedidosRecebidos: orders.length,
      pedidosImportados: orderResult.imported,
      pedidosIgnorados: orderResult.ignored,
      atividadesRecebidas: activities.length,
      atividadesImportadas: activityResult.count,
      bancoRevision: bankResult.revision,
      pedidosRevision: orderResult.revision,
      atividadesRevision: activityResult.revision
    };
    saveMigrationStatus_(migrationId, report);
    return report;
  } catch (error) {
    const report = { status: 'error', message: error.message || 'Não foi possível concluir a migração.' };
    saveMigrationStatus_(migrationId, report);
    return report;
  }
}

function applyStatus_(values, novoStatus, motivo, operationId, expectedStatus, expectedOrderRevision, revision) {
  if (!VALID_STATUSES.has(novoStatus)) throw new Error('Status inválido.');
  const currentStatus = values[2] || 'pendente';
  const currentRevision = Number(values[7] || 0);
  if (currentStatus === novoStatus) return false;
  if (expectedStatus && currentStatus !== expectedStatus) return false;
  if (expectedOrderRevision !== undefined && expectedOrderRevision !== null && currentRevision > Number(expectedOrderRevision)) return false;

  const now = new Date().toISOString();
  values[2] = novoStatus;
  values[4] = FINAL_STATUSES.has(novoStatus) ? now : '';
  values[5] = novoStatus === 'cancelado' ? (motivo || '') : values[5] || '';
  values[6] = now;
  values[7] = revision;
  values[8] = operationId || '';
  values[11] = '';
  return true;
}

function updateStatuses_(sheet, updates) {
  if (!updates || !updates.length) return 0;
  const records = findRecordsByIds_(sheet, updates.map(update => update && update.id));
  let revision = getPedidosRevision_();
  const changedRecords = [];
  updates.forEach(update => {
    if (!update || !update.id) return;
    const record = records[update.id.toString()];
    if (!record) return;
    const nextRevision = revision + 1;
    if (applyStatus_(
      record.values,
      update.novoStatus,
      update.motivo || '',
      update.operationId || '',
      update.expectedStatus,
      update.expectedOrderRevision,
      nextRevision
    )) {
      revision = nextRevision;
      changedRecords.push(record);
    }
  });
  if (!changedRecords.length) return 0;

  changedRecords.sort((a, b) => a.row - b.row);
  let group = [];
  const writeGroup = () => {
    if (!group.length) return;
    sheet.getRange(group[0].row, 1, group.length, HEADERS_PEDIDOS.length).setValues(group.map(record => record.values));
    group = [];
  };
  changedRecords.forEach(record => {
    if (group.length && record.row !== group[group.length - 1].row + 1) writeGroup();
    group.push(record);
  });
  writeGroup();
  getProperties_().setProperty(PROP_PEDIDOS_REVISION, String(revision));
  return changedRecords.length;
}

function applyAlertAcknowledgement_(values, acknowledgedAt, operationId, revision) {
  if (values[2] !== 'buscar' && values[2] !== 'cancelado') return false;
  if (values[11]) return false;
  const now = asIso_(acknowledgedAt) || new Date().toISOString();
  if (values[2] === 'buscar') values[2] = 'concluido';
  values[6] = now;
  values[7] = revision;
  values[8] = operationId || '';
  values[11] = now;
  return true;
}

function acknowledgeAlerts_(sheet, acknowledgements) {
  if (!acknowledgements || !acknowledgements.length) return 0;
  const records = findRecordsByIds_(sheet, acknowledgements.map(acknowledgement => acknowledgement && acknowledgement.id));
  let revision = getPedidosRevision_();
  const changedRecords = [];
  acknowledgements.forEach(acknowledgement => {
    if (!acknowledgement || !acknowledgement.id) return;
    const record = records[String(acknowledgement.id)];
    if (!record) return;
    const nextRevision = revision + 1;
    if (applyAlertAcknowledgement_(
      record.values,
      acknowledgement.reconhecidoEm,
      acknowledgement.operationId,
      nextRevision
    )) {
      revision = nextRevision;
      changedRecords.push(record);
    }
  });
  if (!changedRecords.length) return 0;
  changedRecords.sort((a, b) => a.row - b.row);
  let group = [];
  const writeGroup = () => {
    if (!group.length) return;
    sheet.getRange(group[0].row, 1, group.length, HEADERS_PEDIDOS.length).setValues(group.map(record => record.values));
    group = [];
  };
  changedRecords.forEach(record => {
    if (group.length && record.row !== group[group.length - 1].row + 1) writeGroup();
    group.push(record);
  });
  writeGroup();
  getProperties_().setProperty(PROP_PEDIDOS_REVISION, String(revision));
  return changedRecords.length;
}

function bancosComRevisao_() {
  const bancoStr = getProperties_().getProperty(PROP_BANCO);
  const banco = bancoStr ? JSON.parse(bancoStr) : {};
  banco._revision = Number(getProperties_().getProperty(PROP_BANCO_REVISION) || '0');
  banco._capabilities = { backupCompleto: true, atividadesBackup: true, comprasUnificadas: true };
  return banco;
}

function salvarBanco_(dados, expectedRevision) {
  const properties = getProperties_();
  const currentRevision = Number(properties.getProperty(PROP_BANCO_REVISION) || '0');
  if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== currentRevision) {
    return { status: 'conflict', revision: currentRevision };
  }
  let bancoAtual = {};
  try {
    bancoAtual = JSON.parse(properties.getProperty(PROP_BANCO) || '{}');
  } catch (error) {}
  const valorEnviadoOuAtual = (campo, padrao) => {
    if (Object.prototype.hasOwnProperty.call(dados, campo)) return dados[campo];
    return Object.prototype.hasOwnProperty.call(bancoAtual, campo) ? bancoAtual[campo] : padrao;
  };
  const bancoLimpo = {
    produtos: valorEnviadoOuAtual('produtos', []),
    categorias: valorEnviadoOuAtual('categorias', []),
    obsPedidos: valorEnviadoOuAtual('obsPedidos', []),
    obsCancelamentos: valorEnviadoOuAtual('obsCancelamentos', []),
    areas: valorEnviadoOuAtual('areas', []),
    setoresTarefas: valorEnviadoOuAtual('setoresTarefas', []),
    funcionarios: valorEnviadoOuAtual('funcionarios', []),
    tarefas: valorEnviadoOuAtual('tarefas', []),
    configsTarefas: valorEnviadoOuAtual('configsTarefas', {}),
    configs: valorEnviadoOuAtual('configs', {})
  };
  const revision = currentRevision + 1;
  properties.setProperty(PROP_BANCO, JSON.stringify(bancoLimpo));
  properties.setProperty(PROP_BANCO_REVISION, String(revision));
  return { status: 'ok', revision: revision };
}

function pedidosShiftKey_(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (isNaN(date.getTime())) return '';
  date.setTime(date.getTime() - (PEDIDOS_SHIFT_START_HOUR * 60 * 60 * 1000));
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMdd');
}

function pedidosVisiveis_(sheet) {
  const now = new Date();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const dayKey = pedidosShiftKey_(now);
  const dayStartProperty = PROP_PEDIDOS_SHIFT_START_PREFIX + dayKey;
  const properties = getProperties_();
  let todayStartRow = Number(properties.getProperty(dayStartProperty) || 0);
  if (todayStartRow < 2 || todayStartRow > lastRow + 1) {
    const timestamps = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
    const firstTodayIndex = timestamps.findIndex(row => {
      return pedidosShiftKey_(row[0]) === dayKey;
    });
    todayStartRow = firstTodayIndex >= 0 ? firstTodayIndex + 2 : lastRow + 1;
    properties.setProperty(dayStartProperty, String(todayStartRow));
  }

  const shiftRows = todayStartRow <= lastRow
    ? sheet.getRange(todayStartRow, 1, lastRow - todayStartRow + 1, HEADERS_PEDIDOS.length).getValues()
    : [];

  return shiftRows
    .map(orderFromRow_)
    .filter(order => pedidosShiftKey_(order.timestamp) === dayKey);
}

function pedidosVisiveisCached_(sheet, revision) {
  const cache = CacheService.getScriptCache();
  const key = CACHE_PEDIDOS_PREFIX + revision;
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }
  const pedidos = pedidosVisiveis_(sheet);
  try { cache.put(key, JSON.stringify(pedidos), 300); } catch (error) {}
  return pedidos;
}

function getAtividadesSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_ATIVIDADES);
  if (!sheet) sheet = ss.insertSheet(SHEET_ATIVIDADES);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS_ATIVIDADES.length).setValues([HEADERS_ATIVIDADES]);
  } else if (sheet.getLastColumn() < HEADERS_ATIVIDADES.length) {
    sheet.getRange(1, 1, 1, HEADERS_ATIVIDADES.length).setValues([HEADERS_ATIVIDADES]);
  }
  return sheet;
}

function getAtividadesData_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, HEADERS_ATIVIDADES.length).getValues();
}

function activityFromRow_(row) {
  return {
    id: String(row[0] || ''),
    tarefaId: String(row[1] || ''),
    nome: row[2] || '',
    setorId: String(row[3] || ''),
    funcionarioId: String(row[4] || ''),
    status: row[5] || 'pendente',
    data: row[6] || '',
    horario: row[7] || '',
    iniciadoEm: asIso_(row[8]),
    finalizadoEm: asIso_(row[9]),
    duracaoSegundos: Number(row[10] || 0),
    alarmeStatus: row[11] || 'aguardando',
    atualizadoEm: asIso_(row[12]),
    revisao: Number(row[13] || 0),
    operacaoId: row[14] || '',
    prioridade: row[15] || 'normal',
    tempoEsperadoMin: Number(row[16] || 0),
    observacao: row[17] || '',
    permiteRemarcacao: asBoolean_(row[18]),
    registroPop: asBoolean_(row[19]),
    procedimento: row[20] || '',
    funcionarioNome: row[21] || '',
    remarcadoDe: row[22] || '',
    remarcadoEm: asIso_(row[23]),
    procedimentoFormato: row[24] || 'texto',
    programacaoId: String(row[25] || 'principal')
  };
}

function activityToRow_(activity, revision) {
  return [
    String(activity.id || ''), String(activity.tarefaId || ''), activity.nome || '',
    String(activity.setorId || ''), String(activity.funcionarioId || ''), activity.status || 'pendente',
    activity.data || '', activity.horario || '', activity.iniciadoEm || '', activity.finalizadoEm || '',
    Number(activity.duracaoSegundos || 0), activity.alarmeStatus || 'aguardando',
    activity.atualizadoEm || new Date().toISOString(), revision, activity.operacaoId || '',
    activity.prioridade || 'normal', Number(activity.tempoEsperadoMin || 0), activity.observacao || '',
    Boolean(activity.permiteRemarcacao), Boolean(activity.registroPop), activity.procedimento || '',
    activity.funcionarioNome || '', activity.remarcadoDe || '', activity.remarcadoEm || '',
    activity.procedimentoFormato || 'texto', activity.programacaoId || 'principal'
  ];
}

function getAtividadesRevision_() {
  return Number(getProperties_().getProperty(PROP_ATIVIDADES_REVISION) || '0');
}

function saveActivities_(sheet, activities) {
  if (!activities || !activities.length) return { count: 0, revision: getAtividadesRevision_() };
  const rows = getAtividadesData_(sheet);
  const records = {};
  rows.forEach((values, index) => { records[String(values[0])] = { row: index + 2, values: values }; });
  let revision = getAtividadesRevision_();
  const changed = [];
  const appended = [];

  activities.forEach(activity => {
    if (!activity || !activity.id || !activity.nome || !VALID_ACTIVITY_STATUSES.has(activity.status || 'pendente')) return;
    const id = String(activity.id);
    const record = records[id];
    if (record) {
      const current = activityFromRow_(record.values);
      if (activity.operacaoId && current.operacaoId === activity.operacaoId) return;
      if (activity.expectedStatus && current.status !== activity.expectedStatus) return;
      const incomingTime = new Date(activity.atualizadoEm || 0).getTime();
      const currentTime = new Date(current.atualizadoEm || 0).getTime();
      if (incomingTime && currentTime && incomingTime < currentTime) return;
      revision += 1;
      record.values = activityToRow_(activity, revision);
      changed.push(record);
      return;
    }
    revision += 1;
    const values = activityToRow_(activity, revision);
    records[id] = { row: sheet.getLastRow() + appended.length + 1, values: values };
    appended.push(values);
  });

  changed.sort((a, b) => a.row - b.row);
  let group = [];
  const writeGroup = () => {
    if (!group.length) return;
    sheet.getRange(group[0].row, 1, group.length, HEADERS_ATIVIDADES.length).setValues(group.map(record => record.values));
    group = [];
  };
  changed.forEach(record => {
    if (group.length && record.row !== group[group.length - 1].row + 1) writeGroup();
    group.push(record);
  });
  writeGroup();
  if (appended.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, HEADERS_ATIVIDADES.length).setValues(appended);
  }
  if (changed.length || appended.length) {
    getProperties_().setProperty(PROP_ATIVIDADES_REVISION, String(revision));
  }
  return { count: changed.length + appended.length, revision: revision };
}

function atividadesVisiveis_(sheet) {
  const limit = new Date();
  limit.setDate(limit.getDate() - 45);
  const limitKey = Utilities.formatDate(limit, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return getAtividadesData_(sheet).map(activityFromRow_).filter(activity => {
    return activity.status === 'pendente' || activity.status === 'em_execucao' || activity.data >= limitKey;
  });
}

function filtrarHistoricoAtividades_(sheet, start, end) {
  const startKey = start ? String(start).slice(0, 10) : '';
  const endKey = end ? String(end).slice(0, 10) : '9999-12-31';
  return getAtividadesData_(sheet).map(activityFromRow_).filter(activity => {
    return activity.data >= startKey && activity.data <= endKey;
  });
}

function excluirHistoricoAtividades_() {
  const sheet = getAtividadesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  const revision = getAtividadesRevision_() + 1;
  getProperties_().setProperty(PROP_ATIVIDADES_REVISION, String(revision));
  return revision;
}

function filtrarHistorico_(sheet, start, end) {
  const startTime = start ? new Date(start).getTime() : 0;
  const endTime = end ? new Date(end).getTime() : Number.MAX_SAFE_INTEGER;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const timestamps = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
  let firstMatch = -1;
  let lastMatch = -1;
  timestamps.forEach((row, index) => {
    const timestamp = new Date(row[0]).getTime();
    if (timestamp >= startTime && timestamp <= endTime) {
      if (firstMatch === -1) firstMatch = index + 2;
      lastMatch = index + 2;
    }
  });
  if (firstMatch === -1) return [];

  return sheet.getRange(firstMatch, 1, lastMatch - firstMatch + 1, HEADERS_PEDIDOS.length).getValues()
    .map(orderFromRow_)
    .filter(order => {
      const timestamp = new Date(order.timestamp).getTime();
      return timestamp >= startTime && timestamp <= endTime;
    });
}

const SHEET_FEIRA_BANCO = 'Alô Feira - Banco';
const FEIRA_CELL_LIMIT = 45000;

function isFeiraPayload_(payload) {
  return Boolean(payload && (
    payload.app_id === 'alofeira' ||
    (payload.dados && payload.dados.app_id === 'alofeira')
  ));
}

function feiraEmptyBank_() {
  return {
    app_id: 'alofeira',
    schemaVersion: 2,
    syncRevision: 0,
    pedidosAtivos: [],
    produtos: [],
    categorias: [],
    fornecedores: [],
    colaboradores: [],
    configs: {}
  };
}

function getFeiraSheet_() {
  const spreadsheet = getSpreadsheet_();
  return spreadsheet.getSheetByName(SHEET_FEIRA_BANCO) || spreadsheet.insertSheet(SHEET_FEIRA_BANCO);
}

function readFeiraBank_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return feiraEmptyBank_();
  const values = sheet.getRange(1, 1, lastRow, 1).getDisplayValues();
  const text = values.map(row => row[0] || '').join('');
  if (!text) return feiraEmptyBank_();
  const bank = JSON.parse(text);
  if (!bank || bank.app_id !== 'alofeira') throw new Error('Banco da Lista de Compras armazenado inválido.');
  bank.syncRevision = Number(bank.syncRevision || 0);
  return bank;
}

function writeFeiraBank_(sheet, bank) {
  const text = JSON.stringify(bank);
  const parts = [];
  for (let index = 0; index < text.length; index += FEIRA_CELL_LIMIT) {
    parts.push([text.substring(index, index + FEIRA_CELL_LIMIT)]);
  }
  sheet.clearContents();
  sheet.getRange(1, 1, parts.length, 1).setValues(parts);
  SpreadsheetApp.flush();
}

function feiraCopyWithoutFields_(value, fields) {
  const copy = JSON.parse(JSON.stringify(value || {}));
  fields.forEach(field => delete copy[field]);
  return copy;
}

function feiraChangedWithoutFields_(previous, next, fields) {
  return JSON.stringify(feiraCopyWithoutFields_(previous, fields)) !== JSON.stringify(feiraCopyWithoutFields_(next, fields));
}

function feiraIndexById_(items, idField) {
  const map = {};
  (items || []).forEach(item => {
    if (item && item[idField]) map[item[idField]] = item;
  });
  return map;
}

function feiraOrderTimes_(order) {
  const summary = { idUnico: order.idUnico };
  ['dataStatus', 'dataEnvio', 'dataPedidoFornecedor', 'dataConclusao', 'dataExclusao'].forEach(field => {
    summary[field] = order[field] === undefined ? null : order[field];
  });
  return summary;
}

function applyFeiraServerTimes_(current, nextBank, now, force) {
  const result = {
    pedidosAtualizados: [],
    temposEstruturais: { produtos: [], categorias: [], fornecedores: [], colaboradores: [] },
    restauranteAtualizadoEm: null,
    configAtualizadoEm: null
  };
  if (force) return result;

  const currentOrders = feiraIndexById_(current.pedidosAtivos, 'idUnico');
  const orderTimeFields = ['dataStatus', 'dataEnvio', 'dataPedidoFornecedor', 'dataConclusao', 'dataExclusao', 'transicaoProgresso', 'statusAnterior'];
  (nextBank.pedidosAtivos || []).forEach(order => {
    const previous = currentOrders[order.idUnico];
    if (!previous || !feiraChangedWithoutFields_(previous, order, orderTimeFields)) return;
    order.dataStatus = now;
    if (previous.status !== order.status) {
      if (order.status === 'pendente' && previous.status === 'rascunho') order.dataEnvio = now;
      if (order.status === 'pedido_forn') order.dataPedidoFornecedor = now;
      if (order.status === 'comprado' || order.status === 'entregue') order.dataConclusao = now;
    }
    if (!previous.excluido && order.excluido) order.dataExclusao = now;
    result.pedidosAtualizados.push(feiraOrderTimes_(order));
  });

  ['produtos', 'categorias', 'fornecedores', 'colaboradores'].forEach(name => {
    const currentMap = feiraIndexById_(current[name], 'id');
    (nextBank[name] || []).forEach(record => {
      const previous = currentMap[record.id];
      if (!previous || !feiraChangedWithoutFields_(previous, record, ['atualizadoEm'])) return;
      record.atualizadoEm = now;
      result.temposEstruturais[name].push({ id: record.id, atualizadoEm: now });
    });
  });

  if (current.restaurante && nextBank.restaurante && feiraChangedWithoutFields_(current.restaurante, nextBank.restaurante, ['atualizadoEm'])) {
    nextBank.restaurante.atualizadoEm = now;
    result.restauranteAtualizadoEm = now;
  }
  if (feiraChangedWithoutFields_(current.configs, nextBank.configs, ['atualizadoEm', 'ultimaMudancaLocal'])) {
    nextBank.configs = nextBank.configs || {};
    nextBank.configs.atualizadoEm = now;
    result.configAtualizadoEm = now;
  }
  return result;
}

function saveNewFeiraOrders_(sheet, current, payload, currentRevision, now) {
  if (!Array.isArray(payload.pedidos) || payload.pedidos.length < 1) {
    return json_({ status: 'erro', msg: 'Nenhum pedido recebido.', serverNow: now });
  }
  const existing = feiraIndexById_(current.pedidosAtivos, 'idUnico');
  const existingProducts = feiraIndexById_(current.produtos, 'id');
  const updated = [];
  const updatedProducts = [];
  let changed = false;
  current.pedidosAtivos = current.pedidosAtivos || [];
  current.produtos = current.produtos || [];

  (payload.produtos || []).forEach(source => {
    if (!source || !source.id || existingProducts[source.id]) return;
    const product = JSON.parse(JSON.stringify(source));
    product.atualizadoEm = now;
    current.produtos.push(product);
    existingProducts[product.id] = product;
    updatedProducts.push({ id: product.id, atualizadoEm: now });
    changed = true;
  });

  payload.pedidos.forEach(source => {
    if (!source || !source.idUnico || !source.produtoId) return;
    if (existing[source.idUnico]) {
      updated.push(feiraOrderTimes_(existing[source.idUnico]));
      return;
    }
    const order = JSON.parse(JSON.stringify(source));
    order.status = 'pendente';
    order.dataEnvio = now;
    order.dataStatus = now;
    delete order.dataPedidoFornecedor;
    delete order.dataConclusao;
    delete order.dataExclusao;
    current.pedidosAtivos.push(order);
    existing[order.idUnico] = order;
    updated.push(feiraOrderTimes_(order));
    changed = true;
  });

  if (changed) {
    current.schemaVersion = 2;
    current.syncRevision = currentRevision + 1;
    writeFeiraBank_(sheet, current);
  }
  return json_({
    status: 'sucesso',
    revision: changed ? current.syncRevision : currentRevision,
    serverNow: now,
    pedidosAtualizados: updated,
    temposEstruturais: { produtos: updatedProducts, categorias: [], fornecedores: [], colaboradores: [] }
  });
}

function handleFeiraGet_(e) {
  const lock = getLock_();
  let locked = false;
  try {
    lock.waitLock(15000);
    locked = true;
    const bank = readFeiraBank_(getFeiraSheet_());
    const now = Date.now();
    if (e && e.parameter && e.parameter.meta === '1') {
      return json_({ status: 'sucesso', app_id: 'alofeira', revision: Number(bank.syncRevision || 0), serverNow: now });
    }
    bank.serverNow = now;
    return json_(bank);
  } catch (error) {
    return json_({ status: 'erro', msg: error.toString(), serverNow: Date.now() });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function handleFeiraPost_(payload) {
  const lock = getLock_();
  let locked = false;
  try {
    lock.waitLock(30000);
    locked = true;
    const sheet = getFeiraSheet_();
    const current = readFeiraBank_(sheet);
    const now = Date.now();
    const currentRevision = Number(current.syncRevision || 0);
    const usesRevision = payload.baseRevision !== undefined && payload.baseRevision !== null;
    const clientRevision = Number(payload.baseRevision || 0);

    if (!payload.force && usesRevision && clientRevision !== currentRevision) {
      return json_({
        status: 'conflito',
        msg: 'A nuvem possui uma versão mais recente.',
        revision: currentRevision,
        dados: current,
        serverNow: now
      });
    }

    if (payload.action === 'enviar_pedidos') {
      return saveNewFeiraOrders_(sheet, current, payload, currentRevision, now);
    }
    if (payload.action !== 'salvar_banco' || !payload.dados || payload.dados.app_id !== 'alofeira') {
      return json_({ status: 'erro', msg: 'Ação ou banco da Lista de Compras inválido.', serverNow: now });
    }

    const nextBank = payload.dados;
    const times = applyFeiraServerTimes_(current, nextBank, now, Boolean(payload.force));
    nextBank.schemaVersion = 2;
    nextBank.syncRevision = currentRevision + 1;
    writeFeiraBank_(sheet, nextBank);
    return json_({
      status: 'sucesso',
      revision: nextBank.syncRevision,
      serverNow: now,
      pedidosAtualizados: times.pedidosAtualizados,
      temposEstruturais: times.temposEstruturais,
      restauranteAtualizadoEm: times.restauranteAtualizadoEm,
      configAtualizadoEm: times.configAtualizadoEm
    });
  } catch (error) {
    return json_({ status: 'erro', msg: error.toString(), serverNow: Date.now() });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function doPost(e) {
  let params;
  try {
    params = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return json_({ status: 'error', message: 'Conteúdo inválido.' });
  }
  if (isFeiraPayload_(params)) return handleFeiraPost_(params);

  const lock = getLock_();
  let locked = false;
  try {
    lock.waitLock(10000);
    locked = true;
    const action = params.action;
    let sheetPedidos = null;
    const pedidosSheet = () => sheetPedidos || (sheetPedidos = getPedidosSheet_());

    if (action === 'importar_backup') {
      return json_(importBackup_(pedidosSheet(), params));
    }

    if (action === 'novo_pedido') {
      if (!params.id || !params.produto) return json_({ status: 'error', message: 'ID e produto são obrigatórios.' });
      const result = appendNewOrders_(pedidosSheet(), [params]);
      return json_({ status: 'ok', id: params.id.toString(), revision: result.revision });
    }

    if (action === 'novo_pedido_lote') {
      const result = appendNewOrders_(pedidosSheet(), params.pedidos || []);
      return json_({ status: 'ok', count: result.count, revision: result.revision });
    }

    if (action === 'atualizar_status') {
      updateStatuses_(pedidosSheet(), [{
        id: params.id,
        novoStatus: params.novoStatus,
        motivo: params.motivo || '',
        expectedStatus: params.expectedStatus,
        expectedOrderRevision: params.expectedOrderRevision,
        operationId: params.operationId || ''
      }]);
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'cancelar_pedido') {
      updateStatuses_(pedidosSheet(), [{
        id: params.id,
        novoStatus: 'cancelado',
        motivo: params.motivo || '',
        expectedStatus: params.expectedStatus,
        expectedOrderRevision: params.expectedOrderRevision,
        operationId: params.operationId || ''
      }]);
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'atualizar_status_lote') {
      updateStatuses_(pedidosSheet(), params.updates || []);
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'reconhecer_alerta') {
      acknowledgeAlerts_(pedidosSheet(), [params]);
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'reconhecer_alertas_lote') {
      acknowledgeAlerts_(pedidosSheet(), params.reconhecimentos || []);
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'excluir_pedido') {
      const activeSheet = pedidosSheet();
      const records = findRecordsByIds_(activeSheet, [params.id]);
      const record = records[(params.id || '').toString()];
      if (record) {
        activeSheet.deleteRow(record.row);
        nextPedidosRevision_();
      }
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'excluir_hoje') {
      const activeSheet = pedidosSheet();
      const data = activeSheet.getDataRange().getValues();
      const today = new Date().toDateString();
      let changed = false;
      for (let index = data.length - 1; index >= 1; index--) {
        if (new Date(data[index][3]).toDateString() === today) {
          activeSheet.deleteRow(index + 1);
          changed = true;
        }
      }
      if (changed) nextPedidosRevision_();
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'excluir_tudo') {
      const activeSheet = pedidosSheet();
      const lastRow = activeSheet.getLastRow();
      if (lastRow > 1) {
        activeSheet.deleteRows(2, lastRow - 1);
        nextPedidosRevision_();
      }
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'salvar_atividade' || action === 'salvar_atividades_lote') {
      const sheetAtividades = getAtividadesSheet_();
      const activities = action === 'salvar_atividade' ? [params.atividade || {}] : (params.atividades || []);
      const result = saveActivities_(sheetAtividades, activities);
      return json_({ status: 'ok', count: result.count, revision: result.revision });
    }

    if (action === 'excluir_historico_atividades') {
      return json_({ status: 'ok', revision: excluirHistoricoAtividades_() });
    }

    if (action === 'salvar_foto_tarefa') {
      const photo = salvarFotoTarefa_(params.tarefaId, params.imagem);
      return json_({ status: 'ok', foto: photo });
    }

    if (action === 'excluir_foto_tarefa') {
      excluirFotoTarefa_(params.tarefaId);
      return json_({ status: 'ok' });
    }

    if (action === 'salvar_banco') {
      return json_(salvarBanco_(params.dados || {}, params.expectedRevision));
    }

    return json_({ status: 'error', message: 'Ação não encontrada.' });
  } catch (error) {
    return json_({ status: 'error', message: error.message });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.app === 'alofeira') return handleFeiraGet_(e);
  const action = e && e.parameter ? e.parameter.action : '';
  if (action === 'carregar_banco') return json_(bancosComRevisao_());
  if (action === 'foto_tarefa') return json_(fotoTarefa_(e.parameter.tarefaId));
  if (action === 'status_migracao') return json_(getMigrationStatus_(e.parameter.migrationId));

  if (action === 'sincronizar_atividades') {
    const revision = getAtividadesRevision_();
    if (String(e.parameter.revision || '') === String(revision)) {
      return json_({ status: 'ok', changed: false, revision: revision, serverTime: new Date().toISOString() });
    }
    return json_({
      status: 'ok', changed: true, revision: revision, serverTime: new Date().toISOString(),
      atividades: atividadesVisiveis_(getAtividadesSheet_())
    });
  }

  if (action === 'historico_atividades') {
    return json_({
      status: 'ok',
      revision: getAtividadesRevision_(),
      atividades: filtrarHistoricoAtividades_(getAtividadesSheet_(), e.parameter.start, e.parameter.end)
    });
  }

  if (action === 'sincronizar') {
    const revision = getPedidosRevision_();
    if (String(e.parameter.revision || '') === String(revision)) {
      return json_({
        status: 'ok', changed: false, revision: revision, serverTime: new Date().toISOString(),
        capabilities: { novoPedidoLote: true, reconhecimentoAlerta: true }
      });
    }
    const sheetPedidos = getPedidosSheet_();
    return json_({
      status: 'ok',
      changed: true,
      revision: revision,
      serverTime: new Date().toISOString(),
      capabilities: { novoPedidoLote: true, reconhecimentoAlerta: true },
      pedidos: pedidosVisiveisCached_(sheetPedidos, revision)
    });
  }

  if (action === 'historico') {
    return json_({ status: 'ok', pedidos: filtrarHistorico_(getPedidosSheet_(), e.parameter.start, e.parameter.end) });
  }

  const sheetPedidos = getPedidosSheet_();
  return json_(getPedidosData_(sheetPedidos).map(orderFromRow_));
}

function resgatarMeusDados() {
  const dados = getProperties_().getProperty(PROP_BANCO);
  const aba = getSpreadsheet_().getSheets()[0];
  aba.getRange('H1').setValue(dados || 'NENHUM DADO ENCONTRADO');
}
