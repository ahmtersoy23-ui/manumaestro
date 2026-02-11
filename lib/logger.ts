/**
 * Logging Utility
 * Environment-aware logging system
 * - Development: Full logging
 * - Production: Error logging only
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  module?: string;
  timestamp?: boolean;
}

class Logger {
  private isDevelopment: boolean;
  private module: string;
  private timestamp: boolean;

  constructor(options: LoggerOptions = {}) {
    this.isDevelopment = process.env.NODE_ENV !== 'production';
    this.module = options.module || 'App';
    this.timestamp = options.timestamp ?? true;
  }

  private formatMessage(level: LogLevel, ...args: any[]): any[] {
    const prefix = this.timestamp
      ? `[${new Date().toISOString()}] [${level.toUpperCase()}] [${this.module}]`
      : `[${level.toUpperCase()}] [${this.module}]`;

    return [prefix, ...args];
  }

  /**
   * Debug logging - Only in development
   */
  debug(...args: any[]) {
    if (this.isDevelopment) {
      console.log(...this.formatMessage('debug', ...args));
    }
  }

  /**
   * Info logging - Only in development
   */
  info(...args: any[]) {
    if (this.isDevelopment) {
      console.info(...this.formatMessage('info', ...args));
    }
  }

  /**
   * Warning logging - Always logged
   */
  warn(...args: any[]) {
    console.warn(...this.formatMessage('warn', ...args));
  }

  /**
   * Error logging - Always logged
   */
  error(...args: any[]) {
    console.error(...this.formatMessage('error', ...args));
  }
}

/**
 * Create a logger instance for a module
 */
export function createLogger(module: string, options?: Omit<LoggerOptions, 'module'>) {
  return new Logger({ ...options, module });
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Export for backward compatibility
 */
export default logger;
