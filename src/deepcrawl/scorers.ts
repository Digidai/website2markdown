export interface UrlScoreContext {
  depth: number;
  parentUrl?: string;
  anchorText?: string;
}

export interface UrlScorer {
  score(url: string, context: UrlScoreContext): number;
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

export class KeywordUrlScorer implements UrlScorer {
  private readonly keywords: string[];
  private readonly weight: number;

  constructor(keywords: string[], weight: number = 1) {
    this.keywords = keywords
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    this.weight = Number.isFinite(weight) ? weight : 1;
  }

  score(url: string, context: UrlScoreContext): number {
    if (this.keywords.length === 0) return 0;
    const target = normalizeText(`${url} ${context.anchorText || ""}`);
    let hits = 0;
    for (const keyword of this.keywords) {
      if (target.includes(keyword)) hits += 1;
    }
    return hits * this.weight;
  }
}

export class CompositeUrlScorer implements UrlScorer {
  private readonly scorers: UrlScorer[];

  constructor(scorers: UrlScorer[]) {
    this.scorers = scorers;
  }

  score(url: string, context: UrlScoreContext): number {
    return this.scorers.reduce((sum, scorer) => sum + scorer.score(url, context), 0);
  }
}

