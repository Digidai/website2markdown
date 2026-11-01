import type { Env } from "../types";
import type { AdminChannel, ChannelStatus, ChannelTestResult, ProviderPathHealth } from "../../web/contract";
import { fetchWithBrowser } from "../browser";
import { fetchViaCfMarkdown } from "../cf-rest";
import { fetchViaFirecrawl } from "../firecrawl";
import { fetchViaContextDev } from "../context-dev";
import { fetchViaJina } from "../jina";
import { fetchArchiveToday, fetchWaybackSnapshot } from "../paywall";
import { fetchViaProxy, parseProxyPool, parseProxyUrl, type ProxyConfig } from "../proxy";
import { sanitizeErrorMessage } from "../observability/conversion-events";
import { errorMessage } from "../utils";

const PROBE_URL = "https://example.com/";

interface ChannelSpec {
  id: string;
  name: string;
  role: string;
  /** provider-attempt paths whose counts belong to this channel */
  paths: string[];
  env: { name: string; required: boolean }[];
  /** Overrides the status derived from required env vars. */
  status?: (env: Env) => { status: ChannelStatus; note: string } | null;
  test?: (env: Env, host: string) => Promise<string[]>;
}

const PROXY_ENV = [
  { name: "PROXY_URL", required: false },
  { name: "PROXY_POOL", required: false },
];

function proxyStatus(env: Env): { status: ChannelStatus; note: string } | null {
  return env.PROXY_URL || env.PROXY_POOL
    ? null
    : { status: "missing", note: "PROXY_URL 和 PROXY_POOL 都没有配置。" };
}

const CHANNELS: ChannelSpec[] = [
  {
    id: "static",
    name: "直接抓取",
    role: "第一步，所有请求都先从 Worker 直接请求原站。",
    paths: [],
    env: [],
    test: async () => {
      const resp = await fetch(PROBE_URL, { signal: AbortSignal.timeout(10_000) });
      const body = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return [`HTTP ${resp.status}，${body.length} 字节`];
    },
  },
  {
    id: "browser",
    name: "Cloudflare 浏览器渲染",
    role: "登录用户的 JS 页面、强制浏览器，以及微信、知乎、飞书等必须渲染的站点。",
    paths: ["browser"],
    env: [{ name: "MYBROWSER（绑定）", required: true }],
    status: (env) => (env.MYBROWSER ? null : { status: "missing", note: "wrangler.toml 里没有 browser 绑定。" }),
    test: async (env, host) => {
      const html = await fetchWithBrowser(PROBE_URL, env, host);
      return [`渲染出 ${html.length} 字节 HTML`];
    },
  },
  {
    id: "proxy",
    name: "Swiftproxy 代理",
    role: "匿名用户访问必须渲染的站点，以及浏览器被拦后的代理重试。",
    paths: ["proxy_pool", "proxy"],
    env: PROXY_ENV,
    status: proxyStatus,
    test: (env) => diagnoseProxy(env),
  },
  {
    id: "substack_proxy",
    name: "Substack 代理重试",
    role: "Substack 文章接口直连返回 429 时，经 Swiftproxy 重试一次。",
    paths: ["substack_proxy"],
    env: PROXY_ENV,
    status: proxyStatus,
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    role: "登录用户的 engine=firecrawl、非 HTML 内容，以及正文过短时的兜底。",
    paths: ["firecrawl"],
    env: [{ name: "FIRECRAWL_API_KEY", required: false }, { name: "FIRECRAWL_API_URL", required: false }],
    status: (env) => (env.FIRECRAWL_API_KEY
      ? null
      : { status: "active", note: "没有 API key，走 Firecrawl 匿名免费额度（限速更严）。配上 key 可提额。" }),
    test: async (env) => {
      const result = await fetchViaFirecrawl(PROBE_URL, { apiKey: env.FIRECRAWL_API_KEY, apiUrl: env.FIRECRAWL_API_URL, timeoutMs: 20_000 });
      return [`返回 ${result.markdown.length} 字 Markdown`];
    },
  },
  {
    id: "jina",
    name: "Jina Reader",
    role: "登录用户的 engine=jina，以及 Firecrawl 失败后的兜底。无需 key，免费限速。",
    paths: ["jina"],
    env: [],
    test: async () => {
      const result = await fetchViaJina(PROBE_URL, 15_000);
      return [`返回 ${result.markdown.length} 字 Markdown`];
    },
  },
  {
    id: "cf_markdown",
    name: "Cloudflare /markdown",
    role: "只在 engine=cf 且允许浏览器渲染时调用。每次都会启动一个计费浏览器。",
    paths: ["cf_markdown"],
    env: [{ name: "CF_ACCOUNT_ID", required: true }, { name: "CF_API_TOKEN", required: true }],
    test: async (env) => {
      const result = await fetchViaCfMarkdown(PROBE_URL, { accountId: env.CF_ACCOUNT_ID!, apiToken: env.CF_API_TOKEN!, timeoutMs: 30_000 });
      return [`返回 ${result.markdown.length} 字 Markdown`];
    },
  },
  {
    id: "context_dev",
    name: "Context.dev",
    role: "最后兜底：登录用户在原站拦截或浏览器失败时调用；匿名用户只用于微信等必须渲染的站点，全站每天最多 40 次。免费每月 1,000 次。",
    paths: ["context_dev"],
    env: [{ name: "CONTEXT_DEV_API_KEY", required: true }],
    test: async (env) => {
      const result = await fetchViaContextDev(PROBE_URL, env.CONTEXT_DEV_API_KEY || "", 30_000);
      return [
        `渲染出 ${result.html.length} 字节 HTML`,
        ...(result.creditsRemaining == null ? [] : [`剩余额度 ${result.creditsRemaining}`]),
      ];
    },
  },
  {
    id: "wayback",
    name: "Wayback Machine",
    role: "付费墙站点原站失败或正文过短时，取存档快照。",
    paths: ["wayback"],
    env: [],
    test: async () => {
      const html = await fetchWaybackSnapshot(PROBE_URL);
      if (!html) throw new Error("没有可用快照");
      return [`快照 ${html.length} 字节`];
    },
  },
  {
    id: "archive_today",
    name: "archive.today",
    role: "Wayback 也失败时的第二个存档源。",
    paths: ["archive_today"],
    env: [],
    test: async () => {
      const html = await fetchArchiveToday(PROBE_URL);
      if (!html) throw new Error("没有可用存档");
      return [`存档 ${html.length} 字节`];
    },
  },
  {
    id: "browser_use",
    name: "Browser Use",
    role: "匿名用户的远程浏览器。付费额度用完，已停用。",
    paths: ["browser_use"],
    env: [{ name: "BROWSER_USE_API_KEY", required: true }],
    status: (env) => (env.BROWSER_USE_API_KEY ? null : { status: "disabled", note: "已停用：key 已删除，代码保留。" }),
  },
];

