import { describe, it, expect, beforeEach } from 'vitest';
import {
  setDragPayload,
  getDragPayload,
  clearDragPayload,
} from '../../lib/dragTypes';
import type { DragObjectPayload, DragMediaPayload } from '../../lib/dragTypes';

describe('dragTypes', () => {
  beforeEach(() => {
    clearDragPayload();
  });

  it('starts with null payload', () => {
    expect(getDragPayload()).toBeNull();
  });

  it('stores and retrieves an object payload', () => {
    const payload: DragObjectPayload = {
      kind: 'object',
      objectId: 'obj-1',
      objectNumber: '2026.1.1',
      title: 'Test',
    };
    setDragPayload(payload);
    expect(getDragPayload()).toEqual(payload);
  });

  it('stores and retrieves a media payload', () => {
    const payload: DragMediaPayload = {
      kind: 'media',
      mediaId: 'media-1',
      filename: 'img.jpg',
      title: 'Photo',
    };
    setDragPayload(payload);
    expect(getDragPayload()).toEqual(payload);
  });

  it('allows setting payload to null', () => {
    setDragPayload({
      kind: 'object',
      objectId: 'o',
      objectNumber: '1',
      title: 't',
    });
    setDragPayload(null);
    expect(getDragPayload()).toBeNull();
  });

  it('clears the payload via clearDragPayload', () => {
    setDragPayload({
      kind: 'media',
      mediaId: 'm',
      filename: 'f.jpg',
      title: 't',
    });
    clearDragPayload();
    expect(getDragPayload()).toBeNull();
  });

  it('overwrites a previous payload', () => {
    setDragPayload({
      kind: 'object',
      objectId: 'o1',
      objectNumber: '1',
      title: 'A',
    });
    setDragPayload({
      kind: 'object',
      objectId: 'o2',
      objectNumber: '2',
      title: 'B',
    });
    expect(getDragPayload()?.kind).toBe('object');
    expect((getDragPayload() as DragObjectPayload).objectId).toBe('o2');
  });
});
