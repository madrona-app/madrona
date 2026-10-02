import type { LucideIcon } from 'lucide-react';
import { Clock, ArrowRightLeft, CheckCircle, Archive } from 'lucide-react';
import type { MovementFormData } from './types';

export const MOVEMENT_REASON_OPTIONS = [
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'storage', label: 'Storage' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'loan', label: 'Loan' },
  { value: 'photography', label: 'Photography' },
  { value: 'research', label: 'Research' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'rearrangement', label: 'Rearrangement' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'security', label: 'Security' },
  { value: 'access_request', label: 'Access Request' },
  { value: 'other', label: 'Other' },
];

export const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const STATUS_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  pending: { label: 'Pending', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  in_transit: { label: 'In Transit', color: 'bg-copper/10 text-copper', icon: ArrowRightLeft },
  completed: { label: 'Completed', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-stone text-archive', icon: Archive },
};

export const MOVEMENT_METHOD_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'hand_carried', label: 'Hand Carried' },
  { value: 'cart', label: 'Cart / Trolley' },
  { value: 'forklift', label: 'Forklift' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'courier', label: 'Courier' },
];

export const SHIPPING_METHOD_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'ground', label: 'Ground' },
  { value: 'air', label: 'Air' },
  { value: 'sea', label: 'Sea' },
];

export const LOCATION_FITNESS_OPTIONS = [
  { value: '', label: 'Not assessed' },
  { value: 'suitable', label: 'Suitable' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'unsuitable', label: 'Unsuitable' },
];

export const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'GBP', label: 'GBP' },
  { value: 'EUR', label: 'EUR' },
  { value: 'CAD', label: 'CAD' },
  { value: 'AUD', label: 'AUD' },
];

export const DEFAULT_FORM_DATA: MovementFormData = {
  object_id: '',
  reason: 'storage',
  from_location_id: '',
  to_location_id: '',
  movement_date: new Date().toISOString().split('T')[0],
  status: 'completed',
  movement_note: '',
  handler_id: '',
  handler_name: '',
  // Authorization
  authorizer_id: '',
  authorization_date: '',
  authorization_note: '',
  // Shipping & Courier
  movement_method: '',
  organization_courier: false,
  courier_name: '',
  shipper_id: '',
  shipper_name: '',
  shipping_method: '',
  shipping_tracking_number: '',
  shipping_insurance_value: '',
  shipping_insurance_currency: '',
  shipping_note: '',
  // Condition
  condition_note: '',
  condition_report_id: '',
  // Planning
  location_fitness: '',
  planned_removal_date: '',
  planned_return_date: '',
};
