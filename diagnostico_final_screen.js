const fs = require("node:fs");
const path = require("node:path");

const { selectFromDiagnostico } = require("./diagnostico_selector");
const { upsertLead } = require("./leads_engine");
const {
  buildLegacyPreviewUrl,
  buildPreviewUrl,
  createPreviewToken,
  loadStore,
  normalizeDados,
  resolvePreview
} = require("./preview_token_engine");

const DEFAULT_PRODUCT = "Presença Inteligente dnAi";
const DEFAULT_WHATSAPP = "https://wa.me/5511999999999";

function pickValue(...values) {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim());

  return value === undefined ? "" : String(value).trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function getDiagnostico(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input.diagnostico || input.resultado || input;
  }

  return input;
}

function buildSelection(diagnostico, options = {}) {
  if (options.selection) {
    return options.selection;
  }

  return selectFromDiagnostico(diagnostico, options);
}

function buildResumo(diagnostico, selection) {
  if (typeof diagnostico === "string") {
    return `Seu segmento foi identificado como ${diagnostico}. Existe oportunidade clara de transformar essa presença digital em uma vitrine mais direta, comercial e pronta para gerar conversa.`;
  }

  const resumo = pickValue(
    diagnostico.resumo,
    diagnostico.resumo_situacao,
    diagnostico.resumo_diagnostico,
    diagnostico.situacao,
    diagnostico.dor_principal,
    diagnostico.dor,
    diagnostico.dados && diagnostico.dados.resumo,
    diagnostico.dados && diagnostico.dados.dor
  );

  if (resumo) {
    return resumo;
  }

  return `Seu negócio tem uma oportunidade clara de organizar a presença digital, apresentar melhor seus diferenciais e conduzir o visitante para uma ação comercial objetiva.`;
}

function buildWhatsAppUrl(input, model) {
  const source = input && typeof input === "object" ? input : {};
  const diagnostico = getDiagnostico(source);
  const rawUrl = pickValue(
    source.whatsapp_url,
    source.cta_whatsapp,
    source.whatsapp,
    diagnostico.whatsapp_url,
    diagnostico.cta_whatsapp,
    diagnostico.whatsapp
  );

  const text = encodeURIComponent(
    pickValue(
      source.mensagem_whatsapp,
      diagnostico.mensagem_whatsapp,
      `Quero falar sobre minha prévia da ${model.empresa || "empresa"}.`
    )
  );

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const digits = rawUrl.replace(/\D/g, "");

  if (digits) {
    return `https://wa.me/${digits}?text=${text}`;
  }

  return `${DEFAULT_WHATSAPP}?text=${text}`;
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
    throw new Error("Informe os dados do diagnostico em JSON ou arquivo.");
  }

  const possiblePath = path.resolve(process.cwd(), input);

  if (fs.existsSync(possiblePath)) {
    return parseRaw(fs.readFileSync(possiblePath, "utf8"));
  }

  return parseRaw(input);
}

function previewUrlFromRecord(record) {
  return record.slug ? buildPreviewUrl(record.slug) : buildLegacyPreviewUrl(record.preview_token);
}

function findExistingPreview(leadId, empresa, template, options = {}) {
  const store = loadStore(options.storePath);
  const lead = String(leadId);
  const company = String(empresa).trim().toLowerCase();

  return store.tokens.find((record) => (
    record.template === template &&
    String(record.lead_id) === lead &&
    String(record.nome_empresa || "").trim().toLowerCase() === company
  ));
}

function resolvePreviewAction(input, selection, produtoIndicado, options = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const diagnostico = getDiagnostico(source);
  const directUrl = pickValue(
    source.preview_url,
    source.previewUrl,
    diagnostico.preview_url,
    diagnostico.previewUrl
  );

  if (directUrl) {
    return { preview_url: directUrl };
  }

  const previewKey = pickValue(
    source.slug,
    source.preview_slug,
    source.preview_token,
    diagnostico.slug,
    diagnostico.preview_slug,
    diagnostico.preview_token
  );

  if (previewKey) {
    const record = resolvePreview(previewKey, { storePath: options.storePath });

    return {
      preview_url: record.preview_url,
      preview_token: record.preview_token,
      slug: record.slug
    };
  }

  const empresa = pickValue(
    source.nome_empresa,
    source.empresa,
    diagnostico.nome_empresa,
    diagnostico.empresa,
    diagnostico.dados && diagnostico.dados.empresa
  );
  const leadId = pickValue(source.lead_id, source.leadId, diagnostico.lead_id, diagnostico.leadId);

  if (!empresa || !leadId) {
    return { preview_url: "" };
  }

  const existing = findExistingPreview(leadId, empresa, selection.template, options);

  if (existing) {
    return {
      preview_url: previewUrlFromRecord(existing),
      preview_token: existing.preview_token,
      slug: existing.slug
    };
  }

  const dados = normalizeDados({
    ...diagnostico,
    ...source,
    dados: {
      ...(diagnostico.dados || {}),
      ...(source.dados || {}),
      empresa,
      segmento: pickValue(
        source.segmento,
        diagnostico.segmento,
        diagnostico.nicho,
        selection.segmento,
        selection.nicho
      ),
      dor: pickValue(source.dor, diagnostico.dor, diagnostico.dor_principal),
      produto: produtoIndicado,
      cta: pickValue(source.cta, diagnostico.cta, "Falar no WhatsApp"),
      cidade: pickValue(source.cidade, diagnostico.cidade)
    }
  });

  const record = createPreviewToken(
    {
      template: selection.template,
      lead_id: leadId,
      nome_empresa: empresa,
      dados
    },
    options
  );

  return {
    preview_url: record.preview_url,
    preview_token: record.preview_token,
    slug: record.slug
  };
}

