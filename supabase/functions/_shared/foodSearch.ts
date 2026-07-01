const RAW_OR_DRY_PATTERN =
  /\b(raw|dry|dried|uncooked|unprepared|instant\s+dry)\b/i;
const COOKED_OR_PREPARED_PATTERN =
  /\b(cooked|steamed|boiled|prepared|fried|baked|roasted)\b/i;
const RICE_PATTERN = /\brice\b/i;
const NON_RICE_STAPLE_PATTERN =
  /\b(flour|milk|vinegar|cracker|cake|cereal|bran|paper)\b/i;

export function buildUsdaSearchTerms(term: string): string[] {
  const normalized = term.trim().replace(/\s+/g, " ");
  if (!normalized) return [];

  if (shouldDefaultRiceToCooked(normalized)) {
    return [
      `${normalized} cooked no added fat`,
      `${normalized} cooked`,
      normalized,
    ];
  }

  return [normalized];
}

function shouldDefaultRiceToCooked(term: string) {
  return (
    RICE_PATTERN.test(term) &&
    !NON_RICE_STAPLE_PATTERN.test(term) &&
    !RAW_OR_DRY_PATTERN.test(term) &&
    !COOKED_OR_PREPARED_PATTERN.test(term)
  );
}
