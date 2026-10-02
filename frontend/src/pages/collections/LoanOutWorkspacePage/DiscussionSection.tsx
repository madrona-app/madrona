import { MessageSquare } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { RecordDiscussionTab } from '../../../components/RecordDiscussionTab';

interface DiscussionSectionProps {
  loanId: string;
  organizationId: string;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
}

export function DiscussionSection({
  loanId,
  organizationId,
  isExpanded,
  isEditing,
  order,
  onToggle,
}: DiscussionSectionProps) {
  return (
    <WorkspaceSection
      id="discussion"
      title="Discussion"
      icon={<MessageSquare size={20} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      <RecordDiscussionTab
        entityType="loan_out"
        entityId={loanId}
        organizationId={organizationId}
      />
    </WorkspaceSection>
  );
}
