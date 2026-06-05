const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_LEADS_STORE = path.resolve(__dirname, "controle", "leads_comerciais.json");
const DEFAULT_EXPORT_PATH = path.resolve(__dirname, "controle", "export_leads_central.json");

function fixEncoding(value) {
  if (typeof value !== "string") return value;

  return value
    .replace(/PresenÃ§a/g, "Presença")
    .replace(/Ã§/g, "ç")
    .replace(/Ã£/g, "ã")
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãº/g, "ú")
    .replace(/Ã /g, "à")
    .replace(/Ã¢/g, "â")
    .replace(/Ãª/g, "ê")
    .replace(/Ã´/g, "ô");
}

function loadLeads(storePath = DEFAULT_LEADS_STORE) {
  if (!fs.existsSync(storePath)) {
    throw new Error(`Arquivo nao encontrado: ${storePath}`);
  }

  const raw = fs.readFileSync(storePath, { encoding: "utf8" }).replace(/^﻿/, "");
  const store = JSON.parse(raw);

  if (!store || !Array.isArray(store.leads)) {
    throw new Error("Estrutura invalida: campo 'leads' ausente ou nao e array.");
  }

  return store.leads;
}

function normalizeLead(lead) {
  return {
    lead_id: fixEncoding(String(lead.lead_id || "")),
    empresa: fixEncoding(String(lead.nome_empresa || "")),
    segmento: fixEncoding(String(lead.segmento || "")),
    produto: fixEncoding(String(lead.produto_indicado || "")),
    template: fixEncoding(String(lead.template_indicado || "")),
    slug: fixEncoding(String(lead.preview_slug || "")),
    status: fixEncoding(String(lead.status || "novo")),
    criado_em: fixEncoding(String(lead.criado_em || ""))
  };
}

function exportLeads(options = {}) {
  const storePath = options.leadsStorePath || DEFAULT_LEADS_STORE;
  const exportPath = options.exportPath || DEFAULT_EXPORT_PATH;

  const leads = loadLeads(storePath);
  const exported = leads.map(normalizeLead);

  fs.writeFileSync(exportPath, `${JSON.stringify(exported, null, 2)}\n`, { encoding: "utf8" });

  return { exportPath, total: exported.length, leads: exported };
}

function runCli() {
  const result = exportLeads();

  process.stdout.write(`Exportados: ${result.total} lead(s) → ${result.exportPath}\n`);
  process.stdout.write(`${JSON.stringify(result.leads, null, 2)}\n`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { exportLeads, normalizeLead };
