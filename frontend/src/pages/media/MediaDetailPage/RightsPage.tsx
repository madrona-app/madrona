import { useOutletContext } from 'react-router-dom';
import { RightsTabContent } from './RightsTabContent';
import type { MediaDetailOutletContext } from './types';

export default function RightsPage() {
  const ctx = useOutletContext<MediaDetailOutletContext>();

  return (
    <RightsTabContent
      organizationId={ctx.organizationId}
      mediaId={ctx.mediaId}
      media={ctx.media}
      rightsStatus={ctx.rightsStatus}
      usageStats={ctx.usageStats}
      queryClient={ctx.queryClient}
      reviewMetadataMutation={ctx.reviewMetadataMutation}
      clearReviewMutation={ctx.clearReviewMutation}
    />
  );
}