function buildFinalScreenModel(input, options = {}) {
  const diagnostico = getDiagnostico(input);
  const selection = buildSelection(diagnostico, options);
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const produtoRegistro = pickValue(selection.produto_indicado, selection.produto);
  const produtoIndicado = pickValue(
    source.produto_indicado,
    source.produto,
    diagnostico.produto_indicado,
    diagnostico.produto,
    DEFAULT_PRODUCT
  );
  const empresa = pickValue(
    source.nome_empresa,
    source.empresa,
    diagnostico.nome_empresa,
    diagnostico.empresa,
    diagnostico.dados && diagnostico.dados.empresa
  );
  const previewAction = resolvePreviewAction(source, selection, produtoIndicado, options);
  const leadId = pickValue(source.lead_id, source.leadId, diagnostico.lead_id, diagnostico.leadId);
  const dorPrincipal = pickValue(
    source.dor_principal,
    source.dor,
    diagnostico.dor_principal,
    diagnostico.dor,
    diagnostico.dados && diagnostico.dados.dor
  );
  const baseModel = {
    titulo: "Resultado do Diagnóstico",
    resumo: buildResumo(diagnostico, selection),
    produto_indicado: produtoIndicado,
    produto_registro: produtoRegistro,
    empresa,
    segmento: pickValue(selection.segmento, diagnostico.segmento, diagnostico.nicho),
    template: selection.template,
    preview_url: previewAction.preview_url,
    preview_token: previewAction.preview_token,
    slug: previewAction.slug
  };

  if (leadId) {
    upsertLead(
      {
        lead_id: leadId,
        nome_empresa: empresa,
        segmento: baseModel.segmento,
        dor_principal: dorPrincipal,
        produto_indicado: produtoIndicado,
        template_indicado: selection.template,
        preview_slug: previewAction.slug || "",
        preview_token: previewAction.preview_token || ""
      },
      { leadsStorePath: options.leadsStorePath }
    );
  }

  return {
    ...baseModel,
    whatsapp_url: buildWhatsAppUrl(source, baseModel)
  };
}

function renderFinalScreen(input, options = {}) {
  const model = buildFinalScreenModel(input, options);
  const previewDisabled = model.preview_url ? "" : " is-disabled";
  const previewHref = model.preview_url || "#";

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(model.titulo)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #070b12;
        --panel: #101827;
        --panel-strong: #162133;
        --line: rgba(255, 255, 255, 0.12);
        --text: #f7fbff;
        --muted: #a9b5c8;
        --accent: #88f5df;
        --accent-strong: #32d7ad;
        --whatsapp: #27c36f;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 18% 12%, rgba(136, 245, 223, 0.16), transparent 34%),
          linear-gradient(145deg, #070b12 0%, #0c101b 45%, #160d1d 100%);
        color: var(--text);
      }

      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 28px;
      }

      .result-card {
        width: min(100%, 760px);
        border: 1px solid var(--line);
        border-radius: 28px;
        background: linear-gradient(180deg, rgba(22, 33, 51, 0.94), rgba(11, 16, 27, 0.98));
        box-shadow: 0 32px 90px rgba(0, 0, 0, 0.46);
        padding: clamp(28px, 6vw, 54px);
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 12px;
        border: 1px solid rgba(136, 245, 223, 0.32);
        border-radius: 999px;
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 22px 0 14px;
        max-width: 12ch;
        font-size: clamp(2.25rem, 7vw, 4.7rem);
        line-height: 0.96;
        letter-spacing: 0;
      }

      .summary {
        max-width: 58ch;
        margin: 0;
        color: var(--muted);
        font-size: clamp(1rem, 2vw, 1.2rem);
        line-height: 1.65;
      }

      .product {
        display: grid;
        gap: 8px;
        margin: 30px 0;
        padding: 20px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.045);
      }

      .product span {
        color: var(--muted);
        font-size: 0.9rem;
      }

      .product strong {
        color: var(--text);
        font-size: clamp(1.35rem, 3vw, 2rem);
        line-height: 1.12;
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 54px;
        padding: 0 18px;
        border-radius: 16px;
        color: var(--text);
        font-weight: 900;
        text-align: center;
        text-decoration: none;
      }

      .button.primary {
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #06131a;
      }

      .button.secondary {
        background: linear-gradient(135deg, var(--whatsapp), #168a50);
      }

      .button.is-disabled {
        pointer-events: none;
        opacity: 0.48;
      }

      @media (max-width: 560px) {
        main {
          padding: 18px;
          place-items: stretch;
        }

        .result-card {
          border-radius: 22px;
          align-self: center;
        }

        h1 {
          max-width: 10ch;
        }

        .actions {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="result-card" aria-labelledby="diagnostic-title">
        <span class="eyebrow">${escapeHtml(model.template || "dnAi")}</span>
        <h1 id="diagnostic-title">${escapeHtml(model.titulo)}</h1>
        <p class="summary">${escapeHtml(model.resumo)}</p>

        <div class="product">
          <span>Produto indicado:</span>
          <strong>${escapeHtml(model.produto_indicado)}</strong>
        </div>

        <div class="actions">
          <a class="button primary${previewDisabled}" href="${escapeAttribute(previewHref)}">Ver Minha Prévia</a>
          <a class="button secondary" href="${escapeAttribute(model.whatsapp_url)}" target="_blank" rel="noopener">Falar no WhatsApp</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

async function runCli() {
  const [, , input] = process.argv;
  const raw = (!input || input === "-") ? await readStdin() : input;
  const data = readJsonInput(raw);

  process.stdout.write(renderFinalScreen(data));
}

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildFinalScreenModel,
  buildResumo,
  buildWhatsAppUrl,
  renderFinalScreen,
  resolvePreviewAction
};
