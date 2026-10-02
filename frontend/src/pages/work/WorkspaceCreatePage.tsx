/**
 * WorkspaceCreatePage - Create a new Work Set
 *
 * Work Sets are operational groupings for bulk operations and team collaboration.
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, ChevronLeft, Globe, Lock, Users } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useActiveProduct } from '../../hooks/useActiveProduct';
import { cn } from '../../lib/utils';
import { createWorkspace } from '../../lib/api';

export default function WorkspaceCreatePage() {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProductId } = useActiveProduct();
  const workspaceType = activeProductId === 'media' ? 'media' : 'collections';
  const workSegment = activeProductId === 'media' ? 'media' : 'collections';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'shared' | 'org'>('private');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createWorkspace(orgId!, { name, description, visibility, workspace_type: workspaceType }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['media-workspaces'] });
      navigate(`/organizations/${orgId}/${workSegment}/work/workspaces/${data.workspace_id}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create work set');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setError(null);
    createMutation.mutate();
  };

  const visibilityOptions = [
    {
      value: 'private' as const,
      label: 'Private',
      description: 'Only you can see this work set',
      icon: Lock,
    },
    {
      value: 'shared' as const,
      label: 'Shared',
      description: 'Share with specific users',
      icon: Users,
    },
    {
      value: 'org' as const,
      label: 'Organization',
      description: 'All organization members can see',
      icon: Globe,
    },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link
          to={`/organizations/${orgId}/${workSegment}/work/workspaces`}
          className="flex items-center gap-1 text-archive hover:text-bark"
        >
          <ChevronLeft size={16} />
          Work Sets
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-bark/10 rounded-lg">
          <Layers size={24} className="text-bark" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-ink">New Work Set</h1>
          <p className="text-sm text-archive">
            Group objects for bulk operations and team collaboration
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {/* Name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-ink mb-1">
            Name <span className="text-semantic-error">*</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Q1 Loan Exhibition Objects"
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-ink mb-1">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description of what this work set is for..."
            rows={3}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>

        {/* Visibility */}
        <div>
          <label className="block text-sm font-medium text-ink mb-2">
            Visibility
          </label>
          <div className="space-y-2">
            {visibilityOptions.map((option) => {
              const Icon = option.icon;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors',
                    visibility === option.value
                      ? 'border-bark bg-bark/5'
                      : 'border-lichen hover:border-bark/30'
                  )}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={option.value}
                    checked={visibility === option.value}
                    onChange={(e) => setVisibility(e.target.value as typeof visibility)}
                    className="sr-only"
                  />
                  <div className={cn(
                    'p-2 rounded-lg',
                    visibility === option.value ? 'bg-bark/10' : 'bg-stone/30'
                  )}>
                    <Icon size={18} className={visibility === option.value ? 'text-bark' : 'text-archive'} />
                  </div>
                  <div>
                    <div className="font-medium text-ink">{option.label}</div>
                    <div className="text-sm text-archive">{option.description}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-lichen">
          <Link
            to={`/organizations/${orgId}/${workSegment}/work/workspaces`}
            className="px-4 py-2 text-sm text-archive hover:text-ink"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Work Set'}
          </button>
        </div>
      </form>
    </div>
  );
}
