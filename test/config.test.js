import { expect, test } from 'vitest';
import { normalizeToken } from '../src/config/index.js';

test('normalizeToken removes a leading Bot prefix', () => {
    expect(normalizeToken('Bot abc.def')).toBe('abc.def');
    expect(normalizeToken('abc.def')).toBe('abc.def');
    expect(normalizeToken('')).toBe(null);
});
