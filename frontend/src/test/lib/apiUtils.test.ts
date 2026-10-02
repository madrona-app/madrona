import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { validate, buildQueryString, ApiError } from '../../lib/api/_utils';

describe('api/_utils', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });


  describe('buildQueryString', () => {
    it('returns empty string for empty params', () => {
      expect(buildQueryString({})).toBe('');
    });

    it('builds simple key=value pairs', () => {
      const result = buildQueryString({ status: 'active', limit: 10 });
      expect(result).toMatch(/^\?/);
      expect(result).toContain('status=active');
      expect(result).toContain('limit=10');
    });

    it('skips undefined and null values', () => {
      const result = buildQueryString({
        a: 1,
        b: null,
        c: undefined,
        d: 'present',
      });
      expect(result).toContain('a=1');
      expect(result).toContain('d=present');
      expect(result).not.toContain('b=');
      expect(result).not.toContain('c=');
    });

    it('serializes arrays as repeated keys', () => {
      const result = buildQueryString({ tag: ['a', 'b', 'c'] });
      // URLSearchParams encodes commas etc.; here we expect tag=a&tag=b&tag=c
      expect(result.match(/tag=/g)?.length).toBe(3);
    });

    it('handles boolean values by stringifying', () => {
      const result = buildQueryString({ active: true, archived: false });
      expect(result).toContain('active=true');
      expect(result).toContain('archived=false');
    });

    it('handles zero number values', () => {
      const result = buildQueryString({ offset: 0 });
      expect(result).toContain('offset=0');
    });

    it('returns leading "?" only when there are params', () => {
      expect(buildQueryString({ a: 1 }).startsWith('?')).toBe(true);
      expect(buildQueryString({})).toBe('');
    });

    it('URL-encodes special characters in values', () => {
      const result = buildQueryString({ q: 'hello world & friends' });
      expect(result).toContain('hello+world');
    });
  });

  describe('validate', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    it('returns parsed data when valid', () => {
      const result = validate(schema, { name: 'Alice', age: 30 });
      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('throws ApiError with status 422 when validation fails', () => {
      try {
        validate(schema, { name: 'Alice', age: 'not-a-number' });
        throw new Error('should not reach here');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(422);
        expect((err as ApiError).code).toBe('validation_error');
      }
    });

    it('includes a summary in the thrown error message', () => {
      try {
        validate(schema, { name: 123, age: 'x' });
      } catch (err) {
        expect((err as ApiError).message).toContain('name');
      }
    });

    it('strips _restricted_fields and makes them optional', () => {
      const restrictedSchema = z.object({
        name: z.string(),
        salary: z.number(),
      });
      // salary is restricted (missing from response), but field-access metadata
      // tells us it was stripped, so validation should not fail
      const result = validate(restrictedSchema, {
        name: 'Alice',
        _restricted_fields: ['salary'],
      });
      expect(result.name).toBe('Alice');
    });

    it('throws non-ZodError errors as-is', () => {
      const customError = new Error('not a zod error');
      const failingSchema = {
        parse: () => {
          throw customError;
        },
      } as unknown as z.ZodSchema<unknown>;

      expect(() => validate(failingSchema, {})).toThrow(customError);
    });

    it('truncates summary when many issues are reported', () => {
      const bigSchema = z.object({
        a: z.string(),
        b: z.string(),
        c: z.string(),
        d: z.string(),
        e: z.string(),
      });
      try {
        validate(bigSchema, {});
      } catch (err) {
        expect((err as ApiError).message).toContain('+');
        expect((err as ApiError).message).toContain('more');
      }
    });

    it('passes details with issues array', () => {
      try {
        validate(schema, { name: 1, age: 'x' });
      } catch (err) {
        const apiErr = err as ApiError;
        expect(apiErr.details).toHaveProperty('errors');
        expect(Array.isArray(apiErr.details?.errors)).toBe(true);
      }
    });
  });
});
