"""SD-JWT VC construction / verification tests. No model, no image needed:
claims are hand-built and signed with an ephemeral dev key.

Run:  pytest tests/test_credential.py
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

BUNDLE = Path(__file__).resolve().parents[1]

from openvc.keys import P256SigningKey

from runtime.credential import (CREDENTIAL_TYPE, AgeCredentialClaims,
                                CredentialVerifier, OpenVcSdJwtEncoder,
                                jwk_thumbprint)
from runtime.signer import DevES256Signer, IssuerSigner


def _b64url_json(seg: str) -> dict:
    seg += "=" * (-len(seg) % 4)
    return json.loads(base64.urlsafe_b64decode(seg.encode()))


@pytest.fixture(scope="module")
def issued():
    signer = DevES256Signer()
    holder = P256SigningKey.generate(kid="holder-1")
    holder_jwk = holder.public_jwk()
    encoder = OpenVcSdJwtEncoder(credential_ttl_s=3600)
    claims = AgeCredentialClaims(age_band="12_17", prediction_confidence=0.91).payload()
    vc = encoder.issue(claims, signer, holder_jwk)
    verifier = CredentialVerifier(issuer_public_jwk=signer.public_jwk(),
                                  expected_vct=CREDENTIAL_TYPE)
    return dict(signer=signer, holder=holder, holder_jwk=holder_jwk, vc=vc,
               verifier=verifier)


def test_dev_signer_satisfies_protocol():
    s = DevES256Signer()
    assert isinstance(s, IssuerSigner)
    assert s.alg == "ES256"
    assert isinstance(s.sign(b"abc"), (bytes, bytearray))


def test_issue_returns_sd_jwt_string(issued):
    assert isinstance(issued["vc"], str)
    assert issued["vc"].count("~") >= 3          # issuer JWT + 3 disclosures


def test_verify_ok_and_discloses_expected_claims(issued):
    v = issued["verifier"].verify(issued["vc"], expected_holder_jwk=issued["holder_jwk"])
    assert v.vct == CREDENTIAL_TYPE
    assert v.age_band == "12_17"
    assert v.prediction_confidence == 0.91
    assert v.assurance_method == "facial_age_estimation"
    assert v.holder_bound is True


def test_holder_binding_present_in_cnf(issued):
    jwt_payload = _b64url_json(issued["vc"].split("~")[0].split(".")[1])
    assert "cnf" in jwt_payload and "jwk" in jwt_payload["cnf"]
    assert jwk_thumbprint(jwt_payload["cnf"]["jwk"]) == jwk_thumbprint(issued["holder_jwk"])


def test_wrong_issuer_key_fails(issued):
    other = DevES256Signer()
    bad = CredentialVerifier(issuer_public_jwk=other.public_jwk())
    with pytest.raises(Exception):
        bad.verify(issued["vc"])


def test_tampered_age_band_disclosure_fails(issued):
    parts = issued["vc"].split("~")
    changed = False
    for i in range(1, len(parts)):
        if not parts[i]:
            continue
        d = _b64url_json(parts[i])
        if isinstance(d, list) and len(d) == 3 and d[1] == "age_band":
            d[2] = "18plus"
            raw = json.dumps(d, separators=(",", ":")).encode()
            parts[i] = base64.urlsafe_b64encode(raw).decode().rstrip("=")
            changed = True
    assert changed
    with pytest.raises(Exception):
        issued["verifier"].verify("~".join(parts))


def test_tampered_confidence_disclosure_fails(issued):
    parts = issued["vc"].split("~")
    for i in range(1, len(parts)):
        if not parts[i]:
            continue
        d = _b64url_json(parts[i])
        if isinstance(d, list) and len(d) == 3 and d[1] == "prediction_confidence":
            d[2] = 0.10
            raw = json.dumps(d, separators=(",", ":")).encode()
            parts[i] = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    with pytest.raises(Exception):
        issued["verifier"].verify("~".join(parts))


def test_tampered_signature_fails(issued):
    head, payload, sig = issued["vc"].split("~")[0].split(".")
    flipped = sig[:-2] + ("aa" if sig[-2:] != "aa" else "bb")
    rest = issued["vc"].split("~")[1:]
    broken = ".".join([head, payload, flipped]) + "~" + "~".join(rest)
    with pytest.raises(Exception):
        issued["verifier"].verify(broken)


def test_privacy_no_forbidden_content(issued):
    low = issued["vc"].lower()
    for bad in ("logit", "probabilit", "image_hash", "tensor_hash", "crop_hash",
                "raw_prediction", "session_id", "nonce", "p_minor"):
        assert bad not in low
    jwt_payload = _b64url_json(issued["vc"].split("~")[0].split(".")[1])
    allowed = {"iss", "vct", "iat", "exp", "nbf", "cnf", "sub", "jti", "status",
               "_sd", "_sd_alg", "..."}
    assert set(jwt_payload).issubset(allowed), set(jwt_payload) - allowed


def test_holder_binding_roundtrip(issued):
    pres = issued["verifier"].suite.create_presentation(
        issued["vc"], holder_key=issued["holder"],
        audience="https://verifier.childsafe.demo", nonce="kb-nonce-1")
    v = issued["verifier"].verify(
        pres, audience="https://verifier.childsafe.demo", nonce="kb-nonce-1",
        require_key_binding=True, expected_holder_jwk=issued["holder_jwk"])
    assert v.holder_bound is True
