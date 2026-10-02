"""
Provisioning saga service.

Runs organization provisioning as a step-by-step saga with per-step
persistence, idempotent steps, and retry-from-failure capability.
"""

import hashlib
import json
import logging
import re
import secrets
import string
from datetime import datetime, timezone, timedelta

from botocore.exceptions import ClientError
from sqlalchemy import update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models import (
    Application,
    Organization,
    OrganizationApplication,
    OrganizationInvitation,
    OrganizationMembership,
    ProvisioningAuditLog,
    Role,
    User,
    OrgProvisioningJob,
)
from app.services.cognito import (
    cognito_admin_create_user,
    get_cognito_service,
    CognitoAuthError,
    UserNotFoundError,
)
from app.services.email_service import get_email_service
from app.services.invitation_service import generate_invitation_token, INVITATION_EXPIRY_DAYS
from app.config import get_settings

logger = logging.getLogger(__name__)

PROVISIONING_STEPS = [
    "validate_input",
    "create_organization",
    "enable_applications",
    # Per-organization media configuration: tag vocabulary, watermark and
    # metadata templates. Not a sandbox step — every org needs it, and the
    # global boot seeds cannot provide it because there is no organization at
    # boot time.
    "seed_media_config",
    "create_admin_user",
    "create_cognito_user",
    "send_welcome_email",
    # Sandbox-only steps. All short-circuit to {skipped: true} when
    # request_payload.with_demo_data is false, so they're always part of
    # the saga but cost nothing on regular enterprise provisioning.
    # Phase 2 lands its sub-steps incrementally; Phase 3 adds media +
    # relationships.
    "seed_reference_data",
    "seed_collections_met",
    "seed_collections_smithsonian",
    "seed_collections_rijks",
    "seed_procedures_acquisitions",
    "seed_procedures_loans",
    "seed_procedures_exhibitions",
    "seed_procedures_conservation",
    "seed_procedures_condition_reports",
    # Build the OpenSearch indexes from the rows just seeded. Collections and
    # media list/search views read exclusively from OpenSearch, so without
    # this a freshly provisioned org shows empty lists ("no objects yet")
    # despite the data being in Postgres. Resumable: re-running the job retries
    # only this step if OpenSearch was transiently unavailable.
    "index_search",
    # Flip the org from 'pending' to 'active' — the very last thing, so a demo
    # org only becomes publicly visible once seeding AND indexing have both
    # succeeded. A no-op for regular orgs (already active). If any earlier step
    # fails, the org stays 'pending' (hidden) and can be torn down.
    "activate_organization",
]


def _generate_slug(name: str) -> str:
    """Generate a URL-safe slug from organization name."""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    slug = slug.strip('-')
    return slug[:50]


