const fs = require("node:fs");
const path = require("node:path");

const PLACEHOLDERS = ["empresa", "segmento", "dor", "produto", "cta", "cidade"];

function assertTemplateName(template) {
  if (typeof template !== "string" || !/^[a-z0-9_]+$/.test(template)) {
    throw new Error("Template invalido.");
  }
}

function resolveTemplatePath(template, baseDir = __dirname) {
  assertTemplateName(template);

  const templatesRoot = path.resolve(baseDir, "templates");
  const templatePath = path.resolve(templatesRoot, template, "index.html");

  if (!templatePath.startsWith(templatesRoot + path.sep)) {
    throw new Error("Template fora da pasta permitida.");
  }

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template nao encontrado: ${template}`);
  }

  return templatePath;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(html, dados = {}) {
  if (typeof html !== "string") {
    throw new Error("HTML invalido.");
  }

  if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
    throw new Error("Dados invalidos.");
  }

  return PLACEHOLDERS.reduce((rendered, key) => {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    return rendered.replace(pattern, escapeHtml(dados[key]));
  }, html);
}

function renderTemplate(template, dados = {}, options = {}) {
  const baseDir = options.baseDir || __dirname;
  const templatePath = resolveTemplatePath(template, baseDir);
  const html = fs.readFileSync(templatePath, "utf8");

  return renderHtml(html, dados);
}

function readJsonInput(input) {
  if (!input) {
    throw new Error("Informe os dados em JSON.");
  }

  const possiblePath = path.resolve(process.cwd(), input);

  if (fs.existsSync(possiblePath)) {
    return JSON.parse(fs.readFileSync(possiblePath, "utf8").replace(/^\uFEFF/, ""));
  }

  return JSON.parse(input.replace(/^\uFEFF/, ""));
}

function runCli() {
  const [, , template, dadosInput] = process.argv;
  const dados = readJsonInput(dadosInput);
  const html = renderTemplate(template, dados);

  process.stdout.write(html);
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
  PLACEHOLDERS,
  renderHtml,
  renderTemplate,
  resolveTemplatePath
};
