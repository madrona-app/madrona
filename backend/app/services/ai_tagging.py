"""
AI-powered media tagging service.

Uses AWS Rekognition to detect:
- Labels (objects, scenes, concepts)
- Text (OCR for images)
- Faces (optional, with age/emotion)
- Celebrities (optional)
- Moderation labels (optional)

Uses pypdfium2 for:
- PDF text extraction (local, no API cost)

Supports per-organization configuration including:
- Feature toggles (labels, text, faces, etc.)
- Confidence thresholds
- Monthly budget caps
"""
import logging
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

import boto3
from botocore.exceptions import ClientError

from app.config import get_settings
from app.database import current_session
from app.models import (
    Media,
    MediaAIConfig,
    MediaAITag,
    MediaAITagMapping,
    MediaTag,
    MediaTagDefinition,
)

logger = logging.getLogger(__name__)

# Cost per API call in USD (us-east-1 pricing as of 2024)
REKOGNITION_COSTS = {
    "detect_labels": Decimal("0.001"),
    "detect_text": Decimal("0.001"),
    "detect_faces": Decimal("0.001"),
    "recognize_celebrities": Decimal("0.001"),
    "detect_moderation_labels": Decimal("0.001"),
}


@dataclass
class BoundingBox:
    """Bounding box coordinates (0.0-1.0 representing percentage of image)."""
    left: float
    top: float
    width: float
    height: float


@dataclass
class AITag:
    """A single AI-detected tag."""
    tag_type: str  # 'label', 'text', 'face', 'color', 'celebrity', 'moderation'
    tag_value: str
    confidence: float  # 0.0 - 1.0
    metadata: dict[str, Any] = field(default_factory=dict)
    bbox: Optional[BoundingBox] = None
    provider: str = "rekognition"


@dataclass
class AIAnalysisResult:
    """Results from AI analysis of a media item."""
    media_id: UUID
    labels: list[AITag] = field(default_factory=list)
    text: list[AITag] = field(default_factory=list)
    faces: list[AITag] = field(default_factory=list)
    celebrities: list[AITag] = field(default_factory=list)
    moderation: list[AITag] = field(default_factory=list)
    cost_usd: Decimal = Decimal("0.0000")

    @property
    def all_tags(self) -> list[AITag]:
        """Return all detected tags."""
        return self.labels + self.text + self.faces + self.celebrities + self.moderation


@dataclass
class MappedTag:
    """A tag that has been mapped to an organization tag definition."""
    definition_id: UUID
    value: str
    source_ai_tag: AITag


