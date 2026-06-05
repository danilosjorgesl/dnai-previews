const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { renderTemplate } = require("./render_engine");
const { resolvePreview } = require("./preview_token_engine");

const BASE_DIR = __dirname;
const TEMPLATE_REGISTRY = path.resolve(BASE_DIR, "template_registry.json");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function loadRegistry(baseDir = BASE_DIR) {
  const registryPath = path.resolve(baseDir, "template_registry.json");

  if (!fs.existsSync(registryPath)) {
    throw new Error("Template Registry nao encontrado.");
  }

  return JSON.parse(fs.readFileSync(registryPath, "utf8").replace(/^\uFEFF/, ""));
}

function produtoByTemplate(template, registry = loadRegistry()) {
  const match = Object.values(registry.nichos || {}).find((item) => item.template === template);

  return match ? match.produto_indicado : "";
}

function buildPreviewData(record, registry = loadRegistry()) {
  const dados = record.dados && typeof record.dados === "object" ? record.dados : {};

  return {
    empresa: dados.empresa || record.nome_empresa || "",
    segmento: dados.segmento || record.segmento || record.nicho || "",
    dor: dados.dor || record.dor || record.dor_principal || "",
    produto: dados.produto || record.produto || record.produto_indicado || produtoByTemplate(record.template, registry),
    cta: dados.cta || record.cta || "Falar no WhatsApp",
    cidade: dados.cidade || record.cidade || ""
  };
}

function injectTemplateBase(html, template) {
  if (html.includes("<base ")) {
    return html;
  }

  return html.replace("<head>", `<head>\n    <base href="/templates/${template}/">`);
}

function renderPreview(input, options = {}) {
  const baseDir = options.baseDir || BASE_DIR;
  const registry = options.registry || loadRegistry(baseDir);
  const record = resolvePreview(input, { storePath: options.storePath });
  const dados = buildPreviewData(record, registry);
  const html = renderTemplate(record.template, dados, { baseDir });

  return injectTemplateBase(html, record.template);
}

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(body);
}

function serveStaticTemplateAsset(requestPath, response, baseDir = BASE_DIR) {
  const templatesRoot = path.resolve(baseDir, "templates");
  const relativePath = decodeURIComponent(requestPath.replace(/^\/templates\//, ""));
  const filePath = path.resolve(templatesRoot, relativePath);

  if (!filePath.startsWith(templatesRoot + path.sep) || !fs.existsSync(filePath)) {
    send(response, 404, "Arquivo nao encontrado.");
    return;
  }

  const stat = fs.statSync(filePath);

  if (!stat.isFile()) {
    send(response, 404, "Arquivo nao encontrado.");
    return;
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";

  response.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(response);
}

function routeToPreviewInput(pathname) {
  if (pathname === "/" || pathname === "/index.html" || pathname === "/favicon.ico") {
    return null;
  }

  const previewMatch = pathname.match(/^\/preview\/([^/]+)\/?$/);

  if (previewMatch) {
    return decodeURIComponent(previewMatch[1]);
  }

  const slugMatch = pathname.match(/^\/([^/]+)\/?$/);

  if (slugMatch) {
    return decodeURIComponent(slugMatch[1]);
  }

  return null;
}

function createPreviewServer(options = {}) {
  return http.createServer((request, response) => {
    try {
      if (request.method !== "GET") {
        send(response, 405, "Metodo nao permitido.");
        return;
      }

      const url = new URL(request.url, "http://localhost");

      if (url.pathname.startsWith("/templates/")) {
        serveStaticTemplateAsset(url.pathname, response, options.baseDir || BASE_DIR);
        return;
      }

      const input = routeToPreviewInput(url.pathname);

      if (!input) {
        send(response, 404, "Preview nao encontrada.");
        return;
      }

      const html = renderPreview(input, options);

      send(response, 200, html, "text/html; charset=utf-8");
    } catch (error) {
      send(response, 404, error.message);
    }
  });
}

function runCli() {
  const port = Number(process.env.PORT || process.argv[2] || 3000);
  const server = createPreviewServer();

  server.listen(port, () => {
    process.stdout.write(`Preview server rodando em http://localhost:${port}\n`);
  });
}

if (require.main === module) {
  runCli();
}

module.exports = {
  buildPreviewData,
  createPreviewServer,
  injectTemplateBase,
  loadRegistry,
  produtoByTemplate,
  renderPreview,
  routeToPreviewInput
};
