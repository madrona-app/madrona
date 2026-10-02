#!/bin/bash
# Start Celery worker for background task processing
#
# Usage:
#   ./start-celery-worker.sh
#
# Requirements:
#   - Redis must be running (docker compose up redis, or local Redis)
#   - Environment variables in .env file

set -e

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Set default REDIS_URL if not set
export REDIS_URL=${REDIS_URL:-redis://localhost:6379/0}

echo "Starting Celery worker..."
echo "Redis URL: $REDIS_URL"
echo "Log Level: ${LOG_LEVEL:-INFO}"

# Start Celery worker with:
# - app.celery_app: The Celery application instance
# - --loglevel: Logging verbosity
# - --pool=solo: Single process mode (good for development/debugging)
#   Use --pool=prefork in production for better concurrency
# - --concurrency: Number of worker processes (default: number of CPUs)

celery -A app.celery_app worker \
    --loglevel=${LOG_LEVEL:-info} \
    --pool=solo \
    --max-tasks-per-child=1000