class AITaggingService:
    """Service for AI-powered media tagging."""

    def __init__(self, organization_id: UUID):
        self.organization_id = organization_id
        self.settings = get_settings()
        self._config: Optional[MediaAIConfig] = None
        self._rekognition_client = None
        self._s3_client = None

    @property
    def config(self) -> MediaAIConfig:
        """Load or return cached AI config for this organization."""
        if self._config is None:
            self._config = current_session().query(MediaAIConfig).filter_by(
                organization_id=self.organization_id
            ).first()

            if self._config is None:
                # Create default config. Media processing fans out across
                # workers, so several tasks can reach this at once and race on
                # the organization_id unique constraint; the loser rolls back
                # and re-reads the winner's row.
                from sqlalchemy.exc import IntegrityError

                self._config = MediaAIConfig(
                    organization_id=self.organization_id,
                )
                current_session().add(self._config)
                try:
                    current_session().commit()
                    logger.info(
                        "Created default AI config for org %s", self.organization_id
                    )
                except IntegrityError:
                    current_session().rollback()
                    self._config = current_session().query(MediaAIConfig).filter_by(
                        organization_id=self.organization_id
                    ).one()

        return self._config

    @property
    def rekognition(self):
        """Lazy-load Rekognition client."""
        if self._rekognition_client is None:
            self._rekognition_client = boto3.client(
                'rekognition',
                region_name=self.settings.aws_region,
            )
        return self._rekognition_client

    @property
    def s3(self):
        """Lazy-load S3 client."""
        if self._s3_client is None:
            self._s3_client = boto3.client(
                's3',
                region_name=self.settings.aws_region,
            )
        return self._s3_client

    def _get_bucket_name(self) -> str:
        """Get the S3 bucket name for this organization."""
        from app.services.uploads import get_media_bucket, get_org_storage_region
        region = get_org_storage_region(str(self.organization_id), current_session())
        return get_media_bucket(region)

    def _check_budget(self, estimated_cost: Decimal) -> bool:
        """Check if we have budget for the estimated cost."""
        if self.config.monthly_budget_usd is None:
            return True  # No budget limit

        # Check if we need to reset the counter (new month)
        today = datetime.now(timezone.utc).date()
        if self.config.usage_reset_date is None or self.config.usage_reset_date.month != today.month:
            self.config.current_month_usage = Decimal("0.0000")
            self.config.usage_reset_date = today
            current_session().commit()

        remaining = self.config.monthly_budget_usd - self.config.current_month_usage
        return remaining >= estimated_cost

    def _record_cost(self, cost: Decimal):
        """Record API cost against monthly budget."""
        self.config.current_month_usage += cost
        current_session().commit()

    def analyze_image(self, media_id: UUID, s3_key: str) -> AIAnalysisResult:
        """
        Run all configured detections on an image.

        Args:
            media_id: The media UUID
            s3_key: S3 key for the image

        Returns:
            AIAnalysisResult with all detected tags
        """
        results = AIAnalysisResult(media_id=media_id)
        bucket = self._get_bucket_name()

        # Estimate cost and check budget
        estimated_cost = Decimal("0.0000")
        if self.config.detect_labels:
            estimated_cost += REKOGNITION_COSTS["detect_labels"]
        if self.config.detect_text:
            estimated_cost += REKOGNITION_COSTS["detect_text"]
        if self.config.detect_faces:
            estimated_cost += REKOGNITION_COSTS["detect_faces"]
        if self.config.detect_celebrities:
            estimated_cost += REKOGNITION_COSTS["recognize_celebrities"]
        if self.config.detect_moderation:
            estimated_cost += REKOGNITION_COSTS["detect_moderation_labels"]

        if not self._check_budget(estimated_cost):
            logger.warning(
                f"Monthly budget exceeded for org {self.organization_id}. "
                f"Budget: ${self.config.monthly_budget_usd}, Used: ${self.config.current_month_usage}"
            )
            return results

        try:
            if self.config.detect_labels:
                results.labels = self._detect_labels(bucket, s3_key)
                results.cost_usd += REKOGNITION_COSTS["detect_labels"]

            if self.config.detect_text:
                results.text = self._detect_text(bucket, s3_key)
                results.cost_usd += REKOGNITION_COSTS["detect_text"]

            if self.config.detect_faces:
                results.faces = self._detect_faces(bucket, s3_key)
                results.cost_usd += REKOGNITION_COSTS["detect_faces"]

            if self.config.detect_celebrities:
                results.celebrities = self._detect_celebrities(bucket, s3_key)
                results.cost_usd += REKOGNITION_COSTS["recognize_celebrities"]

            if self.config.detect_moderation:
                results.moderation = self._detect_moderation(bucket, s3_key)
                results.cost_usd += REKOGNITION_COSTS["detect_moderation_labels"]

            # Record the cost
            self._record_cost(results.cost_usd)

        except ClientError as e:
            logger.error(f"Rekognition error for media {media_id}: {e}")
            raise

        return results

    def analyze_pdf(self, media_id: UUID, s3_key: str) -> AIAnalysisResult:
        """
        Extract text from PDF using pypdfium2 (local processing).

        Args:
            media_id: The media UUID
            s3_key: S3 key for the PDF

        Returns:
            AIAnalysisResult with extracted text tags
        """
        results = AIAnalysisResult(media_id=media_id)

        if not self.config.extract_pdf_text:
            return results

        bucket = self._get_bucket_name()

        try:
            import pypdfium2  # noqa: F401  (availability probe)
        except ImportError:
            logger.error("pypdfium2 not installed. PDF text extraction unavailable.")
            return results

        try:
            # Download PDF to temp file
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=True) as tmp:
                self.s3.download_file(bucket, s3_key, tmp.name)
                results.text = self._extract_pdf_text(tmp.name)
        except ClientError as e:
            logger.error(f"S3 error downloading PDF {s3_key}: {e}")
            raise
        except Exception as e:
            logger.error(f"Error extracting text from PDF {media_id}: {e}")
            raise

        return results

    def _detect_labels(self, bucket: str, s3_key: str) -> list[AITag]:
        """Detect objects, scenes, concepts using Rekognition."""
        min_confidence = float(self.config.min_label_confidence) * 100

        response = self.rekognition.detect_labels(
            Image={'S3Object': {'Bucket': bucket, 'Name': s3_key}},
            MaxLabels=self.config.max_labels_per_image,
            MinConfidence=min_confidence,
        )

        tags = []
        for label in response.get('Labels', []):
            # Get parent labels for hierarchy info
            parents = [p['Name'] for p in label.get('Parents', [])]

            # Get bounding boxes if any
            instances = label.get('Instances', [])
            if instances:
                # Create a tag for each instance with bounding box
                for instance in instances:
                    bbox_data = instance.get('BoundingBox', {})
                    bbox = BoundingBox(
                        left=bbox_data.get('Left', 0),
                        top=bbox_data.get('Top', 0),
                        width=bbox_data.get('Width', 0),
                        height=bbox_data.get('Height', 0),
                    ) if bbox_data else None

                    tags.append(AITag(
                        tag_type='label',
                        tag_value=label['Name'],
                        confidence=label['Confidence'] / 100,
                        metadata={'parents': parents, 'instance': True},
                        bbox=bbox,
                    ))
            else:
                # Label without specific instance (scene-level detection)
                tags.append(AITag(
                    tag_type='label',
                    tag_value=label['Name'],
                    confidence=label['Confidence'] / 100,
                    metadata={'parents': parents},
                ))

        return tags

    def _detect_text(self, bucket: str, s3_key: str) -> list[AITag]:
        """Detect and extract text (OCR) from images."""
        response = self.rekognition.detect_text(
            Image={'S3Object': {'Bucket': bucket, 'Name': s3_key}},
        )

        min_confidence = float(self.config.min_text_confidence) * 100
        tags = []

        for detection in response.get('TextDetections', []):
            if detection['Confidence'] < min_confidence:
                continue

            # Only include LINE detections (skip individual WORDs to reduce noise)
            if detection['Type'] != 'LINE':
                continue

            bbox_data = detection.get('Geometry', {}).get('BoundingBox', {})
            bbox = BoundingBox(
                left=bbox_data.get('Left', 0),
                top=bbox_data.get('Top', 0),
                width=bbox_data.get('Width', 0),
                height=bbox_data.get('Height', 0),
            ) if bbox_data else None

            tags.append(AITag(
                tag_type='text',
                tag_value=detection['DetectedText'],
                confidence=detection['Confidence'] / 100,
                metadata={
                    'type': detection['Type'],
                    'id': detection.get('Id'),
                    'parent_id': detection.get('ParentId'),
                },
                bbox=bbox,
            ))

        return tags

    def _detect_faces(self, bucket: str, s3_key: str) -> list[AITag]:
        """Detect faces with attributes."""
        response = self.rekognition.detect_faces(
            Image={'S3Object': {'Bucket': bucket, 'Name': s3_key}},
            Attributes=['ALL'],
        )

        tags = []
        for i, face in enumerate(response.get('FaceDetails', [])):
            bbox_data = face.get('BoundingBox', {})
            bbox = BoundingBox(
                left=bbox_data.get('Left', 0),
                top=bbox_data.get('Top', 0),
                width=bbox_data.get('Width', 0),
                height=bbox_data.get('Height', 0),
            ) if bbox_data else None

            # Extract face attributes
            age_range = face.get('AgeRange', {})
            emotions = [
                {'type': e['Type'], 'confidence': e['Confidence']}
                for e in face.get('Emotions', [])
                if e['Confidence'] > 50
            ]

            tags.append(AITag(
                tag_type='face',
                tag_value=f"Face {i + 1}",
                confidence=face.get('Confidence', 100) / 100,
                metadata={
                    'age_range': {
                        'low': age_range.get('Low'),
                        'high': age_range.get('High'),
                    },
                    'gender': face.get('Gender', {}).get('Value'),
                    'emotions': emotions,
                    'smile': face.get('Smile', {}).get('Value'),
                    'eyeglasses': face.get('Eyeglasses', {}).get('Value'),
                    'sunglasses': face.get('Sunglasses', {}).get('Value'),
                    'beard': face.get('Beard', {}).get('Value'),
                    'mustache': face.get('Mustache', {}).get('Value'),
                },
                bbox=bbox,
            ))

        return tags

    def _detect_celebrities(self, bucket: str, s3_key: str) -> list[AITag]:
        """Detect celebrities in the image."""
        response = self.rekognition.recognize_celebrities(
            Image={'S3Object': {'Bucket': bucket, 'Name': s3_key}},
        )

        tags = []
        for celeb in response.get('CelebrityFaces', []):
            bbox_data = celeb.get('Face', {}).get('BoundingBox', {})
            bbox = BoundingBox(
                left=bbox_data.get('Left', 0),
                top=bbox_data.get('Top', 0),
                width=bbox_data.get('Width', 0),
                height=bbox_data.get('Height', 0),
            ) if bbox_data else None

            tags.append(AITag(
                tag_type='celebrity',
                tag_value=celeb['Name'],
                confidence=celeb.get('MatchConfidence', 100) / 100,
                metadata={
                    'id': celeb.get('Id'),
                    'urls': celeb.get('Urls', []),
                },
                bbox=bbox,
            ))

        return tags

    def _detect_moderation(self, bucket: str, s3_key: str) -> list[AITag]:
        """Detect content moderation labels."""
        response = self.rekognition.detect_moderation_labels(
            Image={'S3Object': {'Bucket': bucket, 'Name': s3_key}},
        )

        min_confidence = float(self.config.min_label_confidence) * 100
        tags = []

        for label in response.get('ModerationLabels', []):
            if label['Confidence'] < min_confidence:
                continue

            tags.append(AITag(
                tag_type='moderation',
                tag_value=label['Name'],
                confidence=label['Confidence'] / 100,
                metadata={
                    'parent_name': label.get('ParentName'),
                },
            ))

        return tags

    def _extract_pdf_text(self, pdf_path: str) -> list[AITag]:
        """Extract text from each page of a PDF using pypdfium2 (PDFium)."""
        import pypdfium2 as pdfium

        tags = []
        doc = pdfium.PdfDocument(pdf_path)

        for page_num in range(len(doc)):
            page = doc[page_num]
            textpage = page.get_textpage()
            try:
                text = textpage.get_text_range()
            finally:
                textpage.close()

            if text.strip():
                # Truncate tag_value for storage, keep full text in metadata
                truncated = text.strip()[:500]
                if len(text.strip()) > 500:
                    truncated += "..."

                tags.append(AITag(
                    tag_type='text',
                    tag_value=truncated,
                    confidence=1.0,  # Local extraction, always confident
                    metadata={
                        'page_number': page_num + 1,
                        'total_pages': len(doc),
                        'full_text': text.strip(),
                        'source': 'pypdfium2',
                        'char_count': len(text.strip()),
                    },
                    provider='pypdfium2',
                ))

        doc.close()
        return tags

    def load_mappings(self) -> dict[tuple[str, str], MediaAITagMapping]:
        """Load all AI tag mappings for this organization."""
        mappings = current_session().query(MediaAITagMapping).filter_by(
            organization_id=self.organization_id
        ).all()

        return {
            (m.ai_tag_type, m.ai_tag_value.lower()): m
            for m in mappings
        }

    def map_to_org_tags(self, ai_tags: list[AITag]) -> list[MappedTag]:
        """Map AI tags to organization tag definitions."""
        mappings = self.load_mappings()
        mapped = []

        for tag in ai_tags:
            key = (tag.tag_type, tag.tag_value.lower())
            mapping = mappings.get(key)

            if mapping and mapping.auto_apply:
                if tag.confidence >= float(mapping.min_confidence):
                    mapped.append(MappedTag(
                        definition_id=mapping.definition_id,
                        value=mapping.mapped_value,
                        source_ai_tag=tag,
                    ))

        return mapped

    def apply_tags(self, media_id: UUID, mapped_tags: list[MappedTag]):
        """Apply mapped tags to media record as MediaTag entries."""
        for tag in mapped_tags:
            # Check if tag already exists
            existing = current_session().query(MediaTag).filter_by(
                media_id=media_id,
                definition_id=tag.definition_id,
            ).first()

            if not existing:
                media_tag = MediaTag(
                    organization_id=self.organization_id,
                    media_id=media_id,
                    definition_id=tag.definition_id,
                    tag_value=tag.value,
                )
                current_session().add(media_tag)
                logger.debug(
                    f"Applied AI tag mapping: {tag.source_ai_tag.tag_value} -> "
                    f"{tag.value} for media {media_id}"
                )

    def store_ai_tags(self, media_id: UUID, results: AIAnalysisResult):
        """Store raw AI tags in the database."""
        mappings = self.load_mappings()

        for tag in results.all_tags:
            # Check if this tag has a mapping
            key = (tag.tag_type, tag.tag_value.lower())
            mapping = mappings.get(key)

            ai_tag = MediaAITag(
                organization_id=self.organization_id,
                media_id=media_id,
                tag_type=tag.tag_type,
                tag_value=tag.tag_value,
                confidence=Decimal(str(tag.confidence)),
                tag_metadata=tag.metadata,
                bbox_left=Decimal(str(tag.bbox.left)) if tag.bbox else None,
                bbox_top=Decimal(str(tag.bbox.top)) if tag.bbox else None,
                bbox_width=Decimal(str(tag.bbox.width)) if tag.bbox else None,
                bbox_height=Decimal(str(tag.bbox.height)) if tag.bbox else None,
                provider=tag.provider,
                mapped_to_definition_id=mapping.definition_id if mapping else None,
                mapping_status='mapped' if mapping else 'pending',
            )
            current_session().add(ai_tag)


# Singleton-style factory function
_ai_tagging_services: dict[UUID, AITaggingService] = {}


def get_ai_tagging_service(organization_id: UUID) -> AITaggingService:
    """Get or create AI tagging service for an organization."""
    if organization_id not in _ai_tagging_services:
        _ai_tagging_services[organization_id] = AITaggingService(organization_id)
    return _ai_tagging_services[organization_id]


def clear_ai_tagging_service_cache():
    """Clear the service cache (useful for testing)."""
    _ai_tagging_services.clear()
