"""
Configuration management for Madrona backend.

Uses pydantic-settings for type-safe configuration loaded from environment variables.
All configuration is immutable and validated at startup.
"""

import os
from typing import Literal

from pydantic import AliasChoices, Field, PostgresDsn, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Markers carried by every placeholder we ship in .env.example. A placeholder
# can be long enough to satisfy a length check and still be public knowledge,
# so length alone is not a strength test.
PLACEHOLDER_SECRET_MARKERS = ("change-this", "change-in-production", "changeme")


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_env: Literal["development", "production", "testing"] = Field(
        default="production",
        alias="APP_ENV",
        validation_alias=AliasChoices("APP_ENV", "FLASK_ENV"),
    )
    secret_key: str = Field(..., alias="SECRET_KEY")

    # Database
    database_url: PostgresDsn = Field(..., alias="DATABASE_URL")

    # Logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO", alias="LOG_LEVEL"
    )

    # Auth provider
    # "cognito" — AWS Cognito verifies credentials (hosted deployments).
    # "local"   — password_hash on the users table verifies credentials
    #             (self-hosted deployments; MFA endpoints return 501).
    # "auto"    — cognito when COGNITO_USER_POOL_ID is set, local otherwise.
    # Request auth is unaffected either way: the app always issues its own
    # HS256 access tokens + refresh cookies.
    auth_provider: Literal["auto", "cognito", "local"] = Field(
        default="auto", alias="AUTH_PROVIDER"
    )

    @property
    def resolved_auth_provider(self) -> str:
        if self.auth_provider != "auto":
            return self.auth_provider
        return "cognito" if os.environ.get("COGNITO_USER_POOL_ID") else "local"

    # Google OAuth (Application-wide credentials for OAuth flow)
    # These are OAuth CLIENT credentials, not connector-specific keys
    # Connectors store their own service account keys in connector_instances.config
    google_oauth_client_id: str = Field(default="", alias="GOOGLE_OAUTH_CLIENT_ID")
    google_oauth_client_secret: str = Field(default="", alias="GOOGLE_OAUTH_CLIENT_SECRET")
    google_oauth_redirect_uri: str = Field(
        default="http://localhost:5174/auth/google/callback",
        alias="GOOGLE_OAUTH_REDIRECT_URI"
    )
    

    # AI Services for transformer generation
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ai_provider_preference: Literal["claude", "ollama", "auto"] = Field(
        default="auto", alias="AI_PROVIDER_PREFERENCE"
    )  # auto = try Claude first, fallback to Ollama

    # Background task processing
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

    # Backup verification (no-op when empty — local dev environments)
    backup_s3_bucket: str = Field(default="", alias="BACKUP_S3_BUCKET")
    backup_alert_emails: str = Field(default="", alias="BACKUP_ALERT_EMAILS")

    # Redis Cache Settings
    redis_cache_enabled: bool = Field(default=True, alias="REDIS_CACHE_ENABLED")
    redis_connection_pool_size: int = Field(default=10, alias="REDIS_CONNECTION_POOL_SIZE")

    # Email
    # provider "ses" (AWS, hosted) or "smtp" (self-hosted; stdlib smtplib).
    # EMAIL_ENABLED=false logs instead of sending (activation links are
    # printed to the log) — the right setting for local dev either way.
    aws_region: str = Field(default="us-east-1", alias="AWS_REGION")
    email_provider: Literal["ses", "smtp"] = Field(default="ses", alias="EMAIL_PROVIDER")
    # Sender addresses, used by both the SES and SMTP providers. Empty means
    # "<local part>@<APP_BASE_URL host>" — see app/services/email_addresses.py.
    ses_accounts_from: str = Field(default="", alias="SES_ACCOUNTS_FROM")
    ses_notifications_from: str = Field(default="", alias="SES_NOTIFICATIONS_FROM")
    # Printed in email footers. Empty means support@<APP_BASE_URL host>.
    support_email: str = Field(default="", alias="SUPPORT_EMAIL")
    email_enabled: bool = Field(default=True, alias="EMAIL_ENABLED")
    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_user: str = Field(default="", alias="SMTP_USER")
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")
    smtp_starttls: bool = Field(default=True, alias="SMTP_STARTTLS")
    
    # Application URLs
    # Origin used to build the links in transactional email (verification,
    # password reset, MFA recovery). MUST be set per deployment: the default
    # only suits `dev-servers.sh`, where Vite serves 5174. Under compose the
    # app is on :80, so APP_BASE_URL is set there explicitly — without it every
    # emailed link pointed at a dev port that deployment does not serve.
    app_base_url: str = Field(default="http://localhost:5174", alias="APP_BASE_URL")

    # Security contact (for security.txt - RFC 9116)
    security_contact: str = Field(default="", alias="SECURITY_CONTACT")

    # Connectors - Org Overlay Resolution
    # When enabled, attempts to load org-specific connector implementations first
    # before falling back to shared core implementations
    connectors_use_org_overlay: bool = Field(
        default=False,
        alias="CONNECTORS_USE_ORG_OVERLAY"
    )

    # Scheduler
    scheduler_enabled: bool = Field(default=False, alias="SCHEDULER_ENABLED")
    scheduler_interval_seconds: int = Field(default=60, alias="SCHEDULER_INTERVAL_SECONDS")

    # Worker
    #
    # There used to be three settings here and the worker read none of them:
    # WORKER_POLL_INTERVAL (5) and WORKER_POLL_INTERVAL_SECONDS (10) were two
    # names for one thing, WORKER_MAX_RETRIES described a retry policy that is
    # a hardcoded exponential backoff in worker.py, and the only call site
    # passed its own literal anyway. Two of them were in .env.example, so an
    # operator could set them, watch nothing change, and have no way to tell
    # why. Only the interval survives, and start_worker now actually reads it.
    worker_enabled: bool = Field(default=False, alias="WORKER_ENABLED")
    worker_poll_interval_seconds: int = Field(default=10, alias="WORKER_POLL_INTERVAL_SECONDS")

    # Retention / Cleanup (days, 0 = keep forever)
    provisioning_job_retention_days: int = Field(default=180, alias="PROVISIONING_JOB_RETENTION_DAYS")
    audit_retention_days: int = Field(default=180, alias="AUDIT_RETENTION_DAYS")

    # Canonical Schema Validation (Phase 1: warn-only by default)
    # "warn" - Log validation errors but continue storing (Phase 1 rollout)
    # "error" - Reject invalid canonical payloads (Phase 2 enforcement)
    canonical_validation_mode: Literal["warn", "error"] = Field(
        default="warn", alias="CANONICAL_VALIDATION_MODE"
    )

    # OpenSearch Configuration
    opensearch_hosts: str = Field(default="localhost:9200", alias="OPENSEARCH_HOSTS")
    opensearch_user: str = Field(default="", alias="OPENSEARCH_USER")
    opensearch_password: str = Field(default="", alias="OPENSEARCH_PASSWORD")
    opensearch_use_ssl: bool = Field(default=False, alias="OPENSEARCH_USE_SSL")
    opensearch_verify_certs: bool = Field(default=True, alias="OPENSEARCH_VERIFY_CERTS")
    opensearch_enabled: bool = Field(default=True, alias="OPENSEARCH_ENABLED")

    # Database logging - False by default to reduce log noise
    sqlalchemy_echo: bool = Field(default=False, alias="SQLALCHEMY_ECHO")

    # Database connection pool tuning
    db_pool_size: int = Field(default=20, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=30, alias="DB_MAX_OVERFLOW")
    db_pool_recycle: int = Field(default=3600, alias="DB_POOL_RECYCLE")
    db_pool_timeout: int = Field(default=30, alias="DB_POOL_TIMEOUT")

    # ==========================================================================
    # API Configuration Defaults
    # ==========================================================================

    # S3 Signed URL Expiry (seconds)
    s3_url_expiry_seconds: int = Field(default=3600, alias="S3_URL_EXPIRY_SECONDS")
    s3_upload_url_expiry_seconds: int = Field(default=3600, alias="S3_UPLOAD_URL_EXPIRY_SECONDS")

    # Pagination Defaults
    pagination_default_limit: int = Field(default=50, alias="PAGINATION_DEFAULT_LIMIT")
    pagination_max_limit: int = Field(default=100, alias="PAGINATION_MAX_LIMIT")

    # Authentication Timeouts
    refresh_token_expiry_days: int = Field(default=30, alias="REFRESH_TOKEN_EXPIRY_DAYS")
    otp_expiry_hours: int = Field(default=1, alias="OTP_EXPIRY_HOURS")
    invitation_expiry_days: int = Field(default=7, alias="INVITATION_EXPIRY_DAYS")
    session_cache_ttl_seconds: int = Field(default=3600, alias="SESSION_CACHE_TTL_SECONDS")

    # File Upload Limits (bytes)
    max_logo_upload_bytes: int = Field(default=5 * 1024 * 1024, alias="MAX_LOGO_UPLOAD_BYTES")  # 5MB
    max_signature_upload_bytes: int = Field(default=2 * 1024 * 1024, alias="MAX_SIGNATURE_UPLOAD_BYTES")  # 2MB
    max_request_body_bytes: int = Field(default=10 * 1024 * 1024, alias="MAX_REQUEST_BODY_BYTES")  # 10MB

    # External API Configuration
    external_api_timeout_seconds: float = Field(default=3.0, alias="EXTERNAL_API_TIMEOUT_SECONDS")
    external_api_cache_ttl_minutes: int = Field(default=15, alias="EXTERNAL_API_CACHE_TTL_MINUTES")

    # HTTP Cache Headers (seconds)
    cache_control_private_seconds: int = Field(default=300, alias="CACHE_CONTROL_PRIVATE_SECONDS")  # 5 min
    cache_control_public_seconds: int = Field(default=3600, alias="CACHE_CONTROL_PUBLIC_SECONDS")  # 1 hour

    # ==========================================================================
    # Sentry (Error Tracking & Performance Monitoring)
    # ==========================================================================
    sentry_dsn: str = Field(default="", alias="SENTRY_DSN")
    sentry_environment: str = Field(default="", alias="SENTRY_ENVIRONMENT")
    sentry_traces_sample_rate: float = Field(default=0.1, alias="SENTRY_TRACES_SAMPLE_RATE")

    # ==========================================================================
    # DAM AI Features
    # ==========================================================================

    # CLIP Visual Search
    # AI auto-tagging (AWS Rekognition). Off by default: Rekognition is the
    # only provider, so a deployment without AWS credentials fires a failing
    # DetectLabels call for every uploaded image. Hosted deployments set
    # AI_TAGGING_ENABLED=true; the per-org MediaAIConfig toggles then apply
    # on top of it.
    ai_tagging_enabled: bool = Field(default=False, alias="AI_TAGGING_ENABLED")

    clip_enabled: bool = Field(default=False, alias="CLIP_ENABLED")
    clip_model_name: str = Field(default="ViT-B/32", alias="CLIP_MODEL_NAME")
    clip_device: str = Field(default="cpu", alias="CLIP_DEVICE")  # cpu or cuda
    clip_visual_search_threshold: float = Field(default=0.20, alias="CLIP_VISUAL_SEARCH_THRESHOLD")  # 0.0-1.0, higher = stricter

    # Whisper Transcription
    whisper_enabled: bool = Field(default=False, alias="WHISPER_ENABLED")
    whisper_model: str = Field(default="base", alias="WHISPER_MODEL")
    whisper_device: str = Field(default="cpu", alias="WHISPER_DEVICE")

    # AI Agent
    agent_enabled: bool = Field(default=False, alias="AGENT_ENABLED")
    agent_provider: Literal["ollama", "runpod", "claude"] = Field(default="ollama", alias="AGENT_PROVIDER")
    agent_model: str = Field(default="qwen2.5:14b", alias="AGENT_MODEL")
    agent_num_ctx: int = Field(default=32768, alias="AGENT_NUM_CTX")
    agent_max_tool_rounds: int = Field(default=5, alias="AGENT_MAX_TOOL_ROUNDS")
    agent_visitor_rate_limit: int = Field(default=20, alias="AGENT_VISITOR_RATE_LIMIT")
    agent_staff_buffered: bool = Field(default=False, alias="AGENT_STAFF_BUFFERED")
    # JSON map of persona -> model profile name (see services/model_profiles.py),
    # e.g. '{"visitor": "claude-haiku"}'. Org-level overrides live in the Guide
    # OrganizationApplication.config["llm_profiles"] and win over this.
    agent_persona_profiles: str = Field(default="", alias="AGENT_PERSONA_PROFILES")
    agent_debug_store_partial: bool = Field(default=False, alias="AGENT_DEBUG_STORE_PARTIAL")
    agent_visitor_retention_days: int = Field(default=90, alias="AGENT_VISITOR_RETENTION_DAYS")
    agent_staff_retention_days: int = Field(default=365, alias="AGENT_STAFF_RETENTION_DAYS")

    # Claude API (used when agent_provider=claude)
    agent_claude_model: str = Field(default="claude-haiku-4-5", alias="AGENT_CLAUDE_MODEL")
    agent_claude_max_tokens: int = Field(default=4096, alias="AGENT_CLAUDE_MAX_TOKENS")

    # RunPod Serverless (used when agent_provider=runpod)
    runpod_api_key: str = Field(default="", alias="RUNPOD_API_KEY")
    runpod_endpoint_id: str = Field(default="", alias="RUNPOD_ENDPOINT_ID")

    # Semantic Search (Ollama nomic-embed-text-v2-moe — multilingual, 768-dim Matryoshka)
    semantic_search_enabled: bool = Field(default=False, alias="SEMANTIC_SEARCH_ENABLED")
    semantic_search_model: str = Field(default="nomic-embed-text-v2-moe", alias="SEMANTIC_SEARCH_MODEL")
    semantic_search_dimensions: int = Field(default=768, alias="SEMANTIC_SEARCH_DIMENSIONS")

    # Embedding provider for semantic search + Guide RAG.
    #   "ollama" = local Ollama (dev only; unreachable in deployed envs)
    #   "voyage" = Voyage AI hosted API (remote — use in staging/prod)
    # When provider=voyage, semantic_search_dimensions is coerced to a Voyage-
    # supported output dimension (default 1024 for voyage-3.5) by the validator
    # below — the pgvector column dimension must match (see the reference_chunks
    # migration).
    embedding_provider: Literal["ollama", "voyage"] = Field(
        default="ollama", alias="EMBEDDING_PROVIDER"
    )
    voyage_api_key: str = Field(default="", alias="VOYAGE_API_KEY")
    voyage_model: str = Field(default="voyage-3.5", alias="VOYAGE_MODEL")

    # OCR (Tesseract)
    ocr_enabled: bool = Field(default=False, alias="OCR_ENABLED")
    ocr_languages: str = Field(default="eng", alias="OCR_LANGUAGES")

    # TUS Resumable Upload
    tus_enabled: bool = Field(default=False, alias="TUS_ENABLED")
    tus_endpoint: str = Field(default="http://localhost:1080/files/", alias="TUS_ENDPOINT")
    tus_webhook_secret: str = Field(default="", alias="TUS_WEBHOOK_SECRET")

    # Unoserver (LibreOffice headless for Office doc previews)
    unoserver_enabled: bool = Field(default=False, alias="UNOSERVER_ENABLED")
    unoserver_host: str = Field(default="localhost", alias="UNOSERVER_HOST")
    unoserver_port: int = Field(default=2003, alias="UNOSERVER_PORT")

    # ==========================================================================
    # Guide (Self-Serve AI Assistant)
    # ==========================================================================
    guide_app_url: str = Field(default="http://localhost:5175", alias="GUIDE_APP_URL")
    guide_free_trial_days: int = Field(default=14, alias="GUIDE_FREE_TRIAL_DAYS")


    # ==========================================================================
    # CORS Configuration
    # ==========================================================================
    # Comma-separated list of allowed origins for production
    # In development mode, localhost origins are automatically added
    cors_allowed_origins: str = Field(default="", alias="CORS_ALLOWED_ORIGINS")

    # Comma-separated list of allowed Host headers (Starlette TrustedHostMiddleware).
    # Empty = middleware disabled. Wildcards permitted (e.g. "*.example.com").
    # Production should set this to the real public hostnames; localhost is
    # required for the Docker HEALTHCHECK in entrypoint.sh.
    allowed_hosts_raw: str = Field(default="", alias="ALLOWED_HOSTS")

    @property
    def allowed_hosts(self) -> list[str]:
        if not self.allowed_hosts_raw:
            return []
        return [h.strip() for h in self.allowed_hosts_raw.split(",") if h.strip()]

    @property
    def cors_origins(self) -> list[str]:
        """
        Get list of allowed CORS origins.

        In production: Only origins from CORS_ALLOWED_ORIGINS env var.
        In development: CORS_ALLOWED_ORIGINS + localhost development servers.
        """
        origins = []
        if self.cors_allowed_origins:
            origins.extend([o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()])

        # Always allow the Guide app origin (standalone product on its own domain)
        if self.guide_app_url and self.guide_app_url not in origins:
            origins.append(self.guide_app_url)

        # Add localhost origins only in development mode
        if not self.is_production:
            dev_origins = [
                "http://localhost:5173",
                "http://localhost:5174",
                "http://localhost:5175",
                "http://localhost:3000",
            ]
            for origin in dev_origins:
                if origin not in origins:
                    origins.append(origin)

        return origins

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, v, info):
        """Enforce minimum SECRET_KEY strength in production."""
        env = info.data.get("app_env", "production")
        if env != "production":
            return v
        generate = (
            "Generate one with: "
            "python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
        if len(v) < 32:
            raise ValueError(
                f"SECRET_KEY must be at least 32 characters in production. {generate}"
            )
        lowered = v.lower()
        if any(marker in lowered for marker in PLACEHOLDER_SECRET_MARKERS):
            raise ValueError(
                "SECRET_KEY is still the placeholder value shipped in "
                f".env.example. {generate}"
            )
        return v

    @field_validator("database_url")
    @classmethod
    def validate_postgres_url(cls, v):
        """Ensure database URL is PostgreSQL."""
        if v.scheme not in ["postgresql", "postgresql+psycopg"]:
            raise ValueError("DATABASE_URL must be a PostgreSQL connection string")
        return v

    @model_validator(mode="after")
    def _coordinate_embedding_dimensions(self):
        """When using Voyage, force a supported output dimension.

        voyage-3.x supports 256/512/1024/2048 (Matryoshka). The nomic default
        of 768 is NOT valid for Voyage, so coerce to 1024 unless an explicit
        supported value was provided. This must stay in lockstep with the
        reference_chunks.embedding_vec pgvector column dimension.
        """
        if self.embedding_provider == "voyage":
            if self.semantic_search_dimensions not in (256, 512, 1024, 2048):
                object.__setattr__(self, "semantic_search_dimensions", 1024)
        return self

    @property
    def sqlalchemy_database_uri(self) -> str:
        """Get SQLAlchemy-compatible database URI."""
        return str(self.database_url)

    @property
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self.app_env == "production"

    @property
    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.app_env == "development"

    @property
    def is_testing(self) -> bool:
        """Check if running in test mode."""
        return self.app_env == "testing"


# Global settings instance
settings: Settings | None = None


def get_settings() -> Settings:
    """
    Get the global settings instance.
    
    Settings are loaded once at application startup and reused throughout the app lifecycle.
    """
    global settings
    if settings is None:
        settings = Settings()
    return settings
