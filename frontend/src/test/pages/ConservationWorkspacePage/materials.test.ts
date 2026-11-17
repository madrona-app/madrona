import { describe, it, expect } from 'vitest';
import { materialsToText, textToMaterials } from '../../../pages/collections/ConservationWorkspacePage/hooks';
import { ConservationTreatmentSchema } from '../../../lib/schemas/procedures';

describe('conservation materials mapping', () => {
  it('shows stored materials as one name per line', () => {
    expect(materialsToText([
      { material_name: 'Paraloid B-72', manufacturer: 'Kremer', quantity: null, purpose: null },
      { material_name: 'Klucel G' },
    ])).toBe('Paraloid B-72\nKlucel G');
    expect(materialsToText(null)).toBe('');
    expect(materialsToText([])).toBe('');
  });

  it('sends the lines as a list of names, skipping blanks', () => {
    expect(textToMaterials('Paraloid B-72\n\n  Klucel G  \n')).toEqual(['Paraloid B-72', 'Klucel G']);
    expect(textToMaterials('')).toEqual([]);
  });

  it('keeps the material names the API returns when the response is parsed', () => {
    const parsed = ConservationTreatmentSchema.partial().parse({
      materials_used: [{ material_name: 'Paraloid B-72', manufacturer: 'Kremer', quantity: null, purpose: null }],
    });
    expect(parsed.materials_used?.[0].material_name).toBe('Paraloid B-72');
  });
});
