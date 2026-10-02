/**
 * Tests for useAutosaveManager from components/workshop/AutosaveField.tsx.
 *
 * Co-located in src/test/hooks/ alongside the other hook tests for discoverability,
 * even though the source lives under components/workshop/.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutosaveManager } from '../../components/workshop/AutosaveField';

describe('useAutosaveManager', () => {
  beforeEach(() => {
    // Lock time so lastSaved is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial state is idle (no pending saves, no lastSaved, no unsaved changes)', () => {
    const { result } = renderHook(() => useAutosaveManager());
    expect(result.current.isSaving).toBe(false);
    expect(result.current.lastSaved).toBe(null);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it('registerPendingSave marks saving and unsaved changes', () => {
    const { result } = renderHook(() => useAutosaveManager());

    act(() => {
      result.current.registerPendingSave('field-a');
    });

    expect(result.current.isSaving).toBe(true);
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(result.current.lastSaved).toBe(null);
  });

  it('multiple pending saves keep isSaving true until all complete', () => {
    const { result } = renderHook(() => useAutosaveManager());

    act(() => {
      result.current.registerPendingSave('field-a');
      result.current.registerPendingSave('field-b');
    });
    expect(result.current.isSaving).toBe(true);

    act(() => {
      result.current.completeSave('field-a');
    });
    // Still saving because field-b is pending.
    expect(result.current.isSaving).toBe(true);

    act(() => {
      result.current.completeSave('field-b');
    });
    expect(result.current.isSaving).toBe(false);
  });

  it('completeSave records lastSaved and clears unsaved-changes flag', () => {
    const { result } = renderHook(() => useAutosaveManager());

    act(() => {
      result.current.registerPendingSave('field-a');
    });
    act(() => {
      result.current.completeSave('field-a');
    });

    expect(result.current.lastSaved).toBeInstanceOf(Date);
    expect(result.current.lastSaved?.toISOString()).toBe('2026-04-24T12:00:00.000Z');
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(result.current.isSaving).toBe(false);
  });

  it('completing an unknown field id is a no-op for the pending set but still updates lastSaved', () => {
    // Documents the current behavior: completeSave always sets lastSaved.
    const { result } = renderHook(() => useAutosaveManager());

    act(() => {
      result.current.completeSave('never-registered');
    });

    expect(result.current.isSaving).toBe(false);
    expect(result.current.lastSaved).not.toBe(null);
  });

  it('registerPendingSave is idempotent for the same id', () => {
    const { result } = renderHook(() => useAutosaveManager());

    act(() => {
      result.current.registerPendingSave('same-field');
      result.current.registerPendingSave('same-field');
    });
    expect(result.current.isSaving).toBe(true);

    act(() => {
      result.current.completeSave('same-field');
    });
    // One complete should clear the single registration.
    expect(result.current.isSaving).toBe(false);
  });

  it('callbacks are stable across renders', () => {
    const { result, rerender } = renderHook(() => useAutosaveManager());

    const firstRegister = result.current.registerPendingSave;
    const firstComplete = result.current.completeSave;

    rerender();

    expect(result.current.registerPendingSave).toBe(firstRegister);
    expect(result.current.completeSave).toBe(firstComplete);
  });
});
