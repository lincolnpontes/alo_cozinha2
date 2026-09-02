import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.112.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-alo-device-id, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const VALID_ORDER_STATUSES = new Set(["pendente", "fazendo", "enviado", "buscar", "cancelado", "concluido"]);
const FINAL_ORDER_STATUSES = new Set(["enviado", "buscar", "cancelado", "concluido"]);
const VALID_ACTIVITY_STATUSES = new Set(["pendente", "em_execucao", "concluida", "nao_realizada", "cancelada"]);
const PRIVATE_BUCKET = "alo-cozinha-private";

type JsonObject = Record<string, any>;
type CloudContext = {
  userId: string;
  deviceId: string;
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function cleanId(value: unknown, fallback = "item"): string {
  const result = String(value || "").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 140);
  return result || fallback;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateMs(value: unknown): number {
  const result = new Date(String(value || "")).getTime();
  return Number.isFinite(result) ? result : 0;
}

function operationFingerprint(item: JsonObject, id: unknown): string {
  const hasAttemptFingerprint = item?.novoStatus !== undefined
    || item?.expectedOrderRevision !== undefined
    || item?.expectedStatus !== undefined
    || item?.receiptAttempt !== undefined;
  if (!hasAttemptFingerprint) return String(id);
  return [id, item.expectedOrderRevision ?? "", item.expectedStatus ?? "", item.novoStatus ?? "", item.receiptAttempt ?? ""]
    .map((part) => String(part).replace(/[|@]/g, "-"))
    .join("@");
}

function operationId(payload: JsonObject, prefix: string): string {
  const direct = payload.operationId || payload.operacaoId;
  if (direct) return operationFingerprint(payload, direct).slice(0, 240);
  const nested = [
    ...(Array.isArray(payload.updates) ? payload.updates : []),
    ...(Array.isArray(payload.reconhecimentos) ? payload.reconhecimentos : []),
    ...(Array.isArray(payload.pedidos) ? payload.pedidos : []),
    ...(Array.isArray(payload.atividades) ? payload.atividades : []),
    ...(Array.isArray(payload.operacoes) ? payload.operacoes : []),
  ].map((item) => {
    const id = item?.operationId || item?.operacaoId || item?.id;
    if (!id) return "";
    return operationFingerprint(item, id);
  }).filter(Boolean);
  return nested.length ? `${prefix}:${nested.join("|")}`.slice(0, 240) : "";
}

async function context(req: Request): Promise<CloudContext> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("authentication required");

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new Error("invalid session");

  return {
    userId: data.user.id,
    deviceId: cleanId(req.headers.get("x-alo-device-id") || "web", "web"),
    userClient,
    serviceClient: createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function readState(ctx: CloudContext, module: string): Promise<JsonObject> {
  const { data, error } = await ctx.userClient.schema("api").rpc("get_module_state", { p_module: module });
  if (error) throw error;
  return data || { exists: false, payload: {}, revision: 0 };
}

async function writeState(
  ctx: CloudContext,
  module: string,
  baseRevision: number,
  payload: JsonObject,
  opId = "",
  force = false,
): Promise<JsonObject> {
  const { data, error } = await ctx.userClient.schema("api").rpc("sync_module_state", {
    p_module: module,
    p_base_revision: baseRevision,
    p_payload: payload,
    p_device_id: ctx.deviceId,
    p_operation_id: opId || null,
    p_force: force,
  });
  if (error) throw error;
  return data;
}

async function mutateState(
  ctx: CloudContext,
  module: string,
  opId: string,
  mutate: (payload: JsonObject, revision: number) => JsonObject,
): Promise<JsonObject> {
  let current = await readState(ctx, module);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const nextPayload = mutate(clone(current.payload || {}), asNumber(current.revision));
    const saved = await writeState(ctx, module, asNumber(current.revision), nextPayload, opId);
    if (saved.status !== "conflict") return saved;
    current = saved;
  }
  throw new Error("Os dados mudaram muitas vezes durante a gravação. Tente novamente.");
}

function shiftKey(value: unknown): string {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  date.setTime(date.getTime() - 4 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function visibleOrders(orders: JsonObject[]): JsonObject[] {
  const today = shiftKey(new Date().toISOString());
  return orders.filter((order) => shiftKey(order.timestamp) === today);
}

function orderFromPayload(source: JsonObject, revision: number): JsonObject {
  const now = new Date().toISOString();
  return {
    id: String(source.id),
    produto: String(source.produto || ""),
    status: "pendente",
    timestamp: now,
    finalizadoEm: "",
    motivo: "",
    atualizadoEm: now,
    revisao: revision,
    operacaoId: source.operationId || source.operacaoId || "",
    areaOrigem: source.areaOrigem || "panelas",
    areaDestino: source.areaDestino || "cozinha",
    alertaReconhecidoEm: "",
  };
}

function applyOrderStatus(order: JsonObject, update: JsonObject, revision: number): boolean {
  const next = String(update.novoStatus || "");
  if (!VALID_ORDER_STATUSES.has(next) || order.status === next) return false;
  if (update.expectedStatus && order.status !== update.expectedStatus) return false;
  if (update.expectedOrderRevision !== undefined && asNumber(order.revisao) > asNumber(update.expectedOrderRevision)) return false;
  const now = new Date().toISOString();
  order.status = next;
  order.finalizadoEm = FINAL_ORDER_STATUSES.has(next) ? now : "";
  if (next === "cancelado") order.motivo = update.motivo || "";
  order.atualizadoEm = now;
  order.revisao = revision;
  order.operacaoId = update.operationId || update.operacaoId || "";
  order.alertaReconhecidoEm = "";
  return true;
}

function acknowledgeOrder(order: JsonObject, acknowledgement: JsonObject, revision: number): boolean {
  if (!['buscar', 'cancelado'].includes(order.status) || order.alertaReconhecidoEm) return false;
  const now = new Date(acknowledgement.reconhecidoEm || Date.now()).toISOString();
  if (order.status === "buscar") order.status = "concluido";
  order.atualizadoEm = now;
  order.revisao = revision;
  order.operacaoId = acknowledgement.operationId || "";
  order.alertaReconhecidoEm = now;
  return true;
}

async function handleKdsPost(ctx: CloudContext, body: JsonObject): Promise<Response> {
  const action = String(body.action || "");
  const opId = operationId(body, `kds:${action}`);
  const saved = await mutateState(ctx, "kds", opId, (payload, currentRevision) => {
    const orders = Array.isArray(payload.pedidos) ? payload.pedidos : [];
    const nextRevision = currentRevision + 1;
    if (action === "novo_pedido" || action === "novo_pedido_lote") {
      const incoming = action === "novo_pedido" ? [body] : (body.pedidos || []);
      const known = new Set(orders.map((order: JsonObject) => String(order.id)));
      incoming.forEach((source: JsonObject) => {
        if (!source?.id || !source?.produto || known.has(String(source.id))) return;
        orders.push(orderFromPayload(source, nextRevision));
        known.add(String(source.id));
      });
    } else if (["atualizar_status", "cancelar_pedido", "atualizar_status_lote"].includes(action)) {
      const updates = action === "atualizar_status_lote" ? (body.updates || []) : [{
        ...body, novoStatus: action === "cancelar_pedido" ? "cancelado" : body.novoStatus,
      }];
      const byId = new Map(orders.map((order: JsonObject) => [String(order.id), order]));
      updates.forEach((update: JsonObject) => {
        const order = byId.get(String(update.id));
        if (order) applyOrderStatus(order, update, nextRevision);
      });
    } else if (["reconhecer_alerta", "reconhecer_alertas_lote"].includes(action)) {
      const items = action === "reconhecer_alerta" ? [body] : (body.reconhecimentos || []);
      const byId = new Map(orders.map((order: JsonObject) => [String(order.id), order]));
      items.forEach((item: JsonObject) => {
        const order = byId.get(String(item.id));
        if (order) acknowledgeOrder(order, item, nextRevision);
      });
    } else if (action === "excluir_pedido") {
      payload.pedidos = orders.filter((order: JsonObject) => String(order.id) !== String(body.id));
      return payload;
    } else if (action === "excluir_hoje") {
      const today = shiftKey(new Date().toISOString());
      payload.pedidos = orders.filter((order: JsonObject) => shiftKey(order.timestamp) !== today);
      return payload;
    } else if (action === "excluir_tudo") {
      payload.pedidos = [];
      return payload;
    } else {
      throw new Error("Ação KDS desconhecida.");
    }
    payload.pedidos = orders;
    return payload;
  });
  return json({ status: "ok", revision: saved.revision });
}

async function handleKdsGet(ctx: CloudContext, url: URL): Promise<Response> {
  const action = url.searchParams.get("action") || "";
  const state = await readState(ctx, "kds");
  const orders = Array.isArray(state.payload?.pedidos) ? state.payload.pedidos : [];
  const revision = asNumber(state.revision);
  if (action === "historico") {
    const start = dateMs(url.searchParams.get("start"));
    const end = dateMs(url.searchParams.get("end")) || Number.MAX_SAFE_INTEGER;
    return json({ status: "ok", pedidos: orders.filter((order: JsonObject) => {
      const timestamp = dateMs(order.timestamp);
      return timestamp >= start && timestamp <= end;
    }) });
  }
  if (action === "estatisticas_produtos") {
    const cutoff = Date.now() - 30 * 86400000;
    const porArea: JsonObject = {};
    orders.forEach((order: JsonObject) => {
      if (dateMs(order.timestamp) < cutoff || order.status === "cancelado") return;
      const area = String(order.areaOrigem || "panelas");
      const product = String(order.produto || "").split(" (Obs:")[0];
      porArea[area] ||= {};
      porArea[area][product] = asNumber(porArea[area][product]) + 1;
    });
    return json({ status: "ok", periodoDias: 30, porArea, atualizadoEm: new Date().toISOString() });
  }
  if (action === "sincronizar") {
    const unchanged = String(url.searchParams.get("revision") || "") === String(revision);
    return json({
      status: "ok", changed: !unchanged, revision, serverTime: new Date().toISOString(),
      capabilities: { novoPedidoLote: true, reconhecimentoAlerta: true, realtime: true },
      ...(!unchanged ? { pedidos: visibleOrders(orders) } : {}),
    });
  }
  return json(visibleOrders(orders));
}

function activityIsNewer(incoming: JsonObject, current?: JsonObject): boolean {
  if (!current) return true;
  if (incoming.operacaoId && incoming.operacaoId === current.operacaoId) return false;
  if (incoming.expectedStatus && current.status !== incoming.expectedStatus) return false;
  const incomingTime = dateMs(incoming.atualizadoEm);
  const currentTime = dateMs(current.atualizadoEm);
  return !incomingTime || !currentTime || incomingTime >= currentTime;
}

async function handleChecklistPost(ctx: CloudContext, body: JsonObject): Promise<Response> {
  const action = String(body.action || "");
  if (!["salvar_atividade", "salvar_atividades_lote", "excluir_historico_atividades"].includes(action)) {
    throw new Error("Ação de atividades desconhecida.");
  }
  const saved = await mutateState(ctx, "checklist", operationId(body, `checklist:${action}`), (payload, revision) => {
    if (action === "excluir_historico_atividades") return { atividades: [] };
    const activities = Array.isArray(payload.atividades) ? payload.atividades : [];
    const byId = new Map(activities.map((activity: JsonObject) => [String(activity.id), activity]));
    const incoming = action === "salvar_atividade" ? [body.atividade || {}] : (body.atividades || []);
    incoming.forEach((activity: JsonObject) => {
      if (!activity?.id || !activity?.nome || !VALID_ACTIVITY_STATUSES.has(activity.status || "pendente")) return;
      const current = byId.get(String(activity.id));
      if (!activityIsNewer(activity, current)) return;
      byId.set(String(activity.id), { ...clone(activity), revisao: revision + 1 });
    });
    payload.atividades = [...byId.values()];
    return payload;
  });
  return json({ status: "ok", revision: saved.revision });
}

async function handleChecklistGet(ctx: CloudContext, url: URL): Promise<Response> {
  const state = await readState(ctx, "checklist");
  const activities = Array.isArray(state.payload?.atividades) ? state.payload.atividades : [];
  const revision = asNumber(state.revision);
  const action = url.searchParams.get("action") || "";
  if (action === "historico_atividades") {
    const start = String(url.searchParams.get("start") || "").slice(0, 10);
    const end = String(url.searchParams.get("end") || "9999-12-31").slice(0, 10);
    return json({ status: "ok", revision, atividades: activities.filter((item: JsonObject) => item.data >= start && item.data <= end) });
  }
  const unchanged = String(url.searchParams.get("revision") || "") === String(revision);
  const cutoff = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  return json({
    status: "ok", changed: !unchanged, revision, serverTime: new Date().toISOString(),
    ...(!unchanged ? { atividades: activities.filter((item: JsonObject) => ["pendente", "em_execucao"].includes(item.status) || item.data >= cutoff) } : {}),
  });
}

function mergeVersionedItems(current: JsonObject[], operations: JsonObject[], field: string): JsonObject[] {
  const byId = new Map(current.filter((item) => item?.id).map((item) => [String(item.id), item]));
  operations.forEach((operation) => {
    const incoming = operation?.[field];
    if (!incoming?.id) return;
    const existing = byId.get(String(incoming.id));
    const newer = !existing || asNumber(incoming.revisao) > asNumber(existing.revisao)
      || (asNumber(incoming.revisao) === asNumber(existing.revisao) && asNumber(incoming.atualizadoEm) > asNumber(existing.atualizadoEm));
    if (newer) byId.set(String(incoming.id), clone(incoming));
  });
  return [...byId.values()];
}

async function handleAuxiliaryPost(ctx: CloudContext, body: JsonObject): Promise<Response | null> {
  const action = String(body.action || "");
  const spec = action === "salvar_fichas_tecnicas_lote"
    ? { module: "technical_sheets", list: "fichas", field: "ficha" }
    : action === "salvar_documentos_lote"
      ? { module: "documents", list: "documentos", field: "documento" }
      : null;
  if (!spec) return null;
  const saved = await mutateState(ctx, spec.module, operationId(body, `${spec.module}:save`), (payload) => {
    payload[spec.list] = mergeVersionedItems(Array.isArray(payload[spec.list]) ? payload[spec.list] : [], body.operacoes || [], spec.field);
    return payload;
  });
  return json({ status: "ok", revision: saved.revision });
}

async function handleAuxiliaryGet(ctx: CloudContext, url: URL): Promise<Response | null> {
  const action = url.searchParams.get("action") || "";
  const spec = action === "sincronizar_fichas_tecnicas"
    ? { module: "technical_sheets", list: "fichas" }
    : action === "sincronizar_documentos"
      ? { module: "documents", list: "documentos" }
      : null;
  if (!spec) return null;
  const state = await readState(ctx, spec.module);
  const revision = asNumber(state.revision);
  const unchanged = String(url.searchParams.get("revision") || "") === String(revision);
  return json({
    status: "ok", changed: !unchanged, revision, serverTime: new Date().toISOString(),
    ...(!unchanged ? { [spec.list]: Array.isArray(state.payload?.[spec.list]) ? state.payload[spec.list] : [] } : {}),
  });
}

function parseDataUrl(value: unknown, allowed: RegExp, maxBytes: number): { mime: string; bytes: Uint8Array; extension: string } {
  const match = String(value || "").match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !allowed.test(match[1])) throw new Error("Arquivo inválido.");
  const binary = atob(match[2]);
  if (binary.length > maxBytes) throw new Error("O arquivo ultrapassa o limite permitido.");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const extension = match[1] === "application/pdf" ? "pdf" : match[1].split("/")[1].replace("jpeg", "jpg");
  return { mime: match[1], bytes, extension };
}

async function removeEntityFiles(ctx: CloudContext, folder: string): Promise<void> {
  const { data } = await ctx.serviceClient.storage.from(PRIVATE_BUCKET).list(folder, { limit: 20 });
  const paths = (data || []).map((file) => `${folder}/${file.name}`);
  if (paths.length) await ctx.serviceClient.storage.from(PRIVATE_BUCKET).remove(paths);
}

async function uploadPrivateFile(
  ctx: CloudContext,
  kind: "tasks" | "documents",
  entityId: string,
  dataUrl: unknown,
  fileName?: string,
): Promise<JsonObject> {
  const parsed = parseDataUrl(
    dataUrl,
    kind === "tasks" ? /^image\/(jpeg|png|webp)$/ : /^(image\/(jpeg|png|webp)|application\/pdf)$/,
    kind === "tasks" ? 2_400_000 : 6_000_000,
  );
  const folder = `${ctx.userId}/${kind}/${cleanId(entityId)}`;
  await removeEntityFiles(ctx, folder);
  const safeName = cleanId(fileName || `${kind}.${parsed.extension}`, `${kind}.${parsed.extension}`);
  const path = `${folder}/${safeName.endsWith(`.${parsed.extension}`) ? safeName : `${safeName}.${parsed.extension}`}`;
  const { error } = await ctx.serviceClient.storage.from(PRIVATE_BUCKET).upload(path, parsed.bytes, {
    contentType: parsed.mime, upsert: true, cacheControl: "3600",
  });
  if (error) throw error;
  return { path, nome: safeName, mime: parsed.mime, tamanho: parsed.bytes.length, atualizadoEm: new Date().toISOString() };
}

async function mutateFileMetadata(ctx: CloudContext, key: "taskPhotos" | "files", id: string, metadata: JsonObject | null): Promise<void> {
  await mutateState(ctx, "documents", `file:${key}:${cleanId(id)}:${metadata?.atualizadoEm || "delete"}`, (payload) => {
    payload[key] = payload[key] && typeof payload[key] === "object" ? payload[key] : {};
    if (metadata) payload[key][id] = metadata;
    else delete payload[key][id];
    return payload;
  });
}

async function getFileMetadata(ctx: CloudContext, key: "taskPhotos" | "files", id: string): Promise<JsonObject | null> {
  const state = await readState(ctx, "documents");
  return state.payload?.[key]?.[id] || null;
}

async function signedFile(ctx: CloudContext, metadata: JsonObject): Promise<string> {
  const { data, error } = await ctx.serviceClient.storage.from(PRIVATE_BUCKET).createSignedUrl(metadata.path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

async function dataUrlForFile(ctx: CloudContext, metadata: JsonObject): Promise<string> {
  const { data, error } = await ctx.serviceClient.storage.from(PRIVATE_BUCKET).download(metadata.path);
  if (error) throw error;
  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${metadata.mime};base64,${btoa(binary)}`;
}

async function handleFilePost(ctx: CloudContext, body: JsonObject): Promise<Response | null> {
  const action = String(body.action || "");
  if (action === "salvar_foto_tarefa") {
    const metadata = await uploadPrivateFile(ctx, "tasks", body.tarefaId, body.imagem);
    await mutateFileMetadata(ctx, "taskPhotos", String(body.tarefaId), metadata);
    return json({ status: "ok", foto: metadata });
  }
  if (action === "excluir_foto_tarefa") {
    const metadata = await getFileMetadata(ctx, "taskPhotos", String(body.tarefaId));
    if (metadata?.path) await ctx.serviceClient.storage.from(PRIVATE_BUCKET).remove([metadata.path]);
    await mutateFileMetadata(ctx, "taskPhotos", String(body.tarefaId), null);
    return json({ status: "ok" });
  }
  if (action === "salvar_arquivo_documento") {
    const metadata = await uploadPrivateFile(ctx, "documents", body.documentoId, body.arquivo, body.nomeArquivo);
    await mutateFileMetadata(ctx, "files", String(body.documentoId), metadata);
    return json({ status: "ok", arquivo: metadata });
  }
  if (action === "excluir_arquivo_documento") {
    const metadata = await getFileMetadata(ctx, "files", String(body.documentoId));
    if (metadata?.path) await ctx.serviceClient.storage.from(PRIVATE_BUCKET).remove([metadata.path]);
    await mutateFileMetadata(ctx, "files", String(body.documentoId), null);
    return json({ status: "ok" });
  }
  return null;
}

async function handleFileGet(ctx: CloudContext, url: URL): Promise<Response | null> {
  const action = url.searchParams.get("action") || "";
  if (action === "foto_tarefa") {
    const metadata = await getFileMetadata(ctx, "taskPhotos", String(url.searchParams.get("tarefaId") || ""));
    if (!metadata) return json({ status: "ok", encontrada: false });
    return json({ status: "ok", encontrada: true, atualizadaEm: metadata.atualizadoEm, url: await signedFile(ctx, metadata) });
  }
  if (action === "arquivo_documento") {
    const metadata = await getFileMetadata(ctx, "files", String(url.searchParams.get("documentoId") || ""));
    if (!metadata) return json({ status: "ok", encontrada: false });
    const result: JsonObject = { status: "ok", encontrada: true, ...metadata };
    if (url.searchParams.get("dados") === "1") result.dataUrl = await dataUrlForFile(ctx, metadata);
    else result.url = await signedFile(ctx, metadata);
    return json(result);
  }
  return null;
}

function taskVersion(task: JsonObject): number {
  return asNumber(task?.revisaoDefinicao ?? task?.atualizadoEm);
}

function mergeTasks(current: JsonObject[], incoming: JsonObject[]): JsonObject[] {
  const map = new Map(current.filter((task) => task?.id).map((task) => [String(task.id), task]));
  incoming.forEach((task) => {
    if (!task?.id) return;
    const existing = map.get(String(task.id));
    if (!existing || taskVersion(task) >= taskVersion(existing)) map.set(String(task.id), task);
  });
  return [...map.values()];
}

function catalogPayload(current: JsonObject, incoming: JsonObject): JsonObject {
  const value = (key: string, fallback: unknown) => Object.prototype.hasOwnProperty.call(incoming, key)
    ? incoming[key]
    : (Object.prototype.hasOwnProperty.call(current, key) ? current[key] : fallback);
  return {
    produtos: value("produtos", []), categorias: value("categorias", []),
    obsPedidos: value("obsPedidos", []), obsCancelamentos: value("obsCancelamentos", []),
    areas: value("areas", []), setoresTarefas: value("setoresTarefas", []),
    funcionarios: value("funcionarios", []),
    tarefas: Object.prototype.hasOwnProperty.call(incoming, "tarefas")
      ? mergeTasks(Array.isArray(current.tarefas) ? current.tarefas : [], incoming.tarefas || [])
      : value("tarefas", []),
    coreCompartilhado: value("coreCompartilhado", null),
    configsTarefas: value("configsTarefas", {}), configs: value("configs", {}),
  };
}

async function handleCatalogPost(ctx: CloudContext, body: JsonObject): Promise<Response> {
  const current = await readState(ctx, "catalog");
  const expected = body.expectedRevision === undefined ? asNumber(current.revision) : asNumber(body.expectedRevision);
  if (expected !== asNumber(current.revision)) return json({ status: "conflict", revision: current.revision });
  const next = catalogPayload(current.payload || {}, body.dados || {});
  const saved = await writeState(ctx, "catalog", expected, next, operationId(body, "catalog:save"));
  if (saved.status === "conflict") return json({ status: "conflict", revision: saved.revision });
  return json({ status: "ok", revision: saved.revision });
}

async function handleCatalogGet(ctx: CloudContext): Promise<Response> {
  const state = await readState(ctx, "catalog");
  return json({
    ...catalogPayload({}, state.payload || {}),
    _revision: asNumber(state.revision),
    _capabilities: {
      backupCompleto: true, atividadesBackup: true, comprasUnificadas: true,
      dadosCompartilhados: true, etiquetasUnificadas: true,
      fichasTecnicas: true, documentosChecklist: true, supabase: true, realtime: true,
    },
  });
}

function feiraEmpty(): JsonObject {
  return { app_id: "alofeira", schemaVersion: 2, syncRevision: 0, pedidosAtivos: [], produtos: [], categorias: [], fornecedores: [], colaboradores: [], configs: {} };
}

function changedIgnoring(previous: JsonObject, next: JsonObject, fields: string[]): boolean {
  const left = clone(previous || {}); const right = clone(next || {});
  fields.forEach((field) => { delete left[field]; delete right[field]; });
  return JSON.stringify(left) !== JSON.stringify(right);
}

function indexBy(items: JsonObject[], field: string): Map<string, JsonObject> {
  return new Map((items || []).filter((item) => item?.[field]).map((item) => [String(item[field]), item]));
}

function applyFeiraTimes(current: JsonObject, next: JsonObject, now: number, force: boolean): JsonObject {
  const result: JsonObject = { pedidosAtualizados: [], temposEstruturais: { produtos: [], categorias: [], fornecedores: [], colaboradores: [] }, restauranteAtualizadoEm: null, configAtualizadoEm: null };
  if (force) return result;
  const currentOrders = indexBy(current.pedidosAtivos || [], "idUnico");
  (next.pedidosAtivos || []).forEach((order: JsonObject) => {
    const previous = currentOrders.get(String(order.idUnico));
    if (!previous || !changedIgnoring(previous, order, ["dataStatus", "dataEnvio", "dataPedidoFornecedor", "dataConclusao", "dataExclusao", "transicaoProgresso", "statusAnterior"])) return;
    order.dataStatus = now;
    if (previous.status !== order.status) {
      if (order.status === "pendente" && previous.status === "rascunho") order.dataEnvio = now;
      if (order.status === "pedido_forn") order.dataPedidoFornecedor = now;
      if (["comprado", "entregue"].includes(order.status)) order.dataConclusao = now;
    }
    if (!previous.excluido && order.excluido) order.dataExclusao = now;
    result.pedidosAtualizados.push({ idUnico: order.idUnico, dataStatus: order.dataStatus ?? null, dataEnvio: order.dataEnvio ?? null, dataPedidoFornecedor: order.dataPedidoFornecedor ?? null, dataConclusao: order.dataConclusao ?? null, dataExclusao: order.dataExclusao ?? null });
  });
  ["produtos", "categorias", "fornecedores", "colaboradores"].forEach((name) => {
    const currentItems = indexBy(current[name] || [], "id");
    (next[name] || []).forEach((record: JsonObject) => {
      const previous = currentItems.get(String(record.id));
      if (!previous || !changedIgnoring(previous, record, ["atualizadoEm"])) return;
      record.atualizadoEm = now;
      result.temposEstruturais[name].push({ id: record.id, atualizadoEm: now });
    });
  });
  if (current.restaurante && next.restaurante && changedIgnoring(current.restaurante, next.restaurante, ["atualizadoEm"])) {
    next.restaurante.atualizadoEm = now; result.restauranteAtualizadoEm = now;
  }
  if (changedIgnoring(current.configs || {}, next.configs || {}, ["atualizadoEm", "ultimaMudancaLocal"])) {
    next.configs ||= {}; next.configs.atualizadoEm = now; result.configAtualizadoEm = now;
  }
  return result;
}

async function handleFeiraGet(ctx: CloudContext, url: URL): Promise<Response> {
  const state = await readState(ctx, "compras");
  const bank = { ...feiraEmpty(), ...(state.payload || {}), syncRevision: asNumber(state.revision) };
  const serverNow = Date.now();
  if (url.searchParams.get("meta") === "1") return json({ status: "sucesso", app_id: "alofeira", revision: bank.syncRevision, serverNow });
  return json({ ...bank, serverNow });
}

async function handleFeiraPost(ctx: CloudContext, body: JsonObject): Promise<Response> {
  const currentState = await readState(ctx, "compras");
  const current = { ...feiraEmpty(), ...(currentState.payload || {}) };
  const revision = asNumber(currentState.revision);
  const clientRevision = asNumber(body.baseRevision);
  const now = Date.now();
  if (!body.force && body.baseRevision !== undefined && clientRevision !== revision) {
    return json({ status: "conflito", msg: "A nuvem possui uma versão mais recente.", revision, dados: { ...current, syncRevision: revision }, serverNow: now });
  }
  if (body.action === "enviar_pedidos") {
    const next = clone(current);
    const orders = indexBy(next.pedidosAtivos || [], "idUnico");
    const products = indexBy(next.produtos || [], "id");
    const updated: JsonObject[] = [];
    const updatedProducts: JsonObject[] = [];
    (body.produtos || []).forEach((source: JsonObject) => {
      if (!source?.id || products.has(String(source.id))) return;
      const product = { ...clone(source), atualizadoEm: now };
      next.produtos.push(product); products.set(String(product.id), product);
      updatedProducts.push({ id: product.id, atualizadoEm: now });
    });
    (body.pedidos || []).forEach((source: JsonObject) => {
      if (!source?.idUnico || !source?.produtoId || orders.has(String(source.idUnico))) return;
      const order = { ...clone(source), status: "pendente", dataEnvio: now, dataStatus: now };
      delete order.dataPedidoFornecedor; delete order.dataConclusao; delete order.dataExclusao;
      next.pedidosAtivos.push(order); orders.set(String(order.idUnico), order);
      updated.push({ idUnico: order.idUnico, dataStatus: now, dataEnvio: now, dataPedidoFornecedor: null, dataConclusao: null, dataExclusao: null });
    });
    next.schemaVersion = 2; next.syncRevision = revision + 1;
    const saved = await writeState(ctx, "compras", revision, next, operationId(body, "compras:orders"));
    if (saved.status === "conflict") return json({ status: "conflito", revision: saved.revision, dados: saved.payload, serverNow: now });
    return json({ status: "sucesso", revision: saved.revision, serverNow: now, pedidosAtualizados: updated, temposEstruturais: { produtos: updatedProducts, categorias: [], fornecedores: [], colaboradores: [] } });
  }
  if (body.action !== "salvar_banco" || body.dados?.app_id !== "alofeira") return json({ status: "erro", msg: "Ação ou banco da Lista de Compras inválido.", serverNow: now });
  const next = clone(body.dados);
  const times = applyFeiraTimes(current, next, now, Boolean(body.force));
  next.schemaVersion = 2; next.syncRevision = revision + 1;
  const saved = await writeState(ctx, "compras", revision, next, operationId(body, "compras:save"), Boolean(body.force));
  if (saved.status === "conflict") return json({ status: "conflito", revision: saved.revision, dados: saved.payload, serverNow: now });
  return json({ status: "sucesso", revision: saved.revision, serverNow: now, ...times });
}

async function handleLabelsGet(ctx: CloudContext, url: URL): Promise<Response> {
  const state = await readState(ctx, "etiquetas");
  const revision = asNumber(state.revision);
  const unchanged = String(url.searchParams.get("revision") || "") === String(revision);
  return json({ status: "ok", changed: !unchanged, revision, updatedAt: state.updated_at || "", ...(!unchanged ? { dados: state.payload || {} } : {}) });
}

async function handleLabelsPost(ctx: CloudContext, body: JsonObject): Promise<Response> {
  const current = await readState(ctx, "etiquetas");
  const expected = asNumber(body.expectedRevision);
  if (expected !== asNumber(current.revision)) return json({ status: "conflict", revision: current.revision, dados: current.payload || {} });
  const saved = await writeState(ctx, "etiquetas", expected, body.dados || {}, operationId(body, "etiquetas:save"));
  if (saved.status === "conflict") return json({ status: "conflict", revision: saved.revision, dados: saved.payload || {} });
  return json({ status: "ok", revision: saved.revision, updatedAt: saved.updated_at || new Date().toISOString() });
}

async function handleImport(ctx: CloudContext, body: JsonObject): Promise<Response> {
  const migrationId = cleanId(body.migrationId || crypto.randomUUID());
  const report: JsonObject = { status: "processing", migrationId };
  await mutateState(ctx, "migrations", `migration:${migrationId}:start`, (payload) => {
    payload[migrationId] = report; return payload;
  });
  try {
    const catalog = catalogPayload({}, body.dados || {});
    const catalogState = await readState(ctx, "catalog");
    const catalogSaved = await writeState(ctx, "catalog", asNumber(catalogState.revision), catalog, `migration:${migrationId}:catalog`, true);
    const kdsState = await readState(ctx, "kds");
    const kdsSaved = await writeState(ctx, "kds", asNumber(kdsState.revision), { pedidos: Array.isArray(body.pedidos) ? body.pedidos : [] }, `migration:${migrationId}:kds`, true);
    const checklistState = await readState(ctx, "checklist");
    const checklistSaved = await writeState(ctx, "checklist", asNumber(checklistState.revision), { atividades: Array.isArray(body.atividades) ? body.atividades : [] }, `migration:${migrationId}:checklist`, true);
    Object.assign(report, {
      status: "ok", produtos: catalog.produtos.length,
      pedidosRecebidos: Array.isArray(body.pedidos) ? body.pedidos.length : 0,
      pedidosImportados: Array.isArray(body.pedidos) ? body.pedidos.length : 0,
      pedidosIgnorados: 0,
      atividadesRecebidas: Array.isArray(body.atividades) ? body.atividades.length : 0,
      atividadesImportadas: Array.isArray(body.atividades) ? body.atividades.length : 0,
      bancoRevision: catalogSaved.revision, pedidosRevision: kdsSaved.revision,
      atividadesRevision: checklistSaved.revision,
    });
  } catch (error) {
    Object.assign(report, { status: "error", message: error instanceof Error ? error.message : "Falha na migração." });
  }
  await mutateState(ctx, "migrations", `migration:${migrationId}:finish`, (payload) => {
    payload[migrationId] = report; return payload;
  });
  return json(report);
}

async function handleMigrationGet(ctx: CloudContext, url: URL): Promise<Response> {
  const state = await readState(ctx, "migrations");
  return json(state.payload?.[cleanId(url.searchParams.get("migrationId") || "")] || { status: "not_found" });
}

async function route(req: Request, ctx: CloudContext): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("app") === "alofeira") return handleFeiraGet(ctx, url);
    const action = url.searchParams.get("action") || "";
    if (action === "carregar_banco") return handleCatalogGet(ctx);
    if (action === "carregar_etiquetas_banco") return handleLabelsGet(ctx, url);
    if (action === "status_migracao") return handleMigrationGet(ctx, url);
    const fileResponse = await handleFileGet(ctx, url); if (fileResponse) return fileResponse;
    const auxiliaryResponse = await handleAuxiliaryGet(ctx, url); if (auxiliaryResponse) return auxiliaryResponse;
    if (["sincronizar_atividades", "historico_atividades"].includes(action)) return handleChecklistGet(ctx, url);
    return handleKdsGet(ctx, url);
  }

  const body = await req.json().catch(() => ({})) as JsonObject;
  if (body.app_id === "alofeira" || body.dados?.app_id === "alofeira") return handleFeiraPost(ctx, body);
  if (body.action === "importar_backup") return handleImport(ctx, body);
  if (body.action === "salvar_banco") return handleCatalogPost(ctx, body);
  if (body.action === "salvar_etiquetas_banco") return handleLabelsPost(ctx, body);
  const fileResponse = await handleFilePost(ctx, body); if (fileResponse) return fileResponse;
  const auxiliaryResponse = await handleAuxiliaryPost(ctx, body); if (auxiliaryResponse) return auxiliaryResponse;
  if (["salvar_atividade", "salvar_atividades_lote", "excluir_historico_atividades"].includes(body.action)) return handleChecklistPost(ctx, body);
  return handleKdsPost(ctx, body);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await context(req);
    return await route(req, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada.";
    const unauthorized = /auth|session|jwt/i.test(message);
    console.error("alo-cozinha-sync", message);
    return json({ status: "error", message }, unauthorized ? 401 : 400);
  }
});
