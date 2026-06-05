const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_STORE = path.resolve(__dirname, "controle", "preview_tokens.json");
const UNIVERSAL_FIELDS = ["empresa", "segmento", "dor", "produto", "cta", "cidade"];

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

  return {
    ...record,
    preview_url: record.slug ? buildPreviewUrl(record.slug) : buildLegacyPreviewUrl(record.preview_token)
  };
}

function getPreviewSlug(slug, options = {}) {
  const store = loadStore(options.storePath || DEFAULT_STORE);
  const record = store.tokens.find((item) => item.slug === slug);

  if (!record) {
    throw new Error("Preview slug nao encontrado.");
  }

  return {
    ...record,
    preview_url: buildPreviewUrl(record.slug)
  };
}

function resolvePreview(input, options = {}) {
  const store = loadStore(options.storePath || DEFAULT_STORE);
  const record = store.tokens.find((item) => item.slug === input || item.preview_token === input);

  if (!record) {
    throw new Error("Preview nao encontrado.");
  }

  return {
    ...record,
    preview_url: record.slug ? buildPreviewUrl(record.slug) : buildLegacyPreviewUrl(record.preview_token)
  };
}

function listPreviewTokens(options = {}) {
  const store = loadStore(options.storePath || DEFAULT_STORE);

  return store.tokens.map((record) => ({
    ...record,
    preview_url: record.slug ? buildPreviewUrl(record.slug) : buildLegacyPreviewUrl(record.preview_token)
  }));
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

  throw new Error("Comando invalido. Use: create <template> <lead_id> <nome_empresa>, get <token>, slug <slug>, resolve <token_ou_slug> ou list.");
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
  listPreviewTokens,
  loadStore,
  normalizeDados,
  resolvePreview,
  slugify,
  templateExists,
  UNIVERSAL_FIELDS
};
