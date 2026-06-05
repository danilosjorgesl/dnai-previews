const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { logCommercialEvent } = require("./commercial_tracking");
const { loadLeadsStore, upsertLead } = require("./leads_engine");
const { renderTemplate } = require("./render_engine");
const {
  listPreviewPanelRows,
  markPreviewVisualized,
  PREVIEW_STATUSES,
  resolvePreview,
  updatePreviewStatus
} = require("./preview_token_engine");

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
  const rendered = injectPreviewTracking(injectTemplateBase(html, record.template), record.preview_token);

  upsertLead(
    {
      lead_id: record.lead_id,
      nome_empresa: record.nome_empresa || dados.empresa,
      segmento: record.segmento || dados.segmento,
      dor_principal: record.dor_principal || dados.dor,
      produto_indicado: record.produto_indicado || dados.produto,
      template_indicado: record.template,
      preview_slug: record.slug || "",
      preview_token: record.preview_token || ""
    },
    { leadsStorePath: options.leadsStorePath }
  );
  logCommercialEvent(
    {
      lead_id: record.lead_id,
      evento: "preview_open"
    },
    { eventStorePath: options.eventStorePath, leadsStorePath: options.leadsStorePath }
  );
  markPreviewVisualized(record.preview_token, { storePath: options.storePath });

  return rendered;
}

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(body);
}

function sendJson(response, statusCode, payload) {
  send(response, statusCode, `${JSON.stringify(payload, null, 2)}\n`, "application/json; charset=utf-8");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 10000) {
        reject(new Error("Payload muito grande."));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function parseJsonBody(body) {
  if (!body || !body.trim()) {
    return {};
  }

  return JSON.parse(body.replace(/^\uFEFF/, ""));
}

function publicOrigin(request) {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || "localhost";

  return `${protocol}://${host}`;
}

function publicPreviewUrl(urlPublica, request) {
  if (!urlPublica || /^https?:\/\//i.test(urlPublica)) {
    return urlPublica;
  }

  return `${publicOrigin(request)}${urlPublica}`;
}

function previewPanelPayload(request, options = {}) {
  const registry = loadRegistry(options.baseDir || BASE_DIR);
  const previews = listPreviewPanelRows({ storePath: options.storePath }).map((row) => ({
    ...row,
    produto: row.produto || produtoByTemplate(row.template, registry),
    url_publica: publicPreviewUrl(row.url_publica, request)
  }));

  return {
    status_disponiveis: PREVIEW_STATUSES,
    previews
  };
}

async function handlePreviewStatus(request, response, input, options = {}) {
  const body = await readRequestBody(request);
  const data = parseJsonBody(body);
  const status = data.status;
  const record = updatePreviewStatus(input, status, {
    storePath: options.storePath,
    onlyAdvance: data.onlyAdvance !== false
  });

  sendJson(response, 200, {
    preview: record,
    status_disponiveis: PREVIEW_STATUSES
  });
}

async function handlePreviewEvent(request, response, input, options = {}) {
  const body = await readRequestBody(request);
  const data = parseJsonBody(body);
  const record = resolvePreview(input, { storePath: options.storePath });

  if (data.evento !== "whatsapp_click") {
    throw new Error("Evento comercial invalido.");
  }

  const event = logCommercialEvent(
    {
      lead_id: record.lead_id,
      evento: "whatsapp_click"
    },
    { eventStorePath: options.eventStorePath }
  );
  const preview = updatePreviewStatus(record.preview_token, "chamou_whatsapp", {
    storePath: options.storePath,
    onlyAdvance: true
  });

  sendJson(response, 200, {
    event,
    preview
  });
}

function injectPreviewTracking(html, previewToken) {
  if (html.includes("data-dnai-preview-tracking")) {
    return html;
  }

  const script = `
    <script data-dnai-preview-tracking>
      (function () {
        var endpoint = "/api/previews/${previewToken}/events";
        var payload = JSON.stringify({ evento: "whatsapp_click" });

        function trackWhatsApp() {
          try {
            if (navigator.sendBeacon) {
              navigator.sendBeacon(endpoint, payload);
              return;
            }

            fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
              keepalive: true
            });
          } catch (error) {}
        }

        document.addEventListener("click", function (event) {
          var link = event.target.closest && event.target.closest("a[href*='wa.me'], a[href*='whatsapp']");

          if (link) {
            trackWhatsApp();
          }
        });
      })();
    </script>`;

  return html.replace("</body>", `${script}\n  </body>`);
}

function serveIndex(response, baseDir = BASE_DIR) {
  const indexPath = path.resolve(baseDir, "index.html");

  if (!fs.existsSync(indexPath)) {
    send(response, 404, "Painel nao encontrado.");
    return;
  }

  send(response, 200, fs.readFileSync(indexPath, "utf8"), "text/html; charset=utf-8");
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
  return http.createServer(async (request, response) => {
    try {
      if (!["GET", "POST"].includes(request.method)) {
        send(response, 405, "Metodo nao permitido.");
        return;
      }

      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        serveIndex(response, options.baseDir || BASE_DIR);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/previews") {
        sendJson(response, 200, previewPanelPayload(request, options));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/leads") {
        const store = loadLeadsStore(options.leadsStorePath);

        sendJson(response, 200, store);
        return;
      }

      const statusMatch = url.pathname.match(/^\/api\/previews\/([^/]+)\/status\/?$/);

      if (request.method === "POST" && statusMatch) {
        await handlePreviewStatus(request, response, decodeURIComponent(statusMatch[1]), options);
        return;
      }

      const eventMatch = url.pathname.match(/^\/api\/previews\/([^/]+)\/events\/?$/);

      if (request.method === "POST" && eventMatch) {
        await handlePreviewEvent(request, response, decodeURIComponent(eventMatch[1]), options);
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/templates/")) {
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
