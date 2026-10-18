"""Typed error surface for the confidential age-credential runtime.

Nothing in this module carries biometric data or model internals. An error
code is safe to log and safe to hand back to the caller as the reason a
credential was not issued. The raw selfie, face crop, tensor, logits and
probability vector never appear here.

This file is part of ``childsafe_age_release_v1`` and must stay importable
without any Kaggle / notebook globals.
"""
from __future__ import annotations

from enum import Enum


class Verdict(str, Enum):
    """Coarse issuance outcome. This is the only outcome vocabulary the
    service exposes to a caller."""

    ISSUE = "ISSUE"
    REJECT_FACE = "REJECT_FACE"
    REJECT_LOW_CONFIDENCE = "REJECT_LOW_CONFIDENCE"
    REJECT_INVALID_REQUEST = "REJECT_INVALID_REQUEST"


class ErrorCode(str, Enum):
    """Non-biometric detail code. Safe to log; safe to return."""

    # --- preprocessing / face validation  (roll up to REJECT_FACE) ---
    NO_FACE = "NO_FACE"
    MULTIPLE_FACES = "MULTIPLE_FACES"
    BAD_IMAGE = "BAD_IMAGE"
    FACE_TOO_SMALL = "FACE_TOO_SMALL"
    # --- issuance session / request  (roll up to REJECT_INVALID_REQUEST) ---
    INVALID_REQUEST = "INVALID_REQUEST"
    SESSION_UNKNOWN = "SESSION_UNKNOWN"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    SESSION_REPLAY = "SESSION_REPLAY"
    NONCE_MISMATCH = "NONCE_MISMATCH"
    HOLDER_KEY_MISMATCH = "HOLDER_KEY_MISMATCH"
    # --- policy  (roll up to REJECT_LOW_CONFIDENCE) ---
    LOW_CONFIDENCE = "LOW_CONFIDENCE"


class _CodedError(Exception):
    """Base for the internal typed errors. ``str(err)`` is only the code."""

    def __init__(self, code: ErrorCode, message: str = ""):
        super().__init__(code.value if not message else f"{code.value}: {message}")
        self.code = code


class PreprocessError(_CodedError):
    """Face detection / deterministic preprocessing failed, fail-closed."""


class SessionValidationError(_CodedError):
    """Issuance session or request envelope rejected."""


class PolicyRejection(_CodedError):
    """IssuancePolicy declined to authorise a credential."""


class CredentialIssuanceError(Exception):
    """The ONLY exception type allowed to leave
    ``ConfidentialAgeCredentialService.issue_credential``.

    Carries a coarse :class:`Verdict` plus an optional non-biometric
    :class:`ErrorCode`. It never carries hashes, tensors, probabilities,
    logits or the raw age result.
    """

    def __init__(self, verdict: str, detail: "ErrorCode | None" = None):
        super().__init__(verdict if detail is None else f"{verdict} ({detail.value})")
        self.verdict = str(verdict)
        self.detail = detail
