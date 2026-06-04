import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreatorsService } from '../creators/creators.service';

export interface Withdrawal {
  id: string;
  creatorId: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  upiId?: string;
  adminNotes?: string;
  paymentReference?: string;
  requestedAt: string;
  approvedAt?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorTransaction {
  id: string;
  creatorId: string;
  type: 'earning' | 'withdrawal' | 'adjustment';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  createdAt: string;
}

@Injectable()
export class WithdrawalsService {
  private memWithdrawals: Withdrawal[] = [];
  private memTransactions: CreatorTransaction[] = [];

  constructor(
    private readonly supabase: SupabaseService,
    private readonly creatorsService: CreatorsService,
  ) {}

  /**
   * Helper to translate user's user_id to creator_profiles.id
   */
  private async getCreatorProfileId(userId: string, client: any): Promise<string> {
    try {
      const { data: profile } = await client
        .from('creator_profiles')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      return profile ? profile.id : userId;
    } catch (e) {
      console.warn('Failed to translate user_id to profile_id, using fallback:', (e as Error).message);
      return userId;
    }
  }

  /**
   * Fetch minimum withdrawal amount from settings or default to ₹100
   */
  async getMinWithdrawalLimit(): Promise<number> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('app_settings')
          .select('min_withdrawal')
          .limit(1)
          .maybeSingle();
        if (!error && data && data.min_withdrawal !== null) {
          return Number(data.min_withdrawal);
        }
      } catch (e) {
        console.warn('Failed to fetch min_withdrawal from app_settings:', (e as Error).message);
      }
    }
    return 100; // Default: ₹100
  }

  /**
   * GET /api/withdrawals/my
   * Returns current creator's withdrawals
   */
  async getMyWithdrawals(creatorId: string): Promise<Withdrawal[]> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('withdrawals')
          .select('*')
          .eq('creator_id', creatorId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(row => this.mapDbRowToWithdrawal(row));
        }
        console.warn('WithdrawalsService.getMyWithdrawals Supabase error:', error?.message);
      } catch (e) {
        console.warn('WithdrawalsService.getMyWithdrawals exception:', (e as Error).message);
      }
    }

    return this.memWithdrawals
      .filter(w => w.creatorId === creatorId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * GET /api/withdrawals/balance
   * Returns availableBalance, totalEarned, totalWithdrawn
   */
  async getCreatorBalance(creatorId: string) {
    const wallet = await this.creatorsService.getWalletBalance(creatorId);
    return {
      availableBalance: wallet.availableBalance,
      totalEarned: wallet.totalEarned,
      totalWithdrawn: wallet.withdrawnAmount,
    };
  }

  /**
   * POST /api/withdrawals/request
   * Creates a pending withdrawal request
   */
  async createWithdrawalRequest(
    creatorId: string,
    amount: number,
    paymentMethod: string,
    bankDetails?: {
      accountName?: string;
      accountNumber?: string;
      ifsc?: string;
    },
    upiId?: string,
  ): Promise<Withdrawal> {
    const minLimit = await this.getMinWithdrawalLimit();
    if (amount < minLimit) {
      throw new BadRequestException(`Minimum withdrawal amount is ₹${minLimit}`);
    }

    const wallet = await this.creatorsService.getWalletBalance(creatorId);
    if (amount > wallet.availableBalance) {
      throw new BadRequestException(`Withdrawal amount ₹${amount} exceeds available balance ₹${wallet.availableBalance}`);
    }

    if (paymentMethod === 'bank') {
      if (!bankDetails?.accountName || !bankDetails?.accountNumber || !bankDetails?.ifsc) {
        throw new BadRequestException('Bank account name, number, and IFSC code are required for bank payout');
      }
    } else if (paymentMethod === 'upi') {
      if (!upiId) {
        throw new BadRequestException('UPI ID is required for UPI payout');
      }
    } else {
      throw new BadRequestException('Invalid payment method. Use "upi" or "bank"');
    }

    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        const { data, error } = await client
          .from('withdrawals')
          .insert({
            creator_id: creatorId,
            amount: amount,
            status: 'pending',
            bank_account_name: bankDetails?.accountName || null,
            bank_account_number: bankDetails?.accountNumber || null,
            bank_ifsc: bankDetails?.ifsc || null,
            upi_id: upiId || null,
          })
          .select()
          .single();

        if (error) {
          throw new BadRequestException(`Failed to create withdrawal request: ${error.message}`);
        }

        return this.mapDbRowToWithdrawal(data);
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException(`Failed to process withdrawal request: ${(e as Error).message}`);
      }
    }

    // In-memory fallback
    const newRequest: Withdrawal = {
      id: `WDR${Date.now().toString().slice(-6)}`,
      creatorId,
      amount,
      status: 'pending',
      bankAccountName: bankDetails?.accountName,
      bankAccountNumber: bankDetails?.accountNumber,
      bankIfsc: bankDetails?.ifsc,
      upiId,
      requestedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.memWithdrawals.push(newRequest);
    return newRequest;
  }

  /**
   * GET /api/admin/withdrawals
   * Lists payout requests with optional status filtering
   */
  async getAdminWithdrawals(status?: string): Promise<Withdrawal[]> {
    if (this.supabase.isConfigured) {
      try {
        let query = this.supabase.getClient().from('withdrawals').select('*');
        if (status) {
          query = query.eq('status', status);
        }
        const { data, error } = await query.order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(row => this.mapDbRowToWithdrawal(row));
        }
        console.warn('WithdrawalsService.getAdminWithdrawals Supabase error:', error?.message);
      } catch (e) {
        console.warn('WithdrawalsService.getAdminWithdrawals exception:', (e as Error).message);
      }
    }

    let results = this.memWithdrawals;
    if (status) {
      results = results.filter(w => w.status === status);
    }
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * GET /api/admin/withdrawals/:id
   */
  async getWithdrawalById(id: string): Promise<Withdrawal> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('withdrawals')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (!error && data) {
          return this.mapDbRowToWithdrawal(data);
        }
      } catch (e) {
        console.warn('WithdrawalsService.getWithdrawalById exception:', (e as Error).message);
      }
    }

    const request = this.memWithdrawals.find(w => w.id === id);
    if (!request) {
      throw new NotFoundException(`Withdrawal request with ID ${id} not found`);
    }
    return request;
  }

  /**
   * POST /api/admin/withdrawals/:id/approve
   * Changes status pending -> approved
   */
  async approveWithdrawal(id: string): Promise<Withdrawal> {
    const request = await this.getWithdrawalById(id);
    if (request.status !== 'pending') {
      throw new BadRequestException(`Cannot approve request. Status is currently: ${request.status}`);
    }

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('withdrawals')
          .update({
            status: 'approved',
            approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .select()
          .single();

        if (error) {
          throw new BadRequestException(`Failed to approve request: ${error.message}`);
        }
        return this.mapDbRowToWithdrawal(data);
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException(`Failed to process approval: ${(e as Error).message}`);
      }
    }

    // In-memory fallback
    request.status = 'approved';
    request.approvedAt = new Date().toISOString();
    request.updatedAt = new Date().toISOString();
    return request;
  }

  /**
   * POST /api/admin/withdrawals/:id/reject
   * Changes status pending -> rejected
   */
  async rejectWithdrawal(id: string, reason: string): Promise<Withdrawal> {
    const request = await this.getWithdrawalById(id);
    if (request.status !== 'pending') {
      throw new BadRequestException(`Cannot reject request. Status is currently: ${request.status}`);
    }

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('withdrawals')
          .update({
            status: 'rejected',
            admin_notes: reason,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .select()
          .single();

        if (error) {
          throw new BadRequestException(`Failed to reject request: ${error.message}`);
        }
        return this.mapDbRowToWithdrawal(data);
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException(`Failed to process rejection: ${(e as Error).message}`);
      }
    }

    // In-memory fallback
    request.status = 'rejected';
    request.adminNotes = reason;
    request.updatedAt = new Date().toISOString();
    return request;
  }

  /**
   * POST /api/admin/withdrawals/:id/mark-paid
   * Changes status approved -> paid
   * Deducts available balance & logs transaction ledger
   */
  async markWithdrawalPaid(id: string, referenceNumber: string, notes?: string): Promise<Withdrawal> {
    const request = await this.getWithdrawalById(id);
    if (request.status !== 'approved') {
      throw new BadRequestException(`Cannot mark request as paid. Status must be "approved" (current: ${request.status})`);
    }

    const wallet = await this.creatorsService.getWalletBalance(request.creatorId);
    if (request.amount > wallet.availableBalance) {
      throw new BadRequestException(`Deduction failed: Withdrawal amount ₹${request.amount} exceeds creator's available balance ₹${wallet.availableBalance}`);
    }

    const balanceBefore = wallet.availableBalance;
    const balanceAfter = wallet.availableBalance - request.amount;

    if (this.supabase.isConfigured) {
      try {
        const client = this.supabase.getClient();
        const creatorProfileId = await this.getCreatorProfileId(request.creatorId, client);

        // 1. Deduct wallet available_balance and increase withdrawn_amount
        const { data: currentWallet, error: fetchErr } = await client
          .from('creator_wallets')
          .select('id, available_balance, withdrawn_amount')
          .eq('creator_id', creatorProfileId)
          .maybeSingle();

        if (fetchErr || !currentWallet) {
          throw new BadRequestException(`Creator wallet not found for profile ID ${creatorProfileId}`);
        }

        const newAvailable = Number(currentWallet.available_balance) - request.amount;
        const newWithdrawn = Number(currentWallet.withdrawn_amount) + request.amount;

        const { error: walletUpdateErr } = await client
          .from('creator_wallets')
          .update({
            available_balance: newAvailable,
            withdrawn_amount: newWithdrawn,
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentWallet.id);

        if (walletUpdateErr) {
          throw new BadRequestException(`Failed to update creator wallet: ${walletUpdateErr.message}`);
        }

        // 2. Create transaction ledger entry
        const { error: ledgerErr } = await client
          .from('creator_transactions')
          .insert({
            creator_id: request.creatorId, // references public.users(id)
            type: 'withdrawal',
            amount: request.amount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_id: request.id,
          });

        if (ledgerErr) {
          console.warn('Failed to insert creator_transaction ledger record:', ledgerErr.message);
        }

        // 3. Update withdrawal request status
        const { data: updatedWithdrawal, error: updateErr } = await client
          .from('withdrawals')
          .update({
            status: 'paid',
            payment_reference: referenceNumber,
            admin_notes: notes || request.adminNotes || null,
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .select()
          .single();

        if (updateErr) {
          throw new BadRequestException(`Failed to update withdrawal record: ${updateErr.message}`);
        }

        return this.mapDbRowToWithdrawal(updatedWithdrawal);
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException(`Failed to process mark paid: ${(e as Error).message}`);
      }
    }

    // In-memory fallback
    this.creatorsService.updateWalletBalanceInMemory(request.creatorId, -request.amount, request.amount);

    const ledgerTx: CreatorTransaction = {
      id: `TXN${Date.now().toString().slice(-6)}`,
      creatorId: request.creatorId,
      type: 'withdrawal',
      amount: request.amount,
      balanceBefore,
      balanceAfter,
      referenceId: request.id,
      createdAt: new Date().toISOString(),
    };
    this.memTransactions.unshift(ledgerTx);

    request.status = 'paid';
    request.paymentReference = referenceNumber;
    if (notes) request.adminNotes = notes;
    request.paidAt = new Date().toISOString();
    request.updatedAt = new Date().toISOString();

    return request;
  }

  /**
   * Helper to map DB row object keys to CamelCase Withdrawal interface keys
   */
  private mapDbRowToWithdrawal(row: any): Withdrawal {
    return {
      id: row.id,
      creatorId: row.creator_id,
      amount: Number(row.amount),
      status: row.status,
      bankAccountName: row.bank_account_name || undefined,
      bankAccountNumber: row.bank_account_number || undefined,
      bankIfsc: row.bank_ifsc || undefined,
      upiId: row.upi_id || undefined,
      adminNotes: row.admin_notes || undefined,
      paymentReference: row.payment_reference || undefined,
      requestedAt: row.requested_at,
      approvedAt: row.approved_at || undefined,
      paidAt: row.paid_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getMemWithdrawals(): Withdrawal[] {
    return this.memWithdrawals;
  }
}
