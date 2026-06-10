import { BadRequestException } from '@nestjs/common';

export interface HistoryCursor {
  t: string;
  id: string;
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_DATE_RANGE_DAYS = 365;

export function clampLimit(limit?: number): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export function encodeCursor(t: string, id: string): string {
  return Buffer.from(JSON.stringify({ t, id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): HistoryCursor {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as { t?: string; id?: string };
    if (!parsed.t || !parsed.id) {
      throw new Error('missing fields');
    }
    const at = new Date(parsed.t);
    if (Number.isNaN(at.getTime())) {
      throw new Error('invalid timestamp');
    }
    return { t: parsed.t, id: parsed.id };
  } catch {
    throw new BadRequestException({
      statusCode: 400,
      error: 'bad_request',
      code: 'invalid_cursor',
      message: 'Invalid pagination cursor',
    });
  }
}

export function validateHistoryPage(page?: number, cursor?: string): void {
  if (page != null && page > 1 && !cursor) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'bad_request',
      code: 'invalid_cursor',
      message: 'Page beyond 1 requires a cursor; use nextCursor from the previous response',
    });
  }
  if (page != null && (page < 1 || !Number.isInteger(page))) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'bad_request',
      code: 'validation_error',
      message: 'page must be a positive integer',
    });
  }
}

export function validateDateRange(from?: string, to?: string, accountCreatedAt?: string): {
  from?: string;
  to?: string;
} {
  let fromDate = from;
  let toDate = to;

  if (fromDate && Number.isNaN(Date.parse(fromDate))) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'validation_error',
      message: 'from must be a valid ISO date',
    });
  }
  if (toDate && Number.isNaN(Date.parse(toDate))) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'validation_error',
      message: 'to must be a valid ISO date',
    });
  }

  if (accountCreatedAt) {
    const min = accountCreatedAt.slice(0, 10);
    if (fromDate && fromDate < min) {
      fromDate = min;
    }
  }

  if (fromDate && toDate) {
    const diffMs = new Date(toDate).getTime() - new Date(fromDate).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_DATE_RANGE_DAYS) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'validation_error',
        message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
      });
    }
  }

  return { from: fromDate, to: toDate };
}

export function maskUpi(upi: string | null | undefined): string | null {
  if (!upi?.trim()) return null;
  const at = upi.indexOf('@');
  if (at <= 0) return '***';
  const local = upi.slice(0, at);
  const domain = upi.slice(at);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

export function maskBankAccount(num: string | null | undefined): string | null {
  if (!num?.trim()) return null;
  const digits = num.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `****${digits.slice(-4)}`;
}
