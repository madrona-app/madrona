import type { ObjectPersonAuthority } from '../../../lib/schemas';

export interface ObjectAuthoritiesManagerProps {
  organizationId: string;
  objectId: string;
  readOnly?: boolean;
  embedded?: boolean;
}

export interface AddAuthoritySlideOverProps {
  isOpen: boolean;
  organizationId: string;
  objectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export interface EditAuthoritySlideOverProps {
  isOpen: boolean;
  organizationId: string;
  objectId: string;
  link: ObjectPersonAuthority | null;
  onClose: () => void;
  onSuccess: () => void;
}
