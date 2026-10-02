"""
Pagination utilities for connectors.

Common patterns for paginating through API results.
"""

from typing import Any, Iterator, Callable, Optional
import logging


logger = logging.getLogger(__name__)


def paginate_offset_limit(
    fetch_page: Callable[[int, int], dict[str, Any]],
    limit: int = 100,
    max_pages: Optional[int] = None,
    results_key: str = 'results',
    total_key: Optional[str] = None,
) -> Iterator[dict[str, Any]]:
    """
    Paginate using offset/limit pattern.
    
    Args:
        fetch_page: Function that takes (offset, limit) and returns page response
        limit: Number of records per page
        max_pages: Maximum number of pages to fetch (None = unlimited)
        results_key: Key in response containing results array
        total_key: Optional key containing total count
    
    Yields:
        Individual records from all pages
    """
    offset = 0
    page_num = 0
    
    while True:
        if max_pages and page_num >= max_pages:
            logger.info(f"Reached max_pages limit: {max_pages}")
            break
        
        logger.debug(f"Fetching page {page_num + 1} (offset={offset}, limit={limit})")
        response = fetch_page(offset, limit)
        
        results = response.get(results_key, [])
        if not results:
            logger.info(f"No more results at offset {offset}")
            break
        
        for record in results:
            yield record
        
        # Check if we've reached the end
        if len(results) < limit:
            logger.info(f"Received {len(results)} results (less than limit {limit}), ending pagination")
            break
        
        # Check total count if provided
        if total_key and total_key in response:
            total = response[total_key]
            if offset + len(results) >= total:
                logger.info(f"Fetched all {total} records")
                break
        
        offset += limit
        page_num += 1


def paginate_cursor(
    fetch_page: Callable[[Optional[str]], dict[str, Any]],
    results_key: str = 'results',
    next_cursor_key: str = 'next_cursor',
    max_pages: Optional[int] = None,
) -> Iterator[dict[str, Any]]:
    """
    Paginate using cursor pattern.
    
    Args:
        fetch_page: Function that takes cursor (None for first page) and returns response
        results_key: Key in response containing results array
        next_cursor_key: Key in response containing next cursor value
        max_pages: Maximum number of pages to fetch (None = unlimited)
    
    Yields:
        Individual records from all pages
    """
    cursor = None
    page_num = 0
    
    while True:
        if max_pages and page_num >= max_pages:
            logger.info(f"Reached max_pages limit: {max_pages}")
            break
        
        logger.debug(f"Fetching page {page_num + 1} (cursor={cursor})")
        response = fetch_page(cursor)
        
        results = response.get(results_key, [])
        if not results:
            logger.info("No more results")
            break
        
        for record in results:
            yield record
        
        # Get next cursor
        cursor = response.get(next_cursor_key)
        if not cursor:
            logger.info("No next cursor, ending pagination")
            break
        
        page_num += 1


def paginate_page_number(
    fetch_page: Callable[[int], dict[str, Any]],
    start_page: int = 1,
    max_pages: Optional[int] = None,
    results_key: str = 'results',
    total_pages_key: Optional[str] = None,
) -> Iterator[dict[str, Any]]:
    """
    Paginate using page number pattern.
    
    Args:
        fetch_page: Function that takes page number and returns response
        start_page: First page number (usually 0 or 1)
        max_pages: Maximum number of pages to fetch (None = unlimited)
        results_key: Key in response containing results array
        total_pages_key: Optional key containing total page count
    
    Yields:
        Individual records from all pages
    """
    page_num = start_page
    
    while True:
        if max_pages and (page_num - start_page) >= max_pages:
            logger.info(f"Reached max_pages limit: {max_pages}")
            break
        
        logger.debug(f"Fetching page {page_num}")
        response = fetch_page(page_num)
        
        results = response.get(results_key, [])
        if not results:
            logger.info(f"No more results at page {page_num}")
            break
        
        for record in results:
            yield record
        
        # Check total pages if provided
        if total_pages_key and total_pages_key in response:
            total_pages = response[total_pages_key]
            if page_num >= total_pages:
                logger.info(f"Reached last page ({total_pages})")
                break
        
        page_num += 1
