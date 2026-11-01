/**
 * Server half of the HeroUI front end. The Worker imports this module
 * (alias "@web/server") and returns full HTML documents. The browser bundle
 * (web/entries/*, built by Vite into web-dist/_app) hydrates the same tree.
 */
import { renderToString } from "react-dom/server";
import { App, type AppState } from "./app";
import { THEME_BOOT_SCRIPT, type Lang, type ReaderMethod, type SitePage, type WebRenderers } from "./contract";
import { landingCopy } from "./pages/landing";

export type { SitePage };

const ASSET_CSS = "/_app/app.css";
/** Browser entry per view; see the inputs in vite.config.ts. */
const ASSET_JS: Record<AppState["view"], string> = {
  landing: "/_app/landing.js",
  portal: "/_app/portal.js",
  loading: "/_app/reader.js",
  reader: "/_app/reader.js",
  error: "/_app/reader.js",
  admin: "/_app/admin.js",
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function rawPath(url: string): string {
  return `/${encodeURIComponent(url)}?raw=true`;
}

function documentHTML(opts: { lang: string; head: string; state: AppState; extraBody?: string }): string {
  const body = renderToString(<App state={opts.state} />);
  return `<!DOCTYPE html>
<html lang="${esc(opts.lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>${THEME_BOOT_SCRIPT}</script>
${opts.head}
<link rel="stylesheet" href="${ASSET_CSS}">
<script type="module" src="${ASSET_JS[opts.state.view]}"></script>
</head>
<body class="bg-background text-foreground antialiased">
<div id="root">${body}</div>
<script type="application/json" id="__props">${scriptJson(opts.state)}</script>
${opts.extraBody ?? ""}
</body>
</html>`;
}

const PAGE_PATH: Record<SitePage, string> = {
  home: "/",
  examples: "/examples",
  docs: "/docs",
  integration: "/integrations",
};

function zhHref(path: string) {
  return path === "/" ? "/?lang=zh" : `${path}?lang=zh`;
}

export const landingPageHTML: WebRenderers["landingPageHTML"] = (host, lang: Lang = "en", page: SitePage = "home") => {
  const t = landingCopy(lang, host);
  const isZh = lang === "zh";
  const h = esc(host);
  const path = PAGE_PATH[page];
  const title =
    page === "examples" ? (isZh ? "示例" : "Examples")
    : page === "docs" ? (isZh ? "文档" : "Docs")
    : page === "integration" ? (isZh ? "集成" : "Integrations")
    : t.pageTitle;
  const canonical = `https://${h}${isZh ? zhHref(path) : path}`;
  const faqs = [1, 2, 3, 4, 5, 6].map((n) => ({
    q: t[`faq${n}Q` as keyof typeof t],
    a: t[`faq${n}A` as keyof typeof t],
  }));
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Website2Markdown",
        alternateName: host,
        description: t.schemaDescription,
        url: `https://${host}/`,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: ["URL to Markdown conversion", "15 platform adapters", "Batch API", "Structured extraction", "Deep crawl", "MCP Server", "Agent Skills", "llms.txt"],
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        codeRepository: "https://github.com/Digidai/website2markdown",
        sameAs: [
          "https://github.com/Digidai/website2markdown",
          "https://www.npmjs.com/package/@digidai/mcp-website2markdown",
          "https://github.com/Digidai/website2markdown-skills",
        ],
        speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".hero-subtitle", "#faq"] },
      },
      { "@type": "Organization", name: "Digidai", url: `https://${host}`, sameAs: ["https://github.com/Digidai"] },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
      {
        "@type": "HowTo",
        name: isZh ? "如何将 URL 转换为 Markdown" : "How to convert a URL to Markdown",
        step: [
          { "@type": "HowToStep", name: t.step1Title, text: t.step1Desc },
          { "@type": "HowToStep", name: t.step2Title, text: t.step2Desc },
          { "@type": "HowToStep", name: t.step3Title, text: t.step3Desc },
        ],
      },
    ],
  };
  const head = `<title>${h} - ${esc(title)}</title>
<meta name="description" content="${esc(t.metaDescription)}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<meta name="author" content="Digidai">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="en" href="https://${h}${path}">
<link rel="alternate" hreflang="zh" href="https://${h}${zhHref(path)}">
<link rel="alternate" hreflang="x-default" href="https://${h}${path}">
<meta property="og:type" content="website">
<meta property="og:title" content="${h} — ${esc(title)}">
<meta property="og:description" content="${esc(t.shareDescription)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${h}">
<meta property="og:image" content="https://${h}/api/og">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${esc(t.locale)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${h} — ${esc(title)}">
<meta name="twitter:description" content="${esc(t.shareDescription)}">
<meta name="twitter:image" content="https://${h}/api/og">`;
  return documentHTML({
    lang: t.htmlLang,
    head,
    state: { view: "landing", props: { host, lang, page } },
    extraBody: page === "home" ? `<script type="application/ld+json">${scriptJson(schema)}</script>` : "",
  });
};

