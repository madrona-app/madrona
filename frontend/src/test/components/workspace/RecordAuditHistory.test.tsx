import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordAuditHistory } from '../../../components/workspace/RecordAuditHistory';
import * as api from '../../../lib/api';
import type { RecordAuditEvent } from '../../../lib/api';
import { childRowSentences } from '../../../components/audit';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, getRecordAuditHistory: vi.fn() };
});

const mocked = vi.mocked(api);

const actor = {
  changed_by: 'u1',
  changed_by_name: 'Ada Registrar',
  changed_by_email: 'ada@example.org',
  request_method: 'PUT',
};

const MEASUREMENT_UPDATED: RecordAuditEvent = {
  event_id: 'e3',
  change_type: 'link_updated',
  changed_at: '2026-11-13T15:30:00+00:00',
  changed_fields: ['measurement'],
  summary: 'Updated measurement: height',
  child_entity_type: 'object_measurement',
  child_entity_id: 'm1',
  child_display_key: 'height',
  field_diffs: [{ field_name: 'measurement', old_value: '10 cm', new_value: '12 cm' }],
  ...actor,
};

const TITLE_ADDED: RecordAuditEvent = {
  event_id: 'e2',
  change_type: 'link_added',
  changed_at: '2026-11-12T10:00:00+00:00',
  changed_fields: ['title', 'title_type'],
  summary: 'Added title: Slate and stylus',
  child_entity_type: 'object_title',
  child_entity_id: 't1',
  child_display_key: 'Slate and stylus',
  field_diffs: [
    { field_name: 'title', old_value: null, new_value: 'Slate and stylus' },
    { field_name: 'title_type', old_value: null, new_value: 'primary' },
  ],
  ...actor,
};

const FLAG_REMOVED: RecordAuditEvent = {
  event_id: 'e1',
  change_type: 'link_removed',
  changed_at: '2026-11-11T09:00:00+00:00',
  changed_fields: ['flag', 'note'],
  summary: 'Removed flag: Needs review',
  child_entity_type: 'object_flag',
  child_entity_id: 'f1',
  child_display_key: 'Needs review',
  field_diffs: [
    { field_name: 'flag', old_value: 'Needs review', new_value: null },
    { field_name: 'note', old_value: 'Check the date', new_value: null },
  ],
  ...actor,
};

const FIELD_UPDATED: RecordAuditEvent = {
  event_id: 'e0',
  change_type: 'updated',
  changed_at: '2026-11-10T09:00:00+00:00',
  changed_fields: ['object_name'],
  summary: 'Updated object_name',
  field_diffs: [{ field_name: 'object_name', old_value: 'Slate', new_value: 'Braille slate' }],
  ...actor,
};

const CLASSIFICATION_ADDED: RecordAuditEvent = {
  event_id: 'c2',
  change_type: 'link_added',
  changed_at: '2026-11-14T10:00:00+00:00',
  changed_fields: ['classification'],
  summary: 'Added classification: Textiles',
  child_entity_type: 'object_classification',
  child_entity_id: 'l1',
  child_display_key: 'Textiles',
  field_diffs: [{ field_name: 'classification', old_value: null, new_value: 'Textiles' }],
  ...actor,
};

const CLASSIFICATION_REMOVED: RecordAuditEvent = {
  event_id: 'c1',
  change_type: 'link_removed',
  changed_at: '2026-11-14T09:00:00+00:00',
  changed_fields: ['classification'],
  summary: 'Removed classification: Tactile graphics',
  child_entity_type: 'object_classification',
  child_entity_id: 'l2',
  child_display_key: 'Tactile graphics',
  field_diffs: [{ field_name: 'classification', old_value: 'Tactile graphics', new_value: null }],
  ...actor,
};

