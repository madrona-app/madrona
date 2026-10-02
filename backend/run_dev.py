#!/usr/bin/env python3
"""
Development server using uvicorn with hot reload.

Runs the FastAPI ASGI app which mounts Flask as a fallback.

    python run_dev.py
    python run_dev.py --no-reload
"""

import sys

from dotenv import load_dotenv
load_dotenv()

import uvicorn

if __name__ == "__main__":
    reload = "--no-reload" not in sys.argv

    print("Starting development server with uvicorn...")
    uvicorn.run(
        "app.asgi:application",
        host="0.0.0.0",
        port=8000,
        reload=reload,
        reload_dirs=["app"] if reload else None,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
