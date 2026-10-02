"""
AI service for generating transformation code using Claude API or Ollama.

This service analyzes sample entity payloads and generates Python transformation code
to convert data into standard formats (Dublin Core, LIDO, Schema.org, etc.).

Architecture:
- Primary: Claude API (Anthropic) - highest quality
- Fallback: Ollama (local) - privacy-focused, no external API calls
- Auto mode: Try Claude first, fallback to Ollama if unavailable
"""
import json
import logging
from typing import Any, Dict, List, Optional

import requests
from anthropic import Anthropic, APIError

from app.config import get_settings

logger = logging.getLogger(__name__)

# Entity type taxonomy for classification
ENTITY_TYPE_TAXONOMY = [
    "museum_object",      # Physical museum objects, artifacts, artworks, specimens
    "collection",         # Collections or groups of related items
    "person",             # People, artists, donors, historical figures
    "organization",       # Organizations, institutions, companies
    "place",              # Geographic locations, sites
    "event",              # Historical events, exhibitions, performances
    "document",           # Textual records, manuscripts, archival materials
    "media",              # Digital media, photographs, audio, video
    "concept",            # Abstract concepts, subjects, themes
    "record",             # Generic/unclassified records
]

# Standard format specifications for prompt context
STANDARD_SPECS = {
    "dublin-core": """
Dublin Core 15 Elements:
1. title: Resource name
2. creator: Entity primarily responsible for making the resource
3. subject: Topic of the resource (keywords, classification codes)
4. description: Account of the resource (abstract, table of contents)
5. publisher: Entity responsible for making the resource available
6. contributor: Entity responsible for contributions to the resource
7. date: Point or period of time associated with the resource lifecycle
8. type: Nature or genre of the resource
9. format: File format, physical medium, or dimensions
10. identifier: Unambiguous reference to the resource (URI, ISBN, etc.)
11. source: Related resource from which the current resource is derived
12. language: Language of the resource content
13. relation: Related resource
14. coverage: Spatial or temporal topic of the resource
15. rights: Information about rights held in and over the resource

Output format: JSON object with these 15 keys (values can be strings, lists, or null)
""",
    
    "lido": """
LIDO (Lightweight Information Describing Objects) - XML schema for museum objects
Key elements:
- lidoRecID: Unique identifier
- objectWorkType: Classification (painting, sculpture, artifact, etc.)
- titleSet: Titles in multiple languages
- repositorySet: Current location/repository
- displayCreator/actorInRole: Creator/artist information
- eventSet: Events (creation, acquisition, exhibition, etc.)
- subjectConcept/subjectActor: Subject matter
- resourceSet: Digital representations (images, 3D models)
- rightsResource: Rights for digital resources

Output format: Python dict representing LIDO XML structure
""",
    
    "schema-org": """
Schema.org for Cultural Heritage - JSON-LD format
Primary types:
- CreativeWork (base type for all creative works)
- VisualArtwork (paintings, sculptures, prints)
- Photograph
- Article, Book, Manuscript

Key properties:
- @context: "https://schema.org"
- @type: Type of work
- name: Title
- creator: Person or Organization
- dateCreated: Creation date
- material: Materials used
- image: URL to image
- description: Description
- identifier: Unique ID
- location: Current location (Place)
- copyrightHolder: Rights holder
- license: License URL

Output format: JSON-LD dict with @context and @type
""",
    
    "cdwa": """
CDWA (Categories for the Description of Works of Art) - Getty standard for art object cataloging
Key categories:
- Object/Work: Core identification and classification
- Classification: Object type (painting, sculpture, photograph, etc.)
- Title: Titles and inscriptions
- Creation: Creator/artist, dates, places, culture
- Styles/Periods: Artistic movements and time periods
- Measurements: Physical dimensions
- Materials/Techniques: Physical characteristics and construction
- Subject Matter: Iconography, themes, depicted content
- Current Location: Repository, accession number
- Inscriptions/Marks: Text on object
- Related Works: Series, editions, versions
- Related Textual References: Publications, documentation
- Critical Responses: Interpretations and reviews
- Current Owner: Legal ownership information
- Rights: Copyright and usage rights

Output format: JSON object with nested CDWA categories
"""
}


