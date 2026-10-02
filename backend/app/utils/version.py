"""
Utility functions for retrieving application version and git information.
"""

import subprocess
from pathlib import Path

from app import __version__


def get_app_version() -> str:
    """
    Get the application version.
    
    Returns:
        Application version string (e.g., "1.0.0")
    """
    return __version__


def get_git_sha() -> str | None:
    """
    Get the current git SHA (short form).
    
    Returns:
        Git SHA string (7 characters) if available, None otherwise
    """
    try:
        # Get the path to the git repository root
        backend_dir = Path(__file__).parent.parent.parent
        result = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=backend_dir,
            capture_output=True,
            text=True,
            timeout=1,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    
    return None


def get_version_info() -> dict[str, str]:
    """
    Get version information for reproducibility tracking.
    
    Returns:
        Dictionary with 'app_version' and optionally 'git_sha'
    """
    info = {"app_version": get_app_version()}
    
    git_sha = get_git_sha()
    if git_sha:
        info["git_sha"] = git_sha
    
    return info
