"""The single confidential-runtime entry point.

``ConfidentialAgeCredentialService.issue_credential`` is the ONLY public
operation and it returns ONLY the signed SD-JWT VC string. There is no
``predict_age`` and no method that returns an age band or a confidence
outside a signed credential.

Trusted-boundary flow:

    validate issuance session            (no consumption)
        -> hash exact input bytes (internal)
        -> face detection
        -> deterministic crop / preprocessing
        -> CLIP inference
        -> temperature calibration
        -> internal AgeEstimationResult          [PRIVATE]
        -> IssuancePolicy
        -> VC claims                             [PRIVATE]
        -> SD-JWT VC creation
        -> issuer signature
        -> consume the session ATOMICALLY        (only now)
        -> return VC string                      [only thing that leaves]

A failed attempt at any earlier step never consumes the session.
"""
from __future__ import annotations

import logging
import secrets

from .credential import AgeCredentialClaims, CredentialEncoder
from .errors import (CredentialIssuanceError, ErrorCode, PreprocessError,
                     SessionValidationError, Verdict)
from .estimator import AgeBandEstimator, AgeEstimationResult
from .policy import IssuancePolicy, PolicyDecision
from .preprocessing import (FaceDetectorONNX, PreprocessConfig,
                            RuntimePreprocessResult, preprocess_runtime)
from .session import IssuanceSession, SessionValidator

_SAFE_EVENTS = {
    "request_accepted", "session_validated", "face_validation_passed",
    "inference_completed", "policy_evaluated", "credential_issued",
    "session_consumed", "request_rejected",
}


class RuntimeLogger:
    """Whitelist-only. Never accepts image bytes, hashes, tensors, logits,
    probability vectors, the raw age result, holder keys or VC plaintext.
    Only an opaque request id and a fixed event code."""

    def __init__(self, logger: "logging.Logger | None" = None):
        self._log = logger or logging.getLogger("childsafe.runtime")

    def event(self, code: str, request_id: str, verdict: "str | None" = None) -> None:
        if code not in _SAFE_EVENTS:
            code = "event_suppressed"
        msg = f"rid={request_id} {code}"
        if verdict:
            msg += f" verdict={verdict}"
        self._log.info(msg)


class ConfidentialAgeCredentialService:
    def __init__(self, *, detector: FaceDetectorONNX, preprocess_cfg: PreprocessConfig,
                 estimator: AgeBandEstimator, policy: IssuancePolicy,
                 encoder: CredentialEncoder, signer, session_validator: SessionValidator,
                 issuer: str, logger: "RuntimeLogger | None" = None):
        self._detector = detector
        self._cfg = preprocess_cfg
        self._estimator = estimator
        self._policy = policy
        self._encoder = encoder
        self._signer = signer
        self._sessions = session_validator
        self._issuer = str(issuer)
        self._logger = logger or RuntimeLogger()

    def issue_credential(self, image_bytes: bytes, session: IssuanceSession,
                         holder_public_jwk: dict) -> str:
        rid = secrets.token_hex(8)
        self._logger.event("request_accepted", rid)

        if (not isinstance(image_bytes, (bytes, bytearray)) or len(image_bytes) == 0
                or not isinstance(holder_public_jwk, dict)
                or "kty" not in holder_public_jwk):
            self._logger.event("request_rejected", rid, Verdict.REJECT_INVALID_REQUEST.value)
            raise CredentialIssuanceError(Verdict.REJECT_INVALID_REQUEST.value,
                                          ErrorCode.INVALID_REQUEST)

        # 1. validate the session -- NO consumption here
        try:
            self._sessions.validate(session, holder_public_jwk)
        except SessionValidationError as exc:
            self._logger.event("request_rejected", rid, Verdict.REJECT_INVALID_REQUEST.value)
            raise CredentialIssuanceError(Verdict.REJECT_INVALID_REQUEST.value,
                                          exc.code) from None
        self._logger.event("session_validated", rid)

        # 2. fail-closed preprocessing
        try:
            pre: RuntimePreprocessResult = preprocess_runtime(
                bytes(image_bytes), self._detector, self._cfg)
        except PreprocessError as exc:
            self._logger.event("request_rejected", rid, Verdict.REJECT_FACE.value)
            raise CredentialIssuanceError(Verdict.REJECT_FACE.value, exc.code) from None
        self._logger.event("face_validation_passed", rid)

        # 3. inference + calibration  [PRIVATE]
        result: AgeEstimationResult = self._estimator.estimate(pre.tensor)
        self._logger.event("inference_completed", rid)

        # 4. policy
        decision: PolicyDecision = self._policy.evaluate(result)
        self._logger.event("policy_evaluated", rid, decision.verdict.value)
        if decision.verdict != Verdict.ISSUE:
            self._logger.event("request_rejected", rid, decision.verdict.value)
            raise CredentialIssuanceError(decision.verdict.value, decision.detail)

        # 5. build + sign the credential  [PRIVATE until signed]
        claims = AgeCredentialClaims(
            age_band=decision.age_band,
            prediction_confidence=decision.vc_confidence,
            issuer=self._issuer,
        ).payload()
        vc = self._encoder.issue(claims, self._signer, holder_public_jwk)

        # 6. ONLY now: consume the session atomically. If it lost a race, the
        #    signed VC is discarded rather than handed out twice.
        try:
            self._sessions.consume(session)
        except SessionValidationError as exc:
            self._logger.event("request_rejected", rid, Verdict.REJECT_INVALID_REQUEST.value)
            raise CredentialIssuanceError(Verdict.REJECT_INVALID_REQUEST.value,
                                          exc.code) from None
        self._logger.event("session_consumed", rid)
        self._logger.event("credential_issued", rid)
        return vc
