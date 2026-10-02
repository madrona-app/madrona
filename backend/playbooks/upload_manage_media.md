# Upload and Manage Media

Use this when you need to add photographs, documents, audio, video, or 3D models to the media library — whether for a specific collection object, an exhibition, a condition report, or as standalone assets for publication and research.

## Where to go in Madrona

**Media → Library** to browse, upload, and manage media assets. To attach media to a specific object, go to the object's workspace and use the **Media** section.

## Uploading

Drag files into the library or click **Upload**. Madrona accepts images (JPEG, PNG, TIFF, RAW), documents (PDF), audio (MP3, WAV, FLAC), video (MP4, MOV), and 3D models (GLB/GLTF).

On upload, Madrona automatically:

- Generates derivative sizes (thumbnail, small, medium, large, access master)
- Extracts technical metadata (EXIF, IPTC, XMP for images; ID3 for audio; duration for video)
- Extracts dominant colors for the color search filter
- Queues AI tagging if enabled (labels, text/OCR, faces, moderation)

Large uploads process in the background. The library shows a processing indicator until derivatives are ready.

## Organizing

**Folders** — create a folder hierarchy that makes sense for your institution (by department, project, accession year, photographer, etc.). Drag media between folders, or use the folder tree in the sidebar.

**Lightboxes** — create named collections for project-specific grouping. Lightboxes are shareable and don't move files — they're virtual collections.

**Tags** — AI-generated tags can be reviewed, mapped to controlled vocabulary terms, or rejected. Manual tags can be added for anything the AI missed.

## Linking to objects

To attach a media asset to a collection object:

1. Open the object's workspace
2. Go to the **Media** section
3. Search the library or upload a new file directly
4. Set one image as the **primary** — this appears as the object thumbnail across the system
5. Add a caption if needed

Each object can have multiple media files. Use the sort order to control which images appear first. The primary image drives the collection catalog grid, search results, and any public-facing display.

## Metadata

For each media asset, you can record:

- **Title** — a descriptive title (not just the filename)
- **Description** — what the image shows, when and where it was taken
- **Creator** — who took the photograph or created the media
- **Copyright** — rights status and holder
- **Date** — when the media was created
- **Tags** — subject terms, descriptors, keywords

Good metadata makes media findable. A photograph titled "IMG_4523.jpg" with no description is effectively lost in a large library.

## Publishing

Media can be published to external channels (website, social media, partner portals) via the **Publishing** tools. Published media gets a public URL. Unpublished media is internal-only.

Before publishing, verify:

- The image quality is suitable for the target format
- Rights are cleared for the intended use
- Metadata is complete (title, description, copyright)
- The object record is accurate (the image will be associated with the object publicly)

## Common pitfalls

- Uploading without setting a primary image on the object. The object appears without a thumbnail everywhere in the system until you do.
- Not reviewing AI tags. Auto-generated tags are useful but imperfect — review and map them to your controlled vocabulary for consistency.
- Uploading duplicates. Use the visual search (similarity matching) to check if an image already exists before uploading.
- Forgetting to add a title and description. Metadata-free media is hard to find and impossible to attribute correctly in publications.
