import {
  Circle,
  Clock,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import type { ChecklistPhase, ChecklistItemStatus, ChecklistRole } from './types';

// === Constants ===
export const PHASE_CONFIG: Record<ChecklistPhase, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'bg-semantic-info/10 text-semantic-info' },
  pre_install: { label: 'Pre-Install', color: 'bg-forest/10 text-forest' },
  install: { label: 'Install', color: 'bg-semantic-warning/10 text-semantic-warning' },
  open: { label: 'Open', color: 'bg-semantic-success/10 text-semantic-success' },
  close: { label: 'Close', color: 'bg-semantic-warning/10 text-semantic-warning' },
  deinstall: { label: 'Deinstall', color: 'bg-semantic-error/10 text-semantic-error' },
  travel: { label: 'Travel', color: 'bg-bark/10 text-bark' },
};

export const STATUS_CONFIG: Record<ChecklistItemStatus, { label: string; icon: typeof Circle; color: string; bgColor: string }> = {
  todo: { label: 'To Do', icon: Circle, color: 'text-archive', bgColor: 'bg-stone' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'text-semantic-info', bgColor: 'bg-semantic-info/10' },
  blocked: { label: 'Blocked', icon: AlertTriangle, color: 'text-semantic-warning', bgColor: 'bg-semantic-warning/10' },
  done: { label: 'Done', icon: CheckCircle2, color: 'text-semantic-success', bgColor: 'bg-semantic-success/10' },
  not_applicable: { label: 'N/A', icon: X, color: 'text-archive', bgColor: 'bg-stone' },
};

export const ROLE_LABELS: Record<ChecklistRole, string> = {
  curator: 'Curator',
  registrar: 'Registrar',
  exhibitions_manager: 'Exhibitions Manager',
  preparator: 'Preparator',
  conservation: 'Conservation',
  marketing: 'Marketing',
  education: 'Education',
  security: 'Security',
  facilities: 'Facilities',
};

export const PHASE_ORDER: ChecklistPhase[] = ['planning', 'pre_install', 'install', 'open', 'close', 'deinstall', 'travel'];
