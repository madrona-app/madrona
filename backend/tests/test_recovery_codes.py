"""
Tests for MFA recovery codes functionality.

Covers:
- Code generation and format
- Argon2id hashing (constant-time verification)
- One-time use (cannot reuse)
- Version invalidation on MFA reset
- Status retrieval
"""

import pytest
import time
from uuid import uuid4

from app.models import User, MfaRecoveryCode
from app.services.recovery_codes import (
    create_recovery_codes,
    verify_and_consume_recovery_code,
    invalidate_all_recovery_codes,
    get_recovery_code_status,
    _generate_code,
    _normalize_code,
    _hash_code,
    _verify_code_hash,
    CODE_CHARSET,
)


def _make_test_user(db_session):
    """Create a test user for recovery code tests."""
    user = User(
        email=f"recovery-test-{uuid4().hex[:8]}@example.com",
        status="active",
        mfa_version=0,
    )
    db_session.add(user)
    db_session.commit()
    return user


class TestCodeGeneration:
    """Tests for code generation format and randomness."""

    def test_code_format_is_xxxx_xxxx_xxxx(self):
        """Generated code follows XXXX-XXXX-XXXX format."""
        code = _generate_code()
        parts = code.split("-")

        assert len(parts) == 3
        assert all(len(part) == 4 for part in parts)
        assert len(code) == 14  # 4 + 1 + 4 + 1 + 4

    def test_code_uses_allowed_charset(self):
        """Generated code only uses allowed characters."""
        for _ in range(100):
            code = _generate_code()
            chars = code.replace("-", "")
            assert all(c in CODE_CHARSET for c in chars)

    def test_codes_are_unique(self):
        """Generated codes are highly likely to be unique."""
        codes = [_generate_code() for _ in range(1000)]
        unique_codes = set(codes)
        assert len(unique_codes) == len(codes)

    def test_code_normalization(self):
        """Code normalization handles various input formats."""
        expected = "ABCD1234EFGH"

        assert _normalize_code("ABCD-1234-EFGH") == expected
        assert _normalize_code("abcd-1234-efgh") == expected
        assert _normalize_code("  ABCD1234EFGH  ") == expected
        assert _normalize_code("ABCD 1234 EFGH") == expected
        assert _normalize_code("abcd1234efgh") == expected


class TestArgon2Hashing:
    """Tests for Argon2id hashing security properties."""

    def test_hash_is_not_plaintext(self):
        """Hashed code is not stored as plaintext."""
        code = "ABCD-1234-EFGH"
        hashed = _hash_code(code)

        assert code not in hashed
        assert "ABCD" not in hashed
        assert hashed.startswith("$argon2")

    def test_same_code_produces_different_hashes(self):
        """Same code produces different hashes (due to salt)."""
        code = "ABCD-1234-EFGH"
        hash1 = _hash_code(code)
        hash2 = _hash_code(code)

        assert hash1 != hash2

    def test_verify_correct_code(self):
        """Correct code verifies against its hash."""
        code = "ABCD-1234-EFGH"
        hashed = _hash_code(code)

        assert _verify_code_hash(code, hashed) is True

    def test_verify_wrong_code(self):
        """Wrong code fails verification."""
        code = "ABCD-1234-EFGH"
        hashed = _hash_code(code)

        assert _verify_code_hash("WXYZ-9876-MNOP", hashed) is False

    def test_verify_is_case_insensitive(self):
        """Verification is case-insensitive."""
        code = "ABCD-1234-EFGH"
        hashed = _hash_code(code)

        assert _verify_code_hash("abcd-1234-efgh", hashed) is True

    def test_verify_ignores_formatting(self):
        """Verification ignores dashes and spaces."""
        code = "ABCD-1234-EFGH"
        hashed = _hash_code(code)

        assert _verify_code_hash("ABCD1234EFGH", hashed) is True
        assert _verify_code_hash("ABCD 1234 EFGH", hashed) is True

    def test_constant_time_verification(self):
        """
        Verification uses constant-time comparison.

        This is inherent to Argon2's verify function, but we test
        that timing doesn't vary significantly between matches and mismatches.
        """
        code = "ABCD-1234-EFGH"
        hashed = _hash_code(code)

        start = time.perf_counter()
        for _ in range(100):
            _verify_code_hash(code, hashed)
        correct_time = time.perf_counter() - start

        start = time.perf_counter()
        for _ in range(100):
            _verify_code_hash("WXYZ-9876-MNOP", hashed)
        incorrect_time = time.perf_counter() - start

        ratio = max(correct_time, incorrect_time) / min(correct_time, incorrect_time)
        assert ratio < 1.5, f"Timing ratio {ratio} suggests non-constant time"


