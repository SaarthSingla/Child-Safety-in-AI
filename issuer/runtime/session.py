"""Issuance-session objects and validation.

Split out from ``service.py`` so the release tree matches the deployment
layout and so the session backend can be swapped without touching the
credential service.

Session lifecycle:

    validate()   -- checks the session is real, unexpired, bound to this
                    holder key, correct nonce, and NOT already consumed.
                    It has NO side effect on consumption.
    ... face detection, inference, policy, signing ...
    consume()    -- one-time, atomic-ish: marks the session used. Called
                    ONLY after a credential has been successfully signed.

A failed attempt (NO_FACE / LOW_CONFIDENCE / BAD_IMAGE / ...) never reaches
consume(), so it does not burn the session -- but neither is validate()
alone ever treated as a successful issuance.

PRODUCTION NOTE: a real deployment needs transactional / atomic session
state -- a single-use token store with compare-and-delete (or issue the
credential inside the same transaction that consumes the token) so that
consume() cannot race under concurrency. This in-memory implementation is
single-process and best-effort only.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Protocol

from .credential import jwk_thumbprint
from .errors import ErrorCode, SessionValidationError


@dataclass(frozen=True)
class IssuanceSession:
    session_id: str
    nonce: str
    holder_key_thumbprint: str
    issued_at: int
    expires_at: int


class SessionValidator(Protocol):
    def validate(self, session: IssuanceSession, holder_public_jwk: dict) -> None: ...

    def consume(self, session: IssuanceSession) -> None: ...


class InMemorySessionValidator:
    """DI mock for Kaggle / CI. The mobile Child Safety Framework replaces
    this with the real issuer/session component; the runtime contract does
    not change."""

    def __init__(self, now_fn=None):
        self._known: dict = {}
        self._consumed: set = set()
        self._now = now_fn or (lambda: int(time.time()))

    def register(self, session: IssuanceSession) -> None:
        self._known[session.session_id] = session

    def validate(self, session: IssuanceSession, holder_public_jwk: dict) -> None:
        if not isinstance(session, IssuanceSession) or not session.session_id:
            raise SessionValidationError(ErrorCode.INVALID_REQUEST, "malformed session")
        known = self._known.get(session.session_id)
        if known is None:
            raise SessionValidationError(ErrorCode.SESSION_UNKNOWN)
        if session.session_id in self._consumed:
            raise SessionValidationError(ErrorCode.SESSION_REPLAY)
        if self._now() > int(known.expires_at):
            raise SessionValidationError(ErrorCode.SESSION_EXPIRED)
        if session.nonce != known.nonce:
            raise SessionValidationError(ErrorCode.NONCE_MISMATCH)
        try:
            thumb = jwk_thumbprint(holder_public_jwk)
        except Exception:
            raise SessionValidationError(ErrorCode.INVALID_REQUEST, "bad holder jwk") from None
        if thumb != known.holder_key_thumbprint or thumb != session.holder_key_thumbprint:
            raise SessionValidationError(ErrorCode.HOLDER_KEY_MISMATCH)

    def consume(self, session: IssuanceSession) -> None:
        """One-time. Raises SESSION_REPLAY if already consumed. Under the GIL
        the check-and-add below is effectively atomic for a single process; a
        real backend performs a compare-and-delete on a shared token store."""
        sid = session.session_id
        if sid not in self._known:
            raise SessionValidationError(ErrorCode.SESSION_UNKNOWN)
        if sid in self._consumed:
            raise SessionValidationError(ErrorCode.SESSION_REPLAY)
        self._consumed.add(sid)
