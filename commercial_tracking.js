const fs = require("node:fs");
const path = require("node:path");

const { advanceLeadStatus } = require("./leads_engine");

const DEFAULT_EVENT_STORE = path.resolve(__dirname, "controle", "preview_events.json");
const COMMERCIAL_EVENTS = ["preview_open", "whatsapp_click"];

const EVENT_TO_LEAD_STATUS = {
  preview_open: "visualizou_preview",
  whatsapp_click: "chamou_whatsapp"
};

function createEmptyStore() {
  return {
    version: "1.0.0",
    events: []
  };
}

function ensureStore(storePath = DEFAULT_EVENT_STORE) {
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

function loadEventStore(storePath = DEFAULT_EVENT_STORE) {
  const resolvedStore = ensureStore(storePath);
  const raw = fs.readFileSync(resolvedStore, "utf8").replace(/^\uFEFF/, "");
  const store = raw.trim() ? JSON.parse(raw) : createEmptyStore();

  if (!Array.isArray(store.events)) {
    store.events = [];
  }

  return store;
}

function saveEventStore(store, storePath = DEFAULT_EVENT_STORE) {
  const resolvedStore = ensureStore(storePath);

  fs.writeFileSync(resolvedStore, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function assertCommercialEvent(evento) {
  if (!COMMERCIAL_EVENTS.includes(evento)) {
    throw new Error("Evento comercial invalido.");
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

function timestampParts(date = new Date()) {
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

  return {
    data: `${parts.year}-${parts.month}-${parts.day}`,
    hora: `${parts.hour}:${parts.minute}:${parts.second}`
  };
}

function logCommercialEvent(input, options = {}) {
  const leadId = input && input.lead_id;
  const evento = input && input.evento;

  assertLeadId(leadId);
  assertCommercialEvent(evento);

  const storePath = options.eventStorePath || options.storePath || DEFAULT_EVENT_STORE;
  const store = loadEventStore(storePath);
  const now = timestampParts(options.date || new Date());
  const record = {
    lead_id: String(leadId),
    data: now.data,
    hora: now.hora,
    evento
  };

  store.events.push(record);
  saveEventStore(store, storePath);

  const leadStatus = EVENT_TO_LEAD_STATUS[evento];

  if (leadStatus) {
    advanceLeadStatus(String(leadId), leadStatus, { leadsStorePath: options.leadsStorePath });
  }

  return record;
}

function listCommercialEvents(options = {}) {
  const storePath = options.eventStorePath || options.storePath || DEFAULT_EVENT_STORE;

  return loadEventStore(storePath).events;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

function parseRaw(raw) {
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

function readJsonInput(input) {
  if (!input) {
    throw new Error("Informe o evento em JSON.");
  }

  const possiblePath = path.resolve(process.cwd(), input);

  if (fs.existsSync(possiblePath)) {
    return parseRaw(fs.readFileSync(possiblePath, "utf8"));
  }

  return parseRaw(input);
}

async function runCli() {
  const [, , command, input] = process.argv;

  if (command === "log") {
    const raw = (!input || input === "-") ? await readStdin() : input;
    const result = logCommercialEvent(readJsonInput(raw));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "list") {
    process.stdout.write(`${JSON.stringify(listCommercialEvents(), null, 2)}\n`);
    return;
  }

  throw new Error("Comando invalido. Use: log <arquivo.json> ou list.");
}

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  COMMERCIAL_EVENTS,
  listCommercialEvents,
  loadEventStore,
  logCommercialEvent,
  timestampParts
};
