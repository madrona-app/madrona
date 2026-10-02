"""
HTTP utilities for connectors.

Provides retry logic, rate limiting, and common HTTP patterns.
"""

import time
import logging
from typing import Any, Optional, Callable
from functools import wraps
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


logger = logging.getLogger(__name__)


class HTTPClient:
    """
    HTTP client with retry logic and rate limiting.
    """
    
    def __init__(
        self,
        base_url: Optional[str] = None,
        headers: Optional[dict[str, str]] = None,
        timeout: int = 30,
        max_retries: int = 3,
        backoff_factor: float = 0.5,
    ):
        """
        Initialize HTTP client.
        
        Args:
            base_url: Base URL for all requests
            headers: Default headers to include in all requests
            timeout: Request timeout in seconds
            max_retries: Maximum number of retry attempts
            backoff_factor: Backoff multiplier for retries
        """
        self.base_url = base_url
        self.headers = headers or {}
        self.timeout = timeout
        
        # Configure session with retry strategy
        self.session = requests.Session()
        retry_strategy = Retry(
            total=max_retries,
            backoff_factor=backoff_factor,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS", "POST"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        self.session.headers.update(self.headers)
    
    def get(self, path: str, params: Optional[dict] = None, **kwargs) -> requests.Response:
        """
        Execute GET request.
        
        Args:
            path: URL path (relative to base_url if set)
            params: Query parameters
            **kwargs: Additional requests arguments
        
        Returns:
            Response object
        """
        url = self._build_url(path)
        kwargs.setdefault('timeout', self.timeout)
        response = self.session.get(url, params=params, **kwargs)
        response.raise_for_status()
        return response
    
    def post(self, path: str, data: Any = None, json: Any = None, **kwargs) -> requests.Response:
        """
        Execute POST request.
        
        Args:
            path: URL path
            data: Form data
            json: JSON payload
            **kwargs: Additional requests arguments
        
        Returns:
            Response object
        """
        url = self._build_url(path)
        kwargs.setdefault('timeout', self.timeout)
        response = self.session.post(url, data=data, json=json, **kwargs)
        response.raise_for_status()
        return response
    
    def _build_url(self, path: str) -> str:
        """Build full URL from path and base_url."""
        if self.base_url:
            return f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        return path
    
    def close(self):
        """Close the session."""
        self.session.close()


def rate_limit(calls_per_second: float):
    """
    Decorator to rate limit function calls.
    
    Args:
        calls_per_second: Maximum calls per second
    
    Example:
        @rate_limit(10)  # Max 10 calls per second
        def fetch_page(page_num):
            ...
    """
    min_interval = 1.0 / calls_per_second
    last_called = [0.0]
    
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            elapsed = time.time() - last_called[0]
            wait_time = min_interval - elapsed
            if wait_time > 0:
                time.sleep(wait_time)
            result = func(*args, **kwargs)
            last_called[0] = time.time()
            return result
        return wrapper
    return decorator
