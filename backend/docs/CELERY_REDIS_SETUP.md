# Background Task Processing: Celery + Redis

Madrona uses Celery with Redis for asynchronous background task processing, primarily for entity classification workflows.

## Architecture

```
┌─────────────┐         ┌─────────────┐         ┌──────────────┐
│ FastAPI API │────────▶│    Redis    │◀────────│Celery Worker │
│             │  queue  │   (broker)  │  fetch  │              │
└─────────────┘  tasks  └─────────────┘  tasks  └──────────────┘
                              │
                              │ results
                              ▼
                        ┌─────────────┐
                        │  PostgreSQL │
                        │             │
                        └─────────────┘
```

### Components

1. **Redis**: Message broker and result backend
   - Queues tasks from API
   - Stores task results and classification cache
   - Provides fast key-value storage

2. **Celery Worker**: Background task processor
   - Processes entity classification tasks
   - Can scale horizontally
   - Handles AI classification, caching, and heuristics

3. **FastAPI API**: Task producer
   - Enqueues classification tasks
   - Retrieves task results
   - Manages entity lifecycle

## Local Development Setup

### Prerequisites

```bash
# macOS
brew install redis

# Ubuntu/Debian
sudo apt-get install redis-server

# Or use Docker (see below)
```

### Quick Start

1. **Start background services:**
   ```bash
   ./start-background-services.sh start
   ```

   This will:
   - Start Redis (if not running)
   - Start Celery worker
   - Show service status

2. **Check status:**
   ```bash
   ./start-background-services.sh status
   ```

3. **View logs:**
   ```bash
   ./start-background-services.sh logs
   ```

4. **Stop services:**
   ```bash
   ./start-background-services.sh stop
   ```

### Manual Setup

If you prefer to start services manually:

```bash
# Start Redis
redis-server --daemonize yes

# Start Celery worker (from backend directory)
cd backend
source venv/bin/activate
celery -A app.celery_app worker --loglevel=info --pool=solo
```

## Docker Setup

The docker-compose configuration includes Redis and Celery worker services:

```bash
# Start all services (including Redis and Celery)
docker compose up -d

# View Celery worker logs
docker compose logs -f celery-worker

# Scale Celery workers
docker compose up -d --scale celery-worker=3
```

### Services

- **redis**: Message broker (port 6379)
- **celery-worker**: Background task processor
- **backend**: FastAPI API (connects to Redis)

## Configuration

### Environment Variables

```bash
# Backend (.env)
REDIS_URL=redis://localhost:6379/0  # Local development
REDIS_URL=redis://redis:6379/0       # Docker
```

### Celery Configuration

See `backend/app/celery_app.py` for configuration:

- Task serialization: JSON
- Task time limit: 5 minutes (300s)
- Worker prefetch: 4 tasks
- Pool: solo (dev), prefork (production)

## Task Implementation

## Task Implementation

### Creating Tasks

Tasks are defined in `backend/app/tasks/`:

```python
from app.celery_app import celery_app

@celery_app.task(name='app.tasks.classification.classify_entity')
def classify_entity(entity_id: str) -> dict:
    """Classify an entity in the background."""
    # Task implementation
    return {"entity_id": entity_id, "type": "person"}
```

### Queueing Tasks

From the API:

```python
from app.tasks.classification import classify_entity_task

# Queue task
task = classify_entity_task.delay(entity_id=str(entity.id))

# Check status
result = task.get(timeout=10)  # Blocks until complete
```

### API Endpoints

Classification tasks can be triggered via REST API:

```bash
# Classify entire dataset
POST /api/datasets/{id}/classify
{
  "force_ai": false  # Optional: skip heuristics/cache
}

# Classify single entity
POST /api/entities/{entity_key}/classify?organization_id={uuid}
{
  "force_ai": false
}

# Check classification status
GET /api/datasets/{id}/classification-status

# Get classification stats
GET /api/classification/stats?organization_id={uuid}
```

### Task Organization

```
backend/app/tasks/
├── __init__.py
└── classification.py  # Entity classification tasks
```

### Task Organization

```
backend/app/tasks/
├── __init__.py
└── classification.py  # Entity classification tasks
```

## Classification Tasks

### Available Tasks

1. **`classify_entity`**: Classify a single entity
   - Applies heuristics
   - Checks cache
   - Falls back to AI classification
   - Updates entity in database

2. **`classify_entities_batch`**: Classify multiple entities
   - Processes in batches
   - Optimized for bulk imports

### Classification Workflow

```
Entity → Heuristics (instant) → Cache (instant) → AI (2-5s) → Database
         ↓ 60% success          ↓ 30% success      ↓ 10%
```

### Classification Cache

Classifications are cached by payload structure:

```python
# Cache key based on field structure
signature = hash(sorted(payload.keys()))

# Cache hit → instant classification
# Cache miss → AI classification + cache update
```

## AI Configuration (Ollama)

### Installing Ollama

