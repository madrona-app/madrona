import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { SectionGroup } from '@/components/record-detail/SectionNav';
import { listLayoutOverrides } from '@/lib/api/layoutOverrides';

import { layoutView, type LayoutView } from './resolveLayout';

/**
 * Fetch the user's active layout variant for a surface and apply it over the
 * base layout. Returns the resolved groups + an `isHidden` predicate. With no
 * active variant (or while loading), this is the base layout unchanged.
 */
export function useResolvedLayout(
  base: SectionGroup[],
  surfaceKey: string,
  objectType?: string | null
): LayoutView {
  const { data } = useQuery({
    queryKey: ['layout-overrides', surfaceKey, objectType ?? null],
    queryFn: () =>
      listLayoutOverrides({ surfaceKey, objectType: objectType ?? undefined }),
    staleTime: 5 * 60 * 1000,
  });

  const delta = useMemo(
    () => data?.find((o) => o.is_active)?.delta ?? null,
    [data]
  );

  return useMemo(() => layoutView(base, delta), [base, delta]);
}
