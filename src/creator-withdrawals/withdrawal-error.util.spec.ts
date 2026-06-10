import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  assertIdempotencyKey,
  isHttpExceptionWithCode,
  mapWithdrawalRpcError,
  readOnlyViolation,
} from './withdrawal-error.util';

describe('withdrawal-error.util', () => {
  it('assertIdempotencyKey rejects empty', () => {
    expect(() => assertIdempotencyKey(undefined)).toThrow(BadRequestException);
  });

  it('maps insufficient_balance', () => {
    expect(() => mapWithdrawalRpcError({ message: 'insufficient_balance' }, 't')).toThrow(
      BadRequestException,
    );
    try {
      mapWithdrawalRpcError({ message: 'insufficient_balance' }, 't');
    } catch (e) {
      expect(isHttpExceptionWithCode(e, 'insufficient_balance')).toBe(true);
    }
  });

  it('maps withdrawal_inflight', () => {
    expect(() => mapWithdrawalRpcError({ message: 'withdrawal_inflight' }, 't')).toThrow(
      ConflictException,
    );
  });

  it('maps daily_limit_exceeded', () => {
    expect(() => mapWithdrawalRpcError({ message: 'daily_limit_exceeded' }, 't')).toThrow(
      ForbiddenException,
    );
  });

  it('maps kyc_required and invalid_account', () => {
    expect(() => mapWithdrawalRpcError({ message: 'kyc_required' }, 't')).toThrow(
      ForbiddenException,
    );
    expect(() => mapWithdrawalRpcError({ message: 'invalid_account' }, 't')).toThrow(
      BadRequestException,
    );
  });

  it('readOnlyViolation throws read_only', () => {
    expect(() => readOnlyViolation()).toThrow(ForbiddenException);
    try {
      readOnlyViolation();
    } catch (e) {
      expect(isHttpExceptionWithCode(e, 'read_only')).toBe(true);
    }
  });
});
