# Multi-stage build for Madrona backend
# Stage 1: Build dependencies
FROM python:3.12-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    unixodbc-dev \
    postgresql-client \
    curl \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Microsoft ODBC Driver 18 for SQL Server (build stage)
RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies.
# INSTALL_ML=true additionally installs the optional CLIP/Whisper stack
# (torch + CUDA runtime, several GB). Off by default: both features are
# disabled unless CLIP_ENABLED / WHISPER_ENABLED are set, and their
# services import lazily behind that flag.
ARG INSTALL_ML=false
COPY requirements.txt requirements-ml.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt \
    && if [ "$INSTALL_ML" = "true" ]; then \
         pip install --no-cache-dir --user -r requirements-ml.txt; \
       fi

# Stage 2: Runtime
FROM python:3.12-slim

WORKDIR /app

# Install runtime dependencies including ODBC driver
# Also run upgrade to get latest security patches.
# APT_REFRESH_DATE is passed by CI as today's date so this layer's cache
# key rotates daily — without it Docker reuses a stale apt-upgrade layer
# when debian has since pushed CVE fixes.
ARG APT_REFRESH_DATE=unset
RUN echo "apt refresh: $APT_REFRESH_DATE" \
    && apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    postgresql-client \
    unixodbc \
    curl \
    gnupg \
    # WeasyPrint renders every PDF report (object record sheets, condition
    # reports, loan agreements) and binds to these at import time. Without them
    # the API accepts the job with a 202 and the worker dies on
    #   OSError: cannot load library 'libgobject-2.0-0'
    # so the UI shows the report as Failed with a connection error and nothing
    # says why. libglib2.0-0 provides libgobject; pango and harfbuzz do text
    # layout, cairo the drawing, gdk-pixbuf raster images, and dejavu gives it a
    # font to fall back on in a container with none.
    libglib2.0-0 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    shared-mime-info \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install Microsoft ODBC Driver 18 for SQL Server (runtime)
RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

# Create the non-root runtime user first so the dependency copy below can
# be owned by it. Installing to /root/.local and then switching to a
# non-root user leaves every package unreadable — the container cannot
# start at all (caught by cold-boot validation 2026-08-31).
RUN useradd -m -u 1000 madrona

# Copy Python dependencies from builder into the runtime user's home;
# python's user-site resolution (~/.local) finds them because HOME is
# /home/madrona once USER takes effect.
COPY --from=builder --chown=madrona:madrona /root/.local /home/madrona/.local
ENV PATH=/home/madrona/.local/bin:$PATH

# Copy application code
COPY . .

# Make entrypoint executable and hand the tree to the runtime user
RUN chmod +x /app/entrypoint.sh && chown -R madrona:madrona /app

USER madrona

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health', timeout=5)" || exit 1

# Run entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]
