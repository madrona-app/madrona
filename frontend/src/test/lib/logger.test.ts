import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../lib/logger';

describe('Logger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('logs debug messages when minLevel is debug', () => {
      const logger = new Logger({ minLevel: 'debug' });
      logger.debug('test message');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('does not log debug messages when minLevel is info', () => {
      const logger = new Logger({ minLevel: 'info' });
      logger.debug('test message');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('logs info messages when minLevel is debug or info', () => {
      const logger = new Logger({ minLevel: 'info' });
      logger.info('test message');
      expect(consoleSpy.info).toHaveBeenCalled();
    });

    it('does not log info messages when minLevel is warn', () => {
      const logger = new Logger({ minLevel: 'warn' });
      logger.info('test message');
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });

    it('logs warn messages when minLevel is warn or lower', () => {
      const logger = new Logger({ minLevel: 'warn' });
      logger.warn('test message');
      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('does not log warn messages when minLevel is error', () => {
      const logger = new Logger({ minLevel: 'error' });
      logger.warn('test message');
      expect(consoleSpy.warn).not.toHaveBeenCalled();
    });

    it('always logs error messages', () => {
      const logger = new Logger({ minLevel: 'error' });
      logger.error('test message');
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    it('includes prefix in log message', () => {
      const logger = new Logger({ minLevel: 'debug', prefix: '[Test]' });
      logger.debug('test message');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[Test]'),
      );
    });

    it('includes level in log message', () => {
      const logger = new Logger({ minLevel: 'debug', prefix: '' });
      logger.debug('test message');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]'),
      );
    });

    it('includes message in log output', () => {
      const logger = new Logger({ minLevel: 'debug', prefix: '' });
      logger.debug('my custom message');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('my custom message'),
      );
    });

    it('includes timestamp when enabled', () => {
      const logger = new Logger({ minLevel: 'debug', timestamps: true, prefix: '' });
      logger.debug('test message');
      // ISO timestamp format check (YYYY-MM-DDTHH:mm:ss)
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringMatching(/\d{4}-\d{2}-\d{2}T/),
      );
    });

    it('does not include timestamp when disabled', () => {
      const logger = new Logger({ minLevel: 'debug', timestamps: false, prefix: '' });
      logger.debug('test message');
      // Should not match ISO timestamp format
      expect(consoleSpy.log).not.toHaveBeenCalledWith(
        expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      );
    });
  });

  describe('additional arguments', () => {
    it('passes additional arguments to console.log', () => {
      const logger = new Logger({ minLevel: 'debug' });
      const data = { key: 'value' };
      logger.debug('test message', data);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.any(String),
        data,
      );
    });

    it('passes multiple additional arguments', () => {
      const logger = new Logger({ minLevel: 'debug' });
      logger.debug('test message', 'arg1', 'arg2', { data: true });
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.any(String),
        'arg1',
        'arg2',
        { data: true },
      );
    });
  });

  describe('child logger', () => {
    it('creates child logger with combined prefix', () => {
      const parent = new Logger({ minLevel: 'debug', prefix: '[Parent]' });
      const child = parent.child('[Child]');
      child.debug('test message');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[Parent] [Child]'),
      );
    });

    it('child logger inherits minLevel', () => {
      const parent = new Logger({ minLevel: 'warn', prefix: '[Parent]' });
      const child = parent.child('[Child]');
      child.debug('test message');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });
  });

  describe('enableAll and resetLevel', () => {
    it('enableAll sets minLevel to debug', () => {
      const logger = new Logger({ minLevel: 'error' });
      logger.debug('should not log');
      expect(consoleSpy.log).not.toHaveBeenCalled();

      logger.enableAll();
      logger.debug('should log');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('resetLevel restores to development default (debug)', () => {
      // In development/test, default is 'debug', so after reset debug should log
      const logger = new Logger({ minLevel: 'error' });
      logger.enableAll();
      logger.resetLevel();

      // After reset, in dev environment, debug should log
      logger.debug('should log in dev');
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('log methods', () => {
    it('debug uses console.log', () => {
      const logger = new Logger({ minLevel: 'debug' });
      logger.debug('test');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('info uses console.info', () => {
      const logger = new Logger({ minLevel: 'debug' });
      logger.info('test');
      expect(consoleSpy.info).toHaveBeenCalled();
    });

    it('warn uses console.warn', () => {
      const logger = new Logger({ minLevel: 'debug' });
      logger.warn('test');
      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('error uses console.error', () => {
      const logger = new Logger({ minLevel: 'debug' });
      logger.error('test');
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });
});
