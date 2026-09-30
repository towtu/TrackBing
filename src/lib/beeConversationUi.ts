/** A transient Search answer follows the stored messages and owns the latest avatar. */
export function latestBeeMessageId(
  messages: readonly {id:string;role:'user'|'assistant'}[],
  hasLiveAnswer: boolean,
): string | null {
  if (hasLiveAnswer) return null;
  for (let index=messages.length-1;index>=0;index--) {
    if (messages[index].role==='assistant') return messages[index].id;
  }
  return null;
}

/** Display compatibility for older assistant macro groups; never changes stored numbers. */
export function expandBeeMacroLabels(text: string): string {
  return text.replace(/\bP(\d+(?:\.\d+)?)\s+C(\d+(?:\.\d+)?)\s+F(\d+(?:\.\d+)?)/g,
    'Protein $1 g · Carbohydrates $2 g · Fat $3 g');
}
