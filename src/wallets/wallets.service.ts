import { Injectable, BadRequestException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CoinTransactionsService } from '../calls/coin-transactions.service';
import { AdjustCoinsDto } from './dto/wallet.dto';

export interface WalletTransaction {
  id: string;
  userId: string;
  userName: string;
  type: string;
  amount: number;
  balanceAfter: number;
  date: string;
}

@Injectable()
export class WalletsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly coinTransactions: CoinTransactionsService,
  ) {}

  private transactions: WalletTransaction[] = [
    { id: 'TXN001', userId: 'USR001', userName: 'Aarav Sharma', type: 'recharge', amount: 500, balanceAfter: 500, date: '2026-06-03T18:00:00Z' },
    { id: 'TXN002', userId: 'USR001', userName: 'Aarav Sharma', type: 'call_deduction', amount: -50, balanceAfter: 450, date: '2026-06-03T18:15:00Z' }
  ];

  async getBalance(userId: string) {
    const user = await this.usersService.findOne(userId);
    return {
      userId: user.id,
      name: user.name,
      coins: user.coins
    };
  }

  async getTransactions(userId?: string) {
    if (userId) {
      return this.transactions.filter(t => t.userId === userId);
    }
    return this.transactions;
  }

  async adjustCoins(dto: AdjustCoinsDto) {
    const user = await this.usersService.findOne(dto.userId);

    if (dto.amount < 0 && user.coins < Math.abs(dto.amount)) {
      throw new BadRequestException('Insufficient coins balance');
    }

    const balanceBefore = user.coins;
    const updatedUser = await this.usersService.updateCoins(dto.userId, dto.amount);

    await this.coinTransactions.recordAdminAdjustment({
      userId: user.id,
      delta: dto.amount,
      balanceBefore,
      balanceAfter: updatedUser.coins,
      reason: dto.reason,
    });

    const txn: WalletTransaction = {
      id: `TXN${Date.now().toString().slice(-4)}`,
      userId: user.id,
      userName: user.name,
      type: dto.amount >= 0 ? 'admin_adjustment_add' : 'admin_adjustment_deduct',
      amount: dto.amount,
      balanceAfter: updatedUser.coins,
      date: new Date().toISOString()
    };
    
    this.transactions.unshift(txn);
    return {
      message: 'Coins adjusted successfully',
      transaction: txn
    };
  }
}