**macOS/Linux:**
```bash
curl https://ollama.ai/install.sh | sh
```

**Docker:**
```bash
docker run -d -p 11434:11434 --name ollama ollama/ollama
```

### Pulling Models

```bash
# For entity classification (fast, 7B model)
ollama pull llama2:7b

# For transformer generation (better quality, 13B model)
ollama pull codellama:13b
```

### Testing Ollama

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Test generation
curl http://localhost:11434/api/generate -d '{
  "model": "llama2:7b",
  "prompt": "Classify this as museum_object or person: {title: \"Mona Lisa\"}",
  "stream": false
}'
```

### Configuration

Set in `.env`:
```bash
# Ollama (local AI)
OLLAMA_BASE_URL=http://localhost:11434

# AI provider preference
AI_PROVIDER_PREFERENCE=ollama  # or "claude" or "auto"
```

### Performance Tuning

Ollama classification is optimized for parallel processing:
- **Model**: llama2:7b (fast, 4GB RAM)
- **Context window**: 512 tokens (reduced for speed)
- **Threads**: 4 per request (allows 4+ parallel workers)
- **Timeout**: 10s aggressive timeout

**Scaling:**
```bash
# Run multiple Celery workers for parallel AI processing
celery -A app.celery_app worker --concurrency=8 --loglevel=info
```

With 8 workers and Ollama, you can classify ~100-200 entities/minute.

## Monitoring

### Check Redis

```bash
# Connect to Redis CLI
redis-cli

# Check queue length
LLEN celery

# View cached classifications
KEYS classification:*

# Get worker stats
KEYS celery-task-meta-*
```

### Celery Monitoring

```bash
# Check worker status
celery -A app.celery_app inspect active

# Check registered tasks
celery -A app.celery_app inspect registered

# Get worker stats
celery -A app.celery_app inspect stats
```

### Flower (Optional Web UI)

```bash
# Install Flower
pip install flower

# Start Flower
celery -A app.celery_app flower

# Access at http://localhost:5555
```

## Production Considerations

### Scaling Workers

```yaml
# docker-compose.yml
celery-worker:
  # ...
  deploy:
    replicas: 4  # Run 4 workers
```

Or scale manually:
```bash
docker compose up -d --scale celery-worker=4
```

### Worker Pool

- **Development**: `--pool=solo` (single process)
- **Production**: `--pool=prefork` (multiprocess)

```bash
# Production worker command
celery -A app.celery_app worker \
  --loglevel=info \
  --pool=prefork \
  --concurrency=4 \
  --max-tasks-per-child=1000
```

### Redis Persistence

Redis is configured with AOF (Append-Only File) persistence:

```bash
# docker-compose.yml
redis:
  command: redis-server --appendonly yes
  volumes:
    - redis_data:/data
```

### Health Checks

Both Redis and Celery workers have health checks in docker-compose:

```yaml
redis:
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]

celery-worker:
  # Add health check via celery inspect
```

## Troubleshooting

### Worker Not Processing Tasks

```bash
# Check worker is running
celery -A app.celery_app inspect active

# Check Redis connection
redis-cli ping

# View worker logs
tail -f .logs/celery.log  # Local
docker compose logs -f celery-worker  # Docker
```

### Redis Connection Refused

```bash
# Check Redis is running
redis-cli ping

# Check REDIS_URL environment variable
echo $REDIS_URL

# Test connection
redis-cli -u redis://localhost:6379/0 ping
```

### Tasks Timing Out

Increase task time limits in `celery_app.py`:

```python
celery_app.conf.update(
    task_time_limit=600,  # 10 minutes
    task_soft_time_limit=540,  # 9 minutes
)
```

### Memory Leaks

Workers restart after processing many tasks:

```python
worker_max_tasks_per_child=1000  # Restart after 1000 tasks
```

## Testing

### Manual Testing

```python
# From a Python shell or a test
from app.tasks.classification import classify_entity

# Queue task
task = classify_entity.delay(entity_id="123")

# Check result
print(task.get(timeout=10))
```

### Integration Tests

See `backend/test_background_classification.py`:

```bash
# Run tests (requires Redis)
cd backend
pytest test_background_classification.py -v
```

## Migration from Old Worker

The old polling-based worker (`madrona.jobs.worker`) has been replaced with Celery:

- ❌ Old: Poll database every N seconds
- ✅ New: Event-driven with Redis queue

### Migration Checklist

- [x] Redis service added to docker-compose
- [x] Celery worker replaces old worker service
- [x] REDIS_URL environment variable configured
- [x] Classification tasks implemented
- [ ] Remove old `jobs/` directory (once fully migrated)
- [ ] Update API routes to queue Celery tasks

## References

- [Celery Documentation](https://docs.celeryq.dev/)
- [Redis Documentation](https://redis.io/docs/)
- [Celery Best Practices](https://docs.celeryq.dev/en/stable/userguide/tasks.html#best-practices)
