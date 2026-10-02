/**
 * downloadWithFilename - Fetch a URL and trigger a browser download with a
 * chosen filename, falling back to opening the URL in a new tab on failure.
 *
 * Shared by the Media app's detail page and the inline download action in the
 * Collections object workspace so both behave identically.
 */
export async function downloadWithFilename(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    window.open(url, '_blank');
    throw error;
  }
}