export const portalPageHTML: WebRenderers["portalPageHTML"] = () =>
  documentHTML({
    lang: "en",
    head: `<title>Developer Portal — mdget.dev</title>\n<meta name="robots" content="noindex, nofollow">`,
    state: { view: "portal", props: { host: "mdget.dev" } },
  });

export const loadingPageHTML: WebRenderers["loadingPageHTML"] = (host, targetUrl, extraStreamParams, rawRequestPath = rawPath(targetUrl)) => {
  const streamUrl = `/api/stream?url=${encodeURIComponent(targetUrl)}${extraStreamParams}`;
  return documentHTML({
    lang: "en",
    head: `<title>Converting… — ${esc(host)}</title>
<meta name="robots" content="noindex, nofollow">
<noscript><meta http-equiv="refresh" content="0;url=${esc(rawRequestPath)}"></noscript>`,
    state: { view: "loading", props: { host, targetUrl, streamUrl, rawRequestPath } },
  });
};

function contentSnippet(content: string, maxLen = 160): string {
  const plain = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s/gm, "")
    .replace(/^>\s/gm, "")
    .replace(/\n+/g, " ")
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen - 1) + "\u2026" : plain;
}

export const renderedPageHTML: WebRenderers["renderedPageHTML"] = (
  host,
  content,
  sourceUrl,
  tokenCount,
  method: ReaderMethod,
  cached = false,
  articleTitle = "",
  rawRequestPath = rawPath(sourceUrl),
) => {
  const ogTitle = articleTitle || sourceUrl;
  const description = contentSnippet(content);
  const ogImage = `https://${host}/api/og?title=${encodeURIComponent(ogTitle)}`;
  const head = `<title>${esc(ogTitle)} — ${esc(host)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${esc(sourceUrl)}">
<link rel="alternate" type="text/markdown" href="${esc(rawRequestPath)}" title="Markdown">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="https://${esc(host)}/${esc(sourceUrl)}">
<meta property="og:site_name" content="${esc(host)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">`;
  return documentHTML({
    lang: "en",
    head,
    state: {
      view: "reader",
      props: { host, sourceUrl, rawRequestPath, method, cached, tokenCount, title: articleTitle, content },
    },
  });
};

export const errorPageHTML: WebRenderers["errorPageHTML"] = (title, message, statusCode) =>
  documentHTML({
    lang: "en",
    head: `<title>Error — ${esc(title)}</title>
<meta name="robots" content="noindex, nofollow">
<meta property="og:title" content="Error — ${esc(title)}">
<meta property="og:type" content="website">`,
    state: { view: "error", props: { title, message, status: statusCode } },
  });

export const adminPageHTML: WebRenderers["adminPageHTML"] = (state) => {
  const title = state.mode === "login" ? "登录" : state.mode === "detail" ? "转换记录" : "运营后台";
  return documentHTML({
    lang: "zh-CN",
    head: `<title>${title} — mdget.dev</title>\n<meta name="robots" content="noindex, nofollow">`,
    state: { view: "admin", props: state },
  });
};
