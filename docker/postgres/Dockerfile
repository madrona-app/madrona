FROM pgvector/pgvector:0.8.7-pg16

# Add PostGIS
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        postgresql-16-postgis-3 \
        postgresql-16-postgis-3-scripts \
        awscli && \
    rm -rf /var/lib/apt/lists/*

# Init script: extensions, schemas, roles, grants (runs on first initdb)
COPY init-db.sh /docker-entrypoint-initdb.d/10-init-db.sh
RUN chmod +x /docker-entrypoint-initdb.d/10-init-db.sh
