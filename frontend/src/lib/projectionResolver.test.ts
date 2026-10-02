import { describe, it, expect } from 'vitest';
import {
  resolvePath,
  resolveValue,
  resolveDisplayFields,
  resolveEntityDisplayFields,
  getPathsForRoleWithPrecedence,
  getDefaultProjectionConfig,
  DEFAULT_FALLBACKS,
  type DisplayFields as _DisplayFields,
} from './projectionResolver';
import type { ProjectionConfig, ScopeProfile } from './api';

// =============================================================================
// Test Fixtures
// =============================================================================

const locStyleRecord = {
  id: 'mdrn:loc:2018645678',
  type: 'Work',
  label: 'Civil War Map of Virginia',
  description: 'A detailed map of Virginia during the Civil War period.',
  properties: {
    title: 'Map Title from Properties',
    creator: 'John Smith',
    date: '1862',
  },
  media: [
    { role: 'master', url: 'https://example.com/master.jpg', mimeType: 'image/jpeg' },
    { role: 'thumbnail', url: 'https://example.com/thumb.jpg', mimeType: 'image/jpeg' },
  ],
  identifiers: [
    { scheme: 'loc', value: '2018645678' },
    { scheme: 'doi', value: '10.1234/example' },
  ],
};

// Future use: smithsonian-style record for integration tests
// const smithsonianStyleRecord = {
//   id: 'mdrn:si:object-12345',
//   type: 'Object',
//   label: 'Bronze Sculpture',
//   properties: {
//     title: 'Winged Victory',
//     creator: 'Unknown Artist',
//     material: 'Bronze',
//   },
//   media: [
//     { role: 'thumbnail', url: 'https://si.edu/thumb.jpg' },
//     { role: 'fullsize', url: 'https://si.edu/full.jpg' },
//   ],
// };

const minimalRecord = {
  id: 'minimal-123',
  type: 'Document',
};

const legacyRecord = {
  // Missing label, type, has non-standard fields
  id: 'legacy-001',
  title: 'Legacy Title', // Not in standard location
  unknownField: 'should be ignored',
};

// =============================================================================
// Path Resolution Tests
// =============================================================================

