import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Hash, Plus, Pencil, Trash2, GripVertical, Loader2, X } from 'lucide-react';
import Checkbox from '../Checkbox';
import ConfirmDialog from '../ConfirmDialog';
import {
  getOtherNumberTypes,
  createOtherNumberType,
  updateOtherNumberType,
  deleteOtherNumberType,
} from '../../lib/api';
import type { OtherNumberType } from '../../lib/schemas';
import { useToast } from '../../contexts/ToastContext';
import { ModalPortal } from '../ModalPortal';

interface OtherNumberTypesManagerProps {
  organizationId: string;
}

interface EditingType {
  type_id?: string;
  name: string;
  code: string;
  description: string;
  is_system?: boolean;
}

export function OtherNumberTypesManager({ organizationId }: OtherNumberTypesManagerProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EditingType | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OtherNumberType | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['other-number-types', organizationId, includeInactive],
    queryFn: () => getOtherNumberTypes(organizationId, { include_inactive: includeInactive }),
  });

  const createMutation = useMutation({
    mutationFn: (type: { name: string; code: string; description?: string }) =>
      createOtherNumberType(organizationId, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['other-number-types', organizationId] });
      setShowForm(false);
      setEditing(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { name?: string; code?: string; description?: string; is_active?: boolean } }) =>
      updateOtherNumberType(organizationId, id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['other-number-types', organizationId] });
      setShowForm(false);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOtherNumberType(organizationId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['other-number-types', organizationId] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    if (editing.type_id) {
      updateMutation.mutate({
        id: editing.type_id,
        updates: {
          name: editing.name,
          code: editing.code,
          description: editing.description || undefined,
        },
      });
    } else {
      createMutation.mutate({
        name: editing.name,
        code: editing.code,
        description: editing.description || undefined,
      });
    }
  };

  const handleEdit = (type: OtherNumberType) => {
    setEditing({
      type_id: type.type_id,
      name: type.name,
      code: type.code,
      description: type.description || '',
      is_system: type.is_system,
    });
    setShowForm(true);
  };

  const handleDelete = (type: OtherNumberType) => {
    if (type.is_system) {
      showToast({ type: 'error', title: 'Error', message: 'System types cannot be deleted.' });
      return;
    }
    setDeleteTarget(type);
  };

  const handleReactivate = (type: OtherNumberType) => {
    updateMutation.mutate({
      id: type.type_id,
      updates: { is_active: true },
    });
  };

  const types = data?.types || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash size={20} className="text-forest" />
          <h3 className="text-lg font-medium text-ink">Other Number Types</h3>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-accessible-gray">
            <Checkbox
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <button
            onClick={() => {
              setEditing({ name: '', code: '', description: '' });
              setShowForm(true);
            }}
            className="px-3 py-1.5 bg-forest text-parchment rounded-md text-sm flex items-center gap-1 hover:bg-forest/90"
          >
            <Plus size={16} />
            Add Type
          </button>
        </div>
      </div>

      {showForm && editing && (
        <ModalPortal>
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50">
          <div className="bg-parchment rounded-lg shadow-xl w-full max-w-md">
            <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
              <h4 className="font-medium text-ink">
                {editing.type_id ? 'Edit Number Type' : 'New Number Type'}
              </h4>
              <button onClick={() => setShowForm(false)} className="text-accessible-gray hover:text-ink">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Name</label>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g., Previous Accession Number"
                  className="w-full px-3 py-2 border border-stone rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Code</label>
                <input
                  type="text"
                  value={editing.code}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                  disabled={!!editing.type_id}
                  placeholder="e.g., previous_accession"
                  className="w-full px-3 py-2 border border-stone rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:bg-stone/50"
                  required
                />
                {!editing.type_id && (
                  <p className="text-xs text-accessible-gray mt-1">
                    Unique identifier (cannot be changed later)
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Description (optional)</label>
                <textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Help text for users"
                  className="w-full px-3 py-2 border border-stone rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-stone rounded-md text-ink hover:bg-stone/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 bg-forest text-parchment rounded-md flex items-center gap-2 hover:bg-forest/90 disabled:opacity-50"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 size={16} className="animate-spin" />
                  )}
                  {editing.type_id ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
        </ModalPortal>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={24} className="animate-spin text-accessible-gray" />
        </div>
      ) : types.length === 0 ? (
        <div className="text-center py-8 text-accessible-gray">
          <Hash size={40} className="mx-auto mb-2 opacity-50" />
          <p>No number types defined</p>
          <p className="text-sm">Create types to categorize alternate numbers on objects</p>
        </div>
      ) : (
        <div className="border border-lichen rounded-lg divide-y divide-lichen">
          {types.map((type) => (
            <div
              key={type.type_id}
              className={`flex items-center gap-3 px-4 py-3 ${!type.is_active ? 'bg-stone/30' : ''}`}
            >
              <div className="flex flex-col gap-1">
                <GripVertical size={14} className="text-accessible-gray" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{type.name}</span>
                  <code className="text-xs bg-stone px-1.5 py-0.5 rounded text-accessible-gray">{type.code}</code>
                  {type.is_system && (
                    <span className="text-xs bg-semantic-info/10 text-semantic-info px-1.5 py-0.5 rounded">System</span>
                  )}
                  {!type.is_active && (
                    <span className="text-xs bg-semantic-error/10 text-semantic-error px-1.5 py-0.5 rounded">Inactive</span>
                  )}
                </div>
                {type.description && (
                  <p className="text-sm text-accessible-gray truncate">{type.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!type.is_active ? (
                  <button
                    onClick={() => handleReactivate(type)}
                    className="p-2 text-accessible-gray hover:text-ink rounded"
                    title="Reactivate"
                  >
                    <Plus size={16} />
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => handleEdit(type)}
                      className="p-2 text-accessible-gray hover:text-ink rounded"
                      title="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    {!type.is_system && (
                      <button
                        onClick={() => handleDelete(type)}
                        className="p-2 text-accessible-gray hover:text-semantic-error rounded"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.type_id);
        }}
        title="Delete Number Type"
        message={`Are you sure you want to delete the "${deleteTarget?.name}" type?`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
