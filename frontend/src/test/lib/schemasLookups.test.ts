import { describe, it, expect } from 'vitest';
import {
  VocabularyTermSchema,
  PersonAuthoritySchema,
  PaginatedAuthoritiesSchema,
  PersonAuthorityRelationSchema,
  AuthorityRelationsSchema,
  ObjectPersonAuthoritySchema,
  ObjectPersonAuthorityRoleSchema,
  EmbeddedVocabularyTermSchema,
  ObjectMaterialSchema,
  ObjectTechniqueSchema,
  CitationSchema,
  CitationTypeSchema,
  PaginatedCitationsSchema,
  ObjectCitationLinkSchema,
  PlaceTypeEnum,
  PlaceAuthoritySchema,
  PlaceRoleEnum,
  ObjectPlaceAuthoritySchema,
  StylePeriodTypeEnum,
  StylePeriodAuthoritySchema,
  AssignmentCertaintyEnum,
  ObjectStylePeriodSchema,
  SubjectTypeEnum,
  SubjectAuthoritySchema,
  ObjectSubjectSchema,
} from '../../lib/schemas/lookups';

describe('schemas/lookups', () => {
  describe('VocabularyTermSchema', () => {
    it('parses a Getty AAT term', () => {
      const result = VocabularyTermSchema.parse({
        term_id: 't-1',
        vocabulary: 'aat',
        external_id: '300033618',
        preferred_term: 'oil paint',
        is_local: false,
        usage_count: 0,
      });
      expect(result.preferred_term).toBe('oil paint');
    });

    it('allows null term_id (uncached remote results)', () => {
      const result = VocabularyTermSchema.parse({
        term_id: null,
        vocabulary: 'aat',
        preferred_term: 'paint',
        is_local: false,
        usage_count: 0,
      });
      expect(result.term_id).toBeNull();
    });

    it('rejects when usage_count is missing', () => {
      const result = VocabularyTermSchema.safeParse({
        vocabulary: 'aat',
        preferred_term: 'paint',
        is_local: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PersonAuthoritySchema', () => {
    it('parses minimal person authority', () => {
      const result = PersonAuthoritySchema.parse({
        authority_id: 'a-1',
        preferred_name: 'Vincent van Gogh',
        status: 'active',
        is_verified: false,
      });
      expect(result.preferred_name).toBe('Vincent van Gogh');
    });

    it('rejects invalid status', () => {
      const result = PersonAuthoritySchema.safeParse({
        authority_id: 'a-1',
        preferred_name: 'X',
        status: 'unknown',
        is_verified: false,
      });
      expect(result.success).toBe(false);
    });

    it('accepts merged status with merged_into_id', () => {
      const result = PersonAuthoritySchema.parse({
        authority_id: 'a-1',
        preferred_name: 'X',
        status: 'merged',
        merged_into_id: 'a-2',
        is_verified: false,
      });
      expect(result.status).toBe('merged');
      expect(result.merged_into_id).toBe('a-2');
    });
  });

  describe('PaginatedAuthoritiesSchema', () => {
    it('parses an empty page', () => {
      const result = PaginatedAuthoritiesSchema.parse({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
      expect(result.total).toBe(0);
    });
  });

  describe('PersonAuthorityRelationSchema and AuthorityRelationsSchema', () => {
    it('parses a relation', () => {
      const result = PersonAuthorityRelationSchema.parse({
        relation_id: 'r-1',
        source_authority_id: 'a-1',
        related_authority_id: 'a-2',
        relationship_type: 'student_of',
      });
      expect(result.relationship_type).toBe('student_of');
    });

    it('parses outgoing+incoming wrappers', () => {
      const result = AuthorityRelationsSchema.parse({
        outgoing_relations: [],
        incoming_relations: [],
      });
      expect(result.outgoing_relations).toEqual([]);
    });
  });

  describe('ObjectPersonAuthorityRoleSchema', () => {
    it('accepts known roles', () => {
      for (const role of ['creator', 'donor', 'previous_owner', 'depicted', 'associated']) {
        expect(ObjectPersonAuthorityRoleSchema.safeParse(role).success).toBe(true);
      }
    });

    it('rejects unknown role', () => {
      expect(ObjectPersonAuthorityRoleSchema.safeParse('owner').success).toBe(false);
    });
  });

  describe('ObjectPersonAuthoritySchema', () => {
    it('parses with embedded authority', () => {
      const result = ObjectPersonAuthoritySchema.parse({
        link_id: 'l-1',
        object_id: 'o-1',
        authority_id: 'a-1',
        role: 'creator',
        display_order: 0,
      });
      expect(result.role).toBe('creator');
    });
  });

  describe('EmbeddedVocabularyTermSchema', () => {
    it('parses term', () => {
      const result = EmbeddedVocabularyTermSchema.parse({
        term_id: 't-1',
        vocabulary: 'aat',
        preferred_term: 'wood',
      });
      expect(result.preferred_term).toBe('wood');
    });
  });

  describe('ObjectMaterialSchema', () => {
    it('parses material link', () => {
      const result = ObjectMaterialSchema.parse({
        link_id: 'l-1',
        object_id: 'o-1',
        vocabulary_term_id: 't-1',
        display_order: 0,
      });
      expect(result.link_id).toBe('l-1');
    });
  });

  describe('ObjectTechniqueSchema', () => {
    it('parses technique link', () => {
      const result = ObjectTechniqueSchema.parse({
        link_id: 'l-1',
        object_id: 'o-1',
        vocabulary_term_id: 't-1',
        display_order: 0,
      });
      expect(result.link_id).toBe('l-1');
    });
  });

  describe('CitationTypeSchema', () => {
    it('accepts known citation types', () => {
      expect(CitationTypeSchema.safeParse('book').success).toBe(true);
      expect(CitationTypeSchema.safeParse('article').success).toBe(true);
      expect(CitationTypeSchema.safeParse('exhibition_catalog').success).toBe(true);
    });

    it('rejects invalid type', () => {
      expect(CitationTypeSchema.safeParse('podcast').success).toBe(false);
    });
  });

  describe('CitationSchema', () => {
    it('parses minimal citation', () => {
      const result = CitationSchema.parse({
        citation_id: 'c-1',
        organization_id: 'org-1',
        citation_type: 'book',
        brief_citation: 'Smith 2020',
        works_cited: false,
        works_illustrated: false,
      });
      expect(result.brief_citation).toBe('Smith 2020');
    });
  });

  describe('PaginatedCitationsSchema', () => {
    it('parses empty page', () => {
      const result = PaginatedCitationsSchema.parse({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
      expect(result.items).toEqual([]);
    });
  });

  describe('ObjectCitationLinkSchema', () => {
    it('parses link', () => {
      const result = ObjectCitationLinkSchema.parse({
        link_id: 'l-1',
        organization_id: 'org-1',
        object_id: 'o-1',
        citation_id: 'c-1',
        works_cited: true,
        works_illustrated: false,
        is_primary: false,
        display_order: 0,
      });
      expect(result.is_primary).toBe(false);
    });
  });

  describe('PlaceTypeEnum and PlaceAuthoritySchema', () => {
    it('accepts known place types', () => {
      for (const t of ['city', 'country', 'region']) {
        expect(PlaceTypeEnum.safeParse(t).success).toBe(true);
      }
    });

    it('rejects unknown place type', () => {
      expect(PlaceTypeEnum.safeParse('planet').success).toBe(false);
    });

    it('parses place authority with coordinates', () => {
      const result = PlaceAuthoritySchema.parse({
        place_authority_id: 'p-1',
        organization_id: 'org-1',
        preferred_name: 'Paris',
        place_type: 'city',
        coordinates_lat: 48.8566,
        coordinates_lng: 2.3522,
        status: 'active',
      });
      expect(result.coordinates_lat).toBe(48.8566);
    });
  });

  describe('PlaceRoleEnum', () => {
    it('accepts known roles', () => {
      expect(PlaceRoleEnum.safeParse('creation_place').success).toBe(true);
      expect(PlaceRoleEnum.safeParse('depicted_place').success).toBe(true);
    });
  });

  describe('ObjectPlaceAuthoritySchema', () => {
    it('parses with role', () => {
      const result = ObjectPlaceAuthoritySchema.parse({
        link_id: 'l-1',
        object_id: 'o-1',
        place_authority_id: 'p-1',
        role: 'creation_place',
        display_order: 0,
      });
      expect(result.role).toBe('creation_place');
    });
  });

  describe('StylePeriodTypeEnum', () => {
    it('accepts movement and school', () => {
      expect(StylePeriodTypeEnum.safeParse('movement').success).toBe(true);
      expect(StylePeriodTypeEnum.safeParse('school').success).toBe(true);
    });
  });

  describe('StylePeriodAuthoritySchema', () => {
    it('parses authority', () => {
      const result = StylePeriodAuthoritySchema.parse({
        authority_id: 's-1',
        organization_id: 'org-1',
        preferred_term: 'Impressionism',
        authority_type: 'movement',
        status: 'active',
      });
      expect(result.preferred_term).toBe('Impressionism');
    });
  });

  describe('AssignmentCertaintyEnum', () => {
    it('accepts certain/probable/possible', () => {
      for (const c of ['certain', 'probable', 'possible']) {
        expect(AssignmentCertaintyEnum.safeParse(c).success).toBe(true);
      }
    });
  });

  describe('ObjectStylePeriodSchema', () => {
    it('parses with assignment certainty', () => {
      const result = ObjectStylePeriodSchema.parse({
        link_id: 'l-1',
        object_id: 'o-1',
        authority_id: 's-1',
        assignment_certainty: 'probable',
        display_order: 0,
      });
      expect(result.assignment_certainty).toBe('probable');
    });
  });

  describe('SubjectTypeEnum', () => {
    it('accepts iconographic and thematic', () => {
      expect(SubjectTypeEnum.safeParse('iconographic').success).toBe(true);
      expect(SubjectTypeEnum.safeParse('thematic').success).toBe(true);
    });
  });

  describe('SubjectAuthoritySchema', () => {
    it('parses subject authority', () => {
      const result = SubjectAuthoritySchema.parse({
        authority_id: 'sub-1',
        organization_id: 'org-1',
        preferred_term: 'water lilies',
        subject_type: 'iconographic',
        status: 'active',
      });
      expect(result.preferred_term).toBe('water lilies');
    });
  });

  describe('ObjectSubjectSchema', () => {
    it('parses link', () => {
      const result = ObjectSubjectSchema.parse({
        link_id: 'l-1',
        object_id: 'o-1',
        subject_authority_id: 'sub-1',
        display_order: 0,
      });
      expect(result.subject_authority_id).toBe('sub-1');
    });
  });
});
