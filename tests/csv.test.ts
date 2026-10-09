import { describe, expect, it } from 'vitest';
import { csvCell, csvRow } from '@/lib/csv';

describe('csv', () => {
  it('quotes and escapes', () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell(null)).toBe('""');
    expect(csvRow(['x', 1, 'y,z'])).toBe('"x","1","y,z"');
  });
  it.each(['=1+1', '+cmd', '-2', '@SUM(A1)', '\tx'])('neutralises formula prefix %j', v => {
    expect(csvCell(v).startsWith(`"'`)).toBe(true);
  });
});
