import { describe, expect, it } from 'vitest';
import { expandBeeMacroLabels } from './beeConversationUi';

describe('readable Bee conversations', () => {
  it('expands old assistant macro groups with units without altering products or values', () => {
    expect(expandBeeMacroLabels('TEST DATA: 1005 kcal, P124 C7 F49. Does this look right?')).toBe('TEST DATA: 1005 kcal, Protein 124 g · Carbohydrates 7 g · Fat 49 g. Does this look right?');
    expect(expandBeeMacroLabels('TEST DATA P1.5 C0 F2.2')).toContain('Protein 1.5 g · Carbohydrates 0 g · Fat 2.2 g');
    expect(expandBeeMacroLabels('Product P139 and vitamin C123')).toBe('Product P139 and vitamin C123');
  });
});
