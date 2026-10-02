import { createContext } from 'react';

export interface OrganizationMembership {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_timezone: string;
  role: string;
}

export interface OrgContextValue {
  activeOrganizationId: string | null;
  activeOrganization: OrganizationMembership | null;
  organizations: OrganizationMembership[];
  setActiveOrganizationId: (orgId: string) => Promise<void>;
  refreshOrganizations: () => void;
  isLoading: boolean;
  error: Error | null;
}

export const OrgContext = createContext<OrgContextValue | undefined>(undefined);
