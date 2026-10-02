import type { LucideIcon } from 'lucide-react';
import {
  Clock,
  Package,
  Send,
  Truck,
  CheckCircle,
  FileX,
} from 'lucide-react';
import type { FormData } from './types';

export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  pending: { label: 'Pending', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  preparing: { label: 'Preparing', color: 'bg-copper/10 text-copper', icon: Package },
  dispatched: { label: 'Dispatched', color: 'bg-bark/10 text-bark', icon: Send },
  in_transit: { label: 'In Transit', color: 'bg-forest/10 text-forest', icon: Truck },
  acknowledged: { label: 'Acknowledged', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-stone text-archive', icon: FileX },
};

export const WORKFLOW_STEPS = [
  { key: 'pending', label: 'Pending' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'acknowledged', label: 'Acknowledged' },
];

export const DEFAULT_FORM_DATA: FormData = {
  exit_date: '',
  exit_reason: 'other',
  exit_method: '',
  recipient_name: '',
  packing_method: '',
  shipping_method: '',
  shipping_company: '',
  tracking_number: '',
  courier_id: '',
  condition_at_exit: '',
  authorization_date: '',
  authorization_note: '',
  receipt_reference: '',
  receipt_note: '',
  exit_note: '',
  internal_note: '',
};
