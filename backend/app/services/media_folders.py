"""Media folder management service.

Provides hierarchical folder organization for media assets.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session, joinedload

from app.models import MediaFolder, Media

if TYPE_CHECKING:
    pass


class MediaFolderService:
    """Service for managing media folders."""

    def __init__(self, db: Session):
        self.db = db

    def get_folder(self, folder_id: uuid.UUID) -> MediaFolder | None:
        """Get a folder by ID."""
        return self.db.get(MediaFolder, folder_id)

    def get_folder_tree(
        self,
        organization_id: uuid.UUID,
        include_counts: bool = True,
    ) -> list[dict]:
        """
        Get the complete folder tree for an organization.

        Returns a flat list with hierarchy info that can be rendered as a tree.
        """
        query = (
            select(MediaFolder)
            .where(MediaFolder.organization_id == organization_id)
            .order_by(MediaFolder.path, MediaFolder.sort_order, MediaFolder.name)
        )
        folders = self.db.execute(query).scalars().all()

        result = []
        for folder in folders:
            folder_dict = {
                "folder_id": str(folder.folder_id),
                "name": folder.name,
                "parent_folder_id": str(folder.parent_folder_id) if folder.parent_folder_id else None,
                "path": folder.path,
                "depth": folder.depth,
                "sort_order": folder.sort_order,
                "created_at": folder.created_at.isoformat() if folder.created_at else None,
            }

            if include_counts:
                # Get media count for this folder
                count_query = (
                    select(func.count(Media.media_id))
                    .where(Media.folder_id == folder.folder_id)
                )
                folder_dict["media_count"] = self.db.execute(count_query).scalar() or 0

            result.append(folder_dict)

        return result

    def get_folder_contents(
        self,
        folder_id: uuid.UUID | None,
        organization_id: uuid.UUID,
        limit: int = 100,
        offset: int = 0,
    ) -> dict:
        """
        Get contents of a folder (subfolders and media).

        If folder_id is None, returns root-level items.
        """
        # Get subfolders
        subfolder_query = (
            select(MediaFolder)
            .where(
                MediaFolder.organization_id == organization_id,
                MediaFolder.parent_folder_id == folder_id,
            )
            .order_by(MediaFolder.sort_order, MediaFolder.name)
        )
        subfolders = self.db.execute(subfolder_query).scalars().all()

        # Get media in this folder
        media_query = (
            select(Media)
            .where(
                Media.organization_id == organization_id,
                Media.folder_id == folder_id,
            )
            .order_by(Media.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        media_items = self.db.execute(media_query).scalars().all()

        # Get total media count
        count_query = (
            select(func.count(Media.media_id))
            .where(
                Media.organization_id == organization_id,
                Media.folder_id == folder_id,
            )
        )
        total_media = self.db.execute(count_query).scalar() or 0

        return {
            "subfolders": [
                {
                    "folder_id": str(f.folder_id),
                    "name": f.name,
                    "path": f.path,
                    "depth": f.depth,
                }
                for f in subfolders
            ],
            "media": [
                {
                    "media_id": str(m.media_id),
                    "filename": m.filename,
                    "title": m.title,
                    "media_type": m.media_type,
                    "thumbnail_s3_key": m.thumbnail_s3_key,
                }
                for m in media_items
            ],
            "total_media": total_media,
            "limit": limit,
            "offset": offset,
        }

    def create_folder(
        self,
        organization_id: uuid.UUID,
        name: str,
        parent_folder_id: uuid.UUID | None = None,
        created_by_id: uuid.UUID | None = None,
    ) -> MediaFolder:
        """Create a new folder."""
        # Calculate path and depth
        if parent_folder_id:
            parent = self.get_folder(parent_folder_id)
            if not parent:
                raise ValueError("Parent folder not found")
            if parent.organization_id != organization_id:
                raise ValueError("Parent folder belongs to different organization")
            path = f"{parent.path}{parent.folder_id}/"
            depth = parent.depth + 1
        else:
            path = "/"
            depth = 0

        # Get next sort order
        sort_query = (
            select(func.coalesce(func.max(MediaFolder.sort_order), -1) + 1)
            .where(
                MediaFolder.organization_id == organization_id,
                MediaFolder.parent_folder_id == parent_folder_id,
            )
        )
        sort_order = self.db.execute(sort_query).scalar() or 0

        folder = MediaFolder(
            organization_id=organization_id,
            name=name,
            parent_folder_id=parent_folder_id,
            path=path,
            depth=depth,
            sort_order=sort_order,
            created_by_id=created_by_id,
        )

        self.db.add(folder)
        self.db.flush()

        return folder

    def rename_folder(self, folder_id: uuid.UUID, new_name: str) -> MediaFolder:
        """Rename a folder."""
        folder = self.get_folder(folder_id)
        if not folder:
            raise ValueError("Folder not found")

        folder.name = new_name
        folder.updated_at = datetime.now(timezone.utc)
        self.db.flush()

        return folder

    def move_folder(
        self,
        folder_id: uuid.UUID,
        new_parent_id: uuid.UUID | None,
    ) -> MediaFolder:
        """Move a folder to a new parent."""
        folder = self.get_folder(folder_id)
        if not folder:
            raise ValueError("Folder not found")

        # Prevent moving to self or descendant
        if new_parent_id:
            if new_parent_id == folder_id:
                raise ValueError("Cannot move folder into itself")

            new_parent = self.get_folder(new_parent_id)
            if not new_parent:
                raise ValueError("New parent folder not found")
            if new_parent.organization_id != folder.organization_id:
                raise ValueError("Cannot move folder to different organization")

            # Check if new parent is a descendant of the folder being moved
            if new_parent.path.startswith(f"{folder.path}{folder.folder_id}/"):
                raise ValueError("Cannot move folder into its own descendant")

            new_path = f"{new_parent.path}{new_parent.folder_id}/"
            new_depth = new_parent.depth + 1
        else:
            new_path = "/"
            new_depth = 0

        old_path_prefix = f"{folder.path}{folder.folder_id}/"
        depth_diff = new_depth - folder.depth

        # Update the folder itself
        folder.parent_folder_id = new_parent_id
        folder.path = new_path
        folder.depth = new_depth
        folder.updated_at = datetime.now(timezone.utc)

        # Update all descendant folders
        descendants_query = (
            select(MediaFolder)
            .where(MediaFolder.path.like(f"{old_path_prefix}%"))
        )
        descendants = self.db.execute(descendants_query).scalars().all()

        for desc in descendants:
            desc.path = new_path + folder.folder_id.__str__() + "/" + desc.path[len(old_path_prefix):]
            desc.depth = desc.depth + depth_diff

        self.db.flush()

        return folder

    def delete_folder(
        self,
        folder_id: uuid.UUID,
        move_contents_to: uuid.UUID | None = None,
    ) -> int:
        """
        Delete a folder.

        If move_contents_to is provided, moves all media to that folder.
        Otherwise, media in deleted folders will have folder_id set to NULL.

        Returns the number of media items affected.
        """
        folder = self.get_folder(folder_id)
        if not folder:
            raise ValueError("Folder not found")

        # Get all folder IDs to delete (this folder and descendants)
        folder_ids_query = (
            select(MediaFolder.folder_id)
            .where(
                (MediaFolder.folder_id == folder_id) |
                (MediaFolder.path.like(f"{folder.path}{folder.folder_id}/%"))
            )
        )
        folder_ids = [row[0] for row in self.db.execute(folder_ids_query).all()]

        # Move or orphan media
        if move_contents_to:
            target = self.get_folder(move_contents_to)
            if not target:
                raise ValueError("Target folder not found")
            if target.organization_id != folder.organization_id:
                raise ValueError("Target folder belongs to different organization")

        # Update media items
        update_count = 0
        for fid in folder_ids:
            media_query = select(Media).where(Media.folder_id == fid)
            media_items = self.db.execute(media_query).scalars().all()
            for m in media_items:
                m.folder_id = move_contents_to
                update_count += 1

        # Delete folders (CASCADE will handle children)
        self.db.delete(folder)
        self.db.flush()

        return update_count

    def move_media_to_folder(
        self,
        media_ids: list[uuid.UUID],
        folder_id: uuid.UUID | None,
        organization_id: uuid.UUID,
    ) -> int:
        """
        Move multiple media items to a folder.

        If folder_id is None, moves to root (unfiled).
        Returns the number of items moved.
        """
        # Validate folder if provided
        if folder_id:
            folder = self.get_folder(folder_id)
            if not folder:
                raise ValueError("Folder not found")
            if folder.organization_id != organization_id:
                raise ValueError("Folder belongs to different organization")

        # Update media items
        query = (
            select(Media)
            .where(
                Media.media_id.in_(media_ids),
                Media.organization_id == organization_id,
            )
        )
        media_items = self.db.execute(query).scalars().all()

        for m in media_items:
            m.folder_id = folder_id

        self.db.flush()

        return len(media_items)

    def get_folder_path(self, folder_id: uuid.UUID) -> list[dict]:
        """Get the breadcrumb path for a folder."""
        folder = self.get_folder(folder_id)
        if not folder:
            return []

        # Parse path to get ancestor IDs
        path_parts = folder.path.strip("/").split("/") if folder.path != "/" else []
        ancestor_ids = [uuid.UUID(p) for p in path_parts if p]

        # Get all ancestors
        if ancestor_ids:
            ancestors_query = (
                select(MediaFolder)
                .where(MediaFolder.folder_id.in_(ancestor_ids))
            )
            ancestors = {a.folder_id: a for a in self.db.execute(ancestors_query).scalars().all()}
        else:
            ancestors = {}

        # Build path in order
        result = []
        for aid in ancestor_ids:
            if aid in ancestors:
                a = ancestors[aid]
                result.append({
                    "folder_id": str(a.folder_id),
                    "name": a.name,
                })

        # Add current folder
        result.append({
            "folder_id": str(folder.folder_id),
            "name": folder.name,
        })

        return result

    def get_unfiled_count(self, organization_id: uuid.UUID) -> int:
        """Get count of media items not in any folder."""
        query = (
            select(func.count(Media.media_id))
            .where(
                Media.organization_id == organization_id,
                Media.folder_id.is_(None),
            )
        )
        return self.db.execute(query).scalar() or 0
