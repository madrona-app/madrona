import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useRecordDetailData,
  type CollectionObjectData,
  type MediaItem,
} from '../../components/record-detail/useRecordDetailData';

const baseObject: CollectionObjectData = {
  object_id: 'o-1',
  object_number: '2024.1',
  object_type: 'painting',
  object_status: 'accessioned',
  current_location_name: 'Gallery A',
  current_location_id: 'loc-1',
  is_on_display: false,
  primary_image_url: 'http://example.com/primary.jpg',
  titles: [{ title: 'Sunflower', is_primary: true }],
};

describe('useRecordDetailData', () => {
  it('returns empty railProps when no object and no image', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({ object: null })
    );
    expect(result.current.railProps).toEqual({});
  });

  it('builds railProps from object data', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({ object: baseObject })
    );
    const rail = result.current.railProps;
    expect(rail.objectNumber).toBe('2024.1');
    expect(rail.objectType).toBe('painting');
    // status is mapped via label table
    expect(rail.status).toBe('Accessioned');
    expect(rail.statusVariant).toBe('success');
    expect(rail.location).toBe('Gallery A');
    expect(rail.imageUrl).toBe('http://example.com/primary.jpg');
  });

  it('maps warning statuses to warning variant', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: { ...baseObject, object_status: 'pending' },
      })
    );
    expect(result.current.railProps.statusVariant).toBe('warning');
    expect(result.current.railProps.status).toBe('Pending');
  });

  it('maps error statuses to error variant', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: { ...baseObject, object_status: 'missing' },
      })
    );
    expect(result.current.railProps.statusVariant).toBe('error');
    expect(result.current.railProps.status).toBe('Missing');
  });

  it('passes through unknown status labels unchanged', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: { ...baseObject, object_status: 'custom_state' },
      })
    );
    expect(result.current.railProps.status).toBe('custom_state');
    expect(result.current.railProps.statusVariant).toBe('default');
  });

  it('uses primary image from media when object has no primary_image_url', () => {
    const media: MediaItem[] = [
      {
        media_id: 'm2',
        thumbnail_url: 'http://example.com/m2-thumb.jpg',
        url: 'http://example.com/m2.jpg',
        is_primary: true,
      },
      {
        media_id: 'm1',
        thumbnail_url: 'http://example.com/m1-thumb.jpg',
        is_primary: false,
      },
    ];
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: { ...baseObject, primary_image_url: null },
        media,
      })
    );
    expect(result.current.railProps.imageUrl).toBe(
      'http://example.com/m2-thumb.jpg'
    );
  });

  it('builds imageModalMedia from the media array', () => {
    const media: MediaItem[] = [
      {
        media_id: 'm1',
        filename: 'a.jpg',
        url: 'http://example.com/a.jpg',
        title: 'A',
      },
      {
        media_id: 'm2',
        filename: 'b.jpg',
        // No URL/thumbnail → filtered out
      },
    ];
    const { result } = renderHook(() =>
      useRecordDetailData({ object: baseObject, media })
    );
    expect(result.current.imageModalMedia).toHaveLength(1);
    expect(result.current.imageModalMedia[0].id).toBe('m1');
    expect(result.current.imageModalMedia[0].alt).toBe('A');
  });

  it('openImageModal sets index and open state; closeImageModal resets open', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({ object: baseObject })
    );

    expect(result.current.isImageModalOpen).toBe(false);
    expect(result.current.imageModalInitialIndex).toBe(0);

    act(() => result.current.openImageModal(3));
    expect(result.current.isImageModalOpen).toBe(true);
    expect(result.current.imageModalInitialIndex).toBe(3);

    act(() => result.current.closeImageModal());
    expect(result.current.isImageModalOpen).toBe(false);
  });

  it('builds quickActions only for permission+callback pairs', () => {
    const onMovement = vi.fn();
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: baseObject,
        permissions: {
          canCreateMovement: true,
          canCreateConditionReport: false,
          canCreateLoanRequest: false,
          canCreateIncident: false,
        },
        callbacks: { onMovementClick: onMovement },
      })
    );
    const actions = result.current.railProps.quickActions ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe('movement');
    actions[0].onClick();
    expect(onMovement).toHaveBeenCalledTimes(1);
  });

  it('adds Generate Report to headerProps quickActions when permitted', () => {
    const onReport = vi.fn();
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: baseObject,
        permissions: { canGenerateReport: true },
        callbacks: { onGenerateReport: onReport },
      })
    );
    const headerActions = result.current.headerProps.quickActions;
    const reportAction = headerActions.find(
      (a) => a.id === 'generate-report'
    );
    expect(reportAction).toBeTruthy();
    reportAction?.onClick();
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('defaults canCreateTask to true when permission not specified', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({ object: baseObject })
    );
    expect(result.current.headerProps.canCreateTask).toBe(true);
    expect(result.current.railProps.canCreateTask).toBe(true);
  });

  it('uses primary title for imageAlt when titles provided', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: {
          ...baseObject,
          titles: [
            { title: 'Secondary', is_primary: false },
            { title: 'The Primary Title', is_primary: true },
          ],
        },
      })
    );
    expect(result.current.railProps.imageAlt).toBe('The Primary Title');
  });

  it('falls back to default imageAlt when titles missing', () => {
    const { result } = renderHook(() =>
      useRecordDetailData({
        object: { ...baseObject, titles: undefined },
      })
    );
    expect(result.current.railProps.imageAlt).toBe('Object image');
  });
});
