import { describe, expect, it } from 'vitest';
import {
  fuzzyMatchIndices,
  fuzzyMatchesHaystack,
  fuzzySubsequence,
} from '../../utils/fuzzyMatch';

describe('fuzzySubsequence', () => {
  it('matches when pattern chars appear in order', () => {
    expect(fuzzySubsequence('Bambu PLA Basic', 'bpb')).toBe(true);
    expect(fuzzySubsequence('Bambu PLA Basic', 'pla bas')).toBe(true);
  });

  it('rejects when a char is missing or out of order', () => {
    expect(fuzzySubsequence('Bambu PLA Basic', 'pbb')).toBe(false);
    expect(fuzzySubsequence('Bambu PLA Basic', 'xyz')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(fuzzySubsequence('Bambu PLA Basic', 'BAMB')).toBe(true);
  });

  it('treats empty pattern as match', () => {
    expect(fuzzySubsequence('anything', '')).toBe(true);
    expect(fuzzySubsequence('anything', '   ')).toBe(true);
  });
});

describe('fuzzyMatchesHaystack', () => {
  it('requires every whitespace-separated token to match', () => {
    expect(fuzzyMatchesHaystack('bambu pla basic black', 'pla black')).toBe(true);
    expect(fuzzyMatchesHaystack('bambu pla basic black', 'pla petg')).toBe(false);
  });
});

describe('fuzzyMatchIndices', () => {
  it('returns matched character indices', () => {
    expect(fuzzyMatchIndices('Bambu PLA Basic', 'bpb')).toEqual([0, 6, 10]);
  });

  it('returns null when there is no match', () => {
    expect(fuzzyMatchIndices('Bambu PLA Basic', 'zzz')).toBeNull();
  });
});
