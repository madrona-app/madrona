import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDialogState } from '../../hooks/useDialogState';

describe('useDialogState (simple)', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useDialogState());
    expect(result.current.isOpen).toBe(false);
  });

  it('open() sets isOpen to true', () => {
    const { result } = renderHook(() => useDialogState());
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
  });

  it('close() sets isOpen to false', () => {
    const { result } = renderHook(() => useDialogState());
    act(() => result.current.open());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });

  it('toggle() flips isOpen', () => {
    const { result } = renderHook(() => useDialogState());
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });
});

describe('useDialogState (with data)', () => {
  const initialData = { targetStatus: '', targetStatusLabel: '' };

  it('initializes with provided data', () => {
    const { result } = renderHook(() => useDialogState(initialData));
    expect(result.current.data).toEqual(initialData);
    expect(result.current.isOpen).toBe(false);
  });

  it('open() with partial data merges into state', () => {
    const { result } = renderHook(() => useDialogState(initialData));
    act(() => result.current.open({ targetStatus: 'approved' }));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.data).toEqual({
      targetStatus: 'approved',
      targetStatusLabel: '',
    });
  });

  it('open() without data just opens', () => {
    const { result } = renderHook(() => useDialogState(initialData));
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.data).toEqual(initialData);
  });

  it('close() resets data to initial values', () => {
    const { result } = renderHook(() => useDialogState(initialData));
    act(() => result.current.open({ targetStatus: 'approved' }));
    act(() => result.current.close());
    expect(result.current.data).toEqual(initialData);
  });

  it('close() sets isOpen to false', () => {
    const { result } = renderHook(() => useDialogState(initialData));
    act(() => result.current.open());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });
});
