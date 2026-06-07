import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger('AdminAudit');
  private readonly logFilePath = path.join(process.cwd(), 'logs', 'admin_audit.log');

  constructor() {
    this.ensureLogDirectoryExists();
  }

  private ensureLogDirectoryExists() {
    const dir = path.dirname(this.logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  logAction(
    adminId: string,
    adminEmail: string,
    action: string,
    targetId: string,
    details?: string,
  ) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] AdminId: ${adminId} | AdminEmail: ${adminEmail} | Action: ${action} | TargetId: ${targetId} | Details: ${details || 'None'}\n`;
    
    // 1. Log to console
    this.logger.log(`[${action}] By ${adminEmail} on Target: ${targetId}. Details: ${details || 'None'}`);

    // 2. Append to local log file
    try {
      this.ensureLogDirectoryExists();
      fs.appendFileSync(this.logFilePath, logLine, 'utf8');
    } catch (e) {
      this.logger.error(`Failed to write admin audit log: ${(e as Error).message}`);
    }
  }
}