class AIService:
    """Service for AI-powered code generation."""
    
    def __init__(self):
        self.settings = get_settings()
        self._anthropic_client: Optional[Anthropic] = None
    
    @property
    def anthropic_client(self) -> Optional[Anthropic]:
        """Lazy-load Anthropic client."""
        if self._anthropic_client is None and self.settings.anthropic_api_key:
            self._anthropic_client = Anthropic(api_key=self.settings.anthropic_api_key)
        return self._anthropic_client
    
    def generate_transformer(
        self,
        source_system: str,
        target_format: str,
        sample_payloads: List[Dict[str, Any]],
        entity_type: str = "record"
    ) -> tuple[str, str]:
        """
        Generate transformation code from sample payloads.
        
        Args:
            source_system: Name of source system (e.g., 'smithsonian')
            target_format: Target format (e.g., 'dublin-core')
            sample_payloads: 3-5 example entity payloads
            entity_type: Type of entities (for context)
            
        Returns:
            Tuple of (generated_code, ai_provider_used)
        """
        # Determine which AI provider to use
        provider = self._select_provider()
        
        if provider == "claude":
            return self._generate_with_claude(source_system, target_format, sample_payloads, entity_type)
        else:
            return self._generate_with_ollama(source_system, target_format, sample_payloads, entity_type)
    
    def _select_provider(self) -> str:
        """Determine which AI provider to use based on config and availability."""
        if self.settings.ai_provider_preference == "claude":
            if not self.settings.anthropic_api_key:
                logger.warning("Claude API key not configured, using Ollama fallback")
                return "ollama"
            return "claude"
        
        elif self.settings.ai_provider_preference == "ollama":
            return "ollama"
        
        else:  # auto
            if self.settings.anthropic_api_key:
                return "claude"
            else:
                logger.info("No Claude API key, using Ollama")
                return "ollama"
    
    def _generate_with_claude(
        self,
        source_system: str,
        target_format: str,
        sample_payloads: List[Dict[str, Any]],
        entity_type: str
    ) -> tuple[str, str]:
        """Generate transformer using Claude API."""
        if not self.anthropic_client:
            raise ValueError("Anthropic API client not initialized")
        
        prompt = self._build_prompt(source_system, target_format, sample_payloads, entity_type)
        
        try:
            logger.info(f"Generating {target_format} transformer with Claude API")
            
            response = self.anthropic_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=4096,
                temperature=0.2,  # Low temperature for consistent code generation
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )
            
            code = response.content[0].text
            
            # Extract code from markdown if wrapped
            code = self._extract_code_from_markdown(code)
            
            logger.info(f"Successfully generated {len(code)} characters of transformer code")
            return (code, "claude")
            
        except APIError as e:
            logger.error(f"Claude API error: {e}, falling back to Ollama")
            return self._generate_with_ollama(source_system, target_format, sample_payloads, entity_type)
        except Exception as e:
            logger.error(f"Unexpected error with Claude: {e}, falling back to Ollama")
            return self._generate_with_ollama(source_system, target_format, sample_payloads, entity_type)
    
    def _generate_with_ollama(
        self,
        source_system: str,
        target_format: str,
        sample_payloads: List[Dict[str, Any]],
        entity_type: str
    ) -> tuple[str, str]:
        """Generate transformer using Ollama (local)."""
        prompt = self._build_prompt(source_system, target_format, sample_payloads, entity_type)
        
        try:
            logger.info(f"Generating {target_format} transformer with Ollama")
            
            response = requests.post(
                f"{self.settings.ollama_base_url}/api/generate",
                json={
                    "model": "codellama:13b",
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.2,
                        "num_predict": 2048
                    }
                },
                timeout=120  # Code generation can be slow
            )
            
            if response.status_code != 200:
                raise RuntimeError(f"Ollama API returned {response.status_code}: {response.text}")
            
            data = response.json()
            code = data.get("response", "")
            
            # Extract code from markdown if wrapped
            code = self._extract_code_from_markdown(code)
            
            logger.info(f"Successfully generated {len(code)} characters with Ollama")
            return (code, "ollama")
            
        except requests.RequestException as e:
            logger.error(f"Ollama connection error: {e}")
            raise RuntimeError(
                f"Failed to connect to Ollama at {self.settings.ollama_base_url}. "
                "Make sure Ollama is running: https://ollama.ai"
            )
    
    def _build_prompt(
        self,
        source_system: str,
        target_format: str,
        sample_payloads: List[Dict[str, Any]],
        entity_type: str
    ) -> str:
        """Build prompt for AI code generation."""
        spec = STANDARD_SPECS.get(target_format, "")
        
        # Format sample payloads as pretty JSON
        samples_json = "\n\n".join([
            f"Sample {i+1}:\n```json\n{json.dumps(payload, indent=2)}\n```"
            for i, payload in enumerate(sample_payloads)
        ])
        
        prompt = f"""You are a data transformation expert. Generate Python code to transform {source_system} {entity_type} data into {target_format} format.

{spec}

Here are {len(sample_payloads)} example payloads from the {source_system} system:

{samples_json}

Generate a Python function called `transform(payload: dict) -> dict` that:
1. Takes a {source_system} payload (like the samples above)
2. Extracts and maps relevant fields to {target_format}
3. Returns a properly formatted {target_format} dict
4. Handles missing/null fields gracefully
5. Extracts nested data intelligently

Requirements:
- Function signature: def transform(payload: dict) -> dict:
- No imports needed (use only built-in Python)
- Handle edge cases (missing keys, empty values, etc.)
- Extract as much relevant data as possible
- Return properly structured {target_format} output
- Add inline comments explaining complex mappings

Return ONLY the Python function code, no explanation or markdown formatting."""
        
        return prompt
    
    def _extract_code_from_markdown(self, text: str) -> str:
        """Extract code from markdown code blocks if present."""
        # Remove markdown code fences (```python or ``` style)
        if "```python" in text:
            start = text.find("```python") + 9
            end = text.find("```", start)
            if end != -1:
                return text[start:end].strip()
        
        elif "```" in text:
            start = text.find("```") + 3
            end = text.find("```", start)
            if end != -1:
                return text[start:end].strip()
        
        # Remove [PYTHON] tags (Ollama format)
        if "[PYTHON]" in text:
            start = text.find("[PYTHON]") + 8
            end = text.find("[/PYTHON]", start)
            if end != -1:
                return text[start:end].strip()
        
        return text.strip()
    
    def detect_entity_type(self, record: Dict[str, Any], source_system: str = "unknown") -> str:
        """
        Detect entity type from a raw record using AI classification.
        
        Args:
            record: Raw record from source system
            source_system: Name of source system (for context)
            
        Returns:
            Detected entity_type from ENTITY_TYPE_TAXONOMY (defaults to 'record' on error)
        """
        # Extract only relevant fields for classification (reduce token count)
        record_summary = {
            "type": record.get("type"),
            "title": str(record.get("title", ""))[:200],  # Truncate long titles
            "descriptiveNonRepeating": record.get("content", {}).get("descriptiveNonRepeating", {}),
            "unit_code": record.get("unit_code")
        }
        
        # Build classification prompt
        prompt = f"""Classify this {source_system} record into ONE of these entity types:

{chr(10).join(f'- {et}' for et in ENTITY_TYPE_TAXONOMY)}

Record summary:
{json.dumps(record_summary, indent=2)}

Analyze the type, title, and metadata to determine the most appropriate entity type.

Respond with ONLY the entity_type (one word, lowercase, no explanation)."""
        
        try:
            # Try Claude first if available
            if self.anthropic_client:
                response = self.anthropic_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=50,
                    temperature=0,
                    messages=[{"role": "user", "content": prompt}]
                )
                entity_type = response.content[0].text.strip().lower()
                
                # Validate it's in taxonomy
                if entity_type in ENTITY_TYPE_TAXONOMY:
                    logger.info(f"Detected entity_type '{entity_type}' for {source_system} record")
                    return entity_type
                else:
                    logger.warning(f"Claude returned invalid entity_type '{entity_type}', using 'record'")
                    return "record"
            
            # Fallback to Ollama
            elif self.settings.ollama_base_url:
                ollama_url = f"{self.settings.ollama_base_url}/api/generate"
                response = requests.post(
                    ollama_url,
                    json={
                        "model": "llama2:7b",  # Smaller/faster model for classification
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": 0,
                            "num_predict": 5,  # Only need one word
                            "num_ctx": 512,  # Reduce context window for speed
                            "num_thread": 4,  # Limit threads per request for parallelism
                            "top_k": 10,  # Reduce sampling space
                            "top_p": 0.5,  # More focused predictions
                        }
                    },
                    timeout=10  # Aggressive timeout - classification should be fast
                )
                response.raise_for_status()
                entity_type = response.json()["response"].strip().lower()
                
                if entity_type in ENTITY_TYPE_TAXONOMY:
                    logger.info(f"Detected entity_type '{entity_type}' for {source_system} record (Ollama)")
                    return entity_type
                else:
                    logger.warning(f"Ollama returned invalid entity_type '{entity_type}', using 'record'")
                    return "record"
            
            else:
                logger.warning("No AI provider available for entity_type detection, using 'record'")
                return "record"
        
        except Exception as e:
            logger.error(f"Error detecting entity_type: {e}", exc_info=True)
            return "record"


# Singleton instance
_ai_service: Optional[AIService] = None


def get_ai_service() -> AIService:
    """Get the global AI service instance."""
    global _ai_service
    if _ai_service is None:
        _ai_service = AIService()
    return _ai_service