function isSet(env: Env, name: string): boolean {
  const key = name.split("（")[0] as keyof Env;
  return Boolean(env[key]);
}

export function listChannels(env: Env, health: ProviderPathHealth[]): AdminChannel[] {
  const byPath = new Map(health.map((row) => [row.path, row]));
  return CHANNELS.map((spec) => {
    const vars = spec.env.map((v) => ({ name: v.name, required: v.required, set: isSet(env, v.name) }));
    const override = spec.status?.(env) ?? null;
    const missing = vars.filter((v) => v.required && !v.set).map((v) => v.name);
    const status: ChannelStatus = override?.status ?? (missing.length ? "missing" : "active");
    const note = override?.note ?? (missing.length ? `缺少 ${missing.join("、")}。` : "已配置。");
    const rows = spec.paths.map((path) => byPath.get(path)).filter((row): row is ProviderPathHealth => Boolean(row));
    return {
      id: spec.id,
      name: spec.name,
      role: spec.role,
      status,
      statusNote: note,
      env: vars,
      testable: Boolean(spec.test) && status !== "disabled",
      health: rows.length ? mergeHealth(spec.id, rows) : null,
    };
  });
}

function mergeHealth(id: string, rows: ProviderPathHealth[]): ProviderPathHealth {
  const latest = [...rows].sort((a, b) => b.lastFailureAt.localeCompare(a.lastFailureAt))[0];
  return {
    path: id,
    attempts: rows.reduce((sum, row) => sum + row.attempts, 0),
    failures: rows.reduce((sum, row) => sum + row.failures, 0),
    lastError: latest.lastError,
    lastFailureAt: latest.lastFailureAt,
  };
}

/** Runs one live probe against example.com. Never records provider attempts. */
export async function testChannel(env: Env, id: string, host: string): Promise<ChannelTestResult> {
  const spec = CHANNELS.find((c) => c.id === id);
  if (!spec?.test) return { ok: false, ms: 0, summary: "这个渠道不能测试。", details: [] };
  const started = Date.now();
  try {
    const details = await spec.test(env, host);
    return { ok: true, ms: Date.now() - started, summary: "可用", details };
  } catch (error) {
    const diag = error instanceof DiagnosisError ? error.details : [];
    return { ok: false, ms: Date.now() - started, summary: sanitizeErrorMessage(error), details: diag };
  }
}

class DiagnosisError extends Error {
  constructor(message: string, readonly details: string[]) {
    super(message);
  }
}

async function diagnoseProxy(env: Env): Promise<string[]> {
  const details: string[] = [];
  const proxies: ProxyConfig[] = env.PROXY_POOL ? parseProxyPool(env.PROXY_POOL) : [];
  const single = env.PROXY_URL ? parseProxyUrl(env.PROXY_URL) : null;
  if (proxies.length === 0 && single) proxies.push(single);
  const proxy = proxies[0];
  if (!proxy) throw new DiagnosisError("PROXY_URL 无法解析", details);

  details.push(`代理地址 ${proxy.host}:${proxy.port}，共 ${proxies.length} 个`);

  try {
    const result = await fetchViaProxy(PROBE_URL, proxy, {}, 15_000);
    details.push(`经代理请求 example.com：HTTP ${result.status}，${result.body.length} 字节`);
    if (result.status < 200 || result.status >= 400) throw new DiagnosisError(`代理返回 HTTP ${result.status}`, details);
  } catch (error) {
    if (error instanceof DiagnosisError) throw error;
    const message = sanitizeErrorMessage(errorMessage(error));
    details.push(`经代理请求失败：${message}`);
    throw new DiagnosisError(message, details);
  }
  return details;
}
