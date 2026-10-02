import type { LucideIcon } from 'lucide-react';
import {
  Clock,
  CheckCircle,
  Stamp,
  Archive,
  Gift,
  ShoppingCart,
  Building2,
  Repeat,
} from 'lucide-react';

export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  proposed: { label: 'Proposed', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  approved: { label: 'Approved', color: 'bg-forest/10 text-forest', icon: CheckCircle },
  completed: { label: 'Completed', color: 'bg-semantic-success/10 text-semantic-success', icon: Stamp },
  cancelled: { label: 'Cancelled', color: 'bg-stone text-archive', icon: Archive },
};

export const WORKFLOW_STEPS = [
  { key: 'proposed', label: 'Proposed' },
  { key: 'approved', label: 'Approved' },
  { key: 'completed', label: 'Completed' },
];

export function getStepIndex(status: string): number {
  if (status === 'cancelled') return -1;
  const idx = WORKFLOW_STEPS.findIndex(s => s.key === status);
  return idx >= 0 ? idx : 0;
}

export const METHOD_ICONS: Record<string, LucideIcon> = {
  gift: Gift,
  purchase: ShoppingCart,
  bequest: Archive,
  transfer: Building2,
  exchange: Repeat,
};
