"""SD-JWT VC construction and verification.

Backed by ``openvc-core==1.20.0`` (``SdJwtVcProofSuite``). Disclosure
digests (``_sd``), the KB-JWT and the JWS are all produced by the library;
nothing cryptographic is hand-rolled here.

Credential type: ``urn:childsafe:age-credential:v1``.

Selectively disclosable: ``age_band``, ``prediction_confidence``,
``assurance_method``. Issuer metadata and the holder binding (``cnf.jwk``)
stay non-disclosable per the SD-JWT VC conventions the library implements.
"""
from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from typing import Protocol

from openvc.proof.sd_jwt import SdJwtVcProofSuite


def jwk_thumbprint(jwk: dict, *, hash_name: str = "sha256") -> str:
    """RFC 7638 JWK thumbprint. openvc-core 1.20.0 does not export one, and this
    is a small, fully-specified canonicalisation (required members only, in
    lexicographic order, no whitespace) -- not disclosure/JWS crypto."""
    if not isinstance(jwk, dict):
        raise ValueError("jwk must be a dict")
    kty = jwk.get("kty")
    if kty == "EC":
        members = {"crv": jwk["crv"], "kty": "EC", "x": jwk["x"], "y": jwk["y"]}
    elif kty == "OKP":
        members = {"crv": jwk["crv"], "kty": "OKP", "x": jwk["x"]}
    elif kty == "RSA":
        members = {"e": jwk["e"], "kty": "RSA", "n": jwk["n"]}
    else:
        raise ValueError(f"unsupported jwk kty {kty!r} for thumbprint")
    canon = json.dumps(members, sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(hashlib.new(hash_name, canon).digest()).decode().rstrip("=")

CREDENTIAL_TYPE = "urn:childsafe:age-credential:v1"
ASSURANCE_METHOD = "facial_age_estimation"
DEFAULT_ISSUER = "https://issuer.childsafe.demo"

DISCLOSABLE_CLAIMS = ("age_band", "prediction_confidence", "assurance_method")

# A verifier of this credential may only ever see these keys. Anything else
# in the token is a privacy defect.
ALLOWED_VC_CLAIM_KEYS = {
    "iss", "vct", "iat", "exp", "nbf", "cnf", "sub", "jti", "status",
    "_sd", "_sd_alg", "...",
    "age_band", "prediction_confidence", "assurance_method",
}

# Substrings that must never appear in the disclosed claim view of the VC
# (and, where long enough to be unambiguous, anywhere in the token string).
FORBIDDEN_VC_SUBSTRINGS = (
    "logit", "probabilit", "image_hash", "tensor_hash", "crop_hash",
    "raw_prediction", "session_id", "issuance_nonce", "p_minor",
    "device_id", "gpu_identifier", "tee_measurement",
)


class CredentialEncoder(Protocol):
    def issue(self, claims: dict, signer, holder_jwk: dict) -> str: ...


@dataclass(frozen=True)
class AgeCredentialClaims:
    """The credentialised age result. This is allowed to live inside the
    signed VC -- it is not raw model output once it is issuer-signed."""

    age_band: str
    prediction_confidence: float
    issuer: str = DEFAULT_ISSUER
    assurance_method: str = ASSURANCE_METHOD

    def payload(self) -> dict:
        return {
            "iss": self.issuer,
            "age_band": self.age_band,
            "prediction_confidence": self.prediction_confidence,
            "assurance_method": self.assurance_method,
        }


class OpenVcSdJwtEncoder:
    def __init__(self, *, credential_ttl_s: int = 3600, vct: str = CREDENTIAL_TYPE):
        self.suite = SdJwtVcProofSuite()
        self.credential_ttl_s = int(credential_ttl_s)
        self.vct = str(vct)

    def issue(self, claims: dict, signer, holder_jwk: dict) -> str:
        return self.suite.issue(
            dict(claims),
            signing_key=signer,
            disclosable=list(DISCLOSABLE_CLAIMS),
            holder_jwk=holder_jwk,
            vct=self.vct,
            expires_in_s=self.credential_ttl_s,
        )


@dataclass
class VerifiedCredential:
    vct: str
    age_band: str
    prediction_confidence: float
    assurance_method: str
    holder_bound: bool
    claims: dict


class CredentialVerifier:
    """Independent verifier: issuer signature, issuer key, expiry, vct,
    disclosure integrity (via the library) plus a local holder-binding and
    privacy check."""

    def __init__(self, *, issuer_public_jwk: dict, expected_vct: str = CREDENTIAL_TYPE):
        self.suite = SdJwtVcProofSuite()
        self.issuer_public_jwk = dict(issuer_public_jwk)
        self.expected_vct = str(expected_vct)

    def _privacy_scan(self, vc: str, claims: dict) -> None:
        for k in claims:
            if k not in ALLOWED_VC_CLAIM_KEYS:
                raise ValueError(f"unexpected claim in credential: {k!r}")
        blob = json.dumps(claims, default=str, sort_keys=True).lower()
        for bad in FORBIDDEN_VC_SUBSTRINGS:
            if bad in blob:
                raise ValueError(f"forbidden content in disclosed claims: {bad!r}")
        low = vc.lower()
        for bad in FORBIDDEN_VC_SUBSTRINGS:
            if len(bad) >= 8 and bad in low:
                raise ValueError(f"forbidden content in credential token: {bad!r}")

    def verify(self, vc: str, *, expected_holder_jwk: "dict | None" = None,
               audience: "str | None" = None, nonce: "str | None" = None,
               require_key_binding: bool = False) -> VerifiedCredential:
        res = self.suite.verify(
            vc,
            public_key_jwk=self.issuer_public_jwk,
            expected_vct=self.expected_vct,
            audience=audience,
            nonce=nonce,
            require_key_binding=require_key_binding,
        )
        claims = dict(getattr(res, "claims", {}) or {})
        self._privacy_scan(vc, claims)

        cnf = getattr(res, "confirmation", None) or claims.get("cnf") or {}
        holder_jwk = cnf.get("jwk") if isinstance(cnf, dict) else None
        holder_bound = holder_jwk is not None
        if expected_holder_jwk is not None:
            holder_bound = holder_bound and (
                jwk_thumbprint(holder_jwk) == jwk_thumbprint(expected_holder_jwk))

        return VerifiedCredential(
            vct=str(getattr(res, "vct", self.expected_vct)),
            age_band=claims["age_band"],
            prediction_confidence=claims["prediction_confidence"],
            assurance_method=claims.get("assurance_method", ""),
            holder_bound=bool(holder_bound),
            claims=claims,
        )
