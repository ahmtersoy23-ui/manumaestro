/**
 * Logger Utility Tests
 * Tests for environment-aware logging system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, logger } from '@/lib/logger';

describe('Logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger with the specified module name', () => {
      const testLogger = createLogger('TestModule');
      testLogger.warn('test message');

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const args = consoleWarnSpy.mock.calls[0];
      expect(args[0]).toContain('[TestModule]');
    });

    it('should create a logger with timestamp by default', () => {
      const testLogger = createLogger('TestModule');
      testLogger.warn('test');

      const args = consoleWarnSpy.mock.calls[0];
      // Timestamp format: [YYYY-MM-DDTHH:MM:SS.sssZ]
      expect(args[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });

    it('should create a logger without timestamp when disabled', () => {
      const testLogger = createLogger('TestModule', { timestamp: false });
      testLogger.warn('test');

      const args = consoleWarnSpy.mock.calls[0];
      expect(args[0]).not.toMatch(/\[\d{4}-\d{2}-\d{2}T/);
      expect(args[0]).toContain('[WARN]');
      expect(args[0]).toContain('[TestModule]');
    });
  });

  describe('warn', () => {
    it('should always log warnings regardless of environment', () => {
      const testLogger = createLogger('WarnTest');
      testLogger.warn('warning message');

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const args = consoleWarnSpy.mock.calls[0];
      expect(args[0]).toContain('[WARN]');
      expect(args[1]).toBe('warning message');
    });
  });

  describe('error', () => {
    it('should always log errors regardless of environment', () => {
      const testLogger = createLogger('ErrorTest');
      testLogger.error('error message', { code: 500 });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const args = consoleErrorSpy.mock.calls[0];
      expect(args[0]).toContain('[ERROR]');
      expect(args[1]).toBe('error message');
      expect(args[2]).toEqual({ code: 500 });
    });
  });

  describe('debug (development only)', () => {
    it('should log in development mode (default in test)', () => {
      const testLogger = createLogger('DebugTest');
      testLogger.debug('debug message');

      // In test env, NODE_ENV is 'test' which is !== 'production', so isDevelopment is true
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const args = consoleLogSpy.mock.calls[0];
      expect(args[0]).toContain('[DEBUG]');
    });
  });

  describe('info (development only)', () => {
    it('should log in development mode (default in test)', () => {
      const testLogger = createLogger('InfoTest');
      testLogger.info('info message');

      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
      const args = consoleInfoSpy.mock.calls[0];
      expect(args[0]).toContain('[INFO]');
    });
  });

  describe('default logger instance', () => {
    it('should exist and have default module name "App"', () => {
      logger.warn('default logger test');

      const args = consoleWarnSpy.mock.calls[0];
      expect(args[0]).toContain('[App]');
    });
  });
});
