import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { MediaLibraryLinker, type LinkedMediaItem } from '../../../components/collections/MediaLibraryLinker';
import {
  listConstituentMedia,
  addConstituentMedia,
  removeConstituentMedia,
  setConstituentPrimaryMedia,
} from '../../../lib/api';
import { useAuth } from '../../../hooks/useAuth';

const USAGE_TYPES = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'headshot', label: 'Headshot' },
  { value: 'logo', label: 'Logo' },
  { value: 'official', label: 'Official Photo' },
  { value: 'other', label: 'Other' },
];

interface MediaSectionProps {
  organizationId: string;
  constituentId: string;
  isEditing: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  order: number;
  onCountChange?: (count: number) => void;
}

export function MediaSection({
  organizationId,
  constituentId,
  isEditing,
  isExpanded,
  onToggle,
  order,
  onCountChange,
}: MediaSectionProps) {
  const queryClient = useQueryClient();
  const { hasAppAccess } = useAuth();
  const hasMediaApp = hasAppAccess('media');

  const { data, isLoading } = useQuery({
    queryKey: ['constituent-media', organizationId, constituentId],
    queryFn: () => listConstituentMedia(organizationId, constituentId),
    enabled: !!organizationId && !!constituentId,
  });

  const linkedMedia: LinkedMediaItem[] = (data?.media || []).map((m) => ({
    link_id: `${m.constituent_id}-${m.media_id}`,
    media_id: m.media_id,
    is_primary: m.is_primary,
    caption_override: m.caption_override ?? undefined,
    usage_type: m.usage_type ?? undefined,
    media: {
      media_id: m.media_id,
      organization_id: organizationId,
      s3_key: '',
      file_size: 0,
      processing_status: 'completed',
      filename: m.filename,
      media_type: m.media_type,
      mime_type: m.mime_type ?? '',
      thumbnail_url: m.thumbnail_url,
      preview_url: m.preview_url,
      url: m.url,
      title: m.title,
    },
  }));

  useEffect(() => {
    onCountChange?.(linkedMedia.length);
  }, [linkedMedia.length, onCountChange]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['constituent-media', organizationId, constituentId] });
  };

  return (
    <WorkspaceSection
      id="media"
      title="Media"
      icon={<Image size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
      isEmpty={linkedMedia.length === 0}
    >
      <MediaLibraryLinker
        organizationId={organizationId}
        linkedMedia={linkedMedia}
        isLoading={isLoading}
        isEditing={isEditing}
        hasMediaApp={hasMediaApp}
        showPrimary
        usageTypes={USAGE_TYPES}
        title="Person and Organization Media"
        slideOverTitle="Link Media to Person or Organization"
        slideOverSubtitle="Search the media library to link photos"
        onLink={async (params) => {
          await addConstituentMedia(organizationId, constituentId, {
            media_id: params.media_id,
            is_primary: params.is_primary,
            usage_type: params.usage_type,
            caption_override: params.caption_override,
          });
          invalidate();
        }}
        onUnlink={async (linkId) => {
          const mediaId = linkId.split('-').pop()!;
          await removeConstituentMedia(organizationId, constituentId, mediaId);
          invalidate();
        }}
        onSetPrimary={async (linkId) => {
          const mediaId = linkId.split('-').pop()!;
          await setConstituentPrimaryMedia(organizationId, constituentId, mediaId);
          invalidate();
        }}
      />
    </WorkspaceSection>
  );
}
