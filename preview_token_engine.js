const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_STORE = path.resolve(__dirname, "controle", "preview_tokens.json");
const UNIVERSAL_FIELDS = ["empresa", "segmento", "dor", "produto", "cta", "cidade"];
const PREVIEW_STATUSES = ["novo", "visualizou", "chamou_whatsapp", "proposta_enviada", "fechado"];
const STATUS_RANK = PREVIEW_STATUSES.reduce((map, status, index) => {
  map[status] = index;
  return map;
}, {});

function assertTemplateName(template) {
  if (typeof template !== "string" || !/^[a-z0-9_]+$/.test(template)) {
    throw new Error("Template invalido.");
  }
}

function assertLeadId(leadId) {
  if (typeof leadId !== "string" && typeof leadId !== "number") {
    throw new Error("Lead ID invalido.");
  }

  if (!String(leadId).trim()) {
    throw new Error("Lead ID vazio.");
  }
}

function assertNomeEmpresa(nomeEmpresa) {
  if (typeof nomeEmpresa !== "string" || !nomeEmpresa.trim()) {
    throw new Error("Nome da empresa invalido.");
  }
}

function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "preview";
}

function templateExists(template, baseDir = __dirname) {
  assertTemplateName(template);

  const templatePath = path.resolve(baseDir, "templates", template, "index.html");
  const templatesRoot = path.resolve(baseDir, "templates");

  return templatePath.startsWith(templatesRoot + path.sep) && fs.existsSync(templatePath);
}

function createEmptyStore() {
  return {
    version: "1.1.0",
    tokens: []
  };
}

function ensureStore(storePath = DEFAULT_STORE) {
  const resolvedStore = path.resolve(storePath);
  const dir = path.dirname(resolvedStore);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(resolvedStore)) {
    fs.writeFileSync(resolvedStore, `${JSON.stringify(createEmptyStore(), null, 2)}\n`, "utf8");
  }

  return resolvedStore;
}

function loadStore(storePath = DEFAULT_STORE) {
  const resolvedStore = ensureStore(storePath);
  const raw = fs.readFileSync(resolvedStore, "utf8").replace(/^\uFEFF/, "");
  const store = raw.trim() ? JSON.parse(raw) : createEmptyStore();

  if (!Array.isArray(store.tokens)) {
    store.tokens = [];
  }

  return store;
}

