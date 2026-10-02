#!/bin/bash
# Madrona Development Servers Management Script
# Usage: ./dev-servers.sh [start|stop|restart|status|logs]

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
PIDS_DIR="$PROJECT_ROOT/.pids"
LOGS_DIR="$PROJECT_ROOT/.logs"

# Ensure directories exist
mkdir -p "$PIDS_DIR" "$LOGS_DIR"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if process is running
is_running() {
    local pid_file=$1
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Start backend (FastAPI via uvicorn)
start_api() {
    log_info "Starting backend (uvicorn)..."

    if is_running "$PIDS_DIR/api.pid"; then
        log_warn "Backend is already running (PID: $(cat $PIDS_DIR/api.pid))"
        return 0
    fi

    cd "$BACKEND_DIR"

    # Activate virtual environment and start FastAPI via uvicorn
    (
        source venv/bin/activate
        nohup python run_dev.py > "$LOGS_DIR/api.log" 2>&1 &
        echo $! > "$PIDS_DIR/api.pid"
    )

    sleep 3

    if is_running "$PIDS_DIR/api.pid"; then
        log_success "Backend started on http://localhost:8000 via uvicorn (PID: $(cat $PIDS_DIR/api.pid))"
    else
        log_error "Failed to start backend. Check $LOGS_DIR/api.log"
        return 1
    fi
}

# Start Vite frontend
start_vite() {
    log_info "Starting Vite frontend..."
    
    if is_running "$PIDS_DIR/vite.pid"; then
        log_warn "Vite is already running (PID: $(cat $PIDS_DIR/vite.pid))"
        return 0
    fi
    
    cd "$FRONTEND_DIR"
    
    # Start Vite
    nohup npm run dev > "$LOGS_DIR/vite.log" 2>&1 &
    echo $! > "$PIDS_DIR/vite.pid"
    
    sleep 3
    
    if is_running "$PIDS_DIR/vite.pid"; then
        log_success "Vite started on http://localhost:5174 (PID: $(cat $PIDS_DIR/vite.pid))"
    else
        log_error "Failed to start Vite. Check $LOGS_DIR/vite.log"
        return 1
    fi
}


# Start Ollama server
start_ollama() {
    log_info "Starting Ollama server..."
    
    if is_running "$PIDS_DIR/ollama.pid"; then
        log_warn "Ollama is already running (PID: $(cat $PIDS_DIR/ollama.pid))"
        return 0
    fi
    
    # Check if ollama is installed
    if ! command -v ollama &> /dev/null; then
        log_error "Ollama is not installed. Install with: brew install ollama"
        return 1
    fi
    
    # Start Ollama server
    nohup ollama serve > "$LOGS_DIR/ollama.log" 2>&1 &
    echo $! > "$PIDS_DIR/ollama.pid"
    
    sleep 2
    
    if is_running "$PIDS_DIR/ollama.pid"; then
        log_success "Ollama started on http://localhost:11434 (PID: $(cat $PIDS_DIR/ollama.pid))"
        
        # Check if models are available
        if ! ollama list 2>/dev/null | grep -q "llama2"; then
            log_warn "llama2 model not found. Pull it with: ollama pull llama2:7b"
        fi
    else
        log_error "Failed to start Ollama. Check $LOGS_DIR/ollama.log"
        return 1
    fi
}

# Start Redis
start_redis() {
    log_info "Starting Redis..."
    
    # Check if Redis is already running
    if redis-cli ping &> /dev/null; then
        log_success "Redis is already running"
        return 0
    fi
    
    # Check if redis-server is installed
    if ! command -v redis-server &> /dev/null; then
        log_error "Redis is not installed. Install with: brew install redis"
        return 1
    fi
    
    # Try to start with brew services if available
    if command -v brew &> /dev/null && brew list redis &> /dev/null; then
        log_info "Starting Redis via brew services..."
        brew services start redis &> /dev/null
        sleep 2
    else
        # Start Redis server manually
        redis-server --daemonize yes --logfile "$LOGS_DIR/redis.log"
        sleep 1
    fi
    
    if redis-cli ping &> /dev/null; then
        log_success "Redis started (port 6379)"
    else
        log_error "Failed to start Redis. Check $LOGS_DIR/redis.log"
        return 1
    fi
}

# Start Celery worker
start_celery() {
    log_info "Starting Celery worker..."

    # Check for orphan Celery workers and kill them
    local orphan_pids=$(pgrep -f "celery -A app.celery_app" 2>/dev/null || true)
    if [ -n "$orphan_pids" ]; then
        log_warn "Found orphan Celery workers, killing them first..."
        pkill -f "celery -A app.celery_app" 2>/dev/null || true
        sleep 2
    fi

    if is_running "$PIDS_DIR/celery.pid"; then
        log_warn "Celery worker is already running (PID: $(cat $PIDS_DIR/celery.pid))"
        return 0
    fi

    cd "$BACKEND_DIR"

    # Check if virtual environment exists
    if [ ! -d "venv" ]; then
        log_error "Virtual environment not found at $BACKEND_DIR/venv"
        return 1
    fi

    # Activate virtual environment and start Celery with all queues
    # Queues: default, ai (AI features), media (image processing), reports, search (OpenSearch)
    # --pool=solo: avoid macOS fork-safety SIGSEGV crashes. Both prefork (segfaults
    #   in forked child during S3/network init) and threads (NSException from OpenGL
    #   kills entire worker) crash on macOS. Solo runs tasks sequentially in the
    #   main process — no fork, no thread-safety issues. Fine for local dev.
    (
        source venv/bin/activate
        OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES nohup celery -A app.celery_app worker --loglevel=info --pool=solo -Q default,ai,media,reports,search > "$LOGS_DIR/celery.log" 2>&1 &
        echo $! > "$PIDS_DIR/celery.pid"
    )

    sleep 3

    if is_running "$PIDS_DIR/celery.pid"; then
        log_success "Celery worker started (PID: $(cat $PIDS_DIR/celery.pid))"
        log_info "  Queues: default, ai, media, reports, search"
    else
        log_error "Failed to start Celery worker. Check $LOGS_DIR/celery.log"
        return 1
    fi
}

# Stop API backend
stop_api() {
    log_info "Stopping API backend..."

    if ! is_running "$PIDS_DIR/api.pid"; then
        log_warn "API is not running"
        rm -f "$PIDS_DIR/api.pid"
        return 0
    fi

    local pid=$(cat "$PIDS_DIR/api.pid")
    kill "$pid" 2>/dev/null || true

    # Wait for graceful shutdown
    local count=0
    while ps -p "$pid" > /dev/null 2>&1 && [ $count -lt 10 ]; do
        sleep 0.5
        count=$((count + 1))
    done

    # Force kill if still running
    if ps -p "$pid" > /dev/null 2>&1; then
        log_warn "Force killing API (PID: $pid)"
        kill -9 "$pid" 2>/dev/null || true
    fi

    rm -f "$PIDS_DIR/api.pid"
    log_success "API stopped"
}

# Stop Vite
stop_vite() {
    log_info "Stopping Vite frontend..."
    
    if ! is_running "$PIDS_DIR/vite.pid"; then
        log_warn "Vite is not running"
        rm -f "$PIDS_DIR/vite.pid"
        return 0
    fi
    
    local pid=$(cat "$PIDS_DIR/vite.pid")
    
    # Kill the process tree (npm and vite child processes)
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    
    # Wait for graceful shutdown
    local count=0
    while ps -p "$pid" > /dev/null 2>&1 && [ $count -lt 10 ]; do
        sleep 0.5
        count=$((count + 1))
    done
    
    # Force kill if still running
    if ps -p "$pid" > /dev/null 2>&1; then
        log_warn "Force killing Vite (PID: $pid)"
        kill -9 "$pid" 2>/dev/null || true
        pkill -9 -P "$pid" 2>/dev/null || true
    fi
    
    rm -f "$PIDS_DIR/vite.pid"
    log_success "Vite stopped"
}


# Stop Ollama
stop_ollama() {
    log_info "Stopping Ollama server..."
    
    if ! is_running "$PIDS_DIR/ollama.pid"; then
        log_warn "Ollama is not running"
        rm -f "$PIDS_DIR/ollama.pid"
        return 0
    fi
    
    local pid=$(cat "$PIDS_DIR/ollama.pid")
    kill "$pid" 2>/dev/null || true
    
    # Wait for graceful shutdown
    local count=0
    while ps -p "$pid" > /dev/null 2>&1 && [ $count -lt 10 ]; do
        sleep 0.5
        count=$((count + 1))
    done
    
    # Force kill if still running
    if ps -p "$pid" > /dev/null 2>&1; then
        log_warn "Force killing Ollama (PID: $pid)"
        kill -9 "$pid" 2>/dev/null || true
    fi
    
    rm -f "$PIDS_DIR/ollama.pid"
    log_success "Ollama stopped"
}

# Stop Redis
stop_redis() {
    log_info "Stopping Redis..."
    
    if ! redis-cli ping &> /dev/null; then
        log_warn "Redis is not running"
        return 0
    fi
    
    # Try graceful shutdown
    redis-cli shutdown &> /dev/null
    
    sleep 1
    
    # Check if stopped
    if ! redis-cli ping &> /dev/null; then
        log_success "Redis stopped"
    else
        # Redis might be managed by system service (brew services)
        if brew services list 2>/dev/null | grep -q "redis.*started"; then
            log_warn "Redis is running as a system service"
            log_info "Stop with: brew services stop redis"
            return 0
        else
            log_warn "Redis is still running (may be system-managed)"
            log_info "Note: Redis left running - use 'redis-cli shutdown' or 'brew services stop redis' if needed"
            return 0
        fi
    fi
}

# Stop Celery worker
stop_celery() {
    log_info "Stopping Celery worker..."

    # First, stop the tracked worker
    if is_running "$PIDS_DIR/celery.pid"; then
        local pid=$(cat "$PIDS_DIR/celery.pid")

        # Kill the process tree (celery and child workers)
        pkill -P "$pid" 2>/dev/null || true
        kill "$pid" 2>/dev/null || true

        # Wait for graceful shutdown
        local count=0
        while ps -p "$pid" > /dev/null 2>&1 && [ $count -lt 10 ]; do
            sleep 0.5
            count=$((count + 1))
        done

        # Force kill if still running
        if ps -p "$pid" > /dev/null 2>&1; then
            log_warn "Force killing Celery worker (PID: $pid)"
            kill -9 "$pid" 2>/dev/null || true
            pkill -9 -P "$pid" 2>/dev/null || true
        fi
    else
        log_warn "No tracked Celery worker found"
    fi

    rm -f "$PIDS_DIR/celery.pid"

    # Also kill any orphan Celery workers (important for stale workers with old code)
    local orphan_pids=$(pgrep -f "celery -A app.celery_app" 2>/dev/null || true)
    if [ -n "$orphan_pids" ]; then
        log_warn "Found orphan Celery workers, killing them..."
        pkill -f "celery -A app.celery_app" 2>/dev/null || true
        sleep 1
        # Force kill any remaining
        pkill -9 -f "celery -A app.celery_app" 2>/dev/null || true
    fi

    log_success "Celery worker stopped"
}

# Start OpenSearch (via Docker)
start_opensearch() {
    log_info "Starting OpenSearch..."

    # Check if OpenSearch is already running
    if curl -s "http://localhost:9200" &> /dev/null; then
        log_success "OpenSearch is already running"
        return 0
    fi

    # Check if docker is installed
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Install Docker Desktop from https://docker.com"
        return 1
    fi

    # OpenSearch is defined in the root compose file alongside everything else.
    # There used to be a second copy under docker/opensearch/ that declared the
    # same container_name and the same port, so the two could never run at once
    # — and that copy published 9200 and 5601 on every interface with the
    # security plugin disabled, where the root compose binds them to loopback.
    if [ ! -f "$PROJECT_ROOT/docker-compose.yml" ]; then
        log_error "docker-compose.yml not found at $PROJECT_ROOT"
        return 1
    fi

    log_info "Starting OpenSearch via Docker Compose..."
    cd "$PROJECT_ROOT"
    docker compose up -d opensearch > "$LOGS_DIR/opensearch.log" 2>&1

    # Wait for OpenSearch to be ready
    log_info "Waiting for OpenSearch to be ready..."
    local count=0
    while ! curl -s "http://localhost:9200" &> /dev/null && [ $count -lt 30 ]; do
        sleep 2
        count=$((count + 1))
    done

    if curl -s "http://localhost:9200" &> /dev/null; then
        log_success "OpenSearch started on http://localhost:9200"
    else
        log_error "Failed to start OpenSearch. Check $LOGS_DIR/opensearch.log"
        return 1
    fi
}

# Stop OpenSearch
stop_opensearch() {
    log_info "Stopping OpenSearch..."

    if [ ! -f "$PROJECT_ROOT/docker-compose.yml" ]; then
        log_warn "docker-compose.yml not found"
        return 0
    fi

    # Check if OpenSearch is running
    if ! curl -s "http://localhost:9200" &> /dev/null; then
        log_warn "OpenSearch is not running"
        return 0
    fi

    cd "$PROJECT_ROOT"
    # `stop opensearch`, NOT `down`: this file is now the root compose, and
    # `docker compose down` there would tear the entire stack down — postgres,
    # redis, seaweedfs and all — when the caller asked to stop one service.
    docker compose stop opensearch >> "$LOGS_DIR/opensearch.log" 2>&1

    sleep 2

    if ! curl -s "http://localhost:9200" &> /dev/null; then
        log_success "OpenSearch stopped"
    else
        log_warn "OpenSearch may still be running"
    fi
}

# Start all servers
start_all() {
    log_info "Starting all development servers..."
    start_redis
    start_opensearch
    start_ollama
    start_celery
    start_api
    start_vite
    echo ""
    show_status
}

# Stop all servers
stop_all() {
    log_info "Stopping all development servers..."
    stop_api
    stop_vite
    stop_celery
    stop_opensearch
    stop_redis
    stop_ollama
    log_success "All servers stopped"
}

# Restart all servers
restart_all() {
    log_info "Restarting all development servers..."
    stop_all
    sleep 1
    start_all
}

# Show server status
show_status() {
    echo -e "${BLUE}=== Development Servers Status ===${NC}"
    echo ""
    
    # API status
    if is_running "$PIDS_DIR/api.pid"; then
        local api_pid=$(cat "$PIDS_DIR/api.pid")
        echo -e "${GREEN}✓${NC} API: Running (PID: $api_pid)"
        echo "  URL: http://localhost:8000"
        echo "  Log: $LOGS_DIR/api.log"
    else
        echo -e "${RED}✗${NC} API: Stopped"
    fi
    
    echo ""
    
    # Vite status
    if is_running "$PIDS_DIR/vite.pid"; then
        local vite_pid=$(cat "$PIDS_DIR/vite.pid")
        echo -e "${GREEN}✓${NC} Vite: Running (PID: $vite_pid)"
        echo "  URL: http://localhost:5174"
        echo "  Log: $LOGS_DIR/vite.log"
    else
        echo -e "${RED}✗${NC} Vite: Stopped"
    fi

    echo ""

    # Redis status
    if redis-cli ping &> /dev/null; then
        echo -e "${GREEN}✓${NC} Redis: Running"
        echo "  Port: 6379"
        echo "  Log: $LOGS_DIR/redis.log"
    else
        echo -e "${RED}✗${NC} Redis: Stopped"
    fi

    echo ""

    # OpenSearch status
    if curl -s "http://localhost:9200" &> /dev/null; then
        local os_status=$(curl -s "http://localhost:9200/_cluster/health" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✓${NC} OpenSearch: Running (cluster: $os_status)"
        echo "  URL: http://localhost:9200"
        echo "  Log: $LOGS_DIR/opensearch.log"
    else
        echo -e "${RED}✗${NC} OpenSearch: Stopped"
    fi

    echo ""

    # Celery status
    if is_running "$PIDS_DIR/celery.pid"; then
        local celery_pid=$(cat "$PIDS_DIR/celery.pid")
        echo -e "${GREEN}✓${NC} Celery: Running (PID: $celery_pid)"
        echo "  Workers: 4 concurrent"
        echo "  Queues: default, ai, media, reports, search"
        echo "  Log: $LOGS_DIR/celery.log"
    else
        # Check for orphan workers
        local orphan_count=$(pgrep -f "celery -A app.celery_app" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$orphan_count" -gt 0 ]; then
            echo -e "${YELLOW}⚠${NC} Celery: Orphan workers detected ($orphan_count processes)"
            echo "  Run './dev-servers.sh celery restart' to clean up"
        else
            echo -e "${RED}✗${NC} Celery: Stopped"
        fi
    fi
    
    echo ""
    
    # Ollama status
    if is_running "$PIDS_DIR/ollama.pid"; then
        local ollama_pid=$(cat "$PIDS_DIR/ollama.pid")
        echo -e "${GREEN}✓${NC} Ollama: Running (PID: $ollama_pid)"
        echo "  URL: http://localhost:11434"
        echo "  Log: $LOGS_DIR/ollama.log"
        
        # Show available models
        if command -v ollama &> /dev/null; then
            local models=$(ollama list 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
            echo "  Models: $models available"
        fi
    else
        echo -e "${RED}✗${NC} Ollama: Stopped"
    fi
    
    echo ""
}

# Show logs
show_logs() {
    local service=${1:-all}
    
    case $service in
        api)
            log_info "Showing API logs (Ctrl+C to exit)..."
            tail -f "$LOGS_DIR/api.log" 2>/dev/null || log_error "API log not found"
            ;;
        vite)
            log_info "Showing Vite logs (Ctrl+C to exit)..."
            tail -f "$LOGS_DIR/vite.log" 2>/dev/null || log_error "Vite log not found"
            ;;
        redis)
            log_info "Showing Redis logs (Ctrl+C to exit)..."
            tail -f "$LOGS_DIR/redis.log" 2>/dev/null || log_error "Redis log not found"
            ;;
        celery)
            log_info "Showing Celery logs (Ctrl+C to exit)..."
            tail -f "$LOGS_DIR/celery.log" 2>/dev/null || log_error "Celery log not found"
            ;;
        ollama)
            log_info "Showing Ollama logs (Ctrl+C to exit)..."
            tail -f "$LOGS_DIR/ollama.log" 2>/dev/null || log_error "Ollama log not found"
            ;;
        opensearch)
            log_info "Showing OpenSearch logs (Ctrl+C to exit)..."
            docker logs -f madrona-opensearch 2>/dev/null || tail -f "$LOGS_DIR/opensearch.log" 2>/dev/null || log_error "OpenSearch log not found"
            ;;
        all|*)
            log_info "Showing all logs (Ctrl+C to exit)..."
            tail -f "$LOGS_DIR"/*.log 2>/dev/null || log_error "Logs not found"
            ;;
    esac
}

# Main command dispatcher
case "${1:-}" in
    start)
        start_all
        ;;
    stop)
        stop_all
        ;;
    restart)
        restart_all
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "${2:-both}"
        ;;
    api)
        case "${2:-}" in
            start) start_api ;;
            stop) stop_api ;;
            restart) stop_api && sleep 1 && start_api ;;
            logs) show_logs api ;;
            *) log_error "Usage: $0 api [start|stop|restart|logs]" ;;
        esac
        ;;
    vite)
        case "${2:-}" in
            start) start_vite ;;
            stop) stop_vite ;;
            restart) stop_vite && sleep 1 && start_vite ;;
            logs) show_logs vite ;;
            *) log_error "Usage: $0 vite [start|stop|restart|logs]" ;;
        esac
        ;;
    ollama)
        case "${2:-}" in
            start) start_ollama ;;
            stop) stop_ollama ;;
            restart) stop_ollama && sleep 1 && start_ollama ;;
            logs) show_logs ollama ;;
            *) log_error "Usage: $0 ollama [start|stop|restart|logs]" ;;
        esac
        ;;
    redis)
        case "${2:-}" in
            start) start_redis ;;
            stop) stop_redis ;;
            restart) stop_redis && sleep 1 && start_redis ;;
            logs) show_logs redis ;;
            *) log_error "Usage: $0 redis [start|stop|restart|logs]" ;;
        esac
        ;;
    celery)
        case "${2:-}" in
            start) start_celery ;;
            stop) stop_celery ;;
            restart) stop_celery && sleep 1 && start_celery ;;
            logs) show_logs celery ;;
            *) log_error "Usage: $0 celery [start|stop|restart|logs]" ;;
        esac
        ;;
    opensearch)
        case "${2:-}" in
            start) start_opensearch ;;
            stop) stop_opensearch ;;
            restart) stop_opensearch && sleep 3 && start_opensearch ;;
            logs) show_logs opensearch ;;
            *) log_error "Usage: $0 opensearch [start|stop|restart|logs]" ;;
        esac
        ;;
    *)
        echo "Madrona Development Servers Management"
        echo ""
        echo "Usage: $0 COMMAND [OPTIONS]"
        echo ""
        echo "Commands:"
        echo "  start          Start all servers (API, Vite, Redis, OpenSearch, Celery, Ollama)"
        echo "  stop           Stop all servers"
        echo "  restart        Restart all servers"
        echo "  status         Show server status"
        echo "  logs [SERVICE] Show logs (all|api|vite|redis|opensearch|celery|ollama)"
        echo ""
        echo "Individual Services:"
        echo "  api [start|stop|restart|logs]        Manage FastAPI backend"
        echo "  vite [start|stop|restart|logs]       Manage Vite frontend"
        echo "  redis [start|stop|restart|logs]      Manage Redis"
        echo "  opensearch [start|stop|restart|logs] Manage OpenSearch (Docker)"
        echo "  celery [start|stop|restart|logs]     Manage Celery worker"
        echo "  ollama [start|stop|restart|logs]     Manage Ollama AI server"
        echo ""
        echo "Examples:"
        echo "  $0 start              # Start all servers"
        echo "  $0 status             # Check status"
        echo "  $0 logs celery        # View Celery logs"
        echo "  $0 celery restart     # Restart Celery worker"
        exit 1
        ;;
esac