function renderHistory(items: RecordAuditEvent[], headingLevel?: 2 | 3) {
  mocked.getRecordAuditHistory.mockResolvedValue({
    entity_type: 'collection_object',
    entity_id: 'o1',
    items,
    total: items.length,
    limit: 20,
    offset: 0,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <main>
        <RecordAuditHistory organizationId="org-1" entityType="collection_object" entityId="o1" headingLevel={headingLevel} />
      </main>
    </QueryClientProvider>,
  );
}

describe('childRowSentences', () => {
  it('describes a measurement change with its unit', () => {
    expect(childRowSentences(MEASUREMENT_UPDATED)).toEqual([
      'Measurement height changed from 10 cm to 12 cm.',
    ]);
  });

  it('lists the other fields of an added row without repeating its name', () => {
    expect(childRowSentences(TITLE_ADDED)).toEqual(['Title Type: primary.']);
  });

  it('describes removed values', () => {
    expect(childRowSentences(FLAG_REMOVED)).toEqual(['Note was Check the date.']);
  });

  it('says "empty" rather than leaving a blank', () => {
    expect(childRowSentences({
      change_type: 'link_updated',
      child_entity_type: 'object_inscription',
      child_display_key: 'APH',
      field_diffs: [{ field_name: 'location_on_object', old_value: null, new_value: 'back' }],
    })).toEqual(['Inscription APH: Location On Object changed from empty to back.']);
  });

  it('is empty for events that are not about a child row', () => {
    expect(childRowSentences(FIELD_UPDATED)).toEqual([]);
  });
});

describe('RecordAuditHistory', () => {
  beforeEach(() => {
    mocked.getRecordAuditHistory.mockReset();
  });

  it('renders a child-row change as readable text in an ordered list', async () => {
    renderHistory([MEASUREMENT_UPDATED, TITLE_ADDED, FLAG_REMOVED, FIELD_UPDATED]);

    const list = await screen.findByRole('list', { name: 'Change History, newest first' });
    const entries = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
    expect(entries).toHaveLength(4);

    const first = entries[0];
    expect(within(first).getByText('Changed measurement height')).toBeInTheDocument();
    expect(within(first).getByText('Measurement height changed from 10 cm to 12 cm.')).toBeInTheDocument();
    expect(within(first).getByText('Ada Registrar')).toBeInTheDocument();
    // Timestamp is text inside a <time> element, not only an icon or colour.
    const time = first.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.getAttribute('dateTime')).toBe('2026-11-13T15:30:00+00:00');
    expect(time?.textContent?.trim().length).toBeGreaterThan(0);
    // The badge says what happened in words.
    expect(within(first).getByText('Changed')).toBeInTheDocument();

    expect(within(entries[1]).getByText('Added title “Slate and stylus”')).toBeInTheDocument();
    expect(within(entries[2]).getByText('Removed flag “Needs review”')).toBeInTheDocument();
    expect(within(entries[2]).getByText('Note was Check the date.')).toBeInTheDocument();
  });

  it('keeps the expandable field view for record-level changes, with a named button', async () => {
    renderHistory([FIELD_UPDATED]);
    const button = await screen.findByRole('button', { name: /^Show changed fields: Updated 1 field, / });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();
    expect(screen.getByText('Braille slate')).toBeInTheDocument();
    expect(screen.getByText('changed to')).toHaveClass('sr-only');
  });

  it('describes classification changes by term, without repeating them', async () => {
    const { container } = renderHistory([CLASSIFICATION_ADDED, CLASSIFICATION_REMOVED]);
    const list = await screen.findByRole('list', { name: 'Change History, newest first' });
    const entries = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
    expect(within(entries[0]).getByText('Added classification “Textiles”')).toBeInTheDocument();
    expect(within(entries[0]).getByText('Added')).toBeInTheDocument();
    expect(within(entries[1]).getByText('Removed classification “Tactile graphics”')).toBeInTheDocument();
    expect(within(entries[1]).getByText('Removed')).toBeInTheDocument();
    // The term is the whole change: no sentence list repeating it.
    expect(within(entries[0]).queryByRole('list')).toBeNull();
    expect(childRowSentences(CLASSIFICATION_ADDED)).toEqual([]);
    expect(screen.queryByText(/l1|l2/)).toBeNull();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('describes an exhibition\u2019s objects as child rows', async () => {
    const { container } = renderHistory([
      {
        event_id: 'x2', change_type: 'link_updated', changed_at: '2026-11-14T12:00:00+00:00',
        changed_fields: ['object_status'], summary: 'Updated object: EX.1',
        child_entity_type: 'exhibition_object', child_entity_id: 'eo1', child_display_key: 'EX.1',
        field_diffs: [{ field_name: 'object_status', old_value: 'planned', new_value: 'on_display' }],
        ...actor,
      },
      {
        event_id: 'x1', change_type: 'link_added', changed_at: '2026-11-14T11:00:00+00:00',
        changed_fields: ['object', 'section'], summary: 'Added object: EX.1',
        child_entity_type: 'exhibition_object', child_entity_id: 'eo1', child_display_key: 'EX.1',
        field_diffs: [
          { field_name: 'object', old_value: null, new_value: 'EX.1' },
          { field_name: 'section', old_value: null, new_value: 'Gallery 1' },
        ],
        ...actor,
      },
    ]);
    expect(await screen.findByText('Changed object EX.1')).toBeInTheDocument();
    expect(screen.getByText('Object EX.1: Object Status changed from planned to on display.')).toBeInTheDocument();
    expect(screen.getByText('Added object EX.1')).toBeInTheDocument();
    expect(screen.getByText('Section: Gallery 1.')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('uses the requested heading level', async () => {
    renderHistory([MEASUREMENT_UPDATED], 2);
    expect(await screen.findByRole('heading', { level: 2, name: 'Change History' })).toBeInTheDocument();
  });

  it('has no axe violations with child-row changes', async () => {
    const { container } = renderHistory([MEASUREMENT_UPDATED, TITLE_ADDED, FLAG_REMOVED, FIELD_UPDATED]);
    await screen.findByText('Measurement height changed from 10 cm to 12 cm.');
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('has no axe violations with a record-level diff expanded', async () => {
    const { container } = renderHistory([FIELD_UPDATED]);
    fireEvent.click(await screen.findByRole('button', { name: /Show changed fields/ }));
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });
});
