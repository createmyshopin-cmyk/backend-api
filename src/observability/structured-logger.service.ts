import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { getPlatformConfig, isPlatformConfigReady } from '../startup/platform-config';
import { activeSpanAttributes } from './tracing.context';

export interface StructuredLogFields {
  event?: string;
  domain?: string;
  [key: string]: unknown;
}

@Injectable()
export class StructuredLoggerService implements LoggerService {
  private contextName = 'voice-calling-api';

  setContext(context: string): void {
    this.contextName = context;
  }

  log(message: string, fields?: StructuredLogFields): void {
    this.write('info', message, fields);
  }

  error(message: string, trace?: string, fields?: StructuredLogFields): void {
    this.write('error', message, { ...fields, ...(trace ? { stack: trace } : {}) });
  }

  warn(message: string, fields?: StructuredLogFields): void {
    this.write('warn', message, fields);
  }

  debug(message: string, fields?: StructuredLogFields): void {
    if (process.env.LOG_LEVEL === 'debug') {
      this.write('debug', message, fields);
    }
  }

  verbose(message: string, fields?: StructuredLogFields): void {
    this.debug(message, fields);
  }

  fatal(message: string, fields?: StructuredLogFields): void {
    this.write('fatal', message, fields);
  }

  domainEvent(event: string, fields: StructuredLogFields, level: LogLevel = 'log'): void {
    const mapped = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
    this.write(mapped, event, { event, ...fields });
  }

  private write(level: string, message: string, fields?: StructuredLogFields): void {
    const platformTier = isPlatformConfigReady()
      ? getPlatformConfig().tier
      : process.env.PLATFORM_TIER ?? 'unknown';

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service: 'voice-calling-api',
      env: process.env.NODE_ENV ?? 'development',
      platform_tier: platformTier,
      message,
      context: this.contextName,
      ...activeSpanAttributes(),
      ...fields,
    };

    const line = JSON.stringify(payload);
    if (level === 'error' || level === 'fatal') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}