describe('resolvePath', () => {
  describe('simple paths', () => {
    it('resolves top-level string fields', () => {
      expect(resolvePath(locStyleRecord, 'label')).toBe('Civil War Map of Virginia');
      expect(resolvePath(locStyleRecord, 'type')).toBe('Work');
      expect(resolvePath(locStyleRecord, 'id')).toBe('mdrn:loc:2018645678');
    });

    it('returns undefined for missing fields', () => {
      expect(resolvePath(locStyleRecord, 'nonexistent')).toBeUndefined();
    });
  });

  describe('nested paths', () => {
    it('resolves dot-notation nested fields', () => {
      expect(resolvePath(locStyleRecord, 'properties.title')).toBe('Map Title from Properties');
      expect(resolvePath(locStyleRecord, 'properties.creator')).toBe('John Smith');
    });

    it('returns undefined for missing nested fields', () => {
      expect(resolvePath(locStyleRecord, 'properties.nonexistent')).toBeUndefined();
      expect(resolvePath(locStyleRecord, 'nonexistent.field')).toBeUndefined();
    });
  });

  describe('array index paths', () => {
    it('resolves array index notation', () => {
      expect(resolvePath(locStyleRecord, 'media[0].url')).toBe('https://example.com/master.jpg');
      expect(resolvePath(locStyleRecord, 'media[1].url')).toBe('https://example.com/thumb.jpg');
      expect(resolvePath(locStyleRecord, 'identifiers[0].value')).toBe('2018645678');
    });

    it('returns undefined for out-of-bounds index', () => {
      expect(resolvePath(locStyleRecord, 'media[99].url')).toBeUndefined();
    });
  });

  describe('predicate paths', () => {
    it('resolves predicate notation for role', () => {
      expect(resolvePath(locStyleRecord, 'media[role=thumbnail].url')).toBe('https://example.com/thumb.jpg');
      expect(resolvePath(locStyleRecord, 'media[role=master].url')).toBe('https://example.com/master.jpg');
    });

    it('resolves predicate notation for scheme', () => {
      expect(resolvePath(locStyleRecord, 'identifiers[scheme=doi].value')).toBe('10.1234/example');
      expect(resolvePath(locStyleRecord, 'identifiers[scheme=loc].value')).toBe('2018645678');
    });

    it('returns undefined when predicate does not match', () => {
      expect(resolvePath(locStyleRecord, 'media[role=nonexistent].url')).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('handles null/undefined record', () => {
      expect(resolvePath(null as any, 'label')).toBeUndefined();
      expect(resolvePath(undefined as any, 'label')).toBeUndefined();
    });

    it('handles empty path', () => {
      expect(resolvePath(locStyleRecord, '')).toBeUndefined();
      expect(resolvePath(locStyleRecord, '   ')).toBeUndefined();
    });
  });
});

// =============================================================================
// Value Resolution Tests
// =============================================================================

describe('resolveValue', () => {
  it('returns first non-empty value from path list', () => {
    const paths = ['nonexistent', 'label', 'id'];
    expect(resolveValue(locStyleRecord, paths)).toBe('Civil War Map of Virginia');
  });

  it('skips empty/null values', () => {
    const recordWithEmpty = { ...locStyleRecord, emptyField: '' };
    const paths = ['emptyField', 'label'];
    expect(resolveValue(recordWithEmpty, paths)).toBe('Civil War Map of Virginia');
  });

  it('converts numbers to strings', () => {
    const record = { count: 42 };
    expect(resolveValue(record, ['count'])).toBe('42');
  });

  it('extracts label from object values', () => {
    const record = { nested: { label: 'Nested Label' } };
    expect(resolveValue(record, ['nested'])).toBe('Nested Label');
  });

  it('joins array values with comma', () => {
    const record = { tags: ['one', 'two', 'three'] };
    expect(resolveValue(record, ['tags'])).toBe('one, two, three');
  });

  it('returns undefined when all paths fail', () => {
    expect(resolveValue(locStyleRecord, ['nonexistent1', 'nonexistent2'])).toBeUndefined();
  });
});

// =============================================================================
// Display Fields Resolution Tests
// =============================================================================

describe('resolveDisplayFields', () => {
  describe('with default config', () => {
    it('resolves title from label (default first path)', () => {
      const result = resolveDisplayFields(locStyleRecord, 'entity_detail');
      expect(result.title).toBe('Civil War Map of Virginia');
    });

    it('resolves subtitle from type (default path)', () => {
      const result = resolveDisplayFields(locStyleRecord, 'entity_detail');
      expect(result.subtitle).toBe('Work');
    });

    it('resolves thumbnail from media[role=thumbnail].url', () => {
      const result = resolveDisplayFields(locStyleRecord, 'entity_detail');
      expect(result.thumbnailUrl).toBe('https://example.com/thumb.jpg');
    });

    it('resolves snippet from description for search scope', () => {
      const result = resolveDisplayFields(locStyleRecord, 'search');
      expect(result.snippet).toBe('A detailed map of Virginia during the Civil War period.');
    });
  });

  describe('title fallback chain', () => {
    it('falls back to id when label missing', () => {
      const result = resolveDisplayFields(minimalRecord, 'entity_detail');
      expect(result.title).toBe('minimal-123');
    });

    it('falls back to "Untitled" when id also missing', () => {
      const result = resolveDisplayFields({}, 'entity_detail');
      expect(result.title).toBe('Untitled');
    });

    it('never returns empty/undefined title', () => {
      const result = resolveDisplayFields({ id: '', label: '' }, 'entity_detail');
      expect(result.title).toBe('Untitled');
    });
  });

  describe('with custom org config', () => {
    const customConfig: ProjectionConfig = {
      version: '1.0',
      profiles: {
        entity_detail: {
          title: ['properties.title', 'label'],
          subtitle: ['properties.creator'],
          thumbnail: ['media[0].url'],
        },
        entities_list: {
          title: ['properties.title'],
          subtitle: ['type'],
          thumbnail: ['media[role=thumbnail].url'],
        },
        search: {
          title: ['label'],
          subtitle: ['type'],
          snippet: ['properties.date'],
          thumbnail: ['media[role=thumbnail].url'],
        },
      },
    };

    it('uses org config paths for title', () => {
      const result = resolveDisplayFields(locStyleRecord, 'entity_detail', null, customConfig);
      // Custom config has properties.title first
      expect(result.title).toBe('Map Title from Properties');
    });

    it('uses org config paths for subtitle', () => {
      const result = resolveDisplayFields(locStyleRecord, 'entity_detail', null, customConfig);
      expect(result.subtitle).toBe('John Smith');
    });

    it('uses org config paths for thumbnail', () => {
      const result = resolveDisplayFields(locStyleRecord, 'entity_detail', null, customConfig);
      // Custom config uses media[0].url instead of media[role=thumbnail].url
      expect(result.thumbnailUrl).toBe('https://example.com/master.jpg');
    });
  });

  describe('scope handling', () => {
    it('uses entity_detail scope correctly', () => {
      const result = resolveDisplayFields(locStyleRecord, 'entity_detail');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('subtitle');
    });

    it('uses entities_list scope correctly', () => {
      const result = resolveDisplayFields(locStyleRecord, 'entities_list');
      expect(result).toHaveProperty('title');
    });

    it('uses search scope with snippet', () => {
      const result = resolveDisplayFields(locStyleRecord, 'search');
      expect(result).toHaveProperty('snippet');
    });

    it('defaults to entity_detail for invalid scope', () => {
      const result = resolveDisplayFields(locStyleRecord, 'invalid_scope' as any);
      expect(result.title).toBe('Civil War Map of Virginia');
    });
  });

  describe('legacy record handling', () => {
    it('does not crash on legacy records', () => {
      const result = resolveDisplayFields(legacyRecord, 'entity_detail');
      expect(result.title).toBe('legacy-001'); // Falls back to id
    });

    it('handles records with missing standard fields', () => {
      const incomplete = { id: 'incomplete' };
      const result = resolveDisplayFields(incomplete, 'entity_detail');
      expect(result.title).toBe('incomplete');
      expect(result.subtitle).toBeUndefined();
      expect(result.thumbnailUrl).toBeUndefined();
    });

    it('handles null/undefined record', () => {
      const result = resolveDisplayFields(null, 'entity_detail');
      expect(result.title).toBe('Unknown');
    });
  });
});

// =============================================================================
// Entity Display Fields Tests
// =============================================================================

describe('resolveEntityDisplayFields', () => {
  it('resolves from entity payload', () => {
    const entity = {
      payload: locStyleRecord,
      entity_key: 'test-key',
    };
    const result = resolveEntityDisplayFields(entity, 'entity_detail');
    expect(result.title).toBe('Civil War Map of Virginia');
  });

  it('falls back to entity-level title', () => {
    const entity = {
      payload: {},
      entity_key: 'fallback-key',
      title: 'Entity Level Title',
    };
    const result = resolveEntityDisplayFields(entity, 'entity_detail');
    expect(result.title).toBe('Entity Level Title');
  });

  it('falls back to entity_key when all else fails', () => {
    const entity = {
      payload: {},
      entity_key: 'the-entity-key',
    };
    const result = resolveEntityDisplayFields(entity, 'entity_detail');
    expect(result.title).toBe('the-entity-key');
  });

  it('uses entity-level thumbnail as fallback', () => {
    const entity = {
      payload: minimalRecord,
      entity_key: 'test-key',
      thumbnail_url: 'https://fallback.com/thumb.jpg',
    };
    const result = resolveEntityDisplayFields(entity, 'entity_detail');
    expect(result.thumbnailUrl).toBe('https://fallback.com/thumb.jpg');
  });

  it('uses entity_type as subtitle fallback when payload has no type', () => {
    const entity = {
      payload: { id: 'no-type-record' }, // No 'type' field
      entity_key: 'test-key',
      entity_type: 'FallbackType',
    };
    const result = resolveEntityDisplayFields(entity, 'entity_detail');
    expect(result.subtitle).toBe('FallbackType');
  });

  it('handles null entity', () => {
    const result = resolveEntityDisplayFields(null, 'entity_detail');
    expect(result.title).toBe('Unknown');
  });
});

// =============================================================================
// Precedence Tests
// =============================================================================

describe('getPathsForRoleWithPrecedence', () => {
  const datasetProjection: ScopeProfile = {
    title: ['properties.customTitle'],
    subtitle: ['properties.customSubtitle'],
  };

  const orgConfig: ProjectionConfig = {
    version: '1.0',
    profiles: {
      entity_detail: {
        title: ['properties.orgTitle', 'label'],
        subtitle: ['properties.orgSubtitle'],
      },
      entities_list: {
        title: ['label'],
      },
      search: {
        title: ['label'],
      },
    },
  };

  it('prefers dataset projection over org config', () => {
    const paths = getPathsForRoleWithPrecedence('title', 'entity_detail', datasetProjection, orgConfig);
    expect(paths).toEqual(['properties.customTitle']);
  });

  it('falls back to org config when dataset projection missing', () => {
    const paths = getPathsForRoleWithPrecedence('thumbnail', 'entity_detail', datasetProjection, orgConfig);
    // Dataset has no thumbnail, org config might not have it either, so falls back to defaults
    expect(paths).toEqual(DEFAULT_FALLBACKS.thumbnail);
  });

  it('falls back to system defaults when both are empty', () => {
    const paths = getPathsForRoleWithPrecedence('title', 'entity_detail', null, null);
    expect(paths).toEqual(DEFAULT_FALLBACKS.title);
  });
});

// =============================================================================
// Default Config Tests
// =============================================================================

describe('getDefaultProjectionConfig', () => {
  it('returns valid config structure', () => {
    const config = getDefaultProjectionConfig();
    expect(config.version).toBe('1.0');
    expect(config.profiles).toHaveProperty('entity_detail');
    expect(config.profiles).toHaveProperty('entities_list');
    expect(config.profiles).toHaveProperty('search');
  });

  it('has title paths for all scopes', () => {
    const config = getDefaultProjectionConfig();
    expect(config.profiles.entity_detail.title.length).toBeGreaterThan(0);
    expect(config.profiles.entities_list.title.length).toBeGreaterThan(0);
    expect(config.profiles.search.title.length).toBeGreaterThan(0);
  });

  it('has snippet only in search scope', () => {
    const config = getDefaultProjectionConfig();
    expect(config.profiles.search.snippet?.length).toBeGreaterThan(0);
    expect(config.profiles.entity_detail.snippet).toBeUndefined();
    expect(config.profiles.entities_list.snippet).toBeUndefined();
  });
});

// =============================================================================
// Integration Tests - Configured Path Changes Display
// =============================================================================

describe('configured title path changes display', () => {
  it('changes title when org config specifies different path', () => {
    // Default config would use 'label' first
    const defaultResult = resolveDisplayFields(locStyleRecord, 'entity_detail');
    expect(defaultResult.title).toBe('Civil War Map of Virginia');

    // Custom config uses properties.title first
    const customConfig: ProjectionConfig = {
      version: '1.0',
      profiles: {
        entity_detail: {
          title: ['properties.title'],
        },
        entities_list: { title: ['label'] },
        search: { title: ['label'] },
      },
    };

    const customResult = resolveDisplayFields(locStyleRecord, 'entity_detail', null, customConfig);
    expect(customResult.title).toBe('Map Title from Properties');
  });

  it('changes thumbnail when org config specifies different path', () => {
    // Default uses media[role=thumbnail].url
    const defaultResult = resolveDisplayFields(locStyleRecord, 'entity_detail');
    expect(defaultResult.thumbnailUrl).toBe('https://example.com/thumb.jpg');

    // Custom config uses media[0].url (first item regardless of role)
    const customConfig: ProjectionConfig = {
      version: '1.0',
      profiles: {
        entity_detail: {
          title: ['label'],
          thumbnail: ['media[0].url'],
        },
        entities_list: { title: ['label'] },
        search: { title: ['label'] },
      },
    };

    const customResult = resolveDisplayFields(locStyleRecord, 'entity_detail', null, customConfig);
    expect(customResult.thumbnailUrl).toBe('https://example.com/master.jpg');
  });
});

// =============================================================================
// Integration Tests - Fallback Works When Missing Fields
// =============================================================================

describe('fallback works when missing fields', () => {
  it('falls back through title paths when earlier paths fail', () => {
    const record = {
      id: 'fallback-test',
      type: 'Test',
      // No label, no properties.title
    };

    const result = resolveDisplayFields(record, 'entity_detail');
    // Should fall back to id since label and properties.title are missing
    expect(result.title).toBe('fallback-test');
  });

  it('returns undefined for optional fields when all paths fail', () => {
    const record = {
      id: 'no-media',
      type: 'Test',
      label: 'Test Label',
      // No media array
    };

    const result = resolveDisplayFields(record, 'entity_detail');
    expect(result.thumbnailUrl).toBeUndefined();
  });

  it('handles completely empty payload gracefully', () => {
    const result = resolveDisplayFields({}, 'entity_detail');
    expect(result.title).toBe('Untitled');
    expect(result.subtitle).toBeUndefined();
    expect(result.thumbnailUrl).toBeUndefined();
    expect(result.snippet).toBeUndefined();
  });

  it('handles non-canonical data without crashing', () => {
    const weirdRecord = {
      id: 'weird-id',
      someRandomField: 'value',
      nested: {
        deeply: {
          buried: 'treasure',
        },
      },
    };

    const result = resolveDisplayFields(weirdRecord, 'entity_detail');
    expect(result.title).toBe('weird-id');
  });
});
