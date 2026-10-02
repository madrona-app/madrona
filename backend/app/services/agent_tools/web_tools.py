"""
Web search and page fetch tools for the agent.

Allows the assistant to search the web and retrieve page content
for research tasks — artist bios, comparable objects at other institutions,
exhibition reviews, art historical context, etc.
"""

import logging

import requests

from app.services.agent_tools import AgentContext, ToolRegistry
from app.services.url_guard import UnsafeURLError, safe_get

logger = logging.getLogger(__name__)


def web_search(args: dict, ctx: AgentContext) -> dict:
    """Search the web using DuckDuckGo HTML search."""
    import re

    query = args.get("query", "").strip()
    if not query:
        return {"error": "query is required"}

    try:
        resp = requests.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            timeout=10,
            headers={"User-Agent": "Madrona/1.0 (museum knowledge assistant)"},
        )
        resp.raise_for_status()
        html = resp.text

        results = []

        # Parse result blocks from DuckDuckGo HTML response
        # Each result is in a <div class="result..."> with an <a> and snippet
        result_blocks = re.findall(
            r'<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>'
            r'.*?<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
            html,
            re.DOTALL,
        )

        for url, title_html, snippet_html in result_blocks[:8]:
            # Clean HTML tags
            title = re.sub(r'<[^>]+>', '', title_html).strip()
            snippet = re.sub(r'<[^>]+>', '', snippet_html).strip()

            # DuckDuckGo wraps URLs in a redirect — extract the actual URL
            if "uddg=" in url:
                import urllib.parse
                parsed = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                url = parsed.get("uddg", [url])[0]

            if title and snippet:
                results.append({
                    "title": title[:200],
                    "snippet": snippet[:400],
                    "url": url,
                })

        if not results:
            return {"results": [], "message": f"No results found for '{query}'."}

        return {"results": results, "query": query}

    except Exception as e:
        logger.warning("Web search failed: %s", e)
        return {"error": "Web search unavailable. Please try again."}


def fetch_webpage(args: dict, ctx: AgentContext) -> dict:
    """Fetch and extract text content from a URL."""
    url = args.get("url", "").strip()
    if not url:
        return {"error": "url is required"}

    if not url.startswith(("http://", "https://")):
        return {"error": "url must start with http:// or https://"}

    try:
        # safe_get blocks SSRF to internal/metadata addresses and revalidates
        # each redirect hop before fetching.
        try:
            resp = safe_get(
                url,
                timeout=15,
                headers={"User-Agent": "Madrona/1.0 (museum knowledge assistant)"},
            )
        except UnsafeURLError:
            return {"error": "That URL is not allowed."}
        resp.raise_for_status()

        content_type = resp.headers.get("Content-Type", "")
        if "html" not in content_type and "text" not in content_type:
            return {"error": f"Unsupported content type: {content_type}"}

        # Simple HTML-to-text extraction
        text = resp.text
        # Strip script and style tags
        import re
        text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
        # Strip all remaining tags
        text = re.sub(r'<[^>]+>', ' ', text)
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        # Extract title
        title_match = re.search(r'<title[^>]*>(.*?)</title>', resp.text, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else ""

        return {
            "url": url,
            "title": title[:200],
            "content": text[:3000],
            "content_length": len(text),
        }

    except requests.Timeout:
        return {"error": "Request timed out"}
    except requests.RequestException as e:
        logger.warning("Webpage fetch failed for %s: %s", url, e)
        return {"error": f"Could not fetch URL: {str(e)[:200]}"}


def register_web_tools(registry: ToolRegistry) -> None:
    """Register web search and fetch tools."""
    registry.register(
        name="web_search",
        description=(
            "Search the web for information — artist biographies, comparable objects "
            "at other institutions, exhibition reviews, auction records, art historical "
            "context, conservation techniques, or any other external information. Use this "
            "when a question goes beyond the collection database and uploaded documents."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query (e.g., 'Mustafa ibn Vali Ottoman miniaturist')",
                },
            },
            "required": ["query"],
        },
        handler=web_search,
        personas=["staff", "visitor", "guide"],
    )

    registry.register(
        name="fetch_webpage",
        description=(
            "Fetch and read the text content of a specific web page. Use this when "
            "someone shares a URL and asks about its contents, or when a web search "
            "returns a promising link that needs more detail."
        ),
        parameters={
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Full URL to fetch (must start with http:// or https://)",
                },
            },
            "required": ["url"],
        },
        handler=fetch_webpage,
        personas=["staff", "guide"],
    )
