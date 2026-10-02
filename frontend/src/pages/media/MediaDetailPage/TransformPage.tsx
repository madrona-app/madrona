import { useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ImageCropEditor } from '../../../components/dam/ImageCropEditor';
import type { MediaDetailOutletContext } from './types';

export default function TransformPage() {
  const { organizationId, mediaId, media, setPreviewCollapsed } = useOutletContext<MediaDetailOutletContext>();

  useEffect(() => {
    setPreviewCollapsed(true);
    return () => setPreviewCollapsed(false);
  }, [setPreviewCollapsed]);

  if (media.media_type !== 'image' || !media.url) {
    return (
      <div className="p-4 sm:p-6">
        <div className="py-8 text-center text-sm text-archive">
          Image transform is only available for image files.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <ImageCropEditor
        organizationId={organizationId}
        mediaId={mediaId}
        imageUrl={media.preview_url || media.url}
        width={media.width || 0}
        height={media.height || 0}
      />
    </div>
  );
}
