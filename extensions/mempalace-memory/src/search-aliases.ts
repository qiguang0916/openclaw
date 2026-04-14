const TERM_ALIASES: Record<string, string[]> = {
  飞书: ["feishu", "lark"],
  渠道: ["channel"],
  配置: ["config", "setup"],
  lark: ["feishu", "飞书"],
  feishu: ["lark", "飞书"],
  channel: ["渠道"],
  config: ["配置", "setup"],
  setup: ["配置", "config"],
};

function unique(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function expandSearchTerms(terms: string[]): string[] {
  return unique(
    terms.flatMap((term) => {
      const lower = term.toLowerCase();
      return [term, ...(TERM_ALIASES[lower] ?? TERM_ALIASES[term] ?? [])];
    }),
  );
}

export function buildSearchQueryVariants(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const rawTerms = trimmed
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
  const expandedTerms = expandSearchTerms(rawTerms);
  const variants = [trimmed];

  if (expandedTerms.length > rawTerms.length) {
    variants.push(expandedTerms.join(" "));
  }

  const chineseTerms = expandedTerms.filter((term) => /[\p{Script=Han}]/u.test(term));
  if (chineseTerms.length > 0) {
    variants.push(chineseTerms.join(" "));
  }

  const latinTerms = expandedTerms.filter((term) => /[a-z]/iu.test(term));
  if (latinTerms.length > 0) {
    variants.push(latinTerms.join(" "));
  }

  return unique(variants).slice(0, 4);
}
