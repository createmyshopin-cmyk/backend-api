import { BadRequestException } from '@nestjs/common';
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  maskBankAccount,
  maskUpi,
  validateDateRange,
  validateHistoryPage,
} from './pagination.util';

describe('pagination.util', () => {
  it('clampLimit defaults and caps', () => {
    expect(clampLimit()).toBe(20);
    expect(clampLimit(100)).toBe(50);
    expect(clampLimit(0)).toBe(1);
  });

  it('encodes and decodes cursor', () => {
    const c = encodeCursor('2026-06-10T10:00:00.000Z', 'uuid-1');
    expect(decodeCursor(c)).toEqual({
      t: '2026-06-10T10:00:00.000Z',
      id: 'uuid-1',
    });
  });

  it('rejects invalid cursor', () => {
    expect(() => decodeCursor('not-valid')).toThrow(BadRequestException);
  });

  it('rejects page > 1 without cursor', () => {
    expect(() => validateHistoryPage(2)).toThrow(BadRequestException);
  });

  it('allows page 1 without cursor', () => {
    expect(() => validateHistoryPage(1)).not.toThrow();
  });

  it('limits date range to 365 days', () => {
    expect(() =>
      validateDateRange('2024-01-01', '2026-06-10'),
    ).toThrow(BadRequestException);
  });

  it('masks UPI and bank account', () => {
    expect(maskUpi('priya@upi')).toBe('pri***@upi');
    expect(maskBankAccount('1234567890')).toBe('****7890');
  });
});
