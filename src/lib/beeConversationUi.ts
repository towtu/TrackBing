/** Display compatibility for older assistant macro groups; never changes stored numbers. */
export function expandBeeMacroLabels(text: string): string {
  return text.replace(/\bP(\d+(?:\.\d+)?)\s+C(\d+(?:\.\d+)?)\s+F(\d+(?:\.\d+)?)/g,
    'Protein $1 g · Carbohydrates $2 g · Fat $3 g');
}
