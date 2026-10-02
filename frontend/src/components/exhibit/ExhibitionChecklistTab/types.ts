// === Types ===
export type ChecklistPhase = 'planning' | 'pre_install' | 'install' | 'open' | 'close' | 'deinstall' | 'travel';
export type ChecklistItemStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'not_applicable';
export type ChecklistRole = 'curator' | 'registrar' | 'exhibitions_manager' | 'preparator' | 'conservation' | 'marketing' | 'education' | 'security' | 'facilities';

export interface ChecklistItem {
  item_id: string;
  phase: ChecklistPhase;
  title: string;
  description: string | null;
  responsible_role: ChecklistRole;
  assigned_user_id: string | null;
  assigned_user_name?: string | null;
  due_date: string | null;
  status: ChecklistItemStatus;
  notes: string | null;
  sort_order: number;
  links_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completed_by: string | null;
}

export interface ChecklistItemLink {
  link_id: string;
  linked_entity_type: string;
  linked_entity_id: string;
  entity_label?: string;
  created_at: string;
}

export interface ExhibitionChecklist {
  checklist_id: string;
  exhibition_id: string;
  template_version_id: string | null;
  name: string;
  items: ChecklistItem[];
  created_at: string;
  updated_at: string;
}

export interface ChecklistTemplate {
  template_id: string;
  name: string;
  description: string | null;
  exhibition_type: string;
  published_version_id: string | null;
  published_version_number: number | null;
}
