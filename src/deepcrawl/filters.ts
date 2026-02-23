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
  return host.trim().toLowerCase();
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
  const allow = new Set(allowDomains.map(normalizeHost).filter(Boolean));
  const block = new Set(blockDomains.map(normalizeHost).filter(Boolean));

  return async (url) => {
    let host = "";
    try {
      host = normalizeHost(new URL(url).host);
    } catch {
      return false;
    }

    if (block.has(host)) return false;
    if (allow.size === 0) return true;
    return allow.has(host);
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

