import { useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AnnotationEditorTab } from '../../../components/dam/AnnotationEditorTab';
import type { MediaDetailOutletContext } from './types';

export default function AnnotationsPage() {
  const { organizationId, mediaId, media, setPreviewCollapsed } = useOutletContext<MediaDetailOutletContext>();

  useEffect(() => {
    setPreviewCollapsed(true);
    return () => setPreviewCollapsed(false);
  }, [setPreviewCollapsed]);

  if (media.media_type !== 'image') {
    return (
      <div className="p-4 sm:p-6">
        <div className="py-8 text-center text-sm text-archive">
          Annotations are only available for image files.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <AnnotationEditorTab
        organizationId={organizationId}
        mediaId={mediaId}
        imageUrl={media.url || media.preview_url}
        mediaType={media.media_type}
      />
    </div>
  );
}