function saveStore(store, storePath = DEFAULT_STORE) {
  const resolvedStore = ensureStore(storePath);

  fs.writeFileSync(resolvedStore, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function generatePreviewToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function buildPreviewUrl(slug) {
  return `/preview/${slug}`;
}

function buildLegacyPreviewUrl(previewToken) {
  return `/preview/${previewToken}`;
}

function assertPreviewStatus(status) {
  if (!PREVIEW_STATUSES.includes(status)) {
    throw new Error("Status de preview invalido.");
  }
}

function normalizeStatus(status) {
  return PREVIEW_STATUSES.includes(status) ? status : "novo";
}

function previewUrlFromRecord(record) {
  return record.slug ? buildPreviewUrl(record.slug) : buildLegacyPreviewUrl(record.preview_token);
}

function normalizePreviewRecord(record) {
  return {
    ...record,
    status: normalizeStatus(record.status),
    preview_url: previewUrlFromRecord(record)
  };
}

function generateUniqueSlug(nomeEmpresa, store, currentPreviewToken = null) {
  const baseSlug = slugify(nomeEmpresa);
  let slug = baseSlug;
  let suffix = 2;

  while (
    store.tokens.some((item) => (
      item.slug === slug &&
      (!currentPreviewToken || item.preview_token !== currentPreviewToken)
    ))
  ) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function pickValue(...values) {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim());

  return value === undefined ? "" : String(value).trim();
}

function normalizeDados(input = {}) {
  const source = input.dados && typeof input.dados === "object" && !Array.isArray(input.dados)
    ? input.dados
    : {};

  return {
    empresa: pickValue(source.empresa, input.empresa, input.nome_empresa),
    segmento: pickValue(source.segmento, input.segmento),
    dor: pickValue(source.dor, input.dor, input.dor_principal),
    produto: pickValue(source.produto, input.produto, input.produto_indicado),
    cta: pickValue(source.cta, input.cta),
    cidade: pickValue(source.cidade, input.cidade)
  };
}

function createPreviewToken(input, options = {}) {
  const template = input && input.template;
  const leadId = input && input.lead_id;
  const nomeEmpresa = input && input.nome_empresa;
  const baseDir = options.baseDir || __dirname;
  const storePath = options.storePath || DEFAULT_STORE;

  assertTemplateName(template);
  assertLeadId(leadId);
  assertNomeEmpresa(nomeEmpresa);

  if (!templateExists(template, baseDir)) {
    throw new Error(`Template nao encontrado: ${template}`);
  }

  const store = loadStore(storePath);
  let previewToken = generatePreviewToken();

  while (store.tokens.some((item) => item.preview_token === previewToken)) {
    previewToken = generatePreviewToken();
  }

  const slug = generateUniqueSlug(nomeEmpresa, store);

  const record = {
    preview_token: previewToken,
    nome_empresa: nomeEmpresa.trim(),
    slug,
    template,
    lead_id: String(leadId),
    status: "novo",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dados: normalizeDados(input)
  };

  store.tokens.push(record);
  saveStore(store, storePath);

  return {
    ...record,
    preview_url: buildPreviewUrl(slug)
  };
}

function getPreviewToken(previewToken, options = {}) {
  const store = loadStore(options.storePath || DEFAULT_STORE);
  const record = store.tokens.find((item) => item.preview_token === previewToken);

  if (!record) {
    throw new Error("Preview token nao encontrado.");
  }

  return normalizePreviewRecord(record);
}

function getPreviewSlug(slug, options = {}) {
  const store = loadStore(options.storePath || DEFAULT_STORE);
  const record = store.tokens.find((item) => item.slug === slug);

  if (!record) {
    throw new Error("Preview slug nao encontrado.");
  }

  return normalizePreviewRecord(record);
}

function resolvePreview(input, options = {}) {
  const store = loadStore(options.storePath || DEFAULT_STORE);
  const record = store.tokens.find((item) => item.slug === input || item.preview_token === input);

  if (!record) {
    throw new Error("Preview nao encontrado.");
  }

  return normalizePreviewRecord(record);
}

function listPreviewTokens(options = {}) {
  const store = loadStore(options.storePath || DEFAULT_STORE);

  return store.tokens.map(normalizePreviewRecord);
}

function listPreviewPanelRows(options = {}) {
  return listPreviewTokens(options).map((record) => {
    const dados = record.dados && typeof record.dados === "object" ? record.dados : {};

    return {
      empresa: dados.empresa || record.nome_empresa || "",
      segmento: dados.segmento || record.segmento || record.nicho || "",
      produto: dados.produto || record.produto || record.produto_indicado || "",
      template: record.template || "",
      slug: record.slug || "",
      url_publica: record.preview_url,
      status: normalizeStatus(record.status),
      preview_token: record.preview_token,
      lead_id: record.lead_id || ""
    };
  });
}

function updatePreviewStatus(input, status, options = {}) {
  assertPreviewStatus(status);

  const storePath = options.storePath || DEFAULT_STORE;
  const store = loadStore(storePath);
  const index = store.tokens.findIndex((record) => record.slug === input || record.preview_token === input);

  if (index < 0) {
    throw new Error("Preview nao encontrado.");
  }

  const currentStatus = normalizeStatus(store.tokens[index].status);
  const shouldAdvanceOnly = options.onlyAdvance !== false;
  const nextStatus = shouldAdvanceOnly && STATUS_RANK[status] < STATUS_RANK[currentStatus]
    ? currentStatus
    : status;

  store.tokens[index] = {
    ...store.tokens[index],
    status: nextStatus,
    updated_at: new Date().toISOString()
  };

  saveStore(store, storePath);

  return normalizePreviewRecord(store.tokens[index]);
}

function markPreviewVisualized(input, options = {}) {
  return updatePreviewStatus(input, "visualizou", { ...options, onlyAdvance: true });
}

function runCli() {
  const [, , command, arg1, arg2, arg3] = process.argv;

  if (command === "create") {
    const result = createPreviewToken({ template: arg1, lead_id: arg2, nome_empresa: arg3 });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "get") {
    const result = getPreviewToken(arg1);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "slug") {
    const result = getPreviewSlug(arg1);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "resolve") {
    const result = resolvePreview(arg1);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "list") {
    const result = listPreviewTokens();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "panel") {
    const result = listPreviewPanelRows();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "status") {
    const result = updatePreviewStatus(arg1, arg2, { onlyAdvance: false });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error("Comando invalido. Use: create <template> <lead_id> <nome_empresa>, get <token>, slug <slug>, resolve <token_ou_slug>, list, panel ou status <token_ou_slug> <status>.");
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildPreviewUrl,
  buildLegacyPreviewUrl,
  createPreviewToken,
  generatePreviewToken,
  generateUniqueSlug,
  getPreviewSlug,
  getPreviewToken,
  listPreviewPanelRows,
  listPreviewTokens,
  loadStore,
  markPreviewVisualized,
  normalizeDados,
  normalizePreviewRecord,
  normalizeStatus,
  PREVIEW_STATUSES,
  resolvePreview,
  slugify,
  templateExists,
  updatePreviewStatus,
  UNIVERSAL_FIELDS
};
