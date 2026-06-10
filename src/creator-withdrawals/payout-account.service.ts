import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { isPayoutEncryptionKeyConfigured } from '../payout-foundation/payout-mask.util';
import type { CreatorRequestScope } from '../creator-dashboard/creator-dashboard.types';
import type { PutPayoutAccountDto } from './dto/payout-account.dto';
import { mapWithdrawalRpcError } from './withdrawal-error.util';

export interface PayoutAccountResponse {
  schemaVersion: string;
  hasAccount: boolean;
  account: {
    id: string;
    type: 'upi' | 'bank';
    accountHolderName: string;
    maskedDestination: string | null;
    bankName: string | null;
    ifscCode: string | null;
    status: string;
    isDefault: boolean;
    verifiedAt: string | null;
    createdAt: string;
    updatedAt: string | null;
  } | null;
}

interface RpcAccountRow {
  id: string;
  type: 'upi' | 'bank';
  accountName: string;
  upiIdMasked?: string | null;
  bankName?: string | null;
  accountNumberMasked?: string | null;
  ifscCode?: string | null;
  isDefault: boolean;
  status: string;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

@Injectable()
export class PayoutAccountService {
  private readonly logger = new Logger(PayoutAccountService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getAccount(scope: CreatorRequestScope): Promise<PayoutAccountResponse> {
    if (!this.supabase.isConfigured) {
      return { schemaVersion: '3.2.0', hasAccount: false, account: null };
    }

    const { data, error } = await this.supabase.getClient().rpc('get_creator_default_payout_account', {
      p_creator_profile_id: scope.creatorProfileId,
    });

    if (error) {
      mapWithdrawalRpcError(error, 'get_creator_default_payout_account');
    }

    const payload = data as { hasAccount?: boolean; account?: RpcAccountRow | null };
    if (!payload?.hasAccount || !payload.account) {
      return { schemaVersion: '3.2.0', hasAccount: false, account: null };
    }

    return {
      schemaVersion: '3.2.0',
      hasAccount: true,
      account: this.mapAccount(payload.account),
    };
  }

  async putAccount(
    scope: CreatorRequestScope,
    dto: PutPayoutAccountDto,
  ): Promise<PayoutAccountResponse> {
    this.validatePutDto(dto);

    if (!this.supabase.isConfigured) {
      throw new InternalServerErrorException('Payout accounts require Supabase');
    }

    const key = process.env.PAYOUT_FIELD_ENCRYPTION_KEY;
    if (!isPayoutEncryptionKeyConfigured(key)) {
      throw new InternalServerErrorException({
        statusCode: 500,
        code: 'payout_encryption_not_configured',
        message: 'Payout field encryption is not configured on the server',
      });
    }

    const client = this.supabase.getClient();
    const { error: bootError } = await client.rpc('bootstrap_payout_encryption_session', {
      p_key: key!.trim(),
    });
    if (bootError) {
      this.logger.error(`bootstrap_payout_encryption_session: ${bootError.message}`);
      throw new InternalServerErrorException('Failed to initialize payout encryption session');
    }

    const { data, error } = await client.rpc('upsert_creator_payout_account', {
      p_creator_profile_id: scope.creatorProfileId,
      p_type: dto.type,
      p_account_name: dto.accountHolderName.trim(),
      p_upi_id: dto.type === 'upi' ? dto.upiId?.trim() : null,
      p_bank_name: dto.type === 'bank' ? dto.bankName?.trim() ?? null : null,
      p_account_number: dto.type === 'bank' ? dto.bankAccountNumber?.trim() : null,
      p_ifsc_code: dto.type === 'bank' ? dto.bankIfsc?.trim().toUpperCase() : null,
      p_set_default: true,
    });

    if (error) {
      mapWithdrawalRpcError(error, 'upsert_creator_payout_account');
    }

    const row = data as RpcAccountRow;
    return {
      schemaVersion: '3.2.0',
      hasAccount: true,
      account: this.mapAccount(row),
    };
  }

  private validatePutDto(dto: PutPayoutAccountDto): void {
    if (dto.type === 'upi' && !dto.upiId?.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'validation_error',
        message: 'upiId is required for UPI accounts',
      });
    }
    if (dto.type === 'bank') {
      if (!dto.bankAccountNumber?.trim() || !dto.bankIfsc?.trim()) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'validation_error',
          message: 'bankAccountNumber and bankIfsc are required for bank accounts',
        });
      }
    }
  }

  private mapAccount(row: RpcAccountRow): NonNullable<PayoutAccountResponse['account']> {
    const maskedDestination =
      row.type === 'upi'
        ? (row.upiIdMasked ?? null)
        : (row.accountNumberMasked ?? null);

    return {
      id: row.id,
      type: row.type,
      accountHolderName: row.accountName,
      maskedDestination,
      bankName: row.bankName ?? null,
      ifscCode: row.ifscCode ?? null,
      status: row.status,
      isDefault: Boolean(row.isDefault),
      verifiedAt: row.verifiedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? null,
    };
  }
}
