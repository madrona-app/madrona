/**
 * Composable hook that provides the standard scaffolding for workspace pages.
 *
 * Centralizes the boilerplate that every workspace page needs:
 * - Agent chat entity context registration
 * - Dialog state management (delete, create task)
 * - Edit mode state (clamped by canEdit so viewers can never edit)
 * - Create vs edit mode detection
 * - Permission checking
 * - Field-level access restrictions
 *
 * Does NOT manage form data or section state — those remain page-specific
 * because each entity has unique fields and sections.
 *
 * @example
 * const wp = useWorkspacePage({
 *   entityType: 'loan_out',
 *   entityId: loanId,
 *   entityLabel: existingLoan?.loan_number,
 *   orgId,
 *   editPermission: 'loans.edit',
 *   restrictedFields: existingLoan?._restricted_fields,
 *   additionalEditGuard: !isStatusLocked,
 * });
 * const { isEditing, canEdit, isRestricted, hasPermission } = wp;
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAgentChatContext } from '../contexts/AgentChatContext';
import { usePageContext } from '../contexts/PageContext';
import { usePermissions } from './usePermissions';
import { useFieldAccess } from './useFieldAccess';

export interface UseWorkspacePageConfig {
  /** The entity type for agent chat context (e.g., 'movement', 'loan_in') */
  entityType: string;
  /** The entity ID (undefined in create mode) */
  entityId: string | undefined;
  /** Display label for agent chat context */
  entityLabel: string | undefined;
  /** Organization ID */
  orgId: string | undefined;
  /** Permission key for editing (e.g., 'loans.edit'). When provided, canEdit is computed automatically. */
  editPermission?: string;
  /** Restricted fields from the API response (_restricted_fields array) */
  restrictedFields?: string[];
  /** External canEdit override — use when the page computes canEdit itself (legacy support) */
  canEdit?: boolean;
}

export interface UseWorkspacePageResult {
  /** Whether we're in create mode (no entity ID) */
  isCreateMode: boolean;
  /** Whether the page is currently in edit mode (clamped by canEdit — safe to pass to EditableField) */
  isEditing: boolean;
  /** Set edit mode state */
  setIsEditing: (editing: boolean) => void;
  /** Whether to use the new layout (section groups) */
  useNewLayout: boolean;
  /** Whether the user has permission to edit this entity */
  canEdit: boolean;
  /** Check if a field is restricted by role-based field access */
  isRestricted: (fieldPath: string) => boolean;
  /** Whether any field restrictions are active */
  hasRestrictions: boolean;
  /** Dialog visibility states */
  dialogs: {
    showDeleteConfirm: boolean;
    setShowDeleteConfirm: (show: boolean) => void;
    showCreateTask: boolean;
    setShowCreateTask: (show: boolean) => void;
  };
  /** Permission checker */
  hasPermission: (permission: string) => boolean;
}

export function useWorkspacePage(config: UseWorkspacePageConfig): UseWorkspacePageResult {
  const { entityType, entityId, entityLabel, orgId: _orgId } = config;
  const [searchParams] = useSearchParams();
  const { hasPermission } = usePermissions();
  const { isRestricted, hasRestrictions } = useFieldAccess(config.restrictedFields);

  const isCreateMode = !entityId;
  const [rawIsEditing, setIsEditing] = useState(true);
  const useNewLayout = searchParams.get('layout') !== 'classic' && !isCreateMode;

  // Compute canEdit purely from permission — status locks are handled by workflows, not edit guards
  let canEdit: boolean;
  if (config.canEdit !== undefined) {
    canEdit = config.canEdit;
  } else if (config.editPermission) {
    canEdit = isCreateMode || hasPermission(config.editPermission);
  } else {
    canEdit = true;
  }

  // Clamp isEditing by canEdit so viewers/locked entities can never show editable fields
  const isEditing = rawIsEditing && canEdit;

  // Dialog states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);

  // Agent chat context (legacy — kept for existing consumers)
  const { setEntityContext } = useAgentChatContext();
  useEffect(() => {
    if (entityId && entityLabel) {
      setEntityContext({
        type: entityType,
        id: entityId,
        label: entityLabel,
      });
    }
    return () => setEntityContext(null);
  }, [entityId, entityLabel, entityType, setEntityContext]);

  // Per-turn page context for the agent — entity + editMode (workflow is
  // pushed separately by ProcedureRequirementsCard where applicable).
  const { setPageContext, clearEntityContext } = usePageContext();
  useEffect(() => {
    if (entityId && entityLabel) {
      setPageContext({
        entity: { type: entityType, id: entityId, label: entityLabel },
      });
    }
    return () => clearEntityContext();
  }, [entityId, entityLabel, entityType, setPageContext, clearEntityContext]);

  useEffect(() => {
    setPageContext({ editMode: isEditing });
  }, [isEditing, setPageContext]);

  return {
    isCreateMode,
    isEditing,
    setIsEditing,
    useNewLayout,
    canEdit,
    isRestricted,
    hasRestrictions,
    dialogs: {
      showDeleteConfirm,
      setShowDeleteConfirm,
      showCreateTask,
      setShowCreateTask,
    },
    hasPermission,
  };
}
