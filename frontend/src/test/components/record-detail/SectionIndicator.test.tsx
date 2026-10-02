import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SectionIndicator,
  computeSectionIndicator,
  computeGroupWarningCount,
  getPath,
  type SectionStatus,
} from '../../../components/record-detail/SectionIndicator';

describe('SectionIndicator (component)', () => {
  it('renders a "complete" indicator with the success aria label', () => {
    render(<SectionIndicator status="complete" />);
    expect(screen.getByRole('img', { name: 'Section complete' })).toBeInTheDocument();
  });

  it('renders a "partial" indicator', () => {
    render(<SectionIndicator status="partial" />);
    expect(
      screen.getByRole('img', { name: 'Section partially complete' }),
    ).toBeInTheDocument();
  });

  it('renders an "empty" indicator', () => {
    render(<SectionIndicator status="empty" />);
    expect(screen.getByRole('img', { name: 'Section empty' })).toBeInTheDocument();
  });

  it('renders a "required-missing" indicator', () => {
    render(<SectionIndicator status="required-missing" />);
    expect(
      screen.getByRole('img', { name: 'Required section needs attention' }),
    ).toBeInTheDocument();
  });

  it('forwards a custom className', () => {
    render(<SectionIndicator status="complete" className="my-extra-class" />);
    const el = screen.getByRole('img');
    expect(el.className).toContain('my-extra-class');
  });
});

describe('getPath', () => {
  it('reads top-level keys', () => {
    expect(getPath({ a: 1 }, 'a')).toBe(1);
  });

  it('reads nested dotted keys', () => {
    expect(getPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing keys', () => {
    expect(getPath({ a: 1 }, 'b')).toBeUndefined();
    expect(getPath({}, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined when traversing through a non-object', () => {
    expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('returns undefined when input is null or non-object', () => {
    expect(getPath(null, 'a')).toBeUndefined();
    expect(getPath('hello' as unknown as object, 'a')).toBeUndefined();
  });
});

describe('computeSectionIndicator', () => {
  it('returns "empty" when data is null and not required', () => {
    expect(computeSectionIndicator(null)).toBe('empty');
  });

  it('returns "required-missing" when data is null and required', () => {
    expect(computeSectionIndicator(null, { isRequired: true })).toBe('required-missing');
  });

  it('returns "empty" when an object has only blank fields and is not required', () => {
    expect(computeSectionIndicator({ a: '', b: null })).toBe('empty');
  });

  it('returns "partial" for non-empty arrays without required fields', () => {
    expect(computeSectionIndicator(['x'])).toBe('partial');
  });

  it('returns "complete" when all required fields are filled', () => {
    expect(
      computeSectionIndicator(
        { a: 'x', b: 'y' },
        { requiredFields: ['a', 'b'] },
      ),
    ).toBe('complete');
  });

  it('returns "partial" when only some required fields are filled', () => {
    expect(
      computeSectionIndicator(
        { a: 'x', b: '' },
        { requiredFields: ['a', 'b'] },
      ),
    ).toBe('partial');
  });

  it('returns "complete" for non-empty data with no required fields', () => {
    expect(computeSectionIndicator({ a: 'x' })).toBe('complete');
  });

  it('returns "required-missing" when no required fields are filled and required', () => {
    expect(
      computeSectionIndicator(
        { a: '', b: '' },
        { isRequired: true, requiredFields: ['a', 'b'] },
      ),
    ).toBe('required-missing');
  });
});

describe('computeGroupWarningCount', () => {
  it('returns zero when no sections are required-missing', () => {
    const map = new Map<string, SectionStatus>([
      ['a', 'complete'],
      ['b', 'partial'],
      ['c', 'empty'],
    ]);
    expect(computeGroupWarningCount(map)).toBe(0);
  });

  it('counts only required-missing sections', () => {
    const map = new Map<string, SectionStatus>([
      ['a', 'required-missing'],
      ['b', 'required-missing'],
      ['c', 'partial'],
    ]);
    expect(computeGroupWarningCount(map)).toBe(2);
  });
});