def _generate_temp_password(length: int = 16) -> str:
    """Generate a secure temporary password meeting Cognito requirements."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        password = ''.join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.isupper() for c in password) and
            any(c.islower() for c in password) and
            any(c.isdigit() for c in password) and
            any(c in "!@#$%^&*" for c in password)):
            return password


def compute_idempotency_key(slug: str, admin_email: str) -> str:
    """Compute idempotency key from slug and admin email."""
    return hashlib.sha256(f"{slug}|{admin_email}".encode()).hexdigest()


def compute_request_fingerprint(payload: dict) -> str:
    """
    Compute a fingerprint from the state-affecting subset of the payload.

    Canonicalizes: normalized slug, admin email, sorted application keys.
    Ignores fields that don't affect durable state (onboarding, csm info, etc.).
    """
    org_data = payload.get("organization", {})
    admin_data = payload.get("admin", {})
    apps_data = payload.get("applications", [])

    org_name = org_data.get("name", "").strip()
    org_slug = org_data.get("slug", "").strip() or _generate_slug(org_name)
    admin_email = admin_data.get("email", "").strip().lower()
    admin_name = admin_data.get("name", "").strip()

    # Sort applications by key for deterministic ordering
    canonical_apps = sorted(
        [
            {"key": a.get("key", "")}
            for a in apps_data
            if a.get("key")
        ],
        key=lambda a: a["key"],
    )

    # Contract dates affect state (they're stored on OrganizationApplication).
    # The Pydantic body allows `contract=None`; coerce to {} so `.get` is safe.
    contract = payload.get("contract") or {}
    canonical_contract = {
        "start_date": contract.get("start_date", ""),
        "end_date": contract.get("end_date", ""),
    }

    canonical = {
        "slug": org_slug,
        "admin_email": admin_email,
        "admin_name": admin_name,
        "applications": canonical_apps,
        "contract": canonical_contract,
        # with_demo_data affects durable state (seeded rows). Without it, a demo
        # re-request for an already-provisioned (non-demo) org dedupes to the
        # completed job and silently skips seeding, returning a false "success".
        "with_demo_data": bool(payload.get("with_demo_data", False)),
    }

    canonical_json = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode()).hexdigest()


class ProvisioningError(Exception):
    """Raised when a provisioning step fails."""

    def __init__(self, message: str, step: str):
        super().__init__(message)
        self.step = step


class PayloadMismatchError(Exception):
    """Raised when a new request has the same slug/email but different state-affecting payload."""

    def __init__(self, message: str, existing_job_id):
        super().__init__(message)
        self.existing_job_id = existing_job_id


class ConcurrentJobError(Exception):
    """Raised when a job is already running and cannot be claimed."""

    def __init__(self, message: str, job_id):
        super().__init__(message)
        self.job_id = job_id


class ProvisioningService:
    """Runs organization provisioning as an idempotent, retryable saga."""

    def __init__(self, session: Session, performer_id=None):
        self.session = session
        # Normalize to UUID object for SQLite compatibility
        if performer_id and isinstance(performer_id, str):
            import uuid as _uuid
            self.performer_id = _uuid.UUID(performer_id)
        else:
            self.performer_id = performer_id

    def _log_event(self, job: OrgProvisioningJob, action: str, details: dict | None = None):
        """
        Append an audit event to the job's event_log.

        Each event is a dict with action, actor_id, timestamp, and optional details.
        Never logs secrets (tokens, passwords, client_secrets).
        """
        event = {
            "action": action,
            "actor_id": str(self.performer_id) if self.performer_id else None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if details:
            event["details"] = details
        if job.event_log is None:
            job.event_log = []
        job.event_log = job.event_log + [event]  # new list to trigger change detection
        flag_modified(job, "event_log")

    def validate_only(self, request_payload: dict) -> dict:
        """
        Validate a provisioning payload without creating any DB records.

        Returns a dict with normalized values and warnings (slug taken,
        email already invited, unknown app keys, etc.).

        Never mutates the database, Cognito, or SES.
        """
        org_data = request_payload.get("organization", {})
        admin_data = request_payload.get("admin", {})
        apps_data = request_payload.get("applications", [])

        errors = []
        warnings = []

        # --- Required field validation ---
        org_name = (org_data.get("name") or "").strip()
        admin_email = (admin_data.get("email") or "").strip().lower()
        admin_name = (admin_data.get("name") or "").strip()

        if not org_name:
            errors.append("organization.name is required")
        if not admin_email:
            errors.append("admin.email is required")
        if not admin_name:
            errors.append("admin.name is required")

        if errors:
            return {"valid": False, "errors": errors, "warnings": []}

        org_slug = (org_data.get("slug") or "").strip() or _generate_slug(org_name)

        # --- Uniqueness checks (read-only queries) ---
        existing_org = self.session.query(Organization).filter_by(slug=org_slug).first()
        if existing_org:
            warnings.append(f"slug '{org_slug}' is already taken by organization {existing_org.organization_id}")

        existing_user = self.session.query(User).filter_by(email=admin_email).first()
        if existing_user:
            warnings.append(f"email '{admin_email}' already exists (user {existing_user.user_id}, status={existing_user.status})")

        existing_invite = (
            self.session.query(OrganizationInvitation)
            .filter_by(email=admin_email)
            .filter(OrganizationInvitation.used_at.is_(None))
            .first()
        )
        if existing_invite:
            warnings.append(f"email '{admin_email}' has an open invitation (id={existing_invite.invitation_id})")

        # --- Application key validation ---
        requested_app_keys = [a.get("key") for a in apps_data if a.get("key")]
        if requested_app_keys:
            known_apps = {
                a.key for a in self.session.query(Application).filter(Application.key.in_(requested_app_keys)).all()
            }
            unknown = set(requested_app_keys) - known_apps
            for key in unknown:
                warnings.append(f"application key '{key}' not found in catalog")

        return {
            "valid": True,
            "normalized": {
                "org_name": org_name,
                "org_slug": org_slug,
                "admin_email": admin_email,
                "admin_name": admin_name,
                "application_keys": requested_app_keys,
            },
            "warnings": warnings,
            "errors": [],
        }

    def create_job(self, request_payload: dict) -> OrgProvisioningJob:
        """
        Create a new provisioning job or return an existing one.

        Uses idempotency_key = sha256(slug|email) to detect duplicates.
        Uses request_fingerprint = sha256(canonical_payload) to detect
        payload mismatches on the same slug/email pair.

        Returns:
            OrgProvisioningJob (existing or new)

        Raises:
            ProvisioningError: If a job with the same key is currently running
            PayloadMismatchError: If slug/email match but state-affecting payload differs
        """
        org_data = request_payload.get("organization", {})
        admin_data = request_payload.get("admin", {})

        org_name = org_data.get("name", "").strip()
        org_slug = org_data.get("slug", "").strip() or _generate_slug(org_name)
        admin_email = admin_data.get("email", "").strip().lower()

        idem_key = compute_idempotency_key(org_slug, admin_email)
        fingerprint = compute_request_fingerprint(request_payload)

        # Check for existing job with this idempotency key
        existing = (
            self.session.query(OrgProvisioningJob)
            .filter_by(idempotency_key=idem_key)
            .first()
        )

        if existing:
            if existing.status == "running":
                raise ProvisioningError(
                    "A provisioning job for this organization is already running",
                    step="create_job",
                )
            # Payload-diff guard: reject if the state-affecting payload changed
            if existing.request_fingerprint and existing.request_fingerprint != fingerprint:
                raise PayloadMismatchError(
                    "Payload differs from existing job for this slug/email",
                    existing_job_id=existing.job_id,
                )
            # completed or failed — return as-is for the caller to decide
            return existing

        # Initialize step tracking
        steps = {}
        for step_key in PROVISIONING_STEPS:
            steps[step_key] = {
                "status": "pending",
                "started_at": None,
                "completed_at": None,
                "result": None,
                "error": None,
            }

        job = OrgProvisioningJob(
            idempotency_key=idem_key,
            request_fingerprint=fingerprint,
            status="pending",
            initiated_by=self.performer_id,
            request_payload=request_payload,
            steps=steps,
            organization_slug=org_slug,
            admin_email=admin_email,
            event_log=[],
        )
        self.session.add(job)
        self._log_event(job, "job_created", {
            "org_slug": org_slug,
            "admin_email": admin_email,
        })
        self.session.commit()

        return job

    def run_job(self, job: OrgProvisioningJob) -> OrgProvisioningJob:
        """
        Execute the provisioning saga, skipping already-completed steps.

        Uses an atomic status transition to prevent concurrent execution:
        UPDATE ... SET status='running' WHERE job_id=:id AND status IN ('pending','failed')
        If 0 rows affected, the job is already running elsewhere.

        On failure, persists the error state and raises ProvisioningError.
        """
        # Atomic claim: transition pending/failed → running
        result = self.session.execute(
            update(OrgProvisioningJob)
            .where(
                OrgProvisioningJob.job_id == job.job_id,
                OrgProvisioningJob.status.in_(["pending", "failed"]),
            )
            .values(
                status="running",
                started_at=job.started_at or datetime.now(timezone.utc),
                error_message=None,
                error_step=None,
            )
        )
        self.session.commit()

        if result.rowcount == 0:
            # Re-read to get current status
            self.session.refresh(job)
            raise ConcurrentJobError(
                f"Job {job.job_id} is already '{job.status}' and cannot be claimed",
                job_id=job.job_id,
            )

        # Refresh to pick up the atomic update values
        self.session.refresh(job)

        self._log_event(job, "job_started", {
            "retry_count": job.retry_count,
        })
        self.session.commit()

        step_methods = {
            "validate_input": self._step_validate_input,
            "create_organization": self._step_create_organization,
            "enable_applications": self._step_enable_applications,
            "seed_media_config": self._step_seed_media_config,
            "create_admin_user": self._step_create_admin_user,
            "create_cognito_user": self._step_create_cognito_user,
            "send_welcome_email": self._step_send_welcome_email,
            "seed_reference_data": self._step_seed_reference_data,
            "seed_collections_met": self._step_seed_collections_met,
            "seed_collections_smithsonian": self._step_seed_collections_smithsonian,
            "seed_collections_rijks": self._step_seed_collections_rijks,
            "seed_procedures_acquisitions": self._step_seed_procedures_acquisitions,
            "seed_procedures_loans": self._step_seed_procedures_loans,
            "seed_procedures_exhibitions": self._step_seed_procedures_exhibitions,
            "seed_procedures_conservation": self._step_seed_procedures_conservation,
            "seed_procedures_condition_reports": self._step_seed_procedures_condition_reports,
            "index_search": self._step_index_search,
            "activate_organization": self._step_activate_organization,
        }

        # PROVISIONING_STEPS and step_methods are two lists of the same thing,
        # so they can drift. Catch it here rather than part-way through the
        # saga: a missing handler would otherwise surface as a bare KeyError
        # after create_organization had already run, leaving an org stranded
        # in 'pending'.
        missing = [s for s in PROVISIONING_STEPS if s not in step_methods]
        if missing:
            raise ProvisioningError(
                f"No handler registered for provisioning step(s): {missing}"
            )

        for step_key in PROVISIONING_STEPS:
            # Cooperative cancellation: re-read the row at the top of each
            # iteration. If a platform admin called POST .../cancel while
            # the previous step was running, the DB now shows
            # status='failed' with error_step='cancelled' — exit cleanly
            # without touching status (so the cancel sticks) and without
            # raising (so the celery task records 'success' / no autoretry).
            self.session.refresh(job)
            if job.status == "failed" and job.error_step == "cancelled":
                self._log_event(job, "job_cancelled_observed", {
                    "interrupted_at_step": step_key,
                })
                self.session.commit()
                return job

            step_info = job.steps.get(step_key, {})
            if step_info.get("status") == "completed":
                continue

            # Mark step as running
            job.steps[step_key]["status"] = "running"
            job.steps[step_key]["started_at"] = datetime.now(timezone.utc).isoformat()
            job.current_step = step_key
            flag_modified(job, "steps")
            self._log_event(job, "step_started", {"step": step_key})
            self.session.commit()

            try:
                result = step_methods[step_key](job)

                # Mark step as completed
                job.steps[step_key]["status"] = "completed"
                job.steps[step_key]["completed_at"] = datetime.now(timezone.utc).isoformat()
                job.steps[step_key]["result"] = result
                flag_modified(job, "steps")
                self._log_event(job, "step_completed", {"step": step_key})
                self.session.commit()

            except Exception as e:
                # Mark step as failed
                error_msg = str(e)
                job.steps[step_key]["status"] = "failed"
                job.steps[step_key]["error"] = error_msg
                job.status = "failed"
                job.error_message = error_msg
                job.error_step = step_key
                job.current_step = step_key
                flag_modified(job, "steps")
                self._log_event(job, "step_failed", {
                    "step": step_key,
                    "error": error_msg,
                })
                self._log_event(job, "job_failed", {
                    "error_step": step_key,
                    "error": error_msg,
                })
                self.session.commit()

                raise ProvisioningError(error_msg, step=step_key) from e

        # All steps completed
        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
        job.current_step = None
        self._log_event(job, "job_completed")
        self.session.commit()

        return job

    # ------------------------------------------------------------------
    # Step implementations
    # ------------------------------------------------------------------

    def _step_validate_input(self, job: OrgProvisioningJob) -> dict:
        """Validate and normalize input fields."""
        data = job.request_payload
        org_data = data.get("organization", {})
        admin_data = data.get("admin", {})

        if not org_data.get("name"):
            raise ValueError("organization.name is required")
        if not admin_data.get("email"):
            raise ValueError("admin.email is required")
        if not admin_data.get("name"):
            raise ValueError("admin.name is required")

        org_name = org_data["name"].strip()
        org_slug = org_data.get("slug", "").strip() or _generate_slug(org_name)
        admin_email = admin_data["email"].strip().lower()

        # Update slug on job for later steps
        job.organization_slug = org_slug

        return {
            "org_name": org_name,
            "org_slug": org_slug,
            "admin_email": admin_email,
            "admin_name": admin_data["name"].strip(),
        }

    def _step_create_organization(self, job: OrgProvisioningJob) -> dict:
        """Create Organization record (idempotent: checks by slug)."""
        validated = job.steps["validate_input"].get("result", {})
        org_name = validated.get("org_name", job.request_payload["organization"]["name"].strip())
        org_slug = validated.get("org_slug", job.organization_slug)

        # Idempotency: check if org already exists from a previous partial run
        existing_org = self.session.query(Organization).filter_by(slug=org_slug).first()
        if existing_org:
            job.organization_id = existing_org.organization_id
            return {
                "organization_id": str(existing_org.organization_id),
                "already_existed": True,
            }

        # is_demo flag derived from the original request payload — sandbox
        # provisioning sets with_demo_data=True and we want the org to be
        # marked accordingly so the platform admin UI can filter for it
        # and so cleanup/lifecycle tooling treats it differently.
        is_demo = bool(job.request_payload.get("with_demo_data", False))

        # Demo orgs start 'pending' and are flipped to 'active' only by the
        # final activate_organization step — after seeding AND index_search
        # succeed. Organization.status=='active' is what the public Discover /
        # agent / MCP surfaces gate on, so a half-seeded or unindexed demo org
        # never becomes publicly visible. Regular (non-demo) orgs have nothing
        # to seed, so they go straight to 'active'.
        initial_status = "pending" if is_demo else "active"

        org = Organization(
            name=org_name,
            slug=org_slug,
            is_demo=is_demo,
            status=initial_status,
        )
        self.session.add(org)
        self.session.flush()

        job.organization_id = org.organization_id

        return {
            "organization_id": str(org.organization_id),
            "already_existed": False,
            "status": initial_status,
        }

    def _step_enable_applications(self, job: OrgProvisioningJob) -> dict:
        """Create OrganizationApplication records (idempotent: checks each subscription)."""
        data = job.request_payload
        # `data.get("contract", {})` is wrong when Pydantic stored
        # contract=None on the request — `.get(key, default)` returns the
        # *value*, not the default, when the key exists with a None
        # value. ProvisionOrganizationBody declares `contract: dict | None
        # = None`, so an absent contract section comes through as None
        # after model_dump(). `or {}` collapses both None and {} to {}.
        # (Same fix as the onboarding handling further down.)
        apps_data = data.get("applications") or []
        contract_data = data.get("contract") or {}
        org_id = job.organization_id

        enabled_apps = []
        enabled_app_names = []

        for app_config in apps_data:
            app_key = app_config.get("key")
            if not app_key:
                continue

            app = self.session.query(Application).filter_by(key=app_key).first()
            if not app:
                logger.warning(f"Application '{app_key}' not found, skipping")
                continue

            # Idempotency: check if subscription already exists
            existing_sub = (
                self.session.query(OrganizationApplication)
                .filter_by(organization_id=org_id, application_id=app.application_id)
                .first()
            )
            if existing_sub:
                enabled_apps.append(app_key)
                enabled_app_names.append(app.display_name)
                continue

            org_app = OrganizationApplication(
                organization_id=org_id,
                application_id=app.application_id,
                enabled=True,
                enabled_by=self.performer_id,
            )

            if contract_data.get("start_date"):
                org_app.contract_start_date = datetime.fromisoformat(
                    contract_data["start_date"]
                ).date()
            if contract_data.get("end_date"):
                org_app.contract_end_date = datetime.fromisoformat(
                    contract_data["end_date"]
                ).date()

            self.session.add(org_app)
            enabled_apps.append(app_key)
            enabled_app_names.append(app.display_name)

        self.session.flush()

        return {
            "enabled_apps": enabled_apps,
            "enabled_app_names": enabled_app_names,
        }

    def _step_create_admin_user(self, job: OrgProvisioningJob) -> dict:
        """Create User, OrganizationMembership, and OrganizationInvitation (idempotent)."""
        validated = job.steps["validate_input"].get("result", {})
        admin_email = validated.get(
            "admin_email",
            job.request_payload["admin"]["email"].strip().lower(),
        )
        admin_name = validated.get(
            "admin_name",
            job.request_payload["admin"]["name"].strip(),
        )
        org_id = job.organization_id

        # Idempotency: check if user already exists
        user = self.session.query(User).filter_by(email=admin_email).first()
        user_existed = user is not None

        if not user:
            user = User(
                email=admin_email,
                display_name=admin_name,
                status="invited",
            )
            self.session.add(user)
            self.session.flush()

        job.admin_user_id = user.user_id

        # Idempotency: check membership
        membership = (
            self.session.query(OrganizationMembership)
            .filter_by(organization_id=org_id, user_id=user.user_id)
            .first()
        )
        if not membership:
            admin_role = self.session.query(Role).filter_by(role_key="admin").first()
            membership = OrganizationMembership(
                organization_id=org_id,
                user_id=user.user_id,
                role="admin",
                role_id=admin_role.role_id if admin_role else None,
                status="active",
            )
            self.session.add(membership)

        # Idempotency: check invitation
        invitation = (
            self.session.query(OrganizationInvitation)
            .filter_by(organization_id=org_id, email=admin_email)
            .first()
        )
        invitation_token = None
        if not invitation:
            token = secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            expires_at = datetime.now(timezone.utc) + timedelta(days=7)

            invitation = OrganizationInvitation(
                organization_id=org_id,
                user_id=user.user_id,
                email=admin_email,
                token_hash=token_hash,
                role="admin",
                invited_by=self.performer_id,
                expires_at=expires_at,
            )
            self.session.add(invitation)
            invitation_token = token
        elif invitation.used_at is None:
            # Rotate the token on rerun. The original plaintext token is
            # only known at creation time (DB stores token_hash only), so
            # rerunning this step previously left `invitation_token=null`
            # in the result. That bubbled into `_step_send_welcome_email`
            # as `activation_url=""` — the welcome button and the direct
            # link both ended up blank. Issue a fresh token instead.
            token = secrets.token_urlsafe(32)
            invitation.token_hash = hashlib.sha256(token.encode()).hexdigest()
            invitation.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
            invitation_token = token

        # Log provisioning event
        try:
            apps_result = (job.steps.get("enable_applications") or {}).get("result") or {}
            log = ProvisioningAuditLog(
                action="org_created",
                performed_by=self.performer_id,
                organization_id=org_id,
                details={
                    "org_name": validated.get("org_name", ""),
                    "org_slug": job.organization_slug,
                    "admin_email": admin_email,
                    "apps_enabled": apps_result.get("enabled_apps", []),
                },
            )
            self.session.add(log)
        except Exception as e:
            logger.error(f"Failed to log provisioning event: {e}")

        self.session.flush()

        return {
            "admin_user_id": str(user.user_id),
            "user_already_existed": user_existed,
            "invitation_token": invitation_token,
            # Distinguishes "no token because the admin already accepted their
            # invitation" (used_at set → nothing to rotate, and an activation
            # link would be dead) from a genuine failure, so send_welcome_email
            # can skip gracefully instead of looping on "rerun create_admin_user"
            # forever (rerunning never rotates a token once used_at is set).
            "admin_already_activated": bool(invitation and invitation.used_at is not None),
        }

    def _step_create_cognito_user(self, job: OrgProvisioningJob) -> dict:
        """Create user in AWS Cognito (idempotent: UsernameExistsException = success)."""
        if get_settings().resolved_auth_provider == "local":
            # Local auth: no external identity store. The admin user gets a
            # password via the invitation/activate flow (writes password_hash).
            return {"skipped": "AUTH_PROVIDER=local — no Cognito user to create"}
        validated = job.steps["validate_input"].get("result", {})
        admin_email = validated.get(
            "admin_email",
            job.request_payload["admin"]["email"].strip().lower(),
        )

        temp_password = _generate_temp_password()
        already_existed = False

        try:
            cognito_admin_create_user(
                email=admin_email,
                temporary_password=temp_password,
                suppress_welcome=True,
            )
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "UsernameExistsException":
                already_existed = True
                logger.warning(f"Cognito user {admin_email} already exists, continuing")
            else:
                raise
        except CognitoAuthError as e:
            # CognitoService._handle_client_error() rewraps every ClientError
            # as a CognitoAuthError (the generic else-branch), so
            # UsernameExistsException never reaches us as a raw ClientError.
            # Treat the rewrap as the same idempotent outcome.
            if getattr(e, "code", None) == "UsernameExistsException":
                already_existed = True
                logger.warning(f"Cognito user {admin_email} already exists, continuing")
            else:
                raise

        return {
            "cognito_user_created": not already_existed,
            "already_existed": already_existed,
        }

    def _step_send_welcome_email(self, job: OrgProvisioningJob) -> dict:
        """Send SES welcome email with durable dedupe guard.

        On retry, if welcome_email_sent_at is already set on the job,
        the email was previously sent (even if the step-commit failed).
        Skip re-sending to avoid duplicate emails.
        """
        # A3: Durable dedupe — if email was already sent, skip
        if job.welcome_email_sent_at is not None:
            logger.info(
                f"Welcome email already sent at {job.welcome_email_sent_at} "
                f"for job {job.job_id}, skipping"
            )
            return {"email_sent": True, "skipped_dedupe": True}

        data = job.request_payload
        # Use .get(...) chains with `or {}` because step values may be None
        # when the step hasn't run yet or was stored without a result.
        validated = (job.steps.get("validate_input") or {}).get("result") or {}
        admin_user_result = (job.steps.get("create_admin_user") or {}).get("result") or {}
        apps_result = (job.steps.get("enable_applications") or {}).get("result") or {}

        admin_email = validated.get(
            "admin_email",
            data["admin"]["email"].strip().lower(),
        )
        admin_name = validated.get(
            "admin_name",
            data["admin"]["name"].strip(),
        )
        org_name = validated.get(
            "org_name",
            data["organization"]["name"].strip(),
        )

        # Build activation URL. If the create_admin_user step result has
        # no invitation_token (the prior version of that step set it to
        # null on the user-already-existed path), the welcome email
        # would otherwise send with a blank button + blank direct link.
        # Surface that as a step failure instead of silently mailing a
        # broken link — the operator can rerun create_admin_user to
        # rotate a fresh token.
        invitation_token = admin_user_result.get("invitation_token")
        if not invitation_token:
            if admin_user_result.get("admin_already_activated"):
                # The admin already accepted their invitation, so there's no
                # activation token to mint and the activation link would be
                # dead. The welcome/activation email is moot — complete the
                # step instead of failing (which the operator could only
                # "resolve" by rerunning create_admin_user, which can never
                # rotate a token once used_at is set: an unbreakable loop).
                logger.info(
                    "send_welcome_email: admin %s already activated for job %s — "
                    "skipping welcome email (no activation token to send)",
                    admin_email, job.job_id,
                )
                return {"email_sent": False, "skipped_already_activated": True}
            raise ProvisioningError(
                "send_welcome_email: no invitation_token from create_admin_user "
                "(rerun create_admin_user to rotate a fresh token)",
                step="send_welcome_email",
            )
        settings = get_settings()
        activation_url = f"{settings.app_base_url.rstrip('/')}/activate?token={invitation_token}"

        # Format onboarding datetime. `onboarding` may be explicitly None in
        # the payload (Pydantic `dict | None = None`), so coerce to {}.
        onboarding_data = data.get("onboarding") or {}
        onboarding_datetime = None
        if onboarding_data.get("scheduled_datetime"):
            try:
                dt = datetime.fromisoformat(onboarding_data["scheduled_datetime"])
                onboarding_datetime = dt.strftime("%A, %B %d, %Y at %I:%M %p %Z")
            except ValueError:
                onboarding_datetime = onboarding_data["scheduled_datetime"]

        email_service = get_email_service()
        email_sent = email_service.send_welcome_email(
            email=admin_email,
            user_name=admin_name,
            org_name=org_name,
            products=apps_result.get("enabled_app_names", []),
            activation_url=activation_url,
            onboarding_datetime=onboarding_datetime,
            csm_name=onboarding_data.get("csm_name"),
            csm_email=onboarding_data.get("csm_email"),
        )

        # A3: Durable marker — write BEFORE step-commit so it survives commit failure
        if email_sent:
            job.welcome_email_sent_at = datetime.now(timezone.utc)

        return {"email_sent": email_sent}

    # ------------------------------------------------------------------
    # Sandbox seeding — runs only when request_payload.with_demo_data
    # is true. Each step short-circuits to {skipped: true} otherwise.
    # Phase 2/3 will add seed_procedures, seed_media, seed_relationships.
    # ------------------------------------------------------------------

    @staticmethod
    def _sandbox_skip(reason: str = "with_demo_data=false") -> dict:
        return {"skipped": True, "reason": reason}

    def _step_seed_media_config(self, job: OrgProvisioningJob) -> dict:
        """Seed the org's media tag vocabulary and templates (idempotent)."""
        from seeds.seed_media_config import (
            seed_derivative_sizes,
            seed_tag_definitions,
            seed_templates,
        )

        # The UUID itself, not str(): organization_id is a UUID column.
        org_id = job.organization_id
        sizes = seed_derivative_sizes(self.session, org_id)
        tags = seed_tag_definitions(self.session, org_id)
        watermarks, metadata = seed_templates(self.session, org_id)
        logger.info(
            "Media config seeded for org %s: %d sizes, %d tags, %d watermark, "
            "%d metadata",
            org_id, sizes, tags, watermarks, metadata,
        )
        return {
            "skipped": False,
            "derivative_sizes": sizes,
            "tag_definitions": tags,
            "watermark_templates": watermarks,
            "metadata_templates": metadata,
        }

    def _step_seed_reference_data(self, job: OrgProvisioningJob) -> dict:
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        from app.services.sandbox_seeder import seed_reference_data

        result = seed_reference_data(
            self.session, job.organization_id, job.admin_user_id
        )
        logger.info(
            "Sandbox reference data seeded for org %s: %s",
            job.organization_id, result,
        )
        return {"skipped": False, **result}

    def _step_seed_collections_met(self, job: OrgProvisioningJob) -> dict:
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        # Backed by a checked-in JSON manifest — no Met API calls or
        # image downloads at provision time. Bootstrap done once via
        # backend/scripts/build_sandbox_manifest.py; image bytes live
        # at s3://madrona-media-{region}/sandbox-fixtures/met/<id>.jpg
        # and every sandbox's Media row references that shared key.
        from app.services.sandbox_seeder import seed_collections_from_manifest

        result = seed_collections_from_manifest(
            self.session,
            org_id=job.organization_id,
            admin_user_id=job.admin_user_id,
            source="met",
        )
        logger.info(
            "Sandbox Met collections seeded for org %s: %s",
            job.organization_id, result,
        )
        return {"skipped": False, **result}

    def _step_seed_collections_smithsonian(self, job: OrgProvisioningJob) -> dict:
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        # Manifest-driven. Skips gracefully if smithsonian-manifest.json
        # isn't shipped yet (the bootstrap requires SMITHSONIAN_API_KEY).
        from app.services.sandbox_seeder import seed_collections_from_manifest

        result = seed_collections_from_manifest(
            self.session,
            org_id=job.organization_id,
            admin_user_id=job.admin_user_id,
            source="smithsonian",
        )
        logger.info(
            "Sandbox Smithsonian collections seeded for org %s: %s",
            job.organization_id, result,
        )
        return {"skipped": False, **result}

    def _step_seed_collections_rijks(self, job: OrgProvisioningJob) -> dict:
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        # Manifest-driven. Skips gracefully if rijks-manifest.json isn't
        # shipped yet (the bootstrap doesn't need a key, but still has
        # to run once).
        from app.services.sandbox_seeder import seed_collections_from_manifest

        result = seed_collections_from_manifest(
            self.session,
            org_id=job.organization_id,
            admin_user_id=job.admin_user_id,
            source="rijks",
        )
        logger.info(
            "Sandbox Rijksmuseum collections seeded for org %s: %s",
            job.organization_id, result,
        )
        return {"skipped": False, **result}

    def _step_seed_procedures_acquisitions(self, job: OrgProvisioningJob) -> dict:
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        from app.services.sandbox_seeder import seed_acquisitions

        result = seed_acquisitions(
            self.session,
            org_id=job.organization_id,
            admin_user_id=job.admin_user_id,
        )
        logger.info(
            "Sandbox acquisitions seeded for org %s: %s",
            job.organization_id, result,
        )
        return {"skipped": False, **result}

    def _step_seed_procedures_loans(self, job: OrgProvisioningJob) -> dict:
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        from app.services.sandbox_seeder import seed_loans

        result = seed_loans(
            self.session,
            org_id=job.organization_id,
            admin_user_id=job.admin_user_id,
        )
        logger.info(
            "Sandbox loans seeded for org %s: %s",
            job.organization_id, result,
        )
        return {"skipped": False, **result}

    def _step_seed_procedures_exhibitions(self, job: OrgProvisioningJob) -> dict:
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        from app.services.sandbox_seeder import seed_exhibitions

        result = seed_exhibitions(
            self.session,
            org_id=job.organization_id,
            admin_user_id=job.admin_user_id,
        )
        logger.info(
            "Sandbox exhibitions seeded for org %s: %s",
            job.organization_id, result,
        )
        return {"skipped": False, **result}

    def _step_seed_procedures_conservation(self, job: OrgProvisioningJob) -> dict:
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        from app.services.sandbox_seeder import seed_conservation

        result = seed_conservation(
            self.session,
            org_id=job.organization_id,
            admin_user_id=job.admin_user_id,
        )
        logger.info(
            "Sandbox conservation seeded for org %s: %s",
            job.organization_id, result,
        )
        return {"skipped": False, **result}

    def _step_seed_procedures_condition_reports(self, job: OrgProvisioningJob) -> dict:
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        from app.services.sandbox_seeder import seed_condition_reports

        result = seed_condition_reports(
            self.session,
            org_id=job.organization_id,
            admin_user_id=job.admin_user_id,
        )
        logger.info(
            "Sandbox condition reports seeded for org %s: %s",
            job.organization_id, result,
        )
        return {"skipped": False, **result}

    def _step_index_search(self, job: OrgProvisioningJob) -> dict:
        """Build the OpenSearch collections + media indexes from seeded rows.

        Collections and media list/search views query OpenSearch exclusively,
        so an org whose rows live only in Postgres renders empty lists. Seeding
        bulk-inserts rows without firing the per-row index hooks, so we reindex
        the whole org here once seeding is done.

        Only meaningful when demo data was seeded; an org with no objects has
        nothing to index. Fails loudly (raises) if OpenSearch is unreachable or
        the index ends up partial/empty, so the saga never records a demo org
        "ready" over an unsearchable index. Resumable: re-run retries this step.
        """
        if not job.request_payload.get("with_demo_data"):
            return self._sandbox_skip()

        from app.search.collections.service import (
            CollectionsSearchService,
            get_collections_search_service,
        )
        from app.search.media.service import get_media_search_service

        # Lists/search read OpenSearch exclusively — a demo org is unusable
        # without it. Fail the step (resumable) rather than ship an empty index.
        if not CollectionsSearchService.is_available():
            raise ProvisioningError(
                "OpenSearch is unavailable; cannot index the demo org",
                step="index_search",
            )

        collections_svc = get_collections_search_service()
        media_svc = get_media_search_service()

        # A fresh cluster has neither index nor alias; create them first
        # (idempotent) so reindex doesn't hard-fail.
        collections_svc.setup_index()
        media_svc.setup_index()

        collections_stats = collections_svc.reindex_organization(
            self.session, job.organization_id
        )
        media_stats = media_svc.reindex_organization(
            self.session, job.organization_id
        )
        logger.info(
            "Search indexes built for org %s: collections=%s media=%s",
            job.organization_id, collections_stats, media_stats,
        )

        # Raise on a partial/empty index instead of recording the step green —
        # the per-doc failures the index managers collect as data are real.
        c_total = collections_stats.get("total", 0)
        c_indexed = collections_stats.get("indexed", 0)
        c_errors = collections_stats.get("errors") or []
        if c_indexed < c_total or c_errors:
            raise ProvisioningError(
                f"collections index incomplete: {c_indexed}/{c_total} indexed, "
                f"{len(c_errors)} error(s)",
                step="index_search",
            )
        if media_stats.get("failed", 0):
            raise ProvisioningError(
                f"media index incomplete: {media_stats.get('failed')} failed",
                step="index_search",
            )

        return {
            "skipped": False,
            "collections": collections_stats,
            "media": media_stats,
        }

    def _step_activate_organization(self, job: OrgProvisioningJob) -> dict:
        """Flip the org to 'active' — the final step, after seeding + indexing.

        Idempotent: a regular (non-demo) org is already 'active', so this is a
        no-op for it; a demo org created 'pending' becomes 'active' (and thus
        publicly visible) only now that every prior step has succeeded.
        """
        org = (
            self.session.query(Organization)
            .filter_by(organization_id=job.organization_id)
            .first()
        )
        if org is None:
            raise ProvisioningError(
                f"organization {job.organization_id} not found",
                step="activate_organization",
            )

        previous_status = org.status
        if org.status != "active":
            org.status = "active"
            self.session.flush()

        return {
            "organization_id": str(job.organization_id),
            "previous_status": previous_status,
            "status": "active",
            "activated": previous_status != "active",
        }

    # ------------------------------------------------------------------
    # B1: Resend invite
    # ------------------------------------------------------------------

    def _ensure_cognito_user(self, email: str) -> dict:
        """
        Ensure a Cognito user exists and is in a usable state.

        Returns a dict with keys:
            existed: bool — True if user already existed
            status: str — Cognito UserStatus after reconciliation
            actions: list[str] — corrective actions taken (if any)

        State handling:
            - UserNotFoundException → create the user
            - FORCE_CHANGE_PASSWORD → set temp password (permanent) to move to CONFIRMED
            - UNCONFIRMED → same treatment as FORCE_CHANGE_PASSWORD
            - CONFIRMED → no action needed
            - email_verified missing/false → set to true

        Raises ProvisioningError on unexpected Cognito failures.
        """
        if get_settings().resolved_auth_provider == "local":
            return {"existed": True, "status": "LOCAL", "actions": ["skipped: AUTH_PROVIDER=local"]}

        actions = []
        cognito_svc = get_cognito_service()

        try:
            response = cognito_svc.client.admin_get_user(
                UserPoolId=cognito_svc.user_pool_id,
                Username=email.lower(),
            )
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code != "UserNotFoundException":
                raise ProvisioningError(
                    f"Cognito lookup failed: {e}", step="ensure_cognito"
                ) from e

            # Create Cognito user (suppress welcome email — we send our own)
            temp_password = _generate_temp_password()
            try:
                cognito_admin_create_user(
                    email=email,
                    temporary_password=temp_password,
                    suppress_welcome=True,
                )
                return {"existed": False, "status": "FORCE_CHANGE_PASSWORD", "actions": ["created"]}
            except ClientError as e2:
                error_code = e2.response.get("Error", {}).get("Code", "")
                if error_code == "UsernameExistsException":
                    return {"existed": True, "status": "unknown", "actions": []}
                raise ProvisioningError(
                    f"Cognito user creation failed: {e2}", step="ensure_cognito"
                ) from e2

        # User exists — inspect status and attributes
        user_status = response.get("UserStatus", "UNKNOWN")
        attrs = {a["Name"]: a["Value"] for a in response.get("UserAttributes", [])}

        # Fix FORCE_CHANGE_PASSWORD or UNCONFIRMED by setting a temp password as permanent
        if user_status in ("FORCE_CHANGE_PASSWORD", "UNCONFIRMED"):
            temp_password = _generate_temp_password()
            try:
                cognito_svc.client.admin_set_user_password(
                    UserPoolId=cognito_svc.user_pool_id,
                    Username=email.lower(),
                    Password=temp_password,
                    Permanent=True,
                )
                user_status = "CONFIRMED"
                actions.append(f"reset_password_from_{response['UserStatus'].lower()}")
            except ClientError as e:
                logger.warning("Failed to fix Cognito state for %s: %s", email, e)

        # Ensure email_verified is true
        if attrs.get("email_verified") != "true":
            try:
                cognito_svc.client.admin_update_user_attributes(
                    UserPoolId=cognito_svc.user_pool_id,
                    Username=email.lower(),
                    UserAttributes=[{"Name": "email_verified", "Value": "true"}],
                )
                actions.append("set_email_verified")
            except ClientError as e:
                logger.warning("Failed to set email_verified for %s: %s", email, e)

        return {"existed": True, "status": user_status, "actions": actions}

    def resend_invite(
        self,
        job: OrgProvisioningJob,
        *,
        force: bool = False,
    ) -> dict:
        """
        Resend the activation invitation for a completed provisioning job.

        - Finds the admin user + org from the job.
        - Ensures Cognito user exists (creates if missing).
        - Finds or creates an OrganizationInvitation (token rotation if exists).
        - Sends the activation email.
        - Does NOT create duplicate user/membership.

        Args:
            job: A completed provisioning job.
            force: If True, resend even if recently sent (< 10 min ago).

        Returns:
            dict with job_id, organization_id, admin_user_id, email,
            invitation_id, sent_at, reused_token.

        Raises:
            ProvisioningError: If job is not completed or data is missing.
        """
        if job.status != "completed":
            raise ProvisioningError(
                f"Cannot resend invite for job with status '{job.status}'",
                step="resend_invite",
            )

        if not job.organization_id:
            raise ProvisioningError(
                "Job is missing organization_id — provisioning not far enough",
                step="resend_invite",
            )

        admin_email = job.admin_email or job.request_payload.get("admin", {}).get("email")
        if not admin_email:
            raise ProvisioningError(
                "Job has no admin_email",
                step="resend_invite",
            )

        # Look up admin user (by admin_user_id if set, else by email)
        user = None
        if job.admin_user_id:
            user = self.session.query(User).filter_by(user_id=job.admin_user_id).first()
        if not user:
            user = self.session.query(User).filter_by(email=admin_email.lower()).first()
        if not user:
            raise ProvisioningError(
                f"Admin user not found for email {admin_email}",
                step="resend_invite",
            )

        # If user is already active, no invite needed
        if user.status == "active":
            return {
                "admin_email": user.email,
                "organization_id": str(job.organization_id),
                "admin_user_id": str(user.user_id),
                "already_active": True,
                "sent_at": None,
            }

        org = self.session.query(Organization).filter_by(
            organization_id=job.organization_id
        ).first()
        if not org:
            raise ProvisioningError(
                f"Organization {job.organization_id} not found",
                step="resend_invite",
            )

        # Ensure Cognito user exists and is in a usable state
        cognito_result = self._ensure_cognito_user(user.email)
        cognito_existed = cognito_result["existed"]

        # Find existing unused invitation
        existing_invite = (
            self.session.query(OrganizationInvitation)
            .filter_by(
                organization_id=job.organization_id,
                email=user.email,
                used_at=None,
            )
            .order_by(OrganizationInvitation.created_at.desc())
            .first()
        )

        now = datetime.now(timezone.utc)

        # Rate-limit guard: don't resend if sent < 10 min ago (unless force)
        if existing_invite and not force:
            last_sent = existing_invite.last_sent_at or existing_invite.created_at
            if last_sent and last_sent.tzinfo is None:
                last_sent = last_sent.replace(tzinfo=timezone.utc)
            if last_sent:
                age = now - last_sent
                if age.total_seconds() < 600:  # 10 minutes
                    return {
                        "admin_email": user.email,
                        "organization_id": str(job.organization_id),
                        "admin_user_id": str(user.user_id),
                        "dedupe_skipped": True,
                        "last_sent_at": last_sent.isoformat(),
                    }

        # Token rotation: reuse existing invite record if valid, else create new
        token, token_hash = generate_invitation_token()
        expires_at = now + timedelta(days=INVITATION_EXPIRY_DAYS)
        reused_token = False

        invite_expiry = existing_invite.expires_at if existing_invite else None
        if invite_expiry and invite_expiry.tzinfo is None:
            invite_expiry = invite_expiry.replace(tzinfo=timezone.utc)

        if existing_invite and invite_expiry and invite_expiry > now:
            # Valid invite: rotate token + extend expiry
            existing_invite.token_hash = token_hash
            existing_invite.expires_at = expires_at
            existing_invite.invited_by = self.performer_id
            existing_invite.last_sent_at = now
            reused_token = True  # Reused the existing record (rotated token)
            invitation = existing_invite
        else:
            # Create new invitation (old one expired or missing)
            invitation = OrganizationInvitation(
                organization_id=job.organization_id,
                user_id=user.user_id,
                email=user.email,
                token_hash=token_hash,
                role="admin",
                invited_by=self.performer_id,
                expires_at=expires_at,
                last_sent_at=now,
            )
            self.session.add(invitation)

        self.session.commit()

        # Send email
        settings = get_settings()
        activation_url = f"{settings.app_base_url.rstrip('/')}/activate?token={token}"

        validated = (job.steps.get("validate_input") or {}).get("result") or {}
        admin_name = validated.get("admin_name", user.display_name or "")
        apps_result = (job.steps.get("enable_applications") or {}).get("result") or {}

        email_service = get_email_service()
        email_service.send_welcome_email(
            email=user.email,
            user_name=admin_name,
            org_name=org.name,
            products=apps_result.get("enabled_app_names", []),
            activation_url=activation_url,
            onboarding_datetime=None,
            csm_name=None,
            csm_email=None,
        )

        self._log_event(job, "resend_invite", {
            "admin_email": user.email,
            "reused_token": reused_token,
            "cognito_existed": cognito_existed,
            "force": force,
        })
        self.session.commit()

        return {
            "job_id": str(job.job_id),
            "organization_id": str(job.organization_id),
            "admin_user_id": str(user.user_id),
            "email": user.email,
            "invitation_id": str(invitation.invitation_id),
            "sent_at": now.isoformat(),
            "reused_token": reused_token,
            "expires_at": expires_at.isoformat(),
            "cognito_created": not cognito_existed,
        }

    # ------------------------------------------------------------------
    # B3: Reconcile partial provisioning state
    # ------------------------------------------------------------------

    def reconcile(self, job: OrgProvisioningJob) -> dict:
        """
        Fix partial provisioning states idempotently.

        Handles two mismatch cases:
        1. Cognito user exists but invitation is missing/expired → create new invite
        2. Invitation exists but Cognito user is missing → create Cognito user

        Does NOT create duplicate users, memberships, or organizations.
        Only runs "ensure" operations.

        Args:
            job: A provisioning job (completed or failed).

        Returns:
            dict with actions taken.
        """
        if not job.organization_id or not job.admin_user_id:
            raise ProvisioningError(
                "Job is missing organization_id or admin_user_id — "
                "cannot reconcile before these steps complete",
                step="reconcile",
            )

        user = self.session.query(User).filter_by(user_id=job.admin_user_id).first()
        if not user:
            raise ProvisioningError(
                f"Admin user {job.admin_user_id} not found in DB",
                step="reconcile",
            )

        org = self.session.query(Organization).filter_by(
            organization_id=job.organization_id
        ).first()
        if not org:
            raise ProvisioningError(
                f"Organization {job.organization_id} not found in DB",
                step="reconcile",
            )

        actions = []

        # --- Ensure membership exists ---
        membership = (
            self.session.query(OrganizationMembership)
            .filter_by(organization_id=job.organization_id, user_id=user.user_id)
            .first()
        )
        if not membership:
            admin_role = self.session.query(Role).filter_by(role_key="admin").first()
            membership = OrganizationMembership(
                organization_id=job.organization_id,
                user_id=user.user_id,
                role="admin",
                role_id=admin_role.role_id if admin_role else None,
                status="active",
            )
            self.session.add(membership)
            self.session.flush()
            actions.append("created_membership")

        # --- Ensure Cognito user exists and is in a usable state ---
        cognito_result = self._ensure_cognito_user(user.email)
        if not cognito_result["existed"]:
            actions.append("created_cognito_user")
        if cognito_result.get("actions"):
            actions.extend(cognito_result["actions"])

        # --- Ensure valid invitation exists ---
        now = datetime.now(timezone.utc)
        valid_invite = (
            self.session.query(OrganizationInvitation)
            .filter_by(
                organization_id=job.organization_id,
                email=user.email,
                used_at=None,
            )
            .filter(OrganizationInvitation.expires_at > now)
            .first()
        )

        # Only create invite if user is NOT already active
        invitation_ensured = valid_invite is not None
        if not valid_invite and user.status != "active":
            token, token_hash = generate_invitation_token()
            expires_at = now + timedelta(days=INVITATION_EXPIRY_DAYS)

            invitation = OrganizationInvitation(
                organization_id=job.organization_id,
                user_id=user.user_id,
                email=user.email,
                token_hash=token_hash,
                role="admin",
                invited_by=self.performer_id,
                expires_at=expires_at,
            )
            self.session.add(invitation)
            actions.append("created_invitation")
            invitation_ensured = True

        self._log_event(job, "reconcile", {
            "admin_email": user.email,
            "actions": actions,
        })
        self.session.commit()

        return {
            "job_id": str(job.job_id),
            "organization_id": str(job.organization_id),
            "admin_user_id": str(user.user_id),
            "admin_email": user.email,
            "cognito_user": "ensured",
            "invitation": "ensured" if invitation_ensured else "not_needed",
            "actions": actions,
            "user_status": user.status,
        }
