const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_LEADS_STORE = path.resolve(__dirname, "controle", "leads_comerciais.json");

const STATUS_RANK = {
  novo: 0,
  visualizou_preview: 1,
  chamou_whatsapp: 2,
  proposta_enviada: 3,
  fechado: 4
};

const LEAD_STATUSES = Object.keys(STATUS_RANK);

function createEmptyStore() {
  return { version: "1.0.0", leads: [] };
}

function ensureStore(storePath = DEFAULT_LEADS_STORE) {
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

function loadLeadsStore(storePath = DEFAULT_LEADS_STORE) {
  const resolvedStore = ensureStore(storePath);
  const raw = fs.readFileSync(resolvedStore, "utf8").replace(/^﻿/, "");
  const store = raw.trim() ? JSON.parse(raw) : createEmptyStore();

  if (!Array.isArray(store.leads)) {
    store.leads = [];
  }

  return store;
}

function saveLeadsStore(store, storePath = DEFAULT_LEADS_STORE) {
  const resolvedStore = ensureStore(storePath);

  fs.writeFileSync(resolvedStore, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function timestampSP(date = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function upsertLead(input, options = {}) {
  if (!input || !String(input.lead_id || "").trim()) {
    return null;
  }

  const storePath = options.leadsStorePath || DEFAULT_LEADS_STORE;
  const store = loadLeadsStore(storePath);
  const leadId = String(input.lead_id);
  const existing = store.leads.find((l) => l.lead_id === leadId);

  if (existing) {
    if (input.nome_empresa) existing.nome_empresa = input.nome_empresa;
    if (input.segmento) existing.segmento = input.segmento;
    if (input.dor_principal) existing.dor_principal = input.dor_principal;
    if (input.produto_indicado) existing.produto_indicado = input.produto_indicado;
    if (input.template_indicado) existing.template_indicado = input.template_indicado;
    if (input.preview_slug) existing.preview_slug = input.preview_slug;
    if (input.preview_token) existing.preview_token = input.preview_token;

    saveLeadsStore(store, storePath);

    return existing;
  }

  const lead = {
    lead_id: leadId,
    nome_empresa: input.nome_empresa || "",
    segmento: input.segmento || "",
    dor_principal: input.dor_principal || "",
    produto_indicado: input.produto_indicado || "",
    template_indicado: input.template_indicado || "",
    preview_slug: input.preview_slug || "",
    preview_token: input.preview_token || "",
    status: "novo",
    criado_em: timestampSP(options.date || new Date())
  };

  store.leads.push(lead);
  saveLeadsStore(store, storePath);

  return lead;
}

function advanceLeadStatus(leadId, newStatus, options = {}) {
  if (!leadId || !LEAD_STATUSES.includes(newStatus)) {
    return null;
  }

  const storePath = options.leadsStorePath || DEFAULT_LEADS_STORE;
  const store = loadLeadsStore(storePath);
  const lead = store.leads.find((l) => l.lead_id === String(leadId));

  if (!lead) {
    return null;
  }

  const currentRank = STATUS_RANK[lead.status] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;

  if (newRank > currentRank) {
    lead.status = newStatus;
    saveLeadsStore(store, storePath);
  }

  return lead;
}

function findLeadByToken(tokenOrSlug, options = {}) {
  if (!tokenOrSlug) {
    return null;
  }

  const storePath = options.leadsStorePath || DEFAULT_LEADS_STORE;
  const store = loadLeadsStore(storePath);

  return store.leads.find(
    (l) => l.preview_token === tokenOrSlug || l.preview_slug === tokenOrSlug
  ) || null;
}

module.exports = {
  DEFAULT_LEADS_STORE,
  LEAD_STATUSES,
  advanceLeadStatus,
  findLeadByToken,
  loadLeadsStore,
  upsertLead
};
