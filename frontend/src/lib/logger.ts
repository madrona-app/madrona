/**
 * Centralized logging utility for Madrona frontend.
 *
 * Provides structured logging with environment-aware verbosity control.
 * In production, only warnings and errors are logged.
 * Errors and warnings are automatically reported to Sentry.
 *
 * Usage:
 * ```typescript
 * import { logger } from '@/lib/logger';
 *
 * logger.debug('Debug message', { data });      // Only in development
 * logger.info('Info message', { data });        // Only in development
 * logger.warn('Warning message', { data });     // Always, reported to Sentry
 * logger.error('Error message', { error });     // Always, reported to Sentry
 * ```
 */

import * as Sentry from '@sentry/react';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  /** Minimum log level to output. Default: 'warn' in production, 'debug' in development */
  minLevel: LogLevel;
  /** Whether to include timestamps */
  timestamps: boolean;
  /** Prefix for all log messages */
  prefix: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isDevelopment = import.meta.env?.DEV ?? false;

const defaultConfig: LoggerConfig = {
  minLevel: isDevelopment ? 'debug' : 'warn',
  timestamps: false,
  prefix: '[Madrona]',
};

class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const parts: string[] = [];

    if (this.config.prefix) {
      parts.push(this.config.prefix);
    }

    if (this.config.timestamps) {
      parts.push(new Date().toISOString());
    }

    parts.push(`[${level.toUpperCase()}]`);
    parts.push(message);

    return parts.join(' ');
  }

  /**
   * Log debug message. Only shown in development.
   */
  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  /**
   * Log info message. Only shown in development.
   */
  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message), ...args);
    }
  }

  /**
   * Log warning message. Always shown. Reported to Sentry as a warning.
   */
  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
      Sentry.captureMessage(message, {
        level: 'warning',
        extra: { args },
      });
    }
  }

  /**
   * Log error message. Always shown. Reported to Sentry as an exception.
   */
  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
      Sentry.captureException(
        args[0] instanceof Error ? args[0] : new Error(message),
        { extra: { args } }
      );
    }
  }

  /**
   * Create a child logger with a custom prefix.
   */
  child(prefix: string): Logger {
    return new Logger({
      ...this.config,
      prefix: `${this.config.prefix} ${prefix}`,
    });
  }

  /**
   * Temporarily enable all logging (useful for debugging).
   */
  enableAll(): void {
    this.config.minLevel = 'debug';
  }

  /**
   * Restore default logging level.
   */
  resetLevel(): void {
    this.config.minLevel = defaultConfig.minLevel;
  }
}

// Default logger instance
export const logger = new Logger();

// Export Logger class for custom instances
export { Logger };
export type { LogLevel, LoggerConfig };
