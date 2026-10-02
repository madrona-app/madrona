/**
 * Tests for useCollectionObjectData and useMediaMutations.
 * Both depend on react-query + react-router; tests render through a wrapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '../../../lib/api';
import {
  useCollectionObjectData,
  useMediaMutations,
} from '../../../pages/collections/CollectionObjectWorkspacePage/hooks';
import { makeCollectionObject } from './fixtures';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>(
    '../../../lib/api',
  );
  return {
    ...actual,
    getCollectionObject: vi.fn(),
    getObjectValuations: vi.fn(),
    getObjectProcedures: vi.fn(),
    getObjectRights: vi.fn(),
    listObjectMedia: vi.fn(),
    linkMediaToObject: vi.fn(),
    unlinkMediaFromObject: vi.fn(),
    setObjectPrimaryMedia: vi.fn(),
    updateObjectMediaLink: vi.fn(),
  };
});

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockGetObject = vi.mocked(api.getCollectionObject);
const mockGetValuations = vi.mocked(api.getObjectValuations);
const mockGetProcedures = vi.mocked(api.getObjectProcedures);
const mockGetRights = vi.mocked(api.getObjectRights);
const mockListMedia = vi.mocked(api.listObjectMedia);
const mockLink = vi.mocked(api.linkMediaToObject);
const mockUnlink = vi.mocked(api.unlinkMediaFromObject);
const mockSetPrimary = vi.mocked(api.setObjectPrimaryMedia);
const mockUpdateLink = vi.mocked(api.updateObjectMediaLink);

function makeWrapper(orgId: string, objectId: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const path = objectId
    ? `/organizations/${orgId}/collections/objects/${objectId}`
    : `/organizations/${orgId}/collections/objects/new`;
  const route = objectId
    ? '/organizations/:orgId/collections/objects/:objectId'
    : '/organizations/:orgId/collections/objects/new';

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={<>{children}</>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

describe('useCollectionObjectData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetValuations.mockResolvedValue([]);
    mockGetProcedures.mockResolvedValue({ condition_reports: [], movements: [] } as never);
    mockGetRights.mockResolvedValue([] as never);
    mockListMedia.mockResolvedValue({ media: [] } as never);
  });

  it('returns isCreateMode=true when no objectId is in the URL', () => {
    const { Wrapper } = makeWrapper('org-1', null);
    const { result } = renderHook(() => useCollectionObjectData(), { wrapper: Wrapper });
    expect(result.current.isCreateMode).toBe(true);
    expect(result.current.objectId).toBeUndefined();
  });

  it('extracts orgId and objectId from the route', () => {
    const { Wrapper } = makeWrapper('org-42', 'obj-99');
    mockGetObject.mockResolvedValue(makeCollectionObject({ object_id: 'obj-99' }));
    const { result } = renderHook(() => useCollectionObjectData(), { wrapper: Wrapper });
    expect(result.current.orgId).toBe('org-42');
    expect(result.current.objectId).toBe('obj-99');
    expect(result.current.isCreateMode).toBe(false);
  });

  it('fetches the object via getCollectionObject', async () => {
    const { Wrapper } = makeWrapper('org-1', 'obj-1');
    const obj = makeCollectionObject({ object_id: 'obj-1', object_number: '2024.001' });
    mockGetObject.mockResolvedValue(obj);

    const { result } = renderHook(() => useCollectionObjectData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.object?.object_id).toBe('obj-1');
    });
    expect(mockGetObject).toHaveBeenCalledWith('org-1', 'obj-1');
  });

  it('does not fetch the object in create mode', () => {
    const { Wrapper } = makeWrapper('org-1', null);
    renderHook(() => useCollectionObjectData(), { wrapper: Wrapper });
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('fetches valuations / procedures / rights / media when an objectId is present', async () => {
    const { Wrapper } = makeWrapper('org-1', 'obj-1');
    mockGetObject.mockResolvedValue(makeCollectionObject({ object_id: 'obj-1' }));

    renderHook(() => useCollectionObjectData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(mockGetValuations).toHaveBeenCalledWith('org-1', 'obj-1');
      expect(mockGetProcedures).toHaveBeenCalledWith('org-1', 'obj-1');
      expect(mockGetRights).toHaveBeenCalledWith('org-1', 'obj-1');
      expect(mockListMedia).toHaveBeenCalledWith('org-1', 'obj-1');
    });
  });

  it('transforms listObjectMedia response into LinkedMediaItem shape', async () => {
    const { Wrapper } = makeWrapper('org-1', 'obj-1');
    mockGetObject.mockResolvedValue(makeCollectionObject({ object_id: 'obj-1' }));
    mockListMedia.mockResolvedValue({
      media: [
        {
          media_id: 'm-1',
          is_primary: true,
          caption_override: 'Front',
          usage_type: 'main',
          media: { media_id: 'm-1', filename: 'a.jpg' },
        } as never,
      ],
    } as never);

    const { result } = renderHook(() => useCollectionObjectData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.linkedMedia.length).toBe(1);
    });
    const item = result.current.linkedMedia[0];
    expect(item.media_id).toBe('m-1');
    expect(item.is_primary).toBe(true);
    expect(item.caption_override).toBe('Front');
    expect(item.usage_type).toBe('main');
  });

  it('exposes isLoading=true while the object query is pending', () => {
    const { Wrapper } = makeWrapper('org-1', 'obj-1');
    mockGetObject.mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useCollectionObjectData(), { wrapper: Wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('surfaces errors from the object query', async () => {
    const { Wrapper } = makeWrapper('org-1', 'obj-1');
    mockGetObject.mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => useCollectionObjectData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });
});

describe('useMediaMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setup() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    return { Wrapper, queryClient };
  }

  it('linkMediaMutation calls linkMediaToObject with the right params', async () => {
    const { Wrapper, queryClient } = setup();
    mockLink.mockResolvedValue({} as never);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useMediaMutations('org-1', 'obj-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.linkMediaMutation.mutateAsync({
        media_id: 'm-1',
        usage_type: 'main',
      });
    });

    expect(mockLink).toHaveBeenCalledWith('org-1', 'obj-1', {
      media_id: 'm-1',
      usage_type: 'main',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['object-media', 'org-1', 'obj-1'],
    });
  });

  it('unlinkMediaMutation calls unlinkMediaFromObject', async () => {
    const { Wrapper } = setup();
    mockUnlink.mockResolvedValue({} as never);

    const { result } = renderHook(() => useMediaMutations('org-1', 'obj-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.unlinkMediaMutation.mutateAsync('m-99');
    });

    expect(mockUnlink).toHaveBeenCalledWith('org-1', 'obj-1', 'm-99');
  });

  it('setPrimaryMediaMutation calls setObjectPrimaryMedia', async () => {
    const { Wrapper } = setup();
    mockSetPrimary.mockResolvedValue({} as never);

    const { result } = renderHook(() => useMediaMutations('org-1', 'obj-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.setPrimaryMediaMutation.mutateAsync('m-2');
    });

    expect(mockSetPrimary).toHaveBeenCalledWith('org-1', 'obj-1', 'm-2');
  });

  it('updateMediaLinkMutation calls updateObjectMediaLink with merged updates', async () => {
    const { Wrapper } = setup();
    mockUpdateLink.mockResolvedValue({} as never);

    const { result } = renderHook(() => useMediaMutations('org-1', 'obj-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.updateMediaLinkMutation.mutateAsync({
        mediaId: 'm-3',
        updates: { caption_override: 'New caption' },
      });
    });

    expect(mockUpdateLink).toHaveBeenCalledWith('org-1', 'obj-1', 'm-3', {
      caption_override: 'New caption',
    });
  });
});
