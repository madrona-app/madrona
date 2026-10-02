import type { QueryClient } from '@tanstack/react-query';
import type { MediaRightsRecord } from '../../../lib/api';

// Rights status computation
export type RightsStatus = 'ready' | 'restricted' | 'incomplete' | 'blocked';

export interface RightsStatusInfo {
  status: RightsStatus;
  label: string;
  description: string;
  dotColor: string;
  bgColor: string;
  textColor: string;
}

export function computeRightsStatus(rights: MediaRightsRecord[]): RightsStatusInfo {
  const activeRights = rights.filter(r => r.is_active);

  if (activeRights.length === 0) {
    return {
      status: 'incomplete',
      label: 'Rights incomplete',
      description: 'Add copyright or license information',
      dotColor: 'bg-archive',
      bgColor: 'bg-stone/30',
      textColor: 'text-archive',
    };
  }

  const now = new Date();
  const hasExpired = activeRights.some(r => r.end_date && new Date(r.end_date) < now);
  if (hasExpired) {
    return {
      status: 'blocked',
      label: 'Rights expired',
      description: 'One or more rights have expired',
      dotColor: 'bg-semantic-error',
      bgColor: 'bg-semantic-error/10',
      textColor: 'text-semantic-error',
    };
  }

  const restrictions = activeRights.filter(r => r.rights_type === 'restriction');
  const hasRestrictions = restrictions.length > 0 ||
    activeRights.some(r => r.usage_restrictions && r.usage_restrictions.length > 0);

  if (hasRestrictions) {
    const restrictionLabels = [
      ...restrictions.map(r => r.rights_statement || 'Restriction'),
      ...activeRights.flatMap(r => r.usage_restrictions || []),
    ].slice(0, 2);

    return {
      status: 'restricted',
      label: 'Restrictions apply',
      description: restrictionLabels.join(', ') || 'Usage restrictions in place',
      dotColor: 'bg-semantic-warning',
      bgColor: 'bg-semantic-warning/10',
      textColor: 'text-semantic-warning',
    };
  }

  const rightsCount = activeRights.length;
  return {
    status: 'ready',
    label: 'Ready to use',
    description: `${rightsCount} rights record${rightsCount !== 1 ? 's' : ''} • No restrictions`,
    dotColor: 'bg-semantic-success',
    bgColor: 'bg-semantic-success/10',
    textColor: 'text-semantic-success',
  };
}

export const DERIVATIVE_PURPOSE: Record<string, { label: string; description: string }> = {
  thumbnail: { label: 'Thumbnail', description: 'Grid and list previews' },
  preview: { label: 'Preview', description: 'Detail page display' },
  web: { label: 'Web', description: 'Website and publishing' },
  medium: { label: 'Medium', description: 'Web and email' },
  small: { label: 'Small', description: 'Compact previews' },
  square_thumb: { label: 'Square Thumbnail', description: 'Social media, profiles' },
  large: { label: 'Large', description: 'High-resolution display' },
  watermarked: { label: 'Watermarked', description: 'External sharing with attribution' },
  original: { label: 'Original', description: 'Full resolution archive' },
};

/** Outlet context passed from layout to sub-route pages */
export interface MediaDetailOutletContext {
  organizationId: string;
  mediaId: string;
  media: any;
  rightsStatus: RightsStatusInfo;
  setPreviewCollapsed: (v: boolean) => void;
  queryClient: QueryClient;
  usageStats: any;
  reviewMetadataMutation: any;
  clearReviewMutation: any;
}

/** Inline tabs (rendered in-place) vs sub-route tabs (rendered via Outlet) */
export type InlineTabKey = 'details' | 'derivatives' | 'metadata' | 'alternatives' | 'discussion';
export type SubRouteTabKey = 'annotations' | 'transform' | 'rights' | 'preservation' | 'ai' | 'history';
export type TabKey = InlineTabKey | SubRouteTabKey;

export const SUB_ROUTE_TABS: Record<SubRouteTabKey, string> = {
  annotations: 'annotations',
  transform: 'transform',
  rights: 'rights',
  preservation: 'preservation',
  ai: 'ai',
  history: 'history',
};
