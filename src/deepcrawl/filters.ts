export interface UrlFilterContext {
  url: string;
  depth: number;
  parentUrl?: string;
  seedHost: string;
  contentType?: string;
}

export type UrlFilter = (
  url: string,
  context: UrlFilterContext,
) => boolean | Promise<boolean>;

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, "");
}

function normalizeConfiguredDomain(domain: string): string {
  const trimmed = domain.trim();
  if (!trimmed) return "";
  try {
    const needsScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return normalizeHost(new URL(needsScheme).hostname);
  } catch {
    return normalizeHost(trimmed.replace(/^[^/]*:\/\//i, "").split("/")[0].split(":")[0]);
  }
}

function matchesDomain(hostname: string, configuredDomain: string): boolean {
  return hostname === configuredDomain || hostname.endsWith(`.${configuredDomain}`);
}

export class FilterChain {
  private readonly filters: UrlFilter[];

  constructor(filters: UrlFilter[] = []) {
    this.filters = [...filters];
  }

  add(filter: UrlFilter): FilterChain {
    return new FilterChain([...this.filters, filter]);
  }

  async test(url: string, context: UrlFilterContext): Promise<boolean> {
    for (const filter of this.filters) {
      const allowed = await filter(url, context);
      if (!allowed) return false;
    }
    return true;
  }
}

export function createUrlPatternFilter(patterns: string[]): UrlFilter {
  const compiled = patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => wildcardToRegex(pattern));

  if (compiled.length === 0) {
    return async () => true;
  }

  return async (url) => compiled.some((regex) => regex.test(url));
}

export function createDomainFilter(
  allowDomains: string[] = [],
  blockDomains: string[] = [],
): UrlFilter {
  const allow = allowDomains.map(normalizeConfiguredDomain).filter(Boolean);
  const block = blockDomains.map(normalizeConfiguredDomain).filter(Boolean);

  return async (url) => {
    let host = "";
    try {
      host = normalizeHost(new URL(url).hostname);
    } catch {
      return false;
    }

    if (block.some((domain) => matchesDomain(host, domain))) return false;
    if (allow.length === 0) return true;
    return allow.some((domain) => matchesDomain(host, domain));
  };
}

export function createContentTypeFilter(allowedTypes: string[]): UrlFilter {
  const normalized = allowedTypes
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) {
    return async () => true;
  }
  return async (_url, context) => {
    if (!context.contentType) return true;
    const lower = context.contentType.toLowerCase();
    return normalized.some((allowed) => lower.includes(allowed));
  };
}
