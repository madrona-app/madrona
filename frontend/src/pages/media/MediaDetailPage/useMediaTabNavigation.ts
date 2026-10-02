import { useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { TabKey, InlineTabKey, SubRouteTabKey } from './types';
import { SUB_ROUTE_TABS } from './types';

export function useMediaTabNavigation(orgId: string, mediaId: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const [inlineTab, setInlineTab] = useState<InlineTabKey>('details');

  const basePath = `/organizations/${orgId}/media/${mediaId}`;

  // Determine active sub-route from URL
  const pathAfterBase = location.pathname.startsWith(basePath)
    ? location.pathname.slice(basePath.length).replace(/^\//, '')
    : '';
  const activeSubRoute = (Object.keys(SUB_ROUTE_TABS) as SubRouteTabKey[]).find(
    key => pathAfterBase === SUB_ROUTE_TABS[key]
  ) || null;

  const activeTab: TabKey = activeSubRoute || inlineTab;
  const isOnSubRoute = activeSubRoute !== null;

  const goToTab = useCallback((key: TabKey) => {
    if (key in SUB_ROUTE_TABS) {
      navigate(`${basePath}/${SUB_ROUTE_TABS[key as SubRouteTabKey]}`);
    } else {
      // Navigate to base route if currently on a sub-route
      if (isOnSubRoute) {
        navigate(basePath);
      }
      setInlineTab(key as InlineTabKey);
    }
  }, [navigate, basePath, isOnSubRoute]);

  return { activeTab, goToTab, isOnSubRoute };
}
