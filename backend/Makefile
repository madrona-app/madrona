.PHONY: help setup install run migrate test test-integration clean lint format lint-migrations

# Default target
help:
	@echo "Madrona Backend - Available commands:"
	@echo ""
	@echo "  make setup      - Create virtual environment and install dependencies"
	@echo "  make install    - Install dependencies only"
	@echo "  make run        - Run the API with reload (development only)"
	@echo "  make migrate    - Run database migrations"
	@echo "  make test       - Run test suite"
	@echo "  make test-integration - Run RLS integration tests (requires PostgreSQL)"
	@echo "  make lint       - Run linters (ruff, mypy)"
	@echo "  make format     - Format code (black, ruff)"
	@echo "  make clean      - Remove generated files and caches"
	@echo ""

# Setup virtual environment and install dependencies
#
# requirements.txt, not `pip install -e .`: pyproject's `dependencies` is
# deliberately empty (it exists for the dev extras and tool config), so an
# editable install gives you pytest and ruff but no FastAPI or SQLAlchemy.
setup:
	python3.12 -m venv venv
	. venv/bin/activate && pip install --upgrade pip
	. venv/bin/activate && pip install -r requirements.txt
	. venv/bin/activate && pip install -e ".[dev]"
	@echo ""
	@echo "Setup complete! Activate the virtual environment with:"
	@echo "  source venv/bin/activate"

# Install dependencies only
install:
	pip install -r requirements.txt
	pip install -e ".[dev]"

# Run the API with reload (development only).
#
# This used to be `python -m app.main`, a module that does not exist, behind a
# warning about a Flask server this project does not run. The ASGI app is
# app.asgi:application and the container entrypoint serves it with uvicorn.
run:
	./venv/bin/python -m uvicorn app.asgi:application --reload --port $${UVICORN_PORT:-8000}

# Run database migrations.
#
# Alembic, not Flask-Migrate. `flask db upgrade` has never worked on this
# project: there is no Flask app and no flask binary.
migrate:
	./venv/bin/python -m alembic upgrade head

# Create new migration
migrate-create:
	@read -p "Enter migration message: " msg; \
	./venv/bin/python -m alembic revision --autogenerate -m "$$msg"

# Generate schema and projections for a dataset
generate-schema:
	@if [ -z "$(DATASET_ID)" ]; then \
		echo "Error: DATASET_ID not specified"; \
		echo "Usage: make generate-schema DATASET_ID=<uuid>"; \
		exit 1; \
	fi
	PYTHONPATH=. python3 scripts/generate_dataset_schema.py $(DATASET_ID)

# Run tests.
#
# The suite is PostgreSQL-only; pytest exits immediately without
# TEST_DATABASE_URL. There is no SQLite tier.
test:
	@if [ -z "$$TEST_DATABASE_URL" ]; then \
		echo "Error: TEST_DATABASE_URL not set"; \
		echo "Usage: TEST_DATABASE_URL=postgresql+psycopg://user:pw@localhost:5432/madrona_test make test"; \
		exit 1; \
	fi
	./venv/bin/python -m pytest tests/ -v --cov=app --cov-report=term-missing

# Run RLS integration tests (requires PostgreSQL)
test-integration:
	@if [ -z "$(TEST_DATABASE_URL)" ]; then \
		echo "Error: TEST_DATABASE_URL not set"; \
		echo "Usage: TEST_DATABASE_URL=postgresql://madrona:pw@localhost/madrona_test make test-integration"; \
		exit 1; \
	fi
	./venv/bin/python -m pytest tests/postgres/test_rls_force_integration.py -v -m integration

# Lint migration files for RLS safety
lint-migrations:
	./venv/bin/python scripts/lint_migrations.py --changed

# Lint all migration files (including legacy)
lint-migrations-all:
	./venv/bin/python scripts/lint_migrations.py

# Lint for duplicate FastAPI route handlers (same method+path → silent shadowing)
lint-routes:
	PYTHONPATH=. ./venv/bin/python scripts/lint_route_collisions.py

# Run linters
lint:
	ruff check app/
	mypy app/

# Format code
format:
	black app/
	ruff check --fix app/

# Clean generated files
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true
	rm -rf dist/ build/
