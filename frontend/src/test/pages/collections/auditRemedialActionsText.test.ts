import { describe, it, expect } from 'vitest';
import { remedialActionsText } from '../../../pages/collections/AuditCampaignWorkspacePage/hooks';

describe('remedialActionsText', () => {
  it('turns the action records the API returns into one line each', () => {
    expect(remedialActionsText([{ title: 'Update locations' }, { title: 'Report missing' }])).toBe(
      'Update locations\nReport missing',
    );
  });
  it('keeps text, drops blanks, and treats anything else as empty', () => {
    expect(remedialActionsText('A\nB')).toBe('A\nB');
    expect(remedialActionsText([{ title: '' }, 'C', null])).toBe('C');
    expect(remedialActionsText(null)).toBe('');
    expect(remedialActionsText({})).toBe('');
  });
});
