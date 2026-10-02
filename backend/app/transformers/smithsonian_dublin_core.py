"""
Transformer for converting Smithsonian EDAN format to Dublin Core.

Dublin Core is a simple, widely-adopted metadata standard with 15 core elements.
It's used by libraries, archives, and museums for basic interoperability.

Dublin Core Elements:
- title: Resource name
- creator: Entity primarily responsible for making the resource
- subject: Topic of the resource
- description: Account of the resource
- publisher: Entity responsible for making the resource available
- contributor: Entity responsible for making contributions
- date: Point or period of time associated with an event
- type: Nature or genre of the resource
- format: File format, physical medium, or dimensions
- identifier: Unambiguous reference to the resource
- source: Related resource from which it is derived
- language: Language of the resource
- relation: Related resource
- coverage: Spatial or temporal topic, applicability
- rights: Information about rights held in and over the resource
"""
from typing import Any, Dict, List, Optional
from . import Transformer


class SmithsonianDublinCoreTransformer(Transformer):
    """Transform Smithsonian EDAN format to Dublin Core."""
    
    @property
    def source_format(self) -> str:
        return "smithsonian"
    
    @property
    def target_format(self) -> str:
        return "dublin-core"
    
    @property
    def content_type(self) -> str:
        return "application/json"
    
    def transform(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Transform Smithsonian EDAN payload to Dublin Core.
        
        Args:
            payload: Smithsonian EDAN format object
            
        Returns:
            Dublin Core format object with 15 elements
        """
        content = payload.get("content", {})
        descriptive = content.get("descriptiveNonRepeating", {})
        indexed = content.get("indexedStructured", {})
        freetext = content.get("freetext", {})
        
        return {
            "title": self._extract_title(descriptive, freetext),
            "creator": self._extract_creators(indexed, freetext),
            "subject": self._extract_subjects(indexed),
            "description": self._extract_description(freetext),
            "publisher": self._extract_publisher(descriptive),
            "contributor": self._extract_contributors(indexed, freetext),
            "date": self._extract_dates(indexed, freetext),
            "type": self._extract_type(indexed),
            "format": self._extract_format(indexed, freetext),
            "identifier": self._extract_identifiers(descriptive, payload),
            "source": self._extract_source(descriptive),
            "language": self._extract_language(indexed),
            "relation": self._extract_relations(freetext),
            "coverage": self._extract_coverage(indexed, freetext),
            "rights": self._extract_rights(descriptive, freetext)
        }
    
    def _extract_title(self, descriptive: dict, freetext: dict) -> Optional[str]:
        """Extract title from EDAN data."""
        # First try title.label
        if "title" in descriptive and "label" in descriptive["title"]:
            return descriptive["title"]["label"]
        
        # Fallback to title in freetext
        if "title" in freetext:
            titles = freetext["title"]
            if titles and len(titles) > 0:
                return titles[0].get("content")
        
        return None
    
    def _extract_creators(self, indexed: dict, freetext: dict) -> List[str]:
        """Extract creators/artists from EDAN data."""
        creators = []
        
        # Check name entries for creators/artists
        if "name" in indexed:
            for name_entry in indexed["name"]:
                # Only include if marked as artist, creator, maker, etc.
                label = name_entry.get("label", "").lower()
                if any(role in label for role in ["artist", "creator", "maker", "author", "photographer"]):
                    creators.append(name_entry.get("content"))
        
        # Check freetext name section
        if "name" in freetext:
            for name_entry in freetext["name"]:
                label = name_entry.get("label", "").lower()
                if any(role in label for role in ["artist", "creator", "maker", "author", "photographer"]):
                    creators.append(name_entry.get("content"))
        
        return [c for c in creators if c]
    
    def _extract_subjects(self, indexed: dict) -> List[str]:
        """Extract subject terms/topics."""
        subjects = []
        
        # Topics
        if "topic" in indexed:
            subjects.extend([t.get("content") for t in indexed["topic"] if t.get("content")])
        
        # Culture
        if "culture" in indexed:
            subjects.extend([c.get("content") for c in indexed["culture"] if c.get("content")])
        
        # Scientific name
        if "scientific_name" in indexed:
            subjects.extend([s.get("content") for s in indexed["scientific_name"] if s.get("content")])
        
        return subjects
    
    def _extract_description(self, freetext: dict) -> Optional[str]:
        """Extract description/notes."""
        descriptions = []
        
        # Look for notes, description, physical description, etc.
        for key in ["notes", "description", "physicalDescription", "summary"]:
            if key in freetext:
                for entry in freetext[key]:
                    if entry.get("content"):
                        label = entry.get("label", "")
                        content = entry.get("content")
                        if label:
                            descriptions.append(f"{label}: {content}")
                        else:
                            descriptions.append(content)
        
        return "\n\n".join(descriptions) if descriptions else None
    
    def _extract_publisher(self, descriptive: dict) -> Optional[str]:
        """Extract publisher information."""
        # For Smithsonian data, the data source is the publisher
        if "data_source" in descriptive:
            return descriptive["data_source"]
        
        # Could also be in unit code
        if "unit_code" in descriptive:
            return descriptive["unit_code"]
        
        return "Smithsonian Institution"
    
    def _extract_contributors(self, indexed: dict, freetext: dict) -> List[str]:
        """Extract contributors (not primary creators)."""
        contributors = []
        
        # Check name entries for contributors
        if "name" in indexed:
            for name_entry in indexed["name"]:
                label = name_entry.get("label", "").lower()
                # Include if contributor-like role
                if any(role in label for role in ["donor", "collector", "associated", "manufacturer", "publisher"]):
                    contributors.append(name_entry.get("content"))
        
        return [c for c in contributors if c]
    
    def _extract_dates(self, indexed: dict, freetext: dict) -> List[str]:
        """Extract dates."""
        dates = []
        
        # Structured dates
        if "date" in indexed:
            for date_entry in indexed["date"]:
                date_str = date_entry.get("content")
                if date_str:
                    dates.append(date_str)
        
        # Freetext dates
        if "date" in freetext:
            for date_entry in freetext["date"]:
                date_str = date_entry.get("content")
                if date_str:
                    dates.append(date_str)
        
        return dates
    
    def _extract_type(self, indexed: dict) -> List[str]:
        """Extract resource type."""
        types = []
        
        if "object_type" in indexed:
            types.extend([t.get("content") for t in indexed["object_type"] if t.get("content")])
        
        # Add generic type
        if "type" in indexed:
            types.extend([t.get("content") for t in indexed["type"] if t.get("content")])
        
        return types if types else ["PhysicalObject"]
    
    def _extract_format(self, indexed: dict, freetext: dict) -> Optional[str]:
        """Extract format/physical description."""
        formats = []
        
        # Physical description from freetext
        if "physicalDescription" in freetext:
            for entry in freetext["physicalDescription"]:
                if entry.get("content"):
                    formats.append(entry["content"])
        
        # Medium
        if "medium" in indexed:
            formats.extend([m.get("content") for m in indexed["medium"] if m.get("content")])
        
        return "; ".join(formats) if formats else None
    
    def _extract_identifiers(self, descriptive: dict, payload: dict) -> List[str]:
        """Extract identifiers."""
        identifiers = []
        
        # Record ID
        if "record_ID" in descriptive:
            identifiers.append(f"Smithsonian ID: {descriptive['record_ID']}")
        
        # GUID
        if "guid" in descriptive:
            identifiers.append(f"GUID: {descriptive['guid']}")
        
        # ID from top level
        if "id" in payload:
            identifiers.append(f"ID: {payload['id']}")
        
        # Unit code + record link
        if "record_link" in descriptive:
            identifiers.append(f"URL: {descriptive['record_link']}")
        
        return identifiers
    
    def _extract_source(self, descriptive: dict) -> Optional[str]:
        """Extract source information."""
        # Data source or unit
        return descriptive.get("data_source") or descriptive.get("unit_code")
    
    def _extract_language(self, indexed: dict) -> List[str]:
        """Extract language."""
        if "language" in indexed:
            return [lang.get("content") for lang in indexed["language"] if lang.get("content")]
        return []
    
    def _extract_relations(self, freetext: dict) -> List[str]:
        """Extract related resources."""
        relations = []
        
        # Look for references, related items, etc.
        if "setName" in freetext:
            for entry in freetext["setName"]:
                if entry.get("content"):
                    relations.append(f"Collection: {entry['content']}")
        
        return relations
    
    def _extract_coverage(self, indexed: dict, freetext: dict) -> List[str]:
        """Extract spatial/temporal coverage."""
        coverage = []
        
        # Places
        if "place" in indexed:
            for place in indexed["place"]:
                if place.get("content"):
                    coverage.append(f"Place: {place['content']}")
        
        # Geographic location from freetext
        if "place" in freetext:
            for place in freetext["place"]:
                if place.get("content"):
                    coverage.append(f"Place: {place['content']}")
        
        # Date ranges could also be coverage
        if "date" in indexed:
            for date_entry in indexed["date"]:
                if date_entry.get("content"):
                    coverage.append(f"Date: {date_entry['content']}")
        
        return coverage
    
    def _extract_rights(self, descriptive: dict, freetext: dict) -> Optional[str]:
        """Extract rights information."""
        rights_parts = []
        
        # Online media rights
        if "online_media" in descriptive and "media" in descriptive["online_media"]:
            for media in descriptive["online_media"]["media"]:
                if "usage" in media and "access" in media["usage"]:
                    rights_parts.append(f"Access: {media['usage']['access']}")
        
        # Credit line
        if "creditLine" in freetext:
            for entry in freetext["creditLine"]:
                if entry.get("content"):
                    rights_parts.append(f"Credit: {entry['content']}")
        
        return "; ".join(rights_parts) if rights_parts else "Contact Institution for Rights Information"