class TestCreateRecoveryCodes:
    """Tests for recovery code creation."""

    def test_creates_requested_number_of_codes(self, db_session):
        """Creates the requested number of codes."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=10)
        db_session.commit()

        assert len(codes) == 10

    def test_returns_plaintext_codes(self, db_session):
        """Returns codes in plaintext format."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=5)
        db_session.commit()

        for code in codes:
            parts = code.split("-")
            assert len(parts) == 3
            assert all(len(part) == 4 for part in parts)

    def test_increments_mfa_version(self, db_session):
        """Creating codes increments user's mfa_version."""
        user = _make_test_user(db_session)
        original_version = user.mfa_version

        create_recovery_codes(db_session, user.user_id)
        db_session.commit()

        db_session.refresh(user)
        assert user.mfa_version == original_version + 1

    def test_updates_generated_at_timestamp(self, db_session):
        """Creating codes updates recovery_codes_generated_at."""
        user = _make_test_user(db_session)
        assert user.recovery_codes_generated_at is None

        create_recovery_codes(db_session, user.user_id)
        db_session.commit()

        db_session.refresh(user)
        assert user.recovery_codes_generated_at is not None

    def test_stores_hashed_codes(self, db_session):
        """Codes are stored as hashes, not plaintext."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=3)
        db_session.commit()

        stored_codes = db_session.query(MfaRecoveryCode).filter_by(
            user_id=user.user_id
        ).all()

        for stored in stored_codes:
            for plaintext in codes:
                assert plaintext not in stored.code_hash
                assert plaintext.replace("-", "") not in stored.code_hash
            assert stored.code_hash.startswith("$argon2")

    def test_stores_label(self, db_session):
        """Stores the provided label on codes."""
        user = _make_test_user(db_session)
        create_recovery_codes(db_session, user.user_id, label="regenerated")
        db_session.commit()

        stored = db_session.query(MfaRecoveryCode).filter_by(
            user_id=user.user_id
        ).first()

        assert stored.label == "regenerated"

    def test_raises_for_unknown_user(self, db_session):
        """Raises ValueError for non-existent user."""
        with pytest.raises(ValueError, match="not found"):
            create_recovery_codes(db_session, uuid4())

    def test_default_count_is_10(self, db_session):
        """Default code count is 10."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id)
        db_session.commit()

        assert len(codes) == 10


