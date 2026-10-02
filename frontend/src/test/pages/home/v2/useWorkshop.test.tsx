import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useWorkshop } from '../../../../pages/home/v2/useWorkshop';

const { useAuthMock, getWorkshopCountsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getWorkshopCountsMock: vi.fn(),
}));

vi.mock('../../../../hooks/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('../../../../lib/api', () => ({
  getWorkshopCounts: getWorkshopCountsMock,
}));
vi.mock('../../../../hooks/useActiveProduct', () => ({
  getProductLandingPath: (key: string, orgId: string) =>
    `/organizations/${orgId}/${key}`,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useWorkshop', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    getWorkshopCountsMock.mockReset();
  });

  it('returns empty list when no orgId', () => {
    useAuthMock.mockReturnValue({ applications: [] });
    const { result } = renderHook(() => useWorkshop(undefined), { wrapper });
    expect(result.current).toEqual([]);
  });

  it('orders apps as guide → collections → media → content → bridge', async () => {
    useAuthMock.mockReturnValue({
      applications: [
        { key: 'bridge', display_name: 'Bridge', enabled: true, status: 'active' },
        { key: 'collections', display_name: 'Collections', enabled: true, status: 'active' },
        { key: 'guide', display_name: 'Guide', enabled: true, status: 'active' },
        { key: 'content', display_name: 'Content', enabled: true, status: 'active' },
        { key: 'media', display_name: 'Media', enabled: true, status: 'active' },
      ],
    });
    getWorkshopCountsMock.mockResolvedValue({
      bridge_running: 0,
      collections_records: 0,
      guide_active_conversations: 0,
      content_drafts: 0,
      media_assets: 0,
    });

    const { result } = renderHook(() => useWorkshop('org-1'), { wrapper });
    await waitFor(() => expect(result.current.length).toBe(5));
    expect(result.current.map((a) => a.key)).toEqual([
      'guide',
      'collections',
      'media',
      'content',
      'bridge',
    ]);
  });

  it('skips apps that are disabled or not active', async () => {
    useAuthMock.mockReturnValue({
      applications: [
        { key: 'bridge', display_name: 'Bridge', enabled: false, status: 'active' },
        { key: 'collections', display_name: 'Collections', enabled: true, status: 'active' },
        { key: 'guide', display_name: 'Guide', enabled: true, status: 'coming_soon' },
      ],
    });
    getWorkshopCountsMock.mockResolvedValue({
      bridge_running: 0,
      collections_records: 0,
      guide_active_conversations: 0,
      content_drafts: 0,
      media_assets: 0,
    });

    const { result } = renderHook(() => useWorkshop('org-1'), { wrapper });
    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0].key).toBe('collections');
  });

  it('formats counts: < 1000 raw, < 10k with decimal, ≥ 10k rounded thousands', async () => {
    useAuthMock.mockReturnValue({
      applications: [
        { key: 'collections', display_name: 'Collections', enabled: true, status: 'active' },
        { key: 'media', display_name: 'Media', enabled: true, status: 'active' },
      ],
    });
    getWorkshopCountsMock.mockResolvedValue({
      bridge_running: 0,
      collections_records: 12847,
      guide_active_conversations: 0,
      content_drafts: 0,
      media_assets: 1247,
    });

    const { result } = renderHook(() => useWorkshop('org-1'), { wrapper });
    await waitFor(() => {
      const collections = result.current.find((a) => a.key === 'collections');
      expect(collections?.statusLine).toBe('13k records');
    });
    const media = result.current.find((a) => a.key === 'media');
    expect(media?.statusLine).toBe('1.2k assets');
  });

  it('marks bridge active when imports are running', async () => {
    useAuthMock.mockReturnValue({
      applications: [
        { key: 'bridge', display_name: 'Bridge', enabled: true, status: 'active' },
      ],
    });
    getWorkshopCountsMock.mockResolvedValue({
      bridge_running: 2,
      collections_records: 0,
      guide_active_conversations: 0,
      content_drafts: 0,
      media_assets: 0,
    });

    const { result } = renderHook(() => useWorkshop('org-1'), { wrapper });
    await waitFor(() => {
      expect(result.current[0]?.statusLine).toBe('2 imports running');
    });
    expect(result.current[0]?.isActive).toBe(true);
  });

  it('singularizes phrasing for n=1', async () => {
    useAuthMock.mockReturnValue({
      applications: [
        { key: 'bridge', display_name: 'Bridge', enabled: true, status: 'active' },
        { key: 'guide', display_name: 'Guide', enabled: true, status: 'active' },
        { key: 'content', display_name: 'Content', enabled: true, status: 'active' },
      ],
    });
    getWorkshopCountsMock.mockResolvedValue({
      bridge_running: 1,
      collections_records: 0,
      guide_active_conversations: 1,
      content_drafts: 1,
      media_assets: 0,
    });

    const { result } = renderHook(() => useWorkshop('org-1'), { wrapper });
    await waitFor(() => {
      const bridge = result.current.find((a) => a.key === 'bridge');
      expect(bridge?.statusLine).toBe('1 import running');
    });
    expect(result.current.find((a) => a.key === 'guide')?.statusLine).toBe(
      'Handling 1 conversation now',
    );
    expect(result.current.find((a) => a.key === 'content')?.statusLine).toBe(
      '1 draft',
    );
  });
});
