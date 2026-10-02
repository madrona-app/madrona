import { useOutletContext } from 'react-router-dom';
import MediaPreservationTab from '../../../components/dam/MediaPreservationTab';
import type { MediaDetailOutletContext } from './types';

export default function PreservationPage() {
  const { organizationId, mediaId, media } = useOutletContext<MediaDetailOutletContext>();

  return (
    <MediaPreservationTab
      organizationId={organizationId}
      mediaId={mediaId}
      formatName={media.format_name}
      pronomPuid={media.pronom_puid}
      formatRiskLevel={media.format_risk_level}
    />
  );
}
