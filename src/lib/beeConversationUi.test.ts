import { describe, expect, it } from 'vitest';
import { expandBeeMacroLabels, latestBeeMessageId } from './beeConversationUi';

describe('readable Bee conversations', () => {
  it('shows a mascot only for the latest assistant, even after a user message', () => {
    const messages = [{id:'first',role:'assistant' as const}, {id:'user',role:'user' as const}, {id:'latest',role:'assistant' as const}, {id:'followup',role:'user' as const}];
    expect(latestBeeMessageId(messages, false)).toBe('latest');
    expect(latestBeeMessageId(messages, true)).toBeNull();
    expect(latestBeeMessageId([], false)).toBeNull();
  });
  it('expands old assistant macro groups with units without altering products or values', () => {
    expect(expandBeeMacroLabels('TEST DATA: 1005 kcal, P124 C7 F49. Does this look right?')).toBe('TEST DATA: 1005 kcal, Protein 124 g · Carbohydrates 7 g · Fat 49 g. Does this look right?');
    expect(expandBeeMacroLabels('TEST DATA P1.5 C0 F2.2')).toContain('Protein 1.5 g · Carbohydrates 0 g · Fat 2.2 g');
    expect(expandBeeMacroLabels('Product P139 and vitamin C123')).toBe('Product P139 and vitamin C123');
  });
});
