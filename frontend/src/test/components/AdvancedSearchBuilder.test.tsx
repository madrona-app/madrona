import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import AdvancedSearchBuilder from '../../components/AdvancedSearchBuilder';

describe('AdvancedSearchBuilder a11y fix verification', () => {
  it('select elements now have accessible names', async () => {
    const { container } = render(
      <AdvancedSearchBuilder
        criteria={[{ field: 'title', operator: 'contains', value: 'test' }]}
        operator="and"
        onChange={() => {}}
      />
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
