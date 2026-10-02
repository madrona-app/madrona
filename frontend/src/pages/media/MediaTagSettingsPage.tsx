import { useParams } from 'react-router-dom';
import { Tag } from 'lucide-react';
import { TagDefinitionsManager } from '../../components/dam';

export default function MediaTagSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();

  if (!orgId) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-md p-4 text-semantic-error">
          Organization ID is required
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-forest/10 rounded-lg">
          <Tag size={24} className="text-forest" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Tag Settings</h1>
          <p className="text-stone-500">
            Define tags that can be assigned to media items for organization and filtering
          </p>
        </div>
      </div>

      {/* Help Text */}
      <div className="bg-parchment border border-stone-200 rounded-lg p-4">
        <h3 className="font-medium text-stone-900 mb-2">How Tags Work</h3>
        <ul className="text-sm text-stone-600 space-y-1">
          <li>- Create tag definitions (e.g., "Location", "Project", "Event") that are available across your organization</li>
          <li>- Users can assign values to these tags on individual media items</li>
          <li>- Tags are searchable and can be used to filter media in the library</li>
          <li>- Required tags help ensure consistent metadata across your media library</li>
        </ul>
      </div>

      {/* Tag Definitions Manager */}
      <div className="bg-parchment border border-stone-200 rounded-lg p-6">
        <TagDefinitionsManager organizationId={orgId} />
      </div>
    </div>
  );
}
