/**
 * Keeps backend/app/services/procedure_form_fields.json equal to the
 * procedure forms.
 *
 * The backend only lets organizations require fields listed there, because a
 * required field nobody can fill in on the form would block the record. Each
 * listed field must be registered by a control with that `name` on its form
 * (EditableField / EditableSelect / ObjectSelector / EditableUserSelect
 * `name="..."`, or a picker's `useRequiredField('...')`), and every control
 * registered on a form must be listed, so the two cannot drift apart.
 *
 * After adding or removing a control on one of these forms, regenerate the
 * list by updating the JSON file to the "found on form" set this test prints.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FRONTEND = process.cwd();
const BACKEND_LIST = resolve(FRONTEND, '../backend/app/services/procedure_form_fields.json');

// The files that make up each procedure's staff form.
const FORMS: Record<string, { dir: string; shared?: string[] }> = {
  object_entry: {
    dir: 'ObjectEntryWorkspacePage',
    shared: ['components/collections/TermsAcceptancePanel.tsx', 'components/collections/AuthorizationSection.tsx'],
  },
  acquisition: { dir: 'AcquisitionWorkspacePage' },
  loan_in: { dir: 'LoanInWorkspacePage' },
  loan_out: { dir: 'LoanOutWorkspacePage', shared: ['components/collections/AuthorizationSection.tsx'] },
  conservation: { dir: 'ConservationWorkspacePage' },
  object_exit: { dir: 'ObjectExitWorkspacePage' },
  deaccession: { dir: 'DeaccessionWorkspacePage' },
};

function namesOnForm(procedure: string): string[] {
  const { dir, shared = [] } = FORMS[procedure];
  const pageDir = join(FRONTEND, 'src/pages/collections', dir);
  const files = readdirSync(pageDir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(pageDir, f))
    .concat(shared.map((f) => join(FRONTEND, 'src', f)));
  const names = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bname="([a-z_0-9]+)"/g)) names.add(m[1]);
    for (const m of src.matchAll(/useRequiredField\(\s*'([a-z_0-9]+)'/g)) names.add(m[1]);
  }
  return [...names].sort();
}

const listed = JSON.parse(readFileSync(BACKEND_LIST, 'utf8')) as Record<string, string[]>;

describe('procedure form fields list', () => {
  it('covers exactly the procedures organizations can add fields to', () => {
    expect(Object.keys(listed).sort()).toEqual(Object.keys(FORMS).sort());
  });

  it.each(Object.keys(FORMS))('matches the controls on the %s form', (procedure) => {
    const found = namesOnForm(procedure);
    // Printed on failure so the JSON can be updated from it.
    expect({ procedure, found }).toEqual({ procedure, found: [...listed[procedure]].sort() });
  });
});
