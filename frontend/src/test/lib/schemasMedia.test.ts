import { describe, it, expect } from 'vitest';
import {
  MediaSchema,
  MediaEmbeddedSchema,
  MediaListResponseSchema,
  MediaSearchHitSchema,
  MediaSearchFacetBucketSchema,
  MediaSearchFacetSchema,
  MediaSearchResponseSchema,
  MediaDerivativeSchema,
} from '../../lib/schemas/media';

const baseMedia = {
  media_id: 'm-1',
  organization_id: 'org-1',
  s3_key: 'org-1/m-1.jpg',
  filename: 'photo.jpg',
  file_size: 1024,
  mime_type: 'image/jpeg',
  media_type: 'image' as const,
  processing_status: 'completed' as const,
};

describe('schemas/media', () => {
  describe('MediaSchema', () => {
    it('parses a minimal valid media record', () => {
      const result = MediaSchema.parse(baseMedia);
      expect(result.media_id).toBe('m-1');
    });

    it('rejects unknown media_type values', () => {
      expect(() =>
        MediaSchema.parse({ ...baseMedia, media_type: 'gif' }),
      ).toThrow();
    });

    it('rejects unknown processing_status values', () => {
      expect(() =>
        MediaSchema.parse({ ...baseMedia, processing_status: 'whatever' }),
      ).toThrow();
    });

    it('accepts optional preservation fields', () => {
      const result = MediaSchema.parse({
        ...baseMedia,
        format_name: 'JPEG',
        pronom_puid: 'fmt/43',
        format_risk_level: 'low',
      });
      expect(result.pronom_puid).toBe('fmt/43');
    });
  });

  describe('MediaEmbeddedSchema', () => {
    it('only requires media_id and filename', () => {
      const result = MediaEmbeddedSchema.parse({
        media_id: 'm-1',
        filename: 'p.jpg',
      });
      expect(result.media_id).toBe('m-1');
    });

    it('rejects when media_id missing', () => {
      expect(() => MediaEmbeddedSchema.parse({ filename: 'x' })).toThrow();
    });
  });

  describe('MediaListResponseSchema', () => {
    it('parses paginated media list', () => {
      const result = MediaListResponseSchema.parse({
        items: [baseMedia],
        total: 1,
        page: 1,
        page_size: 10,
        total_pages: 1,
      });
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });

    it('rejects when items in array are invalid', () => {
      expect(() =>
        MediaListResponseSchema.parse({
          items: [{ media_id: 'x' }],
          total: 0,
          page: 1,
          page_size: 10,
          total_pages: 0,
        }),
      ).toThrow();
    });
  });

  describe('MediaSearchHitSchema', () => {
    it('accepts search hit with score and highlights', () => {
      const result = MediaSearchHitSchema.parse({
        media_id: 'm-1',
        filename: 'p.jpg',
        media_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 100,
        processing_status: 'completed',
        is_published: true,
        score: 1.23,
        highlights: { title: ['foo'] },
      });
      expect(result.score).toBe(1.23);
    });
  });

  describe('MediaSearchFacetBucketSchema and MediaSearchFacetSchema', () => {
    it('parses bucket', () => {
      const result = MediaSearchFacetBucketSchema.parse({ key: 'image', count: 5 });
      expect(result.count).toBe(5);
    });

    it('parses nested facet', () => {
      const result = MediaSearchFacetSchema.parse({
        field: 'media_type',
        buckets: [{ key: 'image', count: 5 }],
      });
      expect(result.buckets[0].key).toBe('image');
    });
  });

  describe('MediaSearchResponseSchema', () => {
    it('parses search response without facets', () => {
      const result = MediaSearchResponseSchema.parse({
        hits: [],
        total: 0,
      });
      expect(result.hits).toEqual([]);
    });
  });

  describe('MediaDerivativeSchema', () => {
    it('parses a valid derivative', () => {
      const result = MediaDerivativeSchema.parse({
        derivative_id: 'd-1',
        media_id: 'm-1',
        derivative_type: 'thumbnail',
        format: 'jpg',
        s3_key: 'k',
        width: 200,
        height: 200,
        file_size: 1024,
      });
      expect(result.derivative_id).toBe('d-1');
    });

    it('rejects when width/height missing', () => {
      expect(() =>
        MediaDerivativeSchema.parse({
          derivative_id: 'd-1',
          media_id: 'm-1',
          derivative_type: 'thumbnail',
          format: 'jpg',
          s3_key: 'k',
          file_size: 1,
        }),
      ).toThrow();
    });
  });
});