class TestVerifyAndConsumeCode:
    """Tests for code verification and consumption."""

    def test_valid_code_returns_true(self, db_session):
        """Valid code returns True."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=3)
        db_session.commit()

        result = verify_and_consume_recovery_code(db_session, user.user_id, codes[0])
        db_session.commit()

        assert result is True

    def test_invalid_code_returns_false(self, db_session):
        """Invalid code returns False."""
        user = _make_test_user(db_session)
        create_recovery_codes(db_session, user.user_id, count=3)
        db_session.commit()

        result = verify_and_consume_recovery_code(
            db_session, user.user_id, "XXXX-XXXX-XXXX"
        )
        db_session.commit()

        assert result is False

    def test_cannot_reuse_code(self, db_session):
        """Code cannot be used twice."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=3)
        db_session.commit()

        # First use should succeed
        result1 = verify_and_consume_recovery_code(db_session, user.user_id, codes[0])
        db_session.commit()
        assert result1 is True

        # Second use should fail
        result2 = verify_and_consume_recovery_code(db_session, user.user_id, codes[0])
        db_session.commit()
        assert result2 is False

    def test_marks_code_as_used(self, db_session):
        """Consuming code marks it as used with timestamp."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=3)
        db_session.commit()

        verify_and_consume_recovery_code(db_session, user.user_id, codes[0])
        db_session.commit()

        used_codes = db_session.query(MfaRecoveryCode).filter(
            MfaRecoveryCode.user_id == user.user_id,
            MfaRecoveryCode.used_at.isnot(None),
        ).all()

        assert len(used_codes) == 1
        assert used_codes[0].used_at is not None

    def test_records_session_id(self, db_session):
        """Records session_id when consuming code."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=1)
        db_session.commit()

        verify_and_consume_recovery_code(
            db_session, user.user_id, codes[0], session_id="test-session-123"
        )
        db_session.commit()

        used_code = db_session.query(MfaRecoveryCode).filter(
            MfaRecoveryCode.user_id == user.user_id,
            MfaRecoveryCode.used_at.isnot(None),
        ).first()

        assert used_code.used_session_id == "test-session-123"

    def test_old_version_codes_invalid(self, db_session):
        """Codes from old mfa_version are invalid."""
        user = _make_test_user(db_session)

        # Generate first set of codes
        codes_v1 = create_recovery_codes(db_session, user.user_id, count=3)
        db_session.commit()

        # Generate second set (increments version)
        codes_v2 = create_recovery_codes(db_session, user.user_id, count=3)
        db_session.commit()

        # Old codes should be invalid
        result_old = verify_and_consume_recovery_code(
            db_session, user.user_id, codes_v1[0]
        )
        db_session.commit()
        assert result_old is False

        # New codes should be valid
        result_new = verify_and_consume_recovery_code(
            db_session, user.user_id, codes_v2[0]
        )
        db_session.commit()
        assert result_new is True

    def test_unknown_user_returns_false(self, db_session):
        """Returns False for unknown user."""
        result = verify_and_consume_recovery_code(
            db_session, uuid4(), "XXXX-XXXX-XXXX"
        )
        assert result is False

    def test_can_use_multiple_different_codes(self, db_session):
        """Can use multiple different codes from the same batch."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=5)
        db_session.commit()

        for i in range(3):
            result = verify_and_consume_recovery_code(
                db_session, user.user_id, codes[i]
            )
            db_session.commit()
            assert result is True


class TestInvalidateRecoveryCodes:
    """Tests for code invalidation."""

    def test_invalidate_increments_version(self, db_session):
        """Invalidating codes increments mfa_version."""
        user = _make_test_user(db_session)
        original_version = user.mfa_version

        new_version = invalidate_all_recovery_codes(db_session, user.user_id)
        db_session.commit()

        assert new_version == original_version + 1

    def test_invalidate_makes_codes_unusable(self, db_session):
        """Invalidating codes makes them unusable."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=3)
        db_session.commit()

        invalidate_all_recovery_codes(db_session, user.user_id)
        db_session.commit()

        for code in codes:
            result = verify_and_consume_recovery_code(
                db_session, user.user_id, code
            )
            assert result is False

    def test_invalidate_unknown_user_raises(self, db_session):
        """Raises ValueError for non-existent user."""
        with pytest.raises(ValueError, match="not found"):
            invalidate_all_recovery_codes(db_session, uuid4())


class TestGetRecoveryCodeStatus:
    """Tests for status retrieval."""

    def test_status_no_codes(self, db_session):
        """Status when user has no codes."""
        user = _make_test_user(db_session)
        status = get_recovery_code_status(db_session, user.user_id)

        assert status["has_codes"] is False
        assert status["codes_remaining"] == 0
        assert status["total_codes"] == 0
        assert status["used_codes"] == 0

    def test_status_with_codes(self, db_session):
        """Status when user has codes."""
        user = _make_test_user(db_session)
        create_recovery_codes(db_session, user.user_id, count=10)
        db_session.commit()

        status = get_recovery_code_status(db_session, user.user_id)

        assert status["has_codes"] is True
        assert status["codes_remaining"] == 10
        assert status["total_codes"] == 10
        assert status["used_codes"] == 0
        assert status["generated_at"] is not None

    def test_status_after_using_codes(self, db_session):
        """Status reflects used codes."""
        user = _make_test_user(db_session)
        codes = create_recovery_codes(db_session, user.user_id, count=10)
        db_session.commit()

        # Use 3 codes
        for i in range(3):
            verify_and_consume_recovery_code(db_session, user.user_id, codes[i])
        db_session.commit()

        status = get_recovery_code_status(db_session, user.user_id)

        assert status["has_codes"] is True
        assert status["codes_remaining"] == 7
        assert status["total_codes"] == 10
        assert status["used_codes"] == 3

    def test_status_unknown_user(self, db_session):
        """Status for non-existent user returns empty status."""
        status = get_recovery_code_status(db_session, uuid4())

        assert status["has_codes"] is False
        assert status["codes_remaining"] == 0
        assert status["total_codes"] == 0
