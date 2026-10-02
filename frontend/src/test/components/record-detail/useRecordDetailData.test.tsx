import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useRecordDetailData,
  type CollectionObjectData,
  type MediaItem,
} from '../../../components/record-detail/useRecordDetailData';

function object(overrides: Partial<CollectionObjectData> = {}): CollectionObjectData {
  return {
    object_id: 'obj-1',
    object_number: 'A-1',
    object_type: 'painting',
    object_status: 'active',
    current_location_name: 'Gallery 1',
    is_on_display: true,
    titles: [{ title: 'Sunrise', is_primary: true }],
    ...overrides,
  };
}

function mediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    media_id: 'm-1',
    filename: 'img.jpg',
    title: 'Image title',
    thumbnail_url: 'https://example.com/thumb.jpg',
    url: 'https://example.com/full.jpg',
    is_primary: true,
    ...overrides,
  };
}

describe('useRecordDetailData', () => {
  it('returns empty railProps when there is no object and no imagery', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({ object: null, media: [] }),
    );
    expect(result.current.railProps).toEqual({});
  });

  it('builds railProps with status label/variant and object metadata', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({ object: object(), media: [mediaItem()] }),
    );
    const rail = result.current.railProps;
    expect(rail.objectNumber).toBe('A-1');
    expect(rail.objectType).toBe('painting');
    expect(rail.location).toBe('Gallery 1');
    expect(rail.isOnDisplay).toBe(true);
    expect(rail.isLocationRequired).toBe(true);
    expect(rail.status).toBe('Active');
    expect(rail.statusVariant).toBe('success');
  });

  it('maps status to variants correctly', () => {
    const { result: pending } = renderHook(() =>
      useRecordDetailData({ object: object({ object_status: 'pending' }) }),
    );
    expect(pending.current.railProps.statusVariant).toBe('warning');

    const { result: missing } = renderHook(() =>
      useRecordDetailData({ object: object({ object_status: 'missing' }) }),
    );
    expect(missing.current.railProps.statusVariant).toBe('error');

    const { result: unknown } = renderHook(() =>
      useRecordDetailData({ object: object({ object_status: 'weird' }) }),
    );
    expect(unknown.current.railProps.statusVariant).toBe('default');
    // Falls back to raw string when no friendly label exists
    expect(unknown.current.railProps.status).toBe('weird');
  });

  it('derives imageAlt from primary title, otherwise first title, else fallback', () => {
    const { result: withPrimary } = renderHook(() =>
      useRecordDetailData({ object: object() }),
    );
    expect(withPrimary.current.railProps.imageAlt).toBe('Sunrise');

    const { result: noPrimary } = renderHook(() =>
      useRecordDetailData({
        object: object({ titles: [{ title: 'Alt', is_primary: false }] }),
      }),
    );
    expect(noPrimary.current.railProps.imageAlt).toBe('Alt');

    const { result: noTitles } = renderHook(() =>
      useRecordDetailData({ object: object({ titles: [] }) }),
    );
    expect(noTitles.current.railProps.imageAlt).toBe('Object image');
  });

  it('prefers primary_image_url, then primary media, then first media for railProps.imageUrl', () => {
    const { result: withObjUrl } = renderHook(() =>
      useRecordDetailData({
        object: object({ primary_image_url: 'https://pri.mary/image.jpg' }),
        media: [mediaItem({ url: 'https://other.jpg' })],
      }),
    );
    expect(withObjUrl.current.railProps.imageUrl).toBe('https://pri.mary/image.jpg');

    const { result: withPrimaryMedia } = renderHook(() =>
      useRecordDetailData({
        object: object({ primary_image_url: null }),
        media: [
          mediaItem({ is_primary: false, thumbnail_url: 'non-primary' }),
          mediaItem({ media_id: 'm-2', is_primary: true, thumbnail_url: 'primary-thumb' }),
        ],
      }),
    );
    expect(withPrimaryMedia.current.railProps.imageUrl).toBe('primary-thumb');
  });

  it('builds imageModalMedia only for items with any URL', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: object(),
        media: [
          mediaItem({ media_id: 'with-url', url: 'https://x' }),
          mediaItem({ media_id: 'empty', url: undefined, thumbnail_url: undefined, full_url: undefined }),
        ],
      }),
    );
    expect(result.current.imageModalMedia.length).toBe(1);
    expect(result.current.imageModalMedia[0].id).toBe('with-url');
  });

  it('openImageModal/closeImageModal toggles isImageModalOpen and sets index', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({ object: object(), media: [mediaItem()] }),
    );
    expect(result.current.isImageModalOpen).toBe(false);

    act(() => {
      result.current.openImageModal(2);
    });
    expect(result.current.isImageModalOpen).toBe(true);
    expect(result.current.imageModalInitialIndex).toBe(2);

    act(() => {
      result.current.closeImageModal();
    });
    expect(result.current.isImageModalOpen).toBe(false);
  });

  it('includes permission-gated quickActions in the right rail', () => {
    const onMovementClick = vi.fn();
    const onLoanRequestClick = vi.fn();
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: object(),
        permissions: {
          canCreateMovement: true,
          canCreateLoanRequest: true,
          canCreateConditionReport: false,
        },
        callbacks: { onMovementClick, onLoanRequestClick },
      }),
    );

    const actions = result.current.railProps.quickActions!;
    const ids = actions.map((a) => a.id);
    expect(ids).toContain('movement');
    expect(ids).toContain('loan');
    expect(ids).not.toContain('condition');
    // Priority order: movement ranks before loan
    expect(ids.indexOf('movement')).toBeLessThan(ids.indexOf('loan'));
  });

  it('header quickActions append Generate Report when granted', () => {
    const onGenerateReport = vi.fn();
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: object(),
        permissions: { canGenerateReport: true },
        callbacks: { onGenerateReport },
      }),
    );
    const headerIds = result.current.headerProps.quickActions.map((a) => a.id);
    expect(headerIds).toContain('generate-report');
  });

  it('headerProps defaults canCreateTask/canViewHistory to true', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({ object: object() }),
    );
    expect(result.current.headerProps.canCreateTask).toBe(true);
    expect(result.current.headerProps.canViewHistory).toBe(true);
  });
});
