import { csvCell } from './csv.util';

describe('csvCell', () => {
  it('prefixes formula injection', () => {
    expect(csvCell('=CMD|calc')).toMatch(/^'/);
    expect(csvCell('+1234')).toMatch(/^'/);
    expect(csvCell('-x')).toMatch(/^'/);
    expect(csvCell('@SUM(A1)')).toMatch(/^'/);
  });

  it('quotes fields with commas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('escapes embedded quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});
