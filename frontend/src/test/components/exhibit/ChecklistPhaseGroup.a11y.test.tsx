/**
 * Axe coverage for the exhibition checklist phase group, rendered with the
 * real item rows, checkbox and status menu (no component mocks).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhaseGroup } from '../../../components/exhibit/ExhibitionChecklistTab/ChecklistSection';
import type { ChecklistItem } from '../../../components/exhibit/ExhibitionChecklistTab/types';
import { checkA11y, formatViolations } from '../../a11y';

function makeItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    item_id: 'i-1',
    phase: 'planning',
    title: 'Item',
    description: null,
    responsible_role: 'curator',
    assigned_user_id: null,
    due_date: null,
    status: 'todo',
    notes: null,
    sort_order: 0,
    links_count: 0,
    created_at: '',
    updated_at: '',
    completed_at: null,
    completed_by: null,
    ...overrides,
  };
}

function renderGroup(isExpanded = true, onToggle = vi.fn()) {
  return render(
    <PhaseGroup
      phase="planning"
      items={[
        makeItem({ item_id: 'a', title: 'Confirm loans', links_count: 2, notes: 'x' }),
        makeItem({ item_id: 'b', title: 'Book shippers', status: 'in_progress', due_date: '2026-01-01' }),
      ]}
      isExpanded={isExpanded}
      onToggle={onToggle}
      onStatusChange={vi.fn()}
      onItemClick={vi.fn()}
      selectedItems={new Set(['a'])}
      onToggleSelect={vi.fn()}
      canEdit
    />,
  );
}

describe('Checklist PhaseGroup accessibility', () => {
  it('has no axe violations when expanded', async () => {
    const { container } = renderGroup();
    const results = await checkA11y(container);
    expect(results.violations, formatViolations(results)).toEqual([]);
  });

  it('exposes the phase header as a disclosure button controlling the table', () => {
    const onToggle = vi.fn();
    renderGroup(true, onToggle);
    const toggle = screen.getByRole('button', { name: /Planning/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(
      screen.getByRole('table', { name: 'Planning checklist items' }),
    );
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalled();
  });

  it('names row controls after their item', () => {
    renderGroup();
    expect(screen.getByRole('checkbox', { name: 'Select Confirm loans' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Book shippers: status In Progress' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
    expect(screen.getByRole('columnheader', { name: 'Indicators' })).toBeInTheDocument();
  });
});
