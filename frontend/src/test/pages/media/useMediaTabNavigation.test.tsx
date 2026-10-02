import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMediaTabNavigation } from '../../../pages/media/MediaDetailPage/useMediaTabNavigation';

function makeWrapper(initialPath: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>;
  };
}

const ORG = 'org-1';
const MEDIA = 'media-42';
const BASE = `/organizations/${ORG}/media/${MEDIA}`;

describe('useMediaTabNavigation', () => {
  it('defaults to inline `details` tab on the base route', () => {
    const { result } = renderHook(() => useMediaTabNavigation(ORG, MEDIA), {
      wrapper: makeWrapper(BASE),
    });
    expect(result.current.activeTab).toBe('details');
    expect(result.current.isOnSubRoute).toBe(false);
  });

  it('detects a sub-route tab from the URL (annotations)', () => {
    const { result } = renderHook(() => useMediaTabNavigation(ORG, MEDIA), {
      wrapper: makeWrapper(`${BASE}/annotations`),
    });
    expect(result.current.activeTab).toBe('annotations');
    expect(result.current.isOnSubRoute).toBe(true);
  });

  it('detects a sub-route tab from the URL (transform)', () => {
    const { result } = renderHook(() => useMediaTabNavigation(ORG, MEDIA), {
      wrapper: makeWrapper(`${BASE}/transform`),
    });
    expect(result.current.activeTab).toBe('transform');
    expect(result.current.isOnSubRoute).toBe(true);
  });

  it('goToTab switches inline tabs without navigating', () => {
    const { result } = renderHook(() => useMediaTabNavigation(ORG, MEDIA), {
      wrapper: makeWrapper(BASE),
    });

    act(() => {
      result.current.goToTab('metadata');
    });
    expect(result.current.activeTab).toBe('metadata');
    expect(result.current.isOnSubRoute).toBe(false);

    act(() => {
      result.current.goToTab('derivatives');
    });
    expect(result.current.activeTab).toBe('derivatives');
  });

  it('goToTab to a sub-route tab switches active tab to the sub-route', () => {
    const { result } = renderHook(() => useMediaTabNavigation(ORG, MEDIA), {
      wrapper: makeWrapper(BASE),
    });

    act(() => {
      result.current.goToTab('rights');
    });
    // After navigation, the hook re-reads location; activeTab becomes the sub-route
    expect(result.current.activeTab).toBe('rights');
    expect(result.current.isOnSubRoute).toBe(true);
  });

  it('goToTab from a sub-route to an inline tab navigates back to base', () => {
    const { result } = renderHook(() => useMediaTabNavigation(ORG, MEDIA), {
      wrapper: makeWrapper(`${BASE}/rights`),
    });
    expect(result.current.isOnSubRoute).toBe(true);

    act(() => {
      result.current.goToTab('details');
    });
    // Active tab becomes 'details' after returning to base route
    expect(result.current.activeTab).toBe('details');
    expect(result.current.isOnSubRoute).toBe(false);
  });

  it('returns inline default when URL does not start with basePath', () => {
    const { result } = renderHook(() => useMediaTabNavigation(ORG, MEDIA), {
      wrapper: makeWrapper('/some/other/path'),
    });
    expect(result.current.activeTab).toBe('details');
    expect(result.current.isOnSubRoute).toBe(false);
  });
});
