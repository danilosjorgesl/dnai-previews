const fs = require("node:fs");
const path = require("node:path");

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value) {
  return normalize(value).replace(/\s+/g, "");
}

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => []);

  for (let i = 0; i <= a.length; i += 1) {
    rows[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    rows[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }

  return rows[a.length][b.length];
}

function loadRegistry(baseDir = __dirname) {
  const registryPath = path.resolve(baseDir, "template_registry.json");

  if (!fs.existsSync(registryPath)) {
    throw new Error("Template Registry nao encontrado.");
  }

  return JSON.parse(fs.readFileSync(registryPath, "utf8").replace(/^\uFEFF/, ""));
}

function extractSegmento(diagnostico) {
  if (typeof diagnostico === "string") {
    return diagnostico;
  }

  if (!diagnostico || typeof diagnostico !== "object" || Array.isArray(diagnostico)) {
    throw new Error("Diagnostico invalido.");
  }

  const candidates = [
    diagnostico.segmento,
    diagnostico.nicho,
    diagnostico.ramo,
    diagnostico.area,
    diagnostico.categoria,
    diagnostico.segmento_detectado,
    diagnostico.nicho_detectado,
    diagnostico.dados && diagnostico.dados.segmento,
    diagnostico.dados && diagnostico.dados.nicho,
    diagnostico.resultado && diagnostico.resultado.segmento,
    diagnostico.resultado && diagnostico.resultado.nicho
  ];

  const segmento = candidates.find((value) => typeof value === "string" && value.trim());

  if (!segmento) {
    throw new Error("Segmento nao encontrado no diagnostico.");
  }

  return segmento;
}

function scoreNicho(segmentoNormalizado, nichoNormalizado) {
  if (segmentoNormalizado === nichoNormalizado) {
    return 1000;
  }

  const segmentoCompacto = compact(segmentoNormalizado);
  const nichoCompacto = compact(nichoNormalizado);

  if (segmentoCompacto === nichoCompacto) {
    return 900;
  }

  if (segmentoNormalizado.includes(nichoNormalizado)) {
    return 700 + nichoNormalizado.length;
  }

  if (nichoNormalizado.includes(segmentoNormalizado)) {
    return 600 + segmentoNormalizado.length;
  }

  const segmentoTokens = new Set(segmentoNormalizado.split(" ").filter(Boolean));
  const nichoTokens = nichoNormalizado.split(" ").filter(Boolean);
  const overlap = nichoTokens.filter((token) => segmentoTokens.has(token)).length;

  if (!overlap) {
    const distance = levenshtein(segmentoCompacto, nichoCompacto);
    return distance <= 2 ? 500 - distance : 0;
  }

  return 100 + overlap * 20 + overlap / nichoTokens.length;
}

function selectBySegmento(segmento, options = {}) {
  const registry = options.registry || loadRegistry(options.baseDir);
  const segmentoNormalizado = normalize(segmento);

  if (!segmentoNormalizado) {
    throw new Error("Segmento vazio.");
  }

  let selected = null;

  for (const [nicho, mapping] of Object.entries(registry.nichos || {})) {
    const nichoNormalizado = normalize(nicho);
    const score = scoreNicho(segmentoNormalizado, nichoNormalizado);

    if (!score) {
      continue;
    }

    if (!selected || score > selected.score) {
      selected = {
        score,
        nicho,
        nicho_normalizado: nichoNormalizado,
        template: mapping.template,
        produto_indicado: mapping.produto_indicado
      };
    }
  }

  if (!selected) {
    throw new Error(`Nenhum template encontrado para o segmento: ${segmento}`);
  }

  return {
    segmento,
    segmento_normalizado: segmentoNormalizado,
    nicho: selected.nicho,
    template: selected.template,
    produto: selected.produto_indicado,
    produto_indicado: selected.produto_indicado
  };
}

function selectFromDiagnostico(diagnostico, options = {}) {
  const segmento = extractSegmento(diagnostico);
  return selectBySegmento(segmento, options);
}

function readJsonInput(input) {
  if (!input) {
    throw new Error("Informe o diagnostico em JSON ou um segmento.");
  }

  const possiblePath = path.resolve(process.cwd(), input);

  if (fs.existsSync(possiblePath)) {
    return JSON.parse(fs.readFileSync(possiblePath, "utf8").replace(/^\uFEFF/, ""));
  }

  const trimmed = input.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed.replace(/^\uFEFF/, ""));
  }

  return trimmed;
}

function runCli() {
  const [, , input] = process.argv;
  const diagnostico = readJsonInput(input);
  const selection = selectFromDiagnostico(diagnostico);

  process.stdout.write(`${JSON.stringify(selection, null, 2)}\n`);
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
  extractSegmento,
  loadRegistry,
  normalize,
  selectBySegmento,
  selectFromDiagnostico
};
